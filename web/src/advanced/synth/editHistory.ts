/** Bounded immutable snapshots. A whole pointer/keyboard gesture is one step. */
export class EditHistory<T> {
  private past: T[] = [];
  private future: T[] = [];
  private grouping = false;
  private recorded = false;
  constructor(public value: T, private limit = 64, private equal: (a: T, b: T) => boolean = Object.is) {}
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  begin() { if (!this.grouping) { this.grouping = true; this.recorded = false; } }
  end() { this.grouping = false; this.recorded = false; }
  set(next: T) {
    if (!this.equal(this.value, next)) {
      if (!this.grouping || !this.recorded) {
        this.past.push(this.value);
        if (this.past.length > this.limit) this.past.shift();
      }
      this.future = [];
      if (this.grouping) this.recorded = true;
    }
    this.value = next;
  }
  replace(next: T) { this.value = next; }
  reset(next: T) { this.end(); this.past = []; this.future = []; this.value = next; }
  undo(): T | undefined {
    this.end();
    if (!this.canUndo) return;
    this.future.push(this.value);
    return this.value = this.past.pop()!;
  }
  redo(): T | undefined {
    this.end();
    if (!this.canRedo) return;
    this.past.push(this.value);
    return this.value = this.future.pop()!;
  }
}
