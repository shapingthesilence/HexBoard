import { describe, expect, it } from "vitest";
import { ObjectType } from "../protocol/constants.ts";
import { CommonTlv, decodeObjectBody, textFromBytes } from "../protocol/tlv.ts";
import {
  createExplicitButtonMap,
  createGeneratedEdoTuning,
  createScaleColorMap,
  createSynthPresetObject,
  createVectorLayout,
  deterministicObjectId
} from "./index.ts";

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
      downLeftSteps: -10,
      portrait: true
    });
    expect(decodeObjectBody(layout.body).objectType).toBe(ObjectType.UserLayout);
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
});

