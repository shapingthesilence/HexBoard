import { describe, expect, it } from "vitest";
import { ColorMode } from "../catalogs/layoutsCatalog.ts";
import { lessonLedColor, lessonScreenColor } from "./lessonColors.ts";
import { starterLayouts, type KeyLight } from "./majorScale.ts";

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
      expect(rest.value).toBe(64);
      expect(target.value).toBe(127);
      expect(lessonLedColor(note,"alternate")).toEqual(rest);
      expect(lessonLedColor(note,"alternate").value).toBeLessThan(held.value);
      expect(target.value).toBeGreaterThan(rest.value);
      expect(held.value).toBeGreaterThan(rest.value);
    }
    expect(hues.size).toBe(12);
  });
  it("orders scale route brightness from outside keys up to the next note at every contrast", () => {
    const { bundle } = starterLayouts()[0];
    for (const contrast of [25, 50, 85]) {
      const at = (state: KeyLight) => lessonLedColor(64, state, { bundle, steps: 4, root: 0, mode: ColorMode.Rainbow, index: 0, contrast }).value;
      expect(at("outside")).toBeGreaterThan(0);
      expect(at("outside")).toBeLessThan(at("shape"));
      expect(at("shape")).toBe(at("rest"));
      expect(at("shape")).toBeLessThan(at("trail"));
      expect(at("trail")).toBeLessThan(at("held"));
      expect(at("held")).toBeLessThan(at("target"));
    }
  });
  it("shows C as red, dims its normal state and turns unavailable keys off", () => {
    expect(lessonScreenColor(lessonLedColor(60, "target")).fill).toBe("rgb(255 0 0)");
    expect(lessonScreenColor(lessonLedColor(60, "rest")).fill).toBe("rgb(129 0 0)");
    expect(lessonLedColor(null, "rest").value).toBe(0);
    expect(lessonLedColor(60, "off").value).toBe(0);
  });
});
