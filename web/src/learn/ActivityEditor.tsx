import { useState } from "react";
import type { CourseLesson } from "./beginnerCourse.ts";
import { parsePhrase } from "./courseFiles.ts";
import { noteName } from "./majorScale.ts";
import { parseAnswer, parseExploration, type Exploration, type StepAnswer } from "./lessonAnswers.ts";

function TextSetting({label,value,commit,help}:{label:string;value:string;commit:(value:string)=>void;help?:string}) {
  const [draft,setDraft]=useState(value),[error,setError]=useState("");
  return <label className="learnField">{label}<textarea value={draft} rows={2} onChange={e=>setDraft(e.target.value)} onBlur={()=>{try{commit(draft);setError("");}catch(error){setError((error as Error).message);}}}/>{help&&<small>{help}</small>}{error&&<span role="alert">{error}</span>}</label>;
}
const pitchText=(pitch:number)=>Number.isInteger(pitch)?noteName(pitch):`@${pitch}`;
const phraseText=(chords:readonly (readonly number[])[])=>chords.map(chord=>chord.length?`[${chord.map(pitchText).join(" ")}]`:"-").join(" ");
const pitchList=(text:string)=>text.trim()?text.split(/[\s,]+/).map(Number):[];
export function AnswerEditor({lesson,step,onChange}:{lesson:CourseLesson;step:number;onChange:(lesson:CourseLesson)=>void}){
  const rule=lesson.answers?.[step],target=lesson.targets[step]??[];
  const [error,setError]=useState("");
  function update(value:StepAnswer|null){
    try{const next=parseAnswer(value,target.length);onChange({...lesson,answers:lesson.targets.map((_,i)=>i===step?next:lesson.answers?.[i]??null)});setError("");}catch(error){setError((error as Error).message);}
  }
  if(!target.length)return null;
  return <fieldset><legend>Accepted answers · step {step+1}</legend><label className="learnField">Answer rule<select value={!rule?"exact":"voicings" in rule?"voicings":"classes"} onChange={e=>update(e.target.value==="exact"?null:e.target.value==="voicings"?{voicings:[[...target]]}:{pitchClasses:[...new Set(target.map(note=>note%12))],min:48,max:84})}><option value="exact">Exact demonstration pitches</option><option value="voicings">Any listed voicing</option><option value="classes">Pitch classes in a range · any inversion</option></select></label>
    {rule&&"voicings" in rule&&<TextSetting key={JSON.stringify(rule)} label="Acceptable voicings" value={phraseText(rule.voicings)} help="For example: [C4 E4 G4] [E4 G4 C5]. Include the demonstration if it should count. Voice order also sets duration assignment." commit={text=>{const value=parseAnswer({voicings:parsePhrase(text).targets},target.length);update(value);}}/>}
    {rule&&"pitchClasses" in rule&&<><TextSetting key={rule.pitchClasses.join()} label="Pitch classes" value={rule.pitchClasses.join(", ")} help="C = 0, C♯ = 1 … B = 11. One class per voice; default period is 12 semitones." commit={text=>{const value=parseAnswer({...rule,pitchClasses:pitchList(text)},target.length);update(value);}}/>{(["min","max","period"] as const).map(key=><label key={key}>{key==="min"?"Lowest MIDI pitch":key==="max"?"Highest MIDI pitch":"Period in semitones"}<input type="number" step="any" value={rule[key]??12} onChange={e=>update({...rule,[key]:Number(e.target.value)})}/></label>)}</>}
    {error&&<p role="alert">{error}</p>}<p>Demonstrations keep the piano-roll notes. Matching keys are allowed unless required in Lesson Settings.</p>
  </fieldset>;
}
export const defaultExploration:Exploration={durationSeconds:60,min:48,max:84,pitchClasses:[0,2,4,5,7,9,11]};
export function ExplorationEditor({value,onChange}:{value:Exploration;onChange:(value:Exploration)=>void}){
  const [error,setError]=useState("");
  const update=(next:Exploration)=>{try{onChange(parseExploration(next));setError("");}catch(error){setError((error as Error).message);}};
  return <section className="courseEditorFields"><p>Exploration has no target sequence or grade. The range and scale guide the lights; all keys remain audible.</p>
    {(["durationSeconds","min","max","period"] as const).map(key=><label className="learnField" key={key}>{({durationSeconds:"Duration · seconds",min:"Lowest MIDI pitch",max:"Highest MIDI pitch",period:"Pitch period · semitones"})[key]}<input type="number" step="any" value={value[key]??12} onChange={e=>update({...value,[key]:Number(e.target.value)})}/></label>)}
    <TextSetting key={`scale:${value.pitchClasses}`} label="Allowed scale · pitch classes" value={value.pitchClasses?.join(", ")??""} help="C = 0 … B = 11. Leave empty to allow every pitch in the range." commit={text=>update(parseExploration({...value,pitchClasses:text.trim()?pitchList(text):undefined}))}/>
    <TextSetting key={`tones:${value.highlighted}`} label="Highlighted chord tones" value={value.highlighted?.map(pitchText).join(" ")??""} help="Optional, for example C4 E4 G4." commit={text=>update(parseExploration({...value,highlighted:text.trim()?parsePhrase(text).targets.flat():[]}))}/>
    <label className="checkField"><input type="checkbox" checked={!!value.accompaniment} onChange={e=>update({...value,accompaniment:e.target.checked?{bpm:80,chords:[[48]],beats:[4]}:undefined})}/>Repeating accompaniment</label>
    {value.accompaniment&&<><label className="learnField">Accompaniment BPM<input type="number" min={20} max={300} value={value.accompaniment.bpm} onChange={e=>update({...value,accompaniment:{...value.accompaniment!,bpm:Number(e.target.value)}})}/></label><TextSetting key={JSON.stringify(value.accompaniment.chords)+value.accompaniment.beats} label="Chord loop or drone" value={value.accompaniment.chords.map((chord,i)=>`${phraseText([chord])}:${value.accompaniment!.beats[i]}`).join(" ")} help="For example [C3 G3]:4 [F3 C4]:4, or [C3]:8 for a drone. Use -:4 for silence." commit={text=>{const phrase=parsePhrase(text);update(parseExploration({...value,accompaniment:{bpm:value.accompaniment!.bpm,chords:phrase.targets,beats:phrase.beats}}));}}/></>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}
