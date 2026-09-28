import { describe, expect, it } from "vitest";
import { afterExample, repeatTempo } from "./courseSessionFlow.ts";

describe("course session flow", () => {
  it("keeps a completed lesson navigable after an example", () => {
    expect(afterExample(true, true)).toBe("complete");
    expect(afterExample(true, false)).toBe("complete");
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
