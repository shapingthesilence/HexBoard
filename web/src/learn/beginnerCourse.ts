import { cueAccepts, lessonCues } from "./courseFiles.ts";
import { MajorScaleRun, majorScale, noteName } from "./majorScale.ts";

export interface KeyCue { note: number; button?: number; hand?: "left" | "right"; finger?: number; acceptDuplicates?: boolean }
export interface CourseLesson {
  id: string;
  title: string;
  section: string;
  instruction: string;
  targets: readonly (readonly number[])[];
  timing?: { bpm: number; beats: number[] };
  fingerings?: { layoutId: string; steps: KeyCue[][] }[];
}
const melody = (notes: readonly number[]) => notes.map(note => [note]);
export const beginnerLessons: readonly CourseLesson[] = [
  { id: "home", title: "Find home", section: "Notes", instruction: "A melody often feels settled when it returns to its home note, called the tonic. Here, C is home. Play C, then G, then C again, and listen for that feeling of return.", targets: melody([60, 67, 60]) },
  { id: "octaves", title: "Octaves", section: "Notes", instruction: "An octave is the distance between a note and its next higher or lower version. Recognizing octaves helps you move a melody into a comfortable range without changing its identity. Alternate low C and high C; notice their matching colors in Rainbow mode.", targets: melody([60, 72, 60, 72]) },
  { id: "half-steps", title: "Half steps", section: "Intervals", instruction: "An interval is the distance between two pitches. A half step is the smallest interval in 12-EDO, the tuning used in this course. Play C and C♯: learning this small movement helps you hear and find the building blocks of scales and chords.", targets: melody([60, 61, 60, 61, 60]) },
  { id: "whole-steps", title: "Whole steps", section: "Intervals", instruction: "A whole step spans two half steps. Major and minor scales combine these larger steps with half steps, so recognizing both helps you build scales from any starting note. Play C–D–E and back, listening to the equal distances.", targets: melody([60, 62, 64, 62, 60]) },
  { id: "thirds", title: "Major and minor thirds", section: "Intervals", instruction: "A third connects a scale note to the note two scale positions above it. Major thirds span four half steps; minor thirds span three. This one-step difference gives major and minor chords their different character. Compare C–E with C–E♭.", targets: melody([60, 64, 60, 63, 60, 64, 60, 63]) },
  { id: "fifths", title: "Perfect fifths", section: "Intervals", instruction: "A perfect fifth spans seven half steps and helps give many chords a stable foundation. C–G and D–A are both fifths. Play each pair in order and notice the repeated shape: recognizing intervals by shape helps you move musical ideas around the board.", targets: melody([60, 67, 62, 69, 60, 67]) },
  { id: "major", title: "Major scale", section: "Scales", instruction: "A scale is a set of notes organized around a home note. The major scale supplies the notes for many familiar melodies and chords. Play C major up to the next C; listen for the closer half steps at E–F and B–C.", targets: melody(majorScale) },
  { id: "major-return", title: "Up and back", section: "Scales", instruction: "Melodies move down as well as up. Practicing both directions helps you find notes smoothly instead of remembering only an ascending sequence. Climb C major and return, playing the top C just once; let notes overlap naturally.", targets: melody([...majorScale, ...majorScale.slice(0, -1).reverse()]) },
  { id: "pentatonic", title: "Minor pentatonic", section: "Scales", instruction: "Pentatonic means five notes per octave. The minor pentatonic scale is common in blues and rock, and its small set of notes makes a useful starting point for improvising. Play C, E♭, F, G, and B♭ up to the next C and back.", targets: melody([60, 63, 65, 67, 70, 72, 70, 67, 65, 63, 60]) },
  { id: "minor", title: "Natural minor", section: "Scales", instruction: "Natural minor offers a different collection of melodic and chord possibilities from major. In C, it lowers the third, sixth, and seventh: E♭, A♭, and B♭. Play the scale and compare its sound with the major scale you already know.", targets: melody([60, 62, 63, 65, 67, 68, 70, 72]) },
  { id: "arpeggio", title: "Major arpeggio", section: "Chords", instruction: "An arpeggio plays the notes of a chord one at a time. You can use it to turn a held chord into a flowing accompaniment or outline the harmony in a melody. Play C, E, and G up to the next C, then return.", targets: melody([60, 64, 67, 72, 67, 64, 60]) },
  { id: "major-triad", title: "Major triad", section: "Chords", instruction: "A triad is a three-note chord. C major combines its root C, major third E, and perfect fifth G. These chords are building blocks for accompanying songs. Hold all three together and release unrelated notes; listen to how the separate pitches blend.", targets: [[60, 64, 67]] },
  { id: "minor-triad", title: "Minor triad", section: "Chords", instruction: "A minor triad keeps the root and fifth of a major triad but lowers its third by a half step. This small change creates a different chord quality you can use in songs. Hold C, E♭, and G together, with other notes released.", targets: [[60, 63, 67]] },
  { id: "contrast", title: "Major to minor", section: "Chords", instruction: "Smooth chord changes often keep shared notes in place and move only what changes. Switch C major to C minor and back by moving E to E♭ while keeping C and G held. This builds efficient movement and trains your ear to hear chord quality.", targets: [[60, 64, 67], [60, 63, 67], [60, 64, 67]] },
  { id: "progression", title: "I–IV–V–I", section: "Progressions", instruction: "A chord progression is a sequence of chords that supports a song. Roman numerals name the scale degrees where the chords begin: in C major, I is C, IV is F, and V is G. Play C, F, G, then C major; listen to the final return home.", targets: [[60, 64, 67], [65, 69, 72], [67, 71, 74], [60, 64, 67]] },
];

// Single notes allow legato. Chords require all target pitches together, with
// no unrelated pitches held. Common tones may carry into the following chord.
export class CourseRun extends MajorScaleRun {
  private attacked = false;
  private lastEventAt = 0;
  constructor(readonly lesson: CourseLesson, readonly layoutId = "", label: (note: number) => string = noteName) {
    super(lesson.targets.map(target => target[0]), label);
    this.feedback = "Play the highlighted notes.";
  }
  get target() { return this.lesson.targets[this.step] ?? []; }
  override press(index: number, note: number, receivedAt = performance.now()) {
    if (this.complete || this.held.has(index)) return false;
    this.held.set(index, note);
    this.lastEventAt = receivedAt;
    if (!this.target.includes(note) || !cueAccepts(lessonCues(this.lesson, this.layoutId, this.step), index, note)) {
      this.mistakes++;
      this.feedback = `Try ${this.target.map(this.label).join(" + ")}.`;
    } else {
      this.startedAt ??= receivedAt;
      this.attacked = true;
      this.evaluate(receivedAt);
    }
    return true;
  }
  override release(index: number, receivedAt = this.lastEventAt) {
    const note = super.release(index);
    if (!this.complete && note !== undefined) this.evaluate(receivedAt);
    return note;
  }
  private evaluate(receivedAt: number) {
    if (!this.attacked) return;
    const held = [...this.held.values()];
    if (!this.target.every(note => [...this.held].some(([index, pitch]) => pitch === note && cueAccepts(lessonCues(this.lesson, this.layoutId, this.step), index, note)))) return;
    if (this.target.length > 1 && held.some(note => !this.target.includes(note))) {
      this.feedback = "Release the other notes.";
      return;
    }
    this.step++;
    this.attacked = false;
    if (this.complete) {
      this.finishedAt = receivedAt;
      this.feedback = "Lesson complete.";
    } else this.feedback = `Next: ${this.target.map(this.label).join(" + ")}.`;
  }
}

export interface LessonProgress { attempts: number; bestMistakes: number; independent: boolean; lastPlayed: string }
export type CourseProgress = Record<string, Record<string, LessonProgress>>;
export const courseProgressKey = "hexboard.learn.course.v1";
export function parseCourseProgress(raw: string | null): CourseProgress {
  try {
    const data = JSON.parse(raw ?? "{}");
    const result: CourseProgress = {};
    if (!data || typeof data !== "object" || Array.isArray(data)) return result;
    for (const lessonId of Object.keys(data)) {
      if (!beginnerLessons.some(lesson => lesson.id === lessonId) && !/^user:[a-zA-Z0-9_-]{1,80}:[1-9][0-9]*:[a-zA-Z0-9_-]{1,80}$/.test(lessonId)) continue;
      const entries = data[lessonId];
      if (!entries || typeof entries !== "object" || Array.isArray(entries)) continue;
      const layouts: Record<string, LessonProgress> = {};
      for (const [layout, value] of Object.entries(entries)) {
        if (["__proto__", "constructor", "prototype"].includes(layout)) continue;
        const p = value as LessonProgress | null;
        if (!p || typeof p !== "object" || !Number.isSafeInteger(p.attempts) || p.attempts < 1 || !Number.isSafeInteger(p.bestMistakes) || p.bestMistakes < 0 || typeof p.independent !== "boolean" || typeof p.lastPlayed !== "string" || !Number.isFinite(Date.parse(p.lastPlayed))) continue;
        Object.defineProperty(layouts, layout, { value: { attempts: p.attempts, bestMistakes: p.bestMistakes, independent: p.independent, lastPlayed: p.lastPlayed }, enumerable: true, configurable: true, writable: true });
      }
      if (Object.keys(layouts).length) result[lessonId] = layouts;
    }
    return result;
  } catch { return {}; }
}
export function recordCourseRun(progress: CourseProgress, lesson: string, layout: string, mistakes: number, hints: boolean, date = new Date().toISOString()): CourseProgress {
  const previous = progress[lesson]?.[layout];
  return { ...progress, [lesson]: { ...progress[lesson], [layout]: {
    attempts: (previous?.attempts ?? 0) + 1,
    bestMistakes: Math.min(previous?.bestMistakes ?? Infinity, mistakes),
    independent: previous?.independent === true || (!hints && mistakes === 0),
    lastPlayed: date
  } } };
}

// Import keeps the strongest achievements instead of adding duplicate attempts.
export function mergeCourseProgress(current: CourseProgress, restored: CourseProgress): CourseProgress {
  const merged = { ...current };
  for (const [id, layouts] of Object.entries(restored)) {
    merged[id] = { ...merged[id] };
    for (const [layout, entry] of Object.entries(layouts)) {
      const old = merged[id][layout];
      merged[id][layout] = old ? {
        attempts: Math.max(old.attempts, entry.attempts),
        bestMistakes: Math.min(old.bestMistakes, entry.bestMistakes),
        independent: old.independent || entry.independent,
        lastPlayed: old.lastPlayed > entry.lastPlayed ? old.lastPlayed : entry.lastPlayed
      } : entry;
    }
  }
  return merged;
}
