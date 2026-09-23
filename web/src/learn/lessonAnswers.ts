import type { CourseLesson } from "./beginnerCourse.ts";

/** The target remains the demonstration; an answer replaces its grading rule. */
export type StepAnswer = { voicings: number[][] } | { pitchClasses: number[]; min: number; max: number; period?: number };
export interface Exploration {
  durationSeconds: number;
  min: number;
  max: number;
  pitchClasses?: number[];
  period?: number;
  highlighted?: number[];
  accompaniment?: { bpm: number; chords: number[][]; beats: number[] };
}
const modulo = (pitch: number, period: number) => ((pitch % period) + period) % period;
export function inPitchSet(note: number, rule: { min: number; max: number; pitchClasses?: number[]; period?: number }) {
  const period = rule.period ?? 12;
  return note >= rule.min && note <= rule.max && (!rule.pitchClasses || rule.pitchClasses.some(pc => Math.abs(modulo(note - pc, period)) < 1e-7 || Math.abs(modulo(note - pc, period) - period) < 1e-7));
}
export function answerAllows(target: readonly number[], answer: StepAnswer | null | undefined, note: number) {
  return !answer ? target.includes(note) : "voicings" in answer ? answer.voicings.some(chord => chord.includes(note)) : inPitchSet(note, answer);
}
/** Return one physical key per voice. Duplicate buttons do not add chord tones. */
export function matchAnswer(target: readonly number[], answer: StepAnswer | null | undefined, held: ReadonlyMap<number, number>, accepts: (index:number,note:number)=>boolean = () => true): number[] | undefined {
  const entries = [...held].filter(([index,note])=>accepts(index,note));
  const match = (chord: readonly number[]) => {
    const indices = chord.map(note=>entries.find(([,pitch])=>pitch===note)?.[0]);
    if (!chord.length || indices.some(index=>index===undefined) || (chord.length>1 && [...held.values()].some(note=>!chord.includes(note)))) return undefined;
    return indices as number[];
  };
  if (!answer) return match(target);
  if ("voicings" in answer) return answer.voicings.map(match).find(Boolean);
  const voices = answer.pitchClasses.map(pc=>entries.find(([,note])=>inPitchSet(note,{...answer,pitchClasses:[pc]})));
  if (voices.some(voice=>!voice) || (voices.length>1 && (new Set(held.values()).size!==voices.length || [...held.values()].some(note=>!inPitchSet(note,answer))))) return undefined;
  return voices.map(voice=>voice![0]);
}
export function answerNotes(lesson: CourseLesson, step: number, available: readonly number[]): number[] {
  return available.filter(note=>answerAllows(lesson.targets[step]??[],lesson.answers?.[step],note));
}

function record(value: unknown): Record<string,unknown> {
  if (!value || typeof value!=="object" || Array.isArray(value)) throw new Error("Expected activity settings.");
  return value as Record<string,unknown>;
}
function number(value:unknown,min:number,max:number,label:string):number {
  if(typeof value!=="number"||!Number.isFinite(value)||value<min||value>max)throw new Error(`${label} must be ${min}–${max}.`);
  return value;
}
function pitches(value:unknown,max=10,allowEmpty=false):number[] {
  if(!Array.isArray(value)||value.length>(max)||(!allowEmpty&&!value.length)||new Set(value).size!==value.length)throw new Error("Use distinct pitches within the allowed range.");
  return value.map(note=>number(note,0,127,"Pitch"));
}
function pitchSet(value:Record<string,unknown>,required=false) {
  const min=number(value.min,0,127,"Lowest pitch"),max=number(value.max,min,127,"Highest pitch");
  const period=value.period===undefined?12:number(value.period,0.01,128,"Pitch period");
  const pitchClasses=value.pitchClasses===undefined&&!required?undefined:pitches(value.pitchClasses,128);
  if(pitchClasses?.some(pc=>pc>=period))throw new Error("Pitch classes must be smaller than the period.");
  return {min,max,period,pitchClasses};
}
export function parseAnswer(value:unknown,voices:number):StepAnswer|null {
  if(value===null)return null;
  if(!voices)throw new Error("Rests cannot have alternative answers.");
  const rule=record(value);
  if(rule.voicings!==undefined){
    if(!Array.isArray(rule.voicings)||!rule.voicings.length||rule.voicings.length>64)throw new Error("Use 1–64 acceptable voicings.");
    const voicings=rule.voicings.map(v=>pitches(v));
    if(voicings.some(v=>v.length!==voices))throw new Error("Each voicing must have the same number of voices as the demonstration.");
    return {voicings};
  }
  const set=pitchSet(rule,true);
  if(set.pitchClasses!.length!==voices)throw new Error("Use one pitch class per demonstration voice.");
  if(set.pitchClasses!.some(pc=>Math.ceil((set.min-pc)/set.period)>Math.floor((set.max-pc)/set.period)))throw new Error("Every pitch class needs a pitch in the range.");
  return {...set,pitchClasses:set.pitchClasses!};
}
export function parseExploration(value:unknown):Exploration {
  const raw=record(value),set=pitchSet(raw);
  const durationSeconds=number(raw.durationSeconds,1,3600,"Exploration duration in seconds");
  const highlighted=raw.highlighted===undefined?undefined:pitches(raw.highlighted,128,true);
  if(highlighted?.some(note=>!inPitchSet(note,set)))throw new Error("Highlighted chord tones must be in the exploration scale and range.");
  let accompaniment:Exploration["accompaniment"];
  if(raw.accompaniment!==undefined){
    const a=record(raw.accompaniment);
    if(!Array.isArray(a.chords)||!a.chords.length||a.chords.length>64||!Array.isArray(a.beats)||a.beats.length!==a.chords.length)throw new Error("Accompaniment needs 1–64 chords with matching beat lengths.");
    accompaniment={bpm:number(a.bpm,20,300,"Accompaniment tempo"),chords:a.chords.map(chord=>pitches(chord,10,true)),beats:a.beats.map(beat=>number(beat,0.125,32,"Accompaniment beats"))};
  }
  return {...set,durationSeconds,highlighted,accompaniment};
}

export function answerLabel(target: readonly number[], answer: StepAnswer | null | undefined, label:(note:number)=>string):string {
  if(!answer)return target.map(label).join(" + ")||"Rest";
  if("voicings" in answer)return answer.voicings.map(chord=>chord.map(label).join(" + ")).join(" or ");
  return `${answer.pitchClasses.map(pc=>label(pc+Math.ceil((answer.min-pc)/(answer.period??12))*(answer.period??12))).join(" + ")} · any ${answer.pitchClasses.length===1?"register":"inversion"} from ${label(answer.min)} to ${label(answer.max)}`;
}
