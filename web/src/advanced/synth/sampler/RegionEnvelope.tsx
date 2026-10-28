import { useEffect, useRef, useState } from "react";
import type { Settings, Zone } from "./prepare.mjs";
import { defaults } from "./encode.mjs";

export const envelopeKeys = ["attack", "decay", "sustain", "release"] as const;
type EnvelopeKey = typeof envelopeKeys[number];
export function regionEnvelope(zone: Zone, settings: Settings) {
  return Object.fromEntries(envelopeKeys.map(key => [key, zone[key] ?? settings[key] ?? defaults[key]])) as Record<EnvelopeKey, number>;
}
export function changeRegionEnvelope(zones: Zone[], index: number, change: Partial<Zone>, all: boolean) {
  const envelope = Object.fromEntries(envelopeKeys.filter(key => change[key] !== undefined).map(key => [key, change[key]]));
  return zones.map((zone, i) => all || i === index ? { ...zone, ...envelope } : zone);
}
const position = (value: number, maximum: number) => Math.log1p(value) / Math.log1p(maximum);

function EnvelopeControl({ name, value, maximum, mixed, onChange }: {
  name: EnvelopeKey; value: number; maximum: number; mixed: boolean;
  onChange: (value: number, remember: boolean) => void;
}) {
  const percent = name === "sustain", shown = percent ? value * 100 : value;
  const display = (number: number) => String(percent ? Math.round(number * 10) / 10 : Math.round(number));
  const [draft, setDraft] = useState(mixed ? "" : display(shown));
  const focus = useRef(false), gesture = useRef(false), skipBlur = useRef(false);
  useEffect(() => { if (!focus.current) setDraft(mixed ? "" : display(shown)); }, [shown, mixed]);
  const commit = () => {
    focus.current = false;
    const number = Number(draft);
    if (draft.trim() && Number.isFinite(number)) {
      const next = Math.max(0, Math.min(maximum, percent ? Math.round(number * 10) / 10 : Math.round(number)));
      if (mixed || next !== shown) onChange(percent ? next / 100 : next, true);
      setDraft(String(next));
    } else setDraft(mixed ? "" : display(shown));
  };
  const finish = () => { gesture.current = false; };
  const label = name[0].toUpperCase() + name.slice(1);
  return <div className="sampler-envelope-control">
    <label>{label}
      <input aria-label={`Region ${label.toLowerCase()}`} type="range" min={0} max={1000} step={1}
        value={percent ? shown * 10 : Math.round(position(shown, maximum) * 1000)}
        aria-valuetext={mixed ? "Mixed values" : `${Math.round(shown)} ${percent ? "percent" : "milliseconds"}`}
        onChange={event => {
          const n = +event.target.value;
          const next = percent ? n / 10 : Math.expm1(n / 1000 * Math.log1p(maximum));
          onChange(percent ? next / 100 : next, !gesture.current); gesture.current = true;
        }} onPointerDown={finish} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onKeyUp={finish} onBlur={finish}/>
    </label>
    <div className="sampler-envelope-value">
      <input aria-label={`Region ${name} ${percent ? "percent" : "ms"}`} type="text" inputMode="decimal" value={draft} placeholder={mixed ? "Mixed" : undefined}
        onFocus={() => { focus.current = true; }} onChange={event => setDraft(event.target.value)} onBlur={() => { if (skipBlur.current) skipBlur.current = false; else commit(); }}
        onKeyDown={event => {
          if (event.key === "Enter") { event.preventDefault(); skipBlur.current = true; commit(); event.currentTarget.blur(); }
          if (event.key === "Escape") { skipBlur.current = true; setDraft(mixed ? "" : display(shown)); focus.current = false; event.currentTarget.blur(); }
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault(); const step = event.shiftKey ? 10 : 1;
            const current = draft.trim() && Number.isFinite(Number(draft)) ? Number(draft) : shown;
            const next = Math.max(0, Math.min(maximum, current + (event.key === "ArrowUp" ? step : -step)));
            onChange(percent ? next / 100 : next, true); setDraft(String(Math.round(next)));
          }
        }}/><span>{percent ? "%" : "ms"}</span>
    </div>
  </div>;
}

export function RegionEnvelope({ zones, index, names, settings, onSelect, onChange }: {
  zones: Zone[]; index: number; names: string[]; settings: Settings;
  onSelect: (index: number) => void;
  onChange: (change: Partial<Zone>, all: boolean, remember: boolean) => void;
}) {
  const [all, setAll] = useState(false), zone = zones[index];
  if (!zone) return null;
  const values = regionEnvelope(zone, settings), sustain = 54 - values.sustain * 44;
  const attack = 15 + position(values.attack, 10000) * 70, decay = attack + 15 + position(values.decay, 20000) * 70;
  const release = decay + 50 + 15 + position(values.release, 20000) * 70;
  return <fieldset className="sampler-envelope"><legend>Region ADSR</legend>
    <div className="sampler-envelope-heading">
      <select aria-label="Envelope region" value={index} onChange={event => onSelect(+event.target.value)}>
        {zones.map((z, i) => <option key={i} value={i}>{i + 1}. {names[z.asset] ?? "Recording"} · velocity {z.velocityLow ?? 1}–{z.velocityHigh ?? 127}</option>)}
      </select>
      <label><input type="checkbox" checked={all} onChange={event => setAll(event.target.checked)}/>Edit all regions</label>
      <button disabled={zones.length < 2} onClick={() => onChange(values, true, true)}>Copy ADSR to all</button>
    </div>
    <svg viewBox={`0 0 ${release + 12} 64`} role="img" aria-label="ADSR envelope shape">
      <path d={`M 5 54 L ${attack} 10 L ${decay} ${sustain} L ${decay + 50} ${sustain} L ${release} 54`}/>
    </svg>
    <div className="sampler-envelope-controls">
      {envelopeKeys.map(key => <EnvelopeControl key={`${index}:${key}`} name={key} value={values[key]} maximum={key === "sustain" ? 100 : key === "attack" ? 10000 : 20000}
        mixed={all && zones.some(z => regionEnvelope(z, settings)[key] !== values[key])}
        onChange={(value, remember) => onChange({ [key]: value }, all, remember)}/>)}
    </div>
  </fieldset>;
}
