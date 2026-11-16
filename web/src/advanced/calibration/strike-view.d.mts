import type { CapturePoint } from "./model.ts";
export function clampRange(range: number[], bounds: number[], minimum?: number): number[];
export function scaleRange(range: number[], factor: number, bounds: number[]): number[];
export function phaseRange(points: CapturePoint[], phase: "attack" | "release", triggerIndex?: number): number[] | null;
export function yPosition(value: number, min: number, max: number, top: number, bottom: number, inverted?: boolean): number;
