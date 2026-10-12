import { describe, expect, it } from "vitest";
import { chunkChecksum, pack8To7, unpack8To7 } from "./packing.ts";

describe("8-to-7 packing", () => {
  it("packs the HBS1 example", () => {
    const raw = Uint8Array.from([0x48, 0x42, 0x53, 0x31]);
    expect(pack8To7(raw)).toEqual([0x00, 0x48, 0x42, 0x53, 0x31]);
    expect(Array.from(unpack8To7(pack8To7(raw), raw.length))).toEqual(Array.from(raw));
  });

  it("preserves high bits", () => {
    const raw = Uint8Array.from([0x80, 0x4f, 0x12, 0x00]);
    expect(pack8To7(raw)).toEqual([0x01, 0x00, 0x4f, 0x12, 0x00]);
    expect(Array.from(unpack8To7(pack8To7(raw), raw.length))).toEqual(Array.from(raw));
  });

  it("rejects truncated, trailing, and impossible declared lengths", () => {
    const packed = pack8To7(Uint8Array.from([0x80, 1, 2, 3]));
    for (const length of [-1, 0, 3, 5, 16383, 0.5, NaN, Infinity]) {
      expect(() => unpack8To7(packed, length)).toThrow();
    }
    expect(() => unpack8To7([...packed, 0], 4)).toThrow();
    expect(() => unpack8To7(packed.slice(0, -1), 4)).toThrow();
    expect(unpack8To7([], 0)).toEqual(new Uint8Array());
  });

  it("computes the chunk checksum from unpacked bytes", () => {
    expect(chunkChecksum(Uint8Array.from([0x48, 0x42, 0x53, 0x31]))).toBe(0x0e);
  });
});

