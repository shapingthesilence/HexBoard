import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { MidiTransport } from "../midi/types.ts";
import { SynthPreviewController } from "../audio/synthPreview.ts";
import { createBasicShapesSamples } from "../catalogs/factoryWavetables.ts";
import { parseTuningBundleFile } from "../catalogs/layoutsCatalog.ts";
import { DelegatedSession } from "../learn/delegatedSession.ts";
import { lessonLedColor, lessonScreenColor } from "../learn/lessonColors.ts";
import { keyLight, lessonLayouts, majorScale, MajorScaleRun, noteName, resolveLessonKeys, scaleNames, starterLayouts, unavailableScaleNotes, type LessonLayout } from "../learn/majorScale.ts";

type Stage = "ready" | "starting" | "practice" | "demo" | "complete";

export function Learn({ transport, connected }: { transport: MidiTransport; connected: boolean }) {
  const [layouts, setLayouts] = useState<LessonLayout[]>(starterLayouts);
  const [layoutId, setLayoutId] = useState(() => layouts[0].id);
  const selection = layouts.find((layout) => layout.id === layoutId) ?? layouts[0];
  const keys = useMemo(() => resolveLessonKeys(selection), [selection]);
  const missing = unavailableScaleNotes(keys);
  const [stage, setStage] = useState<Stage>("ready");
  const [onBoard, setOnBoard] = useState(false);
  const [hints, setHints] = useState(true);
  const [demoNote, setDemoNote] = useState<number>();
  const [message, setMessage] = useState("Choose a layout, then start your first scale.");
  const [, redraw] = useState(0);
  const run = useRef(new MajorScaleRun());
  const session = useRef<DelegatedSession | null>(null);
  const audio = useRef<SynthPreviewController | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const generation = useRef(0);
  const handleKeyRef = useRef<(index: number, pressed: boolean) => void>(() => {});
  const engaged = stage !== "ready";

  function clearTimers() { timers.current.forEach(clearTimeout); timers.current = []; }
  function dispose() {
    generation.current++;
    clearTimers();
    const oldSession = session.current;
    session.current = null;
    oldSession?.stop();
    const oldAudio = audio.current;
    audio.current = null;
    void oldAudio?.close().catch(() => {});
    run.current = new MajorScaleRun();
  }
  function stop(reason = "Lesson stopped. You can start again or choose another layout.") {
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
    run.current = new MajorScaleRun();
    setOnBoard(useBoard);
    setStage("starting");
    setMessage("Preparing your lesson…");
    try {
      await controller.start();
      if (generation.current !== currentGeneration) return;
      if (useBoard) {
        const nextSession = new DelegatedSession(transport,
          (index, pressed) => handleKeyRef.current(index, pressed),
          (reason) => { if (generation.current === currentGeneration) stop(reason); });
        session.current = nextSession;
        await nextSession.start();
        nextSession.setDisplayRotation(selection.layout.deviceRotationSteps);
      }
      if (generation.current !== currentGeneration) return;
      setStage("practice");
      setMessage(useBoard ? "Play on your HexBoard. Sound comes from your browser." : "Click or focus the on-screen keys to play.");
    } catch (error) {
      if (generation.current === currentGeneration) stop(error instanceof Error ? error.message : "Could not start the lesson.");
    }
  }

  function handleKey(index: number, pressed: boolean) {
    if (stage !== "practice") return;
    const note = keys[index]?.note;
    if (note === null || note === undefined) return;
    if (pressed) {
      const alreadySounding = [...run.current.held.values()].includes(note);
      if (run.current.press(index, note) && !alreadySounding) {
        void audio.current?.noteOn(note).catch(() => stop("Browser audio stopped. Start the lesson again."));
      }
    } else {
      const released = run.current.release(index);
      if (released !== undefined && ![...run.current.held.values()].includes(released)) audio.current?.noteOff(released);
      if (run.current.complete) setStage("complete");
    }
    redraw((value) => value + 1);
  }
  handleKeyRef.current = handleKey;

  function tap(index: number) {
    handleKey(index, true);
    timers.current.push(setTimeout(() => handleKeyRef.current(index, false), 180));
  }

  function repeat(showHints: boolean) {
    clearTimers();
    audio.current?.allNotesOff();
    run.current = new MajorScaleRun();
    setHints(showHints);
    setDemoNote(undefined);
    setStage("practice");
    redraw((value) => value + 1);
  }

  function demonstrate() {
    clearTimers();
    audio.current?.allNotesOff();
    run.current = new MajorScaleRun();
    setStage("demo");
    setMessage("Listen for the whole and half steps. Watch how the pattern moves across your layout.");
    majorScale.forEach((note, index) => {
      timers.current.push(setTimeout(() => {
        setDemoNote(note);
        void audio.current?.noteOn(note).catch(() => stop("Browser audio stopped. Start again when ready."));
      }, index * 650));
      timers.current.push(setTimeout(() => audio.current?.noteOff(note), index * 650 + 450));
    });
    timers.current.push(setTimeout(() => {
      setDemoNote(undefined);
      setStage("practice");
      setMessage("Your turn. Follow the same eight notes at your own pace.");
    }, majorScale.length * 650));
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
      setLayoutId(imported[0].id);
      setMessage("Imported layouts for this visit. The lesson checks that each scale note is available.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not import that tuning bundle.");
    }
  }

  const target = stage === "demo" ? demoNote : majorScale[run.current.step];
  const lights = keys.map((key) => keyLight(key, target, run.current.held, stage === "demo" || (hints && stage === "practice")));
  const ledColors = keys.map(({ note }, index) => lessonLedColor(note, lights[index]));
  const lightSignature = JSON.stringify(ledColors);
  useEffect(() => { session.current?.setLights(ledColors); }, [lightSignature, stage]);
  const angle = selection.layout.deviceRotationSteps * 90;
  const sideways = selection.layout.deviceRotationSteps % 2 !== 0;
  const width = sideways ? 620 : 550, height = sideways ? 550 : 620;

  return <section className="learnPage">
    <header className="learnIntro">
      <div><span className="eyebrow">Learn · First steps · 12-EDO</span><h2>Your first major scale</h2>
        <p>Eight notes, one musical idea. Discover its shape on your HexBoard.</p></div>
      <span className="learnLessonBadge">Lesson 01 · At your own pace</span>
    </header>
    <div className="learnWorkspace">
      <aside className="learnCard learnGuide">
        <h3>Start with C major</h3>
        <p>A major scale follows this pattern: whole, whole, half, whole, whole, whole, half steps. In C, the notes are C D E F G A B C.</p>
        <label className="learnField">Layout<select value={selection.id} disabled={engaged} onChange={(event) => { setLayoutId(event.target.value); setMessage("Layout changed. The notes stay the same; their positions change."); }}>
          {layouts.map((layout) => <option key={layout.id} value={layout.id}>{layout.label}</option>)}
        </select></label>
        <details><summary>Use your own layout</summary><p>Export a standard 12-EDO tuning bundle from Tunings &amp; Layouts, then open it here.</p>
          <input aria-label="Import lesson tuning bundle" type="file" accept=".json" disabled={engaged} onChange={(event) => void importLayout(event)} />
        </details>
        <p className="learnMuted">The lesson uses the layout selected here. Your saved instrument settings stay available when you finish.</p>
        {missing.length > 0 && <p className="learnWarning" role="alert">This layout is missing {missing.join(", ")}. Choose another layout or edit its range before starting.</p>}
        {!engaged ? <div className="learnActions">
          <button className="primary" type="button" disabled={!connected || missing.length > 0} onClick={() => void begin(true)}>Start on HexBoard</button>
          <button type="button" disabled={missing.length > 0} onClick={() => void begin(false)}>Try on screen</button>
          {!connected && <p className="learnMuted">Connect HexBoard above to use its keys and lights.</p>}
        </div> : <div className="learnActions">
          <button type="button" onClick={() => stop()}>Stop lesson</button>
          <button type="button" disabled={stage === "starting" || stage === "demo" || run.current.held.size > 0} onClick={demonstrate}>Hear &amp; watch the scale</button>
        </div>}
        <label className="checkField"><input type="checkbox" checked={hints} disabled={stage === "demo"} onChange={(event) => setHints(event.target.checked)} />Show the next note</label>
        <p className="learnMuted">Sound plays through your browser. During a board lesson, hold the encoder for five seconds to exit. Leaving this tab pauses the lesson.</p>
      </aside>
      <div className="learnCard learnPractice">
        <div className="learnPracticeHeader"><div><span className="eyebrow">{onBoard && engaged ? "Playing on HexBoard" : "Explore the layout"}</span>
          <h3>{stage === "complete" ? "Scale complete" : stage === "demo" ? `Listen: ${demoNote === undefined ? "…" : noteName(demoNote)}` : stage === "practice" ? `Next: ${target === undefined ? "release the last note" : noteName(target)}` : "C4 → C5"}</h3></div>
          <span>{run.current.step} / 8 notes</span>
        </div>
        <ol className="learnScaleSteps" aria-label="Scale progress">{scaleNames.map((name, index) => <li key={name} className={index < run.current.step ? "done" : index === run.current.step && stage === "practice" ? "current" : ""} aria-current={index === run.current.step && stage === "practice" ? "step" : undefined}><span>{name}</span><small>{index === 7 ? "1" : index + 1}</small></li>)}</ol>
        <div className="learnBoardWrap"><svg className="learnBoard" viewBox={`0 0 ${width} ${height}`} aria-label={`${selection.layout.name} key map`}>
          <g transform={`translate(${width / 2} ${height / 2}) rotate(${angle}) translate(-275 -310)`}>
            {keys.filter(({ key }) => key.role !== "command").map(({ key, note }) => {
              const playable = stage === "practice" && !onBoard && note !== null;
              const color = lessonScreenColor(ledColors[key.index]);
              return <g key={key.index} transform={`translate(${32 + key.coordCol * 25} ${35 + key.row * 42})`} className={`learnKey ${lights[key.index]}`}
                role={playable ? "button" : undefined} tabIndex={playable ? 0 : undefined} aria-label={note === null ? `Key ${key.index}, unavailable` : `${noteName(note)}, key ${key.index}`}
                onClick={() => { if (playable) tap(key.index); }} onKeyDown={(event) => { if (playable && !event.repeat && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); tap(key.index); } }}>
                <polygon style={note === null ? undefined : { fill: color.fill }} points="0,-25 22,-12.5 22,12.5 0,25 -22,12.5 -22,-12.5" />
                <text style={note === null ? undefined : { fill: color.text }} transform={`rotate(${-angle})`} textAnchor="middle" dy="4">{note === null ? "·" : noteName(note)}</text>
              </g>;
            })}
          </g>
        </svg></div>
        <div className="learnLegend"><span>Rainbow colors identify pitches across octaves.</span><span>Bright + solid outline: next note · dashed outline: held key</span></div>
        <div className="learnFeedback" role="status" aria-live="polite"><strong>{stage === "practice" || stage === "complete" ? run.current.feedback : message}</strong>
          {(stage === "practice" || stage === "complete") && <p>{message}</p>}
        </div>
        {stage === "complete" && <div className="learnCompletion"><p>{run.current.mistakes === 0 ? "You found every note without a wrong attempt." : `${run.current.mistakes} extra attempts. Repeat slowly and focus on the tricky notes.`}</p>
          <div className="learnActions"><button className="primary" type="button" onClick={() => repeat(false)}>Repeat without hints</button><button type="button" onClick={() => repeat(true)}>Repeat with hints</button><button type="button" onClick={() => stop("Choose another layout to discover the same scale in a new shape.")}>Try another layout</button></div>
        </div>}
      </div>
    </div>
  </section>;
}
