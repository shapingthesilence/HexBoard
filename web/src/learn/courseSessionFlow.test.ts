import { describe, expect, it } from "vitest";
import { autoStartLesson, afterExample, repeatTempo } from "./courseSessionFlow.ts";

describe("course session flow", () => {
  it("keeps a completed lesson navigable after an example", () => {
    expect(afterExample(true, true)).toBe("complete");
    expect(afterExample(true, false)).toBe("complete");
    expect(afterExample(true, true, true)).toBe("complete");
    expect(afterExample(true, false, true)).toBe("complete");
  });
  it("waits for a start press when entering a timed lesson, even with an active board session", () => {
    const timed = { timing: { goalBpm: 60, beats: [1] } };
    expect(autoStartLesson(timed, true)).toBe(false);
    expect(autoStartLesson(timed, false)).toBe(false);
    expect(autoStartLesson({kind:"content"}, true)).toBe(false);
    expect(autoStartLesson({}, true)).toBe(true);
    expect(autoStartLesson({}, false)).toBe(false);
    expect(autoStartLesson({kind:"exploration"}, true)).toBe(true);
  });
  it("waits for a start press after a timed example", () => {
    expect(afterExample(false, true, true)).toBe("ready");
    expect(afterExample(false, false, true)).toBe("ready");
  });
  it("resumes board practice after an example and leaves screen preview ready", () => {
    expect(afterExample(false, true)).toBe("restart");
    expect(afterExample(false, false)).toBe("ready");
  });
  it("moves Step and slow rehearsals to goal tempo on the next repeat", () => {
    expect(repeatTempo(19, 60, 19)).toBe(60);
    expect(repeatTempo(50, 60, 19)).toBe(60);
    expect(repeatTempo(60, 60, 19)).toBe(60);
    expect(repeatTempo(80, 60, 19)).toBe(80);
    expect(repeatTempo(50, undefined, 19)).toBe(50);
  });
});
