import { describe, expect, it } from "vitest";
import { colorToCss } from "./TuningLayoutEditor.tsx";

describe("tuning layout color rendering", () => {
  it("renders HSV preview colors without dimming or remapping value", () => {
    expect(colorToCss({ degree: 0, hueTenthDegrees: 0, saturation: 0, value: 255 })).toBe("#ffffff");
    expect(colorToCss({ degree: 0, hueTenthDegrees: 0, saturation: 0, value: 0 })).toBe("#000000");
    expect(colorToCss({ degree: 0, hueTenthDegrees: 0, saturation: 255, value: 255 })).toBe("#ff0000");
  });
});
