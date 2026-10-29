export interface Recording {
  id?: string;
  name?: string;
  channels: Float32Array[];
  rate: number;
  rootMidi: number;
  pitchSource?: "metadata" | "analysis" | "fallback" | "manual";
  pitchConfidence?: number;
  pitchVariation?: number;
  pitchSuggestion?: number;
  mode?: 0 | 1 | 2 | 3;
  normalize?: boolean;
  start?: number;
  end?: number;
  loopStart?: number;
  loopEnd?: number;
  crossfade?: number;
  source?: string;
}
export interface Zone {
  asset: number;
  lowMidi?: number;
  highMidi?: number;
  key?: number;
  velocityLow?: number;
  velocityHigh?: number;
  gain?: number;
  pan?: number;
  choke?: number;
  roundRobin?: number;
  fixed?: boolean;
  color?: string;
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
  delay?: number;
  hold?: number;
  cutoff?: number;
  keyTrack?: number;
  velocityCurve?: number;
}
export interface Settings {
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
  cutoff?: number;
  resonance?: number;
  pressure?: number;
  pressureGain?: number;
  space?: number;
  fastRelease?: number;
  releaseResponse?: number;
  releaseCurve?: number;
  pedalRelease?: number;
}
export interface Performance {
  format: "hexboard.performance.v1";
  values: number[];
  steps: {
    on: boolean;
    tie: boolean;
    velocity: number;
    probability: number;
    ratchets: number;
  }[];
}
export interface Patch {
  name?: string;
  assets: Recording[];
  zones?: Zone[];
  settings?: Settings;
  velocityEngine?: number;
  performance?: Performance;
  storage?: "auto" | "resident" | "streaming";
  pitchQuality?: "balanced" | "clean" | "character";
  provenance?: string;
  preparedSource?: Uint8Array;
}
export interface Progress {
  label: string;
  asset: number;
  total: number;
  level: number;
}
export interface Prepared {
  auditionPatch?: Patch;
  bytes: Uint8Array;
  assets: { name?: string; frames: number; levels: number; channels: number }[];
  sourceBytes: number;
  residentBytes: number;
  streaming: boolean;
  warnings: string[];
}
export const rate: number;
export function crc32(bytes: Uint8Array): number;
export function wav(bytes: ArrayBuffer): {
  channels: Float32Array[];
  rate: number;
  loopStart?: number;
  loopEnd?: number;
  rootMidi?: number;
};
export function suggestRoot(
  channels: Float32Array[],
): { midi: number; confidence: number } | undefined;
export function resample(
  channels: Float32Array[],
  inputRate: number,
  periodic?: boolean,
): Float32Array[];
export function downsample(
  channels: Float32Array[],
  periodic?: boolean,
): Float32Array[];
export function preparePatch(
  patch: Patch,
  onProgress?: (progress: Progress) => void,
): Promise<Prepared>;
