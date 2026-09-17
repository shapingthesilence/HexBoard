import type { CourseLesson, KeyCue } from "./beginnerCourse.ts";
export interface RollNote { step: number; voice: number; pitch: number; onset: number; hold: number }
export function lessonOnsets(lesson: CourseLesson): number[] {
  let beat = 0;
  return lesson.targets.map((_, index) => { const onset = beat; beat += lesson.timing?.beats[index] ?? 1; return onset; });
}
export function lessonRollNotes(lesson: CourseLesson): RollNote[] {
  const onsets = lessonOnsets(lesson);
  return lesson.targets.flatMap((notes, step) => notes.map((pitch, voice) => ({ step, voice, pitch, onset: onsets[step], hold: lesson.timing?.holdBeats?.[step]?.[voice] ?? lesson.timing?.beats[step] ?? 1 })));
}
export function measureLength(lesson: CourseLesson) {
  const meter = lesson.timeSignature ?? { numerator: 4, denominator: 4 };
  return meter.numerator * 4 / meter.denominator;
}
// Edits rebuild the canonical steps, carrying each source note's fingering.
// Added notes have no source step; deleted notes leave silence, not shifted music.
function rebuild(lesson: CourseLesson, notes: RollNote[], extraRests: number[] = []): CourseLesson {
  if (!lesson.timing) throw new Error("Choose metronome timing to edit the piano roll.");
  const onsets = lessonOnsets(lesson);
  if (notes.some(note => !Number.isInteger(note.onset * 4) || note.onset < 0 || note.onset > 2047.75 || !Number.isInteger(note.hold * 4) || note.hold < 0.25 || note.hold > 32 || !Number.isFinite(note.pitch) || note.pitch < 0 || note.pitch > 127)) throw new Error("Place notes on the grid, with lengths from one sixteenth note to eight whole notes.");
  const positions = new Set([0, ...notes.map(note => note.onset), ...onsets.filter((_, i) => !lesson.targets[i].length), ...extraRests]);
  let sorted = [...positions].sort((a, b) => a - b);
  const end = Math.max(onsets.at(-1)! + lesson.timing.beats.at(-1)!, ...notes.map(note => note.onset + (lesson.timing!.beats[note.step] ?? Math.min(8, note.hold))));
  for (let i = 0; i < sorted.length; i++) {
    const next = sorted[i + 1] ?? end;
    for (let at = sorted[i] + 8; at < next; at += 8) positions.add(at);
  }
  sorted = [...positions].sort((a, b) => a - b);
  if (sorted.length > 256) throw new Error("A lesson can have at most 256 steps.");
  const groups = sorted.map(at => notes.filter(note => note.onset === at));
  if (groups.some(group => group.length > 10 || new Set(group.map(note => note.pitch)).size !== group.length)) throw new Error("Simultaneous notes must have distinct pitches (up to ten).");
  const fingerings = lesson.fingerings?.map(fingering => ({ layoutId: fingering.layoutId, steps: groups.map(group => group.flatMap(note => {
    const original = lesson.targets[note.step]?.[note.voice];
    const cue = fingering.steps[note.step]?.find(cue => cue.note === original);
    if (!cue) return [];
    const next: KeyCue = { ...cue, note: note.pitch };
    if (original !== note.pitch) { delete next.button; delete next.acceptDuplicates; }
    return [next];
  })) }));
  return { ...lesson, targets: groups.map(group => group.map(note => note.pitch)), fingerings, timing: { ...lesson.timing, beats: sorted.map((at, i) => (sorted[i + 1] ?? end) - at), holdBeats: groups.map(group => group.map(note => note.hold)) } };
}
export function editRollNote(lesson: CourseLesson, step: number, voice: number, change: Partial<Pick<RollNote, "onset" | "hold" | "pitch">>): CourseLesson {
  return rebuild(lesson, lessonRollNotes(lesson).map(note => note.step === step && note.voice === voice ? { ...note, ...change } : note));
}
export function addRollNote(lesson: CourseLesson, pitch: number, onset: number, hold = 1): CourseLesson {
  return rebuild(lesson, [...lessonRollNotes(lesson), { step: -1, voice: 0, pitch, onset, hold }]);
}
export function removeRollNote(lesson: CourseLesson, step: number, voice: number): CourseLesson {
  return rebuild(lesson, lessonRollNotes(lesson).filter(note => note.step !== step || note.voice !== voice), [lessonOnsets(lesson)[step]]);
}
export function reorderSteps(lesson: CourseLesson, from: number, to: number): CourseLesson {
  const order = lesson.targets.map((_, i) => i); const [item] = order.splice(from, 1); order.splice(to, 0, item);
  return { ...lesson, targets: order.map(i => lesson.targets[i]), timing: lesson.timing ? { ...lesson.timing, beats: order.map(i => lesson.timing!.beats[i]), holdBeats: lesson.timing.holdBeats ? order.map(i => lesson.timing!.holdBeats![i]) : undefined } : undefined, fingerings: lesson.fingerings?.map(item => ({ ...item, steps: order.map(i => item.steps[i]) })) };
}
