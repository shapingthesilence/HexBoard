import { describe, expect, it } from "vitest";
import { majorScale, MajorScaleRun, resolveLessonKeys, starterLayouts } from "./majorScale.ts";
import { BeatScaleRun, scalePatternNotes, scalePatterns, type ScalePattern } from "./scalePractice.ts";

describe("scale practice patterns and timing", () => {
  it("reverses direction without repeating the turning note", () => {
    expect(scalePatternNotes("ascending")).toEqual(majorScale);
    expect(scalePatternNotes("descending")).toEqual([...majorScale].reverse());
    expect(scalePatternNotes("upDown")).toEqual([60,62,64,65,67,69,71,72,71,69,67,65,64,62,60]);
    expect(scalePatternNotes("downUp")).toEqual([72,71,69,67,65,64,62,60,62,64,65,67,69,71,72]);
    expect(scalePatternNotes("thirds")).toEqual([60,64,62,65,64,67,65,69,67,71,69,72,71,72]);
  });
  for (const layout of starterLayouts()) for (const pattern of Object.keys(scalePatterns) as ScalePattern[]) {
    it(`times ${pattern} on ${layout.layout.name}, excluding the final release`, () => {
      const notes = scalePatternNotes(pattern), keys = resolveLessonKeys(layout), run = new MajorScaleRun(notes);
      run.press(999, 59, 0); run.release(999);
      expect(run.startedAt).toBeUndefined();
      notes.forEach((note, i) => {
        const key = keys.find((key) => key.note === note)!;
        run.press(key.key.index, note, 1000 + i * 400); run.release(key.key.index);
      });
      expect(run.complete).toBe(true);
      expect(run.elapsedMs).toBe((notes.length - 1) * 400);
      expect(run.mistakes).toBe(1);
    });
  }
});

describe("fixed beat grading", () => {
  it("shows the next note immediately and keeps it highlighted until its beat", () => {
    const run = new BeatScaleRun(majorScale, 10000, 60);
    run.tick(10000);
    run.press(0, 60, 10000);
    expect(run.step).toBe(1);
    run.tick(10025);
    expect(run.step).toBe(1);
    run.press(1, 62, 11000);
    expect(run.step).toBe(2);
    run.tick(11025);
    expect(run.step).toBe(2);
    run.tick(13500); // Silence still skips missed beat windows.
    expect(run.step).toBe(4);
    run.press(2, 65, 14000); // Wrong note does not advance the cue.
    expect(run.step).toBe(4);
    expect(run.result()).toMatchObject({ hits: 2, extras: 1 });
  });
  it("grades perfect, early and late runs using received timestamps", () => {
    for (const bpm of [40, 80, 180]) for (const offset of [-30, 0, 30]) {
      const run = new BeatScaleRun(majorScale, 10000, bpm);
      majorScale.forEach((note, i) => { run.press(i, note, run.startAt + i * run.periodMs + offset); run.release(i); });
      run.tick(run.endAt - 1); expect(run.complete).toBe(false);
      run.tick(run.endAt); expect(run.complete).toBe(true);
      const result = run.result();
      expect(result.score).toBe(Math.round(100 * (1 - Math.abs(offset) / (run.periodMs / 2))));
      expect(result.meanErrorMs).toBeCloseTo(Math.abs(offset));
      expect(result.biasMs).toBeCloseTo(offset);
      expect(run.elapsedMs).toBeCloseTo(7 * run.periodMs);
      expect(result.missed).toBe(0);
    }
  });
  it("gives silence zero and counts missed pitches even if played notes are on time", () => {
    const run = new BeatScaleRun(majorScale, 10000, 60);
    expect(run.result()).toMatchObject({ score: 0, missed: 8, meanErrorMs: null });
    run.press(1, 60, 10000); run.release(1);
    run.tick(run.endAt);
    expect(run.result()).toMatchObject({ score: 13, missed: 7 });
    expect(run.elapsedMs).toBeUndefined();
  });
  it("does not slide targets when a note is a full beat late", () => {
    const run = new BeatScaleRun(majorScale, 10000, 60);
    majorScale.forEach((note, i) => { run.press(i, note, 11000 + i * 1000); run.release(i); });
    expect(run.result()).toMatchObject({ score: 0, missed: 8, extras: 7 });
  });
  it("allows overlapping notes, ignores repeated NoteOn, and penalizes extra attacks", () => {
    const run = new BeatScaleRun(majorScale, 10000, 60);
    run.press(0, 60, 10000); run.press(0, 60, 10001);
    run.press(1, 62, 11000);
    run.release(0); run.release(1);
    run.press(1, 62, 11010); run.release(1);
    run.press(1, 62, 11020); run.release(1);
    expect(run.result()).toMatchObject({ hits: 2, extras: 2, missed: 6 });
    expect(run.result().score).toBeLessThan(25);
  });
  it("does not count a held count-in key again without a new attack", () => {
    const run = new BeatScaleRun(majorScale, 10000, 60);
    run.press(1, 60, 8000); run.press(1, 60, 10000);
    expect(run.result()).toMatchObject({ hits: 0, extras: 0 });
    run.press(2, 60, 10010); // Another key with the same pitch is a fresh attack.
    expect(run.result()).toMatchObject({ hits: 1, extras: 0 });
  });
  it("gives a perfectly timed legato scale full credit", () => {
    const run = new BeatScaleRun(majorScale, 10000, 60);
    majorScale.forEach((note, index) => run.press(index, note, 10000 + index * 1000));
    expect(run.held.size).toBe(8);
    expect(run.result()).toMatchObject({ score: 100, hits: 8, extras: 0 });
    majorScale.forEach((_, index) => run.release(index));
    expect(run.held.size).toBe(0);
  });
  it("uses disjoint half-beat windows and a fixed count-in between runs", () => {
    const first = new BeatScaleRun(majorScale, 10000, 60);
    first.press(0, 60, 9499); first.release(0);
    expect(first.result().hits).toBe(0);
    first.press(0, 60, 9500); first.release(0);
    expect(first.result().hits).toBe(1);
    const next = new BeatScaleRun(majorScale, first.startAt + (majorScale.length + 4) * first.periodMs, 60);
    expect(next.startAt).toBe(22000);
    next.press(0, 72, first.endAt); next.release(0);
    expect(next.result()).toMatchObject({ hits: 0, extras: 0 });
  });
});
