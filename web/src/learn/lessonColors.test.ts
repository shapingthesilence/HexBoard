import { describe, expect, it } from "vitest";
import { lessonLedColor, lessonScreenColor } from "./lessonColors.ts";

describe("learning rainbow", () => {
  it("keeps all twelve pitch colors across octaves and uses brightness for feedback", () => {
    const hues = new Set<number>();
    for (let note = 60; note < 72; note++) {
      const rest = lessonLedColor(note, "rest"), target = lessonLedColor(note, "target"), held = lessonLedColor(note, "held");
      hues.add(rest.hue);
      expect(lessonLedColor(note + 12, "rest")).toEqual(rest);
      expect(lessonLedColor(note - 12, "rest")).toEqual(rest);
      expect(target.hue).toBe(rest.hue);
      expect(held.hue).toBe(rest.hue);
      expect(rest.saturation).toBe(127);
      expect(rest.value).toBeGreaterThan(0);
      expect(target.value).toBeGreaterThan(rest.value * 3);
      expect(held.value).toBeGreaterThan(rest.value * 2);
    }
    expect(hues.size).toBe(12);
  });
  it("shows C as red, dims its normal state and turns unavailable keys off", () => {
    expect(lessonScreenColor(lessonLedColor(60, "target")).fill).toBe("rgb(255 0 0)");
    expect(lessonScreenColor(lessonLedColor(60, "rest")).fill).toBe("rgb(84 0 0)");
    expect(lessonLedColor(null, "rest").value).toBe(0);
    expect(lessonLedColor(60, "off").value).toBe(0);
  });
});
