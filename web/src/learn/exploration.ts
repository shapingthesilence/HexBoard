import { MajorScaleRun } from "./majorScale.ts";
import { inPitchSet, type Exploration } from "./lessonAnswers.ts";

export class ExplorationRun extends MajorScaleRun {
  constructor(readonly activity: Exploration, startAt: number) {
    super([]); this.startedAt = startAt; this.feedback = "Explore the highlighted notes. There is no target sequence or score.";
  }
  override get complete() { return this.finishedAt !== undefined; }
  tick(now: number) { if (now >= this.startedAt! + this.activity.durationSeconds*1000) this.finishedAt = this.startedAt! + this.activity.durationSeconds*1000; }
  remaining(now: number) { return Math.max(0,Math.ceil(this.activity.durationSeconds-(now-this.startedAt!)/1000)); }
  override press(index: number, note: number) {
    if (this.complete || this.held.has(index)) return false;
    this.held.set(index,note);
    this.feedback = inPitchSet(note,this.activity) ? "Explore, repeat, and vary your ideas." : "Outside the suggested scale or range—listen to the difference.";
    return true;
  }
}

/** Absolute time keeps the loop aligned when a browser frame is delayed. */
export function accompanimentAt(activity: Exploration, elapsedMs: number): readonly number[] {
  const loop = activity.accompaniment;
  if (!loop || elapsedMs < 0 || elapsedMs >= activity.durationSeconds*1000) return [];
  const length = loop.beats.reduce((a,b)=>a+b,0);
  let beat = (elapsedMs*loop.bpm/60000)%length;
  for (let i=0;i<loop.chords.length;i++) { if (beat<loop.beats[i]) return loop.chords[i]; beat-=loop.beats[i]; }
  return [];
}
