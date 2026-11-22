import type { TuningBundleTuning } from "../catalogs/layoutsCatalog.ts";
import { tuningPeriod } from "./tuningPractice.ts";

/**
 * How much of the scale shape Scale practice reveals. Hints fade as the clean
 * streak grows and come back in full after any mistake.
 */
export type HintLevel = "full" | "shape" | "root";
export const hintFadeStreaks = { shape: 2, root: 4 } as const;
export function hintLevel(streak: number): HintLevel {
  return streak >= hintFadeStreaks.root ? "root" : streak >= hintFadeStreaks.shape ? "shape" : "full";
}
export const hintLevelNames: Record<HintLevel, string> = { full: "full", shape: "shape only", root: "roots only" };

/**
 * The size of one move between scale notes. Equal tunings count their own
 * steps; unequal tunings, and pitches off the step grid, use cents.
 */
export function stepSize(tuning: TuningBundleTuning, from: number, to: number): string {
  const cents = Math.abs(to - from) * 100, step = equalStepCents(tuning);
  if (step) {
    const steps = cents / step;
    if (Math.abs(steps - Math.round(steps)) < 1e-3) return String(Math.round(steps));
  }
  return `${Math.round(cents)}¢`;
}
export function stepSizeUnit(tuning: TuningBundleTuning): string {
  return equalStepCents(tuning) ? `steps of ${tuning.name}` : "cents";
}
function equalStepCents(tuning: TuningBundleTuning): number | undefined {
  return tuning.kind === "edo" ? tuning.periodCents / tuning.cycleLength : tuning.kind === "equal-step" ? tuning.stepCents : undefined;
}

/**
 * Numbers each pitch of a scale 1, 2, 3 … from its root, repeating every
 * tuning period. Pitches outside the scale have no degree.
 */
export function scaleDegreeLabels(tuning: TuningBundleTuning, scale: readonly number[]): (pitch: number) => string | undefined {
  const period = tuningPeriod(tuning), root = scale[0];
  const position = (pitch: number) => {
    const cents = (((pitch - root) * 100) % period + period) % period;
    return Math.round((period - cents < 1e-3 ? 0 : cents) * 1000);
  };
  const degrees = new Map<number, number>();
  for (const pitch of scale) if (!degrees.has(position(pitch))) degrees.set(position(pitch), degrees.size + 1);
  return pitch => { const degree = degrees.get(position(pitch)); return degree === undefined ? undefined : String(degree); };
}

/** Personal bests for one exercise: tuning, layout, scale, root and pattern. */
export interface ScaleRecord { bestStreak: number; fastestMs?: number; bestScores?: Record<string, number> }
export type ScaleRecords = Record<string, ScaleRecord>;
export const scaleRecordsKey = "hexboard.learn.scaleRecords";

export function parseScaleRecords(text: string | null): ScaleRecords {
  try {
    const value: unknown = JSON.parse(text ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const records: ScaleRecords = {};
    for (const [id, item] of Object.entries(value as Record<string, unknown>)) {
      if (!item || typeof item !== "object") continue;
      const { bestStreak, fastestMs, bestScores } = item as Record<string, unknown>;
      if (typeof bestStreak !== "number" || !Number.isFinite(bestStreak) || bestStreak < 0) continue;
      const record: ScaleRecord = { bestStreak: Math.floor(bestStreak) };
      if (typeof fastestMs === "number" && Number.isFinite(fastestMs) && fastestMs > 0) record.fastestMs = fastestMs;
      if (bestScores && typeof bestScores === "object") {
        const scores = Object.entries(bestScores as Record<string, unknown>).filter(([bpm, score]) => /^\d+$/.test(bpm) && typeof score === "number" && score >= 0 && score <= 100);
        if (scores.length) record.bestScores = Object.fromEntries(scores) as Record<string, number>;
      }
      records[id] = record;
    }
    return records;
  } catch { return {}; }
}

/** streakBaseline is the best streak saved when the current streak began. */
export interface ScaleRunOutcome { clean: boolean; streak: number; streakBaseline?: number; elapsedMs?: number; bpm?: number; score?: number }
/** Folds one finished run into its record and names each new best ("New …!"). */
export function recordScaleRun(previous: ScaleRecord | undefined, run: ScaleRunOutcome): { record: ScaleRecord; news: string[] } {
  const record: ScaleRecord = { ...previous, bestStreak: previous?.bestStreak ?? 0, ...(previous?.bestScores ? { bestScores: { ...previous.bestScores } } : {}) };
  const news: string[] = [];
  if (run.streak > record.bestStreak) {
    // A first clean run is not news; passing the streak saved before this one began is, once.
    if (run.streakBaseline && run.streak === run.streakBaseline + 1) news.push("best streak");
    record.bestStreak = run.streak;
  }
  if (run.bpm === undefined && run.clean && run.elapsedMs !== undefined && run.elapsedMs < (record.fastestMs ?? Infinity)) {
    if (record.fastestMs !== undefined) news.push("fastest clean run");
    record.fastestMs = run.elapsedMs;
  }
  if (run.bpm !== undefined && run.score !== undefined) {
    const best = record.bestScores?.[run.bpm];
    if (best === undefined || run.score > best) {
      if (best !== undefined) news.push(`best score at ${run.bpm} BPM`);
      record.bestScores = { ...record.bestScores, [run.bpm]: run.score };
    }
  }
  return { record, news };
}
