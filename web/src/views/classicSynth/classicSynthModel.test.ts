import { describe, expect, it } from "vitest";
import {
  driveTransfer, envelopeTimeIndex, envelopeTimeLabel, envelopeTimeMs, envelopeTimePosition, envelopePositionCount,
  ModTarget, pitchSemitones, positionFrames, warpPhase
} from "./classicSynthModel.ts";

// Fixed-point firmware routines, transcribed from src/firmware/synth so the pictures stay honest.
const SHAPE_CLAMP = 511; // PWM_BITS 10 (SynthAudioInternal.h)
function firmwareDrive(sample: number, mode: number) {
  const gainQ8 = [256, 256, 384, 640][mode];
  const magnitude = Math.min(SHAPE_CLAMP, Math.abs(sample));
  const x = Math.min(SHAPE_CLAMP, (magnitude * gainQ8) >> 8);
  const cube = Math.floor(Math.floor(x * x / 512) * x / 512);
  const shaped = Math.min(SHAPE_CLAMP, (3 * x - cube) >> 1);
  return sample < 0 ? -shaped : shaped;
}
function firmwareWarp(target: number, phase: number, amount: number) {
  const q4 = amount * 16, depth = Math.abs(q4), tri = phase & 0x8000 ? 0xffff - phase : phase;
  let offset = 0;
  if (target === ModTarget.WaveFolding) offset = (tri * depth * 5) >> 12;
  if (target === ModTarget.PulseWidth) offset = depth << 3;
  if (target === ModTarget.PolyWarp) offset = (((tri * (0x8000 - tri)) >> 14) * depth) >> 11;
  const add = target === ModTarget.PulseWidth ? (q4 > 0) === !(phase & 0x8000) : q4 > 0;
  return ((add ? phase + offset : phase - offset) & 0xffff) / 65536;
}

describe("Classic output drive picture", () => {
  it("matches the firmware's soft clip at every step", () => {
    for (const mode of [1, 2, 3]) {
      for (let sample = -511; sample <= 511; sample += 7) {
        expect(driveTransfer(sample / SHAPE_CLAMP, mode)).toBeCloseTo(firmwareDrive(sample, mode) / SHAPE_CLAMP, 2);
      }
    }
  });

  it("passes the signal straight through when off", () => {
    expect(driveTransfer(.4, 0)).toBe(.4);
    expect(driveTransfer(-.4, 0)).toBe(-.4);
  });
});

describe("Classic oscillator phase bends", () => {
  it("bend the phase the way the firmware does", () => {
    for (const target of [ModTarget.WaveFolding, ModTarget.PulseWidth, ModTarget.PolyWarp]) {
      for (const amount of [-127, -40, 64, 127]) {
        for (let phase = 0; phase < 65536; phase += 4093) {
          const expected = firmwareWarp(target, phase, amount), actual = warpPhase(target, phase / 65536, amount / 127);
          // Compare around the cycle so wrap-around is not a false mismatch.
          expect(Math.min(Math.abs(actual - expected), 1 - Math.abs(actual - expected))).toBeLessThan(2e-4);
        }
      }
    }
  });
});

describe("Classic modulation ranges", () => {
  it("reaches two octaves of pitch and the whole table at full amount", () => {
    expect(pitchSemitones(100)).toBe(24);
    expect(pitchSemitones(-50)).toBe(-12);
    expect(positionFrames(100)).toBe(15);
  });
});

describe("Classic envelope time knob", () => {
  it("orders the stored steps from shortest to longest and round-trips them", () => {
    const ordered = Array.from({ length: envelopePositionCount }, (_, position) => envelopeTimeIndex(position));
    expect(ordered.map(envelopeTimeLabel).slice(0, 4)).toEqual(["0 ms", "3 ms", "5 ms", "10 ms"]);
    expect(envelopeTimeLabel(ordered[ordered.length - 1])).toBe("4 s");
    const times = ordered.map(envelopeTimeMs);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    for (let index = 0; index < envelopePositionCount; ++index) expect(envelopeTimeIndex(envelopeTimePosition(index))).toBe(index);
  });
});
