import { hexBoardGeometry, type HexBoardKey } from "../catalogs/hexBoardGeometry.ts";
import { resolveLayoutKey } from "../catalogs/layoutKey.ts";
import { parseTuningBundleFile, type TuningBundle, type TuningBundleLayout } from "../catalogs/layoutsCatalog.ts";
import factoryTuning from "../../../factory-library/geometry/12 EDO (Normal).json";

export const majorScale = [60, 62, 64, 65, 67, 69, 71, 72] as const;
export const scaleNames = ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"];
export interface LessonKey { key: HexBoardKey; note: number | null }
export interface LessonLayout { id: string; label: string; bundle: TuningBundle; layout: TuningBundleLayout }

export function isLessonTuning(bundle: TuningBundle): boolean {
  const tuning = bundle.tuning;
  return tuning.kind === "edo" && tuning.edoDivisions === 12 && tuning.cycleLength === 12
    && tuning.periodCents === 1200 && tuning.referenceMidiNote - tuning.referenceDegree === 60
    && Math.abs(tuning.referenceHz - 440 * 2 ** ((tuning.referenceMidiNote - 69) / 12)) < 0.01;
}

export function lessonLayouts(bundle: TuningBundle): LessonLayout[] {
  if (!isLessonTuning(bundle)) throw new Error("This lesson uses 12-EDO with standard concert pitch and C-based note names.");
  return bundle.layouts.map((layout) => ({
    id: `${bundle.objectIdHex}:${layout.objectIdHex}`,
    label: `${layout.name} · ${bundle.tuning.name}`,
    bundle, layout
  }));
}

export function starterLayouts(): LessonLayout[] {
  return lessonLayouts(parseTuningBundleFile(factoryTuning))
    .filter(({ layout }) => ["Wicki-Hayden", "Harmonic Table", "Janko"].includes(layout.name));
}

export function resolveLessonKeys({ bundle, layout }: LessonLayout): LessonKey[] {
  if (!isLessonTuning(bundle)) throw new Error("Choose a supported 12-EDO tuning.");
  return hexBoardGeometry.map((key) => {
    const { override, stepsFromC } = resolveLayoutKey(key, layout);
    // Command keys, disabled keys and one-button chords are not scale answers.
    if (key.role !== "note" || override?.role === "unused" || override?.action?.kind === "chord") return { key, note: null };
    const note = override?.action?.kind === "direct-midi" ? override.action.midiNote : 60 + stepsFromC;
    return { key, note: Number.isInteger(note) && note >= 0 && note <= 127 ? note : null };
  });
}

export function unavailableScaleNotes(keys: LessonKey[]): string[] {
  return majorScale.flatMap((note, index) => keys.some((key) => key.note === note) ? [] : [scaleNames[index]]);
}

export function noteName(note: number): string {
  return `${["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"][note % 12]}${Math.floor(note / 12) - 1}`;
}

export class MajorScaleRun {
  readonly held = new Map<number, number>();
  step = 0;
  mistakes = 0;
  feedback = "Find C4 to begin. Play one note at a time.";

  get complete() { return this.step === majorScale.length && this.held.size === 0; }
  press(index: number, note: number) {
    if (this.held.has(index) || this.complete) return false;
    const cleanAttack = this.held.size === 0;
    this.held.set(index, note);
    if (this.step === majorScale.length) {
      this.mistakes++;
      this.feedback = "Release all held keys to finish the scale.";
      return true;
    }
    if (cleanAttack && note === majorScale[this.step]) {
      this.step++;
      this.feedback = this.step === majorScale.length ? "Release the last note to finish." : `Good. Release, then find ${scaleNames[this.step]}.`;
    } else {
      this.mistakes++;
      this.feedback = cleanAttack ? `You played ${noteName(note)}. Look for ${scaleNames[this.step]}.` : "Release the held keys, then try the next note.";
    }
    return true;
  }
  release(index: number) {
    const note = this.held.get(index);
    this.held.delete(index);
    if (this.complete) this.feedback = "You played a complete C-major scale.";
    return note;
  }
}

export type KeyLight = "off" | "rest" | "target" | "held";
export function keyLight(key: LessonKey, target: number | undefined, held: ReadonlyMap<number, number>, hints: boolean): KeyLight {
  if (key.note === null) return "off";
  if (held.has(key.key.index)) return "held";
  return hints && key.note === target ? "target" : "rest";
}
