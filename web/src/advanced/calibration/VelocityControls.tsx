import { engineDescriptions, engineNames, engineMagnitude } from "./engines.mjs";
import { mm, to16 } from "./protocol.mjs";
import { Plot } from "./Charts.tsx";
import type { LabConfig } from "./model.ts";

export function NumberField({ label, value, onChange, min, max, step = 1, unit = "", disabled }: {
  label: string; value: number; onChange: (value: number) => void;
  min?: number; max?: number; step?: number; unit?: string; disabled?: boolean;
}) {
  return <label className="calField"><span>{label}{unit && ` (${unit})`}</span><input type="number" min={min} max={max} step={step}
    value={Number.isFinite(value) ? value : ""} disabled={disabled} onChange={e => onChange(e.target.valueAsNumber)} /></label>;
}
export function VelocityControls({ config, change, disabled, supportsEngines }: {
  config: LabConfig; change: (config: LabConfig) => void; disabled: boolean; supportsEngines: boolean;
}) {
  const kind = config.engine[0];
  const field = (i: number, label: string, min: number, max: number, display?: "depth" | "time", step = 1) =>
    <NumberField key={i} label={label} value={display === "depth" ? mm(config.engine[i]) : display === "time" ? config.engine[i] / 1000 : config.engine[i]}
      min={min} max={max} step={step} unit={display === "depth" ? (i < 6 ? "mm/ms" : "mm") : display === "time" ? "ms" : ""} disabled={disabled}
      onChange={value => change({ ...config, engine: config.engine.map((p, j) => j === i ? display === "depth" ? to16(value) : display === "time" ? Math.round(value * 1000) : value : p) })} />;
  const defaults = (next: number) => {
    const thresholds = next === 0 ? [.48, 2.8, .2] : next === 1 ? [.12, .48, .08] : [.12, .3, .08];
    change({ ...config, engine: [next, 3, 64, 0, to16(.03), to16(.49), to16(.02), to16(1), to16(.1), to16(3), to16(.2), 30000],
      minimum: 1, maximum: 127, thresholds: thresholds.map(to16) });
  };
  const soft = config.engine[kind === 1 ? 4 : kind === 2 ? 6 : 8], hard = config.engine[kind === 1 ? 5 : kind === 2 ? 7 : 9];
  return <section className="calCard">
    <h3>Response model & thresholds</h3>
    <label className="calField"><span>Velocity model</span><select value={kind} disabled={disabled || !supportsEngines}
      onChange={e => defaults(Number(e.target.value))}>{engineNames.map((name, i) => <option key={name} value={i}>{name}</option>)}</select></label>
    <p className="calHint">{engineDescriptions[kind]}</p>
    <div className="calFields">
      {config.thresholds.map((value, i) => <NumberField key={i} label={i === 2 ? "Release" : i === 0 ? kind === 0 ? "Start" : "Arm" : kind === 0 ? "End" : kind === 3 ? "Minimum peak" : "Trigger"}
        value={Number(mm(value).toFixed(3))} min={0} max={4} step={.01} unit="mm" disabled={disabled}
        onChange={n => change({ ...config, thresholds: config.thresholds.map((v, j) => i === j ? to16(n) : v) })} />)}
      {(kind === 1 || kind === 2) && field(1, "Measurement window", 1, 4)}
      {kind === 4 && field(2, "Fixed velocity", 1, 127)}
      {kind === 1 && <>{field(4, "Soft speed", .0001, 4000, "depth", .01)}{field(5, "Hard speed", .0002, 4000, "depth", .01)}</>}
      {kind === 2 && <>{field(6, "Soft distance", 0, 3.99, "depth", .01)}{field(7, "Hard distance", .01, 4, "depth", .01)}</>}
      {kind === 3 && <>{field(8, "Soft peak", 0, 3.99, "depth", .01)}{field(9, "Hard peak", .01, 4, "depth", .01)}
        {field(10, "Release from peak", .01, 4, "depth", .01)}{field(11, "Note duration", 5, 500, "time", 5)}</>}
      {[1, 2, 3].includes(kind) && <>{field(3, "Response shape · 0 linear, 8 curved", 0, 8)}
        <NumberField label="Minimum velocity" value={config.minimum} min={1} max={127} disabled={disabled} onChange={minimum => change({ ...config, minimum })} />
        <NumberField label="Maximum velocity" value={config.maximum} min={1} max={127} disabled={disabled} onChange={maximum => change({ ...config, maximum })} /></>}
    </div>
    {[1, 2, 3].includes(kind) && hard > soft && <Plot xLabel={kind === 1 ? "Speed (mm/ms)" : "Movement (mm)"} yLabel="Draft velocity"
      series={[{ label: "Response", points: Array.from({ length: 41 }, (_, i) => ({ x: mm(hard * i / 40), y: engineMagnitude(hard * i / 40, soft, hard, config.engine[3], config.minimum, config.maximum) })) }]} />}
    <div className="calActions"><button type="button" disabled={disabled} onClick={() => defaults(kind)}>Suggested settings</button></div>
    <p className="calHint">Changes apply automatically after a short pause. Held keys must be released first. Start or Arm must be above Release and below End or Trigger.</p>
  </section>;
}
