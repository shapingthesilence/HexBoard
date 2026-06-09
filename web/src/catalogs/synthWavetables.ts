import { ObjectType } from "../protocol/constants.ts";
import {
  createCommonRecords,
  encodeObjectBody,
  tlv,
  tlvU16LE,
  tlvU8,
  type TlvRecord
} from "../protocol/tlv.ts";
import type { EncodedCatalogObject } from "./types.ts";

export const SYNTH_WAVETABLE_FRAME_COUNT = 32;
export const SYNTH_WAVETABLE_SAMPLE_COUNT = 512;
export const SYNTH_WAVETABLE_SAMPLE_BYTES = SYNTH_WAVETABLE_FRAME_COUNT * SYNTH_WAVETABLE_SAMPLE_COUNT;
const SERUM_FRAME_SAMPLE_COUNT = 2048;

export type WavetableFrameReduction = "nearest" | "interpolated";
export type WavetableNormalization = "per-frame" | "whole-table";

export interface SerumWavetableCrunchOptions {
  frameReduction?: WavetableFrameReduction;
  normalization?: WavetableNormalization;
  smooth?: boolean;
  dither?: boolean;
}

export const SynthWavetableTlv = {
  FrameCount: 0x30,
  SampleCount: 0x31,
  Samples: 0x32
} as const;

export interface SynthWavetableInput {
  objectId: Uint8Array;
  name: string;
  folderPath?: string;
  samples: Uint8Array;
  tags?: string[];
}

interface WavFormat {
  audioFormat: number;
  channels: number;
  blockAlign: number;
  bitsPerSample: number;
}

export interface ParsedSerumWavetable {
  samples: Float32Array;
  frameSampleCount: number;
  frameCount: number;
}

interface WavDataChunk {
  view: DataView;
  format: WavFormat;
  dataOffset: number;
  dataLength: number;
}

export function createSynthWavetableObject(input: SynthWavetableInput): EncodedCatalogObject {
  if (input.samples.length !== SYNTH_WAVETABLE_SAMPLE_BYTES) {
    throw new Error(`wavetable sample data must be ${SYNTH_WAVETABLE_SAMPLE_BYTES} bytes`);
  }
  const records: TlvRecord[] = [
    ...createCommonRecords({
      objectId: input.objectId,
      name: input.name,
      source: "web-app",
      folderPath: input.folderPath,
      tags: input.tags
    }),
    tlvU8(SynthWavetableTlv.FrameCount, SYNTH_WAVETABLE_FRAME_COUNT),
    tlvU16LE(SynthWavetableTlv.SampleCount, SYNTH_WAVETABLE_SAMPLE_COUNT),
    tlv(SynthWavetableTlv.Samples, input.samples)
  ];
  const body = encodeObjectBody({
    objectType: ObjectType.SynthWavetable,
    schemaMajor: 1,
    schemaMinor: 0,
    objectFlags: 0,
    records
  });

  return {
    objectType: ObjectType.SynthWavetable,
    schemaMajor: 1,
    schemaMinor: 0,
    objectId: input.objectId,
    name: input.name,
    folderPath: input.folderPath,
    records,
    body
  };
}

export function createSynthWavetableMetadataObject(input: Omit<SynthWavetableInput, "samples">): EncodedCatalogObject {
  const records: TlvRecord[] = [
    ...createCommonRecords({
      objectId: input.objectId,
      name: input.name,
      source: "web-app",
      folderPath: input.folderPath,
      tags: input.tags
    })
  ];
  const body = encodeObjectBody({
    objectType: ObjectType.SynthWavetable,
    schemaMajor: 1,
    schemaMinor: 0,
    objectFlags: 0,
    records
  });

  return {
    objectType: ObjectType.SynthWavetable,
    schemaMajor: 1,
    schemaMinor: 0,
    objectId: input.objectId,
    name: input.name,
    folderPath: input.folderPath,
    records,
    body
  };
}

export function crunchSerumWavetable(bytes: ArrayBuffer | Uint8Array, options: SerumWavetableCrunchOptions = {}): Uint8Array {
  return renderSerumWavetable(parseSerumWavetable(bytes), options);
}

export function parseSerumWavetable(bytes: ArrayBuffer | Uint8Array): ParsedSerumWavetable {
  return parseWavSamples(bytes);
}

export function renderSerumWavetable(wav: ParsedSerumWavetable, options: SerumWavetableCrunchOptions = {}): Uint8Array {
  const frameReduction = options.frameReduction ?? "interpolated";
  const normalization = options.normalization ?? "whole-table";
  const firstFrame = wav.samples.subarray(0, wav.frameSampleCount);
  const phaseOffset = findUpwardZeroCrossing(firstFrame);
  const rendered = new Float32Array(SYNTH_WAVETABLE_SAMPLE_BYTES);

  for (let frame = 0; frame < SYNTH_WAVETABLE_FRAME_COUNT; frame += 1) {
    const framePosition = wav.frameCount <= 1
      ? 0
      : (frame * (wav.frameCount - 1)) / (SYNTH_WAVETABLE_FRAME_COUNT - 1);
    for (let sample = 0; sample < SYNTH_WAVETABLE_SAMPLE_COUNT; sample += 1) {
      const phasePosition = phaseOffset + (sample * wav.frameSampleCount) / SYNTH_WAVETABLE_SAMPLE_COUNT;
      const value = sampleWavetable(wav, framePosition, phasePosition, frameReduction);
      rendered[frame * SYNTH_WAVETABLE_SAMPLE_COUNT + sample] = value;
    }
  }

  if (options.smooth === true) {
    smoothRenderedFrames(rendered);
  }

  const output = new Uint8Array(SYNTH_WAVETABLE_SAMPLE_BYTES);
  if (normalization === "per-frame") {
    for (let frame = 0; frame < SYNTH_WAVETABLE_FRAME_COUNT; frame += 1) {
      const start = frame * SYNTH_WAVETABLE_SAMPLE_COUNT;
      const peak = findPeak(rendered, start, SYNTH_WAVETABLE_SAMPLE_COUNT);
      quantizeRenderedFrame(rendered, output, start, peak, options.dither === true);
    }
    return output;
  }

  const peak = findPeak(rendered, 0, rendered.length);
  if (peak <= 0.000001) {
    output.fill(128);
    return output;
  }
  for (let index = 0; index < rendered.length; index += 1) {
    output[index] = quantizeRenderedSample(rendered[index], peak, options.dither === true, index);
  }
  return output;
}

export function encodeHexBoardWavetableWav(samples: Uint8Array): Uint8Array {
  if (samples.length !== SYNTH_WAVETABLE_SAMPLE_BYTES) {
    throw new Error(`HexBoard wavetable exports must contain ${SYNTH_WAVETABLE_SAMPLE_BYTES} samples`);
  }
  const headerBytes = 44;
  const bytes = new Uint8Array(headerBytes + samples.length);
  const view = new DataView(bytes.buffer);
  writeFourCc(bytes, 0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  writeFourCc(bytes, 8, "WAVE");
  writeFourCc(bytes, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16384, true);
  view.setUint32(28, 16384, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  writeFourCc(bytes, 36, "data");
  view.setUint32(40, samples.length, true);
  bytes.set(samples, headerBytes);
  return bytes;
}

export function parseHexBoardWavetable(bytes: ArrayBuffer | Uint8Array): Uint8Array {
  const wav = readWavDataChunk(bytes);
  if (wav.format.audioFormat !== 1 || wav.format.channels !== 1 || wav.format.bitsPerSample !== 8) {
    throw new Error("HexBoard wavetable files must be 8-bit mono PCM WAV data");
  }
  if (wav.dataLength !== SYNTH_WAVETABLE_SAMPLE_BYTES) {
    throw new Error(`HexBoard wavetable files must contain ${SYNTH_WAVETABLE_SAMPLE_BYTES} samples`);
  }
  return new Uint8Array(wav.view.buffer, wav.view.byteOffset + wav.dataOffset, wav.dataLength).slice();
}

function parseWavSamples(bytes: ArrayBuffer | Uint8Array): ParsedSerumWavetable {
  const wav = readWavDataChunk(bytes);
  const samples = decodeWavData(wav.view, wav.dataOffset, wav.dataLength, wav.format);
  const frameSampleCount = samples.length >= SERUM_FRAME_SAMPLE_COUNT && samples.length % SERUM_FRAME_SAMPLE_COUNT === 0
    ? SERUM_FRAME_SAMPLE_COUNT
    : samples.length;
  const frameCount = Math.max(1, Math.floor(samples.length / frameSampleCount));
  return { samples, frameSampleCount, frameCount };
}

function readWavDataChunk(bytes: ArrayBuffer | Uint8Array): WavDataChunk {
  const view = bytes instanceof Uint8Array
    ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new DataView(bytes);
  if (view.byteLength < 12 || readFourCc(view, 0) !== "RIFF" || readFourCc(view, 8) !== "WAVE") {
    throw new Error("Expected a RIFF/WAVE file");
  }

  let format: WavFormat | null = null;
  let dataOffset = -1;
  let dataLength = 0;
  for (let cursor = 12; cursor + 8 <= view.byteLength;) {
    const chunkId = readFourCc(view, cursor);
    const chunkLength = view.getUint32(cursor + 4, true);
    const chunkOffset = cursor + 8;
    if (chunkOffset + chunkLength > view.byteLength) {
      throw new Error("WAV chunk length exceeds file size");
    }
    if (chunkId === "fmt ") {
      format = parseWavFormat(view, chunkOffset, chunkLength);
    } else if (chunkId === "data") {
      dataOffset = chunkOffset;
      dataLength = chunkLength;
    }
    cursor = chunkOffset + chunkLength + (chunkLength & 1);
  }

  if (!format || dataOffset < 0) {
    throw new Error("WAV file is missing fmt or data chunk");
  }
  return { view, format, dataOffset, dataLength };
}

function parseWavFormat(view: DataView, offset: number, length: number): WavFormat {
  if (length < 16) {
    throw new Error("WAV fmt chunk is too short");
  }
  let audioFormat = view.getUint16(offset, true);
  const channels = view.getUint16(offset + 2, true);
  const blockAlign = view.getUint16(offset + 12, true);
  const bitsPerSample = view.getUint16(offset + 14, true);
  if (audioFormat === 0xfffe && length >= 40) {
    audioFormat = view.getUint16(offset + 24, true);
  }
  if (channels < 1 || blockAlign < 1) {
    throw new Error("WAV fmt chunk has invalid channel layout");
  }
  return { audioFormat, channels, blockAlign, bitsPerSample };
}

function decodeWavData(view: DataView, offset: number, length: number, format: WavFormat): Float32Array {
  if (length % format.blockAlign !== 0) {
    throw new Error("WAV data length is not aligned to sample frames");
  }
  const sampleFrames = length / format.blockAlign;
  const output = new Float32Array(sampleFrames);
  for (let frame = 0; frame < sampleFrames; frame += 1) {
    let sum = 0;
    const frameOffset = offset + frame * format.blockAlign;
    for (let channel = 0; channel < format.channels; channel += 1) {
      sum += decodeWavSample(view, frameOffset + channel * (format.bitsPerSample / 8), format);
    }
    output[frame] = sum / format.channels;
  }
  return output;
}

function decodeWavSample(view: DataView, offset: number, format: WavFormat): number {
  if (format.audioFormat === 3 && format.bitsPerSample === 32) {
    return view.getFloat32(offset, true);
  }
  if (format.audioFormat !== 1) {
    throw new Error(`Unsupported WAV format ${format.audioFormat}`);
  }
  switch (format.bitsPerSample) {
    case 8:
      return (view.getUint8(offset) - 128) / 128;
    case 16:
      return view.getInt16(offset, true) / 32768;
    case 24: {
      const value = view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16);
      const signed = value & 0x800000 ? value | 0xff000000 : value;
      return signed / 8388608;
    }
    case 32:
      return view.getInt32(offset, true) / 2147483648;
    default:
      throw new Error(`Unsupported PCM bit depth ${format.bitsPerSample}`);
  }
}

function sampleWavetable(wav: ParsedSerumWavetable, framePosition: number, phasePosition: number, frameReduction: WavetableFrameReduction): number {
  if (frameReduction === "nearest") {
    return sampleFrame(wav, Math.round(framePosition), phasePosition);
  }
  const frameA = Math.floor(framePosition);
  const frameB = Math.min(frameA + 1, wav.frameCount - 1);
  const frameFrac = framePosition - frameA;
  const sampleA = sampleFrame(wav, frameA, phasePosition);
  const sampleB = sampleFrame(wav, frameB, phasePosition);
  return sampleA + (sampleB - sampleA) * frameFrac;
}

function sampleFrame(wav: ParsedSerumWavetable, frame: number, phasePosition: number): number {
  const wrapped = positiveModulo(phasePosition, wav.frameSampleCount);
  const left = Math.floor(wrapped);
  const frac = wrapped - left;
  const base = frame * wav.frameSampleCount;
  const sampleA = wav.samples[base + left] ?? 0;
  const sampleB = wav.samples[base + ((left + 1) % wav.frameSampleCount)] ?? 0;
  return sampleA + (sampleB - sampleA) * frac;
}

function smoothRenderedFrames(rendered: Float32Array): void {
  const scratch = new Float32Array(SYNTH_WAVETABLE_SAMPLE_COUNT);
  for (let frame = 0; frame < SYNTH_WAVETABLE_FRAME_COUNT; frame += 1) {
    const start = frame * SYNTH_WAVETABLE_SAMPLE_COUNT;
    for (let pass = 0; pass < 2; pass += 1) {
      scratch.set(rendered.subarray(start, start + SYNTH_WAVETABLE_SAMPLE_COUNT));
      for (let sample = 0; sample < SYNTH_WAVETABLE_SAMPLE_COUNT; sample += 1) {
        const left2 = scratch[(sample + SYNTH_WAVETABLE_SAMPLE_COUNT - 2) % SYNTH_WAVETABLE_SAMPLE_COUNT];
        const left1 = scratch[(sample + SYNTH_WAVETABLE_SAMPLE_COUNT - 1) % SYNTH_WAVETABLE_SAMPLE_COUNT];
        const center = scratch[sample];
        const right1 = scratch[(sample + 1) % SYNTH_WAVETABLE_SAMPLE_COUNT];
        const right2 = scratch[(sample + 2) % SYNTH_WAVETABLE_SAMPLE_COUNT];
        rendered[start + sample] = left2 * 0.12 + left1 * 0.22 + center * 0.32 + right1 * 0.22 + right2 * 0.12;
      }
    }
  }
}

function findPeak(samples: Float32Array, start: number, length: number): number {
  let peak = 0;
  for (let index = start; index < start + length; index += 1) {
    peak = Math.max(peak, Math.abs(samples[index]));
  }
  return peak;
}

function quantizeRenderedFrame(rendered: Float32Array, output: Uint8Array, start: number, peak: number, dither: boolean): void {
  if (peak <= 0.000001) {
    output.fill(128, start, start + SYNTH_WAVETABLE_SAMPLE_COUNT);
    return;
  }
  for (let index = start; index < start + SYNTH_WAVETABLE_SAMPLE_COUNT; index += 1) {
    output[index] = quantizeRenderedSample(rendered[index], peak, dither, index);
  }
}

function quantizeRenderedSample(value: number, peak: number, dither: boolean, index: number): number {
  const noise = dither ? deterministicTriangularDither(index) : 0;
  return clampByte(Math.round(128 + (127 * value) / peak + noise));
}

function deterministicTriangularDither(index: number): number {
  return (hashUnit(index) + hashUnit(index ^ 0x9e3779b9) - 1) * 0.5;
}

function hashUnit(index: number): number {
  let value = index | 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0xffffffff;
}

function findUpwardZeroCrossing(samples: Float32Array): number {
  for (let index = 0; index < samples.length; index += 1) {
    const left = samples[index];
    const right = samples[(index + 1) % samples.length];
    if (left <= 0 && right > 0) {
      return index + (right === left ? 0 : -left / (right - left));
    }
  }
  return 0;
}

function readFourCc(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3)
  );
}

function writeFourCc(bytes: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    bytes[offset + index] = value.charCodeAt(index);
  }
}

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function clampByte(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 255) {
    return 255;
  }
  return value;
}
