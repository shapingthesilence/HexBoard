import type { BasicSoundBank } from "spessasynth_core";
import type { Patch } from "./prepare.mjs";
export interface PresetChoice {
  id: number;
  name: string;
  bank: number;
  program: number;
  drums: boolean;
}
export interface ImportedPatch extends Patch {
  report: string[];
}
export function noteName(note: number): string;
export function validateRIFF(bytes: ArrayBuffer): void;
export function openSoundFont(
  bytes: ArrayBuffer,
): Promise<{ bank: BasicSoundBank; presets: PresetChoice[] }>;
export function directSoundFont(
  bank: BasicSoundBank,
  id: number,
): { patch: Patch; complex: boolean; bakeRequired: boolean; report: string[] };
export function convertSoundFont(
  bank: BasicSoundBank,
  id: number,
  progress?: (p: { label: string }) => void,
  options?: { adaptation?: "faithful" | "compact" },
): Promise<ImportedPatch>;
export function bakeSoundFont(
  bank: BasicSoundBank,
  id: number,
  progress?: (p: { label: string }) => void,
  options?: { layers?: number; seconds?: number },
): Promise<ImportedPatch>;
export function normalizePath(path: string): string;
export function sfzNote(value: string): number;
export function sfzRegions(text: string): Record<string, string>[];
export function expandSFZ(
  path: string,
  files: Map<string, File>,
): Promise<string>;
export function importSFZ(
  path: string,
  files: Map<string, File>,
  progress?: (p: { label: string }) => void,
): Promise<ImportedPatch>;
