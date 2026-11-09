import { CommonTlv, decodeObjectBody, textFromBytes } from "../protocol/tlv.ts";

/**
 * `.hexsound`: one sampler sound with its instrument, as the HexBoard stores
 * and transfers it (preset sync object 0x0E).
 *
 *   0  "HXS1"
 *   4  u16 little endian: length n of the synth preset object body
 *   6  n bytes: synth preset object body (the TLVs Sync sends for a sound)
 *   6+n to the end: HBC1 Classic sampler instrument
 */
export const HEXSOUND_EXTENSION = ".hexsound";
const magic = [0x48, 0x58, 0x53, 0x31];
const headerBytes = 6;

export interface HexSound {
  presetBody: Uint8Array;
  instrument: Uint8Array;
}

export function encodeHexSound(presetBody: Uint8Array, instrument: Uint8Array): Uint8Array {
  if (presetBody.length === 0 || presetBody.length > 0xffff) throw new RangeError("Sound settings are too large for a .hexsound file");
  if (instrument.length === 0) throw new RangeError("A .hexsound file needs an instrument");
  const output = new Uint8Array(headerBytes + presetBody.length + instrument.length);
  output.set(magic, 0);
  output[4] = presetBody.length & 0xff;
  output[5] = presetBody.length >> 8;
  output.set(presetBody, headerBytes);
  output.set(instrument, headerBytes + presetBody.length);
  return output;
}

export function decodeHexSound(bytes: Uint8Array): HexSound {
  if (bytes.length < headerBytes || magic.some((value, index) => bytes[index] !== value)) {
    throw new Error("Not a HexBoard sound file");
  }
  const length = bytes[4] | (bytes[5] << 8);
  const instrumentStart = headerBytes + length;
  if (length === 0 || bytes.length <= instrumentStart) throw new Error("The sound file is incomplete");
  const instrument = bytes.slice(instrumentStart);
  if (String.fromCharCode(...instrument.slice(0, 4)) !== "HBC1") throw new Error("The sound file's instrument is not a Classic sampler instrument");
  return { presetBody: bytes.slice(headerBytes, instrumentStart), instrument };
}

/** The sound's name and folder, from its preset body. */
export function hexSoundTitle(presetBody: Uint8Array): { name: string; folderPath: string } {
  const records = decodeObjectBody(presetBody).records;
  const text = (tag: number) => {
    const record = records.find((item) => item.tag === tag);
    return record ? textFromBytes(record.value) : "";
  };
  return { name: text(CommonTlv.Name), folderPath: text(CommonTlv.FolderPath) || "/" };
}
