import { useEffect, useMemo, useRef, useState } from "react";
import type { MidiTransport } from "../midi/types.ts";
import { DelegatedSession } from "./delegatedSession.ts";
import { PracticeMetronome } from "./practiceMetronome.ts";
import { PhraseRecorder } from "./phraseRecorder.ts";
import { SynthPreviewController } from "../audio/synthPreview.ts";
import { createBasicShapesSamples } from "../catalogs/factoryWavetables.ts";
import { lessonLedColor } from "./lessonColors.ts";
import type { TuningBundle } from "../catalogs/layoutsCatalog.ts";
import { type CourseLesson, type KeyCue } from "./beginnerCourse.ts";
import { cueLabel, lessonCues, parseCourse, parsePhrase, type UserCourse } from "./courseFiles.ts";
import { isLessonTuning, noteName, resolveLessonKeys } from "./majorScale.ts";
import { tuningStepLabel } from "./tuningPractice.ts";

export function CourseEditor({ initial, bundles, transport, connected, onSave, onClose }: {
  initial: UserCourse; bundles: TuningBundle[]; transport: MidiTransport; connected: boolean; onSave: (course: UserCourse) => void; onClose: () => void;
}) {
  const [recording, setRecording] = useState(false);
  const [recordMode, setRecordMode] = useState<"melody" | "chords">("melody");
  const [recordedCount, setRecordedCount] = useState(0);
  const capture = useRef<PhraseRecorder | null>(null);
  const device = useRef<DelegatedSession | null>(null);
  const synth = useRef<SynthPreviewController | null>(null);
  const click = useRef<PracticeMetronome | null>(null);
  const captureGeneration = useRef(0);
  const [draft, setDraft] = useState(initial);
  const [lessonIndex, setLessonIndex] = useState(0);
  const [step, setStep] = useState(0);
  const [layoutId, setLayoutId] = useState(initial.layoutId ?? initial.bundle.activeLayoutIdHex);
  const [phrase, setPhrase] = useState("");
  const [error, setError] = useState("");
  const lesson = draft.lessons[lessonIndex];
  const layout = draft.bundle.layouts.find(layout => layout.objectIdHex === layoutId) ?? draft.bundle.layouts[0];
  const keys = useMemo(() => resolveLessonKeys({ id: layout.objectIdHex, label: layout.name, bundle: draft.bundle, layout }), [draft.bundle, layout]);
  const pitches = [...new Map(keys.filter(key => key.note !== null).map(key => [key.note!, key.label ?? (key.steps === undefined ? noteName(key.note!) : tuningStepLabel(draft.bundle.tuning, key.steps))])).entries()].sort((a, b) => a[0] - b[0]);
  const defaultNote = pitches.find(([pitch]) => pitch >= 60)?.[0] ?? pitches[0]?.[0] ?? 60;
  const label = (pitch: number) => pitches.find(([note]) => note === pitch)?.[1] ?? `Unavailable (${pitch})`;
  const cues = lessonCues(lesson, layout.objectIdHex, step);
  const selected = lesson.targets[step];
  function updateLesson(next: CourseLesson) {
    setDraft(current => ({ ...current, lessons: current.lessons.map((item, index) => index === lessonIndex ? next : item) }));
    setError("");
  }
  function updateTargets(targets: readonly (readonly number[])[], beats: number[] = targets.map(() => 1)) {
    updateLesson({ ...lesson, targets, timing: lesson.timing ? { ...lesson.timing, beats } : undefined,
      fingerings: lesson.fingerings?.map(fingering => ({ ...fingering, steps: targets.map((notes, index) => (fingering.steps[index] ?? []).filter(cue => notes.includes(cue.note))) })) });
  }
  function updateNotes(notes: number[]) {
    updateTargets(lesson.targets.map((target, index) => index === step ? notes : target), lesson.timing?.beats);
  }
  function updateCue(note: number, changes: Partial<KeyCue>) {
    const old = lesson.fingerings?.find(fingering => fingering.layoutId === layout.objectIdHex);
    const steps = lesson.targets.map((_, index) => [...(old?.steps[index] ?? [])]);
    const nextCue = { ...cues.find(cue => cue.note === note), note, ...changes };
    steps[step] = [...steps[step].filter(cue => cue.note !== note), nextCue];
    updateLesson({ ...lesson, fingerings: [...(lesson.fingerings ?? []).filter(fingering => fingering.layoutId !== layout.objectIdHex), { layoutId: layout.objectIdHex, steps }] });
  }
  function addStep() {
    updateTargets([...lesson.targets, [defaultNote]], [...(lesson.timing?.beats ?? lesson.targets.map(() => 1)), 1]);
    setStep(lesson.targets.length);
  }
  function removeStep() {
    updateLesson({ ...lesson, targets: lesson.targets.filter((_, index) => index !== step), timing: lesson.timing ? { ...lesson.timing, beats: lesson.timing.beats.filter((_, index) => index !== step) } : undefined,
      fingerings: lesson.fingerings?.map(item => ({ ...item, steps: item.steps.filter((_, index) => index !== step) })) });
    setStep(Math.max(0, step - 1));
  }
  function replacePhrase() {
    try {
      const parsed = parsePhrase(phrase);
      if (parsed.targets.flat().some(note => !pitches.some(([pitch]) => pitch === note))) throw new Error("This phrase includes notes outside the selected layout. Choose another layout or octave.");
      updateLesson({ ...lesson, targets: parsed.targets, fingerings: [], timing: lesson.timing || parsed.targets.some(notes => !notes.length) || parsed.beats.some(beats => beats !== 1) ? { bpm: lesson.timing?.bpm ?? 80, beats: parsed.beats } : undefined });
      setStep(0);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not read phrase."); }
  }
  function save() {
    try { onSave(parseCourse(draft)); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not save course."); }
  }
  function disposeCapture() {
    captureGeneration.current++;
    click.current?.stop(); click.current = null;
    const session = device.current; device.current = null; session?.stop();
    const audio = synth.current; synth.current = null; void audio?.close().catch(() => {});
  }
  function finishRecording() {
    const phrase = capture.current;
    phrase?.flush();
    if (phrase?.targets.length) {
      updateLesson({ ...lesson, targets: phrase.targets, timing: lesson.timing ? { ...lesson.timing, beats: phrase.beats } : undefined,
        fingerings: [{ layoutId: layout.objectIdHex, steps: phrase.cues }] });
      setStep(0);
    }
    capture.current = null;
    disposeCapture(); setRecording(false);
  }
  const finishRef = useRef(finishRecording); finishRef.current = finishRecording;
  useEffect(() => {
    const pause = () => { if (document.hidden) finishRef.current(); };
    const leave = () => finishRef.current();
    document.addEventListener("visibilitychange", pause);
    window.addEventListener("pagehide", leave);
    return () => { document.removeEventListener("visibilitychange", pause); window.removeEventListener("pagehide", leave); disposeCapture(); };
  }, []);
  useEffect(() => { if (!connected && recording) { finishRef.current(); setError("HexBoard disconnected. Recorded notes are kept in the draft."); } }, [connected]);
  async function startRecording() {
    if (lesson.timing && (!Number.isInteger(lesson.timing.bpm) || lesson.timing.bpm < 40 || lesson.timing.bpm > 180)) { setError("Choose a tempo from 40 to 180 BPM before recording."); return; }
    disposeCapture(); const version = captureGeneration.current;
    const recorder = new PhraseRecorder(recordMode, lesson.timing?.bpm);
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
      if (lesson.timing) { const clock = new PracticeMetronome(); click.current = clock; await clock.start(lesson.timing.bpm, 2048); if (captureGeneration.current !== version) return; }
      session.setLights(keys.map(key => lessonLedColor(key.note, "rest", {bundle:draft.bundle,steps:key.steps ?? 0,root:0,mode:0,index:key.key.index})));
    } catch (error) { if (captureGeneration.current === version) { finishRef.current(); setError(error instanceof Error ? error.message : "Could not start recording."); } }
  }
  const availableBundles = [...new Map([draft.bundle, ...bundles].map(bundle => [bundle.objectIdHex, bundle])).values()];
  const angle = layout.deviceRotationSteps * 90;
  const sideways = layout.deviceRotationSteps % 2 !== 0;
  const width = sideways ? 620 : 550, height = sideways ? 550 : 620;
  return <section className="learnCard courseEditor" aria-label="Course editor">
    <header className="learnPracticeHeader"><h2>Course editor</h2><div className="learnActions"><button type="button" onClick={() => { disposeCapture(); onClose(); }}>Cancel</button><button className="primary" type="button" disabled={recording} onClick={save}>Save course</button></div></header>
    <div className="courseRecording learnActions">
      <label className="learnField">Record from HexBoard<select value={recordMode} disabled={recording} onChange={event => setRecordMode(event.target.value as "melody" | "chords")}><option value="melody">Melody · each press is a step</option><option value="chords">Chords · release to finish each step</option></select></label>
      {recording ? <button className="primary" type="button" onClick={finishRecording}>Finish recording · {recordedCount} steps</button> : <button type="button" disabled={!connected} onClick={() => void startRecording()}>Record phrase</button>}
      <span className="learnMuted">{recording ? "Play your phrase. Hold the encoder for 5 seconds to exit." : "Recording replaces this lesson’s steps. Actual keys become preferred fingerings; timing rounds to ¼–8 beats."}</span>
    </div>
    <fieldset disabled={recording} className="courseEditorBody">
    <div className="courseEditorFields">
      <label className="learnField">Course title<input value={draft.title} maxLength={100} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
      <label className="learnField">Author (optional)<input value={draft.author} maxLength={100} onChange={event => setDraft({ ...draft, author: event.target.value })} /></label>
      <label className="learnField">Course tuning<select value={draft.bundle.objectIdHex} onChange={event => { const bundle = availableBundles.find(bundle => bundle.objectIdHex === event.target.value)!; setDraft({ ...draft, bundle, layoutId: undefined, lessons: draft.lessons.map(lesson => ({ ...lesson, fingerings: [] })) }); setLayoutId(bundle.activeLayoutIdHex); setError("Check your notes after changing tuning. Fingering assignments have been cleared."); }}>{availableBundles.map(bundle => <option key={bundle.objectIdHex} value={bundle.objectIdHex}>{bundle.tuning.name}</option>)}</select></label>
      <label className="learnField">Required layout<select value={draft.layoutId ?? ""} onChange={event => { setDraft({ ...draft, layoutId: event.target.value || undefined }); if (event.target.value) setLayoutId(event.target.value); }}><option value="">Any compatible layout</option>{draft.bundle.layouts.map(layout => <option key={layout.objectIdHex} value={layout.objectIdHex}>{layout.name}</option>)}</select></label>
    </div>
    <div className="courseEditorWorkspace">
      <div className="learnGuide">
        <label className="learnField">Edit lesson<select value={lessonIndex} onChange={event => { setLessonIndex(Number(event.target.value)); setStep(0); setPhrase(""); }}>{draft.lessons.map((lesson, index) => <option key={lesson.id} value={index}>{index + 1}. {lesson.title}</option>)}</select></label>
        <div className="learnActions"><button type="button" disabled={draft.lessons.length >= 100} onClick={() => { setDraft({ ...draft, lessons: [...draft.lessons, { id: crypto.randomUUID(), title: "New lesson", section: "My lessons", instruction: "Play the phrase, then try it without hints.", targets: [[defaultNote]] }] }); setLessonIndex(draft.lessons.length); setStep(0); setPhrase(""); }}>Add lesson</button><button type="button" disabled={draft.lessons.length === 1} onClick={() => { setDraft({ ...draft, lessons: draft.lessons.filter((_, index) => index !== lessonIndex) }); setLessonIndex(Math.max(0, lessonIndex - 1)); setStep(0); }}>Remove lesson</button></div>
        <label className="learnField">Lesson title<input value={lesson.title} maxLength={100} onChange={event => updateLesson({ ...lesson, title: event.target.value })} /></label>
        <label className="learnField">Explain the exercise<textarea rows={4} value={lesson.instruction} maxLength={2000} onChange={event => updateLesson({ ...lesson, instruction: event.target.value })} /></label>
        <label className="learnField">Lesson timing<select value={lesson.timing ? "beat" : "free"} onChange={event => { if (event.target.value === "free" && lesson.targets.some(notes => !notes.length)) { setError("Remove rests before switching to free timing."); return; } updateLesson({ ...lesson, timing: event.target.value === "beat" ? { bpm: 80, beats: lesson.targets.map(() => 1) } : undefined }); }}><option value="free">Free timing</option><option value="beat">Metronome</option></select></label>
        {lesson.timing && <label className="learnField">Lesson tempo (BPM)<input type="number" min={40} max={180} value={lesson.timing.bpm} onChange={event => updateLesson({ ...lesson, timing: { ...lesson.timing!, bpm: Number(event.target.value) } })} /></label>}
        {isLessonTuning(draft.bundle) && <details className="learnSettings"><summary>Quick phrase entry</summary><p className="learnMuted">Use C4 D4 E4:2. Chords: [C4 E4 G4]. Rest: -:2. A length is ¼–8 beats. Replacing steps clears their fingerings.</p><textarea aria-label="Quick phrase" rows={3} value={phrase} onChange={event => setPhrase(event.target.value)} /><button type="button" onClick={replacePhrase}>Replace steps with phrase</button></details>}
      </div>
      <div>
        <div className="learnPracticeHeader"><h3>Step {step + 1} of {lesson.targets.length}</h3><div className="learnActions"><button type="button" disabled={lesson.targets.length >= 256} onClick={addStep}>Add step</button><button type="button" disabled={lesson.targets.length === 1} onClick={removeStep}>Remove step</button></div></div>
        <div className="learnScaleSteps" aria-label="Edit phrase steps">{lesson.targets.map((notes, index) => <button type="button" key={index} aria-pressed={step === index} onClick={() => setStep(index)}>{index + 1}. {notes.map(label).join(" + ") || "Rest"}{lesson.timing && ` · ${lesson.timing.beats[index]}b`}</button>)}</div>
        <div className="learnFieldPair"><label className="learnField">Fingering layout<select value={layout.objectIdHex} onChange={event => setLayoutId(event.target.value)}>{draft.bundle.layouts.filter(layout => !draft.layoutId || layout.objectIdHex === draft.layoutId).map(layout => <option key={layout.objectIdHex} value={layout.objectIdHex}>{layout.name}</option>)}</select></label>
        {lesson.timing && <label className="learnField">Step length (beats)<input type="number" min={0.25} step={0.25} max={8} value={lesson.timing.beats[step]} onChange={event => updateLesson({ ...lesson, timing: { ...lesson.timing!, beats: lesson.timing!.beats.map((beats, index) => index === step ? Number(event.target.value) : beats) } })} /></label>}</div>
        <p className="learnMuted">Click keys to add notes or choose a preferred duplicate. Finger 1 is the thumb; 5 is the little finger. Assignments apply only to this layout.</p>
        {selected.map((note, index) => {
          const cue = cues.find(cue => cue.note === note);
          return <div className="courseNoteRow" key={`${step}:${index}`}>
            <label className="learnField">Note {index + 1}<select value={note} onChange={event => { const pitch = Number(event.target.value); if (!selected.includes(pitch)) updateNotes(selected.map((note, i) => i === index ? pitch : note)); }}>{!pitches.some(([pitch]) => pitch === note) && <option value={note}>{label(note)}</option>}{pitches.map(([pitch, name]) => <option key={pitch} value={pitch}>{name}</option>)}</select></label>
            <label className="learnField">Hand<select aria-label={`Hand for note ${index + 1}`} value={cue?.hand ?? ""} onChange={event => updateCue(note, { hand: (event.target.value || undefined) as KeyCue["hand"] })}><option value="">Any</option><option value="left">Left</option><option value="right">Right</option></select></label>
            <label className="learnField">Finger<select aria-label={`Finger for note ${index + 1}`} value={cue?.finger ?? ""} onChange={event => updateCue(note, { finger: event.target.value ? Number(event.target.value) : undefined })}><option value="">Any</option>{[1,2,3,4,5].map(finger => <option key={finger} value={finger}>{finger}</option>)}</select></label>
            <label className="learnField">Preferred key<select aria-label={`Preferred key for note ${index + 1}`} value={cue?.button ?? ""} onChange={event => updateCue(note, { button: event.target.value ? Number(event.target.value) : undefined })}><option value="">Any matching key</option>{keys.filter(key => key.note === note).map(({key}) => <option key={key.index} value={key.index}>Key {key.index}</option>)}</select></label>
            {cue?.button !== undefined && <label className="checkField"><input type="checkbox" checked={cue.acceptDuplicates !== false} onChange={event => updateCue(note, { acceptDuplicates: event.target.checked })} />Accept duplicates</label>}
            <button type="button" aria-label={`Remove note ${index + 1}`} disabled={selected.length === 1 && !lesson.timing} onClick={() => updateNotes(selected.filter((_, i) => i !== index))}>×</button>
          </div>;
        })}
        <div className="learnActions"><button type="button" disabled={selected.length >= 10 || pitches.every(([pitch]) => selected.includes(pitch))} onClick={() => updateNotes([...selected, pitches.find(([pitch]) => !selected.includes(pitch))![0]])}>Add note</button>{lesson.timing && <button type="button" onClick={() => updateNotes([])}>Make rest</button>}</div>
        <svg className="learnBoard courseEditorBoard" viewBox={`0 0 ${width} ${height}`} aria-label="Course fingering map"><g transform={`translate(${width / 2} ${height / 2}) rotate(${angle}) translate(-275 -310)`}>{keys.filter(({key}) => key.role !== "command").map(({key,note}) => {
          const cue = cues.find(cue => cue.note === note);
          const preferred = note !== null && selected.includes(note) && (cue?.button === undefined || cue.button === key.index);
          const choose = () => { if (recording || note === null) return; if (!selected.includes(note)) { if (selected.length < 10) updateNotes([...selected, note]); } else updateCue(note, { button: key.index }); };
          return <g key={key.index} transform={`translate(${32 + key.coordCol * 25} ${35 + key.row * 42})`} className={`learnKey ${preferred ? "target" : "rest"}`} role={note === null ? undefined : "button"} tabIndex={note === null ? undefined : 0} aria-label={`Assign ${note === null ? "unavailable" : label(note)}, key ${key.index}`} onClick={choose} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(); } }}><polygon points="0,-25 22,-12.5 22,12.5 0,25 -22,12.5 -22,-12.5" style={{fill:preferred ? "var(--surface-accent)" : undefined}}/><text transform={`rotate(${-angle})`} textAnchor="middle" dy="4">{note === null ? "·" : cue && preferred && cueLabel(cue) ? cueLabel(cue) : label(note)}</text></g>;
        })}</g></svg>
      </div>
    </div>
    </fieldset>
    {error && <p className="learnWarning" role="alert">{error}</p>}
  </section>;
}
