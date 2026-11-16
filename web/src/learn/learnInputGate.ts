// Physical state survives run changes; evaluation state does not. Never allow a
// held key from the previous exercise to leak into a newly armed exercise.
export class LearnInputGate {
  readonly held = new Set<number>();
  private blocked = false;
  resetRun() { this.blocked = this.held.size > 0; }
  clear() { this.held.clear(); this.blocked = false; }
  event(index:number, pressed:boolean):boolean {
    if(pressed)this.held.add(index);else this.held.delete(index);
    if(this.blocked){if(!this.held.size)this.blocked=false;return false;}
    return true;
  }
}
