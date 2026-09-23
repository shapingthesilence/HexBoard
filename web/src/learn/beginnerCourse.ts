import { answerLabel, answerAllows, matchAnswer, type StepAnswer, type Exploration } from "./lessonAnswers.ts";
import { cueAccepts, lessonCues } from "./courseFiles.ts";
import { MajorScaleRun, noteName } from "./majorScale.ts";

export interface KeyCue { note: number; button?: number; hand?: "left" | "right"; finger?: number; acceptDuplicates?: boolean }
export interface CourseLesson {
  kind?: "practice" | "content" | "exploration";
  answers?: (StepAnswer | null)[];
  exploration?: Exploration;
  markdown?: string;
  layoutId?: string;
  repetitions?: number;
  assessment?: {graded?:boolean;passingScore?:number;requireButtons?:boolean;trackIndependence?:boolean};
  id: string;
  title: string;
  section: string;
  instruction: string;
  targets: readonly (readonly number[])[];
  timeSignature?: { numerator: number; denominator: number };
  timing?: { goalBpm: number; beats: number[]; holdBeats?: number[][]; gradeDuration?: boolean; releaseWindowBeats?: number };
  fingerings?: { layoutId: string; steps: KeyCue[][] }[];
}
// Single notes allow legato. Chords require all target pitches together, with
// no unrelated pitches held. Common tones may carry into the following chord.
export class CourseRun extends MajorScaleRun {
  private attacked = false;
  private lastEventAt = 0;
  constructor(readonly lesson: CourseLesson, readonly layoutId = "", label: (note: number) => string = noteName) {
    // Blank timed steps are rests. Use a numeric sentinel so formatting cannot
    // receive undefined; skipRests advances past rests before interaction.
    super(lesson.targets.map(target => target[0] ?? -1), label);
    this.skipRests();
    this.feedback = "Play the highlighted notes.";
  }
  get target() { return this.lesson.targets[this.step] ?? []; }
  private skipRests() {
    while (this.step < this.lesson.targets.length && this.lesson.targets[this.step].length === 0) this.step++;
  }
  override press(index: number, note: number, receivedAt = performance.now()) {
    if (this.complete || this.held.has(index)) return false;
    this.held.set(index, note);
    this.lastEventAt = receivedAt;
    if (!answerAllows(this.target, this.lesson.answers?.[this.step], note) || !cueAccepts(lessonCues(this.lesson, this.layoutId, this.step), index, note)) {
      this.mistakes++;
      this.feedback = `Try ${answerLabel(this.target,this.lesson.answers?.[this.step],this.label)}.`;
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
    if (!matchAnswer(this.target, this.lesson.answers?.[this.step], this.held,
      (index,note)=>cueAccepts(lessonCues(this.lesson,this.layoutId,this.step),index,note))) {
      if (held.length) this.feedback = "Release the other notes.";
      return;
    }
    this.step++;
    this.skipRests();
    this.attacked = false;
    if (this.complete) {
      this.finishedAt = receivedAt;
      this.feedback = "Lesson complete.";
    } else this.feedback = `Next: ${answerLabel(this.target,this.lesson.answers?.[this.step],this.label)}.`;
  }
}

export interface LessonProgress { attempts: number; bestMistakes: number; independent: boolean; lastPlayed: string; bestPassingScore?: number; highestPassedBpm?: number }
export type CourseProgress = Record<string, Record<string, LessonProgress>>;
export const courseProgressKey = "hexboard.learn.course.v1";
export function parseCourseProgress(raw: string | null): CourseProgress {
  try {
    const data = JSON.parse(raw ?? "{}");
    const result: CourseProgress = {};
    if (!data || typeof data !== "object" || Array.isArray(data)) return result;
    for (const lessonId of Object.keys(data)) {
      if (!["home", "octaves", "half-steps", "whole-steps", "thirds", "fifths", "major", "major-return", "pentatonic", "minor", "arpeggio", "major-triad", "minor-triad", "contrast", "progression"].includes(lessonId) && !/^user:[a-zA-Z0-9_-]{1,80}:[a-f0-9]{16}:[a-zA-Z0-9_-]{1,80}$/.test(lessonId)) continue;
      const entries = data[lessonId];
      if (!entries || typeof entries !== "object" || Array.isArray(entries)) continue;
      const layouts: Record<string, LessonProgress> = {};
      for (const [layout, value] of Object.entries(entries)) {
        if (["__proto__", "constructor", "prototype"].includes(layout)) continue;
        const p = value as LessonProgress | null;
        if (!p || typeof p !== "object" || !Number.isSafeInteger(p.attempts) || p.attempts < 1 || !Number.isSafeInteger(p.bestMistakes) || p.bestMistakes < 0 || typeof p.independent !== "boolean" || typeof p.lastPlayed !== "string" || !Number.isFinite(Date.parse(p.lastPlayed))) continue;
        Object.defineProperty(layouts, layout, { value: { attempts: p.attempts, bestMistakes: p.bestMistakes, independent: p.independent, lastPlayed: p.lastPlayed, bestPassingScore: Number.isFinite(p.bestPassingScore) ? Math.max(0, Math.min(100, p.bestPassingScore!)) : undefined, highestPassedBpm: Number.isFinite(p.highestPassedBpm) ? Math.max(20, Math.min(300, p.highestPassedBpm!)) : undefined }, enumerable: true, configurable: true, writable: true });
      }
      if (Object.keys(layouts).length) result[lessonId] = layouts;
    }
    return result;
  } catch { return {}; }
}
export function recordCourseRun(progress: CourseProgress, lesson: string, layout: string, mistakes: number, hints: boolean, date = new Date().toISOString(), passing?: { score: number; bpm: number }): CourseProgress {
  const previous = progress[lesson]?.[layout];
  return { ...progress, [lesson]: { ...progress[lesson], [layout]: {
    attempts: (previous?.attempts ?? 0) + 1,
    bestMistakes: Math.min(previous?.bestMistakes ?? Infinity, mistakes),
    independent: previous?.independent === true || (!hints && mistakes === 0),
    lastPlayed: date,
    bestPassingScore: passing ? Math.max(previous?.bestPassingScore ?? 0, passing.score) : previous?.bestPassingScore,
    highestPassedBpm: passing ? Math.max(previous?.highestPassedBpm ?? 0, passing.bpm) : previous?.highestPassedBpm
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
        lastPlayed: old.lastPlayed > entry.lastPlayed ? old.lastPlayed : entry.lastPlayed,
        bestPassingScore: old.bestPassingScore === undefined && entry.bestPassingScore === undefined ? undefined : Math.max(old.bestPassingScore ?? 0, entry.bestPassingScore ?? 0),
        highestPassedBpm: old.highestPassedBpm === undefined && entry.highestPassedBpm === undefined ? undefined : Math.max(old.highestPassedBpm ?? 0, entry.highestPassedBpm ?? 0)
      } : entry;
    }
  }
  return merged;
}
