import {afterEach, describe, expect, it, vi} from 'vitest';
import {animationEase, startVisibleAnimation} from './animation.ts';

function surface() {
  let id = 0, intersection: IntersectionObserverCallback | undefined;
  const pending = new Map<number, FrameRequestCallback>();
  const document = Object.assign(new EventTarget(), {hidden: false});
  const disconnect = vi.fn();
  vi.stubGlobal('document', document);
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { pending.set(++id, fn); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { pending.delete(id); });
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { intersection = callback; }
    observe() {}
    disconnect = disconnect;
  });
  return {
    document, pending, disconnect,
    intersect(visible: boolean) { intersection!([{isIntersecting: visible} as IntersectionObserverEntry], {} as IntersectionObserver); },
    tick(now: number) { const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(fn => fn(now)); },
  };
}
afterEach(() => vi.unstubAllGlobals());
describe('bounded visible animation', () => {
  it('preserves CSS ease-in-out without creating native animation timelines', () => {
    for (const [time, value] of [[0, 0], [.25, .12916193], [.5, .5], [.75, .87083807], [1, 1]]) {
      expect(animationEase(time)).toBeCloseTo(value, 5);
    }
    expect(animationEase(-1)).toBeCloseTo(0, 5);
    expect(animationEase(2)).toBeCloseTo(1, 5);
  });
  it.each([60, 120, 144, 240])('caps a %i Hz display at 60 updates per second', hz => {
    const host = surface(), times: number[] = [];
    const stop = startVisibleAnimation({} as Element, now => times.push(now));
    for (let i = 0; i < hz * 2; ++i) { host.tick(i * 1000 / hz); expect(host.pending.size).toBe(1); }
    expect(times).toHaveLength(120);
    stop(); expect(host.pending.size).toBe(0);
  });
  it('pauses hidden/offscreen work, resumes without catch-up and tears down completely', () => {
    const host = surface(), paint = vi.fn(), stop = startVisibleAnimation({} as Element, paint);
    host.tick(0);
    host.intersect(false); host.tick(1000); expect(paint).toHaveBeenCalledTimes(1);
    host.intersect(true); host.tick(60000); expect(paint).toHaveBeenCalledTimes(2);
    host.document.hidden = true; host.document.dispatchEvent(new Event('visibilitychange'));
    host.tick(120000); expect(paint).toHaveBeenCalledTimes(2);
    host.document.hidden = false; host.document.dispatchEvent(new Event('visibilitychange'));
    host.tick(180000); expect(paint).toHaveBeenCalledTimes(3);
    stop(); host.document.dispatchEvent(new Event('visibilitychange')); host.intersect(true);
    expect(host.pending.size).toBe(0); expect(host.disconnect).toHaveBeenCalledOnce();
  });
});
