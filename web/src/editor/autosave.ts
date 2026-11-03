type Save = () => unknown | Promise<unknown>;

/** One pending edit and one write in flight, even when storage is slow. */
export class Autosave {
  private pending?: Save;
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private flushRequested = false;
  private generation = 0;
  constructor(private delay = 400, private onError: (error: unknown) => void = () => {}) {}
  schedule(save: Save) {
    this.pending = save;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush().catch(this.onError); }, this.delay);
  }
  flush = (): Promise<void> => {
    clearTimeout(this.timer); this.timer = undefined;
    this.flushRequested = true;
    if (this.running) return this.running;
    if (!this.pending) return Promise.resolve();
    let save = this.pending, generation = this.generation;
    this.pending = undefined; this.flushRequested = false;
    // Invoke synchronous storage before returning, including during pagehide.
    let result: unknown;
    try { result = save(); } catch (error) { if (generation === this.generation) this.pending ??= save; return Promise.reject(error); }
    if (!result || typeof (result as PromiseLike<unknown>).then !== 'function') return Promise.resolve();
    this.running = Promise.resolve(result).then(async () => {
      while (this.pending && this.flushRequested) {
        save = this.pending; generation = this.generation;
        this.pending = undefined; this.flushRequested = false;
        await save();
      }
    }).catch(error => {
      // Keep failed work recoverable, unless it was explicitly discarded.
      if (generation === this.generation) this.pending ??= save;
      throw error;
    }).finally(() => { this.running = undefined; });
    return this.running;
  };
  cancel() { clearTimeout(this.timer); this.timer = undefined; this.pending = undefined; this.flushRequested = false; ++this.generation; }
}

/** Compare against storage itself so other tabs remain authoritative; no value cache. */
export function writeStoredText(storage: Pick<Storage, 'getItem' | 'setItem'>, key: string, value: string) {
  if (storage.getItem(key) !== value) storage.setItem(key, value);
}
