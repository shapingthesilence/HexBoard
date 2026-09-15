import { majorScale, noteName } from "./majorScale.ts";

export const scalePatterns = {
  ascending: "Ascending", descending: "Descending", upDown: "Up and down",
  downUp: "Down and up", thirds: "Skip one scale tone"
} as const;
export type ScalePattern = keyof typeof scalePatterns;
export function scalePatternNotes(pattern: ScalePattern, scale: readonly number[] = majorScale): number[] {
  const up = [...scale], down = [...up].reverse();
  switch (pattern) {
    case "descending": return down;
    case "upDown": return [...up, ...down.slice(1)];
    case "downUp": return [...down, ...up.slice(1)];
    case "thirds": return [...up.slice(0, -2).flatMap((note, i) => [note, up[i + 2]]), ...up.slice(-2)];
    default: return up;
  }
}
export interface BeatResult {
  score: number;
  grade: string;
  hits: number;
  missed: number;
  extras: number;
  meanErrorMs: number | null;
  biasMs: number | null;
}

// Each attack belongs to one fixed beat window. An octave-correct note a
// whole beat late cannot satisfy the previous target or slide the time grid.
export class BeatScaleRun {
  readonly held = new Map<number, number>();
  readonly errors: (number | undefined)[];
  readonly periodMs: number;
  step = 0;
  mistakes = 0;
  feedback = "Listen to four count-in clicks, then play one note per click.";
  private now: number;
  private firstHit?: number;
  private lastHit?: number;
  constructor(readonly notes: readonly number[], readonly startAt: number, bpm: number, readonly label: (note: number) => string = noteName) {
    this.periodMs = 60000 / bpm;
    this.now = startAt - 4 * this.periodMs;
    this.errors = Array(notes.length).fill(undefined);
  }
  get endAt() { return this.startAt + (this.notes.length - 0.5) * this.periodMs; }
  get complete() { return this.now >= this.endAt; }
  get countIn() { return this.now < this.startAt - this.periodMs / 2; }
  get elapsedMs() {
    return this.errors.every((error) => error !== undefined) && this.firstHit !== undefined && this.lastHit !== undefined
      ? this.lastHit - this.firstHit : undefined;
  }
  tick(now: number) {
    this.now = Math.max(this.now, now);
    this.step = Math.min(this.notes.length, Math.max(0, Math.floor((now - this.startAt) / this.periodMs + 0.5)));
  }
  press(index: number, note: number, receivedAt = performance.now()) {
    if (this.held.has(index)) return false;
    this.held.set(index, note);
    const slot = Math.floor((receivedAt - this.startAt) / this.periodMs + 0.5);
    if (slot < 0) { this.feedback = "Count-in: wait for the first scale beat."; return true; }
    if (slot >= this.notes.length) return true;
    if (note !== this.notes[slot] || this.errors[slot] !== undefined) {
      this.mistakes++;
      this.feedback = `Extra attempt. Keep the beat moving; the target is ${this.label(this.notes[slot])}.`;
    } else {
      const error = receivedAt - (this.startAt + slot * this.periodMs);
      this.errors[slot] = error;
      this.firstHit ??= receivedAt;
      this.lastHit = receivedAt;
      this.feedback = Math.abs(error) < 15 ? "On the beat." : `${Math.round(Math.abs(error))} ms ${error < 0 ? "early" : "late"}.`;
    }
    return true;
  }
  release(index: number) { const note = this.held.get(index); this.held.delete(index); return note; }
  result(): BeatResult {
    const errors = this.errors.filter((error): error is number => error !== undefined);
    const credit = errors.reduce((sum, error) => sum + Math.max(0, 1 - Math.abs(error) / (this.periodMs / 2)), 0);
    const score = Math.round(100 * credit / (this.notes.length + this.mistakes));
    return {
      score, grade: score >= 90 ? "Excellent" : score >= 75 ? "Steady" : score >= 50 ? "Building" : "Keep practicing",
      hits: errors.length, missed: this.notes.length - errors.length, extras: this.mistakes,
      meanErrorMs: errors.length ? errors.reduce((sum, error) => sum + Math.abs(error), 0) / errors.length : null,
      biasMs: errors.length ? errors.reduce((sum, error) => sum + error, 0) / errors.length : null
    };
  }
}
