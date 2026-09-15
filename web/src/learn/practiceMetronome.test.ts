import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PracticeMetronome } from "./practiceMetronome.ts";

const oscillators: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; frequency: { value: number }; disconnect: ReturnType<typeof vi.fn> }[] = [];
class Context {
  static last: Context;
  outputLatency = 0;
  baseLatency = 0;
  get currentTime() { return Date.now() / 1000; }
  destination = {};
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {});
  constructor() { Context.last = this; }
  getOutputTimestamp() { return { contextTime: this.currentTime, performanceTime: Date.now() }; }
  createOscillator() {
    const node = { frequency: { value: 0 }, start: vi.fn(), stop: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), onended: null };
    oscillators.push(node); return node;
  }
  createGain() {
    return { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
  }
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10000); oscillators.length = 0; vi.stubGlobal("AudioContext", Context); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("practice metronome lifecycle", () => {
  it("schedules four count-in clicks then scale beats at fixed audio times", async () => {
    const clock = new PracticeMetronome();
    expect(await clock.start(60, 8)).toBe(14150);
    await vi.advanceTimersByTimeAsync(5250);
    expect(oscillators.slice(0, 6).map((node) => node.start.mock.calls[0][0])).toEqual([10.15,11.15,12.15,13.15,14.15,15.15]);
    expect(oscillators.slice(0, 6).map((node) => node.frequency.value)).toEqual([1100,1100,1100,1100,1500,800]);
    clock.stop();
  });
  it("cancels scheduled clicks and cannot keep scheduling after stop", async () => {
    const clock = new PracticeMetronome(); await clock.start(180, 8);
    await vi.advanceTimersByTimeAsync(1000);
    const count = oscillators.length;
    clock.stop();
    expect(Context.last.close).toHaveBeenCalledOnce();
    expect(oscillators.every((node) => node.stop.mock.calls.length === 2)).toBe(true);
    await vi.advanceTimersByTimeAsync(10000);
    expect(oscillators).toHaveLength(count);
  });
  it("cannot start clicks after being stopped during audio startup", async () => {
    const clock = new PracticeMetronome();
    const ready = clock.start(80, 8);
    clock.stop();
    await expect(ready).rejects.toThrow("Practice stopped");
    await vi.advanceTimersByTimeAsync(10000);
    expect(oscillators).toHaveLength(0);
  });
});
