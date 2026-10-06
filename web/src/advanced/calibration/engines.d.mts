import type { Strike } from "./model.ts";
export const engineNames: string[];
export const engineDescriptions: string[];
export function engineMagnitude(value: number, soft: number, hard: number, shape: number, minimum?: number, maximum?: number): number;
export function engineMeasurement(event: Strike | null): string;
