import { describe, expect, it } from "vitest";
import { createDefaultTuningBundle, ColorMode } from "../catalogs/layoutsCatalog.ts";
import { MajorScaleRun, lessonLayouts, resolveLessonKeys, unavailableScaleNotes } from "./majorScale.ts";
import { tuningPitch, tuningStepLabel, scaleSteps } from "./tuningPractice.ts";
import { scalePatternNotes, BeatScaleRun } from "./scalePractice.ts";
import { lessonLedColor } from "./lessonColors.ts";

function edo(divisions = 19) {
  const bundle = createDefaultTuningBundle();
  bundle.tuning = { kind: "edo", name: `${divisions} EDO`, cycleLength: divisions, edoDivisions: divisions,
    periodCents: 1200, referenceDegree: 0, referenceMidiNote: 60, referenceHz: 261.6255653005986,
    defaultKeyDegree: 0, keyLabels: Array.from({length:divisions}, (_, i) => `d${i}`) };
  bundle.layouts[0].acrossSteps = 1; bundle.layouts[0].upRightSteps = 4;
  return bundle;
}
describe("tuning-aware scale practice", () => {
  it("uses fractional pitches and arbitrary scale lengths in both run modes", () => {
    const bundle = edo();
    const scale = { name: "Five tones", objectIdHex: "scale", includedDegrees: [0,3,7,11,15] };
    const notes = scaleSteps(bundle, scale, 0).map(step => tuningPitch(bundle.tuning, step));
    expect(notes).toHaveLength(6);
    expect(notes[1]).toBeCloseTo(60 + 36/19, 7);
    expect(notes[5]).toBe(72);
    expect(scalePatternNotes("upDown", notes)).toHaveLength(11);
    expect(scalePatternNotes("thirds", notes)).toHaveLength(10);
    const run = new MajorScaleRun(notes, pitch => `Tone ${pitch}`), beat = new BeatScaleRun(notes, 1000, 60);
    notes.forEach((note, i) => { run.press(i, note, i * 100); beat.press(i, note, 1000 + i * 1000); });
    expect(run.complete).toBe(true); expect(run.feedback).not.toContain("C-major");
    expect(beat.result().score).toBe(100);
    const keys = resolveLessonKeys(lessonLayouts(bundle)[0]);
    expect(keys.some(key => key.note !== null && !Number.isInteger(key.note))).toBe(true);
  });
  it("matches firmware reference-relative Scala tables across negative steps and non-octave periods", () => {
    const tuning = { ...edo(3).tuning, kind: "scala" as const, description: "tritave", cents: [400, 1100, 1901.955], periodCents: 1901.955, referenceDegree: 1 };
    expect(tuningPitch(tuning, 1)).toBe(60);
    expect(tuningPitch(tuning, 2)).toBe(64);
    expect(tuningPitch(tuning, 0)).toBeCloseTo(60 + (1100 - 1901.955) / 100, 7);
    expect(tuningPitch(tuning, 4)).toBeCloseTo(79.01955, 7);
    expect(tuningStepLabel(tuning, -1)).toBe("d2 [-1]");
  });
  it("supports equal steps, roots, registers and missing-range detection without folding pitches", () => {
    const bundle = edo(5);
    bundle.tuning = { ...bundle.tuning, kind: "equal-step", stepCents: 180 };
    const steps = scaleSteps(bundle, { name:"test", objectIdHex:"s", includedDegrees:[4,0,2,2] }, 2, -1);
    expect(steps).toEqual([-3,-1,1,2]);
    expect(tuningPitch(bundle.tuning, 5) - tuningPitch(bundle.tuning, 0)).toBe(9);
    const notes = steps.map(step => tuningPitch(bundle.tuning, step));
    expect(unavailableScaleNotes([], notes)).toHaveLength(4);
  });
  it("keeps direct MIDI assignments exact and excludes chord and command answers", () => {
    const bundle = edo();
    bundle.layouts[0].buttonOverrides = [
      {buttonIndex:1, role:"note", action:{kind:"direct-midi", midiNote:60, midiChannel:1}},
      {buttonIndex:2, role:"note", action:{kind:"chord", chordActionId:1}},
      {buttonIndex:3, role:"command"}
    ];
    const keys = resolveLessonKeys(lessonLayouts(bundle)[0]);
    expect(keys[1]).toMatchObject({note:60, label:"C4"});
    expect(keys[2].note).toBeNull(); expect(keys[3].note).toBeNull();
  });
  it("uses tuning-relative colors and custom per-key palettes while preserving target contrast", () => {
    const bundle = edo();
    const context = {bundle, steps:3, root:0, mode:ColorMode.Rainbow, index:1};
    expect(lessonLedColor(61, "rest", context).hue).toBe(Math.round(3/19*127));
    expect(lessonLedColor(61, "target", context).value).toBeGreaterThan(lessonLedColor(61, "rest", context).value);
    bundle.activeLayoutIdHex = bundle.layouts[0].objectIdHex;
    bundle.layouts[0].buttonOverrides = [{buttonIndex:1, role:"note", hueTenthDegrees:900, saturation:128, value:128}];
    const color = lessonLedColor(61, "rest", {...context, mode:ColorMode.Custom});
    expect(color).toEqual({hue:32,saturation:64,value:76});
    for (const mode of Object.values(ColorMode)) {
      const color = lessonLedColor(61, "target", {...context, mode});
      expect(Object.values(color).every(value => value >= 0 && value <= 127)).toBe(true);
    }
  });
});
