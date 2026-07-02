export function assertIntegerRange(value: number, min: number, max: number, name: string): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer in ${min}..${max}`);
  }
}

export function assertSevenBitByte(value: number, name = "byte"): void {
  assertIntegerRange(value, 0, 0x7f, name);
}

export function assertByte(value: number, name = "byte"): void {
  assertIntegerRange(value, 0, 0xff, name);
}

export function assertSevenBitBytes(bytes: ArrayLike<number>, name = "bytes"): void {
  for (let index = 0; index < bytes.length; index += 1) {
    assertSevenBitByte(bytes[index], `${name}[${index}]`);
  }
}

export function encodeU14(value: number): number[] {
  assertIntegerRange(value, 0, 0x3fff, "u14");
  return [(value >> 7) & 0x7f, value & 0x7f];
}

export function decodeU14(bytes: ArrayLike<number>, offset = 0): number {
  assertSevenBitByte(bytes[offset], "u14[0]");
  assertSevenBitByte(bytes[offset + 1], "u14[1]");
  return (bytes[offset] << 7) | bytes[offset + 1];
}

export function encodeU21(value: number): number[] {
  assertIntegerRange(value, 0, 0x1fffff, "u21");
  return [(value >> 14) & 0x7f, (value >> 7) & 0x7f, value & 0x7f];
}

export function decodeU21(bytes: ArrayLike<number>, offset = 0): number {
  for (let index = 0; index < 3; index += 1) {
    assertSevenBitByte(bytes[offset + index], `u21[${index}]`);
  }
  return (bytes[offset] << 14) | (bytes[offset + 1] << 7) | bytes[offset + 2];
}

export function encodeU28(value: number): number[] {
  assertIntegerRange(value, 0, 0x0fffffff, "u28");
  return [
    (value >> 21) & 0x7f,
    (value >> 14) & 0x7f,
    (value >> 7) & 0x7f,
    value & 0x7f
  ];
}

export function decodeU28(bytes: ArrayLike<number>, offset = 0): number {
  for (let index = 0; index < 4; index += 1) {
    assertSevenBitByte(bytes[offset + index], `u28[${index}]`);
  }
  return (
    (bytes[offset] << 21) |
    (bytes[offset + 1] << 14) |
    (bytes[offset + 2] << 7) |
    bytes[offset + 3]
  ) >>> 0;
}

export function encodeU35FromU32(value: number): number[] {
  assertIntegerRange(value, 0, 0xffffffff, "u32");
  return [
    Math.floor(value / 0x10000000) & 0x7f,
    (value >>> 21) & 0x7f,
    (value >>> 14) & 0x7f,
    (value >>> 7) & 0x7f,
    value & 0x7f
  ];
}

export function decodeU35ToU32(bytes: ArrayLike<number>, offset = 0): number {
  for (let index = 0; index < 5; index += 1) {
    assertSevenBitByte(bytes[offset + index], `u35[${index}]`);
  }
  const value =
    bytes[offset] * 0x10000000 +
    bytes[offset + 1] * 0x200000 +
    bytes[offset + 2] * 0x4000 +
    bytes[offset + 3] * 0x80 +
    bytes[offset + 4];
  assertIntegerRange(value, 0, 0xffffffff, "u35/u32");
  return value >>> 0;
}

export function encodeInt16LE(value: number): number[] {
  assertIntegerRange(value, -0x8000, 0x7fff, "i16");
  const unsigned = value < 0 ? value + 0x10000 : value;
  return [unsigned & 0xff, (unsigned >> 8) & 0xff];
}

export function encodeInt32LE(value: number): number[] {
  assertIntegerRange(value, -0x80000000, 0x7fffffff, "i32");
  const unsigned = value >>> 0;
  return [unsigned & 0xff, (unsigned >>> 8) & 0xff, (unsigned >>> 16) & 0xff, (unsigned >>> 24) & 0xff];
}

export function encodeU16LE(value: number): number[] {
  assertIntegerRange(value, 0, 0xffff, "u16");
  return [value & 0xff, (value >> 8) & 0xff];
}

export function encodeU32LE(value: number): number[] {
  assertIntegerRange(value, 0, 0xffffffff, "u32");
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

