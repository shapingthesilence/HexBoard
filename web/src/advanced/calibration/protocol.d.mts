import type { Capture, CapturePoint } from "./model.ts";
export const LUT: number[][];
export function travel16(delta: number): number;
export function mm(value: number): number;
export function to16(value: number): number;
export function rawAt(value: number, channel: Capture["channels"][number]): number;
export function crossing(points: CapturePoint[], threshold: number, start?: number): { time: number; index: number } | null;
export function windowTime(points: CapturePoint[], low: number, high: number): { low: number; high: number; us: number } | null;
export class CaptureParser { reset(): void; feed(line: string): Capture | null }
