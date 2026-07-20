import { describe, expect, it } from "vitest";
import type { LayoutBundleButtonOverride } from "../catalogs/index.ts";
import {
  clearColorOverridesForScaleDegree,
  colorToCss,
  paintScaleDegreeColor,
  resetOverridesToScaleDegreeColors
} from "./TuningLayoutEditor.tsx";

describe("tuning layout color rendering", () => {
  it("renders HSV preview colors without dimming or remapping value", () => {
    expect(colorToCss({ degree: 0, hueTenthDegrees: 0, saturation: 0, value: 255 })).toBe("#ffffff");
    expect(colorToCss({ degree: 0, hueTenthDegrees: 0, saturation: 0, value: 0 })).toBe("#000000");
    expect(colorToCss({ degree: 0, hueTenthDegrees: 0, saturation: 255, value: 255 })).toBe("#ff0000");
  });

  it("resets button colors back to scale degree colors without dropping note overrides", () => {
    const overrides: LayoutBundleButtonOverride[] = [
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
    const overrides: LayoutBundleButtonOverride[] = [
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
