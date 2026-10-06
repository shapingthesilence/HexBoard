export type ViewKey = "synth" | "layouts" | "learn" | "calibration";
export interface LearnLocation {
  view: "learn";
  page: "practice" | "course" | "progress";
  courseId?: string;
  lessonId?: string;
}
export type AppLocation = LearnLocation | { view: "synth" | "layouts" | "calibration" };
const storageKey = "hexboard-sync-location";

// Hash paths work on GitHub Pages without a server fallback.
export function locationPath(location: AppLocation): string {
  return location.view === "learn" ? `#/learn/${location.page === "course" ? "courses" : location.page}` : `#/${location.view}`;
}
export function parseLocation(hash: string): AppLocation | undefined {
  if (hash === "#/learn") return { view: "learn", page: "practice" };
  if (hash === "#/learn/practice") return { view: "learn", page: "practice" };
  if (hash === "#/learn/courses") return { view: "learn", page: "course" };
  if (hash === "#/learn/progress") return { view: "learn", page: "progress" };
  if (hash === "#/synth") return { view: "synth" };
  if (hash === "#/calibration") return { view: "calibration" };
  if (hash === "#/layouts") return { view: "layouts" };
  return undefined;
}
export function storedLocation(view?: ViewKey): AppLocation | undefined {
  try {
    const value = JSON.parse(window.localStorage.getItem(view ? `${storageKey}.${view}` : storageKey) ?? "null");
    if (!value || (view && value.view !== view)) return undefined;
    if (value.view === "layouts" || value.view === "synth" || value.view === "calibration") return { view: value.view };
    if (value.view !== "learn" || !["practice", "course", "progress"].includes(value.page)) return undefined;
    if ((value.courseId !== undefined && (typeof value.courseId !== "string" || !value.courseId)) ||
        (value.lessonId !== undefined && (typeof value.lessonId !== "string" || !value.lessonId))) return undefined;
    return { view: "learn", page: value.page,
      ...(value.courseId ? { courseId: value.courseId } : {}),
      ...(value.lessonId ? { lessonId: value.lessonId } : {}) };
  }
  catch { return undefined; }
}
export function initialLocation(): AppLocation {
  // Explicit sections win while course/lesson selections stay local to this browser.
  if (!window.location.hash) return storedLocation() ?? { view: "layouts" };
  const mode = parseLocation(window.location.hash);
  if (!mode) return { view: "layouts" };
  const saved = storedLocation(mode.view);
  if (mode.view === "learn" && saved?.view === "learn") {
    return { ...saved, page: window.location.hash === "#/learn" ? saved.page : mode.page };
  }
  return saved ?? mode;
}
export function saveLocation(location: AppLocation, replace = false): void {
  const path = locationPath(location);
  if (window.location.hash !== path) window.history[replace ? "replaceState" : "pushState"](null, "", path);
  try {
    const saved = JSON.stringify(location);
    window.localStorage.setItem(storageKey, saved);
    window.localStorage.setItem(`${storageKey}.${location.view}`, saved);
  } catch { /* URLs still work when storage is unavailable. */ }
}
