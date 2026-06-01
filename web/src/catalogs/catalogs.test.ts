import { describe, expect, it } from "vitest";
import { ObjectType } from "../protocol/constants.ts";
import { CommonTlv, decodeObjectBody, textFromBytes } from "../protocol/tlv.ts";
import {
  createExplicitButtonMap,
  createDefaultLayoutBundle,
  createEqualStepTuning,
  createGeneratedEdoTuning,
  createScaleColorMap,
  createSynthPresetObject,
  createVectorLayout,
  currentFirmwareDownLeftToUpRight,
  deterministicObjectId,
  encodeLayoutBundle,
  LayoutTlv,
  parseLayoutBundleLibrary,
  parseLayoutBundleFile,
  parseScalaScale,
  resolveLayoutBundleButtonColor,
  serializeLayoutBundle,
  TuningTlv,
  UserTuningKind
} from "./index.ts";

function recordValue(body: Uint8Array, tag: number): Uint8Array {
  return decodeObjectBody(body).records.find((record) => record.tag === tag)?.value ?? new Uint8Array();
}

function u8(value: Uint8Array): number {
  return value[0];
}

function u16LE(value: Uint8Array): number {
  return value[0] | (value[1] << 8);
}

function i16LE(value: Uint8Array): number {
  const unsigned = u16LE(value);
  return unsigned >= 0x8000 ? unsigned - 0x10000 : unsigned;
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

  it("round trips scale colors and explicit button maps", () => {
    const colors = createScaleColorMap({
      objectId: deterministicObjectId("colors"),
      name: "Degrees",
      cycleLength: 17,
      defaultColorMode: 0,
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

  it("serializes and encodes a layout bundle", () => {
    const bundle = createDefaultLayoutBundle();
    const parsed = parseLayoutBundleFile(JSON.parse(serializeLayoutBundle(bundle)));
    const encoded = encodeLayoutBundle(parsed);
    expect(parsed.name).toBe(bundle.name);
    expect(encoded.objects.map((object) => object.objectType)).toEqual([
      ObjectType.UserTuning,
      ObjectType.UserLayout,
      ObjectType.ScaleColorMap
    ]);
  });

  it("derives legacy portrait metadata from four-step bundle rotation", () => {
    const base = createDefaultLayoutBundle();
    const bundle = {
      ...base,
      layout: {
        ...base.layout,
        rotationSteps: 1
      }
    };
    const encoded = encodeLayoutBundle(bundle);
    expect(u8(recordValue(encoded.layout.body, LayoutTlv.Portrait))).toBe(0);
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
      stepsFromC: 1
    })).toMatchObject({
      degree: 1,
      colorSource: "degree",
      color: degreeColors[1]
    });
    expect(resolveLayoutBundleButtonColor({
      degreeColors,
      cycleLength: 2,
      stepsFromC: 1,
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
