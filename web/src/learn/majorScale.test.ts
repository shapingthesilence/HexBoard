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
  it("accepts overlapping sequential attacks and finishes while the last note is held", () => {
    const run = new MajorScaleRun();
    run.press(1, 61);
    expect(run.step).toBe(0);
    majorScale.forEach((note, i) => {
      run.press(note, note, 1000 + i * 200);
      run.press(note, note, 1001 + i * 200);
      expect(run.step).toBe(i + 1);
    });
    expect(run.complete).toBe(true);
    expect(run.held.size).toBe(9);
    expect(run.mistakes).toBe(1);
    expect(run.elapsedMs).toBe(1400);
    majorScale.forEach((note) => run.release(note));
    expect(run.elapsedMs).toBe(1400);
  });
  it("shows all equivalent target keys and hides targets when hints are off", () => {
    const keys = resolveLessonKeys(starterLayouts().find(({ layout }) => layout.name === "Harmonic Table")!);
    const matches = keys.filter((key) => key.note === 60);
    expect(matches.length).toBeGreaterThan(1);
    for (const key of matches) {
      expect(keyLight(key, 60, new Map(), true)).toBe("target");
      expect(keyLight(key, 60, new Map(), false)).toBe("rest");
      expect(keyLight(key, 60, new Map([[key.key.index, 60]]), false)).toBe("held");
    }
  });
  it("carries held notes across runs without counting a held key twice", () => {
    const first = new MajorScaleRun();
    majorScale.forEach((note) => { first.press(note, note); if (note !== 72) first.release(note); });
    expect(first.complete).toBe(true);
    const next = new MajorScaleRun();
    first.held.forEach((note, key) => next.held.set(key, note));
    next.press(60, 60);
    expect(next.step).toBe(1);
    expect(next.mistakes).toBe(0);
    expect(next.press(72, 72)).toBe(false);
    expect(next.release(72)).toBe(72);
    expect(next.held.has(60)).toBe(true);
  });
});
