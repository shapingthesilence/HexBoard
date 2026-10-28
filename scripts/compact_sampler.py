#!/usr/bin/env python3
"""Personal HBC import/readback and hardware smoke tests over USB MIDI.

Requires mido/python-rtmidi. Instrument paths are supplied by the user; this tool
does not fetch or bundle source recordings. Existing slots are never overwritten.
"""
import argparse
import json
from pathlib import Path
import struct
import time
import zlib


def number(value, width):
    return [(value >> (7 * i)) & 127 for i in reversed(range(width))]


def integer(data):
    result = 0
    for byte in data:
        result = result * 128 + byte
    return result


def pack(data):
    result = []
    for at in range(0, len(data), 7):
        chunk = data[at:at + 7]
        result += [sum((b >> 7) << i for i, b in enumerate(chunk)), *[b & 127 for b in chunk]]
    return result


def unpack(data, length):
    result = bytearray()
    for at in range(0, len(data), 8):
        group = data[at:at + 8]
        result.extend(b | (((group[0] >> i) & 1) << 7) for i, b in enumerate(group[1:]))
    if len(result) != length:
        raise RuntimeError('Invalid packed read length')
    return bytes(result)


class Board:
    def __init__(self, port):
        import mido
        self.mido = mido
        self.input = mido.open_input(port)
        self.output = mido.open_output(port)
        self.transaction = 0

    def close(self):
        self.input.close()
        self.output.close()

    def send(self, message, data, transaction):
        self.output.send(self.mido.Message('sysex', data=[0x7d, 0x10, 1, 0, message, *number(transaction, 2), *data]))

    def receive(self, transaction, timeout=15):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            for message in self.input.iter_pending():
                if message.type != 'sysex':
                    continue
                b = list(message.data)
                if len(b) >= 7 and b[:4] == [0x7d, 0x10, 1, 0] and integer(b[5:7]) == transaction:
                    if b[4] == 7:
                        raise RuntimeError(f'Board rejected message 0x{b[7]:02x}, error {b[8]}')
                    return b[4], b[7:]
            time.sleep(.002)
        raise TimeoutError(f'No MIDI response for transaction {transaction}')

    def request(self, message, data, expected):
        self.transaction = self.transaction % 16000 + 1
        self.send(message, data, self.transaction)
        kind, result = self.receive(self.transaction)
        if kind != expected:
            raise RuntimeError(f'Unexpected response {kind}')
        if kind == 6 and (not result or result[0] != message):
            raise RuntimeError('Incorrect acknowledged message')
        return result

    def sampler(self, operation, slot=None):
        return self.request(0x36, [operation] + ([] if slot is None else [slot]), 0x37)

    def status(self):
        p = self.sampler(0)
        return dict(slot=p[1], assets=p[2], zones=p[3], pcm_bytes=integer(p[4:7]), free_heap=integer(p[7:11]), name=bytes(p[12:]).decode('ascii'))

    def library(self):
        rows = []
        for slot in range(32):
            p = self.sampler(1, slot)
            if p[2]:
                rows.append(dict(slot=slot, bytes=integer(p[3:6]), name=bytes(p[7:]).decode('ascii')))
        return rows

    def upload(self, slot, body):
        crc = zlib.crc32(body)
        transfer, flags = 1, 2
        self.request(0x24, [0x0e, *number(slot, 2), *number(transfer, 2), 1, 0, *number(len(body), 4), *number(crc, 5), *number(96, 2), flags], 6)
        try:
            index = 0
            for offset in range(0, len(body), 96):
                chunk = body[offset:offset + 96]
                self.request(0x25, [*number(transfer, 2), *number(index, 3), *number(offset, 4), *number(len(chunk), 2), sum(chunk) & 127, *pack(chunk)], 6)
                index += 1
            self.request(0x26, [*number(transfer, 2), *number(index, 3)], 6)
            self.request(0x27, [*number(transfer, 2), *number(len(body), 4), *number(crc, 5), flags], 6)
        except Exception:
            try:
                self.request(0x28, [*number(transfer, 2), 1], 6)
            except Exception:
                pass  # Rejected commits may already have discarded the transfer.
            raise

    def read(self, slot):
        self.transaction = self.transaction % 16000 + 1
        transaction = self.transaction
        self.send(0x22, [0x0e, *number(slot, 2), 0], transaction)
        kind, p = self.receive(transaction)
        if kind != 0x23:
            raise RuntimeError('Missing read begin')
        # READ_BEGIN: type, handle14, transfer14, schema2, length28, crc35, chunk14.
        length, crc = integer(p[7:11]), integer(p[11:16])
        body = bytearray()
        next_index = 0
        self.send(6, [0x23, 0, *number(0, 3), 0], transaction)
        while True:
            kind, p = self.receive(transaction)
            if kind == 0x26:
                self.send(6, [0x26, 0, *number(next_index, 3), 0], transaction)
                break
            if kind != 0x25 or integer(p[2:5]) != next_index or integer(p[5:9]) != len(body):
                raise RuntimeError('Out-of-order read')
            chunk = unpack(p[12:], integer(p[9:11]))
            if sum(chunk) & 127 != p[11]:
                raise RuntimeError('Read chunk checksum mismatch')
            body.extend(chunk)
            next_index += 1
            self.send(6, [0x25, 0, *number(next_index, 3), 0], transaction)
        if len(body) != length or zlib.crc32(body) != crc:
            raise RuntimeError('Readback CRC mismatch')
        return bytes(body)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', default='HexBoard virtual-cable')
    parser.add_argument('--install', type=Path, nargs='*', default=[])
    parser.add_argument('--select', type=int)
    parser.add_argument('--save-startup', action='store_true', help='Save current settings into startup profile 1')
    parser.add_argument('--switch-cycles', type=int, default=0)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    board = Board(args.port)
    report = {'passed': False, 'installed': []}
    try:
        report['before'] = board.status()
        rows = board.library()
        for path in args.install:
            body = path.read_bytes()
            name = body[32:64].split(b'\0', 1)[0].decode('ascii')
            existing = next((r for r in rows if r['name'] == name), None)
            if existing:
                slot = existing['slot']
                if board.read(slot) != body:
                    raise RuntimeError(f'Existing instrument differs: {name}')
            else:
                slot = next(i for i in range(32) if not any(r['slot'] == i for r in rows))
                board.upload(slot, body)
                if board.read(slot) != body:
                    raise RuntimeError(f'Install/readback differs: {path}')
                rows.append(dict(slot=slot, name=name, bytes=len(body)))
            board.sampler(2, slot)
            if board.status()['slot'] != slot:
                raise RuntimeError('Selection did not become active')
            report['installed'].append(dict(file=str(path), slot=slot, bytes=len(body)))
            print(json.dumps(report['installed'][-1]), flush=True)
        selected = args.select if args.select is not None else (rows[0]['slot'] if rows else 127)
        minimum_heap = board.status()['free_heap']
        for _ in range(args.switch_cycles):
            for slot in (127, selected):
                board.sampler(2, slot)
                status = board.status()
                if status['slot'] != slot:
                    raise RuntimeError('Engine switch failed')
                minimum_heap = min(minimum_heap, status['free_heap'])
        report['minimum_heap'] = minimum_heap
        if args.select is not None:
            board.sampler(2, args.select)
        if args.save_startup:
            board.sampler(4)
        report['after'] = board.status()
        report['library'] = board.library()
        report['passed'] = True
    finally:
        board.close()
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
