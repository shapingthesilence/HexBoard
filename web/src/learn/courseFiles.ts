import { parseTuningBundleFile, TuningBundleFileFormat, type TuningBundle, type TuningBundleLayout } from "../catalogs/layoutsCatalog.ts";
import { resolveLessonKeys, type LessonKey, type KeyLight } from "./majorScale.ts";
import type { CourseLesson, KeyCue } from "./beginnerCourse.ts";

export const courseFormat = "hexboard.course.v2";
export const courseLibraryKey = "hexboard.learn.courses.v2";
export const maxCourseBytes = 2_000_000;
export interface UserCourse {
  format: typeof courseFormat;
  id: string;
  revision: number;
  title: string;
  author: string;
  bundle: TuningBundle;
  layoutId?: string;
  lessons: CourseLesson[];
}
const identifier = /^[a-zA-Z0-9_-]{1,80}$/;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a course object.");
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max: number, optional = false): string {
  if (typeof value !== "string" || value.length > max || (!optional && !value.trim())) throw new Error(`${label} must be ${optional ? "up to" : "1–"}${max} characters.`);
  return value.trim();
}
function id(value: unknown): string {
  if (typeof value !== "string" || !identifier.test(value)) throw new Error("Invalid course or lesson ID.");
  return value;
}
export function parseCourse(value: unknown): UserCourse {
  const input = object(value);
  if (input.format !== courseFormat) throw new Error("Unsupported course file. Choose a HexBoard course JSON.");
  const bundle = parseTuningBundleFile({ format: TuningBundleFileFormat, tuningBundle: input.bundle });
  const layoutId = input.layoutId === undefined ? undefined : text(input.layoutId, "Layout ID", 32);
  if (layoutId && !bundle.layouts.some(layout => layout.objectIdHex === layoutId)) throw new Error("The required layout is missing from this course.");
  if (!Number.isSafeInteger(input.revision) || Number(input.revision) < 1) throw new Error("Invalid course revision.");
  if (!Array.isArray(input.lessons) || !input.lessons.length || input.lessons.length > 100) throw new Error("A course needs 1–100 lessons.");
  const lessons = input.lessons.map((raw): CourseLesson => {
    const lesson = object(raw);
    if (!Array.isArray(lesson.targets) || !lesson.targets.length || lesson.targets.length > 256) throw new Error("Each lesson needs 1–256 steps.");
    const targets = lesson.targets.map(rawNotes => {
      if (!Array.isArray(rawNotes) || rawNotes.length > 10 || rawNotes.some(note => typeof note !== "number" || !Number.isFinite(note) || note < 0 || note > 127) || new Set(rawNotes).size !== rawNotes.length) throw new Error("Each step needs 1–10 distinct pitches between 0 and 127.");
      return rawNotes as number[];
    });
    let timeSignature: CourseLesson["timeSignature"];
    if (lesson.timeSignature !== undefined) {
      const meter = object(lesson.timeSignature);
      if (!Number.isInteger(meter.numerator) || Number(meter.numerator) < 1 || Number(meter.numerator) > 16 || ![2,4,8,16].includes(Number(meter.denominator)) || typeof meter.denominator !== "number") throw new Error("Time signature needs 1–16 beats per bar and a denominator of 2, 4, 8, or 16.");
      timeSignature = { numerator: Number(meter.numerator), denominator: meter.denominator };
    }
    let timing: CourseLesson["timing"];
    if (lesson.timing !== undefined) {
      const t = object(lesson.timing);
      if (typeof t.goalBpm !== "number" || !Number.isInteger(t.goalBpm) || t.goalBpm < 20 || t.goalBpm > 300 || !Array.isArray(t.beats) || t.beats.length !== targets.length || t.beats.some(beats => typeof beats !== "number" || !Number.isFinite(beats) || !Number.isInteger(beats * 4) || beats < 0.25 || beats > 8)) throw new Error("Timing needs 20–300 BPM. Step spacing must be 0.25 to 8 quarter-note beats, in increments of 0.25.");
      let holdBeats: number[][] | undefined;
      if (t.holdBeats !== undefined) {
        if (!Array.isArray(t.holdBeats) || t.holdBeats.length !== targets.length || t.holdBeats.some((row, index) => !Array.isArray(row) || row.length !== targets[index].length || row.some(value => typeof value !== "number" || value < 0.25 || value > 32 || !Number.isInteger(value * 4)))) throw new Error("Each note length must be 0.25 to 32 quarter-note beats, in increments of 0.25.");
        holdBeats = t.holdBeats as number[][];
      }
      timing = { goalBpm: t.goalBpm, beats: t.beats as number[], holdBeats };
    }
    if (!targets.some(notes => notes.length)) throw new Error("A lesson needs at least one played note.");
    if (!timing && targets.some(notes => !notes.length)) throw new Error("Fill or remove blank steps before saving a free-timing lesson.");
    const fingerings: NonNullable<CourseLesson["fingerings"]> = [];
    if (lesson.fingerings !== undefined) {
      if (!Array.isArray(lesson.fingerings) || lesson.fingerings.length > bundle.layouts.length) throw new Error("Invalid layout fingerings.");
      for (const rawFingering of lesson.fingerings) {
        const fingering = object(rawFingering);
        const layout = bundle.layouts.find(layout => layout.objectIdHex === fingering.layoutId);
        if (!layout || fingerings.some(item => item.layoutId === layout.objectIdHex) || !Array.isArray(fingering.steps) || fingering.steps.length !== targets.length) throw new Error("Fingering steps must match the lesson and an included layout.");
        const keys = resolveLessonKeys({ id: layout.objectIdHex, label: layout.name, layout, bundle });
        const steps = fingering.steps.map((rawCues, step) => {
          if (!Array.isArray(rawCues) || rawCues.length > targets[step].length) throw new Error("Invalid fingering notes.");
          const seen = new Set<number>();
          return rawCues.map((rawCue): KeyCue => {
            const cue = object(rawCue);
            if (typeof cue.note !== "number" || !targets[step].includes(cue.note) || seen.has(cue.note)) throw new Error("Fingering pitch is not in this step.");
            seen.add(cue.note);
            if (cue.button !== undefined && (!Number.isInteger(cue.button) || keys[Number(cue.button)]?.note !== cue.note)) throw new Error("Preferred key must play the assigned pitch on its layout.");
            if (cue.hand !== undefined && cue.hand !== "left" && cue.hand !== "right") throw new Error("Hand must be left or right.");
            if (cue.finger !== undefined && (!Number.isInteger(cue.finger) || Number(cue.finger) < 1 || Number(cue.finger) > 5)) throw new Error("Finger must be 1–5 (thumb to little finger).");
            if (cue.acceptDuplicates !== undefined && typeof cue.acceptDuplicates !== "boolean") throw new Error("Invalid duplicate-key rule.");
            return { note: cue.note, button: cue.button as number | undefined, hand: cue.hand as KeyCue["hand"], finger: cue.finger as number | undefined, acceptDuplicates: cue.acceptDuplicates !== false };
          });
        });
        fingerings.push({ layoutId: layout.objectIdHex, steps });
      }
    }
    // A layout-specific course must be fully playable on that layout. An open
    // course can ship several layouts; at least one must cover the whole lesson.
    const candidates = bundle.layouts.filter(layout => !layoutId || layout.objectIdHex === layoutId);
    if (!candidates.some(layout => {
      const keys = resolveLessonKeys({ id: layout.objectIdHex, label: layout.name, layout, bundle });
      return targets.flat().every(note => keys.some(key => key.note === note));
    })) throw new Error("This lesson has pitches missing from its layouts. Choose available notes or a wider layout.");
    return { id: id(lesson.id), title: text(lesson.title, "Lesson title", 100), section: text(lesson.section ?? "My lessons", "Section", 80), instruction: text(lesson.instruction, "Lesson explanation", 2000), targets, timing, timeSignature, fingerings };
  });
  if (new Set(lessons.map(lesson => lesson.id)).size !== lessons.length) throw new Error("Lesson IDs must be unique.");
  return { format: courseFormat, id: id(input.id), revision: Number(input.revision), title: text(input.title, "Course title", 100), author: text(input.author ?? "", "Author", 100, true), bundle, layoutId, lessons };
}
export function readCourseFile(raw: string): UserCourse {
  if (new TextEncoder().encode(raw).length > maxCourseBytes) throw new Error("Course files must be smaller than 2 MB.");
  return parseCourse(JSON.parse(raw));
}
export function readCourseLibrary(raw: string | null): UserCourse[] {
  try {
    const values: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(values)) return [];
    return values.slice(0, 50).flatMap(value => { try { return [parseCourse(value)]; } catch { return []; } });
  } catch { return []; }
}
export function courseProgressId(course: UserCourse | undefined, lessonId: string) {
  const lesson = course?.lessons.find(item => item.id === lessonId);
  return course && lesson ? `user:${course.id}:${assessmentFingerprint(course, lesson)}:${lessonId}` : lessonId;
}
export function lessonCues(lesson: CourseLesson, layoutId: string, step: number): readonly KeyCue[] {
  return lesson.fingerings?.find(item => item.layoutId === layoutId)?.steps[step] ?? [];
}
export function cueAccepts(cues: readonly KeyCue[], index: number, note: number) {
  const cue = cues.find(cue => cue.note === note);
  return !cue || cue.button === undefined || cue.acceptDuplicates !== false || cue.button === index;
}
export function cueLabel(cue: KeyCue): string {
  return `${cue.hand === "left" ? "L" : cue.hand === "right" ? "R" : ""}${cue.finger ?? ""}`;
}
export function courseKeyLight(key: LessonKey, cues: readonly KeyCue[], state: KeyLight): KeyLight {
  const cue = cues.find(cue => cue.note === key.note);
  return state === "target" && cue?.button !== undefined && cue.button !== key.key.index ? "alternate" : state;
}

// A short, readable entry format for song segments; stored files keep numeric
// pitches so interpretation never depends on locale or enharmonic spelling.
export function parsePhrase(source: string): { targets: number[][]; beats: number[] } {
  const tokens = source.trim().match(/\[[^\]]*\](?::[0-9.]+)?|[^\s]+/g) ?? [];
  if (!tokens.length || tokens.length > 256) throw new Error("Enter 1–256 notes, chords, or rests.");
  const targets: number[][] = [], beats: number[] = [];
  for (const token of tokens) {
    const match = token.match(/^(\[[^\]]+\]|[^:]+)(?::([0-9.]+))?$/);
    if (!match) throw new Error(`Could not read ${token}. Use C4, C4:2, [C4 E4 G4], or - for a rest.`);
    const body = match[1];
    const names = body === "-" ? [] : body.startsWith("[") ? body.slice(1, -1).trim().split(/\s+/) : [body];
    const notes = names.map(name => {
      const n = name.match(/^([A-Ga-g])([#♯b♭]?)(-?\d+)$/);
      if (!n) throw new Error(`Unknown note ${name}. Include its octave, for example C4.`);
      const pitch = (Number(n[3]) + 1) * 12 + ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[n[1].toUpperCase()]!) + (/[#♯]/.test(n[2]) ? 1 : /[b♭]/.test(n[2]) ? -1 : 0);
      if (pitch < 0 || pitch > 127) throw new Error(`Note ${name} is out of range.`);
      return pitch;
    });
    if (notes.length > 10 || new Set(notes).size !== notes.length) throw new Error("Use up to ten distinct notes in a chord.");
    const duration = Number(match[2] ?? 1);
    if (!Number.isInteger(duration * 4) || duration < 0.25 || duration > 8) throw new Error("Lengths must be 0.25 to 8 quarter notes, in increments of one sixteenth note.");
    targets.push(notes); beats.push(duration);
  }
  return { targets, beats };
}

// Only graded content participates: prose, ordering, fingering advice and
// playback-only holds can change without erasing an achievement.
export function assessmentFingerprint(course: UserCourse, lesson: CourseLesson): string {
  const strict = (lesson.fingerings ?? []).map(item => ({ layoutId: item.layoutId, steps: item.steps.map(cues => cues.filter(cue => cue.button !== undefined && cue.acceptDuplicates === false).map(cue => ({note:cue.note,button:cue.button})).sort((a,b)=>a.note-b.note)) })).filter(item => item.steps.some(cues=>cues.length)).sort((a,b)=>a.layoutId.localeCompare(b.layoutId));
  const value = JSON.stringify({ targets: lesson.targets.map(notes=>[...notes].sort((a,b)=>a-b)), timing: lesson.timing ? {goalBpm:lesson.timing.goalBpm,beats:lesson.timing.beats} : undefined, strict, requiredLayout:course.layoutId });
  return contentHash(value);
}
function contentHash(value:string) {
  let a = 0x811c9dc5, b = 0x9e3779b9;
  for (let i=0;i<value.length;i++) { a = Math.imul(a ^ value.charCodeAt(i),16777619); b = Math.imul(b ^ value.charCodeAt(i),2246822519); }
  return [a,b].map(n=>(n>>>0).toString(16).padStart(8,"0")).join("");
}
export function canPassTimedLesson(lesson: CourseLesson, practiceBpm: number, score: number, missed: number) {
  return !!lesson.timing && practiceBpm >= lesson.timing.goalBpm && score >= 75 && missed === 0;
}

export function courseLayoutProgressId(bundle:TuningBundle,layout:TuningBundleLayout):string {
  const pitches=resolveLessonKeys({id:layout.objectIdHex,label:layout.name,bundle,layout}).map(key=>key.note);
  return `${bundle.objectIdHex}:${layout.objectIdHex}:${contentHash(JSON.stringify(pitches))}`;
}
