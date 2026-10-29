import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { preparePatch, type Recording } from "./prepare.mjs";
import { moveBoundary, snapLoop, matchLoop, loopSeam, loopPitchChange, waveformDetail } from "./loopEditing.ts";
import { SamplerWaveform } from "./SamplerWaveform.tsx";
import { crossfadeRecording, crossfadeFrames } from "./encode.mjs";
import { prepareCompactPatch, readCompactPatch } from "./compact.mjs";
import { readBank } from "./bank.mjs";

const sine = (length: number, period: number) => Float32Array.from({ length }, (_, i) => .6 * Math.sin(2 * Math.PI * (i - 3) / period));
const recording = (): Recording => ({ name: "Short loop", channels: [sine(512, 16)], rate: 32000, rootMidi: 69, mode: 1, loopStart: 20, loopEnd: 36 });
describe("Shared precise loop editing", () => {
  it("locks exact loop length during nudges, snapping and trim changes", () => {
    const a = recording();
    for (const change of [moveBoundary(a, "loopStart", 21, true), moveBoundary(a, "loopEnd", 35, true), snapLoop(a, true), matchLoop(a, true, "loopEnd"), moveBoundary(a, "start", 510, true), moveBoundary(a, "end", 10, true)]) {
      const moved = { ...a, ...change };
      expect(moved.loopEnd! - moved.loopStart!).toBe(16); expect(loopPitchChange(moved, 16)).toBe(0);
      expect(moved.loopStart!).toBeGreaterThanOrEqual(moved.start ?? 0); expect(moved.loopEnd!).toBeLessThanOrEqual(moved.end ?? 512);
    }
    expect(snapLoop(a, true)).toEqual({ loopStart: 19, loopEnd: 35 });
    // Opposite-direction zero crossings cannot form a same-period pair. Do
    // not "fix" a half-cycle selection by silently doubling its length.
    expect(snapLoop({ ...a, loopStart: 19, loopEnd: 27 }, true)).toEqual({ loopStart: 19, loopEnd: 27 });
  });
  it("shows pitch changes when length is explicitly unlocked and matches stereo seams", () => {
    const a = recording(), moved = { ...a, ...moveBoundary(a, "loopEnd", 37, false) };
    expect(loopPitchChange(moved, 16)).toBeCloseTo(1200 * Math.log2(16 / 17), 10);
    const fixed = { ...moved, ...matchLoop(moved, false, "loopEnd", 8) };
    expect(loopSeam(fixed).score).toBeLessThan(loopSeam(moved).score / 100);
    const stereo = { ...a, channels: [new Float32Array(512), a.channels[0]] };
    expect(snapLoop(stereo, true)).toEqual({ loopStart: 19, loopEnd: 35 });
  });
  it("draws individual samples when zoomed and exposes shared fine controls", () => {
    const a = recording();
    expect(waveformDetail(a.channels[0], 20, 36, 560, 110, 1)).toContain("L");
    const html = renderToStaticMarkup(createElement(SamplerWaveform, { recording: a, onChange: () => {} }));
    for (const label of ["Zoom to loop", "View loop start", "Match seam", "Snap to zero", "Lock loop length / pitch", "Crossfade frames", "Waveform display gain", "exclusive"]) expect(html).toContain(label);
    expect(html).toContain('type="checkbox" checked=""');
  });
});
describe("Pitch-preserving loop crossfades", () => {
  it("smooths a loop at the recording end without shortening its period or rebaking", () => {
    const a: Recording = { ...recording(), channels: [Float32Array.from({ length: 32 }, (_, i) => -.8 + i * .05)], loopStart: 0, loopEnd: 32, crossfade: 4 * 1000 / 32000 };
    const original = a.channels[0].slice(), b = crossfadeRecording(a), pcm = b.channels[0];
    expect(crossfadeFrames(a)).toBe(4); expect(b.loopEnd! - b.loopStart!).toBe(32);
    expect(pcm[32]).toBe(pcm[31]); // No tail exists: start from the last value, not the opposite side of the seam.
    expect(pcm[35]).toBe(original[3]); expect(pcm[b.loopStart!]).toBe(original[4]);
    expect(a.channels[0]).toEqual(original); expect(crossfadeRecording(b)).toBe(b);
  });
  it("keeps loop-until-release tails connected and avoids ineffective one-frame fades", () => {
    const a = { ...recording(), channels: [sine(80, 15)], mode: 3 as const, loopStart: 8, loopEnd: 40, crossfade: 4 * 1000 / 32000 };
    const b = crossfadeRecording(a);
    expect(b.loopEnd! - b.loopStart!).toBe(32);
    expect(b.channels[0][b.loopEnd!]).toBe(a.channels[0][12]);
    expect(b.channels[0].slice(b.loopEnd! + 4)).toEqual(a.channels[0].slice(44));
    expect(crossfadeFrames({ ...a, crossfade: 1000 / 32000 })).toBe(2);
    expect(crossfadeFrames({ ...a, loopEnd: 12 })).toBe(0);
  });
});
describe("Short-loop export tuning", () => {
  it("calibrates Advanced roots for each tracking slope and every pitch variant", async () => {
    const input = { name: "Odd loop", assets: [{ ...recording(), channels: [sine(256, 17)], mode: 3 as const, loopStart: 51, loopEnd: 68 }],
      storage: "streaming" as const, pitchQuality: "character" as const,
      zones: [{ asset: 0, lowMidi: 60, highMidi: 108, velocityLow: 1, velocityHigh: 63, keyTrack: 1 }, { asset: 0, lowMidi: 60, highMidi: 108, velocityLow: 64, velocityHigh: 127, keyTrack: .5 }] };
    const result = await preparePatch(input), parsed = readBank(result.bytes);
    for (const z of parsed.zones!) {
      const a = parsed.assets[z.asset], actual = a.rate / (a.loopEnd! - a.loopStart!) * 2 ** ((69 - a.rootMidi) * z.keyTrack! / 12);
      expect(Math.abs(1200 * Math.log2(actual / (32000 / 17)))).toBeLessThan(.001);
      const clock = a.rate * 2 ** ((69 - a.rootMidi) * z.keyTrack! / 12);
      expect(Math.abs(a.channels[0].length / clock - 256 / 32000)).toBeLessThan(2 / clock);
    }
    expect(result.warnings.join(" ")).toContain("Calibrated short-loop");
    await expect(preparePatch({ ...input, zones: [{ asset: 0, fixed: true, lowMidi: 60, highMidi: 70 }] })).rejects.toThrow(/export stopped to preserve pitch/);
  });
  it("retains Classic native and reduced loop pitch with a baked crossfade", async () => {
    const a: Recording = { ...recording(), channels: [sine(30001, 17)], mode: 3, loopStart: 3, loopEnd: 20, crossfade: 2 * 1000 / 32000 };
    const result = await prepareCompactPatch({ assets: [a], zones: [{ asset: 0, lowMidi: 0, highMidi: 128 }] });
    const b = readCompactPatch(result.bytes).assets[0];
    expect(Math.abs(1200 * Math.log2((b.rate / (b.loopEnd! - b.loopStart!)) / (32000 / 17)))) .toBeLessThan(.001);
    expect(result.residentBytes).toBeLessThanOrEqual(49152);
  });
});
