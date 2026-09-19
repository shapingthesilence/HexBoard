import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { MidiTransport } from "../midi/types.ts";
import { DelegatedSession } from "./delegatedSession.ts";
import { PracticeMetronome } from "./practiceMetronome.ts";
import { PhraseRecorder } from "./phraseRecorder.ts";
import { SynthPreviewController } from "../audio/synthPreview.ts";
import { createBasicShapesSamples } from "../catalogs/factoryWavetables.ts";
import { lessonLedColor, lessonScreenColor } from "./lessonColors.ts";
import type { TuningBundle } from "../catalogs/layoutsCatalog.ts";
import { type CourseLesson, type KeyCue } from "./beginnerCourse.ts";
import { cueLabel, lessonCues, parseCourse, parsePhrase, type UserCourse } from "./courseFiles.ts";
import { isLessonTuning, noteName, resolveLessonKeys } from "./majorScale.ts";
import { tuningStepLabel } from "./tuningPractice.ts";

import { courseStorage } from "./courseStorage.ts";
import { FingerHands } from "./FingerHands.tsx";
import { lessonPreviewEvents } from "./lessonPreview.ts";
import { PianoRoll } from "./PianoRoll.tsx";
import {CourseOutline} from "./CourseOutline.tsx";
import {CourseMarkdown} from "./CourseMarkdown.tsx";
import {compatibilityReport,transposeCourseLayout} from "./courseStructure.ts";
import {snapOptions} from "./beatGrid.ts";
import { CourseInstrumentSelector } from "./CourseInstrumentSelector.tsx";
import { reorderSteps } from "./courseTimeline.ts";

function DeferredNumberInput({ value, min, max, label, onCommit }: { value: number; min: number; max: number; label?: string; onCommit: (value: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  function commit() {
    const next = Number(text);
    if (text.trim() && Number.isInteger(next) && next >= min && next <= max) onCommit(next);
    setText(String(value));
  }
  return <input aria-label={label} type="number" min={min} max={max} value={text} onChange={event => setText(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />;
}

export function CourseEditor({ initial, bundles, transport, connected, onSave, onClose, renderPreview }: {
  initial: UserCourse; bundles: TuningBundle[]; transport: MidiTransport; connected: boolean; onSave: (course: UserCourse) => Promise<void>; onClose: () => void; renderPreview:(course:UserCourse,index:number,close:()=>void)=>ReactNode;
}) {
  const [learnerPreview,setLearnerPreview]=useState(false);
  const [settingsOverlay,setSettingsOverlay]=useState<"course"|"lesson">();
  const [recording, setRecording] = useState(false);
  const [recordMode, setRecordMode] = useState<"melody" | "chords">("melody");
  const [recordSnap,setRecordSnap]=useState(0.5);
  const [recordedCount, setRecordedCount] = useState(0);
  const capture = useRef<PhraseRecorder | null>(null);
  const device = useRef<DelegatedSession | null>(null);
  const synth = useRef<SynthPreviewController | null>(null);
  const click = useRef<PracticeMetronome | null>(null);
  const captureGeneration = useRef(0);
  const [draft, applyDraft] = useState(initial);
  const undoStack=useRef<UserCourse[]>([]),redoStack=useRef<UserCourse[]>([]);
  const hasEdits=useRef(false);
  function setDraft(update:UserCourse|((value:UserCourse)=>UserCourse)){
    applyDraft(current=>{const next=typeof update === "function"?update(current):update;if(next!==current){hasEdits.current=true;if(undoStack.current.at(-1)!==current)undoStack.current=[...undoStack.current.slice(-19),current];redoStack.current=[];}return next;});
  }
  function undo(){const previous=undoStack.current.pop();if(!previous)return;redoStack.current.push(draft);applyDraft(previous);setLessonIndex(0);setStep(0);}
  function redo(){const next=redoStack.current.pop();if(!next)return;undoStack.current.push(draft);applyDraft(next);setLessonIndex(0);setStep(0);}

  const [saving,setSaving]=useState(false),[closeWarning,setCloseWarning]=useState(false),[draftStatus,setDraftStatus]=useState("Editor draft · no new edits");
  const dirty=JSON.stringify(draft)!==JSON.stringify(initial);
  const writes=useRef<Promise<unknown>>(Promise.resolve());
  useEffect(()=>{
    if(!dirty&&!hasEdits.current)return;
    setDraftStatus("Saving draft…");
    writes.current=writes.current.catch(()=>{}).then(()=>courseStorage.saveDraft(draft));
    void writes.current.then(()=>setDraftStatus("Draft autosaved · course not yet saved"),()=>setDraftStatus("Draft could not be saved. Export it before closing."));
  },[draft,dirty]);
  useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(dirty){event.preventDefault();event.returnValue="";}};window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);},[dirty]);
  async function closeEditor(discard=false){
    disposeCapture();
    try { await (discard?writes.current.catch(()=>{}):writes.current); if(discard)await courseStorage.removeDraft(draft.id); onClose(); }
    catch { setError("Draft could not be saved. Save or export it before closing."); }
  }
  function exportDraft(){const url=URL.createObjectURL(new Blob([JSON.stringify(draft,null,2)],{type:"application/json"}));const link=document.createElement("a");link.href=url;link.download="hexboard-course-draft.json";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

  const [lessonIndex, setLessonIndex] = useState(0);
  const [step, setStep] = useState(0);
  const [voice,setVoice]=useState<number>();
  const [previewing,setPreviewing]=useState(false);
  const [playhead,setPlayhead]=useState<number>();
  const [sounding,setSounding]=useState<number[]>([]);
  const previewAudio=useRef<SynthPreviewController|null>(null);
  const previewTimers=useRef<ReturnType<typeof setTimeout>[]>([]);
  const previewClock=useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const previewGeneration=useRef(0);
  function stopPreview(){previewGeneration.current++;previewTimers.current.forEach(clearTimeout);previewTimers.current=[];clearInterval(previewClock.current);const audio=previewAudio.current;previewAudio.current=null;void audio?.close().catch(()=>{});setPreviewing(false);setPlayhead(undefined);setSounding([]);}
  async function playPreview(){
    stopPreview();const generation=previewGeneration.current;setPreviewing(true);setError("");
    const audio=new SynthPreviewController();previewAudio.current=audio;
    audio.setPatch({wavetableName:"Basic Shapes",wavetableFolderPath:"/Built In",wavetableSamples:createBasicShapesSamples(),values:{EnvelopeAttackIndex:1,EnvelopeSustainLevel:100,EnvelopeReleaseIndex:5}});
    try{
      await audio.start();if(generation!==previewGeneration.current)return;
      const events=lessonPreviewEvents(lesson),started=performance.now(),period=60000/(lesson.timing?.goalBpm??80);
      setPlayhead(0);previewClock.current=setInterval(()=>setPlayhead((performance.now()-started)/period),33);
      for(const event of events)previewTimers.current.push(setTimeout(()=>{
        if(generation!==previewGeneration.current)return;
        if(event.on){void audio.noteOn(event.pitch).catch(()=>{stopPreview();setError("Preview audio stopped.");});setSounding(notes=>[...notes.filter(note=>note!==event.pitch),event.pitch]);}
        else{audio.noteOff(event.pitch);setSounding(notes=>notes.filter(note=>note!==event.pitch));}
      },event.at));
      const end=Math.max(events.at(-1)?.at??0,(lesson.timing?.beats.reduce((a,b)=>a+b,0)??lesson.targets.length)*period);
      previewTimers.current.push(setTimeout(stopPreview,end+80));
    }catch(error){if(generation===previewGeneration.current){stopPreview();setError(error instanceof Error?error.message:"Could not play preview.");}}
  }
  useEffect(()=>{setVoice(undefined);},[lessonIndex]);

  const [layoutId, setLayoutId] = useState(initial.layoutId ?? initial.bundle.activeLayoutIdHex);
  const [phrase, setPhrase] = useState("");
  const [error, setError] = useState("");
  const lesson = draft.lessons[lessonIndex];
  const layout = draft.bundle.layouts.find(layout => layout.objectIdHex === layoutId) ?? draft.bundle.layouts[0];
  const keys = useMemo(() => resolveLessonKeys({ id: layout.objectIdHex, label: layout.name, bundle: draft.bundle, layout }), [draft.bundle, layout]);
  const pitches = [...new Map(keys.filter(key => key.note !== null).map(key => [key.note!, key.label ?? (key.steps === undefined ? noteName(key.note!) : tuningStepLabel(draft.bundle.tuning, key.steps))])).entries()].sort((a, b) => a[0] - b[0]);
  const label = (pitch: number) => pitches.find(([note]) => note === pitch)?.[1] ?? `Unavailable (${pitch})`;
  const cues = lessonCues(lesson, layout.objectIdHex, step);
  const selected = lesson.targets[step] ?? [];
  const selectedPitch=voice===undefined?undefined:selected[voice];
  const selectedCue=cues.find(cue=>cue.note===selectedPitch);
  const busy=recording||previewing;
  function selectNote(index:number,noteIndex:number){setStep(index);setVoice(noteIndex);}
  function chooseKey(index:number,note:number){
    if(busy)return;
    if(selectedPitch===note){updateCue(note,{button:index});return;}
    if(lesson.timing||selected.length)return;
    const targets=lesson.targets.map((target,i)=>i===step?[note]:target);
    const fingerings=lesson.fingerings?.filter(item=>item.layoutId!==layout.objectIdHex)??[];
    const old=lesson.fingerings?.find(item=>item.layoutId===layout.objectIdHex);
    fingerings.push({layoutId:layout.objectIdHex,steps:targets.map((_,i)=>i===step?[{note,button:index,acceptDuplicates:true}]:old?.steps[i]??[])});
    updateLesson({...lesson,targets,fingerings});setVoice(0);
  }

  function updateLesson(next: CourseLesson) {
    setDraft(current => ({ ...current, lessons: current.lessons.map((item, index) => index === lessonIndex ? next : item) }));
    setError("");
  }
  function addLesson() {
    const next: CourseLesson = { id: crypto.randomUUID(), title: "New lesson", section: lesson.section, instruction: "Play the phrase, then try it without hints.", targets: [[]], timing: { goalBpm: 80, beats: [1] }, timeSignature: { numerator: 4, denominator: 4 } };
    const lessons = [...draft.lessons];
    lessons.splice(lessonIndex + 1, 0, next);
    setDraft({ ...draft, lessons });
    setLessonIndex(lessonIndex + 1); setStep(0); setVoice(undefined); setSettingsOverlay("lesson");
  }
  function duplicateLesson(id: string) {
    const index = draft.lessons.findIndex(item => item.id === id); if (index < 0) return;
    const copy = { ...structuredClone(draft.lessons[index]), id: crypto.randomUUID(), title: `${draft.lessons[index].title} copy` };
    const lessons = [...draft.lessons]; lessons.splice(index + 1, 0, copy);
    setDraft({ ...draft, lessons }); setLessonIndex(index + 1); setStep(0); setVoice(undefined);
  }
  function deleteLesson(id: string) {
    if (draft.lessons.length === 1) return;
    const index = draft.lessons.findIndex(item => item.id === id); if (index < 0) return;
    const lessons = draft.lessons.filter(item => item.id !== id);
    const activeIndex = id === lesson.id ? Math.min(index, lessons.length - 1) : lessons.findIndex(item => item.id === lesson.id);
    setDraft({ ...draft, lessons }); setLessonIndex(activeIndex); setStep(0); setVoice(undefined);
  }
  function updateTargets(targets: readonly (readonly number[])[], beats: number[] = targets.map(() => 1)) {
    updateLesson({ ...lesson, targets, timing: lesson.timing ? { ...lesson.timing, beats, holdBeats: targets.map((notes,index)=>notes.map(note=>lesson.timing?.holdBeats?.[index]?.[lesson.targets[index]?.indexOf(note)] ?? beats[index])) } : undefined,
      fingerings: lesson.fingerings?.map(fingering => ({ ...fingering, steps: targets.map((notes, index) => (fingering.steps[index] ?? []).filter(cue => notes.includes(cue.note))) })) });
  }
  function updateCue(note: number, changes: Partial<KeyCue>) {
    const old = lesson.fingerings?.find(fingering => fingering.layoutId === layout.objectIdHex);
    const steps = lesson.targets.map((_, index) => [...(old?.steps[index] ?? [])]);
    const nextCue = { ...cues.find(cue => cue.note === note), note, ...changes };
    steps[step] = [...steps[step].filter(cue => cue.note !== note), nextCue];
    updateLesson({ ...lesson, fingerings: [...(lesson.fingerings ?? []).filter(fingering => fingering.layoutId !== layout.objectIdHex), { layoutId: layout.objectIdHex, steps }] });
  }

  function moveStep(delta:number){updateLesson(reorderSteps(lesson,step,step+delta));setStep(step+delta);}
  function addStep() {
    updateTargets([...lesson.targets, []], [...(lesson.timing?.beats ?? lesson.targets.map(() => 1)), 1]);
    setStep(lesson.targets.length);setVoice(undefined);
  }
  function removeStep() {
    updateLesson({ ...lesson, targets: lesson.targets.filter((_, index) => index !== step), timing: lesson.timing ? { ...lesson.timing, beats: lesson.timing.beats.filter((_, index) => index !== step), holdBeats: lesson.timing.holdBeats?.filter((_,index)=>index!==step) } : undefined,
      fingerings: lesson.fingerings?.map(item => ({ ...item, steps: item.steps.filter((_, index) => index !== step) })) });
    setStep(Math.max(0, step - 1));
  }
  function replacePhrase() {
    try {
      const parsed = parsePhrase(phrase);
      if (parsed.targets.flat().some(note => !pitches.some(([pitch]) => pitch === note))) throw new Error("This phrase includes notes outside the selected layout. Choose another layout or octave.");
      updateLesson({ ...lesson, targets: parsed.targets, fingerings: [], timing: lesson.timing || parsed.targets.some(notes => !notes.length) || parsed.beats.some(beats => beats !== 1) ? { goalBpm: lesson.timing?.goalBpm ?? 80, beats: parsed.beats } : undefined });
      setStep(0);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not read phrase."); }
  }
  async function save() {
    setSaving(true);
    try { await writes.current.catch(()=>{}); await onSave(parseCourse(draft)); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not save course."); } finally { setSaving(false); }
  }
  function disposeCapture() {
    captureGeneration.current++;
    click.current?.stop(); click.current = null;
    const session = device.current; device.current = null; session?.stop();
    const audio = synth.current; synth.current = null; void audio?.close().catch(() => {});
  }
  function finishRecording() {
    const phrase = capture.current;
    phrase?.flush(performance.now());
    if (phrase?.targets.length) {
      const recordedLesson={ ...lesson, targets: phrase.targets, timing: lesson.timing ? { ...lesson.timing, beats: phrase.beats, holdBeats: phrase.holdBeats } : undefined,
        fingerings: [{ layoutId: layout.objectIdHex, steps: phrase.cues }] };
      const recordedCourse={...draft,lessons:draft.lessons.map((item,index)=>index===lessonIndex?recordedLesson:item)};
      setDraft(recordedCourse);setError("");
      writes.current=writes.current.catch(()=>{}).then(()=>courseStorage.saveDraft(recordedCourse));
      void writes.current.catch(()=>setDraftStatus("Recording draft could not be saved. Export it before closing."));
      setStep(0);
    }
    capture.current = null;
    disposeCapture(); setRecording(false);
  }
  const finishRef = useRef(finishRecording); finishRef.current = finishRecording;
  useEffect(() => {
    const pause = () => { if (document.hidden) {finishRef.current();stopPreview();} };
    const leave = () => {finishRef.current();stopPreview();};
    document.addEventListener("visibilitychange", pause);
    window.addEventListener("pagehide", leave);
    return () => { document.removeEventListener("visibilitychange", pause); window.removeEventListener("pagehide", leave); if(capture.current)finishRef.current();else disposeCapture();stopPreview(); };
  }, []);
  useEffect(() => { if (!connected && recording) { finishRef.current(); setError("HexBoard disconnected. Recorded notes are kept in the draft."); } }, [connected]);
  async function startRecording() {
    stopPreview();
    if (lesson.timing && (!Number.isInteger(lesson.timing.goalBpm) || lesson.timing.goalBpm < 20 || lesson.timing.goalBpm > 300)) { setError("Choose a tempo from 20 to 300 BPM before recording."); return; }
    disposeCapture(); const version = captureGeneration.current;
    const recorder = new PhraseRecorder(recordMode, lesson.timing?.goalBpm, recordSnap);
    capture.current = recorder; setRecording(true); setRecordedCount(0); setError("");
    try {
      const audio = new SynthPreviewController(); synth.current = audio;
      audio.setPatch({ wavetableName: "Basic Shapes", wavetableFolderPath: "/Built In", wavetableSamples: createBasicShapesSamples(), values: { EnvelopeAttackIndex: 1, EnvelopeSustainLevel: 100, EnvelopeReleaseIndex: 5 } });
      await audio.start(); if (captureGeneration.current !== version) return;
      const session = new DelegatedSession(transport, (index, pressed, at = performance.now()) => {
        const note = keys[index]?.note; if (note === null || note === undefined) return;
        if (pressed) { if (recorder.press(index, note, at)) void audio.noteOn(note).catch(() => { finishRef.current(); setError("Recording audio stopped."); }); }
        else { recorder.release(index, at); if (![...recorder.held.values()].includes(note)) audio.noteOff(note); }
        session.setLights(keys.map(key => lessonLedColor(key.note, recorder.held.has(key.key.index) ? "held" : "rest", {bundle: draft.bundle, steps:key.steps ?? 0,root:0,mode:0,index:key.key.index})));
        setRecordedCount(recorder.targets.length);
        if (recorder.targets.length >= 256) { finishRef.current(); setError("Reached 256 steps. Continue in another lesson."); }
      }, reason => { if (captureGeneration.current === version) { finishRef.current(); setError(reason); } });
      device.current = session; await session.start();
      if (captureGeneration.current !== version) return;
      session.setDisplayRotation(layout.deviceRotationSteps);
      if (lesson.timing) { const clock = new PracticeMetronome(); click.current = clock; await clock.start(lesson.timing.goalBpm, 2048); if (captureGeneration.current !== version) return; }
      session.setLights(keys.map(key => lessonLedColor(key.note, "rest", {bundle:draft.bundle,steps:key.steps ?? 0,root:0,mode:0,index:key.key.index})));
    } catch (error) { if (captureGeneration.current === version) { finishRef.current(); setError(error instanceof Error ? error.message : "Could not start recording."); } }
  }
  const angle = layout.deviceRotationSteps * 90;
  const sideways = layout.deviceRotationSteps % 2 !== 0;
  const width = sideways ? 620 : 550, height = sideways ? 550 : 620;
  if(learnerPreview)return renderPreview(draft,lessonIndex,()=>setLearnerPreview(false));
  return <section className="learnCard courseEditor" aria-label="Course editor">
    <header className="learnPracticeHeader"><h2>Course editor</h2><div className="learnActions">
      <button type="button" disabled={busy} onClick={()=>setSettingsOverlay("lesson")}>Lesson Settings</button><button type="button" disabled={busy} onClick={()=>setSettingsOverlay("course")}>Course Settings</button><button type="button" disabled={busy} onClick={()=>setLearnerPreview(true)}>Preview as learner</button>
      <button type="button" disabled={busy||!undoStack.current.length} onClick={undo}>Undo</button><button type="button" disabled={busy||!redoStack.current.length} onClick={redo}>Redo</button>
      <button type="button" disabled={busy} onClick={()=>{if(dirty)setCloseWarning(true);else void closeEditor();}}>Close</button><button type="button" className="primary" disabled={busy||saving} onClick={()=>void save()}>Save course</button>
    </div></header>
    <p role="status" className="learnMuted">{draftStatus}</p>
    {closeWarning&&<div className="learnWarning" role="alert"><p>Your course has unsaved edits.</p><div className="learnActions"><button onClick={()=>void closeEditor()}>Keep draft and close</button><button onClick={()=>void closeEditor(true)}>Discard draft</button><button onClick={()=>setCloseWarning(false)}>Keep editing</button></div></div>}
    {settingsOverlay==="course"&&<div className="modalOverlay" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setSettingsOverlay(undefined);}}><section className="modalPanel courseSettingsDialog" role="dialog" aria-modal="true" aria-labelledby="course-settings-title"><header className="learnPracticeHeader"><h3 id="course-settings-title">Course Settings</h3><button type="button" onClick={()=>setSettingsOverlay(undefined)}>Close</button></header>
      <label className="learnField">Course title<input autoFocus value={draft.title} maxLength={100} onChange={event=>setDraft({...draft,title:event.target.value})}/></label>
      <label className="learnField">Author<input value={draft.author} maxLength={100} onChange={event=>setDraft({...draft,author:event.target.value})}/></label>
      <label className="learnField">Course introduction · Markdown<textarea rows={5} maxLength={50000} value={draft.description??""} onChange={event=>setDraft({...draft,description:event.target.value})}/></label>
      <CourseInstrumentSelector current={draft.bundle} requiredLayout={draft.layoutId} bundles={bundles} transport={transport} connected={connected} onApply={(bundle,required)=>{const changed=JSON.stringify(bundle.tuning)!==JSON.stringify(draft.bundle.tuning);setDraft({...draft,bundle,layoutId:required,lessons:draft.lessons.map(item=>({...item,fingerings:changed?[]:item.fingerings?.filter(cue=>bundle.layouts.some(layout=>layout.objectIdHex===cue.layoutId))}))});setLayoutId(required??bundle.activeLayoutIdHex);setVoice(undefined);setError("Selected tuning and layouts copied into this course.");}}/>
      <details className="learnSettings"><summary>Layout compatibility</summary><p>Warnings do not block saving. Transpose a layout or revise the notes and key assignments.</p><label className="learnField">Transpose {layout.name} · tuning steps<DeferredNumberInput value={0} min={-127} max={127} label="Layout transposition" onCommit={amount=>{if(amount)setDraft(transposeCourseLayout(draft,layout.objectIdHex,amount));}}/></label><ul>{compatibilityReport(draft).map(row=><li key={`${row.lessonId}:${row.layoutId}`}>{row.lesson} · {row.layout}: {row.issues.length?row.issues.join("; "):"Compatible"}</li>)}</ul></details>
    </section></div>}
    {settingsOverlay==="lesson"&&<div className="modalOverlay" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setSettingsOverlay(undefined);}}><section className="modalPanel lessonSettingsDialog" role="dialog" aria-modal="true" aria-labelledby="lesson-settings-title"><header className="learnPracticeHeader"><h3 id="lesson-settings-title">Lesson Settings</h3><button type="button" onClick={()=>setSettingsOverlay(undefined)}>Close</button></header>
      <div className="courseEditorFields"><label className="learnField">Section<input autoFocus list="course-sections" value={lesson.section} maxLength={80} onChange={event=>updateLesson({...lesson,section:event.target.value})}/><datalist id="course-sections">{[...new Set(draft.lessons.map(item=>item.section))].map(section=><option key={section} value={section}/>)}</datalist></label>
      <label className="learnField">Lesson type<select value={lesson.kind??"practice"} onChange={event=>updateLesson({...lesson,kind:event.target.value as "practice"|"content",...(event.target.value==="practice"&&!lesson.targets.length?{targets:[[]],timing:{goalBpm:80,beats:[1]}}:{})})}><option value="practice">Practice lesson</option><option value="content">Markdown page</option></select></label>
      {lesson.kind!=="content"&&<><label className="learnField">Timing<select value={lesson.timing?"beat":"free"} onChange={event=>{updateLesson({...lesson,timing:event.target.value==="beat"?{goalBpm:80,beats:lesson.targets.map(()=>1)}:undefined});setVoice(undefined);}}><option value="beat">Metronome</option><option value="free">Free timing</option></select></label><label className="learnField">Recording<select value={recordMode} onChange={event=>setRecordMode(event.target.value as "melody"|"chords")}><option value="melody">Melody · each press</option><option value="chords">Chords · release to finish</option></select></label></>}
      </div>
      {lesson.kind!=="content"&&<div className="courseEditorFields"><label className="learnField">Grading<select value={lesson.assessment?.graded===false?"explore":"graded"} onChange={event=>updateLesson({...lesson,assessment:{...lesson.assessment,graded:event.target.value==="graded"}})}><option value="graded">Graded practice</option><option value="explore">Exploratory · no grade</option></select></label>
      {lesson.assessment?.graded!==false&&<>{lesson.timing&&<label className="learnField">Passing rhythm score<DeferredNumberInput value={lesson.assessment?.passingScore??75} min={0} max={100} onCommit={value=>updateLesson({...lesson,assessment:{...lesson.assessment,passingScore:value}})}/></label>}<label><input type="checkbox" checked={lesson.repetitions!==undefined} onChange={event=>updateLesson({...lesson,repetitions:event.target.checked?1:undefined})}/> Require clean repetitions</label>{lesson.repetitions!==undefined&&<label className="learnField">Clean runs in a row<DeferredNumberInput value={lesson.repetitions} min={1} max={100} onCommit={value=>updateLesson({...lesson,repetitions:value})}/></label>}<label><input type="checkbox" checked={lesson.assessment?.trackIndependence!==false} onChange={event=>updateLesson({...lesson,assessment:{...lesson.assessment,trackIndependence:event.target.checked}})}/> Track independence</label></>}
      <label><input type="checkbox" checked={lesson.assessment?.requireButtons===true} onChange={event=>updateLesson({...lesson,assessment:{...lesson.assessment,requireButtons:event.target.checked}})}/> Require specified buttons</label></div>}
      <label className="learnField">Lesson explanation<textarea rows={4} maxLength={2000} value={lesson.instruction} onChange={event=>updateLesson({...lesson,instruction:event.target.value})}/></label>
    </section></div>}
    <div className="courseAuthorWorkspace"><CourseOutline lessons={draft.lessons} selected={lesson.id} disabled={busy} onAdd={addLesson} onDuplicate={duplicateLesson} onDelete={deleteLesson} onSelect={id=>{setLessonIndex(draft.lessons.findIndex(item=>item.id===id));setStep(0);setVoice(undefined);setPhrase("");}} onChange={lessons=>{const id=lesson.id;setDraft({...draft,lessons});setLessonIndex(lessons.findIndex(item=>item.id===id));}}/><div>
    <label className="learnField courseLessonTitle">Lesson title<input value={lesson.title} maxLength={100} onChange={event=>updateLesson({...lesson,title:event.target.value})}/></label>
    <fieldset disabled={busy} className="courseEditorBody">
      {lesson.kind==="content"?<><label className="learnField">Page Markdown<textarea rows={16} value={lesson.markdown??""} maxLength={50000} onChange={event=>updateLesson({...lesson,markdown:event.target.value})}/></label><CourseMarkdown source={lesson.markdown??""}/></>:<>
      <div className="coursePianoToolbar" aria-label="Lesson playback and recording controls">
        {previewing?<button type="button" onClick={stopPreview}>■ Stop</button>:<button type="button" disabled={recording||!lesson.targets.some(notes=>notes.length)} onClick={()=>void playPreview()}>▶ Play</button>}
        {recording?<button type="button" onClick={finishRecording}>■ Stop recording · {recordedCount}</button>:<button type="button" disabled={!connected||previewing} onClick={()=>void startRecording()}>● Record</button>}
        {lesson.timing&&<label>BPM <DeferredNumberInput value={lesson.timing.goalBpm} min={20} max={300} label="Goal tempo" onCommit={value=>updateLesson({...lesson,timing:{...lesson.timing!,goalBpm:value}})}/></label>}
        <label>Meter <span className="courseMeter"><DeferredNumberInput value={lesson.timeSignature?.numerator??4} min={1} max={16} label="Beats per measure" onCommit={value=>updateLesson({...lesson,timeSignature:{numerator:value,denominator:lesson.timeSignature?.denominator??4}})}/><span>/</span><select aria-label="Time signature denominator" value={lesson.timeSignature?.denominator??4} onChange={event=>updateLesson({...lesson,timeSignature:{numerator:lesson.timeSignature?.numerator??4,denominator:Number(event.target.value)}})}>{[2,4,8,16].map(value=><option key={value} value={value}>{value}</option>)}</select></span></label>
        <label>Snap <select aria-label="Note snap" value={lesson.timing?recordSnap:1} disabled={!lesson.timing} onChange={event=>setRecordSnap(Number(event.target.value))}>{snapOptions.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      </div>
      {<PianoRoll key={lesson.id} lesson={lesson} pitches={pitches} disabled={busy} selection={voice===undefined?undefined:{step,voice}} playhead={playhead} snap={recordSnap}
        color={pitch=>lessonScreenColor(lessonLedColor(pitch,"target",{bundle:{...draft.bundle,activeLayoutIdHex:layout.objectIdHex},steps:keys.find(key=>key.note===pitch)?.steps??0,root:0,mode:0,index:keys.find(key=>key.note===pitch)?.key.index??0})).fill}
        onSelect={selected=>selectNote(selected.step,selected.voice)} onChange={(next,selected)=>{updateLesson(next);setStep(selected?.step??Math.min(step,next.targets.length-1));setVoice(selected?.voice);}}/>
      }
      <div className="courseAssignmentPanels">
        <section className="courseAssignmentPanel" aria-label="Preferred key panel"><div className="learnPracticeHeader"><h3>2. Choose a key</h3><span>{selectedPitch===undefined?"Select a note above":label(selectedPitch)}</span></div>
          {!draft.layoutId&&draft.bundle.layouts.length>1&&<div className="learnActions courseLayoutTabs">{draft.bundle.layouts.map(item=><button type="button" key={item.objectIdHex} aria-pressed={layout.objectIdHex===item.objectIdHex} onClick={()=>setLayoutId(item.objectIdHex)}>{item.name}</button>)}</div>}
          <svg className="learnBoard courseEditorBoard" viewBox={`0 0 ${width} ${height}`} aria-label="Course fingering map"><g transform={`translate(${width/2} ${height/2}) rotate(${angle}) translate(-275 -310)`}>{keys.filter(({key})=>key.role!=="command").map(({key,note,steps})=>{
            const matching=note!==null&&note===selectedPitch;
            const preferred=matching&&(selectedCue?.button===undefined||selectedCue.button===key.index);
            const playable=!busy&&note!==null&&(matching||(!lesson.timing&&!selected.length));
            const color=lessonScreenColor(lessonLedColor(note,sounding.includes(note??-1)?"held":preferred?"target":matching?"alternate":"rest",{bundle:{...draft.bundle,activeLayoutIdHex:layout.objectIdHex},steps:steps??0,root:0,mode:0,index:key.index}));
            const choose=()=>{if(playable)chooseKey(key.index,note!);};
            return <g key={key.index} transform={`translate(${32+key.coordCol*25} ${35+key.row*42})`} className={`learnKey ${preferred?"target":"rest"}`} role={playable?"button":undefined} tabIndex={playable?0:undefined} aria-label={`Assign ${note===null?"unavailable":label(note)}, key ${key.index}`} onClick={choose} onKeyDown={event=>{if(["Enter"," "].includes(event.key)){event.preventDefault();choose();}}}>
              <polygon points="0,-25 22,-12.5 22,12.5 0,25 -22,12.5 -22,-12.5" style={{fill:color.fill,opacity:selectedPitch!==undefined&&!matching&&!sounding.includes(note??-1)?0.45:1}}/>
              <text transform={`rotate(${-angle})`} textAnchor="middle" dy="4" style={{fill:color.text}}>{note===null?"·":preferred&&selectedCue&&cueLabel(selectedCue)?cueLabel(selectedCue):label(note)}</text>
            </g>;
          })}</g></svg>
          {selectedCue?.button!==undefined&&<div className="learnActions"><span>Key {selectedCue.button}</span><label className="checkField"><input type="checkbox" checked={selectedCue.acceptDuplicates!==false} onChange={event=>updateCue(selectedPitch!,{acceptDuplicates:event.target.checked})}/>Accept matching keys too</label><button type="button" onClick={()=>updateCue(selectedPitch!,{button:undefined,acceptDuplicates:true})}>Clear key</button></div>}
        </section>
        <section className="courseAssignmentPanel" aria-label="Recommended finger panel"><div className="learnPracticeHeader"><h3>3. Choose a finger</h3><span>{selectedCue&&cueLabel(selectedCue)?cueLabel(selectedCue):"Optional"}</span></div>
          <FingerHands cues={selectedCue?cues.filter(cue=>cue.hand===selectedCue.hand&&cue.finger===selectedCue.finger):[]} color={note=>lessonScreenColor(lessonLedColor(note,"target",{bundle:{...draft.bundle,activeLayoutIdHex:layout.objectIdHex},steps:keys.find(key=>key.note===note)?.steps??0,root:0,mode:0,index:keys.find(key=>key.note===note)?.key.index??0}))} disabled={busy||selectedPitch===undefined} onChoose={(hand,finger)=>{if(selectedPitch!==undefined)updateCue(selectedPitch,{hand,finger});}}/>
          <p className="learnMuted">Click a finger on either hand. 1 is the thumb; 5 is the little finger.</p>
          {selectedCue&&(selectedCue.hand||selectedCue.finger)&&<button type="button" onClick={()=>updateCue(selectedPitch!,{hand:undefined,finger:undefined})}>Clear finger</button>}
        </section>
      </div>
      <details className="learnSettings"><summary>Phrase tools</summary>
        {isLessonTuning(draft.bundle)&&<><p className="learnMuted">Type C4 D4:0.5 E4:2. Chords: [C4 E4 G4]. Rest: -:1. A length of 1 is a quarter note; 0.5 is an eighth note. Replacing the phrase clears fingerings.</p><textarea aria-label="Quick phrase" rows={2} value={phrase} onChange={event=>setPhrase(event.target.value)}/><button type="button" onClick={replacePhrase}>Replace phrase</button></>}
        <div className="learnActions"><button type="button" disabled={lesson.targets.length>=256} onClick={addStep}>Add blank step</button><button type="button" disabled={lesson.targets.length===1} onClick={()=>{removeStep();setVoice(undefined);}}>Remove selected step</button><button type="button" disabled={step===0} onClick={()=>moveStep(-1)}>Earlier step</button><button type="button" disabled={step===lesson.targets.length-1} onClick={()=>moveStep(1)}>Later step</button><button type="button" onClick={exportDraft}>Export draft backup</button></div>
      </details>
      </>}
    </fieldset>
    {error&&<p className="learnWarning" role="alert">{error}</p>}</div></div>
  </section>;
}
