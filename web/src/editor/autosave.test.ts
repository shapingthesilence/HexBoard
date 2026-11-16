import {afterEach, describe, expect, it, vi} from 'vitest';
import {Autosave, writeStoredText} from './autosave.ts';
afterEach(() => vi.useRealTimers());

describe('bounded draft persistence', () => {
  it('coalesces rapid edits, serializes only the latest, and stops writing when idle', async () => {
    vi.useFakeTimers(); const save = vi.fn(), writer = new Autosave();
    for (let i = 0; i < 1000; ++i) { writer.schedule(() => save(i)); vi.advanceTimersByTime(5); }
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(400); expect(save.mock.calls).toEqual([[999]]);
    await vi.advanceTimersByTimeAsync(3600000); expect(save).toHaveBeenCalledTimes(1);
  });
  it('flushes synchronous storage immediately when leaving and cancels discarded edits', async () => {
    vi.useFakeTimers(); const save = vi.fn(), writer = new Autosave();
    writer.schedule(save); const done = writer.flush(); expect(save).toHaveBeenCalledTimes(1); await done;
    writer.schedule(save); writer.cancel(); await writer.flush();
    await vi.advanceTimersByTimeAsync(400); expect(save).toHaveBeenCalledTimes(1);
  });
  it('keeps only the newest edit behind a slow write and flushes it before close', async () => {
    vi.useFakeTimers(); let finish!: () => void;
    const save = vi.fn(), writer = new Autosave();
    writer.schedule(() => new Promise<void>(resolve => { finish = resolve; }));
    const first = writer.flush();
    for (let i = 0; i < 1000; ++i) writer.schedule(() => save(i));
    const closing = writer.flush(); expect(closing).toBe(first); expect(save).not.toHaveBeenCalled();
    finish(); await closing; expect(save.mock.calls).toEqual([[999]]);
    await vi.advanceTimersByTimeAsync(400); expect(save).toHaveBeenCalledTimes(1);
  });
  it('reports storage failures and allows a later edit to recover', async () => {
    vi.useFakeTimers(); const error = vi.fn(), save = vi.fn(), writer = new Autosave(400, error);
    writer.schedule(() => { throw Error('full'); }); await vi.advanceTimersByTimeAsync(400);
    expect(error).toHaveBeenCalledTimes(1);
    await expect(writer.flush()).rejects.toThrow('full');
    writer.schedule(() => Promise.reject(Error('blocked'))); await expect(writer.flush()).rejects.toThrow('blocked');
    writer.schedule(save); await writer.flush(); expect(save).toHaveBeenCalledTimes(1);
  });
  it('does not resurrect discarded work when a slow write fails', async () => {
    vi.useFakeTimers(); let reject!: (error: Error) => void;
    const save = vi.fn(), writer = new Autosave();
    writer.schedule(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    const writing = writer.flush(); writer.schedule(save); writer.cancel();
    reject(Error('blocked')); await expect(writing).rejects.toThrow('blocked');
    await writer.flush(); await vi.advanceTimersByTimeAsync(400); expect(save).not.toHaveBeenCalled();
  });
  it('skips equal stored values without caching data from another tab', () => {
    let current = 'a'; const storage = {getItem: () => current, setItem: vi.fn((_key, value) => { current = value; })};
    writeStoredText(storage, 'draft', 'a'); expect(storage.setItem).not.toHaveBeenCalled();
    writeStoredText(storage, 'draft', 'b'); expect(storage.setItem).toHaveBeenCalledTimes(1);
    current = 'other tab'; writeStoredText(storage, 'draft', 'b'); expect(storage.setItem).toHaveBeenCalledTimes(2);
  });
});
