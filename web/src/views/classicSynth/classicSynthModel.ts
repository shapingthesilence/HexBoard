// HexBoard Classic wavetable sound settings: option tables, display labels and
// byte conversions shared by the editor and the library. The pictures mirror the
// Classic firmware (src/firmware/synth); change both together.
import { SYNTH_WAVETABLE_FRAME_COUNT, type SynthSettingName } from "../../catalogs/index.ts";

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}

export const synthValueKeys = [
  "PlaybackMode",
  "Waveform",
  "SynthDrive",
  "SynthModTarget",
  "SynthModAmount",
  "SynthVibratoSpeed",
  "ArpeggiatorDivision",
  "SynthBPM",
  "EnvelopeAttackIndex",
  "EnvelopeHoldIndex",
  "EnvelopeDecayIndex",
  "EnvelopeSustainLevel",
  "EnvelopeReleaseIndex",
  "EffectEnvelopeTarget",
  "EffectEnvelopeAmount",
  "EffectEnvelopeAttackIndex",
  "EffectEnvelopeHoldIndex",
  "EffectEnvelopeDecayIndex",
  "EffectEnvelopeSustainLevel",
  "EffectEnvelopeReleaseIndex",
  "EffectEnvelope2Target",
  "EffectEnvelope2Amount",
  "EffectEnvelope2AttackIndex",
  "EffectEnvelope2HoldIndex",
  "EffectEnvelope2DecayIndex",
  "EffectEnvelope2SustainLevel",
  "EffectEnvelope2ReleaseIndex",
  "SynthPortamentoTimeIndex",
  "ArpeggiatorDirection",
  "ArpeggiatorNoteLength",
  "SynthWavetablePosition",
  "SynthLfoTarget",
  "SynthLfoAmount",
  "SynthLfoWave",
  "SynthLfoSpeed"
] as const satisfies readonly SynthSettingName[];

export const synthWavetableFramePositionAmounts = [
  0, 8, 17, 25, 34, 42, 51, 59, 68, 76, 85, 93, 102, 110, 119, 127
] as const;
export const synthVibratoSpeedNoise = 12;

export type EditableSynthValueKey = (typeof synthValueKeys)[number];

export const playbackOptions = [
  { label: "Off", value: 0 },
  { label: "Mono · retrigger", value: 1 },
  { label: "Mono · legato", value: 4 },
  { label: "Arpeggiator", value: 2 },
  { label: "Poly arpeggiator", value: 6 },
  { label: "Polyphonic", value: 3 }
];

export const arpDivisionOptions = [
  { label: "1/2", value: 2 },
  { label: "1/3", value: 3 },
  { label: "1/4", value: 4 },
  { label: "1/6", value: 6 },
  { label: "1/8", value: 8 },
  { label: "1/12", value: 12 },
  { label: "1/16", value: 16 },
  { label: "1/24", value: 24 },
  { label: "1/32", value: 32 }
];

export const arpDirectionOptions = [
  { label: "Up", value: 0 },
  { label: "Down", value: 1 },
  { label: "Order played", value: 2 },
  { label: "Reverse played", value: 3 },
  { label: "Up/down", value: 4 },
  { label: "Down/up", value: 5 },
  { label: "Random", value: 6 }
];

export const driveOptions = [
  { label: "Off", value: 0 },
  { label: "Warm", value: 1 },
  { label: "Edge", value: 2 },
  { label: "Dirty", value: 3 }
];

export const modTargetOptions = [
  { label: "Off", value: 6 },
  { label: "Vibrato", value: 1 },
  { label: "Pitch", value: 2 },
  { label: "Wavetable position", value: 3 },
  { label: "Wave folding", value: 0 },
  { label: "Pulse width", value: 4 },
  { label: "Poly warp", value: 5 }
];

export const wheelTargetOptions = [
  ...modTargetOptions,
  { label: "Volume envelope · Attack", value: 7 },
  { label: "Volume envelope · Hold", value: 8 },
  { label: "Volume envelope · Decay", value: 9 },
  { label: "Volume envelope · Sustain", value: 10 },
  { label: "Volume envelope · Release", value: 11 }
];

export const lfoWaveOptions = [
  { label: "Sine", value: 0 },
  { label: "Triangle", value: 1 },
  { label: "Saw", value: 2 },
  { label: "Square", value: 3 },
  { label: "Noise", value: 4 },
  { label: "Smooth noise", value: 5 }
];

export const lfoSpeedOptions = [
  { label: "0.05 Hz", value: 0 },
  { label: "0.1 Hz", value: 1 },
  { label: "0.2 Hz", value: 2 },
  { label: "0.33 Hz", value: 3 },
  { label: "0.5 Hz", value: 4 },
  { label: "0.75 Hz", value: 5 },
  { label: "1 Hz", value: 6 },
  { label: "1.25 Hz", value: 7 },
  { label: "1.5 Hz", value: 8 },
  { label: "2 Hz", value: 9 },
  { label: "2.5 Hz", value: 10 },
  { label: "3 Hz", value: 11 },
  { label: "4 Hz", value: 12 },
  { label: "5 Hz", value: 13 },
  { label: "6 Hz", value: 14 },
  { label: "8 Hz", value: 15 },
  { label: "10 Hz", value: 16 },
  { label: "12 Hz", value: 17 },
  { label: "16 Hz", value: 18 },
  { label: "20 Hz", value: 19 }
];

export const envelopeTimeOptions = [
  "0 ms",
  "5 ms",
  "10 ms",
  "15 ms",
  "20 ms",
  "30 ms",
  "50 ms",
  "75 ms",
  "100 ms",
  "150 ms",
  "200 ms",
  "300 ms",
  "500 ms",
  "750 ms",
  "1 s",
  "1.5 s",
  "2 s",
  "2.5 s",
  "3 s",
  "4 s",
  "3 ms"
].map((label, value) => ({ label, value }));

export function wavetablePositionByteToFrame(value: number): number {
  const clamped = clampNumber(value, 0, 127);
  const exactFrame = synthWavetableFramePositionAmounts.findIndex((amount) => amount === Math.round(clamped));
  if (exactFrame >= 0) {
    return exactFrame + 1;
  }
  return clampNumber((clamped * (SYNTH_WAVETABLE_FRAME_COUNT - 1)) / 127, 0, SYNTH_WAVETABLE_FRAME_COUNT - 1) + 1;
}

export function wavetableFrameToPositionByte(frame: number): number {
  const zeroBasedFrame = Math.round(clampNumber(frame, 1, SYNTH_WAVETABLE_FRAME_COUNT)) - 1;
  return synthWavetableFramePositionAmounts[zeroBasedFrame] ?? 0;
}

export function clampEnvelopeTimeIndex(value: number): number {
  return Math.max(0, Math.min(envelopeTimeOptions.length - 1, Math.round(value)));
}

export function envelopeTimeLabel(index: number): string {
  return envelopeTimeOptions[clampEnvelopeTimeIndex(index)].label;
}

export function driveLabel(value: number): string {
  return driveOptions.find((option) => option.value === value)?.label ?? "Off";
}

export function vibratoSpeedLabel(value: number): string {
  return value === synthVibratoSpeedNoise ? "Noise" : `${clampNumber(value, 0, synthVibratoSpeedNoise - 1) + 1} Hz`;
}

export function lfoSpeedLabel(value: number): string {
  return lfoSpeedOptions.find((option) => option.value === clampNumber(value, 0, lfoSpeedOptions.length - 1))?.label ?? "1 Hz";
}

export function wheelAmountByteToPercent(value: number): number {
  const depth = value <= 127 ? value : 127 - value;
  return Math.round(depth * 100 / 127);
}

export function wheelAmountPercentToByte(value: number): number {
  const depth = Math.round(clampNumber(value, -100, 100) * 127 / 100);
  return depth < 0 ? 127 - depth : depth;
}

export function fxAmountByteToPercent(value: number): number {
  if (value === 127) {
    return 0;
  }
  if (value > 127) {
    return Math.round(((value - 127) / 127) * 100);
  }
  return -Math.round(((127 - value) / 127) * 100);
}

export function fxAmountPercentToByte(value: number): number {
  const clamped = Math.max(-100, Math.min(100, Math.round(value)));
  return Math.round(127 + (clamped / 100) * 127);
}

export type EditableSynthValues = Record<EditableSynthValueKey, number>;

/** Modulation targets (SynthDefaults.h). Wheel-only targets reach the volume envelope. */
export const ModTarget = {
  WaveFolding: 0, Vibrato: 1, Pitch: 2, WavetablePosition: 3, PulseWidth: 4, PolyWarp: 5, Off: 6,
  Attack: 7, Hold: 8, Decay: 9, Sustain: 10, Release: 11
} as const;

export function targetLabel(target: number): string {
  return wheelTargetOptions.find((option) => option.value === target)?.label ?? "Off";
}

export const envelopePositionCount = envelopeTimeOptions.length;

/** Envelope time knobs order the stored steps by length: 0 ms, 3 ms, 5 ms … 4 s. */
export function envelopeTimePosition(index: number): number {
  return index === 20 ? 1 : index === 0 ? 0 : index + 1;
}
export function envelopeTimeIndex(position: number): number {
  return position === 1 ? 20 : position === 0 ? 0 : position - 1;
}
export function envelopeTimeMs(index: number): number {
  const label = envelopeTimeLabel(index);
  return parseFloat(label) * (label.endsWith("ms") ? 1 : 1000);
}

/** Output drive (SynthAudioTransport.cpp): each step raises the input gain into one soft clip. */
export const driveInputGain = [1, 1, 1.5, 2.5] as const;
export function driveTransfer(sample: number, mode: number): number {
  const magnitude = Math.min(1, Math.abs(sample) * (driveInputGain[mode] ?? 1));
  const shaped = mode > 0 ? (3 * magnitude - magnitude ** 3) / 2 : magnitude;
  return sample < 0 ? -shaped : shaped;
}

const triangle = (phase: number) => phase < 0.5 ? phase : 1 - phase;
/** Oscillator phase bends (SynthModulationCache.cpp) for amount −1…1, the board's ±127. */
export function warpPhase(target: number, phase: number, amount: number): number {
  const depthQ4 = Math.abs(amount) * 127 * 16, sign = Math.sign(amount);
  let offset = 0;
  if (target === ModTarget.WaveFolding) offset = sign * triangle(phase) * depthQ4 * 5 / 4096;
  else if (target === ModTarget.PulseWidth) offset = (amount > 0 === phase < 0.5 ? 1 : -1) * depthQ4 * 8 / 65536;
  else if (target === ModTarget.PolyWarp) { const t = triangle(phase); offset = sign * 4 * t * (0.5 - t) * depthQ4 / 2048; }
  return ((phase + offset) % 1 + 1) % 1;
}

/** Pitch modulation reaches ±2 octaves at full amount (halved table lookup). */
export const pitchSemitones = (percent: number) => percent / 100 * 24;
/** Wavetable position modulation moves across the whole 16-frame table at full amount. */
export const positionFrames = (percent: number) => percent / 100 * (SYNTH_WAVETABLE_FRAME_COUNT - 1);
