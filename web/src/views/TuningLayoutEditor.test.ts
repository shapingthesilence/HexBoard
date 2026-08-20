import { describe, expect, it } from "vitest";
import { createDefaultTuningBundle, type TuningBundleButtonOverride } from "../catalogs/index.ts";
import { ObjectListFlag, ObjectType, type ObjectListRecord } from "../protocol/index.ts";
import {
  clearColorOverridesForScaleDegree,
  colorToCss,
  deviceRelativeMirrorTransform,
  keyOutputMode,
  midiNoteName,
  normalizeCommittedNumber,
  partitionHexBoardGeometryRecords,
  paintScaleDegreeColor,
  reorderByObjectId,
  resetOverridesToScaleDegreeColors,
  tuningBundlesFromUnknown,
  validLiveNumber,
  withProtectedAllNotesScale
} from "./TuningLayoutEditor.tsx";

describe("tuning bundle batch files", () => {
  it("imports multiple bundles from one library file", () => {
    const first = createDefaultTuningBundle();
    const second = {
      ...createDefaultTuningBundle(),
      objectIdHex: "00112233445566778899aabbccddeeff",
      tuning: { ...createDefaultTuningBundle().tuning, name: "Second Tuning" }
    };

    const bundles = tuningBundlesFromUnknown({
      format: "hexboard.tuningBundleLibrary.v1",
      tuningBundles: [first, second]
    });

    expect(bundles.map((bundle) => bundle.tuning.name)).toEqual(["19 EDO Wicki", "Second Tuning"]);
  });
});

function geometryRecord(name: string, flags: number, handle: number): ObjectListRecord {
  return {
    objectType: ObjectType.UserTuning,
    handle,
    flags,
    schemaMajor: 2,
    schemaMinor: 0,
    objectId: new Uint8Array(16).fill(handle),
    folderPath: "/",
    name
  };
}

describe("HexBoard rescue geometry", () => {
  it("reports the rescue state without exposing it as an editable library entry", () => {
    const result = partitionHexBoardGeometryRecords([
      geometryRecord("Stored", ObjectListFlag.Valid, 0),
      geometryRecord("Rescue", ObjectListFlag.Valid | ObjectListFlag.ReadOnly, 0x2000)
    ]);

    expect(result.rescueActive).toBe(true);
    expect(result.entries.map((entry) => entry.name)).toEqual(["Stored"]);
  });
});

describe("bundle item ordering", () => {
  it("moves a dragged item to the target position without mutating the source", () => {
    const items = [
      { objectIdHex: "a", name: "First" },
      { objectIdHex: "b", name: "Second" },
      { objectIdHex: "c", name: "Third" }
    ];

    expect(reorderByObjectId(items, "c", "a").map((item) => item.objectIdHex)).toEqual(["c", "a", "b"]);
    expect(items.map((item) => item.objectIdHex)).toEqual(["a", "b", "c"]);
  });

  it("allows All Notes to move and preserves its reordered position during normalization", () => {
    const bundle = createDefaultTuningBundle();
    const majorScale = { ...bundle.scales[0], objectIdHex: "major", name: "Major" };
    const reordered = reorderByObjectId([...bundle.scales, majorScale], bundle.scales[0].objectIdHex, majorScale.objectIdHex);
    const normalized = withProtectedAllNotesScale({ ...bundle, scales: reordered });

    expect(normalized.scales.map((scale) => scale.name)).toEqual(["Major", "All Notes"]);
  });

});

describe("key output mode", () => {
  it("represents an unused key as Off even when it retains an action", () => {
    expect(keyOutputMode("unused", { kind: "direct-midi", midiNote: 60, midiChannel: 1 })).toBe("off");
  });

  it("maps active keys to their tuned or explicit output", () => {
    expect(keyOutputMode("note", undefined)).toBe("tuned");
    expect(keyOutputMode("note", { kind: "direct-midi", midiNote: 60, midiChannel: 1 })).toBe("direct-midi");
    expect(keyOutputMode("note", { kind: "chord", chordActionId: 1 })).toBe("chord");
  });
});

describe("deferred number fields", () => {
  it("emits only complete, in-range live values", () => {
    expect(validLiveNumber("", 1, 128, true)).toBeUndefined();
    expect(validLiveNumber("200", 1, 128, true)).toBeUndefined();
    expect(validLiveNumber("4.6", 1, 128, true)).toBeUndefined();
    expect(validLiveNumber("48", 1, 128, true)).toBe(48);
    expect(validLiveNumber("432.5", 0.01)).toBe(432.5);
  });

  it("keeps the prior value when an empty or invalid draft is committed", () => {
    expect(normalizeCommittedNumber("", 12, 1, 128, true)).toBe(12);
    expect(normalizeCommittedNumber("not a number", 440, 0.01)).toBe(440);
  });

  it("clamps and rounds only when the edit is committed", () => {
    expect(normalizeCommittedNumber("200", 12, 1, 128, true)).toBe(128);
    expect(normalizeCommittedNumber("4.6", 12, 1, 128, true)).toBe(5);
    expect(normalizeCommittedNumber("432.5", 440, 0.01)).toBe(432.5);
  });
});

describe("reference-key labels", () => {
  it("uses scientific pitch notation", () => {
    expect(midiNoteName(60)).toBe("C4");
    expect(midiNoteName(69)).toBe("A4");
    expect(midiNoteName(127)).toBe("G9");
  });
});

describe("tuning layout color rendering", () => {
  it("renders HSV preview colors without dimming or remapping value", () => {
    expect(colorToCss({ degree: 0, hueTenthDegrees: 0, saturation: 0, value: 255 })).toBe("#ffffff");
    expect(colorToCss({ degree: 0, hueTenthDegrees: 0, saturation: 0, value: 0 })).toBe("#000000");
    expect(colorToCss({ degree: 0, hueTenthDegrees: 0, saturation: 255, value: 255 })).toBe("#ff0000");
  });

  it("resets button colors back to scale degree colors without dropping note overrides", () => {
    const overrides: TuningBundleButtonOverride[] = [
      { buttonIndex: 10, role: "note", hueTenthDegrees: 2400, saturation: 255, value: 220 },
      { buttonIndex: 11, role: "note", stepsFromC: 7, hueTenthDegrees: 1200, saturation: 200, value: 190 },
      { buttonIndex: 12, role: "unused", hueTenthDegrees: 0, saturation: 255, value: 180 },
      { buttonIndex: 13, role: "note", stepsFromC: 9 },
      { buttonIndex: 14, role: "note", action: { kind: "direct-midi", midiNote: 48, midiChannel: 2 }, hueTenthDegrees: 3000, saturation: 255, value: 170 }
    ];

    expect(resetOverridesToScaleDegreeColors(overrides)).toEqual([
      { buttonIndex: 11, role: "note", stepsFromC: 7 },
      { buttonIndex: 12, role: "unused" },
      { buttonIndex: 13, role: "note", stepsFromC: 9 },
      { buttonIndex: 14, role: "note", action: { kind: "direct-midi", midiNote: 48, midiChannel: 2 } }
    ]);
  });

  it("paints a scale degree without changing other palette entries", () => {
    expect(paintScaleDegreeColor(
      [
        { degree: 0, hueTenthDegrees: 0, saturation: 0, value: 255 },
        { degree: 1, hueTenthDegrees: 600, saturation: 128, value: 180 },
        { degree: 2, hueTenthDegrees: 1200, saturation: 128, value: 180 }
      ],
      3,
      1,
      { degree: 0, hueTenthDegrees: 2400, saturation: 255, value: 220 }
    )).toEqual([
      { degree: 0, hueTenthDegrees: 0, saturation: 0, value: 255 },
      { degree: 1, hueTenthDegrees: 2400, saturation: 255, value: 220 },
      { degree: 2, hueTenthDegrees: 1200, saturation: 128, value: 180 }
    ]);
  });

  it("clears color overrides for buttons on a painted scale degree", () => {
    const overrides: TuningBundleButtonOverride[] = [
      { buttonIndex: 10, role: "note", hueTenthDegrees: 1200, saturation: 255, value: 180 },
      { buttonIndex: 11, role: "note", stepsFromC: 8, hueTenthDegrees: 2400, saturation: 255, value: 200 },
      { buttonIndex: 12, role: "unused", hueTenthDegrees: 0, saturation: 255, value: 160 },
      { buttonIndex: 13, role: "note", stepsFromC: 4, hueTenthDegrees: 600, saturation: 255, value: 170 }
    ];

    expect(clearColorOverridesForScaleDegree(overrides, new Map([
      [10, 2],
      [11, 2],
      [12, 2],
      [13, 4]
    ]), 2)).toEqual([
      { buttonIndex: 11, role: "note", stepsFromC: 8 },
      { buttonIndex: 12, role: "unused" },
      { buttonIndex: 13, role: "note", stepsFromC: 4, hueTenthDegrees: 600, saturation: 255, value: 170 }
    ]);
  });
});

describe("layout transform controls", () => {
  it("keeps mirror directions relative to device rotation", () => {
    expect(deviceRelativeMirrorTransform(0, "horizontal")).toBe("mirror-left-right");
    expect(deviceRelativeMirrorTransform(0, "vertical")).toBe("mirror-up-down");
    expect(deviceRelativeMirrorTransform(1, "horizontal")).toBe("mirror-up-down");
    expect(deviceRelativeMirrorTransform(1, "vertical")).toBe("mirror-left-right");
    expect(deviceRelativeMirrorTransform(2, "horizontal")).toBe("mirror-left-right");
    expect(deviceRelativeMirrorTransform(3, "vertical")).toBe("mirror-left-right");
  });
});
