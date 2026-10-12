import { useEffect, useRef, useState } from "react";
import { advancedNoteSurface } from "../../midi/boardContext.ts";
import type { PressureSample } from "./model.ts";
import { CapStudy, defaultCaps, defaultStudySettings, parseCaps, studyCsv } from "./capStudy.ts";
import { Plot, chartColors } from "./Charts.tsx";

function save(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function CapStudyPanel({ sample, available, onTarget, onActive, boardLabel }: {
  sample: PressureSample | null; available: boolean; onTarget: (key: number) => void; onActive: (active: boolean) => void; boardLabel: string;
}) {
  const [keys, setKeys] = useState<number[]>([]), [caps, setCaps] = useState(defaultCaps.join(", "));
  const [settings, setSettings] = useState(defaultStudySettings), [study, setStudy] = useState<CapStudy | null>(null);
  const [message, setMessage] = useState(""), [, render] = useState(0);
  const targetCallback = useRef(onTarget), activeCallback = useRef(onActive);
  targetCallback.current = onTarget; activeCallback.current = onActive;
  const active = Boolean(study?.active), update = () => render(n => n + 1);
  useEffect(() => { activeCallback.current(active); return () => activeCallback.current(false); }, [active]);
  useEffect(() => { if (study?.active) targetCallback.current(study.key); }, [study, study?.key]);
  useEffect(() => {
    if (!study || !sample || !available) return;
    study.push(sample, performance.now()); update();
  }, [sample, study, available]);
  useEffect(() => { if (!available && study?.active) { study.pause(); update(); } }, [available, study]);
  const current = study?.active ? study : null;
  const instructions = current ? {
    cap: `Fit the ${current.distance.toFixed(1)} mm cap. Confirm when ready to measure key ${current.key}.`,
    zero: `Key ${current.key}: fit the 0 mm cap, then click Cap in place. Hold it steady.`,
    release: `Key ${current.key}: release the key first. Then press firmly against the ${current.distance.toFixed(1)} mm cap.`,
    hold: `Key ${current.key}: hold the cap firmly and steadily at ${current.distance.toFixed(1)} mm.`,
    collect: `Key ${current.key}: sampling ${current.collecting.length}/${current.settings.blocks * current.settings.samplesPerBlock}. Keep holding…`,
    paused: "Paused. Progress is retained. Resume with the current cap to repeat the unfinished key.",
    done: "Complete."
  }[current.phase] : study ? study.results.length === study.keys.length * study.caps.length ? "All caps and keys complete. Export your measurements." : "Study stopped. Export the measurements collected so far." : "Select any number of keys on the board, then start the study.";
  return <section className="calCard"><h3>Fixed-distance cap study</h3>
    <p>Measure every selected key with 0 mm first, then every key with 0.2 mm, and continue cap by cap. Stable raw ADC readings are averaged automatically.</p>
    {!active && <><p><strong>{keys.length} keys selected</strong> · measurement order follows your selections.</p>
      <div className="calKeyGrid" aria-label="Select keys for the cap study">{advancedNoteSurface.map(k => <button type="button" key={k.hallKey} aria-pressed={keys.includes(k.hallKey)}
        style={{ gridRow: k.row + 1, gridColumn: k.coordCol + 2 }} onClick={() => setKeys(old => old.includes(k.hallKey) ? old.filter(n => n !== k.hallKey) : [...old, k.hallKey])}>{k.hallKey}</button>)}</div>
      <div className="calActions"><button type="button" onClick={() => setKeys([])}>Clear selected keys</button><span>{keys.join(", ") || "No keys selected"}</span></div>
      <label className="calField">Cap distances (mm, in order)<input value={caps} onChange={e => setCaps(e.target.value)} /></label>
      <details className="calDetails"><summary>Stability and averaging</summary><div className="calFields">{([
        ["steadyMs", "Steady time (ms)", 500, 10000], ["tolerance", "Maximum variation (ADC counts)", 1, 64],
        ["blocks", "Averaging blocks", 1, 10], ["samplesPerBlock", "Samples per block", 3, 50]
      ] as const).map(([field, label, min, max]) => <label className="calField" key={field}>{label}<input type="number" min={min} max={max} value={settings[field]} onChange={e => setSettings(old => ({ ...old, [field]: Number(e.target.value) }))} /></label>)}</div></details></>}
    <div className="calStatus" role="status">{instructions}</div>
    {message && <p role="alert">{message}</p>}
    {current && <><div className="calReadings"><strong>{current.distance?.toFixed(1)} mm<small>Cap {current.capIndex + 1} of {current.caps.length}</small></strong>
      <strong>Key {current.key}<small>{current.keyIndex + 1} of {current.keys.length}</small></strong><span>{sample?.key === current.key ? `Raw ADC ${sample.raw}` : "Waiting for the selected key…"}</span></div>
      <ul className="capKeyProgress" aria-label="Keys at this cap">{current.keys.map(k => <li key={k} data-current={k === current.key}>{current.results.some(r => r.key === k && r.distanceMm === current.distance) ? "✓ Done" : k === current.key ? "→ Current" : "Pending"} · Key {k}</li>)}</ul></>}
    <div className="calActions">
      {!active && <button type="button" className="primary" disabled={!available || !keys.length} onClick={() => {
        try { const next = new CapStudy(keys, parseCaps(caps), settings); setStudy(next); setMessage(""); } catch (error) { setMessage((error as Error).message); }
      }}>{study ? "Start a new study" : "Start cap study"}</button>}
      {current?.phase === "cap" && <button type="button" className="primary" disabled={!available} onClick={() => { current.confirmCap(); update(); }}>Start this cap</button>}
      {current?.phase === "zero" && <button type="button" className="primary" disabled={!available} onClick={() => { current.confirmZero(); update(); }}>Cap in place</button>}
      {current?.phase === "paused" ? <button type="button" disabled={!available} onClick={() => { current.resume(); update(); }}>Resume study</button>
        : current && <button type="button" onClick={() => { current.pause(); update(); }}>Pause study</button>}
      {study && <button type="button" disabled={!available || !study.results.length} onClick={() => { study.retryPrevious(); update(); }}>Redo last completed key</button>}
      {current && <button type="button" onClick={() => { current.stop(); update(); }}>End study and keep results</button>}
      <button type="button" disabled={!study?.results.length} onClick={() => study && save("hexboard-cap-study.json", JSON.stringify({ version: 1, board: boardLabel, exportedAt: new Date().toISOString(), keys: study.keys, capsMm: study.caps, settings: study.settings, phase: study.phase, results: study.results }, null, 2), "application/json")}>Export all samples (JSON)</button>
      <button type="button" disabled={!study || !study.caps.some(distance => study.keys.every(key => study.results.some(r => r.key === key && r.distanceMm === distance)))} onClick={() => study && save("hexboard-cap-study.csv", studyCsv(study), "text/csv")}>Export complete cap rows (CSV)</button>
    </div>
    {study && <><p>{study.results.length} of {study.keys.length * study.caps.length} key/cap measurements complete.</p>
      <Plot xLabel="Fixture cap distance (mm)" yLabel="Mean raw ADC" series={study.keys.map((key, i) => ({ label: `Key ${key}`, color: chartColors[i % chartColors.length], points: study.results.filter(r => r.key === key).map(r => ({ x: r.distanceMm, y: r.mean })) }))} />
      <div className="calTableWrap"><table><thead><tr><th>Cap (mm)</th><th>Key</th><th>Mean ADC</th><th>Peak-to-peak</th><th>Std. deviation</th><th>Samples</th></tr></thead><tbody>{study.results.map(r => <tr key={`${r.key}:${r.distanceMm}`}><td>{r.distanceMm.toFixed(2)}</td><td>{r.key}</td><td>{r.mean.toFixed(2)}</td><td>{r.peakToPeak}</td><td>{r.stddev.toFixed(2)}</td><td>{r.samples.length}</td></tr>)}</tbody></table></div></>}
    <p className="calHint">Use released neighbors and firm contact with the cap. Steadiness does not verify actual fixture distance. Samples are fresh live snapshots, not consecutive scanner frames. Data stays in this page until exported; export before leaving or starting another study. JSON includes partial rows and individual samples; CSV includes only completed cap rows. No Hall calibration or LUT is changed.</p>
  </section>;
}
