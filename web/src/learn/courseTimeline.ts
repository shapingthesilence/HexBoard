import {roundBeat,onBeatGrid,beatTick} from "./beatGrid.ts";
import type { CourseLesson, KeyCue } from "./beginnerCourse.ts";
export interface RollNote { step: number; voice: number; pitch: number; onset: number; hold: number; cues?:Record<string,KeyCue> }
export function lessonOnsets(lesson: CourseLesson): number[] {
  let beat = 0;
  return lesson.targets.map((_, index) => { const onset = beat; beat = roundBeat(beat + (lesson.timing?.beats[index] ?? 1)); return onset; });
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
export function rebuild(lesson: CourseLesson, notes: RollNote[], extraRests: number[] = []): CourseLesson {
  if (!lesson.timing) {
    const timed = rebuild({...lesson,timing:{goalBpm:80,beats:lesson.targets.map(()=>1)}}, notes.map(note=>({...note,onset:Math.round(note.onset),hold:1})), extraRests.map(Math.round));
    const included = timed.targets.flatMap((notes,index)=>notes.length?[index]:[]);
    if (!included.length) included.push(0);
    return {...timed,timing:undefined,targets:included.map(index=>timed.targets[index]),fingerings:timed.fingerings?.map(fingering=>({...fingering,steps:included.map(index=>fingering.steps[index])}))};
  }
  if(notes.some(note=>!onBeatGrid(note.onset)||!onBeatGrid(note.hold)))throw new Error("Place notes on the timing grid.");
  notes=notes.map(note=>({...note,onset:roundBeat(note.onset),hold:roundBeat(note.hold)}));
  const onsets = lessonOnsets(lesson);
  if (notes.some(note => !onBeatGrid(note.onset) || note.onset < 0 || note.onset > 2048-beatTick || !onBeatGrid(note.hold) || note.hold < beatTick-1e-8 || note.hold > 32 || !Number.isFinite(note.pitch) || note.pitch < 0 || note.pitch > 127)) throw new Error("Place notes on the grid, with lengths from one sixteenth note to eight whole notes.");
  const positions = new Set([0, ...notes.map(note => note.onset), ...onsets.filter((_, i) => !lesson.targets[i].length), ...extraRests]);
  let sorted = [...positions].sort((a, b) => a - b);
  const end = Math.max(onsets.at(-1)! + lesson.timing.beats.at(-1)!, ...notes.map(note => note.onset + (lesson.timing!.beats[note.step] ?? Math.min(8, note.hold))));
  for (let i = 0; i < sorted.length; i++) {
    const next = sorted[i + 1] ?? end;
    for (let at = sorted[i] + 8; at < next; at += 8) positions.add(at);
  }
  sorted = [...positions].sort((a, b) => a - b);
  if (sorted.length > 256) throw new Error("A lesson can have at most 256 steps.");
  const groups = sorted.map(at => notes.filter(note => Math.abs(note.onset-at)<1e-7));
  if (groups.some(group => group.length > 10 || new Set(group.map(note => note.pitch)).size !== group.length)) throw new Error("Simultaneous notes must have distinct pitches (up to ten).");
  const fingeringSources=[...(lesson.fingerings??[])];
  for(const id of new Set(notes.flatMap(note=>Object.keys(note.cues??{}))))if(!fingeringSources.some(item=>item.layoutId===id))fingeringSources.push({layoutId:id,steps:[]});
  const fingerings = fingeringSources.map(fingering => ({ layoutId: fingering.layoutId, steps: groups.map(group => group.flatMap(note => {
    const original = lesson.targets[note.step]?.[note.voice];
    const cue = note.cues?.[fingering.layoutId] ?? fingering.steps[note.step]?.find(cue => cue.note === original);
    if (!cue) return [];
    const next: KeyCue = { ...cue, note: note.pitch };
    if (original !== undefined && original !== note.pitch) { delete next.button; delete next.acceptDuplicates; }
    return [next];
  })) }));
  return { ...lesson, targets: groups.map(group => group.map(note => note.pitch)), fingerings, timing: { ...lesson.timing, beats: sorted.map((at, i) => roundBeat((sorted[i + 1] ?? end) - at)), holdBeats: groups.map(group => group.map(note => note.hold)) } };
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

export function copyRollNotes(lesson:CourseLesson,selected:RollNote[]):RollNote[]{return selected.map(note=>({...note,cues:Object.fromEntries((lesson.fingerings??[]).flatMap(f=>{const cue=f.steps[note.step]?.find(c=>c.note===note.pitch);return cue?[[f.layoutId,{...cue}]]:[];}))}));}
export function pasteRollNotes(lesson:CourseLesson,notes:RollNote[]):CourseLesson{return rebuild(lesson,[...lessonRollNotes(lesson),...notes.map(note=>({...note,step:-1,voice:0}))]);}
