#!/usr/bin/env python3
"""Non-saving MIDI soak: catalog reads, dry runs, rejects, and delegated LEDs.

Requires mido, python-rtmidi, and (for optional heap/audio logs) pyserial.
Does not flash firmware or erase storage. Keep a full flash backup separately.
"""
import argparse
from collections import Counter
import json
from pathlib import Path
import random
import re
import time
import zlib


def encode(value, width):
    return [(value >> (7 * i)) & 127 for i in reversed(range(width))]


def decode(data):
    value = 0
    for byte in data:
        value = (value << 7) | byte
    return value


def pack(raw):
    result = []
    for offset in range(0, len(raw), 7):
        group = raw[offset:offset + 7]
        result += [sum(((byte >> 7) & 1) << i for i, byte in enumerate(group))]
        result += [byte & 127 for byte in group]
    return result


def unpack(packed, length):
    if len(packed) != length + (length + 6) // 7:
        raise AssertionError("invalid packed response length")
    raw = bytearray()
    for offset in range(0, len(packed), 8):
        prefix = packed[offset]
        raw.extend(byte | (((prefix >> i) & 1) << 7)
                   for i, byte in enumerate(packed[offset + 1:offset + 8]))
    return raw


class Device:
    def __init__(self, name, serial_port):
        import mido
        self.mido = mido
        self.input = mido.open_input(name)
        self.output = mido.open_output(name)
        self.active_transfer = None
        self.transaction = 0
        self.counts = Counter()
        self.serial = None
        self.heap = []
        self.audio = []
        if serial_port:
            import serial
            self.serial = serial.Serial(serial_port, 115200, timeout=0, write_timeout=3)
        self.serial_buffer = b""
        self.debug_flags = None
        self.saved_debug_flags = None
        if self.serial:
            self.saved_debug_flags = self.debug_command("HBDBG?")
            self.debug_command("HBDBG 13")

    def debug_command(self, command):
        self.debug_flags = None
        self.serial.write((command + "\n").encode())
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            self.sample_logs()
            if self.debug_flags is not None:
                return self.debug_flags
            time.sleep(0.01)
        raise TimeoutError("CDC diagnostics command timed out; use updated firmware")

    def sample_logs(self):
        if not self.serial:
            return
        self.serial_buffer += self.serial.read(self.serial.in_waiting)
        lines = self.serial_buffer.split(b"\n")
        self.serial_buffer = lines.pop()
        for raw in lines:
            line = raw.decode(errors="replace").strip()
            flags = re.fullmatch(r"HBDBG flags: (\d+)", line)
            if flags:
                self.debug_flags = int(flags[1])
            match = re.fullmatch(r"Heap free/min: (\d+)/(\d+) bytes", line)
            if match:
                self.heap.append([int(x) for x in match.groups()])
            if line.startswith("Audio cpu avg/max/worst:"):
                self.audio.append(line)

    def send(self, data):
        self.output.send(self.mido.Message("sysex", data=data))
        self.counts["frames_sent"] += 1

    def receive(self, predicate, timeout=3):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            self.sample_logs()
            message = self.input.poll()
            if message is not None and message.type == "sysex":
                data = list(message.data)
                if predicate(data):
                    self.counts["responses"] += 1
                    return data
            time.sleep(0.001)
        raise TimeoutError("HexBoard response timed out (disconnect, reset, or stalled protocol)")

    def request(self, message, payload, expected):
        self.transaction = (self.transaction % 16383) + 1
        self.send([0x7d, 0x10, 1, 0, message, *encode(self.transaction, 2), *payload])
        return self.response(expected)[7:]

    def response(self, expected):
        data = self.receive(lambda d: len(d) >= 7 and d[:2] == [0x7d, 0x10]
                            and decode(d[5:7]) == self.transaction)
        if data[4] != expected:
            raise AssertionError(f"expected message {expected:#x}, received {data}")
        return data

    def ack(self, message, index=0):
        self.send([0x7d, 0x10, 1, 0, 6, *encode(self.transaction, 2), message, 0,
                   *encode(index, 3), 0])

    def hello(self):
        self.request(1, [*encode(128, 2), 0, 0, 0, 0], 2)
        self.counts["health_checks"] += 1

    def catalog(self):
        records = []
        page = 0
        while True:
            payload = self.request(0x20, [0, *encode(page, 2), 4, 0], 0x21)
            cursor = 6
            for _ in range(payload[5]):
                record = {"type": payload[cursor], "handle": decode(payload[cursor + 1:cursor + 3])}
                record["schema"] = payload[cursor + 4:cursor + 6]
                cursor += 7 + payload[cursor + 6]
                cursor += 1 + payload[cursor]
                size = payload[cursor]
                record["name"] = bytes(payload[cursor + 1:cursor + 1 + size]).decode()
                cursor += 1 + size
                records.append(record)
            page += 1
            if page >= decode(payload[3:5]):
                return records

    def read(self, record):
        begin = self.request(0x22, [record["type"], *encode(record["handle"], 2), 0], 0x23)
        transfer = begin[3:5]
        self.active_transfer = transfer
        length, checksum = decode(begin[7:11]), decode(begin[11:16])
        raw = bytearray()
        index = 0
        self.ack(0x23)
        while len(raw) < length:
            chunk = self.response(0x25)[7:]
            assert chunk[:2] == transfer and decode(chunk[2:5]) == index
            assert decode(chunk[5:9]) == len(raw)
            decoded = unpack(chunk[12:], decode(chunk[9:11]))
            assert sum(decoded) % 128 == chunk[11]
            raw += decoded
            index += 1
            self.ack(0x25, index)
        end = self.response(0x26)[7:]
        assert end[:2] == transfer and decode(end[2:5]) == index
        self.ack(0x26)
        self.active_transfer = None
        assert len(raw) == length and zlib.crc32(raw) == checksum
        self.counts["objects_read"] += 1
        self.counts["bytes_read"] += len(raw)
        return raw

    def dry_run(self, record, body, malformed=False):
        transfer = encode(1, 2)
        checksum = zlib.crc32(body)
        payload = [record["type"], *encode(16383, 2), *transfer, *record["schema"],
                   *encode(len(body), 4), *encode(checksum, 5), *encode(64, 2), 8]
        reply = self.request(0x24, payload, 6)
        assert reply[:2] == [0x24, 0]
        self.active_transfer = transfer
        if malformed:
            # Fits the declared object but cannot be produced by this tiny frame.
            bad = [*transfer, 0, 0, 0, 0, 0, 0, 0, *encode(16383, 2), 0, 0, 0]
            reply = self.request(0x25, bad, 7)
            assert reply[:2] == [0x25, 3]
            self.counts["malformed_chunks_rejected"] += 1
            self.request(0x28, [*transfer, 0], 6)
            self.active_transfer = None
            return
        index = 0
        for offset in range(0, len(body), 64):
            raw = body[offset:offset + 64]
            payload = [*transfer, *encode(index, 3), *encode(offset, 4),
                       *encode(len(raw), 2), sum(raw) % 128, *pack(raw)]
            reply = self.request(0x25, payload, 6)
            assert reply[:2] == [0x25, 0] and decode(reply[2:5]) == index + 1
            index += 1
        self.request(0x26, [*transfer, *encode(index, 3)], 6)
        self.request(0x27, [*transfer, *encode(len(body), 4), *encode(checksum, 5), 8], 6)
        self.active_transfer = None
        self.counts["dry_runs"] += 1

    def delegated(self, iteration):
        token = encode(iteration + 1, 4)
        self.send([0x7d, 7, 2, *token, *b"Stability test"])
        reply = self.receive(lambda d: d[:3] == [0x7d, 9, 2] and d[3:7] == token)
        assert reply[7] == 1, "delegated entry busy; release physical buttons"
        for frame in range(4):
            pixels = []
            for led in range(140):
                # Dim patterns avoid unnecessarily loading the power supply.
                pixels += [*encode(led, 2), (led + iteration + frame) % 128, 127, 12]
            self.send([0x7d, 3, *pixels])
            time.sleep(0.01)
        self.send([0x7d, 0x0a, *token])
        reply = self.receive(lambda d: d[:3] == [0x7d, 9, 2] and d[3:7] == token)
        assert reply[7] == 0
        self.counts["delegated_cycles"] += 1

    def close(self):
        # Legacy exit and transfer abort restore the surface after a failed run.
        self.send([0x7d, 2])
        if self.active_transfer is not None:
            self.request(0x28, [*self.active_transfer, 0], 6)
        if self.serial:
            if self.saved_debug_flags is not None:
                self.debug_command(f"HBDBG {self.saved_debug_flags}")
            self.serial.close()
        self.input.close()
        self.output.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--midi", default="HexBoard virtual-cable")
    parser.add_argument("--serial", help="Optional CDC port for existing Serial Debug logs")
    parser.add_argument("--seconds", type=float, default=600)
    parser.add_argument("--quick", action="store_true", help="Read one preset and tuning before the transfer soak")
    parser.add_argument("--output", type=Path, default=Path("build/stability/device.json"))
    args = parser.parse_args()
    if args.seconds <= 0:
        parser.error("--seconds must be positive")
    device = None
    start = time.monotonic()
    report = {"passed": False}
    try:
        device = Device(args.midi, args.serial)
        device.hello()
        records = device.catalog()
        print(f"Catalog: {len(records)} objects", flush=True)
        bodies = {}
        inventory = records
        if args.quick:
            inventory = [next(r for r in records if r["type"] == kind) for kind in (7, 3)]
        for number, record in enumerate(inventory, 1):
            body = device.read(record)
            if number % 20 == 0 or record["type"] == 11:
                print(f"Read {number}/{len(inventory)} objects; {record['name']}", flush=True)
                time.sleep(0.35)  # Let the transfer window close and restore the menu.
            if record["type"] in (3, 4, 5, 6, 7, 10):
                bodies[(record["type"], record["handle"])] = body
        geometry = next(r for r in records if r["type"] == 3)
        maximum = bytearray(bodies[(3, geometry["handle"])])
        padding = 16384 - len(maximum) - 3
        assert padding >= 0
        maximum += bytes([0x7e, padding & 255, padding >> 8]) + bytes(padding)
        randomizer = random.Random(0x4842)
        iteration = 0
        next_report = time.monotonic()
        while iteration == 0 or time.monotonic() - start < args.seconds:
            record = randomizer.choice([r for r in records if (r["type"], r["handle"]) in bodies])
            device.read(record)
            device.dry_run(record, bodies[(record["type"], record["handle"])])
            device.dry_run(geometry, maximum, malformed=True)
            if iteration % 10 == 0:
                device.dry_run(geometry, maximum)
                device.delegated(iteration)
            # Parser overflow must recover for the following health request.
            if iteration % 20 == 0:
                device.send([0x7d, 0x10, *([0] * 1100)])
            device.hello()
            if device.serial:
                assert device.debug_command("HBDBG?") == 13, "diagnostics reset or changed during soak"
            time.sleep(0.35)
            iteration += 1
            if time.monotonic() >= next_report:
                print(f"{time.monotonic() - start:.0f}s: {dict(device.counts)}", flush=True)
                next_report = time.monotonic() + 30
        time.sleep(2.1)
        device.sample_logs()
        device.hello()
        report["passed"] = True
    except BaseException as error:
        report["error"] = repr(error)
        raise
    finally:
        try:
            if device is not None:
                device.close()
        except Exception as error:
            report["cleanup_error"] = repr(error)
            report["passed"] = False
        report.update(seconds=round(time.monotonic() - start, 2), counts=dict(device.counts) if device else {},
                      heap_samples=device.heap if device else [],
                      audio_samples=device.audio if device else [])
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps({k: v for k, v in report.items() if k not in ("heap_samples", "audio_samples")}), flush=True)
    if not report["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
