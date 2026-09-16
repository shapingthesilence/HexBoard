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

export interface BeatTargets {
  targets: readonly (readonly number[])[];
  beats: readonly number[];
  accepts?: (step: number, index: number, note: number) => boolean;
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
  readonly offsets: number[];
  readonly totalBeats: number;
  private attacks = new Map<number, { slot: number; at: number }>();
  private firstHit?: number;
  private lastHit?: number;
  constructor(readonly notes: readonly number[], readonly startAt: number, bpm: number, readonly label: (note: number) => string = noteName, readonly exercise?: BeatTargets) {
    if (exercise) this.feedback = "Listen to four count-in clicks, then follow the phrase.";
    this.periodMs = 60000 / bpm;
    this.now = startAt - 4 * this.periodMs;
    this.errors = Array(notes.length).fill(undefined);
    let offset = 0;
    this.offsets = notes.map((_, index) => { const at = offset; offset += exercise?.beats[index] ?? 1; return at; });
    this.totalBeats = offset;
  }
  get endAt() { return this.startAt + (this.totalBeats - Math.min(0.5, (this.exercise?.beats.at(-1) ?? 1) / 2)) * this.periodMs; }
  get complete() { return this.now >= this.endAt; }
  get countIn() { return this.now < this.startAt - this.periodMs / 2; }
  get elapsedMs() {
    return this.errors.every((error) => error !== undefined) && this.firstHit !== undefined && this.lastHit !== undefined
      ? this.lastHit - this.firstHit : undefined;
  }
  private target(slot: number) { return this.exercise?.targets[slot] ?? [this.notes[slot]]; }
  private earlyWindow(slot: number) { return slot === 0 ? 0.5 : Math.min(0.5, (this.offsets[slot] - this.offsets[slot - 1]) / 2); }
  private lateWindow(slot: number) { return Math.min(0.5, (this.exercise?.beats[slot] ?? 1) / 2); }
  private slotAt(time: number) {
    const beat = (time - this.startAt) / this.periodMs;
    return this.offsets.findIndex((offset, slot) => beat >= offset - this.earlyWindow(slot) && beat < offset + this.lateWindow(slot));
  }
  tick(now: number) {
    this.now = Math.max(this.now, now);
    let next = 0;
    while (next < this.notes.length && this.now >= this.startAt + (this.offsets[next] + (this.target(next).length ? this.lateWindow(next) : (this.exercise?.beats[next] ?? 1) - this.lateWindow(next))) * this.periodMs) {
      if (!this.target(next).length && this.errors[next] === undefined) this.errors[next] = 0;
      next++;
    }
    this.step = Math.max(this.step, next);
  }
  press(index: number, note: number, receivedAt = performance.now()) {
    if (this.held.has(index)) return false;
    this.held.set(index, note);
    const slot = this.slotAt(receivedAt);
    if (receivedAt < this.startAt - this.periodMs / 2) { this.feedback = "Wait for the first beat."; return true; }
    if (receivedAt >= this.endAt) return true;
    if (slot < 0 || !this.target(slot).includes(note) || this.errors[slot] !== undefined || this.exercise?.accepts?.(slot, index, note) === false) {
      this.mistakes++;
      this.feedback = "Extra attempt. Follow the beat.";
    } else {
      this.attacks.set(index, { slot, at: receivedAt });
      this.evaluate(slot, receivedAt);
    }
    return true;
  }
  private evaluate(slot: number, receivedAt: number) {
    if (slot < 0 || this.errors[slot] !== undefined) return;
    const target = this.target(slot);
    const entries = [...this.held];
    if (!target.length || !target.every(note => entries.some(([index, pitch]) => pitch === note && this.exercise?.accepts?.(slot, index, pitch) !== false))) return;
    if (target.length > 1 && entries.some(([, note]) => !target.includes(note))) return;
    const attacks = entries.flatMap(([index]) => { const attack = this.attacks.get(index); return attack?.slot === slot ? [attack.at] : []; });
    if (!attacks.length) return; // Held notes alone cannot satisfy another beat.
    const due = this.startAt + this.offsets[slot] * this.periodMs;
    // Chords are graded by the furthest attack (or final cleanup release), so
    // early and late chord tones cannot cancel each other's timing errors.
    const deviations = [...attacks, receivedAt].map(at => at - due);
    const error = deviations.reduce((worst, value) => Math.abs(value) > Math.abs(worst) ? value : worst, 0);
    this.errors[slot] = error;
    this.step = Math.max(this.step, slot + 1);
    this.firstHit ??= Math.min(...attacks);
    this.lastHit = receivedAt;
    this.feedback = Math.abs(error) < 15 ? "On the beat." : `${Math.round(Math.abs(error))} ms ${error < 0 ? "early" : "late"}.`;
  }
  release(index: number, receivedAt = performance.now()) {
    const note = this.held.get(index); this.held.delete(index); this.attacks.delete(index);
    this.evaluate(this.slotAt(receivedAt), receivedAt);
    return note;
  }
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
