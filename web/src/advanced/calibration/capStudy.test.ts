import { describe, expect, it } from "vitest";
import { CapStudy, parseCaps, studyCsv } from "./capStudy.ts";
import type { PressureSample } from "./model.ts";

const settings = { steadyMs: 500, tolerance: 4, blocks: 2, samplesPerBlock: 3 };
function sample(key: number, raw: number, tick: number): PressureSample {
  return { key, raw, frame: tick, time: tick * 100000, travel: 0, pressure: 0, valid: false, mode: 1, start: 0, fullEnd: 65535, damperEnd: 65535 };
}
function feed(s: CapStudy, raw: number, start: number, count = 12, key = s.key) {
  for (let i = 0; i < count; i++) s.push(sample(key, raw, start + i), (start + i) * 100);
}
function rest(s: CapStudy, tick = 1) { s.confirmCap(); s.confirmZero(); feed(s, 2240, tick); }
describe("Cap-by-cap raw Hall study", () => {
  it("requires explicit zero-cap placement and advances keys before caps", () => {
    const s = new CapStudy([61, 17], [0, .2], settings);
    s.confirmCap(); feed(s, 2240, 1); expect(s.results).toHaveLength(0);
    s.confirmZero(); feed(s, 2240, 20);
    expect(s.results[0]).toMatchObject({ key: 61, distanceMm: 0, mean: 2240, peakToPeak: 0, stddev: 0, blockMeans: [2240, 2240] });
    expect(s.phase).toBe("zero"); expect(s.key).toBe(17);
    s.confirmZero(); feed(s, 2250, 40);
    expect(s.phase).toBe("cap"); expect(s.distance).toBe(.2); expect(s.key).toBe(61);
    s.confirmCap(); feed(s, 2260, 60); expect(s.phase).toBe("release");
    feed(s, 2240, 80, 2); feed(s, 2260, 82);
    expect(s.results).toHaveLength(3); expect(s.key).toBe(17);
    feed(s, 2250, 100, 2); feed(s, 2270, 102);
    expect(s.phase).toBe("done"); expect(s.results).toHaveLength(4);
  });
  it("rejects duplicate/out-of-order frames and other keys, accepts raw without calibration", () => {
    const s = new CapStudy([61], [0, .2], settings); s.confirmCap(); s.confirmZero();
    feed(s, 2240, 1, 12, 17); expect(s.window).toHaveLength(0);
    for (let i = 0; i < 20; i++) s.push(sample(61, 2240, 1), i * 100 + 100);
    expect(s.results).toHaveLength(0); expect(s.window).toHaveLength(1);
    s.push(sample(61, 2240, 0), 3000); expect(s.window).toHaveLength(1);
    s.confirmZero(); s.pause(); s.resume(); rest(s, 40); expect(s.results).toHaveLength(1);
  });
  it("resets after movement, collection drift, and gaps", () => {
    const s = new CapStudy([61], [0, .2], settings); s.confirmCap(); s.confirmZero();
    feed(s, 2240, 1, 6); expect(s.phase).toBe("collect");
    s.push(sample(61, 2250, 7), 700); expect(s.phase).toBe("hold"); expect(s.collecting).toHaveLength(0);
    feed(s, 2250, 8, 6); expect(s.results).toHaveLength(0);
    s.push(sample(61, 2250, 20), 2000); expect(s.collecting).toHaveLength(0);
    feed(s, 2250, 21); expect(s.results).toHaveLength(1);
  });
  it("retains results on pause/stop and retries only the last result", () => {
    const s = new CapStudy([61], [0, .2], settings); rest(s);
    s.pause(); expect(s.results).toHaveLength(1); s.resume(); expect(s.phase).toBe("cap");
    s.stop(); expect(s.results).toHaveLength(1); expect(s.active).toBe(false);
    s.retryPrevious(); expect(s.results).toHaveLength(0); expect(s.distance).toBe(0); expect(s.phase).toBe("cap");
  });
  it("exports only complete distance rows, preserving decimal averages", () => {
    const s = new CapStudy([61, 17], [0, .2], settings); rest(s);
    expect(studyCsv(s)).toBe("Distance Pressed,Key #61,Key #17\r\n");
    s.confirmZero(); feed(s, 2250, 20);
    expect(studyCsv(s)).toBe("Distance Pressed,Key #61,Key #17\r\n0,2240,2250\r\n");
    s.results[0].mean = 2240.5; expect(studyCsv(s)).toContain("2240.5");
  });
  it("validates configuration and freezes selected keys", () => {
    expect(() => parseCaps("0, .4, .2")).toThrow(); expect(() => parseCaps(".2, .4")).toThrow();
    expect(() => new CapStudy([133], [0, .2], settings)).toThrow();
    expect(() => new CapStudy([1, 1], [0, .2], settings)).toThrow();
    expect(() => new CapStudy([1], [0, .2], { ...settings, blocks: 0 })).toThrow();
    const keys = [61], s = new CapStudy(keys, [0, .2], settings); keys[0] = 17; expect(s.key).toBe(61);
  });
  it("supports decreasing ADC polarity and resets a interrupted nonzero press", () => {
    const s = new CapStudy([61], [0, .2], settings); rest(s);
    s.confirmCap(); feed(s, 2240, 20, 2); feed(s, 2220, 22, 7);
    expect(s.phase).toBe("collect");
    s.push(sample(61, 2220, 40), 4000); expect(s.phase).toBe("release");
    feed(s, 2220, 41); expect(s.results).toHaveLength(1);
    feed(s, 2240, 60, 2); feed(s, 2220, 62);
    expect(s.results[1].mean).toBe(2220); expect(s.phase).toBe("done");
  });
  it("accepts frame and device-time rollover without accepting reverse order", () => {
    const s = new CapStudy([61], [0, .2], settings); s.confirmCap(); s.confirmZero();
    for (let i = 0; i < 12; i++) {
      const reading = sample(61, 2240, 1);
      reading.frame = (0xfffffffc + i) >>> 0; reading.time = (0xfffc0000 + i * 100000) >>> 0;
      s.push(reading, 100 + i * 100);
    }
    expect(s.results).toHaveLength(1);
  });
});
