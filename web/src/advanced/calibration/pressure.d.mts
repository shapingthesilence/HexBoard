import type { PressureSample } from "./model.ts";
export function parsePressure(line: string, rawDamper?: boolean): PressureSample | null;
export function pressurePercent(travel: number, mode: number, start: number, fullEnd?: number, damperEnd?: number, firmTravel?: number): number;
