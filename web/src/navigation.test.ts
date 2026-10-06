import { afterEach, describe, expect, it, vi } from "vitest";
import { initialLocation, locationPath, parseLocation, saveLocation, storedLocation, type AppLocation } from "./navigation.ts";

function browser(hash = "", blocked = false) {
  const entries = new Map<string, string>();
  const location = { hash };
  const write = vi.fn((_state, _title, path: string) => { location.hash = path; });
  vi.stubGlobal("window", {
    location,
    history: { pushState: write, replaceState: write },
    localStorage: {
      getItem: (key: string) => { if (blocked) throw Error("blocked"); return entries.get(key) ?? null; },
      setItem: (key: string, value: string) => { if (blocked) throw Error("blocked"); entries.set(key, value); }
    }
  });
  return { location, write, entries };
}
afterEach(() => vi.unstubAllGlobals());

describe("navigation", () => {
  it("uses short mode and Learn-section URLs without course or lesson IDs", () => {
    expect(parseLocation(locationPath({ view: "layouts" }))).toEqual({ view: "layouts" });
    expect(parseLocation(locationPath({ view: "synth" }))).toEqual({ view: "synth" });
    expect(parseLocation(locationPath({ view: "calibration" }))).toEqual({ view: "calibration" });
    for (const page of ["practice", "course", "progress"] as const) {
      expect(locationPath({ view: "learn", page, courseId: "builtin:first-steps", lessonId: "a/b #é" })).toBe(`#/learn/${page === "course" ? "courses" : page}`);
    }
    expect(parseLocation("#/learn")).toEqual({ view: "learn", page: "practice" });
  });
  it("rejects detailed, malformed and unknown links", () => {
    for (const path of ["#/unknown", "#/learn/nope", "#/learn/course/id/lesson/note", "#/learn/%ZZ", "#/synth/extra"])
      expect(parseLocation(path)).toBeUndefined();
  });
  it("restores the last location after tab discard/reload and a fresh base-address visit", () => {
    const { location, write } = browser();
    const lesson: AppLocation = { view: "learn", page: "course", courseId: "builtin:first-steps", lessonId: "first-note" };
    saveLocation(lesson);
    expect(initialLocation()).toEqual(lesson);
    location.hash = "";
    expect(initialLocation()).toEqual(lesson);
    saveLocation({ view: "synth" });
    expect(storedLocation("learn")).toEqual(lesson);
    expect(write).toHaveBeenCalledTimes(2);
  });
  it("gives explicit bookmarks priority over the last visited screen", () => {
    const { location } = browser();
    saveLocation({ view: "synth" });
    location.hash = "#/learn";
    expect(initialLocation()).toEqual({ view: "learn", page: "practice" });
    location.hash = "#/unknown";
    expect(initialLocation()).toEqual({ view: "layouts" });
  });
  it("saves lesson changes without history and navigates between Learn sections", () => {
    const { location, write } = browser();
    const lesson: AppLocation = { view: "learn", page: "course", courseId: "builtin:first-steps", lessonId: "a/b #é" };
    saveLocation({ ...lesson, lessonId: "first-note" });
    saveLocation(lesson);
    saveLocation({ ...lesson, page: "progress" });
    expect(location.hash).toBe("#/learn/progress");
    expect(write).toHaveBeenCalledTimes(2);
    expect(initialLocation()).toEqual({ ...lesson, page: "progress" });
    saveLocation({ view: "synth" });
    location.hash = "#/learn/progress"; // Browser Back to the section.
    expect(initialLocation()).toEqual({ ...lesson, page: "progress" });
  });
  it("opens an explicit Learn section while retaining the last course and lesson", () => {
    const { location } = browser();
    const saved: AppLocation = { view: "learn", page: "progress", courseId: "builtin:first-steps", lessonId: "home" };
    saveLocation(saved);
    for (const [path, page] of [["#/learn/practice", "practice"], ["#/learn/courses", "course"], ["#/learn/progress", "progress"]]) {
      location.hash = path;
      expect(initialLocation()).toEqual({ ...saved, page });
    }
    location.hash = "#/learn";
    expect(initialLocation()).toEqual(saved);
  });
  it("ignores corrupt saved locations", () => {
    const { entries } = browser();
    for (const value of ["bad JSON", "null", '{"view":"unknown"}', '{"view":"learn","page":"nope"}', '{"view":"learn","page":"course","lessonId":4}']) {
      entries.set("hexboard-sync-location", value);
      expect(initialLocation()).toEqual({ view: "layouts" });
    }
  });
  it("does not add duplicate history and works without browser storage", () => {
    const { write } = browser("#/layouts", true);
    expect(initialLocation()).toEqual({ view: "layouts" });
    saveLocation({ view: "layouts" });
    expect(write).not.toHaveBeenCalled();
    saveLocation({ view: "synth" });
    expect(write).toHaveBeenCalledTimes(1);
    expect(initialLocation()).toEqual({ view: "synth" });
  });
});
