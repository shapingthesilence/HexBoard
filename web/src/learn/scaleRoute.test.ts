import { describe, expect, it } from "vitest";
import { recommendCourseRoute } from "./curriculumKeys.ts";
import { majorScale, resolveLessonKeys, starterLayouts } from "./majorScale.ts";
import { scalePatternNotes } from "./scalePractice.ts";
import { routeKeyLight, scaleRoute } from "./scaleRoute.ts";

const lesson = { id: "major", title: "Major", section: "Scales", instruction: "", targets: majorScale.map(note => [note]) };

describe("scale routes", () => {
  it("finds the compact course shape on each starter layout from the same root", () => {
    const course = recommendCourseRoute(lesson);
    for (const layout of starterLayouts()) {
      const steps = course.fingerings!.find(item => item.layoutId === layout.layout.objectIdHex)!.steps;
      const expected = new Map(steps.map(([cue]) => [cue.note, cue.button!]));
      expect(scaleRoute(resolveLessonKeys(layout), majorScale, expected.get(60)!), layout.layout.name).toEqual(expected);
    }
  });

  it("anchors on the first note of the pattern, including from the top", () => {
    const keys = resolveLessonKeys(starterLayouts()[0]);
    const notes = scalePatternNotes("descending", majorScale);
    const top = keys.find(key => key.note === 72)!.key.index;
    const route = scaleRoute(keys, notes, top)!;
    expect(route.get(72)).toBe(top);
    expect([...route.keys()].sort((a, b) => a - b)).toEqual([...majorScale]);
    expect(scaleRoute(keys, notes, keys.find(key => key.note === 60)!.key.index)).toBeUndefined();
  });

  it("lights the next key, the trail and the shape, and dims other copies", () => {
    const keys = resolveLessonKeys(starterLayouts()[0]);
    const anchor = keys.find(key => key.note === 60)!.key.index;
    const route = scaleRoute(keys, majorScale, anchor)!;
    const d = keys[route.get(62)!], e = keys[route.get(64)!];
    const copy = keys.find(key => key.note !== null && route.has(key.note) && route.get(key.note) !== key.key.index)!;
    expect(routeKeyLight(e, "target", route, d.key.index)).toBe("target");
    expect(routeKeyLight(d, "rest", route, d.key.index)).toBe("trail");
    expect(routeKeyLight(keys[anchor], "rest", route, d.key.index)).toBe("shape");
    expect(routeKeyLight(copy, "target", route, d.key.index)).toBe("outside");
    expect(routeKeyLight(d, "held", route, d.key.index)).toBe("held");
  });
});
