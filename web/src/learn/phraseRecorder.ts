import type { KeyCue } from "./beginnerCourse.ts";

export class PhraseRecorder {
  readonly held = new Map<number, number>();
  readonly targets: number[][] = [];
  readonly beats: number[] = [];
  readonly holdBeats: number[][] = [];
  private active = new Map<number,{at:number;step?:number}>();
  private releases = new Map<number,number>();
  readonly cues: KeyCue[][] = [];
  private lastAt?: number;
  private pending = new Map<number, number>();
  private pendingAt?: number;
  constructor(readonly mode: "melody" | "chords", readonly bpm?: number, readonly snap = 0.5) {}
  private length(ms: number, maximum = 8) { return this.bpm ? Math.max(this.snap, Math.min(maximum, Math.round(ms * this.bpm / 60000 / this.snap) * this.snap)) : 1; }
  private add(entries: [number, number][], at: number) {
    if (this.targets.length >= 256) return;
    if (this.lastAt !== undefined) this.beats[this.beats.length - 1] = this.length(at - this.lastAt);
    this.lastAt = at;
    const unique = [...new Map(entries.map(([index, note]) => [note, index])).entries()].slice(0, 10);
    this.targets.push(unique.map(([note]) => note));
    this.cues.push(unique.map(([note, button]) => ({note, button, acceptDuplicates: true})));
    this.beats.push(1);
    this.holdBeats.push(unique.map(([,button])=>{const at=this.active.get(button)?.at??this.pendingAt;const end=this.releases.get(button);return at!==undefined&&end!==undefined?this.length(end-at,32):1;}));
  }
  press(index: number, note: number, at: number) {
    if (this.held.has(index)) return false;
    this.held.set(index, note);
    this.active.set(index,{at,step:this.mode === "melody"?this.targets.length:undefined});
    if (this.mode === "melody") this.add([[index, note]], at);
    else { this.pendingAt ??= at; this.pending.set(index, note); }
    return true;
  }
  release(index: number, at: number) {
    this.held.delete(index);
    this.releases.set(index,at);
    const attack=this.active.get(index);
    if(attack?.step!==undefined&&this.holdBeats[attack.step]) this.holdBeats[attack.step][0]=this.length(at-attack.at,32);
    if (!this.held.size) {
      if (this.mode === "chords" && this.pending.size) this.flush();
      if (this.lastAt !== undefined) this.beats[this.beats.length - 1] = this.length(at - this.lastAt);
    }
  }
  flush(at?:number) {
    if(at!==undefined)for(const index of this.held.keys()){this.releases.set(index,at);const attack=this.active.get(index);if(attack?.step!==undefined&&this.holdBeats[attack.step])this.holdBeats[attack.step][0]=this.length(at-attack.at,32); }
    if (this.pendingAt !== undefined && this.pending.size) this.add([...this.pending], this.pendingAt);
    this.pending.clear(); this.pendingAt = undefined;
    if(this.mode === "chords"){this.active.clear();this.releases.clear();}
  }
}
