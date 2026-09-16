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

import { beginnerLessons, CourseRun, courseProgressKey, parseCourseProgress, recordCourseRun, mergeCourseProgress, type CourseProgress } from "../learn/beginnerCourse.ts";

type Stage = "ready" | "starting" | "practice" | "demo" | "complete";

export function Learn({ transport, connected, deviceHello }: { transport: MidiTransport; connected: boolean; deviceHello?: HelloResponsePayload | null }) {
  const [page, setPage] = useState<"practice" | "course" | "progress">("practice");
  const [lessonIndex, setLessonIndex] = useState(0);
  const lesson = beginnerLessons[lessonIndex];
  const course = page === "course";
  const [progress, setProgress] = useState<CourseProgress>(() => {
    try { return parseCourseProgress(localStorage.getItem(courseProgressKey)); } catch { return {}; }
  });
  const [progressMessage, setProgressMessage] = useState("");
  const [layouts, setLayouts] = useState<LessonLayout[]>(starterLayouts);
  const [layoutId, setLayoutId] = useState(() => layouts[0].id);
  const selection = layouts.find((layout) => layout.id === layoutId) ?? layouts[0];
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
  const fromDevice = tuningChoice.startsWith("device:");
  const bundle = fromDevice && deviceTuning ? deviceTuning : selection.bundle;
  const selectedScale = fromDevice ? loadedScale : bundle.scales.find(scale => scale.objectIdHex === scaleChoice) ?? bundle.scales[0];
  const baseSteps = useMemo(() => selectedScale ? scaleSteps(bundle, selectedScale, root, register) : [], [bundle, selectedScale, root, register]);
  const baseNotes = useMemo(() => baseSteps.map(step => tuningPitch(bundle.tuning, step)), [bundle, baseSteps]);
  const pitchLabels = new Map(keys.filter(key => key.note !== null).map(key => [key.note!, key.label ?? (key.steps === undefined ? noteName(key.note!) : tuningStepLabel(bundle.tuning, key.steps))]));
  baseSteps.forEach((step, i) => pitchLabels.set(baseNotes[i], tuningStepLabel(bundle.tuning, step)));
  const labelNote = (note: number) => pitchLabels.get(note) ?? `Pitch ${note.toFixed(2)}`;

  const localBundles = [...new Map(layouts.filter(layout => !layout.id.startsWith("device:")).map(layout => [layout.bundle.objectIdHex, layout.bundle])).values()];
  const [stage, setStage] = useState<Stage>("ready");
  const [pattern, setPattern] = useState<ScalePattern>("ascending");
  const notes = useMemo(() => course ? lesson.targets.map(target => target[0]) : scalePatternNotes(pattern, baseNotes), [course, lesson, pattern, baseNotes]);
  const targets = course ? lesson.targets : notes.map(note => [note]);
  const previewNotes = course ? [...new Set(lesson.targets.flat())] : baseNotes;
  const missing = unavailableScaleNotes(keys, previewNotes, labelNote);
  const readyToPlay = !libraryBusy && previewNotes.length > 0 && missing.length === 0 && (!fromDevice || !!deviceLayoutChoice) && (!course || isLessonTuning(bundle));
  const [beatMode, setBeatMode] = useState(false);
  const [bpm, setBpm] = useState(80);
  const [continuous, setContinuous] = useState(true);
  const [brightness, setBrightness] = useState(65);
  const [lastRun, setLastRun] = useState<{ number: number; elapsedMs?: number; mistakes: number; beat?: BeatResult }>();
  const [now, setNow] = useState(0);
  const metronome = useRef<PracticeMetronome | null>(null);
  const [onBoard, setOnBoard] = useState(false);
  const [hints, setHints] = useState(true);
  const [demoNote, setDemoNote] = useState<readonly number[]>();
  const [message, setMessage] = useState("");
  const [, redraw] = useState(0);
  const run = useRef<MajorScaleRun | BeatScaleRun>(new MajorScaleRun());
  const usedHints = useRef(true);
  const finalized = useRef<MajorScaleRun | BeatScaleRun | null>(null);
  const session = useRef<DelegatedSession | null>(null);
  const audio = useRef<SynthPreviewController | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const generation = useRef(0);
  const handleKeyRef = useRef<(index: number, pressed: boolean, receivedAt?: number) => void>(() => {});
  const engaged = stage !== "ready";
  useEffect(() => { setLastRun(undefined); }, [pattern, layoutId, scaleChoice, root, register, beatMode, bpm, page, lessonIndex]);

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
  function dispose() {
    generation.current++;
    clearTimers();
    metronome.current?.stop();
    metronome.current = null;
    const oldSession = session.current;
    session.current = null;
    oldSession?.stop();
    const oldAudio = audio.current;
    audio.current = null;
    void oldAudio?.close().catch(() => {});
    run.current = course ? new CourseRun(lesson) : new MajorScaleRun(notes, labelNote);
  }
  function stop(reason = "") {
    dispose();
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

  async function begin(useBoard: boolean) {
    dispose();
    const currentGeneration = generation.current;
    const controller = new SynthPreviewController();
    audio.current = controller;
    controller.setPatch({ wavetableName: "Basic Shapes", wavetableFolderPath: "/Built In", wavetableSamples: createBasicShapesSamples(),
      values: { EnvelopeAttackIndex: 1, EnvelopeSustainLevel: 100, EnvelopeReleaseIndex: 5 } });
    run.current = course ? new CourseRun(lesson) : new MajorScaleRun(notes, labelNote);
    setLastRun(undefined);
    setOnBoard(useBoard);
    setStage("starting");
    setMessage("Preparing your lesson…");
    try {
      await controller.start();
      if (generation.current !== currentGeneration) return;
      if (useBoard) {
        const nextSession = new DelegatedSession(transport,
          (index, pressed, receivedAt) => handleKeyRef.current(index, pressed, receivedAt),
          (reason) => { if (generation.current === currentGeneration) stop(reason); });
        session.current = nextSession;
        await nextSession.start();
        nextSession.setDisplayRotation(selection.layout.deviceRotationSteps);
      }
      if (generation.current !== currentGeneration) return;
      await prepareRun();
      if (generation.current !== currentGeneration) return;
      setStage("practice");
      setMessage("");
    } catch (error) {
      if (generation.current === currentGeneration) stop(error instanceof Error ? error.message : "Could not start the lesson.");
    }
  }

  async function prepareRun(showHints = hints) {
    usedHints.current = showHints;
    const currentGeneration = generation.current;
    metronome.current?.stop();
    metronome.current = null;
    run.current = course ? new CourseRun(lesson) : new MajorScaleRun(notes, labelNote);
    if (beatMode && !course) {
      const clock = new PracticeMetronome();
      metronome.current = clock;
      const startAt = await clock.start(bpm, notes.length);
      if (generation.current !== currentGeneration) { clock.stop(); return; }
      run.current = new BeatScaleRun(notes, startAt, bpm, labelNote);
    }
  }

  function finishRun() {
    const finished = run.current;
    if (finalized.current === finished) return;
    finalized.current = finished;
    const beat = finished instanceof BeatScaleRun ? finished.result() : undefined;
    setLastRun((last) => ({ number: (last?.number ?? 0) + 1, elapsedMs: finished.elapsedMs, mistakes: finished.mistakes, beat }));
    if (finished instanceof CourseRun) {
      const nextProgress = recordCourseRun(progress, finished.lesson.id, `${bundle.objectIdHex}:${selection.layout.objectIdHex}`, finished.mistakes, usedHints.current);
      setProgress(nextProgress);
      try { localStorage.setItem(courseProgressKey, JSON.stringify(nextProgress)); setProgressMessage(""); }
      catch { setProgressMessage("Progress could not be saved in this browser."); }
    }
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
  }, [stage, continuous, notes, bpm]);

  function handleKey(index: number, pressed: boolean, receivedAt = performance.now()) {
    if (pressed && stage !== "practice") return;
    const note = keys[index]?.note;
    if (note === null || note === undefined) return;
    if (pressed) {
      const alreadySounding = [...run.current.held.values()].includes(note);
      const attacked = run.current.press(index, note, receivedAt);
      if (attacked && !alreadySounding) {
        void audio.current?.noteOn(note).catch(() => stop("Browser audio stopped. Start the lesson again."));
      }
      if (attacked && run.current instanceof MajorScaleRun && run.current.complete) finishRun();
    } else {
      const released = run.current instanceof CourseRun ? run.current.release(index, receivedAt) : run.current.release(index);
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
    clearTimers();
    audio.current?.allNotesOff();
    setHints(showHints);
    setDemoNote(undefined);
    setStage("starting");
    const currentGeneration = generation.current;
    try {
      await prepareRun(showHints);
      if (generation.current === currentGeneration) setStage("practice");
    } catch { if (generation.current === currentGeneration) stop("Could not start practice audio. Try again."); }
  }

  function demonstrate() {
    usedHints.current = true;
    clearTimers();
    audio.current?.allNotesOff();
    run.current = course ? new CourseRun(lesson) : new MajorScaleRun(notes, labelNote);
    setStage("demo");
    setMessage("");
    targets.forEach((chord, index) => {
      timers.current.push(setTimeout(() => {
        setDemoNote(chord);
        chord.forEach(note => { void audio.current?.noteOn(note).catch(() => stop("Browser audio stopped. Start again when ready.")); });
      }, index * 650));
      timers.current.push(setTimeout(() => chord.forEach(note => audio.current?.noteOff(note)), index * 650 + 450));
    });
    timers.current.push(setTimeout(() => {
      setDemoNote(undefined);
      setStage("practice");
      setMessage("");
    }, notes.length * 650));
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
  const lights = keys.map((key) => keyLight(key, key.note !== null && (stage === "ready" ? previewNotes : targetNotes).includes(key.note) ? key.note : undefined, run.current.held, stage === "ready" || stage === "demo" || (hints && stage === "practice")));
  const targetLabel = targetNotes.map(labelNote).join(" + ");
  const lightStates = lights.join();
  const ledColors = useMemo(() => keys.map(({ note, steps }, index) => lessonLedColor(note, lights[index], {
    bundle: { ...bundle, layouts: [selection.layout], activeLayoutIdHex: selection.layout.objectIdHex },
    steps: steps ?? 0, root, mode: colorMode, index
  })), [keys, lightStates, bundle, selection.layout, root, colorMode]);
  const boardColors = ledColors.map((color) => ({ ...color, value: Math.round(color.value * brightness / 100) }));
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
    if (engaged) stop();
    setPage(next);
    if (next === "course") setRoot(0);
    setMessage("");
    if (next === "course" && !isLessonTuning(bundle)) chooseLocalTuning(localBundles[0], layouts.find(item => item.bundle === localBundles[0])!.id);
  }
  function nextLesson() { stop(); setLessonIndex(index => Math.min(beginnerLessons.length - 1, index + 1)); }
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

  return <section className="learnPage">
    <header className="learnIntro">
      <h2>Learn</h2>
      <nav className="learnTabs" aria-label="Learning sections">{(["practice", "course", "progress"] as const).map(item => <button key={item} type="button" aria-current={page === item ? "page" : undefined} disabled={(engaged && stage !== "complete") || libraryBusy} onClick={() => navigate(item)}>{item === "course" ? "Beginner course" : item === "practice" ? "Scale practice" : "Progress"}</button>)}</nav>
    </header>
    {page === "progress" ? <div className="learnCard">
      <div className="learnPracticeHeader"><h3>Your course progress</h3><button type="button" onClick={saveProgressFile}>Export progress</button></div>
      <p className="learnMuted">Saved in this browser, per layout. Independent = no mistakes, no hints.</p>
      <div className="learnProgressList">{beginnerLessons.map((item, index) => {
        const entries = Object.values(progress[item.id] ?? {});
        return <button type="button" key={item.id} onClick={() => { setLessonIndex(index); navigate("course"); }}><span>{index + 1}. {item.title}</span><span>{entries.some(entry => entry.independent) ? "★ Independent" : entries.length ? "✓ Completed" : "Start"}{entries.length > 0 && ` · ${entries.length} layout${entries.length === 1 ? "" : "s"}`}</span></button>;
      })}</div>
      <details><summary>Restore progress</summary><input aria-label="Import course progress" type="file" accept=".json" onChange={event => void restoreProgress(event)} /></details>
      {progressMessage && <p role="status">{progressMessage}</p>}
    </div> : <div className="learnWorkspace">
      <aside className="learnCard learnGuide">
        {course && <><label className="learnField">Lesson<select value={lessonIndex} disabled={engaged} onChange={event => setLessonIndex(Number(event.target.value))}>{beginnerLessons.map((item, index) => <option key={item.id} value={index}>{index + 1}. {item.title}</option>)}</select></label>
          <p className="learnLessonInstruction">{lesson.instruction}</p></>}
        <label className="learnField">Tuning<select value={tuningChoice} disabled={engaged || libraryBusy} onChange={event => void chooseTuning(event.target.value)}>
          <optgroup label="Starter / imported">{localBundles.map(item => <option key={item.objectIdHex} value={item.objectIdHex}>{item.tuning.name}</option>)}</optgroup>
          <optgroup label="On HexBoard">{tuningNames.map(item => <option key={item.handle} value={`device:${item.handle}`}>{item.name}{item.folderPath !== "/" ? ` · ${item.folderPath}` : ""}</option>)}</optgroup>
        </select></label>
        <label className="learnField">Layout<select value={fromDevice ? deviceLayoutChoice : selection.id} disabled={engaged || libraryBusy} onChange={event => { if (fromDevice) void chooseDeviceLayout(event.target.value); else setLayoutId(event.target.value); }}>
          {fromDevice ? <><option value="">Choose a layout</option>{layoutNames.map(item => <option key={item.handle} value={item.handle}>{item.name}</option>)}</>
            : layouts.filter(item => item.bundle.objectIdHex === tuningChoice).map(item => <option key={item.id} value={item.id}>{item.layout.name}</option>)}
        </select></label>
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
        <details className="learnSettings"><summary>Colors &amp; brightness</summary>
          <label className="learnField">Color mode<select value={colorMode} onChange={event => setColorMode(Number(event.target.value) as ColorModeValue)}>{Object.entries(ColorMode).map(([name, value]) => <option key={value} value={value}>{name === "AltPiano" ? "Alt Piano" : name}</option>)}</select></label>
          <label className="learnField">Board brightness · {brightness}%<input aria-label="Board brightness" type="range" min="0" max="100" value={brightness} onChange={event => setBrightness(Number(event.target.value))} /></label>
        </details>
        <details className="learnSettings"><summary>Library &amp; help</summary>
          <button type="button" disabled={!connected || engaged || libraryBusy} onClick={() => void refreshDeviceNames(true)}>Refresh tuning names</button>
          <label className="learnField">Import tuning bundle<input aria-label="Import lesson tuning bundle" type="file" accept=".json" disabled={engaged || libraryBusy} onChange={event => void importLayout(event)} /></label>
          <p className="learnMuted">Sound plays in your browser. Hold the board encoder for 5 seconds to exit. Leaving this tab pauses practice.</p>
          <p className="learnMuted">Register shifts by tuning periods. Brightness stays within the board’s saved limit.</p>
          <p className="learnMuted">Metronome: four count-in clicks, then one note per click. Grades include timing, missed notes, and extra attempts. Use wired audio for accurate timing.</p>
        </details>
        {libraryMessage && <p role="status" className="learnMuted">{libraryMessage}</p>}
        {course && !isLessonTuning(bundle) && <p role="alert" className="learnWarning">Choose standard 12-EDO for the beginner course. Other tunings work in Scale practice.</p>}
        {(!fromDevice || deviceLayoutChoice) && missing.length > 0 && <p className="learnWarning" role="alert">Missing {missing.join(", ")}. Try another layout or register.</p>}
      </aside>
      <div className="learnCard learnPractice">
        <div className="learnActions learnTransport">{!engaged ? <>
          <button className="primary" type="button" disabled={!connected || !readyToPlay} onClick={() => void begin(true)}>Start on HexBoard</button>
          <button type="button" disabled={!readyToPlay} onClick={() => void begin(false)}>Try on screen</button>
        </> : <>
          <button type="button" onClick={() => stop()}>Stop</button>
          <button type="button" disabled={(beatMode && !course) || stage === "starting" || stage === "demo" || run.current.held.size > 0} onClick={demonstrate}>Hear example</button>
        </>}
        <label className="checkField"><input type="checkbox" checked={hints} disabled={stage === "demo"} onChange={event => { setHints(event.target.checked); if (event.target.checked && engaged) usedHints.current = true; }} />Hints</label></div>
        <div className="learnPracticeHeader"><h3>{stage === "complete" ? "Finished" : stage === "demo" ? `Listen: ${targetLabel}` : countingIn ? "Four clicks, then play" : stage === "practice" ? (hints ? `Next: ${targetLabel || "finished"}` : "Play from memory") : stage === "starting" ? "Starting…" : course ? lesson.title : selectedScale?.name ?? "Choose a scale"}</h3><span>{engaged ? run.current.step : 0}/{notes.length}</span></div>
        {(stage === "ready" || stage === "demo" || hints) && <ol className="learnScaleSteps" aria-label="Exercise notes">{targets.map((chord, index) => <li key={index} className={progressClass(index)} aria-current={index === run.current.step && stage === "practice" ? "step" : undefined}><span>{chord.map(labelNote).join(" + ")}</span></li>)}</ol>}
        <div className="learnRunStats">
          {stage === "practice" && run.current instanceof BeatScaleRun && <div className="learnBeatClock"><span aria-hidden="true" className={(now - run.current.startAt + 4 * run.current.periodMs) % run.current.periodMs < 120 ? "pulse" : ""}>●</span>{countingIn ? `Count-in ${Math.max(1, Math.min(4, 5 - Math.ceil((run.current.startAt - now) / run.current.periodMs)))}/4` : `${bpm} BPM`}</div>}
          {elapsed !== undefined && <span>{(elapsed / 1000).toFixed(2)} s</span>}
          {lastRun && <span role="status">Last: {lastRun.elapsedMs === undefined ? "incomplete" : `${(lastRun.elapsedMs / 1000).toFixed(2)} s`}{lastRun.beat ? ` · ${lastRun.beat.score}/100 · ${lastRun.beat.grade} · ${lastRun.beat.missed} missed · ${lastRun.beat.extras} extra` : ` · ${lastRun.mistakes} mistakes`}</span>}
        </div>
        {(!fromDevice || deviceLayoutChoice) && <div className="learnBoardWrap"><svg className="learnBoard" viewBox={`0 0 ${width} ${height}`} aria-label={`${selection.layout.name} key map`}>
          <g transform={`translate(${width / 2} ${height / 2}) rotate(${angle}) translate(-275 -310)`}>
            {keys.filter(({ key }) => key.role !== "command").map(({ key, note }) => {
              const playable = !onBoard && note !== null && (stage === "practice" || (stage === "complete" && run.current.held.has(key.index)));
              const color = lessonScreenColor(ledColors[key.index]);
              return <g key={key.index} transform={`translate(${32 + key.coordCol * 25} ${35 + key.row * 42})`} className={`learnKey ${lights[key.index]}`}
                role={playable ? "button" : undefined} tabIndex={playable ? 0 : undefined} aria-label={note === null ? `Key ${key.index}, unavailable` : `${labelNote(note)}, key ${key.index}`}
                onClick={() => { if (playable) tap(key.index); }} onKeyDown={(event) => { if (playable && !event.repeat && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); tap(key.index); } }}>
                <polygon style={note === null ? undefined : { fill: color.fill }} points="0,-25 22,-12.5 22,12.5 0,25 -22,12.5 -22,-12.5" />
                <text style={note === null ? undefined : { fill: color.text }} transform={`rotate(${-angle})`} textAnchor="middle" dy="4">{note === null ? "·" : labelNote(note)}</text>
              </g>;
            })}
          </g>
        </svg></div>}
        <div className="learnLegend">{stage === "ready" ? "Bright keys: exercise notes" : "Bright: target · dashed: held"}{course && lesson.targets.some(target => target.length > 1) && !onBoard && stage === "practice" && " · Click a key to hold or release"}</div>
        {(message || stage === "practice" || stage === "demo") && <div className="learnFeedback" role="status" aria-live="polite">{message || (stage === "practice" ? hints ? run.current.feedback : "Follow the exercise from memory." : "Listen and watch.")}</div>}
        {progressMessage && course && <p role="status" className="learnMuted">{progressMessage}</p>}
        {stage === "complete" && <div className="learnCompletion"><div className="learnActions"><button type="button" onClick={() => void repeat(false)}>Try without hints</button><button type="button" onClick={() => void repeat(true)}>Repeat</button>{course && lessonIndex < beginnerLessons.length - 1 && <button className="primary" type="button" onClick={nextLesson}>Next lesson</button>}</div></div>}
      </div>
    </div>}
  </section>;
}
