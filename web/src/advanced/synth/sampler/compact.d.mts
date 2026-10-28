import type { Patch, Prepared, Progress } from "./prepare.mjs";
export const compactLimits: Readonly<{pcmBytes:number;assets:number;zones:number;slots:number;voices:number}>;
export function prepareCompactPatch(patch: Patch, progress?: (p: Progress) => void): Promise<Prepared>;
export function readCompactPatch(bytes: Uint8Array): Patch;
