#!/usr/bin/env python3
"""Classic sampler sound install/readback and hardware smoke tests over USB MIDI.

Installs user-supplied `.hexsound` files (a sound with its instrument, see
docs/compact-sampler.md): each is stored, played, and read back byte for byte.
A sound with the same object id is replaced. Requires mido/python-rtmidi. This
tool does not fetch or bundle source recordings.
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

    def sampler(self, operation):
        return self.request(0x36, [operation], 0x37)

    def status(self):
        p = self.sampler(0)
        return dict(active=p[1] != 127, assets=p[2], zones=p[3], pcm_bytes=integer(p[4:7]), free_heap=integer(p[7:11]), name=bytes(p[12:]).decode('ascii'))

    def sounds(self):
        """Synth preset list rows: handle, object id, folder and name."""
        rows, page = [], 0
        while True:
            p = self.request(0x20, [7, *number(page, 2), 4, 0], 0x21)
            cursor = 6
            for _ in range(p[5]):
                handle = integer(p[cursor + 1:cursor + 3])
                id_length = p[cursor + 6]
                object_id = unpack(p[cursor + 7:cursor + 7 + id_length], 16)
                cursor += 7 + id_length
                folder = bytes(p[cursor + 1:cursor + 1 + p[cursor]]).decode()
                cursor += 1 + p[cursor]
                name = bytes(p[cursor + 1:cursor + 1 + p[cursor]]).decode()
                cursor += 1 + p[cursor]
                rows.append(dict(handle=handle, id=object_id, folder=folder, name=name))
            page += 1
            if page >= integer(p[3:5]):
                return rows

    def upload(self, body, flags=3):
        """Stores a .hexsound (flags 2 save, 3 save and play)."""
        crc = zlib.crc32(body)
        transfer = 1
        self.request(0x24, [0x0e, *number(16383, 2), *number(transfer, 2), 1, 0, *number(len(body), 4), *number(crc, 5), *number(96, 2), flags], 6)
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

    def read(self, handle):
        """The sampler sound at a synth preset handle, as a .hexsound."""
        self.transaction = self.transaction % 16000 + 1
        transaction = self.transaction
        self.send(0x22, [0x0e, *number(handle, 2), 0], transaction)
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


def sound_object_id(body):
    """The object id TLV (0x02) of a .hexsound's preset body."""
    if body[:4] != b'HXS1':
        raise RuntimeError('Not a .hexsound file')
    preset = body[6:6 + (body[4] | body[5] << 8)]
    cursor = 8
    while cursor + 3 <= len(preset):
        tag, length = preset[cursor], preset[cursor + 1] | preset[cursor + 2] << 8
        if tag == 0x02:
            return bytes(preset[cursor + 3:cursor + 3 + length])
        cursor += 3 + length
    raise RuntimeError('The sound has no object id')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', default='HexBoard virtual-cable')
    parser.add_argument('--install', type=Path, nargs='*', default=[], help='.hexsound files to store and play')
    parser.add_argument('--save-startup', action='store_true', help='Save current settings into startup profile 1')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    board = Board(args.port)
    report = {'passed': False, 'installed': []}
    try:
        report['before'] = board.status()
        for path in args.install:
            body = path.read_bytes()
            object_id = sound_object_id(body)
            board.upload(body)
            row = next((r for r in board.sounds() if r['id'] == object_id), None)
            if row is None:
                raise RuntimeError(f'Installed sound is not listed: {path}')
            readback = board.read(row['handle'])
            # The board rewrites the preset body; the instrument must match exactly.
            if readback[6 + (readback[4] | readback[5] << 8):] != body[6 + (body[4] | body[5] << 8):]:
                raise RuntimeError(f'Install/readback differs: {path}')
            status = board.status()
            if not status['active']:
                raise RuntimeError(f'The sound did not start playing: {path}')
            report['installed'].append(dict(file=str(path), handle=row['handle'], folder=row['folder'], name=row['name'], bytes=len(body)))
            print(json.dumps(report['installed'][-1]), flush=True)
        if args.save_startup:
            board.sampler(4)
        report['after'] = board.status()
        report['passed'] = True
    finally:
        board.close()
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
