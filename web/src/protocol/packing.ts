import { assertByte, assertSevenBitByte } from "./numbers.ts";

export function pack8To7(raw: Uint8Array): number[] {
  const packed: number[] = [];

  for (let offset = 0; offset < raw.length; offset += 7) {
    const count = Math.min(7, raw.length - offset);
    let prefix = 0;
    const lows: number[] = [];

    for (let index = 0; index < count; index += 1) {
      const byte = raw[offset + index];
      assertByte(byte, `raw[${offset + index}]`);
      if ((byte & 0x80) !== 0) {
        prefix |= 1 << index;
      }
      lows.push(byte & 0x7f);
    }

    packed.push(prefix, ...lows);
  }

  return packed;
}

export function unpack8To7(packed: ArrayLike<number>, rawLength?: number): Uint8Array {
  const raw: number[] = [];
  let offset = 0;

  while (offset < packed.length && (rawLength === undefined || raw.length < rawLength)) {
    const prefix = packed[offset++];
    assertSevenBitByte(prefix, "packed prefix");
    const remainingRaw = rawLength === undefined ? 7 : rawLength - raw.length;
    const bytesInGroup = Math.min(7, remainingRaw, packed.length - offset);

    for (let index = 0; index < bytesInGroup; index += 1) {
      const low = packed[offset++];
      assertSevenBitByte(low, `packed byte ${offset - 1}`);
      raw.push(low | (((prefix >> index) & 1) << 7));
    }
  }

  if (rawLength !== undefined && raw.length !== rawLength) {
    throw new Error(`packed data produced ${raw.length} bytes, expected ${rawLength}`);
  }

  return new Uint8Array(raw);
}

export function chunkChecksum(raw: Uint8Array): number {
  let sum = 0;
  for (const byte of raw) {
    sum = (sum + byte) & 0x7f;
  }
  return sum;
}

