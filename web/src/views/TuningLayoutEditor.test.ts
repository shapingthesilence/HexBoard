import { describe, expect, it } from "vitest";
import type { LayoutBundleButtonOverride } from "../catalogs/index.ts";
import { colorToCss, resetOverridesToScaleDegreeColors } from "./TuningLayoutEditor.tsx";

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
      { buttonIndex: 13, role: "note", stepsFromC: 9 }
    ];

    expect(resetOverridesToScaleDegreeColors(overrides)).toEqual([
      { buttonIndex: 11, role: "note", stepsFromC: 7 },
      { buttonIndex: 12, role: "unused" },
      { buttonIndex: 13, role: "note", stepsFromC: 9 }
    ]);
  });
});
