import { useEffect, useMemo, useRef, useState } from "react";
import type { MidiTransport } from "../../midi/types.ts";
import type { HelloResponsePayload } from "../../protocol/index.ts";
import { CapabilityFlag } from "../../protocol/index.ts";
import { advancedNoteSurface } from "../../midi/boardContext.ts";
import { CalibrationClient, record } from "./client.ts";
import { RamSettingsSync, type RamSyncStatus } from "./ramSync.ts";
import { defaultConfig, fields, movePoint, movePressurePoint, respacePoints, type Capture, type LabConfig, type PressureSample, type Strike } from "./model.ts";
import { CaptureParser, mm, to16, rawAt, windowTime } from "./protocol.mjs";
import { parseVelocity } from "./live-velocity.mjs";
import { parsePressure, pressurePercent } from "./pressure.mjs";
import { clampRange, phaseRange, scaleRange } from "./strike-view.mjs";
import { engineMeasurement } from "./engines.mjs";
import { chartColors, CurveChart, PressureCurveChart, Plot } from "./Charts.tsx";
import { NumberField, VelocityControls } from "./VelocityControls.tsx";
import "./calibration.css";

type Step = "hall" | "velocity" | "pressure" | "diagnostics";
const steps: Array<{ id: Step; label: string; description: string }> = [
  { id: "hall", label: "1. Hall setup", description: "Capture each key’s rest position and firm endpoint." },
  { id: "velocity", label: "2. Velocity", description: "Play, choose a response, and tune soft-to-hard strikes." },
  { id: "pressure", label: "3. Pressure", description: "Set the travel range and response for held notes." },
  { id: "diagnostics", label: "Diagnostics", description: "Inspect captured travel, neighboring sensors, LEDs, and scan timing." }
];
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function download(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
}
export function CalibrationWorkspace({ transport, hello }: { transport: MidiTransport; hello: HelloResponsePayload }) {
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const client = useMemo(() => new CalibrationClient(transport), [transport, sessionEpoch]);
  const [step, setStep] = useState<Step>("hall"), [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Reading calibration from your board…"), [error, setError] = useState(false);
  const [config, setConfig] = useState<LabConfig>(defaultConfig), [applied, setApplied] = useState<LabConfig>(defaultConfig);
  const [hall, setHall] = useState<Record<string, string>>({}), [velocityStatus, setVelocityStatus] = useState<Record<string, string>>({});
  const [key, setKey] = useState(61), [showKeys, setShowKeys] = useState(false), [profile, setProfile] = useState(1);
  const [strikes, setStrikes] = useState<Strike[]>([]), [paused, setPaused] = useState(false), [filter, setFilter] = useState("all");
  const [pressure, setPressure] = useState<PressureSample | null>(null), [pressureHistory, setPressureHistory] = useState<Array<{ x: number; y: number }>>([]);
  const [curveKind, setCurveKind] = useState<"on" | "off">("on"), [windowMs, setWindowMs] = useState(150), [pointSource, setPointSource] = useState("live");
  const [guided, setGuided] = useState(false), [guidedPoints, setGuidedPoints] = useState(4), [guidedSamples, setGuidedSamples] = useState(3);
  const [capture, setCapture] = useState<Capture | null>(null), [capturing, setCapturing] = useState(false), [range, setRange] = useState<number[] | null>(null), [raw, setRaw] = useState(false);
  const [hiddenNeighbors, setHiddenNeighbors] = useState<number[]>([]), [scan, setScan] = useState<Record<string, string>>({}), [monitorDropped, setMonitorDropped] = useState(0);
  const [ledResults, setLedResults] = useState<Array<Record<string, string>>>([]), [ledRunning, setLedRunning] = useState(false), [ledMax, setLedMax] = useState(4), [ledDuration, setLedDuration] = useState(2000), [ledSuite, setLedSuite] = useState("brightness");
  const [confirm, setConfirm] = useState<{ title: string; text: string; action: () => Promise<void> } | null>(null);
  const [ramStatus, setRamStatus] = useState<RamSyncStatus>("synced"), [ramDetail, setRamDetail] = useState("");
  const operation = useRef(false), alive = useRef(false), captureAbort = useRef(false), ledAbort = useRef(false), selected = useRef({ key, paused, filter, step, guided });
  selected.current = { key, paused, filter, step, guided };
  const supported = Boolean(hello.capabilityFlags & CapabilityFlag.AdvancedCalibrationLab);
  const hallActive = ["rest", "running"].includes(hall.status), locked = busy || capturing || ledRunning || hallActive || guided;
  const dirty = JSON.stringify(config) !== JSON.stringify(applied);
  const ramSync = useMemo(() => new RamSettingsSync(async action => {
    while ((operation.current || client.busy) && alive.current) await delay(10);
    if (!alive.current) return;
    operation.current = true;
    try { await action(command => client.command(command)); } finally { operation.current = false; }
  }, next => { if (alive.current) setApplied(next); }, (status, detail = "") => {
    if (alive.current) { setRamStatus(status); setRamDetail(detail); }
  }), [client]);
  const points = config.curves[curveKind], latest = [...strikes].reverse().find(s => s.kind === curveKind && !s.engine) ?? null;
  const channel = capture?.count ? capture.channels[0] : null;
  const captureBounds = channel ? [channel.points[0].time, channel.points.at(-1)!.time] : null;
  const crossing = channel && capture?.result === 0 && !capture.gaps ? windowTime(channel.points, mm(config.thresholds[0]), mm(config.thresholds[1])) : null;
  const measurement = pointSource === "capture" ? (curveKind === "on" ? crossing?.us : null) : latest?.us;
  const freshPressure = pressure?.key === key && pressure.valid ? pressure : null;
  const notify = (text: string, failed = false) => { if (alive.current) { setMessage(text); setError(failed); } };
  async function refresh() {
    const next = await client.config(); if (!alive.current) return;
    ramSync.reset(next); setConfig(next); setApplied(next);
    setWindowMs(Math.min(240, Math.max(5, Math.ceil(Math.max(...next.curves.on.map(p => p.us), ...next.curves.off.map(p => p.us)) / 25000) * 25)));
    setHall(record(await client.command("cal status"), "cal,status="));
    setVelocityStatus(record(await client.command("velocity status"), "velocity,status,"));
  }
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    while (operation.current && alive.current) await delay(10);
    operation.current = true;
    while (client.busy && alive.current) await delay(10);
    if (!alive.current) { operation.current = false; return; }
    try { await action(); } catch (cause) { notify(cause instanceof Error ? cause.message : "Could not update calibration.", true); }
    finally { operation.current = false; if (alive.current) setBusy(false); }
  }
  useEffect(() => {
    alive.current = true; captureAbort.current = ledAbort.current = false; setReady(false);
    let polling = false, lastStatus = 0, disposed = false;
    if (!supported) { setMessage("This board firmware needs the Sync calibration update. Update main firmware, then reconnect HexBoard."); return () => { alive.current = false; }; }
    const initialize = async () => {
      try { await client.open(); if (disposed) return; await refresh(); if (!disposed && alive.current) { setReady(true); notify("Ready. Set up Hall keys first, then tune velocity and pressure."); } }
      catch (cause) { if (!disposed) notify(cause instanceof Error ? cause.message : "Could not open calibration.", true); }
    };
    void initialize();
    const timer = setInterval(() => {
      if (client.busy || operation.current || polling || !alive.current) return;
      polling = true;
      const poll = async () => {
        try {
          const current = selected.current, lines = await client.live(current.key);
          if (disposed || !alive.current) return;
          const incoming = lines.map(parseVelocity).filter((s): s is Strike => Boolean(s));
          if (!current.paused && incoming.length) setStrikes(previous => [...previous, ...incoming.filter(s => current.filter === "all" || s.key === current.key)].slice(-32));
          const sample = lines.map(parsePressure).find(Boolean);
          if (sample) { setPressure(sample); if (sample.valid) setPressureHistory(previous => [...previous, { x: performance.now() / 1000, y: sample.pressure / 65535 * 100 }].slice(-64)); }
          const dropped = record(lines, "lab,").dropped; if (dropped) setMonitorDropped(Number(dropped));
          if (performance.now() - lastStatus > 700) {
            lastStatus = performance.now();
            if (current.step === "hall") setHall(record(await client.command("cal status"), "cal,status="));
            if (current.guided) {
              const next = record(await client.command("velocity status"), "velocity,status,"); setVelocityStatus(next);
              if (next.manual_status === "done" || next.manual_status === "complete" || next.manual_status === "idle") {
                setGuided(false); await refresh(); notify("Guided strikes complete. Play to test the response, then save the applied profile.");
              }
            }
          }
        } catch (cause) { if (!disposed) { setReady(false); setPressure(null); notify(cause instanceof Error ? cause.message : "Calibration connection lost.", true); } clearInterval(timer); }
        finally { polling = false; }
      };
      void poll();
    }, 80);
    return () => {
      disposed = true;
      const finalEdits = ramSync.pendingUpdates();
      ramSync.stop(); alive.current = false; captureAbort.current = ledAbort.current = true; clearInterval(timer);
      // Navigating just before the debounce expires must not discard a valid
      // edit. Drain current work, send the latest RAM edits, then release tools.
      if (!finalEdits.length) { void client.close(); return; }
      void (async () => {
        while (client.busy) await delay(10);
        try { for (const edit of finalEdits) await client.command(edit.command); }
        catch { /* Held keys or connection loss leave the last acknowledged RAM settings intact. */ }
        finally { await client.close(); }
      })();
    };
  }, [client, supported]);
  useEffect(() => { ramSync.update(config); }, [ramSync, config]);
  useEffect(() => { ramSync.setPaused(!ready || locked); }, [ramSync, ready, locked]);
  useEffect(() => { setPressure(null); setPressureHistory([]); if (filter === "selected") setStrikes([]); }, [key, filter]);
  useEffect(() => { if (config.engine[0] > 0) setCurveKind("off"); }, [config.engine[0]]);
  const canEdit = ready && !locked;
  const hasTimingCurve = config.engine[0] !== 3;
  const run = (action: () => Promise<void>) => () => void perform(action);
  const requestConfirm = (title: string, text: string, action: () => Promise<void>) => setConfirm({ title, text, action });
  const changeCurve = (kind: "on" | "off", next: typeof points) => setConfig({ ...config,
    curves: { ...config.curves, [kind]: next }, customCurves: { ...config.customCurves, [kind]: true } });
  async function captureStrike() {
    captureAbort.current = false; setCapturing(true);
    const parser = new CaptureParser(); let cursor = 0, completed = false;
    try {
      await client.command(`capture arm ${key}`); notify(`Key ${key}: release it, then strike within ten seconds.`);
      const deadline = performance.now() + 20000;
      while (alive.current && !captureAbort.current && performance.now() < deadline) {
        if (client.busy) { await delay(50); continue; }
        const lines = await client.capture(cursor);
        if (lines.includes("capture,waiting")) { await delay(150); continue; }
        for (const line of lines) {
          const result = parser.feed(line);
          if (result) { completed = true; setCapture(result); setRange(null); setHiddenNeighbors([]); notify(["Capture complete.", "No strike detected: rest capture only.", "Capture cancelled.", "Settings changed during capture.", "Calibrate this key before capturing."][result.result], result.result !== 0); return; }
          if (line.startsWith("capture,next=")) cursor = Number(fields(line).next);
        }
        notify(`Reading buffered capture… ${cursor} channel samples received.`);
      }
      notify(captureAbort.current ? "Capture cancelled." : "Capture timed out.");
    } finally {
      if (!completed && !client.busy) await client.command("capture cancel").catch(() => {});
      if (alive.current) setCapturing(false);
    }
  }
  async function ledTest() {
    if (!Number.isInteger(ledMax) || ledMax < 1 || ledMax > 255) throw Error("Choose a maximum brightness from 1 to 255.");
    ledAbort.current = false; setLedRunning(true); setLedResults([]);
    const load = ledSuite === "patterns" ? ["white", "rainbow", "burst", "random"].map(pattern => ({ pattern, brightness: ledMax }))
      : [...new Set([1, Math.ceil(ledMax / 4), Math.ceil(ledMax / 2), ledMax])].map(brightness => ({ pattern: "white", brightness }));
    const stages = [{ pattern: "off", brightness: 0 }, ...load, { pattern: "off", brightness: 0 }];
    try {
      await client.command("led power off"); await delay(500); await client.command("led baseline");
      for (const [i, stage] of stages.entries()) {
        if (!alive.current || ledAbort.current) break;
        notify(`LED check ${i + 1}/${stages.length}: ${stage.pattern}, brightness ${stage.brightness}. Keep keys released.`);
        await client.command("led lease 10000"); await client.command(`led brightness ${stage.brightness}`);
        await client.command(`led pattern ${stage.pattern}`); await client.command(`led power ${stage.brightness ? "on" : "off"}`);
        await delay(500); await client.command("led reset");
        const until = performance.now() + ledDuration;
        while (alive.current && !ledAbort.current && performance.now() < until) {
          await delay(100); if (!client.busy) await client.live(key);
        }
        const result = record(await client.command("led report"), "led,status,");
        setLedResults(previous => [...previous, { ...result, pattern: stage.pattern, brightness: String(stage.brightness) }]);
      }
      notify(ledAbort.current ? "LED check stopped. LEDs off." : "LED check complete. LEDs off; preview a layout to restore its colors.");
    } finally { if (!client.busy) await client.command("led power off").catch(() => {}); if (alive.current) setLedRunning(false); }
  }
  return <div className="calibrationPage">
    <div className="calHeading"><div><span className="eyebrow">Connected board</span><h2>Calibration</h2><p>Set up your keys, shape their response, then save the settings that feel right.</p></div>
      <div className="calSummary"><strong>{hall.valid ?? "—"}/133 keys ready</strong><span>{dirty ? ramStatus === "applying" ? "Applying to RAM…" : "Edits pending" : "Settings applied to RAM"}</span></div></div>
    <div className="calStatus" role="status" data-error={error}>{message}</div>
    {!ready && supported && error && <button type="button" disabled={busy} onClick={() => {
      setBusy(true); void client.close().finally(() => { setBusy(false); setSessionEpoch(n => n + 1); });
    }}>Reconnect Calibration</button>}
    <p className="calHint" role="status">{ramDetail || (dirty ? "Edits apply to RAM automatically after a short pause. Response edits stay in RAM; Save keeps them after restart." : "Response edits apply to RAM automatically. Save to a profile to keep them after restart.")}</p>
    <nav className="sectionTabs" aria-label="Calibration steps">{steps.map(item => <button type="button" key={item.id} aria-current={step === item.id ? "step" : undefined}
      disabled={hallActive || guided || capturing || ledRunning || busy} onClick={() => setStep(item.id)}>{item.label}</button>)}</nav>
    <p className="calHint">{steps.find(item => item.id === step)!.description} Changes apply to all keys; the selected key is for measurements.</p>
    {step !== "hall" && <section className="calKeySelector"><div className="calActions"><NumberField label="Monitor key" value={key} min={0} max={132} disabled={locked}
      onChange={value => { if (Number.isInteger(value) && value >= 0 && value < 133) setKey(value); }} /><button type="button" aria-expanded={showKeys} onClick={() => setShowKeys(!showKeys)}>Choose on board</button>
      {freshPressure && <span>{mm(freshPressure.travel).toFixed(2)} mm · {(freshPressure.pressure / 65535 * 100).toFixed(1)}% pressure</span>}</div>
      {showKeys && <div className="calKeyGrid" aria-label="Choose a Hall key">{advancedNoteSurface.map(k => <button type="button" key={k.hallKey} disabled={locked} aria-pressed={key === k.hallKey}
        style={{ gridRow: k.row + 1, gridColumn: k.coordCol + 2 }} onClick={() => setKey(k.hallKey)}>{k.hallKey}</button>)}</div>}</section>}
    {step === "hall" && <section className="calCard calHall"><h3>Rest position & firm press</h3>
      <p>Release every key before starting. Keep them untouched while rest readings are captured. Then press each key firmly and release it. Finish after sweeping the whole board.</p>
      <ol className="calInstructions"><li>Start with all keys released.</li><li>{hall.status === "rest" ? "Capturing rest readings. Keep keys untouched…" : "Wait for rest capture to finish."}</li>
        <li>{hall.status === "running" ? "Capture is running. Press every key firmly, then release all keys." : "Sweep all 133 keys with a firm press."}</li><li>Finish, check coverage, then save Hall calibration.</li></ol>
      <div className="calReadings"><strong>{hall.valid ?? "—"}<small>of 133 keys ready</small></strong><span>{hall.status === "rest" ? "Rest capture" : hall.status === "running" ? "Press capture running" : hall.valid === "133" ? "Full board ready" : Number(hall.valid) > 0 ? "Partial coverage · only calibrated keys play" : "Calibration needed"}</span></div>
      <div className="calActions"><button type="button" className="primary" disabled={!ready || locked} onClick={run(async () => { await client.command("cal start"); setHall(record(await client.command("cal status"), "cal,status=")); notify("Keep keys released until rest capture finishes."); })}>Start Hall calibration</button>
        <button type="button" className="primary" disabled={!ready || busy || hall.status !== "running"} onClick={run(async () => { await client.command("cal finish"); setHall(record(await client.command("cal status"), "cal,status=")); notify("Capture finished. Check ready-key coverage before saving."); })}>Finish calibration</button>
        <button type="button" disabled={!canEdit} onClick={run(refresh)}>Refresh</button></div>
      <p className="calHint">Calibration stays in memory until you choose Save. Starting a new sweep replaces the current rest/press measurements; saved calibration can be restored.</p>
      <div className="calActions"><button type="button" disabled={!canEdit || !Number(hall.valid)} onClick={() => requestConfirm("Save Hall calibration?", "This stores the current key measurements on the board. Release keys; saving briefly pauses scanning.", async () => { await client.command("cal save"); notify("Hall calibration saved. It will load on restart."); })}>Save Hall calibration</button>
        <button type="button" disabled={!canEdit} onClick={() => requestConfirm("Restore saved Hall calibration?", "This replaces current key measurements with the last saved calibration.", async () => { await client.command("cal load"); setHall(record(await client.command("cal status"), "cal,status=")); notify("Saved Hall calibration restored."); })}>Restore saved calibration</button>
        <button type="button" disabled={!canEdit} onClick={() => setStep("velocity")}>Next: tune velocity →</button></div>
      <details className="calDetails"><summary>Reset options</summary><p>Clear removes the current measurements from memory. Erase removes the saved copy. Neither runs automatically.</p>
        <button type="button" disabled={!canEdit} onClick={() => requestConfirm("Clear current Hall measurements?", "Keys will need calibration again. The saved copy is retained.", async () => { await client.command("cal clear"); setHall(record(await client.command("cal status"), "cal,status=")); })}>Clear current measurements</button>{" "}
        <button type="button" disabled={!canEdit} onClick={() => requestConfirm("Erase saved Hall calibration?", "This removes the saved copy from the board. Current measurements remain in memory until restart.", async () => { await client.command("cal erase"); notify("Saved Hall calibration erased."); })}>Erase saved calibration</button></details>
    </section>}
    {step === "velocity" && <>
      <section className="calCard"><div className="calHeading"><h3>Play & compare</h3><div className="calActions"><label>Monitor <select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All keys</option><option value="selected">Selected key</option></select></label>
        <button type="button" aria-pressed={paused} onClick={() => setPaused(!paused)}>{paused ? "Resume" : "Pause"}</button><button type="button" onClick={() => setStrikes([])}>Clear</button></div></div>
        <div className="calReadings"><strong>{strikes.at(-1)?.velocity ?? "—"}<small>last velocity</small></strong><span>{strikes.at(-1) ? `Key ${strikes.at(-1)!.key} · ${strikes.at(-1)!.kind === "on" ? "press" : "release"} · ${engineMeasurement(strikes.at(-1)! )}` : "Play a calibrated key to see its response."}</span></div>
        <div className="calHistory" aria-label="Latest 32 velocities">{strikes.map((s, i) => <div key={i} style={{ height: `${s.velocity / 127 * 100}%` }} data-kind={s.kind} title={`Key ${s.key}: ${s.velocity}, ${engineMeasurement(s)}`}><span>{s.velocity}</span></div>)}</div>
        {!!monitorDropped && <p className="calHint">The monitor missed {monitorDropped} diagnostic records. This counter is separate from musical output.</p>}
      </section>
      <div className="calColumns"><VelocityControls config={config} change={setConfig} disabled={!canEdit} supportsEngines={config.capabilities.includes("engines")} />
      <section className="calCard"><h3>{config.engine[0] === 0 ? "Attack & release curves" : "Release curve"}</h3>
        {!hasTimingCurve ? <p>Peak Gesture uses peak depth and a fixed note duration. Its response is adjusted in the model controls.</p> : <><div className="sectionTabs"><button type="button" disabled={config.engine[0] !== 0} aria-current={curveKind === "on" ? "step" : undefined} onClick={() => setCurveKind("on")}>Attack</button><button type="button" aria-current={curveKind === "off" ? "step" : undefined} onClick={() => setCurveKind("off")}>Release</button></div>
        <p className="calHint">{config.engine[0] === 0 ? "Attack uses Start → End timing. " : "Attack is shaped in the model controls. "}Release uses End → Release; editing its curve enables release velocity. Shorter times give higher velocities. Gold shows the board’s last strike; the ring predicts the draft.</p>
        <div className="calFields"><NumberField label="Graph time window" value={windowMs} min={5} max={240} step={5} unit="ms" onChange={value => { if (value >= 5 && value <= 240) setWindowMs(value); }} />
          <label className="calField"><span>Curve points</span><select value={points.length || 4} disabled={locked} onChange={e => changeCurve(curveKind, respacePoints(points, Number(e.target.value)))}>{[4, 5, 6, 7, 8].map(n => <option key={n}>{n}</option>)}</select></label></div>
        <CurveChart points={points} onChange={next => changeCurve(curveKind, next)} windowMs={windowMs} last={latest} disabled={!canEdit} />
        <label className="calField"><span>Assign time from</span><select value={pointSource} onChange={e => setPointSource(e.target.value)}><option value="live">Latest live strike</option><option value="capture">Captured attack preview</option></select></label>
        <p className="calHint">{measurement ? `${(measurement / 1000).toFixed(3)} ms available. Choose Use time at the intended velocity.` : "Play or capture a strike to assign a measured time."}</p>
        <details className="calDetails"><summary>Edit points & assign measured times</summary><div className="calPoints">{points.map((p, i) => <div key={i}><NumberField label={`Point ${i + 1} velocity`} value={p.velocity} min={1} max={127} disabled={!canEdit} onChange={value => changeCurve(curveKind, movePoint(points, i, p.us, value))} />
          <NumberField label="Crossing time" value={p.us / 1000} unit="ms" min={.5} max={240} step={.1} disabled={!canEdit} onChange={value => changeCurve(curveKind, movePoint(points, i, value * 1000, p.velocity))} />
          <button type="button" disabled={!canEdit || !measurement} onClick={() => changeCurve(curveKind, movePoint(points, i, measurement!, p.velocity))}>Use time</button></div>)}</div></details>
        <div className="calActions"><button type="button" disabled={!canEdit} onClick={() => { changeCurve("off", config.curves.on.map(p => ({ ...p }))); setCurveKind("off"); }}>Copy attack to release</button></div></>}
      </section></div>
      <section className="calCard"><h3>Guided soft-to-hard calibration</h3><p>For Threshold Strike, play several strikes at each requested strength. The board averages their crossing times into an attack curve.</p>
        <div className="calFields"><NumberField label="Strength levels" value={guidedPoints} min={4} max={8} disabled={locked} onChange={setGuidedPoints} /><NumberField label="Strikes per level" value={guidedSamples} min={1} max={8} disabled={locked} onChange={setGuidedSamples} /></div>
        {guided && <p className="calStatus">Level {velocityStatus.manual_point}/{guidedPoints} · target velocity {velocityStatus.manual_target_vel} · {velocityStatus.manual_left} strikes remaining. Start softly and increase strength at each level.</p>}
        <div className="calActions"><button type="button" disabled={!canEdit || config.engine[0] !== 0 || dirty} onClick={run(async () => {
          if (!Number.isInteger(guidedPoints) || guidedPoints < 4 || guidedPoints > 8 || !Number.isInteger(guidedSamples) || guidedSamples < 1 || guidedSamples > 8) throw Error("Choose 4–8 levels and 1–8 strikes per level.");
          await client.command(`velocity points ${guidedPoints}`); await client.command(`velocity samples ${guidedSamples}`); await client.command("velocity cal start");
          setVelocityStatus(record(await client.command("velocity status"), "velocity,status,")); setGuided(true); notify("Play the requested strength from softest to hardest. Release between strikes.");
        })}>Start guided calibration</button><button type="button" disabled={!guided || busy} onClick={run(async () => { await client.command("velocity cal cancel"); setGuided(false); await refresh(); notify("Guided calibration cancelled."); })}>Cancel guided calibration</button></div>
        <p className="calHint">Wait for pending edits before starting. Guided calibration updates the board’s attack curve in memory; it does not save automatically.</p>
      </section>
    </>}
    {step === "pressure" && <section className="calCard"><h3>Held-note pressure</h3><p>Pressure is based on travel, not a force measurement. Press and hold the selected key while choosing comfortable start and end depths.</p>
      <div className="calReadings"><strong>{freshPressure ? `${(freshPressure.pressure / 65535 * 100).toFixed(1)}%` : "—"}<small>board pressure</small></strong><strong>{freshPressure ? mm(freshPressure.travel).toFixed(2) : "—"}<small>travel in mm</small></strong></div>
      <meter min={0} max={100} value={freshPressure ? freshPressure.pressure / 65535 * 100 : 0} aria-label="Selected key pressure" />
      <Plot series={[{ label: "Pressure", points: pressureHistory.map(p => ({ ...p, x: p.x - pressureHistory[0].x })) }]} xLabel="Recent time (seconds)" yLabel="Pressure (%)" yRange={[0, 100]} />
      <div className="calFields"><label className="calField"><span>Pressure range</span><select value={config.pressure[0]} disabled={!canEdit} onChange={e => setConfig({ ...config, pressure: config.pressure.map((p, i) => i === 0 ? Number(e.target.value) : p) })}><option value="0">Off</option><option value="1">Total key travel</option><option value="2">Damper zone</option></select></label>
        {config.pressure[0] === 2 && <NumberField label="Damper start" value={Number(mm(config.pressure[1]).toFixed(3))} min={0} max={3.99} step={.01} unit="mm" disabled={!canEdit} onChange={n => setConfig({ ...config, pressure: config.pressure.map((p, i) => i === 1 ? to16(n) : p) })} />}
        {config.pressure[0] > 0 && <NumberField label="100% pressure depth" value={Number(mm(config.pressure[config.pressure[0] === 2 ? 3 : 2]).toFixed(3))} min={.01} max={4} step={.01} unit="mm" disabled={!canEdit} onChange={n => setConfig({ ...config, pressure: config.pressure.map((p, i) => i === (config.pressure[0] === 2 ? 3 : 2) ? to16(n) : p) })} />}</div>
      <div className="calActions"><button type="button" disabled={!canEdit || !freshPressure || config.pressure[0] !== 2} onClick={() => setConfig({ ...config, pressure: config.pressure.map((p, i) => i === 1 ? Math.min(65534, freshPressure!.travel) : p) })}>Use current depth as start</button>
        <button type="button" disabled={!canEdit || !freshPressure || !config.pressure[0]} onClick={() => setConfig({ ...config, pressure: config.pressure.map((p, i) => i === (config.pressure[0] === 2 ? 3 : 2) ? Math.max(1, freshPressure!.travel) : p) })}>Use current depth as end</button></div>
      <p className="calHint">At the current depth, the draft range gives {freshPressure ? pressurePercent(freshPressure.travel, ...config.pressure as [number, number, number, number]).toFixed(1) : "—"}% before the response curve. Pressure clamps at 100% beyond the end depth.</p>
      <h3>Pressure response</h3><p className="calHint">Drag the three intermediate points or enter their output below. Endpoints stay at 0% and 100%.</p>
      <PressureCurveChart points={config.pressureCurve} disabled={!canEdit} onChange={next => setConfig({ ...config, pressureCurve: next })} />
      <div className="calFields">{config.pressureCurve.map((p, i) => <NumberField key={i} label={`${(i + 1) * 25}% travel → output`} value={Number((p / 65535 * 100).toFixed(1))} min={0} max={100} step={.1} unit="%" disabled={!canEdit} onChange={n => setConfig({ ...config, pressureCurve: movePressurePoint(config.pressureCurve, i, n / 100 * 65535) })} />)}</div>
      <div className="calActions"><button type="button" disabled={!canEdit} onClick={() => setConfig({ ...config, pressureCurve: [16384, 32768, 49151] })}>Reset to linear</button></div>
    </section>}
    {step === "diagnostics" && <>
      <section className="calCard"><h3>Capture travel & neighboring sensors</h3><p>Capture the selected key and up to six neighbors. Raw ADC readings and column timestamps are retained; the board’s buffer determines sample spacing.</p>
        <div className="calActions"><button type="button" className="primary" disabled={!canEdit || dirty} onClick={run(captureStrike)}>Capture next strike</button><button type="button" disabled={!capturing} onClick={() => { captureAbort.current = true; }}>Cancel capture</button>
          <button type="button" disabled={!capture} onClick={() => download(`hexboard-key-${capture!.channels[0].key}-capture.json`, capture)}>Export capture</button>
          <label>View <select value={raw ? "raw" : "travel"} onChange={e => setRaw(e.target.value === "raw")}><option value="travel">Travel · mm</option><option value="raw">Raw · ADC</option></select></label></div>
        {channel && <div className="calActions"><button type="button" onClick={() => setRange(null)}>Full strike</button>{(["attack", "release"] as const).map(phase => { const next = capture!.result === 0 ? phaseRange(channel.points, phase, capture!.trigger) : null; return <button type="button" key={phase} disabled={!next} onClick={() => setRange(next)}>{phase === "attack" ? "Attack" : "Release"}</button>; })}
          {[.5, 2].map(factor => <button type="button" key={factor} onClick={() => setRange(scaleRange(range ?? [channel.points[0].time, channel.points.at(-1)!.time], factor, [channel.points[0].time, channel.points.at(-1)!.time]))}>{factor < 1 ? "Zoom in" : "Zoom out"}</button>)}
          {[-1, 1].map(direction => <button type="button" key={`pan-${direction}`} onClick={() => { const current = range ?? [channel.points[0].time, channel.points.at(-1)!.time]; const shift = (current[1] - current[0]) * .25 * direction; setRange(clampRange(current.map(n => n + shift), [channel.points[0].time, channel.points.at(-1)!.time])); }}>{direction < 0 ? "Pan earlier" : "Pan later"}</button>)}</div>}
        <Plot series={channel ? [{ label: "Selected key", points: channel.points.map(p => ({ x: p.time, y: raw ? p.raw : p.mm })) }] : []} xLabel="Time (ms)" yLabel={raw ? "Raw ADC" : "Travel (mm)"} range={range ?? captureBounds}
          onRange={next => channel && setRange(clampRange(next, [channel.points[0].time, channel.points.at(-1)!.time]))}
          lines={channel ? config.thresholds.map((p, i) => ({ value: raw ? rawAt(mm(p), channel) : mm(p), label: ["Start", "End", "Release"][i] })) : []} />
        <p className="calHint">{capture ? `${capture.count} frames · ${capture.channels.length} channels · ${capture.gaps} frame gaps. ${capture.gaps ? "Crossing-time assignment disabled because frames are missing." : crossing ? `Draft crossing time ${(crossing.us / 1000).toFixed(3)} ms.` : "No valid attack crossing in this capture."}` : "Up to 128 pre-trigger frames and 896 following frames. Drag horizontally to zoom."}</p>
        <div className="calActions">{capture?.channels.slice(1).map((ch, i) => <label key={ch.key} style={{ color: chartColors[i + 1] }}><input type="checkbox" checked={!hiddenNeighbors.includes(ch.key)} onChange={e => setHiddenNeighbors(previous => e.target.checked ? previous.filter(k => k !== ch.key) : [...previous, ch.key])} /> Key {ch.key}</label>)}</div>
        <Plot series={capture?.channels.slice(1).filter(ch => !hiddenNeighbors.includes(ch.key)).map((ch, i) => ({ label: `Key ${ch.key}`, color: chartColors[i + 1], points: ch.points.map(p => ({ x: p.time, y: p.delta })) })) ?? []} xLabel="Time (ms)" yLabel="Neighbor ADC change" range={range ?? captureBounds}
          onRange={next => captureBounds && setRange(clampRange(next, captureBounds))} />
      </section>
      <section className="calCard"><h3>Scanner timing</h3><p className="calHint">Normal-play targets: 30 µs settle, at most 893 µs period, 897 µs completed scan, and 0 µs measured jitter. Startup has a one-second warm-up.</p>
        <div className="calActions"><button type="button" disabled={!canEdit} onClick={run(async () => setScan(record(await client.command("scan status"), "scan,")))}>Read timing</button><button type="button" disabled={!canEdit} onClick={run(async () => { const reset = record(await client.command("scan reset"), "scan,"); notify(`Timing window ${reset.epoch} requested. Read timing after scanner acknowledgement; resetting is not evidence that jitter disappeared.`); })}>Start new timing window</button></div>
        {!!scan.period_max_us && <dl className="calStats">{[["Settle", scan.settle_us], ["Max period", scan.period_max_us], ["Max scan", scan.window_scan_max_us], ["Jitter", scan.jitter_pp_us]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value} µs</dd></div>)}<div><dt>Window / intervals</dt><dd>{scan.timing_epoch} / {scan.jitter_samples}</dd></div><div><dt>Overruns / dropped frames</dt><dd>{scan.window_overruns} / {scan.queue_dropped}</dd></div></dl>}
      </section>
      <details className="calCard"><summary>LED interference checks</summary><p>Keep all keys released. Compare an LED-off baseline, controlled loads, and recovery. Start at brightness 4; increasing load is a deliberate electrical test.</p>
        <div className="calFields"><label className="calField"><span>Test</span><select value={ledSuite} disabled={locked} onChange={e => setLedSuite(e.target.value)}><option value="brightness">White brightness sweep</option><option value="patterns">Switching patterns</option></select></label><NumberField label="Maximum brightness" value={ledMax} min={1} max={255} disabled={locked} onChange={setLedMax} /><label className="calField"><span>Measure each stage</span><select value={ledDuration} disabled={locked} onChange={e => setLedDuration(Number(e.target.value))}><option value="2000">2 seconds</option><option value="5000">5 seconds</option></select></label></div>
        <div className="calActions"><button type="button" disabled={!canEdit || dirty} onClick={run(ledTest)}>Run LED check</button><button type="button" disabled={!ledRunning} onClick={() => { ledAbort.current = true; }}>Stop · LEDs off</button><button type="button" disabled={!ledResults.length} onClick={() => download("hexboard-led-check.json", ledResults)}>Export results</button></div>
        {!!ledResults.length && <div className="calTableWrap"><table><thead><tr><th>Load</th><th>Brightness</th><th>Mean shift</th><th>Noise RMS</th><th>Worst key p-p</th><th>Jitter µs</th><th>Frames / gaps</th></tr></thead><tbody>{ledResults.map((result, i) => <tr key={i}><td>{result.pattern}</td><td>{result.brightness}</td><td>{result.mean_delta}</td><td>{Number(result.noise_rms_x100) / 100}</td><td>{result.max_key_pp}</td><td>{result.jitter_pp_us}</td><td>{result.frames} / {result.frame_gaps}</td></tr>)}</tbody></table></div>}
        <p className="calHint">Tests end with LED power off. Firmware expires unattended LED power after ten seconds. Hall statistics reveal interference; they do not measure supply voltage.</p>
      </details>
    </>}
    {step !== "hall" && <section className="calCard calProfile"><div><h3>Save your response</h3><p className="calHint">Profiles store applied velocity models, thresholds, attack/release curves, and pressure settings. Hall measurements are saved separately.</p>{dirty && <p className="calHint">Wait for pending edits before saving. Save stores the board’s acknowledged settings.</p>}</div>
      <div className="calActions"><label className="calField"><span>Board profile</span><select value={profile} disabled={locked} onChange={e => setProfile(Number(e.target.value))}>{[1, 2, 3, 4, 5, 6, 7, 8].map(n => <option key={n}>{n}</option>)}</select></label>
        <button type="button" className="primary" disabled={!canEdit || dirty} onClick={() => requestConfirm(`Save applied settings to profile ${profile}?`, "This writes the board’s current response settings. Release keys; saving briefly pauses scanning.", async () => { await client.command(`velocity save ${profile}`); notify(`Applied settings saved to profile ${profile}.`); })}>Save applied settings</button>
        <button type="button" disabled={!canEdit} onClick={() => requestConfirm(`Load profile ${profile}?`, "This replaces current board settings and any unapplied edits.", async () => { await client.command(`velocity load ${profile}`); await refresh(); notify(`Profile ${profile} loaded.`); })}>Load profile</button>
        <button type="button" disabled={!canEdit} onClick={run(refresh)}>Discard edits & refresh</button>
        <button type="button" disabled={!ready} onClick={() => download("hexboard-response-settings.json", applied)}>Export applied settings</button></div>
      <details className="calDetails"><summary>Erase a saved profile</summary><button type="button" disabled={!canEdit} onClick={() => requestConfirm(`Erase profile ${profile}?`, "This removes the saved profile. Applied settings remain in memory until replaced or restarted.", async () => { await client.command(`velocity erase ${profile}`); notify(`Profile ${profile} erased.`); })}>Erase profile {profile}</button></details>
    </section>}
    {confirm && <div className="calModalBackdrop"><section className="calModal" role="dialog" aria-modal="true" aria-labelledby="cal-confirm-title" onKeyDown={e => {
      if (e.key === "Escape") setConfirm(null);
      if (e.key === "Tab") { const buttons = e.currentTarget.querySelectorAll("button"); const first = buttons[0], last = buttons[buttons.length - 1];
        if (e.shiftKey && e.target === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && e.target === last) { e.preventDefault(); first.focus(); }
      }
    }}><h3 id="cal-confirm-title">{confirm.title}</h3><p>{confirm.text}</p><div className="calActions"><button type="button" autoFocus onClick={() => setConfirm(null)}>Cancel</button><button type="button" className="primary" onClick={() => { const action = confirm.action; setConfirm(null); void perform(action); }}>Confirm</button></div></section></div>}
  </div>;
}
