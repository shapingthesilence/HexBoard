import type {LessonProgress} from "./beginnerCourse.ts";
export type Achievement = "completed" | "independent";
export function earnedAchievement(previous:LessonProgress|undefined,next:LessonProgress):Achievement|undefined {
  if(next.independent && !previous?.independent)return "independent";
  if(!previous)return "completed";
  return undefined;
}

/** A separate, quiet voice: rewards never release or replace a learner's note. */
export class AchievementSound {
  private context?: AudioContext;
  private nodes = new Set<OscillatorNode>();
  async unlock() {
    try {
      this.context ??= new AudioContext();
      await this.context.resume();
    } catch { /* Visual feedback remains available when audio is blocked. */ }
  }
  play(achievement:Achievement) {
    this.stop();
    const context=this.context;
    if(!context || context.state!=="running")return;
    const notes=achievement==="independent"?[72,76,79,84]:[72,76,79];
    notes.forEach((note,index)=>{
      const oscillator=context.createOscillator(),gain=context.createGain();
      const at=context.currentTime+0.025+index*0.11;
      oscillator.type="sine";
      oscillator.frequency.value=440*2**((note-69)/12);
      gain.gain.setValueAtTime(0,at);
      gain.gain.linearRampToValueAtTime(0.045,at+0.012);
      gain.gain.exponentialRampToValueAtTime(0.001,at+0.25);
      oscillator.connect(gain);gain.connect(context.destination);
      oscillator.onended=()=>{this.nodes.delete(oscillator);oscillator.disconnect();gain.disconnect();};
      this.nodes.add(oscillator);oscillator.start(at);oscillator.stop(at+0.27);
    });
  }
  stop() {
    for(const node of this.nodes){try{node.stop();}catch{/* Already ended. */}}
    this.nodes.clear();
  }
  close() {
    this.stop();
    const context=this.context;this.context=undefined;
    void context?.close().catch(()=>{});
  }
}
