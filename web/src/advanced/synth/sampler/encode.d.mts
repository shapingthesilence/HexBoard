import type { Performance, Recording } from "./prepare.mjs";
export function defaultPerformance(): Performance;
export function performanceRecord(
  engine?: number,
  performance?: Performance,
): Uint8Array;
export function decodePerformance(bytes: Uint8Array): {
  velocityEngine: number;
  performance: Performance;
};
export const defaults: Required<import("./prepare.mjs").Settings>;
export function trimRecording(
  src: Recording,
): Recording & {
  mode: number;
  loopStart: number;
  loopEnd: number;
  name: string;
  crossfade: number;
  normalize: boolean;
};

export function crossfadeRecording<T extends Recording>(src: T): T;
export function crossfadeFrames(src: Recording): number;
