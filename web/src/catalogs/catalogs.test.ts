import { describe, expect, it } from "vitest";
import { ObjectType } from "../protocol/constants.ts";
import { CommonTlv, decodeObjectBody, textFromBytes } from "../protocol/tlv.ts";
import {
  ColorMode,
  createExplicitButtonMap,
  createDefaultLayoutBundle,
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
  deterministicObjectId,
  encodeHexBoardWavetableWav,
  encodeLayoutBundle,
  GenericScaleColorMapName,
  LayoutTlv,
  parseHexBoardWavetable,
  parseLayoutBundleLibrary,
  parseLayoutBundleFile,
  parseScalaScale,
  renderInterpolatedAnchorWavetable,
  resolveLayoutBundleButtonColor,
  ScaleColorMapTlv,
  serializeLayoutBundle,
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
    expect(keyLabels(recordValue(tuning.body, TuningTlv.KeyLabels))).toEqual(Array.from({ length: 17 }, (_, degree) => String(degree)));
  });

  it("round trips a vector layout", () => {
    const layout = createVectorLayout({
      objectId: layoutId,
      name: "Wicki 17",
      tuningRef: { objectType: ObjectType.UserTuning, handle: 0, objectId: tuningId },
      centerButton: 65,
      acrossSteps: 3,
      upRightSteps: 7,
      portrait: true
    });
    expect(decodeObjectBody(layout.body).objectType).toBe(ObjectType.UserLayout);
    expect(i16LE(recordValue(layout.body, LayoutTlv.DownLeftSteps))).toBe(-7);
    expect(currentFirmwareDownLeftToUpRight(3, -11)).toBe(11);
  });

  it("round trips an equal-step tuning", () => {
    const tuning = createEqualStepTuning({
      objectId: tuningId,
      name: "80 cent steps",
      stepMilliCents: 80_000,
      periodMilliCents: 1_200_000,
      cycleLength: 15
    });
    expect(u8(recordValue(tuning.body, TuningTlv.TuningKind))).toBe(UserTuningKind.EqualStep);
    expect(u16LE(recordValue(tuning.body, TuningTlv.EdoDivisions))).toBe(15);
  });

  it("parses Scala scl files with cents and ratios", () => {
    const parsed = parseScalaScale(`
! example.scl
Example scale
3
100.0
3/2
2/1
`);
    expect(parsed.description).toBe("Example scale");
    expect(parsed.count).toBe(3);
    expect(parsed.cents[0]).toBeCloseTo(100);
    expect(parsed.cents[1]).toBeCloseTo(701.955, 3);
    expect(parsed.periodCents).toBeCloseTo(1200);
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
      "Basic Shapes",
      "Classic",
      "Vowels",
      "HarshDigitalBois",
      "RustyBlade",
      "RoundThe808",
      "GlassyBells"
    ]);
    expect(factory.every((wavetable) => wavetable.folderPath === "/Built In")).toBe(true);
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

  it("serializes and encodes a layout bundle", () => {
    const bundle = {
      ...createDefaultLayoutBundle(),
      folderPath: "Microtonal"
    };
    const parsed = parseLayoutBundleFile(JSON.parse(serializeLayoutBundle(bundle)));
    const encoded = encodeLayoutBundle(parsed);
    expect(parsed.name).toBe(bundle.name);
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
    expect(u8(recordValue(encoded.scaleColorMap.body, ScaleColorMapTlv.DefaultColorMode))).toBe(ColorMode.Custom);
  });

  it("derives equal-step period metadata from step cents and cycle length", () => {
    const base = createDefaultLayoutBundle();
    const serialized = JSON.parse(serializeLayoutBundle({
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
    const parsed = parseLayoutBundleFile(serialized);
    const encoded = encodeLayoutBundle(parsed);

    expect("periodCents" in parsed.tuning).toBe(false);
    expect(u32LE(recordValue(encoded.tuning.body, TuningTlv.PeriodMilliCents))).toBe(1_200_000);
  });

  it("derives Scala period and cycle metadata from the cents table", () => {
    const base = createDefaultLayoutBundle();
    const serialized = JSON.parse(serializeLayoutBundle({
      ...base,
      tuning: {
        kind: "scala",
        name: "Imported Scala",
        description: "Imported Scala",
        cents: [100, 300, 702],
        periodCents: 702,
        cycleLength: 3,
        referenceMidiNote: 69,
        referenceHz: 440
      }
    }));

    const parsed = parseLayoutBundleFile(serialized);
    const encoded = encodeLayoutBundle(parsed);

    expect(parsed.tuning).toMatchObject({
      kind: "scala",
      periodCents: 702,
      cycleLength: 3
    });
    expect(u16LE(recordValue(encoded.tuning.body, TuningTlv.EdoDivisions))).toBe(3);
    expect(u32LE(recordValue(encoded.tuning.body, TuningTlv.PeriodMilliCents))).toBe(702_000);
  });

  it("derives legacy portrait metadata from four-step bundle rotation", () => {
    const base = createDefaultLayoutBundle();
    const bundle = {
      ...base,
      layouts: base.layouts.map((layout, index) => index === 0 ? { ...layout, rotationSteps: 1 } : layout)
    };
    const encoded = encodeLayoutBundle(bundle);
    expect(u8(recordValue(encoded.layouts[0].body, LayoutTlv.Portrait))).toBe(0);
  });

  it("falls back to the default bundle for an empty layout library", () => {
    const library = parseLayoutBundleLibrary([]);
    expect(library).toHaveLength(1);
    expect(library[0].name).toBe("19 EDO Wicki");
  });

  it("resolves scale degree color before per-button overrides", () => {
    const degreeColors = [
      { degree: 0, hueTenthDegrees: 0, saturation: 0, value: 180 },
      { degree: 1, hueTenthDegrees: 1200, saturation: 200, value: 190 }
    ];
    expect(resolveLayoutBundleButtonColor({
      degreeColors,
      cycleLength: 2,
      stepsFromC: 1,
      defaultColorMode: ColorMode.Custom
    })).toMatchObject({
      degree: 1,
      colorSource: "degree",
      color: degreeColors[1]
    });
    expect(resolveLayoutBundleButtonColor({
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
        value: 180
      }
    });
    expect(resolveLayoutBundleButtonColor({
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
        value: 180
      }
    });
    expect(resolveLayoutBundleButtonColor({
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
