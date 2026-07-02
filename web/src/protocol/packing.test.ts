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

  it("computes the chunk checksum from unpacked bytes", () => {
    expect(chunkChecksum(Uint8Array.from([0x48, 0x42, 0x53, 0x31]))).toBe(0x0e);
  });
});

