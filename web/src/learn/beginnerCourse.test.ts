import {lessonFixtures as beginnerLessons} from "./lessonFixtures.test-support.ts";
import { describe, expect, it } from "vitest";
import { CourseRun, parseCourseProgress, recordCourseRun, mergeCourseProgress } from "./beginnerCourse.ts";
import { resolveLessonKeys, starterLayouts, unavailableScaleNotes } from "./majorScale.ts";

describe("beginner course", () => {
  for (const layout of starterLayouts()) {
    it(`completes every lesson on ${layout.layout.name}`, () => {
      const keys = resolveLessonKeys(layout);
      for (const lesson of beginnerLessons) {
        expect(unavailableScaleNotes(keys, lesson.targets.flat())).toEqual([]);
        const run = new CourseRun(lesson);
        let timestamp = 1000;
        for (const target of lesson.targets) {
          for (const [index, pitch] of run.held) if (!target.includes(pitch) || target.length === 1) run.release(index, timestamp);
          for (const note of target) {
            const key = keys.find(key => key.note === note)!;
            run.press(key.key.index, note, timestamp++);
          }
        }
        expect(run.complete, lesson.title).toBe(true);
        expect(run.mistakes).toBe(0);
        expect(run.elapsedMs).toBeGreaterThanOrEqual(0);
      }
    });
  }
  it("requires a chord together, rejects extras, and finishes on the final release", () => {
    const run = new CourseRun(beginnerLessons.find(lesson => lesson.id === "major-triad")!);
    run.press(0, 60, 10); run.release(0, 20);
    run.press(1, 64, 30); run.press(2, 67, 40);
    expect(run.complete).toBe(false);
    run.press(3, 62, 50); run.press(0, 60, 60);
    expect(run.complete).toBe(false);
    expect(run.feedback).toBe("Release the other notes.");
    run.release(3, 90);
    expect(run.complete).toBe(true);
    expect(run.mistakes).toBe(1);
    expect(run.elapsedMs).toBe(80);
  });
  it("keeps shared chord tones and ignores duplicate attacks", () => {
    const run = new CourseRun(beginnerLessons.find(lesson => lesson.id === "contrast")!);
    run.press(0, 60, 0); run.press(0, 60, 1); run.press(1, 64, 2); run.press(2, 67, 3);
    expect(run.step).toBe(1);
    run.press(3, 63, 4);
    expect(run.step).toBe(1);
    run.release(1, 5);
    expect(run.step).toBe(2);
    run.release(3, 6); run.press(1, 64, 7);
    expect(run.complete).toBe(true);
    expect(run.mistakes).toBe(0);
  });
  it("accepts legato for single-note exercises", () => {
    const run = new CourseRun(beginnerLessons.find(lesson => lesson.id === "major")!);
    run.lesson.targets.forEach(([note], index) => run.press(index, note, index * 100));
    expect(run.complete).toBe(true);
    expect(run.held.size).toBe(8);
  });
  it("advances timed step practice only on correct notes and skips unplayable rests", () => {
    const run = new CourseRun({ id: "step", title: "Step", section: "Test", instruction: "", targets: [[], [60, 64], [], [67], []], timing: { goalBpm: 80, beats: [1, 1, 1, 1, 1] } });
    expect(run.step).toBe(1);
    run.press(0, 60, 10);
    run.release(0, 20);
    run.press(1, 64, 30);
    expect(run.step).toBe(1);
    run.press(0, 60, 40);
    expect(run.step).toBe(3);
    expect(run.complete).toBe(false);
    run.press(2, 67, 50);
    expect(run.complete).toBe(true);
    expect(run.elapsedMs).toBe(40);
  });
});

describe("local course progress", () => {
  it("tracks independence separately for each layout and preserves best attempts", () => {
    let progress = recordCourseRun({}, "major", "wicki", 3, true);
    progress = recordCourseRun(progress, "major", "wicki", 0, true);
    expect(progress.major.wicki).toMatchObject({ attempts: 2, bestMistakes: 0, independent: false });
    progress = recordCourseRun(progress, "major", "wicki", 0, false);
    progress = recordCourseRun(progress, "major", "harmonic", 1, false);
    expect(progress.major.wicki.independent).toBe(true);
    expect(progress.major.harmonic.independent).toBe(false);
    expect(parseCourseProgress(JSON.stringify(progress))).toEqual(progress);
  });
  it("merges a backup without losing newer achievements or doubling attempts", () => {
    let current = recordCourseRun({}, "major", "wicki", 0, false, "2026-09-16T00:00:00Z");
    current = recordCourseRun(current, "major", "wicki", 2, true, "2026-09-16T01:00:00Z");
    let backup = recordCourseRun({}, "major", "wicki", 3, true, "2026-09-15T00:00:00Z");
    backup = recordCourseRun(backup, "major", "janko", 0, false);
    const merged = mergeCourseProgress(current, backup);
    expect(merged.major.wicki).toEqual(current.major.wicki);
    expect(merged.major.janko).toEqual(backup.major.janko);
    expect(mergeCourseProgress(merged, backup)).toEqual(merged);
    expect(current.major.janko).toBeUndefined();
  });
  it("ignores corrupt, unknown, and invalid stored entries", () => {
    expect(parseCourseProgress("broken")).toEqual({});
    expect(parseCourseProgress("null")).toEqual({});
    expect(parseCourseProgress('{"major":{"bad":{"attempts":-1}},"unknown":{}}')).toEqual({});
  });
});
