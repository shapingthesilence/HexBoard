import { describe, expect, it } from "vitest";
import { ObjectType } from "../protocol/constants.ts";
import { CommonTlv, decodeObjectBody, textFromBytes } from "../protocol/tlv.ts";
import { crc32 } from "../protocol/crc32.ts";
import {
  ButtonMapField,
  ButtonMapRecordFormat,
  ColorMode,
  createExplicitButtonMap,
  createCentsTableTuning,
  createDefaultTuningBundle,
  createEqualStepTuning,
  createFactorySynthWavetables,
  createGeneratedEdoTuning,
  createScaleColorMap,
  createSynthPresetObject,
  createSynthWavetableObject,
  createSynthWavetableMetadataObject,
  createUserScale,
  createVectorLayout,
  crunchSerumWavetable,
  currentFirmwareDownLeftToUpRight,
  defaultKeyLabels,
  deterministicObjectId,
  encodeHexBoardWavetableWav,
  encodeGeometryCatalogOrder,
  encodeTuningBundle,
  ExplicitButtonMapTlv,
  GenericScaleColorMapName,
  GeometryLayoutScaleMaxCount,
  keyLabelsForTlvOrder,
  keyLabelsFromScalaIntervalLabels,
  LayoutTlv,
  objectIdToHex,
  parseHexBoardWavetable,
  parseTuningBundleLibrary,
  parseTuningBundleFile,
  parseScalaScale,
  renderInterpolatedAnchorWavetable,
  resolveTuningBundleButtonColor,
  ScaleColorMapTlv,
  serializeTuningBundle,
  SYNTH_WAVETABLE_FRAME_COUNT,
  SYNTH_WAVETABLE_MIP_LEVEL_COUNT,
  SYNTH_WAVETABLE_MIP_SAMPLE_BYTES,
  SYNTH_WAVETABLE_SAMPLE_BYTES,
  SYNTH_WAVETABLE_SAMPLE_COUNT,
  SynthWavetableTlv,
  TuningTlv,
  UserScaleTlv,
  UserTuningKind
} from "./index.ts";

function recordValue(body: Uint8Array, tag: number): Uint8Array {
  return decodeObjectBody(body).records.find((record) => record.tag === tag)?.value ?? new Uint8Array();
}

function recordValuesLength(body: Uint8Array, tag: number): number {
  return decodeObjectBody(body).records
    .filter((record) => record.tag === tag)
    .reduce((total, record) => total + record.value.length, 0);
}

function u8(value: Uint8Array): number {
  return value[0];
}

function u16LE(value: Uint8Array): number {
  return value[0] | (value[1] << 8);
}

function u32LE(value: Uint8Array): number {
  return value[0] | (value[1] << 8) | (value[2] << 16) | (value[3] << 24);
}

function i32LE(value: Uint8Array): number {
  return new DataView(value.buffer, value.byteOffset, 4).getInt32(0, true);
}

function float32LE(value: Uint8Array, offset = 0): number {
  return new DataView(value.buffer, value.byteOffset + offset, 4).getFloat32(0, true);
}

function i16LE(value: Uint8Array): number {
  const unsigned = u16LE(value);
  return unsigned >= 0x8000 ? unsigned - 0x10000 : unsigned;
}

function keyLabels(value: Uint8Array): string[] {
  const labels: string[] = [];
  const decoder = new TextDecoder();
  for (let index = 0; index < value.length;) {
    const length = value[index];
    index += 1;
    labels.push(decoder.decode(value.slice(index, index + length)));
    index += length;
  }
  return labels;
}

function createFloatWav(samples: Float32Array): Uint8Array {
  const headerBytes = 44;
  const dataBytes = samples.length * 4;
  const bytes = new Uint8Array(headerBytes + dataBytes);
  const view = new DataView(bytes.buffer);
  writeFourCc(bytes, 0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  writeFourCc(bytes, 8, "WAVE");
  writeFourCc(bytes, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 44100, true);
  view.setUint32(28, 44100 * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 32, true);
  writeFourCc(bytes, 36, "data");
  view.setUint32(40, dataBytes, true);
  for (let index = 0; index < samples.length; index += 1) {
    view.setFloat32(headerBytes + index * 4, samples[index], true);
  }
  return bytes;
}

function createPcm8Wav(samples: Uint8Array): Uint8Array {
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
  view.setUint32(24, 44100, true);
  view.setUint32(28, 44100, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  writeFourCc(bytes, 36, "data");
  view.setUint32(40, samples.length, true);
  bytes.set(samples, headerBytes);
  return bytes;
}

function writeFourCc(bytes: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    bytes[offset + index] = value.charCodeAt(index);
  }
}

describe("catalog object encoding", () => {
  const tuningId = deterministicObjectId("test tuning");
  const layoutId = deterministicObjectId("test layout");

  it("round trips a generated EDO tuning", () => {
    const tuning = createGeneratedEdoTuning({
      objectId: tuningId,
      name: "17 EDO",
      edoDivisions: 17
    });
    const decoded = decodeObjectBody(tuning.body);
    expect(decoded.objectType).toBe(ObjectType.UserTuning);
    expect(textFromBytes(decoded.records.find((record) => record.tag === CommonTlv.Name)?.value ?? new Uint8Array())).toBe("17 EDO");
    expect(defaultKeyLabels(17).slice(0, 4)).toEqual(["A", "Bb", "A#", "B"]);
    expect(keyLabels(recordValue(tuning.body, TuningTlv.KeyLabels))).toEqual([
      "C", "Db", "C#", "D", "Eb", "D#", "E", "F", "Gb", "F#", "G", "Ab", "G#", "A", "Bb", "A#", "B"
    ]);
  });

  it("round trips a vector layout", () => {
    const layout = createVectorLayout({
      objectId: layoutId,
      name: "Wicki 17",
      tuningRef: { objectType: ObjectType.UserTuning, handle: 0, objectId: tuningId },
      centerButton: 65,
      centerStepsFromC: -19,
      acrossSteps: 3,
      upRightSteps: 7,
      deviceRotationSteps: 0
    });
    expect(decodeObjectBody(layout.body).objectType).toBe(ObjectType.UserLayout);
    expect(i16LE(recordValue(layout.body, LayoutTlv.DownLeftSteps))).toBe(-7);
    expect(i32LE(recordValue(layout.body, LayoutTlv.CenterStepsFromC))).toBe(-19);
    expect(currentFirmwareDownLeftToUpRight(3, -11)).toBe(11);
  });

  it("round trips an equal-step tuning", () => {
    const tuning = createEqualStepTuning({
      objectId: tuningId,
      name: "80 cent steps",
      stepCents: 80,
      cycleLength: 15
    });
    expect(u8(recordValue(tuning.body, TuningTlv.TuningKind))).toBe(UserTuningKind.EqualStep);
    expect(u16LE(recordValue(tuning.body, TuningTlv.EdoDivisions))).toBe(15);
  });

  it("preserves firmware-native tuning precision without duplicate fixed-point fields", () => {
    const periodCents = 1200.0001220703125;
    const stepCents = 16.66666603088379;
    const referenceHz = 440.00006103515625;
    const edo = createGeneratedEdoTuning({
      objectId: tuningId,
      name: "Precise EDO",
      edoDivisions: 72,
      periodCents,
      referenceHz
    });
    expect(float32LE(recordValue(edo.body, TuningTlv.PeriodCentsFloat32))).toBe(Math.fround(periodCents));

    const equalStep = createEqualStepTuning({
      objectId: tuningId,
      name: "Precise steps",
      stepCents,
      cycleLength: 72,
      referenceHz
    });

    expect(float32LE(recordValue(equalStep.body, TuningTlv.StepCentsFloat32))).toBe(Math.fround(stepCents));
    expect(float32LE(recordValue(equalStep.body, TuningTlv.ReferenceHzFloat32))).toBe(Math.fround(referenceHz));

    const cents = [100.00000762939453, 701.9550170898438, 1200];
    const scala = createCentsTableTuning({
      objectId: tuningId,
      name: "Precise Scala",
      cents,
      referenceHz
    });
    const preciseTable = recordValue(scala.body, TuningTlv.CentsTableFloat32);
    expect(float32LE(preciseTable, 0)).toBe(Math.fround(cents[0]));
    expect(float32LE(preciseTable, 4)).toBe(Math.fround(cents[1]));
    expect(float32LE(preciseTable, 4)).not.toBe(701.955);
  });

  it("parses Scala scl files with cents and ratios", () => {
    const parsed = parseScalaScale(`
! example.scl
Example scale
3
100.0 C#
3/2 G
2/1 C
`);
    expect(parsed.description).toBe("Example scale");
    expect(parsed.count).toBe(3);
    expect(parsed.cents[0]).toBeCloseTo(100);
    expect(parsed.cents[1]).toBeCloseTo(701.955, 3);
    expect(parsed.intervalLabels).toEqual(["C#", "G", "C"]);
    expect(keyLabelsForTlvOrder(keyLabelsFromScalaIntervalLabels(parsed.count, parsed.intervalLabels, 60), parsed.count)).toEqual(["C", "C#", "G"]);
    expect(parsed.periodCents).toBeCloseTo(1200);
  });

  it("rejects Scala tunings above the 128-division runtime limit", () => {
    const intervals = Array.from({ length: 129 }, (_, index) => `${index + 1}.0`).join("\n");
    expect(() => parseScalaScale(`Too large\n129\n${intervals}`)).toThrow(/128-division limit/);
  });

  it("round trips scales, scale colors, and explicit button maps", () => {
    const scale = createUserScale({
      objectId: deterministicObjectId("scale"),
      name: "Diatonic",
      tuningRef: { objectType: ObjectType.UserTuning, handle: 0, objectId: tuningId },
      cycleLength: 19,
      includedDegrees: [0, 3, 6, 8, 11, 14, 17]
    });
    const colors = createScaleColorMap({
      objectId: deterministicObjectId("colors"),
      name: "Degrees",
      cycleLength: 17,
      defaultColorMode: ColorMode.Custom,
      degreeColors: [{ degree: 0, hueTenthDegrees: 0, saturation: 255, value: 220 }]
    });
    const map = createExplicitButtonMap({
      objectId: deterministicObjectId("map"),
      name: "One button",
      tuningRef: { objectType: ObjectType.UserTuning, handle: 0, objectId: tuningId },
      records: [
        {
          buttonIndex: 64,
          role: 1,
          stepsFromC: 0,
          midiNote: 60,
          colorMode: 1,
          hueTenthDegrees: 0,
          saturation: 255,
          value: 220
        }
      ]
    });
    expect(decodeObjectBody(scale.body).objectType).toBe(ObjectType.UserScale);
    expect(u16LE(recordValue(scale.body, UserScaleTlv.CycleLength))).toBe(19);
    expect(decodeObjectBody(colors.body).objectType).toBe(ObjectType.ScaleColorMap);
    expect(decodeObjectBody(map.body).objectType).toBe(ObjectType.ExplicitButtonMap);
  });

  it("round trips a named synth preset with a folder path", () => {
    const preset = createSynthPresetObject({
      objectId: deterministicObjectId("pad"),
      name: "Soft String Pad",
      folderPath: "Pads/Warm",
      favorite: true,
      values: {
        PlaybackMode: 3,
        Waveform: 6,
        SynthDrive: 0
      }
    });
    const decoded = decodeObjectBody(preset.body);
    expect(decoded.objectType).toBe(ObjectType.SynthPreset);
    expect(textFromBytes(decoded.records.find((record) => record.tag === CommonTlv.FolderPath)?.value ?? new Uint8Array())).toBe("Pads/Warm");
  });

  it("crunches and encodes a Serum-style float wavetable", () => {
    const source = new Float32Array(2048);
    for (let index = 0; index < source.length; index += 1) {
      source[index] = Math.sin((2 * Math.PI * index) / source.length);
    }
    const samples = crunchSerumWavetable(createFloatWav(source));
    const wavetable = createSynthWavetableObject({
      objectId: deterministicObjectId("serum test"),
      name: "Serum Test",
      folderPath: "Wavetables",
      samples
    });
    const decoded = decodeObjectBody(wavetable.body);

    expect(samples).toHaveLength(SYNTH_WAVETABLE_MIP_SAMPLE_BYTES);
    expect(decoded.objectType).toBe(ObjectType.SynthWavetable);
    expect(decoded.schemaMinor).toBe(2);
    expect(u8(recordValue(wavetable.body, SynthWavetableTlv.FrameCount))).toBe(SYNTH_WAVETABLE_FRAME_COUNT);
    expect(u16LE(recordValue(wavetable.body, SynthWavetableTlv.SampleCount))).toBe(512);
    expect(u8(recordValue(wavetable.body, SynthWavetableTlv.MipLevels))).toBe(SYNTH_WAVETABLE_MIP_LEVEL_COUNT);
    expect(recordValuesLength(wavetable.body, SynthWavetableTlv.Samples)).toBe(SYNTH_WAVETABLE_MIP_SAMPLE_BYTES);
  });

  it("applies wavetable import crunch options deterministically", () => {
    const source = new Float32Array(2048 * 4);
    for (let index = 0; index < source.length; index += 1) {
      const frame = Math.floor(index / 2048);
      source[index] = Math.sin((2 * Math.PI * index) / 2048) * (0.25 + frame * 0.18);
    }
    const wav = createFloatWav(source);
    const samples = crunchSerumWavetable(wav, {
      frameReduction: "nearest",
      normalization: "per-frame",
      smooth: true,
      dither: true
    });
    const repeated = crunchSerumWavetable(wav, {
      frameReduction: "nearest",
      normalization: "per-frame",
      smooth: true,
      dither: true
    });

    expect(samples).toHaveLength(SYNTH_WAVETABLE_MIP_SAMPLE_BYTES);
    expect(repeated).toEqual(samples);
  });

  it("renders factory wavetables with fixed mips", () => {
    const low = new Uint8Array(SYNTH_WAVETABLE_SAMPLE_COUNT);
    const high = new Uint8Array(SYNTH_WAVETABLE_SAMPLE_COUNT);
    high.fill(255);
    const rendered = renderInterpolatedAnchorWavetable([low, high]);
    const base = rendered.slice(0, SYNTH_WAVETABLE_SAMPLE_BYTES);

    expect(rendered).toHaveLength(SYNTH_WAVETABLE_MIP_SAMPLE_BYTES);
    expect(base[0]).toBe(0);
    expect(base[SYNTH_WAVETABLE_SAMPLE_BYTES - SYNTH_WAVETABLE_SAMPLE_COUNT]).toBe(255);
    expect(base[SYNTH_WAVETABLE_SAMPLE_COUNT]).toBeGreaterThan(0);
    expect(base[SYNTH_WAVETABLE_SAMPLE_COUNT]).toBeLessThan(255);

    const factory = createFactorySynthWavetables();
    expect(factory.map((wavetable) => wavetable.name)).toEqual([
      "Classic",
      "Vowels",
      "HarshDigitalBois",
      "RustyBlade",
      "RoundThe808",
      "GlassyBells"
    ]);
    expect(factory.every((wavetable) => wavetable.folderPath === "/")).toBe(true);
    expect(factory.every((wavetable) => wavetable.samples.length === SYNTH_WAVETABLE_MIP_SAMPLE_BYTES)).toBe(true);
  });

  it("encodes wavetable metadata without sample data", () => {
    const wavetable = createSynthWavetableMetadataObject({
      objectId: deterministicObjectId("wavetable metadata"),
      name: "Vowels",
      folderPath: "Voice"
    });
    const decoded = decodeObjectBody(wavetable.body);

    expect(decoded.objectType).toBe(ObjectType.SynthWavetable);
    expect(textFromBytes(decoded.records.find((record) => record.tag === CommonTlv.Name)?.value ?? new Uint8Array())).toBe("Vowels");
    expect(recordValue(wavetable.body, SynthWavetableTlv.Samples)).toHaveLength(0);
  });

  it("round trips HexBoard wavetable exports as hexwav WAV files", () => {
    const samples = new Uint8Array(SYNTH_WAVETABLE_SAMPLE_BYTES);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = index & 0xff;
    }
    const wav = encodeHexBoardWavetableWav(samples);
    const parsed = parseHexBoardWavetable(wav);

    expect(String.fromCharCode(...wav.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe("WAVE");
    expect(parsed).toHaveLength(SYNTH_WAVETABLE_MIP_SAMPLE_BYTES);
    expect(parsed.slice(0, SYNTH_WAVETABLE_SAMPLE_BYTES)).toEqual(samples);
  });

  it("interpolates short HexBoard wavetable imports to sixteen frames", () => {
    const samples = new Uint8Array(SYNTH_WAVETABLE_SAMPLE_COUNT * 4);
    for (let frame = 0; frame < 4; frame += 1) {
      samples.fill(frame * 80, frame * SYNTH_WAVETABLE_SAMPLE_COUNT, (frame + 1) * SYNTH_WAVETABLE_SAMPLE_COUNT);
    }
    const parsed = parseHexBoardWavetable(createPcm8Wav(samples));
    const base = parsed.slice(0, SYNTH_WAVETABLE_SAMPLE_BYTES);

    expect(parsed).toHaveLength(SYNTH_WAVETABLE_MIP_SAMPLE_BYTES);
    expect(base.slice(0, SYNTH_WAVETABLE_SAMPLE_COUNT).every((sample) => sample === 0)).toBe(true);
    expect(base.slice(15 * SYNTH_WAVETABLE_SAMPLE_COUNT, 16 * SYNTH_WAVETABLE_SAMPLE_COUNT).every((sample) => sample === 240)).toBe(true);
    expect(base[SYNTH_WAVETABLE_SAMPLE_COUNT]).toBeGreaterThan(0);
    expect(base[SYNTH_WAVETABLE_SAMPLE_COUNT]).toBeLessThan(80);
  });

  it("serializes and encodes a tuning bundle", () => {
    const bundle = {
      ...createDefaultTuningBundle(),
      folderPath: "Microtonal"
    };
    const serialized = JSON.parse(serializeTuningBundle(bundle));
    expect(serialized).toMatchObject({
      format: "hexboard.tuningBundle.v1",
      tuningBundle: { tuning: { name: bundle.tuning.name } }
    });
    expect("name" in serialized.tuningBundle).toBe(false);
    const parsed = parseTuningBundleFile(serialized);
    const encoded = encodeTuningBundle(parsed);
    expect(parsed.tuning.name).toBe(bundle.tuning.name);
    expect(parsed.folderPath).toBe("Microtonal");
    expect(encoded.objects.map((object) => object.objectType)).toEqual([
      ObjectType.UserTuning,
      ObjectType.UserLayout,
      ObjectType.UserScale,
      ObjectType.ScaleColorMap
    ]);
    expect(encoded.objects.map((object) => textFromBytes(recordValue(object.body, CommonTlv.FolderPath)))).toEqual([
      "Microtonal",
      "Microtonal",
      "Microtonal",
      "Microtonal"
    ]);
    expect(textFromBytes(recordValue(encoded.scaleColorMap.body, CommonTlv.Name))).toBe(GenericScaleColorMapName);
    expect(textFromBytes(recordValue(encoded.tuning.body, CommonTlv.Name))).toBe(bundle.tuning.name);
    expect(u8(recordValue(encoded.scaleColorMap.body, ScaleColorMapTlv.DefaultColorMode))).toBe(ColorMode.Custom);
    expect(new TextDecoder().decode(encoded.bundleFile.slice(0, 3))).toBe("HGB");
    expect(encoded.bundleFile[3]).toBe(3);
    expect(u16LE(encoded.bundleFile.slice(4, 6))).toBe(encoded.objects.length);
    expect(u16LE(encoded.bundleFile.slice(6, 8))).toBe(0xffff);
    expect(u32LE(encoded.bundleFile.slice(8, 12)) >>> 0).toBe(crc32(encoded.bundleFile.slice(12)) >>> 0);

    const ordered = encodeTuningBundle({ ...parsed, catalogOrder: 7 });
    expect(u16LE(ordered.bundleFile.slice(6, 8))).toBe(7);
  });

  it("imports a legacy layout bundle using its device-facing bundle name", () => {
    const bundle = createDefaultTuningBundle();
    const parsed = parseTuningBundleFile({
      format: "hexboard.layoutBundle.v5",
      bundle: {
        ...bundle,
        name: "Legacy Device Name",
        tuning: { ...bundle.tuning, name: "Legacy Tuning Name" }
      }
    });

    expect(parsed.tuning.name).toBe("Legacy Device Name");
    expect("name" in parsed).toBe(false);
  });

  it("encodes a compact checksummed geometry order file", () => {
    const ids = [deterministicObjectId("first geometry"), deterministicObjectId("second geometry")];
    const encoded = encodeGeometryCatalogOrder(ids);
    expect(new TextDecoder().decode(encoded.slice(0, 3))).toBe("HGO");
    expect(encoded[3]).toBe(1);
    expect(encoded[4]).toBe(2);
    expect(u32LE(encoded.slice(8, 12)) >>> 0).toBe(crc32(encoded.slice(12)) >>> 0);
    expect(encoded.slice(12)).toEqual(new Uint8Array([...ids[0], ...ids[1]]));
  });

  it("accepts up to 32 layouts and scales per tuning", () => {
    const base = createDefaultTuningBundle();
    const layouts = Array.from({ length: GeometryLayoutScaleMaxCount }, (_, index) => ({
      ...base.layouts[0],
      objectIdHex: objectIdToHex(deterministicObjectId(`limit-layout-${index}`)),
      name: `Layout ${index + 1}`
    }));
    const scales = Array.from({ length: GeometryLayoutScaleMaxCount }, (_, index) => ({
      ...base.scales[0],
      objectIdHex: objectIdToHex(deterministicObjectId(`limit-scale-${index}`)),
      name: `Scale ${index + 1}`
    }));
    const atLimit = {
      ...base,
      layouts,
      activeLayoutIdHex: layouts[0].objectIdHex,
      scales,
      activeScaleIdHex: scales[0].objectIdHex
    };

    expect(encodeTuningBundle(atLimit).layouts).toHaveLength(GeometryLayoutScaleMaxCount);
    expect(encodeTuningBundle(atLimit).scales).toHaveLength(GeometryLayoutScaleMaxCount);
    expect(() => encodeTuningBundle({
      ...atLimit,
      layouts: [...layouts, { ...layouts[0], objectIdHex: objectIdToHex(deterministicObjectId("layout-over-limit")) }]
    })).toThrow(/1 through 32 layouts/);
    expect(() => encodeTuningBundle({
      ...atLimit,
      scales: [...scales, { ...scales[0], objectIdHex: objectIdToHex(deterministicObjectId("scale-over-limit")) }]
    })).toThrow(/1 through 32 scales/);
  });

  it("preserves device tuning and color object ids when re-saving a downloaded bundle", () => {
    const tuningObjectIdHex = "00112233445566778899aabbccddeeff";
    const colorObjectIdHex = "ffeeddccbbaa99887766554433221100";
    const parsed = parseTuningBundleFile(JSON.parse(serializeTuningBundle({
      ...createDefaultTuningBundle(),
      tuningObjectIdHex,
      colorObjectIdHex
    })));
    const encoded = encodeTuningBundle(parsed);

    expect(objectIdToHex(encoded.tuning.objectId)).toBe(tuningObjectIdHex);
    expect(objectIdToHex(encoded.scaleColorMap.objectId)).toBe(colorObjectIdHex);
  });

  it("persists and encodes a bundle's default color mode", () => {
    const bundle = createDefaultTuningBundle();
    bundle.palette.defaultColorMode = ColorMode.Rainbow;
    const parsed = parseTuningBundleFile(JSON.parse(serializeTuningBundle(bundle)));
    const encoded = encodeTuningBundle(parsed);

    expect(parsed.palette.defaultColorMode).toBe(ColorMode.Rainbow);
    expect(u8(recordValue(encoded.scaleColorMap.body, ScaleColorMapTlv.DefaultColorMode))).toBe(ColorMode.Rainbow);
  });

  it("derives equal-step period metadata from step cents and cycle length", () => {
    const base = createDefaultTuningBundle();
    const serialized = JSON.parse(serializeTuningBundle({
      ...base,
      tuning: {
        kind: "equal-step",
        name: "80 cent steps",
        stepCents: 80,
        cycleLength: 15,
        referenceMidiNote: 69,
        referenceHz: 440,
        keyLabels: Array.from({ length: 15 }, (_, degree) => String(degree))
      }
    }));
    const parsed = parseTuningBundleFile(serialized);
    const encoded = encodeTuningBundle(parsed);

    expect("periodCents" in parsed.tuning).toBe(false);
    expect(float32LE(recordValue(encoded.tuning.body, TuningTlv.StepCentsFloat32))).toBe(80);
  });

  it("derives Scala period and cycle metadata from the cents table", () => {
    const base = createDefaultTuningBundle();
    const serialized = JSON.parse(serializeTuningBundle({
      ...base,
      tuning: {
        kind: "scala",
        name: "Imported Scala",
        description: "Imported Scala",
        cents: [100, 300, 702],
        periodCents: 702,
        cycleLength: 3,
        referenceMidiNote: 69,
        referenceHz: 440,
        keyLabels: ["A", "A+1", "A+2"]
      }
    }));

    const parsed = parseTuningBundleFile(serialized);
    const encoded = encodeTuningBundle(parsed);

    expect(parsed.tuning).toMatchObject({
      kind: "scala",
      periodCents: 702,
      cycleLength: 3
    });
    expect(u16LE(recordValue(encoded.tuning.body, TuningTlv.EdoDivisions))).toBe(3);
    expect(float32LE(recordValue(encoded.tuning.body, TuningTlv.CentsTableFloat32), 8)).toBe(702);
  });

  it("encodes device rotation separately from musical layout transforms", () => {
    const base = createDefaultTuningBundle();
    const bundle = {
      ...base,
      layouts: base.layouts.map((layout, index) => index === 0 ? {
        ...layout,
        deviceRotationSteps: 2,
        layoutRotationSteps: 3,
        mirrorLeftRight: true,
        mirrorUpDown: false
      } : layout)
    };
    const encoded = encodeTuningBundle(bundle);
    expect(u8(recordValue(encoded.layouts[0].body, LayoutTlv.DeviceRotation))).toBe(2);
    expect(u8(recordValue(encoded.layouts[0].body, LayoutTlv.LayoutRotation))).toBe(3);
    expect(u8(recordValue(encoded.layouts[0].body, LayoutTlv.MirrorFlags))).toBe(1);
  });

  it("keeps pitch, color, and output actions independent in button-map format 2", () => {
    const tuningId = deterministicObjectId("field-masked-map-tuning");
    const map = createExplicitButtonMap({
      objectId: deterministicObjectId("field-masked-map"),
      name: "Independent fields",
      tuningRef: { objectType: ObjectType.UserTuning, handle: 0, objectId: tuningId },
      records: [
        { buttonIndex: 10, role: 1, hueTenthDegrees: 1200, saturation: 200, value: 180 },
        { buttonIndex: 11, role: 1, stepsFromC: 7 },
        { buttonIndex: 12, role: 1, action: { kind: "direct-midi", midiNote: 48, midiChannel: 2 } },
        { buttonIndex: 13, role: 1, action: { kind: "chord", chordActionId: 3, rootMidiNote: 60 } }
      ],
      actions: [{ id: 3, name: "Major triad", pitchMode: "midi-semitones", intervals: [0, 4, 7], midiChannel: 3 }]
    });
    const records = recordValue(map.body, ExplicitButtonMapTlv.ButtonRecords);
    expect(u8(recordValue(map.body, ExplicitButtonMapTlv.MapRecordFormat))).toBe(ButtonMapRecordFormat.FieldMasked);
    expect(u16LE(records.slice(4, 6))).toBe(ButtonMapField.Color);
    expect(u16LE(records.slice(23, 25))).toBe(ButtonMapField.Pitch);
    expect(u16LE(records.slice(42, 44))).toBe(ButtonMapField.Action);
    expect(recordValue(map.body, ExplicitButtonMapTlv.Actions).length).toBeGreaterThan(0);
  });

  it("keeps off-board overrides in the web bundle without syncing them", () => {
    const base = createDefaultTuningBundle();
    const bundle = {
      ...base,
      layouts: base.layouts.map((layout, index) => index === 0 ? {
        ...layout,
        offGridOverrides: [{ coordCol: -3, coordRow: 18, role: "note" as const, stepsFromC: 42 }]
      } : layout)
    };
    const parsed = parseTuningBundleFile(JSON.parse(serializeTuningBundle(bundle)));
    expect(parsed.layouts[0].offGridOverrides).toEqual([
      { coordCol: -3, coordRow: 18, role: "note", stepsFromC: 42 }
    ]);
    expect(encodeTuningBundle(parsed).explicitButtonMaps).toHaveLength(0);
  });

  it("falls back to the default bundle for an empty layout library", () => {
    const library = parseTuningBundleLibrary([]);
    expect(library).toHaveLength(1);
    expect(library[0].tuning.name).toBe("19 EDO Wicki");
  });

  it("resolves scale degree color before per-button overrides", () => {
    const degreeColors = [
      { degree: 0, hueTenthDegrees: 0, saturation: 0, value: 180 },
      { degree: 1, hueTenthDegrees: 1200, saturation: 200, value: 190 }
    ];
    expect(resolveTuningBundleButtonColor({
      degreeColors,
      cycleLength: 2,
      stepsFromC: 1,
      defaultColorMode: ColorMode.Custom
    })).toMatchObject({
      degree: 1,
      colorSource: "degree",
      color: degreeColors[1]
    });
    expect(resolveTuningBundleButtonColor({
      degreeColors,
      cycleLength: 2,
      stepsFromC: 1,
      defaultColorMode: ColorMode.Rainbow
    })).toMatchObject({
      degree: 1,
      colorSource: "degree",
      color: {
        degree: 1,
        hueTenthDegrees: 1800,
        saturation: 255,
        value: 255
      }
    });
    expect(resolveTuningBundleButtonColor({
      degreeColors,
      cycleLength: 2,
      stepsFromC: 1,
      defaultColorMode: ColorMode.Rainbow,
      override: {
        buttonIndex: 64,
        role: "note",
        hueTenthDegrees: 2400,
        saturation: 255,
        value: 220
      }
    })).toMatchObject({
      degree: 1,
      colorSource: "degree",
      color: {
        degree: 1,
        hueTenthDegrees: 1800,
        saturation: 255,
        value: 255
      }
    });
    expect(resolveTuningBundleButtonColor({
      degreeColors,
      cycleLength: 2,
      stepsFromC: 1,
      defaultColorMode: ColorMode.Custom,
      override: {
        buttonIndex: 64,
        role: "note",
        hueTenthDegrees: 2400,
        saturation: 255,
        value: 220
      }
    })).toMatchObject({
      degree: 1,
      colorSource: "button",
      color: {
        degree: 1,
        hueTenthDegrees: 2400,
        saturation: 255,
        value: 220
      }
    });
  });
});
