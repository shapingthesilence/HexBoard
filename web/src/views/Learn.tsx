import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { MidiTransport } from "../midi/types.ts";
import { SynthPreviewController } from "../audio/synthPreview.ts";
import { createBasicShapesSamples } from "../catalogs/factoryWavetables.ts";
import { parseTuningBundleFile, ColorMode, type ColorModeValue, type TuningBundle, type TuningBundleScale } from "../catalogs/layoutsCatalog.ts";
import { DelegatedSession } from "../learn/delegatedSession.ts";
import { lessonLedColor, lessonScreenColor } from "../learn/lessonColors.ts";
import { keyLight, isLessonTuning, lessonLayouts, MajorScaleRun, noteName, resolveLessonKeys, starterLayouts, unavailableScaleNotes, type LessonLayout } from "../learn/majorScale.ts";

import { BeatScaleRun, scalePatterns, scalePatternNotes, type ScalePattern, type BeatResult } from "../learn/scalePractice.ts";
import { CapabilityFlag, ObjectType, type HelloResponsePayload, type ObjectListRecord } from "../protocol/index.ts";
import { lessonDeviceLibrary } from "../learn/deviceLibrary.ts";
import { scaleSteps, tuningPitch, tuningStepLabel } from "../learn/tuningPractice.ts";
import { PracticeMetronome } from "../learn/practiceMetronome.ts";

import { FingerHands } from "../learn/FingerHands.tsx";
import { intermediateCourse } from "../learn/intermediateCourse.ts";
import {CourseMarkdown} from "../learn/CourseMarkdown.tsx";
import {compatibilityReport} from "../learn/courseStructure.ts";
import { CourseEditor } from "../learn/CourseEditor.tsx";
import { courseFormat, canPassTimedLesson, parseCourse, courseProgressId, courseLayoutProgressId, courseKeyLight, cueAccepts, cueLabel, lessonCues, maxCourseBytes, readCourseFile, type UserCourse } from "../learn/courseFiles.ts";
import { beginnerLessons, CourseRun, courseProgressKey, parseCourseProgress, recordCourseRun, mergeCourseProgress, type CourseProgress } from "../learn/beginnerCourse.ts";

import { courseStorage, type CourseDraft } from "../learn/courseStorage.ts";
import { LearnInputGate } from "../learn/learnInputGate.ts";
import { upcomingTimingSteps } from "../learn/timingCues.ts";
import { TimingCue } from "../learn/TimingCue.tsx";

type Stage = "ready" | "starting" | "practice" | "demo" | "complete" | "waiting" | "free";
const stepTempo = 19; // One slider position below the supported 20–300 BPM range.

export function Learn({ transport, connected, deviceHello,previewCourse,previewIndex=0,onExitPreview }: { previewCourse?:UserCourse;previewIndex?:number;onExitPreview?:()=>void;transport: MidiTransport; connected: boolean; deviceHello?: HelloResponsePayload | null }) {
  const [page, setPage] = useState<"practice" | "course" | "progress">(previewCourse?"course":"practice");
  const [userCourses, setUserCourses] = useState<UserCourse[]>([]);
  const [drafts,setDrafts]=useState<CourseDraft[]>([]);
  const [storageReady,setStorageReady]=useState(false);
  const [pendingImport,setPendingImport]=useState<UserCourse>();
  const [deletePending,setDeletePending]=useState(false);
  useEffect(()=>{let active=true;void Promise.all([courseStorage.courses(),courseStorage.drafts()]).then(([courses,drafts])=>{if(!active)return;setUserCourses(courses.flatMap(course=>{try{return [parseCourse(course)];}catch{return [];}}));setDrafts(drafts);setStorageReady(true);},()=>{if(active)setCourseMessage("Course storage is unavailable. Check browser storage permissions.");});return()=>{active=false;};},[]);
  async function refreshDrafts(){try{setDrafts(await courseStorage.drafts());}catch{setCourseMessage("Could not read recovery drafts.");}}
  const [courseId, setCourseId] = useState("builtin");
  const selectedCourse = previewCourse ?? (courseId === "builtin-intermediate" ? intermediateCourse : userCourses.find(course => course.id === courseId));
  const editableCourse = courseId !== "builtin-intermediate" && selectedCourse;
  const lessons = selectedCourse?.lessons ?? beginnerLessons;
  const [editingCourse, setEditingCourse] = useState<UserCourse>();
  const [pendingEdit, setPendingEdit] = useState<{ saved: UserCourse; draft: CourseDraft }>();
  const [courseMessage, setCourseMessage] = useState("");
  const [lessonIndex, setLessonIndex] = useState(previewIndex);
  const lesson = lessons[lessonIndex] ?? lessons[0];
  const course = page === "course";
  const [introductionSeen,setIntroductionSeen]=useState<string>();
  const showIntroduction=course&&!!selectedCourse?.description&&introductionSeen!==selectedCourse.id&&!previewCourse;
  const requiredLayout=course?(lesson.layoutId??selectedCourse?.layoutId):undefined;
  const [progress, setProgress] = useState<CourseProgress>(() => {
    try { return parseCourseProgress(localStorage.getItem(courseProgressKey)); } catch { return {}; }
  });
  const [progressMessage, setProgressMessage] = useState("");
  const [layouts, setLayouts] = useState<LessonLayout[]>(starterLayouts);
  const [layoutId, setLayoutId] = useState(() => layouts[0].id);
  const customCourse = course ? selectedCourse : undefined;
  const courseLayouts = useMemo(() => {
    if (!customCourse) return [];
    return lessonLayouts(customCourse.bundle);
  }, [customCourse, layouts]);
  const selection = customCourse
    ? courseLayouts.find(item => item.layout.objectIdHex === (requiredLayout ?? layoutId)) ?? courseLayouts.find(item => item.layout.objectIdHex === customCourse.bundle.activeLayoutIdHex) ?? courseLayouts[0]
    : course ? layouts.find(item => item.id === layoutId && isLessonTuning(item.bundle)) ?? layouts.find(item => isLessonTuning(item.bundle)) ?? layouts[0]
    : layouts.find((layout) => layout.id === layoutId) ?? layouts[0];
  const keys = useMemo(() => resolveLessonKeys(selection), [selection]);
  const [tuningChoice, setTuningChoice] = useState(layouts[0].bundle.objectIdHex);
  const [tuningNames, setTuningNames] = useState<ObjectListRecord[]>([]);
  const [deviceTuning, setDeviceTuning] = useState<TuningBundle | null>(null);
  const [layoutNames, setLayoutNames] = useState<ObjectListRecord[]>([]);
  const [scaleNames, setScaleNames] = useState<ObjectListRecord[]>([]);
  const [deviceLayoutChoice, setDeviceLayoutChoice] = useState("");
  const [loadedScale, setLoadedScale] = useState<TuningBundleScale | null>(null);
  const [scaleChoice, setScaleChoice] = useState(() => (layouts[0].bundle.scales.find(scale => /major|ionian/i.test(scale.name)) ?? layouts[0].bundle.scales[0]).objectIdHex);
  const [root, setRoot] = useState(0);
  const [register, setRegister] = useState(0);
  const [colorMode, setColorMode] = useState<ColorModeValue>(ColorMode.Rainbow);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [libraryMessage, setLibraryMessage] = useState("");
  const libraryGeneration = useRef(0);
  const library = useRef(lessonDeviceLibrary(transport));
  const fromDevice = !course && !customCourse && tuningChoice.startsWith("device:");
  const bundle = customCourse?.bundle ?? (fromDevice && deviceTuning ? deviceTuning : selection.bundle);
  const selectedScale = fromDevice ? loadedScale : bundle.scales.find(scale => scale.objectIdHex === scaleChoice) ?? bundle.scales[0];
  const baseSteps = useMemo(() => selectedScale ? scaleSteps(bundle, selectedScale, root, register) : [], [bundle, selectedScale, root, register]);
  const baseNotes = useMemo(() => baseSteps.map(step => tuningPitch(bundle.tuning, step)), [bundle, baseSteps]);
  const pitchLabels = new Map(keys.filter(key => key.note !== null).map(key => [key.note!, key.label ?? (key.steps === undefined ? noteName(key.note!) : tuningStepLabel(bundle.tuning, key.steps))]));
  baseSteps.forEach((step, i) => pitchLabels.set(baseNotes[i], tuningStepLabel(bundle.tuning, step)));
  const labelNote = (note: number) => pitchLabels.get(note) ?? `Pitch ${note.toFixed(2)}`;

  const localBundles = [...new Map(layouts.filter(layout => !layout.id.startsWith("device:")).map(layout => [layout.bundle.objectIdHex, layout.bundle])).values()];
  const [stage, setStage] = useState<Stage>("ready");
  const [pattern, setPattern] = useState<ScalePattern>("ascending");
  const notes = useMemo(() => course ? lesson.targets.map(target => target[0] ?? -1) : scalePatternNotes(pattern, baseNotes), [course, lesson, pattern, baseNotes]);
  const targets = course ? lesson.targets : notes.map(note => [note]);
  const previewNotes = course ? [...new Set(lesson.targets.flat())] : baseNotes;
  const missing = unavailableScaleNotes(keys, previewNotes, labelNote);
  const compatible = !selectedCourse||!compatibilityReport(selectedCourse).some(row=>row.lessonId===lesson.id&&row.layoutId===selection.layout.objectIdHex&&row.issues.length);
  const readyToPlay = !showIntroduction&&lesson.kind!=="content"&&compatible&&!libraryBusy && previewNotes.length > 0 && missing.length === 0 && (!fromDevice || !!deviceLayoutChoice) && (!course || !!customCourse || isLessonTuning(bundle));
  const [beatMode, setBeatMode] = useState(false);
  const [bpm, setBpm] = useState(80);
  const activeBeatMode = course ? !!lesson.timing : beatMode;
  const [practiceBpm,setPracticeBpm]=useState(80);
  useEffect(()=>{setHints(true);setPracticeBpm(lesson.timing?.goalBpm??80);},[lesson.id,courseId]);
  const stepPractice = course && !!lesson.timing && practiceBpm === stepTempo;
  const activeBpm = course ? practiceBpm : bpm;
  const [continuous, setContinuous] = useState(true);
  const [contrast,setContrast]=useState(()=>{try{const saved=Number(localStorage.getItem("hexboard.learn.contrast")??50);return Number.isFinite(saved)?Math.max(25,Math.min(85,saved)):50;}catch{return 50;}});
  useEffect(()=>{try{localStorage.setItem("hexboard.learn.contrast",String(contrast));}catch{}},[contrast]);
  const [lastRun, setLastRun] = useState<{ number: number; elapsedMs?: number; mistakes: number; beat?: BeatResult }>();
  const [now, setNow] = useState(0);
  const metronome = useRef<PracticeMetronome | null>(null);
  const [onBoard, setOnBoard] = useState(false);
  const [hints, setHints] = useState(true);
  const [demoStep, setDemoStep] = useState(0);
  const [demoNote, setDemoNote] = useState<readonly number[]>();
  const [message, setMessage] = useState("");
  const [, redraw] = useState(0);
  const run = useRef<MajorScaleRun | BeatScaleRun>(new MajorScaleRun());
  const usedHints = useRef(true);
  const streak=useRef(0),streakHints=useRef(false);
  const [streakCount,setStreakCount]=useState(0);
  useEffect(()=>{streak.current=0;streakHints.current=false;setStreakCount(0);},[courseId,lesson.id,layoutId]);
  const finalized = useRef<MajorScaleRun | BeatScaleRun | null>(null);
  const session = useRef<DelegatedSession | null>(null);
  const audio = useRef<SynthPreviewController | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const generation = useRef(0);
  const runGeneration=useRef(0);
  const inputGate=useRef(new LearnInputGate());
  const physicalKeys={current:inputGate.current.held};
  const [pendingStart,setPendingStart]=useState(false);
  const [physicalCount,setPhysicalCount]=useState(0);
  const handleKeyRef = useRef<(index: number, pressed: boolean, receivedAt?: number) => void>(() => {});
  const engaged = stage !== "ready" && stage !== "free";
  useEffect(() => { setLastRun(undefined); }, [pattern, layoutId, scaleChoice, root, register, beatMode, bpm, page, lessonIndex, courseId]);

  async function refreshDeviceNames(refresh = false) {
    if (!connected) return;
    const request = ++libraryGeneration.current;
    library.current = lessonDeviceLibrary(transport, refresh);
    if (refresh) {
      chooseLocalTuning(localBundles[0], layouts.find(item => item.bundle === localBundles[0])!.id);
      setTuningNames([]);
    }
    setLibraryBusy(true);
    setLibraryMessage("Reading tuning names…");
    try {
      const names = await library.current.tuningNames();
      if (request !== libraryGeneration.current) return;
      setTuningNames(names);
      setLibraryMessage(names.length ? "" : "No device tunings.");
    } catch (error) {
      if (request === libraryGeneration.current) setLibraryMessage(error instanceof Error ? error.message : "Could not read tuning names.");
    } finally { if (request === libraryGeneration.current) setLibraryBusy(false); }
  }
  useEffect(() => {
    library.current = lessonDeviceLibrary(transport);
    setTuningNames([]);
    chooseLocalTuning(localBundles[0], layouts.find(item => item.bundle === localBundles[0])!.id);
    setLibraryBusy(false);
    if (connected) void refreshDeviceNames();
    return () => { libraryGeneration.current++; };
  }, [transport, connected]);

  function chooseLocalTuning(next: TuningBundle, firstLayoutId: string) {
    setTuningChoice(next.objectIdHex);
    setLayoutId(firstLayoutId);
    setDeviceTuning(null);
    setDeviceLayoutChoice("");
    setLoadedScale(null);
    setScaleChoice((next.scales.find(scale => /major|ionian/i.test(scale.name)) ?? next.scales[0]).objectIdHex);
    setRoot(next.tuning.defaultKeyDegree);
    setRegister(0);
  }
  async function chooseTuning(choice: string) {
    if (!choice.startsWith("device:")) {
      const next = localBundles.find(item => item.objectIdHex === choice)!;
      chooseLocalTuning(next, layouts.find(item => item.bundle.objectIdHex === choice)!.id);
      return;
    }
    if (!((deviceHello?.capabilityFlags ?? 0) & CapabilityFlag.ScopedGeometryList)) {
      setLibraryMessage("Update HexBoard firmware to load individual layouts and scales. Starter and imported tunings remain available.");
      return;
    }
    const record = tuningNames.find(item => item.handle === Number(choice.slice(7)))!;
    const request = ++libraryGeneration.current;
    setLibraryBusy(true);
    setLibraryMessage(`Loading ${record.name} and its layout / scale names…`);
    try {
      const next = await library.current.tuning(record);
      if (request !== libraryGeneration.current) return;
      const layoutList = await library.current.names(ObjectType.UserLayout, record.handle);
      if (request !== libraryGeneration.current) return;
      const scaleList = await library.current.names(ObjectType.UserScale, record.handle);
      if (request !== libraryGeneration.current) return;
      const palette = await library.current.palette(record.handle, next.tuning.cycleLength);
      if (request !== libraryGeneration.current) return;
      setDeviceTuning({ ...next, palette });
      setTuningChoice(choice);
      setLayoutNames(layoutList);
      setScaleNames(scaleList);
      setDeviceLayoutChoice("");
      setScaleChoice("");
      setLoadedScale(null);
      setRoot(next.tuning.defaultKeyDegree);
      setRegister(0);
      setLibraryMessage("Choose a layout and scale.");
    } catch (error) {
      if (request === libraryGeneration.current) setLibraryMessage(error instanceof Error ? error.message : "Could not load that tuning.");
    } finally { if (request === libraryGeneration.current) setLibraryBusy(false); }
  }
  async function chooseDeviceLayout(value: string) {
    if (!value || !deviceTuning) return;
    const record = layoutNames.find(item => item.handle === Number(value))!;
    const request = ++libraryGeneration.current;
    setLibraryBusy(true);
    setLibraryMessage(`Loading ${record.name}…`);
    try {
      const layout = await library.current.layout(Number(tuningChoice.slice(7)), record);
      if (request !== libraryGeneration.current) return;
      const id = `device:${deviceTuning.objectIdHex}:${layout.objectIdHex}`;
      const entry = { id, label: layout.name, layout, bundle: { ...deviceTuning, layouts: [layout], activeLayoutIdHex: layout.objectIdHex } };
      setLayouts(current => [...current.filter(item => item.id !== id), entry]);
      setLayoutId(id);
      setDeviceLayoutChoice(value);
      setLibraryMessage("");
    } catch (error) {
      if (request === libraryGeneration.current) setLibraryMessage(error instanceof Error ? error.message : "Could not load that layout.");
    } finally { if (request === libraryGeneration.current) setLibraryBusy(false); }
  }
  async function chooseDeviceScale(value: string) {
    if (!value || !deviceTuning) return;
    const record = scaleNames.find(item => item.handle === Number(value))!;
    const request = ++libraryGeneration.current;
    setLibraryBusy(true);
    setLibraryMessage(`Loading ${record.name}…`);
    try {
      const scale = await library.current.scale(record, deviceTuning.tuning.cycleLength);
      if (request !== libraryGeneration.current) return;
      setLoadedScale(scale);
      setScaleChoice(value);
      setLibraryMessage("");
    } catch (error) {
      if (request === libraryGeneration.current) setLibraryMessage(error instanceof Error ? error.message : "Could not load that scale.");
    } finally { if (request === libraryGeneration.current) setLibraryBusy(false); }
  }

  function clearTimers() { timers.current.forEach(clearTimeout); timers.current = []; }
  function clearRun() {
    runGeneration.current++; inputGate.current.resetRun(); clearTimers(); metronome.current?.stop(); metronome.current=null;
    audio.current?.allNotesOff(); run.current.held.clear(); setDemoNote(undefined); setLastRun(undefined);setPendingStart(false);
  }
  function dispose() {
    generation.current++;
    clearRun(); inputGate.current.clear(); setPhysicalCount(0);
    const oldSession = session.current;
    session.current = null;
    oldSession?.stop();
    const oldAudio = audio.current;
    audio.current = null;
    void oldAudio?.close().catch(() => {});
    run.current = course ? new CourseRun(lesson, selection.layout.objectIdHex, labelNote) : new MajorScaleRun(notes, labelNote);
  }
  function stop(reason = "") {
    streak.current=0;streakHints.current=false;setStreakCount(0);
    dispose();
    setOnBoard(false);
    setStage("ready");
    setDemoNote(undefined);
    setMessage(reason);
  }

  useEffect(() => {
    setStage("ready");
    setDemoNote(undefined);
    const pause = () => { if (document.hidden) stop("Lesson paused while this tab is hidden. Start again when ready."); };
    const leave = () => dispose();
    document.addEventListener("visibilitychange", pause);
    window.addEventListener("pagehide", leave);
    return () => {
      document.removeEventListener("visibilitychange", pause);
      window.removeEventListener("pagehide", leave);
      dispose();
    };
  }, [transport]);

  useEffect(() => {
    if (onBoard && !connected) stop("HexBoard disconnected. The lesson has stopped.");
  }, [connected, transport]);

  async function begin(useBoard: boolean, free = false) {
    streak.current=0;streakHints.current=false;setStreakCount(0);
    if(useBoard && session.current && audio.current){if(free){clearRun();setStage("free");setMessage("");}else await repeat(hints);return;}
    dispose();
    const currentGeneration = generation.current;
    const controller = new SynthPreviewController();
    audio.current = controller;
    controller.setPatch({ wavetableName: "Basic Shapes", wavetableFolderPath: "/Built In", wavetableSamples: createBasicShapesSamples(),
      values: { EnvelopeAttackIndex: 1, EnvelopeSustainLevel: 100, EnvelopeReleaseIndex: 5 } });
    run.current = course ? new CourseRun(lesson, selection.layout.objectIdHex, labelNote) : new MajorScaleRun(notes, labelNote);
    setLastRun(undefined);
    setOnBoard(useBoard);
    setStage("starting");
    setMessage("Preparing your lesson…");
    try {
      await controller.start();
      if (generation.current !== currentGeneration) return;
      if (useBoard) {
        const nextSession = new DelegatedSession(transport,
          (index, pressed, receivedAt) => { const accepted=inputGate.current.event(index,pressed);setPhysicalCount(physicalKeys.current.size);if(accepted)handleKeyRef.current(index, pressed, receivedAt); },
          (reason) => { if (generation.current === currentGeneration) stop(reason); });
        session.current = nextSession;
        await nextSession.start();
        nextSession.setDisplayRotation(selection.layout.deviceRotationSteps);
      }
      if (generation.current !== currentGeneration) return;
      if(free){setStage("free");setMessage("");return;}
      await prepareRun();
      if (generation.current !== currentGeneration) return;
      if(physicalKeys.current.size){clearRun();setStage("waiting");setPendingStart(true);return;}
      setStage("practice");
      setMessage("");
    } catch (error) {
      if (generation.current === currentGeneration) stop(error instanceof Error ? error.message : "Could not start the lesson.");
    }
  }

  async function prepareRun(showHints = hints) {
    usedHints.current = showHints;
    const currentGeneration = generation.current;
    const currentRun=runGeneration.current;
    metronome.current?.stop();
    metronome.current = null;
    run.current = course ? new CourseRun(lesson, selection.layout.objectIdHex, labelNote) : new MajorScaleRun(notes, labelNote);
    if (activeBeatMode && !stepPractice) {
      const clock = new PracticeMetronome();
      metronome.current = clock;
      const startAt = await clock.start(activeBpm, course && lesson.timing ? lesson.timing.beats.reduce((sum, beats) => sum + beats, 0) : notes.length);
      if (generation.current !== currentGeneration || runGeneration.current !== currentRun) { clock.stop(); return; }
      run.current = new BeatScaleRun(notes, startAt, activeBpm, labelNote, course && lesson.timing ? {
        targets: lesson.targets, beats: lesson.timing.beats,
        accepts: (step, index, note) => cueAccepts(lessonCues(lesson, selection.layout.objectIdHex, step), index, note)
      } : undefined);
    }
  }

  function finishRun() {
    const finished = run.current;
    if (finalized.current === finished) return;
    finalized.current = finished;
    const beat = finished instanceof BeatScaleRun ? finished.result() : undefined;
    setLastRun((last) => ({ number: (last?.number ?? 0) + 1, elapsedMs: finished.elapsedMs, mistakes: finished.mistakes, beat }));
    const passed=(finished instanceof CourseRun&&!lesson.timing)||!!(beat&&canPassTimedLesson(lesson,activeBpm,beat.score,beat.missed));
    const required=lesson.repetitions??1;
    const clean=passed&&finished.mistakes===0&&(!beat||beat.extras===0&&beat.missed===0);
    if(course){streak.current=clean?streak.current+1:0;streakHints.current=clean?(streakHints.current||usedHints.current):false;setStreakCount(streak.current);}
    if (course && lesson.kind!=="content"&&lesson.assessment?.graded!==false&&passed&&(lesson.repetitions===undefined||streak.current>=required)) {
      const nextProgress = recordCourseRun(progress, courseProgressId(selectedCourse, lesson.id), selectedCourse ? courseLayoutProgressId(bundle,selection.layout) : `${bundle.objectIdHex}:${selection.layout.objectIdHex}`, finished.mistakes, usedHints.current||(required>1&&streakHints.current)||lesson.assessment?.trackIndependence===false, undefined, beat ? {score:beat.score,bpm:activeBpm} : undefined);
      setProgress(nextProgress);
      try { if(!previewCourse)localStorage.setItem(courseProgressKey, JSON.stringify(nextProgress)); setProgressMessage(""); }
      catch { setProgressMessage("Progress could not be saved in this browser."); }
    }
    if(course && lesson.assessment?.graded!==false && lesson.timing && (stepPractice || (beat && activeBpm < lesson.timing.goalBpm)))
      setMessage(stepPractice ? `Step practice complete. Play at ${lesson.timing.goalBpm} BPM to complete this lesson.` : `Practice scored. Reach ${lesson.timing.goalBpm} BPM to complete this lesson.`);
    if (continuous && !course) {
      const next = finished instanceof BeatScaleRun
        ? new BeatScaleRun(notes, finished.startAt + (notes.length + 4) * finished.periodMs, bpm, labelNote)
        : new MajorScaleRun(notes, labelNote);
      // Preserve sounding keys across runs; only a fresh press counts again.
      finished.held.forEach((note, index) => next.held.set(index, note));
      run.current = next;
    } else {
      metronome.current?.stop();
      metronome.current = null;
      setStage("complete");
    }
  }

  useEffect(() => {
    if (stage !== "practice") return;
    const timer = setInterval(() => {
      const time = performance.now();
      if (run.current instanceof BeatScaleRun) {
        run.current.tick(time);
        if (run.current.complete) finishRun();
      }
      setNow(time);
    }, 25);
    return () => clearInterval(timer);
  }, [stage, continuous, notes, activeBpm, hints, progress]);

  function handleKey(index: number, pressed: boolean, receivedAt = performance.now()) {
    if(lesson.kind==="content")return;
    if (stage === "demo" || stage === "starting" || stage === "waiting") return;
    const note = keys[index]?.note;
    if (note === null || note === undefined) return;
    if(stage !== "practice") {
      if(!audio.current)return;
      if(pressed){const sounding=[...run.current.held.values()].includes(note);run.current.held.set(index,note);if(!sounding)void audio.current.noteOn(note).catch(()=>stop("Browser audio stopped."));}
      else {run.current.held.delete(index);if(![...run.current.held.values()].includes(note))audio.current.noteOff(note);}
      redraw(value=>value+1);return;
    }
    if (pressed) {
      const alreadySounding = [...run.current.held.values()].includes(note);
      const attacked = run.current.press(index, note, receivedAt);
      if (attacked && !alreadySounding) {
        void audio.current?.noteOn(note).catch(() => stop("Browser audio stopped. Start the lesson again."));
      }
      if (attacked && run.current instanceof MajorScaleRun && run.current.complete) finishRun();
    } else {
      const released = run.current instanceof CourseRun || run.current instanceof BeatScaleRun ? run.current.release(index, receivedAt) : run.current.release(index);
      if (released !== undefined && ![...run.current.held.values()].includes(released)) audio.current?.noteOff(released);
    }
    if (!pressed && run.current instanceof CourseRun && run.current.complete) finishRun();
    redraw((value) => value + 1);
  }
  handleKeyRef.current = handleKey;

  function tap(index: number) {
    if (course && lesson.targets.some(target => target.length > 1)) {
      handleKey(index, !run.current.held.has(index));
      return;
    }
    handleKey(index, true);
    const timer = setTimeout(() => {
      timers.current = timers.current.filter((entry) => entry !== timer);
      handleKeyRef.current(index, false);
    }, 120);
    timers.current.push(timer);
  }

  async function repeat(showHints: boolean) {
    if(showHints!==hints){streak.current=0;streakHints.current=false;setStreakCount(0);}
    clearRun();setMessage("");setHints(showHints);
    if(onBoard && physicalKeys.current.size){setStage("waiting");setPendingStart(true);setMessage("Release all keys before the next lesson.");return;}
    const currentRun=runGeneration.current;
    setHints(showHints);
    setDemoNote(undefined);
    setStage("starting");
    const currentGeneration = generation.current;
    try {
      await prepareRun(showHints);
      if (generation.current === currentGeneration && currentRun===runGeneration.current) {if(onBoard&&physicalKeys.current.size){clearRun();setStage("waiting");setPendingStart(true);}else setStage("practice");}
    } catch { if (generation.current === currentGeneration && currentRun===runGeneration.current) stop("Could not start practice audio. Try again."); }
  }

  useEffect(()=>{if(pendingStart&&physicalCount===0&&stage==="waiting"&&readyToPlay){setPendingStart(false);session.current?.setDisplayRotation(selection.layout.deviceRotationSteps);void repeat(hints);}},[pendingStart,physicalCount,lesson.id,stage,selection.layout.objectIdHex,readyToPlay]);

  function demonstrate() {
    usedHints.current = true;
    clearTimers();
    audio.current?.allNotesOff();
    run.current = course ? new CourseRun(lesson, selection.layout.objectIdHex, labelNote) : new MajorScaleRun(notes, labelNote);
    metronome.current?.stop(); metronome.current = null;
    setDemoStep(0);
    setStage("demo");
    setMessage("");
    const demoBpm = stepPractice ? lesson.timing!.goalBpm : activeBpm;
    const durations = targets.map((_, index) => course && lesson.timing ? lesson.timing.beats[index] * 60000 / demoBpm : 650);
    const demoVoices=new Map<number,number>();
    let offset = 0;
    targets.forEach((chord, index) => {
      const at = offset; offset += durations[index];
      timers.current.push(setTimeout(() => {
        setDemoStep(index);
        setDemoNote(chord);
        chord.forEach(note => { demoVoices.set(note,index); void audio.current?.noteOn(note).catch(() => stop("Browser audio stopped. Start again when ready.")); });
      }, at));
      chord.forEach((note,voice)=>{const hold=course&&lesson.timing?(lesson.timing.holdBeats?.[index]?.[voice]??lesson.timing.beats[index])*60000/demoBpm:durations[index]*0.8;timers.current.push(setTimeout(()=>{if(demoVoices.get(note)===index)audio.current?.noteOff(note);},at+hold));});
    });
    const demoGeneration = generation.current;
    const demoRunGeneration = runGeneration.current;
    timers.current.push(setTimeout(() => {
      setDemoNote(undefined);
      setStage("starting");
      void prepareRun(hints).then(() => { if (generation.current === demoGeneration && runGeneration.current === demoRunGeneration) { usedHints.current = true; setStage("practice"); setMessage(""); } }).catch(() => { if (generation.current === demoGeneration && runGeneration.current === demoRunGeneration) stop("Could not restart practice."); });
    }, Math.max(offset,...targets.flatMap((chord,index)=>chord.map((_,voice)=>durations.slice(0,index).reduce((a,b)=>a+b,0)+(course&&lesson.timing?(lesson.timing.holdBeats?.[index]?.[voice]??lesson.timing.beats[index])*60000/demoBpm:durations[index]))))));
  }

  async function importLayout(event: ChangeEvent<HTMLInputElement>) {
    const importGeneration = generation.current;
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const imported = lessonLayouts(parseTuningBundleFile(JSON.parse(await file.text())));
      if (generation.current !== importGeneration) return;
      setLayouts((current) => [...current.filter((item) => !imported.some((entry) => entry.id === item.id)), ...imported]);
      chooseLocalTuning(imported[0].bundle, imported[0].id);
      setMessage("Imported layouts for this visit. The lesson checks that each scale note is available.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not import that tuning bundle.");
    }
  }

  const targetNotes = stage === "demo" ? demoNote ?? [] : targets[run.current.step] ?? [];
  const cues = course ? lessonCues(lesson, selection.layout.objectIdHex, stage === "demo" ? demoStep : stage === "ready" ? 0 : run.current.step) : [];
  const lightCues=course&&(stage==="ready"||stage==="waiting") ? lesson.fingerings?.find(item=>item.layoutId===selection.layout.objectIdHex)?.steps.flat()??[] : cues;
  const lights = keys.map((key) => courseKeyLight(key, lightCues, keyLight(key, key.note !== null && ((stage === "ready" || stage === "waiting") ? previewNotes : targetNotes).includes(key.note) ? key.note : undefined, run.current.held, stage === "ready" || stage === "waiting" || stage === "demo" || (hints && stage === "practice"), course && hints && stage === "practice")));
  const showHands=course && hints && (stage==="ready" || stage==="practice" || stage==="demo") && lesson.fingerings?.some(f=>f.layoutId===selection.layout.objectIdHex&&f.steps.some(step=>step.some(cue=>cue.hand&&cue.finger)));
  const fingerColor=(note:number)=>{const key=keys.find(key=>key.note===note);return lessonScreenColor(lessonLedColor(note,"target",{bundle:{...bundle,activeLayoutIdHex:selection.layout.objectIdHex},steps:key?.steps??0,root,mode:colorMode,index:key?.key.index??0,contrast}));};
  const timingRun=hints&&stage==="practice"&&run.current instanceof BeatScaleRun?run.current:undefined;
  const timingSteps=timingRun?upcomingTimingSteps(timingRun.offsets,timingRun.startAt,timingRun.periodMs,now,timingRun.step):[];
  const targetLabel = targetNotes.map(labelNote).join(" + ") || (run.current.step < targets.length ? "Rest" : "");
  const revealedStep = stage === "ready" || stage === "waiting" ? targets.findIndex(target => target.length > 0) : run.current.step;
  const lightStates = lights.join();
  const ledColors = useMemo(() => keys.map(({ note, steps }, index) => lessonLedColor(note, lights[index], {
    bundle: { ...bundle, layouts: [selection.layout], activeLayoutIdHex: selection.layout.objectIdHex },
    steps: steps ?? 0, root, mode: colorMode, index, contrast
  })), [keys, lightStates, bundle, selection.layout, root, colorMode, contrast]);
  const boardColors = ledColors;
  const lightSignature = JSON.stringify(boardColors);
  useEffect(() => { session.current?.setLights(boardColors); }, [lightSignature, stage]);
  const countingIn = stage === "practice" && run.current instanceof BeatScaleRun && run.current.countIn;
  const elapsed = stage === "practice" && run.current instanceof MajorScaleRun && run.current.startedAt !== undefined
    ? Math.max(0, (run.current.finishedAt ?? now) - run.current.startedAt) : undefined;
  function progressClass(index: number) {
    if (!engaged) return "";
    if (run.current instanceof BeatScaleRun) {
      if (run.current.errors[index] !== undefined) return "done";
      if (index < run.current.step) return "missed";
    } else if (index < run.current.step) return "done";
    return index === run.current.step && stage === "practice" ? "current" : "";
  }
  const angle = selection.layout.deviceRotationSteps * 90;
  const sideways = selection.layout.deviceRotationSteps % 2 !== 0;
  const width = sideways ? 620 : 550, height = sideways ? 550 : 620;

  function navigate(next: typeof page) {
    clearRun();setStage("ready");
    setPage(next);
    if (next === "course") setRoot(0);
    setMessage("");
    if (next === "course" && !selectedCourse && !isLessonTuning(bundle)) chooseLocalTuning(localBundles[0], layouts.find(item => item.bundle === localBundles[0])!.id);
  }
  function changeLesson(index:number){if(selectedCourse)setIntroductionSeen(selectedCourse.id);setHints(true);clearRun();setPracticeBpm(lessons[index].timing?.goalBpm??80);setLessonIndex(index);setMessage("");if(session.current){setStage("waiting");setPendingStart(true);}else setStage("ready");}
  function changeLayout(id:string){
    const restart=stage==="practice"||stage==="demo"||stage==="waiting";
    clearRun();setLayoutId(id);setMessage("");streak.current=0;streakHints.current=false;setStreakCount(0);
    if(restart){setStage("waiting");setPendingStart(true);}else setStage("ready");
  }
  function nextLesson() { changeLesson(Math.min(lessons.length-1,lessonIndex+1)); }
  function saveProgressFile() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(progress, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "hexboard-learning-progress.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function restoreProgress(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    try {
      const restored = parseCourseProgress(await file.text());
      if (!Object.keys(restored).length) throw new Error("No valid lesson progress in this file.");
      const merged = mergeCourseProgress(progress, restored);
      localStorage.setItem(courseProgressKey, JSON.stringify(merged)); setProgress(merged); setProgressMessage("Progress restored.");
    } catch (error) { setProgressMessage(error instanceof Error ? error.message : "Could not restore progress."); }
  }

  function courseBundleSnapshot(): TuningBundle {
    const starter=starterLayouts()[0], scale=starter.bundle.scales[0];return {...structuredClone(starter.bundle),layouts:[structuredClone(starter.layout)],scales:[structuredClone(scale)],activeScaleIdHex:scale.objectIdHex,activeLayoutIdHex:starter.layout.objectIdHex};
  }
  function chooseCourse(id: string) { setIntroductionSeen(undefined); setDeletePending(false);clearRun();setStage("ready");setCourseId(id); setLessonIndex(0); setCourseMessage(""); }
  async function persistCourse(next: UserCourse, clearDraft=false) {
    if(clearDraft)next={...next,revision:Math.max(next.revision,(userCourses.find(item=>item.id===next.id)?.revision??0)+1)};
    if (new TextEncoder().encode(JSON.stringify(next)).length > maxCourseBytes) throw new Error("Course files must be smaller than 2 MB. Split this course into smaller courses.");
    const updated = [...userCourses.filter(course => course.id !== next.id), next];
    if (updated.length > 50) throw new Error("This browser can hold up to 50 courses.");
    await courseStorage.save(next);
    if(clearDraft)await courseStorage.removeDraft(next.id);
    await refreshDrafts();
    setUserCourses(updated); chooseCourse(next.id); setEditingCourse(undefined);
  }
  async function importCourse(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    try {
      if (file.size > maxCourseBytes) throw new Error("Course files must be smaller than 2 MB.");
      const next = readCourseFile(await file.text());
      const existing = userCourses.find(course => course.id === next.id);
      if (existing) {setPendingImport(next);return;}
      await persistCourse(next); setCourseMessage("Course imported.");
    } catch (error) { setCourseMessage(error instanceof Error ? error.message : "Could not import course."); }
  }
  function exportCourse() {
    const doc: UserCourse = selectedCourse ?? { format: courseFormat, id: "hexboard-beginner", revision: 1, title: "HexBoard beginner course", author: "HexBoard", bundle: { ...starterLayouts()[0].bundle, layouts: starterLayouts().map(item => item.layout) }, lessons: [...beginnerLessons] };
    const url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `${doc.title.replace(/[^a-z0-9_-]+/gi, "-")}.hexcourse.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function openCourseEditor(copy: boolean) {
    const snapshot = copy ? structuredClone(selectedCourse?.bundle ?? {...starterLayouts()[0].bundle,layouts:starterLayouts().map(item=>item.layout)}) : courseBundleSnapshot();

    setEditingCourse(copy ? {
      format: courseFormat, id: crypto.randomUUID(), revision: 1, title: `${selectedCourse?.title ?? "Beginner course"} copy`, author: "", bundle: snapshot, layoutId: selectedCourse?.layoutId,
      description:selectedCourse?.description, lessons: structuredClone([...lessons])
    } : { format: courseFormat, id: crypto.randomUUID(), revision: 1, title: "My course", author: "", bundle: snapshot,
      lessons: [{ id: crypto.randomUUID(), title: "First phrase", section: "My lessons", instruction: "Play the phrase, then try it without hints.", targets: [[]], timing: {goalBpm:80,beats:[1]}, timeSignature: {numerator:4,denominator:4} }] });
  }
  async function editSavedCourse(saved: UserCourse) {
    try {
      const currentDrafts = await courseStorage.drafts();
      setDrafts(currentDrafts);
      const draft = currentDrafts.find(item => item.id === saved.id);
      if (draft) setPendingEdit({ saved, draft });
      else setEditingCourse({ ...structuredClone(saved), revision: saved.revision + 1 });
    } catch { setCourseMessage("Could not check recovery drafts. Try opening the course again."); }
  }
  async function discardDraftAndEditSaved() {
    if (!pendingEdit) return;
    try {
      await courseStorage.removeDraft(pendingEdit.saved.id);
      setDrafts(items => items.filter(item => item.id !== pendingEdit.saved.id));
      setEditingCourse({ ...structuredClone(pendingEdit.saved), revision: pendingEdit.saved.revision + 1 });
      setPendingEdit(undefined);
    } catch { setCourseMessage("Could not discard the recovery draft. It remains available."); }
  }
  if (editingCourse) return <CourseEditor initial={editingCourse} bundles={localBundles.map(item => ({ ...item, layouts: layouts.filter(layout => layout.bundle.objectIdHex === item.objectIdHex).map(layout => layout.layout) }))} transport={transport} connected={connected}
    renderPreview={(course,index,close)=><Learn transport={transport} connected={connected} deviceHello={deviceHello} previewCourse={course} previewIndex={index} onExitPreview={close}/>}
    onSave={next=>persistCourse(next,true)} onClose={() => {setEditingCourse(undefined);void refreshDrafts();}} />;

  return <section className="learnPage">
    {pendingEdit && <div className="modalOverlay"><section className="modalPanel" role="dialog" aria-modal="true" aria-labelledby="course-draft-title" onKeyDown={event=>{if(event.key==="Escape")setPendingEdit(undefined);}}>
      <h3 id="course-draft-title">Resume your draft?</h3>
      <p>“{pendingEdit.saved.title}” has edits saved in this browser from {new Date(pendingEdit.draft.updatedAt).toLocaleString()}.</p>
      <div className="learnActions"><button autoFocus className="primary" type="button" onClick={() => { setEditingCourse(pendingEdit.draft.course); setPendingEdit(undefined); }}>Resume draft</button><button type="button" onClick={() => void discardDraftAndEditSaved()}>Discard draft and edit saved course</button><button type="button" onClick={() => setPendingEdit(undefined)}>Cancel</button></div>
    </section></div>}
    <header className="learnIntro">
      <h2>{previewCourse?"Learner preview":"Learn"}</h2>{previewCourse&&<button type="button" onClick={()=>{dispose();onExitPreview?.();}}>Back to editor</button>}{page === "progress" && session.current && <button type="button" onClick={()=>stop()}>Stop HexBoard session</button>}
      <nav className="learnTabs" aria-label="Learning sections">{(["practice", "course", "progress"] as const).map(item => <button key={item} type="button" aria-current={page === item ? "page" : undefined} disabled={stage === "starting" || libraryBusy} onClick={() => navigate(item)}>{item === "course" ? "Courses" : item === "practice" ? "Scale practice" : "Progress"}</button>)}</nav>
    </header>
    {page === "progress" ? <div className="learnCard">
      <label className="learnField">Course<select value={previewCourse?"preview":courseId} disabled={!!previewCourse} onChange={event => chooseCourse(event.target.value)}>{previewCourse&&<option value="preview">{previewCourse.title}</option>}<option value="builtin">Beginner course</option><option value="builtin-intermediate">Intermediate course · Rhythm</option>{userCourses.map(course => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label>
      <div className="learnPracticeHeader"><h3>Your course progress</h3><button type="button" onClick={saveProgressFile}>Export progress</button></div>
      <p className="learnMuted">Saved in this browser, per layout. Independent = no mistakes, no hints.</p>
      <div className="learnProgressList">{lessons.map((item, index) => {
        if(item.kind==="content"||item.assessment?.graded===false)return null;
        const compatibleLayouts=selectedCourse?.bundle.layouts.map(layout=>courseLayoutProgressId(selectedCourse.bundle,layout));
        const entries = Object.entries(progress[courseProgressId(selectedCourse, item.id)] ?? {}).filter(([layout])=>!compatibleLayouts||compatibleLayouts.includes(layout)).map(([,value])=>value);
        return <button type="button" key={item.id} onClick={() => { setLessonIndex(index); navigate("course"); }}><span>{index + 1}. {item.title}</span><span>{entries.some(entry => entry.independent) ? "★ Independent" : entries.length ? "✓ Completed" : "Start"}{entries.length > 0 && ` · ${entries.length} layout${entries.length === 1 ? "" : "s"}`}{entries.some(entry=>entry.bestPassingScore!==undefined)&&` · best ${Math.max(...entries.map(entry=>entry.bestPassingScore??0))}/100 · ${Math.max(...entries.map(entry=>entry.highestPassedBpm??0))} BPM`}</span></button>;
      })}</div>
      <details><summary>Restore progress</summary><input aria-label="Import course progress" type="file" accept=".json" onChange={event => void restoreProgress(event)} /></details>
      {progressMessage && <p role="status">{progressMessage}</p>}
    </div> : <div className="learnWorkspace">
      <aside className="learnCard learnGuide">
        {course && <><label className="learnField">Course<select value={previewCourse?"preview":courseId} disabled={!!previewCourse || stage === "starting" || libraryBusy} onChange={event => chooseCourse(event.target.value)}>{previewCourse&&<option value="preview">{previewCourse.title}</option>}<option value="builtin">Beginner course</option><option value="builtin-intermediate">Intermediate course · Rhythm</option>{userCourses.map(course => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label>
          <label className="learnField">Lesson<select value={lessonIndex} disabled={stage === "starting"} onChange={event => changeLesson(Number(event.target.value))}>{lessons.map((item, index) => <option key={item.id} value={index}>{index + 1}. {item.title}</option>)}</select></label>

          {lesson.timing && <><span className="learnMuted">{lesson.timeSignature?.numerator??4}/{lesson.timeSignature?.denominator??4} · Goal: {lesson.timing.goalBpm} BPM</span><label className="learnField">Practice tempo · {stepPractice ? "Step" : `${practiceBpm} BPM`}<input aria-label="Practice tempo" type="range" min={stepTempo} max={300} step={1} value={practiceBpm} disabled={engaged&&stage!=="complete"} onChange={event=>setPracticeBpm(Number(event.target.value))}/></label>{stepPractice && <span className="learnMuted">No metronome. Play the highlighted notes to reveal the next step; rests are skipped.</span>}</>}
          {courseMessage && <p role="status" className="learnMuted">{courseMessage}</p>}</>}
        {customCourse ? <><span className="learnMuted">Tuning · {customCourse.bundle.tuning.name}</span>
          <label className="learnField">Layout<select value={selection.layout.objectIdHex} disabled={stage==="starting" || !!requiredLayout} onChange={event => changeLayout(event.target.value)}>{courseLayouts.map(item => item.layout).filter(layout => !requiredLayout || layout.objectIdHex === requiredLayout).map(layout => <option key={layout.objectIdHex} value={layout.objectIdHex}>{layout.name}</option>)}</select></label></> : <>
        {!course && <label className="learnField">Tuning<select value={tuningChoice} disabled={engaged || libraryBusy} onChange={event => void chooseTuning(event.target.value)}>
          <optgroup label="Starter / imported">{localBundles.map(item => <option key={item.objectIdHex} value={item.objectIdHex}>{item.tuning.name}</option>)}</optgroup>
          <optgroup label="On HexBoard">{tuningNames.map(item => <option key={item.handle} value={`device:${item.handle}`}>{item.name}{item.folderPath !== "/" ? ` · ${item.folderPath}` : ""}</option>)}</optgroup>
        </select></label>}
        <label className="learnField">Layout<select value={fromDevice ? deviceLayoutChoice : selection.id} disabled={(engaged&&!course) || stage==="starting" || libraryBusy} onChange={event => { if (fromDevice) void chooseDeviceLayout(event.target.value); else changeLayout(event.target.value); }}>
          {fromDevice ? <><option value="">Choose a layout</option>{layoutNames.map(item => <option key={item.handle} value={item.handle}>{item.name}</option>)}</>
            : layouts.filter(item => course ? isLessonTuning(item.bundle) : item.bundle.objectIdHex === tuningChoice).map(item => <option key={item.id} value={item.id}>{item.layout.name}</option>)}
        </select></label>
        </>}
        {!course && <><label className="learnField">Scale<select value={scaleChoice} disabled={engaged || libraryBusy} onChange={event => { if (fromDevice) void chooseDeviceScale(event.target.value); else setScaleChoice(event.target.value); }}>
          {fromDevice ? <><option value="">Choose a scale</option>{scaleNames.map(item => <option key={item.handle} value={item.handle}>{item.name}</option>)}</>
            : bundle.scales.map(item => <option key={item.objectIdHex} value={item.objectIdHex}>{item.name}</option>)}
        </select></label>
        <div className="learnFieldPair">
          <label className="learnField">Root<select value={root} disabled={engaged || libraryBusy} onChange={event => setRoot(Number(event.target.value))}>{bundle.tuning.keyLabels.map((label, degree) => <option key={degree} value={degree}>{label}</option>)}</select></label>
          <label className="learnField">Register<input aria-label="Register" type="number" min="-8" max="8" value={register} disabled={engaged || libraryBusy} onChange={event => setRegister(Math.max(-8, Math.min(8, Math.round(Number(event.target.value)))))} /></label>
        </div>
        <label className="learnField">Pattern<select value={pattern} disabled={engaged} onChange={event => setPattern(event.target.value as ScalePattern)}>{Object.entries(scalePatterns).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label className="learnField">Practice mode<select value={beatMode ? "beat" : "free"} disabled={engaged} onChange={event => setBeatMode(event.target.value === "beat")}><option value="free">Free timing</option><option value="beat">Metronome</option></select></label>
        {beatMode && <label className="learnField">Tempo · {bpm} BPM<input aria-label="Tempo" type="range" min="40" max="180" step="5" value={bpm} disabled={engaged} onChange={event => setBpm(Number(event.target.value))} /></label>}
        <label className="checkField"><input type="checkbox" checked={continuous} disabled={engaged} onChange={event => setContinuous(event.target.checked)} />Repeat runs</label></>}
        <details className="learnSettings"><summary>Colors &amp; contrast</summary>
          <label className="learnField">Color mode<select value={colorMode} onChange={event => setColorMode(Number(event.target.value) as ColorModeValue)}>{Object.entries(ColorMode).map(([name, value]) => <option key={value} value={value}>{name === "AltPiano" ? "Alt Piano" : name}</option>)}</select></label>
          <label className="learnField">Contrast · {contrast}%<input aria-label="Contrast" type="range" min="25" max="85" value={contrast} onChange={event => setContrast(Number(event.target.value))} /></label>
        </details>
        <details className="learnSettings"><summary>Library &amp; help</summary>
          <button type="button" disabled={!connected || engaged || libraryBusy} onClick={() => void refreshDeviceNames(true)}>Refresh tuning names</button>
          <label className="learnField">Import tuning bundle<input aria-label="Import lesson tuning bundle" type="file" accept=".json" disabled={engaged || libraryBusy} onChange={event => void importLayout(event)} /></label>
          <p className="learnMuted">Sound plays in your browser. Hold the board encoder for 5 seconds to exit. Leaving this tab pauses practice.</p>
          <p className="learnMuted">Register shifts by tuning periods. Absolute brightness uses the board’s saved hardware setting. Contrast dims background keys.</p>
          <p className="learnMuted">Fingering cues: L = left, R = right. Finger 1 is the thumb; 5 is the little finger. Hand and finger choices are guidance.</p>
          <p className="learnMuted">Metronome: four count-in clicks, then one note per click. Grades include timing, missed notes, and extra attempts. Use wired audio for accurate timing.</p>
        </details>
        {course && !previewCourse && <details className="learnSettings"><summary>Manage courses</summary>{session.current&&<p className="learnMuted">Stop the learning session to edit or record a course.</p>}<div className="learnActions">
          <button type="button" disabled={engaged || !!session.current || libraryBusy || !storageReady} onClick={() => openCourseEditor(false)}>Create course</button>
          <button type="button" disabled={engaged || !!session.current || libraryBusy || !storageReady} onClick={() => openCourseEditor(true)}>Make a copy</button>
          {editableCourse && <button type="button" disabled={engaged || !!session.current || libraryBusy || !storageReady} onClick={() => void editSavedCourse(selectedCourse)}>Edit course</button>}
          <button type="button" disabled={engaged} onClick={exportCourse}>Export course</button></div>
          <label className="learnField">Import shared course<input aria-label="Import shared course" type="file" accept=".json" disabled={engaged || libraryBusy || !storageReady} onChange={event => void importCourse(event)} /></label>
          {editableCourse&&<button type="button" disabled={engaged} onClick={()=>setDeletePending(true)}>Delete course</button>}
          {deletePending&&selectedCourse&&<div role="alert"><p>Delete “{selectedCourse.title}”? Export it first if you need a copy. Recovery drafts remain available.</p><button onClick={()=>void courseStorage.remove(selectedCourse.id).then(()=>{setUserCourses(items=>items.filter(item=>item.id!==selectedCourse.id));chooseCourse("builtin");setDeletePending(false);},()=>setCourseMessage("Could not delete course."))}>Confirm delete</button><button onClick={()=>setDeletePending(false)}>Cancel</button></div>}
          {drafts.some(item=>!userCourses.some(saved=>saved.id===item.id))&&<div className="learnDraftList" aria-label="Unsaved courses">{drafts.filter(item=>!userCourses.some(saved=>saved.id===item.id)).map(item=><button key={item.id} disabled={engaged||!!session.current} onClick={()=>setEditingCourse(item.course)}>Resume unsaved course: {item.course.title}</button>)}</div>}
          {pendingImport&&<div role="alert"><p>“{pendingImport.title}” revision {pendingImport.revision} matches local revision {userCourses.find(item=>item.id===pendingImport.id)?.revision}. Compatible lesson progress will be preserved.</p><button onClick={()=>void persistCourse(pendingImport).then(()=>{setPendingImport(undefined);setCourseMessage("Course updated.");},error=>setCourseMessage(String(error)))}>Update existing</button><button onClick={()=>void persistCourse({...pendingImport,id:crypto.randomUUID()}).then(()=>{setPendingImport(undefined);setCourseMessage("Separate copy imported.");},error=>setCourseMessage(String(error)))}>Keep both</button><button onClick={()=>setPendingImport(undefined)}>Cancel import</button></div>}
        </details>}
        {libraryMessage && <p role="status" className="learnMuted">{libraryMessage}</p>}
        {(!fromDevice || deviceLayoutChoice) && missing.length > 0 && <p className="learnWarning" role="alert">Missing {missing.join(", ")}. Try another layout or register.</p>}
      </aside>
      {showIntroduction?<article className="learnCard"><h2>{selectedCourse!.title}</h2><CourseMarkdown source={selectedCourse!.description!}/><button type="button" className="courseStartButton" onClick={()=>{setIntroductionSeen(selectedCourse!.id);changeLesson(0);}}>Start Course</button></article>:course&&lesson.kind==="content"?<article className="learnCard"><h2>{lesson.title}</h2><CourseMarkdown source={lesson.markdown??""}/>{lessonIndex<lessons.length-1&&<button type="button" onClick={nextLesson}>Continue</button>}</article>:<div className="learnCard learnPractice">
        {course && lesson.instruction.trim() && <section className="learnLessonInstruction" aria-label="Lesson notes"><h3>Lesson notes</h3><p>{lesson.instruction}</p></section>}
        {!compatible&&<p role="alert">This layout needs changes: {selectedCourse&&compatibilityReport(selectedCourse).filter(row=>row.lessonId===lesson.id&&row.layoutId===selection.layout.objectIdHex).flatMap(row=>row.issues).join("; ")}</p>}
        <div className="learnActions learnTransport">{!engaged ? <>
          <button className="primary" type="button" disabled={!connected || !readyToPlay} onClick={() => void begin(true)}>{session.current?"Start lesson":"Start on HexBoard"}</button>
          <button type="button" disabled={!readyToPlay || !!session.current} onClick={() => void begin(false)}>Try on screen</button>{stage!=="free"&&<button type="button" disabled={libraryBusy||(fromDevice&&!deviceLayoutChoice)} onClick={()=>void begin(connected,true)}>Play synth</button>}{audio.current&&<button type="button" onClick={()=>stop()}>Stop</button>}
        </> : <>
          <button type="button" onClick={() => stop()}>Stop</button>
          <button type="button" disabled={stage === "starting" || stage === "waiting" || stage === "demo" || physicalCount > 0 || run.current.held.size > 0} onClick={demonstrate}>Hear example</button>
        </>}
        <label className="checkField"><input type="checkbox" checked={hints} disabled={stage === "demo"} onChange={event => { setHints(event.target.checked); if (event.target.checked && engaged) usedHints.current = true; }} />Hints</label></div>
        <div className="learnPracticeHeader"><h3>{stage === "free" ? "Play freely" : stage === "waiting" ? "Release all keys" : stage === "complete" ? "Finished" : stage === "demo" ? `Listen: ${targetLabel}` : countingIn ? "Four clicks, then play" : stage === "practice" ? (hints ? `Next: ${targetLabel || "finished"}` : "Play from memory") : stage === "starting" ? "Starting…" : course ? lesson.title : selectedScale?.name ?? "Choose a scale"}</h3><span>{engaged ? run.current.step : 0}/{notes.length}</span></div>
        {stage !== "free" && (stage === "ready" || stage === "waiting" || stage === "demo" || hints) && <ol className="learnScaleSteps" aria-label="Exercise notes">{targets.map((chord, index) => (!stepPractice || (chord.length > 0 && (stage === "demo" || stage === "complete" || index <= revealedStep))) && <li key={index} className={progressClass(index)} aria-current={index === run.current.step && stage === "practice" ? "step" : undefined}><span>{chord.map(labelNote).join(" + ") || "Rest"}{course && lesson.timing && !stepPractice && ` · ${lesson.timing.beats[index]}b`}</span></li>)}</ol>}
        {hints && stage === "practice" && cues.some(cue => cue.hand || cue.finger || (cue.button !== undefined && cue.acceptDuplicates === false)) && <div className="learnFingering" aria-label="Hand and finger cues">{cues.map(cue => <span key={cue.note}>{labelNote(cue.note)} {cueLabel(cue)}{cue.button !== undefined && cue.acceptDuplicates === false ? ` · key ${cue.button} required` : ""}</span>)}</div>}
        {course&&(lesson.repetitions??1)>1&&lesson.assessment?.graded!==false&&<p>Clean runs: {streakCount}/{lesson.repetitions}</p>}
        <div className="learnRunStats">
          {stage === "practice" && run.current instanceof BeatScaleRun && <div className="learnBeatClock"><span aria-hidden="true" className={(now - run.current.startAt + 4 * run.current.periodMs) % run.current.periodMs < 120 ? "pulse" : ""}>●</span>{countingIn ? `Count-in ${Math.max(1, Math.min(4, 5 - Math.ceil((run.current.startAt - now) / run.current.periodMs)))}/4` : `${activeBpm} BPM`}</div>}
          {elapsed !== undefined && <span>{(elapsed / 1000).toFixed(2)} s</span>}
          {lastRun && lesson.assessment?.graded!==false && <span role="status">Last: {lastRun.elapsedMs === undefined ? "incomplete" : `${(lastRun.elapsedMs / 1000).toFixed(2)} s`}{lastRun.beat ? ` · ${lastRun.beat.score}/100 · ${lastRun.beat.grade} · ${lastRun.beat.missed} missed · ${lastRun.beat.extras} extra` : ` · ${lastRun.mistakes} mistakes`}</span>}
        </div>
        {(!fromDevice || deviceLayoutChoice) && <div className={showHands?"learnBoardAndHands":""}><div className="learnBoardWrap"><svg className="learnBoard" viewBox={`0 0 ${width} ${height}`} aria-label={`${selection.layout.name} key map`}>
          <g transform={`translate(${width / 2} ${height / 2}) rotate(${angle}) translate(-275 -310)`}>
            {keys.filter(({ key }) => key.role !== "command").map(({ key, note }) => {
              const playable = !onBoard && note !== null && (stage === "practice" || stage === "free" || stage === "complete" || (stage === "ready" && !!audio.current));
              const color = lessonScreenColor(ledColors[key.index]);
              const fingering = hints && stage === "practice" ? cues.find(cue => cue.note === note && (cue.button === undefined || cue.button === key.index)) : undefined;
              return <g key={key.index} transform={`translate(${32 + key.coordCol * 25} ${35 + key.row * 42})`} className={`learnKey ${lights[key.index]}`}
                role={playable ? "button" : undefined} tabIndex={playable ? 0 : undefined} aria-label={note === null ? `Key ${key.index}, unavailable` : `${labelNote(note)}, key ${key.index}`}
                onClick={() => { if (playable) tap(key.index); }} onKeyDown={(event) => { if (playable && !event.repeat && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); tap(key.index); } }}>
                <polygon style={note === null ? undefined : { fill: color.fill }} points="0,-25 22,-12.5 22,12.5 0,25 -22,12.5 -22,-12.5" />

                <text style={note === null ? undefined : { fill: color.text }} transform={`rotate(${-angle})`} textAnchor="middle" dy="4">{note === null ? "·" : fingering && cueLabel(fingering) ? `${labelNote(note)} ${cueLabel(fingering)}` : labelNote(note)}</text>
              </g>;
            })}
            {timingRun&&timingSteps.flatMap(({step,dueAt})=>{
              const upcomingCues=course?lessonCues(lesson,selection.layout.objectIdHex,step):[];
              return keys.filter(({key,note})=>key.role!=="command"&&note!==null&&targets[step]?.includes(note)&&courseKeyLight({key,note},upcomingCues,"target")==="target").map(({key})=><g key={`${step}:${key.index}`} pointerEvents="none" transform={`translate(${32+key.coordCol*25} ${35+key.row*42})`}><TimingCue dueAt={dueAt} periodMs={timingRun.periodMs}/></g>);
            })}
          </g>
        </svg></div>{showHands&&<aside className="learnRecommendedHands" aria-label="Recommended fingers"><h3>Recommended fingers</h3><FingerHands cues={cues} color={fingerColor}/></aside>}</div>}
        <div className="learnLegend">{stage === "free" ? "Play freely · no scoring" : stage === "ready" ? "Bright keys: exercise notes" : "Bright: current target · dashed: held target"}{cues.some(cue => cue.button !== undefined) && " · Background duplicates still count when allowed"}{course && lesson.targets.some(target => target.length > 1) && !onBoard && stage === "practice" && " · Click a key to hold or release"}</div>
        {(message || stage === "practice" || stage === "demo") && <div className="learnFeedback" role="status" aria-live="polite">{message || (stage === "practice" ? hints ? run.current.feedback : "Follow the exercise from memory." : "Listen and watch.")}</div>}
        {progressMessage && course && <p role="status" className="learnMuted">{progressMessage}</p>}
        {stage === "complete" && <div className="learnCompletion"><div className="learnActions">{lesson.assessment?.trackIndependence!==false&&<button type="button" onClick={() => void repeat(false)}>Try without hints</button>}<button type="button" onClick={() => void repeat(true)}>Repeat</button>{course && lessonIndex < lessons.length - 1 && <button className="primary" type="button" onClick={nextLesson}>Next lesson</button>}</div></div>}
      </div>}
    </div>}
  </section>;
}
