import type { KeyCue } from "./beginnerCourse.ts";

export class PhraseRecorder {
  readonly held = new Map<number, number>();
  readonly targets: number[][] = [];
  readonly beats: number[] = [];
  readonly cues: KeyCue[][] = [];
  private lastAt?: number;
  private pending = new Map<number, number>();
  private pendingAt?: number;
  constructor(readonly mode: "melody" | "chords", readonly bpm?: number) {}
  private length(ms: number) { return this.bpm ? Math.max(0.25, Math.min(8, Math.round(ms * this.bpm / 15000) / 4)) : 1; }
  private add(entries: [number, number][], at: number) {
    if (this.targets.length >= 256) return;
    if (this.lastAt !== undefined) this.beats[this.beats.length - 1] = this.length(at - this.lastAt);
    this.lastAt = at;
    const unique = [...new Map(entries.map(([index, note]) => [note, index])).entries()].slice(0, 10);
    this.targets.push(unique.map(([note]) => note));
    this.cues.push(unique.map(([note, button]) => ({note, button, acceptDuplicates: true})));
    this.beats.push(1);
  }
  press(index: number, note: number, at: number) {
    if (this.held.has(index)) return false;
    this.held.set(index, note);
    if (this.mode === "melody") this.add([[index, note]], at);
    else { this.pendingAt ??= at; this.pending.set(index, note); }
    return true;
  }
  release(index: number, at: number) {
    this.held.delete(index);
    if (!this.held.size) {
      if (this.mode === "chords" && this.pending.size) this.flush();
      if (this.lastAt !== undefined) this.beats[this.beats.length - 1] = this.length(at - this.lastAt);
    }
  }
  flush() {
    if (this.pendingAt !== undefined && this.pending.size) this.add([...this.pending], this.pendingAt);
    this.pending.clear(); this.pendingAt = undefined;
  }
}
