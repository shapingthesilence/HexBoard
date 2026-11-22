import { describe, expect, it } from "vitest";
import { recommendCourseRoute } from "./curriculumKeys.ts";
import { lessonLayouts, majorScale, resolveLessonKeys, starterLayouts } from "./majorScale.ts";
import { scalePatternNotes } from "./scalePractice.ts";
import { centralScaleAnchor, moveScaleShape, routeKeyLight, scaleRoute, scaleShapes } from "./scaleRoute.ts";
import { scaleSteps, tuningPitch } from "./tuningPractice.ts";
import { parseTuningBundleFile } from "../catalogs/layoutsCatalog.ts";
import thirtyOne from "../../../factory-library/geometry/31 EDO.json";
import bohlenPierce from "../../../factory-library/geometry/Bohlen-Pierce.json";

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

  it("fades to the shape and then to its roots", () => {
    const keys = resolveLessonKeys(starterLayouts()[0]);
    const anchor = keys.find(key => key.note === 60)!.key.index;
    const route = scaleRoute(keys, majorScale, anchor)!;
    const d = keys[route.get(62)!], e = keys[route.get(64)!], top = keys[route.get(72)!];
    const isRoot = (pitch: number) => pitch % 12 === 0;
    expect(routeKeyLight(e, "target", route, d.key.index, "shape", isRoot)).toBe("shape");
    expect(routeKeyLight(d, "rest", route, d.key.index, "shape", isRoot)).toBe("trail");
    expect(routeKeyLight(d, "rest", route, d.key.index, "root", isRoot)).toBe("outside");
    expect(routeKeyLight(e, "target", route, d.key.index, "root", isRoot)).toBe("outside");
    expect([routeKeyLight(keys[anchor], "rest", route, d.key.index, "root", isRoot), routeKeyLight(top, "rest", route, undefined, "root", isRoot)]).toEqual(["shape", "shape"]);
    expect(routeKeyLight(e, "wrong", route, d.key.index, "root", isRoot)).toBe("wrong");
  });

  it("offers distinct compact shapes, best first, and moves a shape between root copies", () => {
    let moves = 0;
    for (const layout of starterLayouts()) {
      const keys = resolveLessonKeys(layout);
      const anchor = centralScaleAnchor(keys, majorScale)!;
      const shapes = scaleShapes(keys, majorScale, anchor);
      expect(shapes[0]).toEqual(scaleRoute(keys, majorScale, anchor));
      expect(new Set(shapes.map(shape => [...shape.values()].join())).size).toBe(shapes.length);
      for (const shape of shapes) for (const [pitch, index] of shape) expect(keys[index].note).toBe(pitch);
      const offset = (shape: ReadonlyMap<number, number>, from: number) => [...shape].map(([, index]) => `${keys[index].key.coordCol - keys[from].key.coordCol},${keys[index].key.row - keys[from].key.row}`);
      for (const shape of shapes) for (const other of keys.filter(key => key.note === 60 && key.key.index !== anchor)) {
        const moved = moveScaleShape(keys, shape, anchor, other.key.index);
        if (!moved) continue;
        expect(offset(moved, other.key.index)).toEqual(offset(shape, anchor));
        moves++;
      }
    }
    const gerhard = resolveLessonKeys(starterLayouts().find(layout => layout.layout.name === "Gerhard")!);
    expect(scaleShapes(gerhard, majorScale, centralScaleAnchor(gerhard, majorScale)!).length).toBeGreaterThan(1);
    expect(moves).toBeGreaterThan(0);
  });

  it("builds a playable shape in microtonal and non-octave tunings", () => {
    for (const file of [thirtyOne, bohlenPierce]) {
      const bundle = parseTuningBundleFile(file);
      const scale = bundle.scales.find(item => item.name !== "All Notes")!;
      const notes = scaleSteps(bundle, scale, bundle.tuning.defaultKeyDegree).map(step => tuningPitch(bundle.tuning, step));
      for (const layout of lessonLayouts(bundle)) {
        const keys = resolveLessonKeys(layout);
        if (notes.some(note => !keys.some(key => key.note === note))) continue;
        const anchor = centralScaleAnchor(keys, notes);
        expect(anchor, `${bundle.tuning.name} ${layout.layout.name}`).toBeDefined();
        const route = scaleRoute(keys, notes, anchor!)!;
        expect([...route.keys()].sort((a, b) => a - b)).toEqual([...new Set(notes)].sort((a, b) => a - b));
        for (const [pitch, index] of route) expect(keys[index].note).toBe(pitch);
      }
    }
  });
});
