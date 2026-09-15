import type { TuningBundle, TuningBundleTuning, TuningBundleScale } from "../catalogs/layoutsCatalog.ts";

export const wrapDegree = (degree: number, cycle: number) => ((degree % cycle) + cycle) % cycle;
export function tuningPeriod(tuning: TuningBundleTuning) {
  return tuning.kind === "equal-step" ? tuning.stepCents * tuning.cycleLength : tuning.periodCents;
}
// Matches firmware stepsToCentsFromReference: Scala entries are intervals
// from the reference, with the period as the last entry (unison is implicit).
export function tuningPitch(tuning: TuningBundleTuning, steps: number): number {
  const relative = steps - tuning.referenceDegree;
  const degree = wrapDegree(relative, tuning.cycleLength);
  const cents = tuning.kind === "edo" ? relative * tuning.periodCents / tuning.cycleLength
    : tuning.kind === "equal-step" ? relative * tuning.stepCents
    : Math.floor(relative / tuning.cycleLength) * tuning.periodCents + (degree === 0 ? 0 : tuning.cents[degree - 1]);
  // Canonical precision makes equivalent direct-MIDI pitches match without
  // collapsing distinct microtonal steps to semitones.
  return Math.round((69 + 12 * Math.log2(tuning.referenceHz / 440) + cents / 100) * 1e8) / 1e8;
}
export function tuningStepLabel(tuning: TuningBundleTuning, steps: number): string {
  const pitch = tuningPitch(tuning, steps);
  if (tuning.kind === "edo" && tuning.edoDivisions === 12 && tuning.periodCents === 1200
    && Math.abs(pitch - Math.round(pitch)) < 1e-7) {
    const note = Math.round(pitch);
    return `${["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"][wrapDegree(note, 12)]}${Math.floor(note / 12) - 1}`;
  }
  const degree = wrapDegree(steps, tuning.cycleLength);
  return `${tuning.keyLabels[degree] ?? degree} [${Math.floor(steps / tuning.cycleLength)}]`;
}
export function scaleSteps(bundle: TuningBundle, scale: TuningBundleScale, root: number, register = 0): number[] {
  const cycle = bundle.tuning.cycleLength;
  const degrees = [...new Set(scale.includedDegrees)].filter((degree) => Number.isInteger(degree) && degree >= 0 && degree < cycle).sort((a, b) => a - b);
  if (!degrees.length) return [];
  const start = root + register * cycle;
  return [...degrees, degrees[0] + cycle].map((degree) => start + degree);
}
