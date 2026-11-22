import { describe, expect, it } from "vitest";
import { parseTuningBundleFile, type TuningBundleTuning } from "../catalogs/layoutsCatalog.ts";
import { hintLevel, parseScaleRecords, recordScaleRun, scaleDegreeLabels, stepSize, stepSizeUnit } from "./scaleCoaching.ts";
import { majorScale, starterLayouts } from "./majorScale.ts";
import { scaleSteps, tuningPitch } from "./tuningPractice.ts";
import thirtyOne from "../../../factory-library/geometry/31 EDO.json";
import bohlenPierce from "../../../factory-library/geometry/Bohlen-Pierce.json";

const twelve = starterLayouts()[0].bundle.tuning;
const notesOf = (file: unknown, name: string) => {
  const bundle = parseTuningBundleFile(file);
  return { tuning: bundle.tuning, notes: scaleSteps(bundle, bundle.scales.find(scale => scale.name === name)!, bundle.tuning.defaultKeyDegree).map(step => tuningPitch(bundle.tuning, step)) };
};

describe("scale coaching", () => {
  it("fades hints with the clean streak", () => {
    expect([0, 1, 2, 3, 4, 9].map(hintLevel)).toEqual(["full", "full", "shape", "shape", "root", "root"]);
  });

  it("labels moves in the tuning's own steps, or cents when steps are unequal", () => {
    expect(stepSize(twelve, 60, 62)).toBe("2");
    expect(stepSize(twelve, 65, 64)).toBe("1");
    expect(stepSizeUnit(twelve)).toBe(`steps of ${twelve.name}`);
    const diatonic = notesOf(thirtyOne, "Diatonic");
    expect(diatonic.notes.slice(1).map((note, index) => stepSize(diatonic.tuning, diatonic.notes[index], note))).toEqual(["5", "5", "3", "5", "5", "5", "3"]);
    const lambda = notesOf(bohlenPierce, "Lambda");
    expect(stepSize(lambda.tuning, lambda.notes[0], lambda.notes[1])).toBe("2");
    // A pitch off the tuning's grid, such as a direct MIDI key, falls back to cents.
    expect(stepSize(diatonic.tuning, 60, 61)).toBe("100¢");
    const unequal: TuningBundleTuning = { kind: "scala", name: "Just", cents: [203.91, 386.31, 498.04, 701.96, 884.36, 1088.27, 1200], periodCents: 1200, cycleLength: 7, referenceDegree: 0, defaultKeyDegree: 0, referenceMidiNote: 60, referenceHz: 261.63, keyLabels: [] } as unknown as TuningBundleTuning;
    expect(stepSize(unequal, 60, 62.0391)).toBe("204¢");
    expect(stepSizeUnit(unequal)).toBe("cents");
  });

  it("numbers scale degrees in every period, for any scale size and period", () => {
    const major = scaleDegreeLabels(twelve, majorScale);
    expect([60, 64, 71, 72, 76, 52].map(major)).toEqual(["1", "3", "7", "1", "3", "3"]);
    expect(major(61)).toBeUndefined();
    const lambda = notesOf(bohlenPierce, "Lambda");
    const degree = scaleDegreeLabels(lambda.tuning, lambda.notes);
    expect(lambda.notes.map(degree)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "1"]);
    // Bohlen-Pierce repeats at the tritave, not the octave.
    expect(degree(lambda.notes[0] + 12)).toBeUndefined();
    expect(degree(lambda.notes[2] + 19.0195500086539)).toBe("3");
  });

  it("names only real improvements and keeps bests per tempo", () => {
    const first = recordScaleRun(undefined, { clean: true, streak: 1, elapsedMs: 4000 });
    expect(first).toEqual({ record: { bestStreak: 1, fastestMs: 4000 }, news: [] });
    const faster = recordScaleRun(first.record, { clean: true, streak: 2, streakBaseline: 1, elapsedMs: 3500 });
    expect(faster.news).toEqual(["best streak", "fastest clean run"]);
    // Growing a streak that is already a record is not announced again.
    expect(recordScaleRun(faster.record, { clean: true, streak: 3, streakBaseline: 1 })).toEqual({ record: { ...faster.record, bestStreak: 3 }, news: [] });
    expect(recordScaleRun(faster.record, { clean: false, streak: 0, elapsedMs: 3000 }).news).toEqual([]);
    const timed = recordScaleRun(faster.record, { clean: false, streak: 0, bpm: 120, score: 80 });
    expect(timed.record.bestScores).toEqual({ 120: 80 });
    expect(recordScaleRun(timed.record, { clean: true, streak: 1, bpm: 120, score: 92 }).news).toEqual(["best score at 120 BPM"]);
    expect(recordScaleRun(timed.record, { clean: true, streak: 1, bpm: 100, score: 70 }).record.bestScores).toEqual({ 100: 70, 120: 80 });
  });

  it("reads saved records defensively", () => {
    expect(parseScaleRecords("not json")).toEqual({});
    expect(parseScaleRecords(JSON.stringify({ a: { bestStreak: 3, fastestMs: -1, bestScores: { 120: 90, fast: 50, 90: 101 } }, b: { bestStreak: "x" } })))
      .toEqual({ a: { bestStreak: 3, bestScores: { 120: 90 } } });
  });
});
