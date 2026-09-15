import { describe, expect, it } from "vitest";
import { computeVectorLayoutSteps } from "../catalogs/hexBoardGeometry.ts";
import { keyLight, majorScale, MajorScaleRun, resolveLessonKeys, starterLayouts, unavailableScaleNotes } from "./majorScale.ts";

describe("major scale across layouts", () => {
  for (const original of starterLayouts()) {
    it(`plays all eight notes on ${original.layout.name} and checks transformed ranges`, () => {
      expect(unavailableScaleNotes(resolveLessonKeys(original))).toEqual([]);
      for (let rotation = 0; rotation < 6; rotation++) {
        const selection = structuredClone(original);
        selection.layout.layoutRotationSteps = rotation;
        selection.layout.mirrorLeftRight = rotation % 2 === 1;
        const keys = resolveLessonKeys(selection);
        // Rotating a finite board can remove pitches at its edges. Those
        // variants must be reported as unavailable instead of silently folded.
        if (unavailableScaleNotes(keys).length) {
          expect(majorScale.some((note) => !keys.some((key) => key.note === note))).toBe(true);
          continue;
        }
        const run = new MajorScaleRun();
        for (const pitch of majorScale) {
          const alternatives = keys.filter((key) => key.note === pitch);
          expect(alternatives.length).toBeGreaterThan(0);
          const match = alternatives.at(-1)!; // Accept an alternative, not a prescribed fingering.
          expect(match.note).toBe(60 + computeVectorLayoutSteps(match.key, selection.layout));
          run.press(match.key.index, pitch);
          run.release(match.key.index);
        }
        expect(run.complete).toBe(true);
        expect(run.mistakes).toBe(0);
      }
    });
  }
  it("honors disabled, manual and direct-MIDI keys while excluding command keys and chords", () => {
    const selection = structuredClone(starterLayouts()[0]);
    selection.layout.buttonOverrides = [
      { buttonIndex: 1, role: "note", stepsFromC: 7 },
      { buttonIndex: 2, role: "note", action: { kind: "direct-midi", midiNote: 72, midiChannel: 5 } },
      { buttonIndex: 3, role: "unused" },
      { buttonIndex: 4, role: "note", action: { kind: "chord", chordActionId: 1 } }
    ];
    const keys = resolveLessonKeys(selection);
    expect(keys.slice(0, 5).map((key) => key.note)).toEqual([null, 67, 72, null, null]);
    for (const key of keys) if (key.note === 60) selection.layout.buttonOverrides.push({ buttonIndex: key.key.index, role: "unused" });
    expect(unavailableScaleNotes(resolveLessonKeys(selection))).toContain("C4");
  });
  it("requires clean sequential attacks and release of the last note", () => {
    const run = new MajorScaleRun();
    run.press(1, 61);
    expect(run.step).toBe(0);
    run.press(2, 60);
    expect(run.step).toBe(0);
    run.release(1); run.release(2);
    for (const note of majorScale) {
      run.press(note, note);
      run.press(note, note); // Duplicate NoteOn cannot advance or count a second mistake.
      expect(run.complete).toBe(false);
      run.release(note);
    }
    expect(run.complete).toBe(true);
    expect(run.mistakes).toBe(2);
  });
  it("shows all equivalent target keys and hides targets when hints are off", () => {
    const keys = resolveLessonKeys(starterLayouts().find(({ layout }) => layout.name === "Janko")!);
    const matches = keys.filter((key) => key.note === 60);
    expect(matches.length).toBeGreaterThan(1);
    for (const key of matches) {
      expect(keyLight(key, 60, new Map(), true)).toBe("target");
      expect(keyLight(key, 60, new Map(), false)).toBe("rest");
      expect(keyLight(key, 60, new Map([[key.key.index, 60]]), false)).toBe("held");
    }
  });
  it("waits for extra held notes after the last target", () => {
    const run = new MajorScaleRun();
    for (const note of majorScale.slice(0, -1)) { run.press(note, note); run.release(note); }
    run.press(72, 72);
    run.press(73, 73);
    run.release(72);
    expect(run.complete).toBe(false);
    expect(run.mistakes).toBe(1);
    run.release(73);
    expect(run.complete).toBe(true);
  });
});
