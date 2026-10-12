import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { MidiTransport } from "../../midi/types.ts";
import { PhysicalSynthClient, type PhysicalState, type PhysicalExpression } from "./client.ts";
import { effectTypes, effectDescription, type FxRack, factoryPhysicalPresets, initialPreset, physicalParameters, physicalSources, physicalPresetFromUnknown, effectiveParameters, velocityEngines, type PhysicalVelocityEngine, type PhysicalPreset } from "./schema.ts";
import "./PhysicalSynthEditor.css";
import { modulationRings, knobRingPoint } from "./modulationRing.ts";

const sourceColors = ["#efb86b", "#5cdac6", "#b29aff", "#70b8ff", "#ef8eb8"];
const sourceShortNames = ["Strike", "Pressure", "Release", "X tilt", "Y tilt"];

function modulationCursor(source: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="104" height="32"><path d="M2 2v20l5-6 5 10 4-2-5-9h9z" fill="${sourceColors[source]}" stroke="#14212b" stroke-width="2"/><rect x="22" y="8" width="80" height="22" rx="5" fill="#14212b" stroke="${sourceColors[source]}"/><text x="62" y="23" text-anchor="middle" font-family="sans-serif" font-size="11" fill="${sourceColors[source]}">${sourceShortNames[source]}</text></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 2 2, crosshair`;
}

const storageKey = "hexboard.physical.library.v1", draftKey = "hexboard.physical.draft.v1";
function readDraft(): PhysicalPreset | undefined {
  try { const raw = window.localStorage.getItem(draftKey); return raw ? physicalPresetFromUnknown(JSON.parse(raw)) : undefined; } catch { return undefined; }
}
function library(): PhysicalPreset[] {
  try { const saved: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]"); return Array.isArray(saved) ? saved.map(physicalPresetFromUnknown) : []; } catch { return []; }
}
function Knob({ label, value, min = 0, max = 65535, disabled, onChange, onRelease, baseValue, effectiveValue, routes = [] }: { label: string; value: number; min?: number; max?: number; disabled?: boolean; onChange: (value: number) => void; onRelease?: () => void; baseValue?: number; effectiveValue?: number; routes?: { label: string; i: number; depth: number }[] }) {
  const base = baseValue === undefined ? (value-min)/(max-min) : baseValue/65535;
  const liveDot = knobRingPoint(effectiveValue ?? base, 34);
  const drag = useRef<{ y: number; value: number } | null>(null);
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  const changed = useRef(false);
  const change = (next: number) => { if (next !== value) { changed.current = true; onChange(next); } };
  const finish = () => { drag.current = null; if (changed.current) { changed.current = false; onRelease?.(); } };
  return <div className="physical-knob" role="slider" tabIndex={disabled ? -1 : 0} aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-disabled={disabled}
    onPointerDown={e => { if (disabled || e.button !== 0) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); changed.current = false; drag.current = { y: e.clientY, value }; }}
    onPointerMove={e => { if (drag.current && e.currentTarget.hasPointerCapture(e.pointerId)) change(clamp(drag.current.value + (drag.current.y - e.clientY) * (max-min) / (e.shiftKey ? 1600 : 160))); }}
    onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); finish(); }}
    onPointerCancel={finish} onLostPointerCapture={finish} onBlur={finish}
    onKeyDown={e => { if (!disabled && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(e.key)) { e.preventDefault(); change(clamp(e.key === 'Home' ? min : e.key === 'End' ? max : value + (['ArrowUp','ArrowRight'].includes(e.key) ? 1 : -1) * (max-min)/(e.shiftKey ? 1000 : 100))); } }} onKeyUp={finish}>
    <svg className="knob-rings" viewBox="0 0 72 72" aria-hidden="true">
      {routes.flatMap(r => modulationRings(r.depth, 26 + r.i * 2, base, r.i >= 3).map((arc, side) => { const depth = side === 0 ? r.depth : -r.depth; return <g key={`${r.i}:${side}`} style={{ color: sourceColors[r.i] }} data-source={r.label} data-depth={r.depth}>
        <title>{`${r.label}: ${r.depth > 0 ? "+" : ""}${Math.round(r.depth / 65536 * 100)}%`}</title>
        <path d={arc.path} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M -2 -2 L 1 0 L -2 2" fill="none" stroke="currentColor" strokeWidth="1.5" transform={`translate(${arc.x} ${arc.y}) rotate(${arc.angle + (depth < 0 ? 180 : 0)})`} />
      </g>; }))}
      {routes.length > 0 && <circle className="modulation-position" cx={liveDot.x} cy={liveDot.y} r="2.6" fill="#f4fbff" stroke="#15232e" strokeWidth="1" data-value={effectiveValue ?? base} />}
    </svg>
    <span className="knob-face"><span className="knob-pointer" style={{ transform: `rotate(${-135 + 270 * (baseValue === undefined ? (value-min)/(max-min) : baseValue/65535)}deg)` }} /></span>
  </div>;
}
export function PhysicalSynthEditor({ transport }: { transport?: MidiTransport }) {
  const [client, setClient] = useState<PhysicalSynthClient>();
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [draft] = useState(readDraft), retainedDraft = useRef(Boolean(draft));
  const [preset, setPreset] = useState<PhysicalPreset>(() => draft ?? physicalPresetFromUnknown(initialPreset));
  const [saved, setSaved] = useState(library), [name, setName] = useState(preset.name), [selection, setSelection] = useState(0);
  const [device, setDevice] = useState<PhysicalState>(), [ready, setReady] = useState(false), [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("Build your sound here. Connect Advanced to hear the physical model."), [failed, setFailed] = useState(false);
  const [bend, setBend] = useState(0), [source, setSource] = useState(1);
  const [tool, setTool] = useState<"value" | "modulate" | "delete">("value");
  const [deleteTarget, setDeleteTarget] = useState<number>();
  const [live, setLive] = useState<PhysicalExpression>(), [previewPressure, setPreviewPressure] = useState(0);
  const edits = useRef(new Map<string, () => Promise<PhysicalState>>()), flushing = useRef(false), alive = useRef(true);
  const [addingFx,setAddingFx]=useState(false), [dragFx,setDragFx]=useState<number>();
  const [fxWaiting,setFxWaiting]=useState(false);
  const fxTimer=useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(()=>{clearTimeout(fxTimer.current);setFxWaiting(false);return ()=>clearTimeout(fxTimer.current);},[client]);
  const presets = [...factoryPhysicalPresets, ...saved];
  const fail = (error: unknown) => { if (alive.current) { setFailed(true); setMessage(error instanceof Error ? error.message : "Could not update the instrument."); } };
  useEffect(() => { try { window.localStorage.setItem(draftKey, JSON.stringify({ ...preset, name: name.trim() || preset.name })); } catch { /* Save reports storage errors. */ } }, [preset, name]);
  useEffect(() => {
    let disposed = false, polling = false;
    let lastState: PhysicalState["state"] | undefined;
    // Each effect setup owns a fresh client: StrictMode cleans up and starts
    // effects again, and a closed client must never be reused after reconnect.
    const client = transport ? new PhysicalSynthClient(transport) : undefined;
    setClient(client);
    alive.current = true; setReady(false); setLive(undefined); edits.current.clear(); flushing.current = false;
    if (!client) return () => { alive.current = false; };
    void client.read().then(state => {
      if (disposed) return;
      lastState = state.state; setDevice(state); if (!retainedDraft.current) setPreset({ ...state.preset, name });
      setBend(state.bend); setReady(true); setFailed(false);
      setMessage(retainedDraft.current ? "Draft retained. Preview draft to hear it, or load Pressure Sweep for the new pressure mapping." : "Connected. Play a key to see pressure move the pickup.");
    }).catch(error => { if (!disposed) fail(error); });
    const poll = setInterval(() => { void client.read().then(state => {
      if (disposed) return;
      setDevice(state); setReady(true);
      if (lastState !== state.state) {
        setFailed(false);
        setMessage(state.state === "playing" ? "Synth running. Play the keys." : state.state === "loading" ? "Preparing the instrument…" : "Synth stopped. Choose Start synth to play.");
      }
      lastState = state.state;
    }).catch(error => { if (!disposed) fail(error); }); }, 2000);
    const expression = setInterval(() => {
      if (polling || disposed) return; polling = true;
      void client.expression().then(value => { if (!disposed) setLive(value); }).catch(error => { if (!disposed) fail(error); }).finally(() => { polling = false; });
    }, 50);
    const flush = setInterval(() => {
      if (flushing.current || !edits.current.size) return; flushing.current = true;
      void (async () => {
        try {
          while (edits.current.size && !disposed) {
            const [key, update] = edits.current.entries().next().value!; edits.current.delete(key);
            const state = await update();
            if (!disposed) { setDevice(state); setFailed(false); setMessage("Sound updated in instrument RAM."); }
          }
        } catch (error) { if (!disposed) { edits.current.clear(); fail(error); } }
        finally { if (!disposed) flushing.current = false; }
      })();
    }, 100);
    return () => { disposed = true; alive.current = false; clearInterval(poll); clearInterval(expression); clearInterval(flush); edits.current.clear(); client.close(); };
  }, [transport, connectionAttempt]);
  const queue = (key: string, update: () => Promise<PhysicalState>) => { if (client && ready) edits.current.set(key, update); };
  const operation = async (run: () => Promise<PhysicalState>) => {
    setLoading(true);
    try { const state = await run(); if (alive.current) { setDevice(state); setFailed(false); setMessage(state.state === "loading" ? "Preparing the instrument…" : "Sound updated in instrument RAM."); } }
    catch (error) { fail(error); } finally { if (alive.current) setLoading(false); }
  };
  const apply = async (value: PhysicalPreset) => {
    retainedDraft.current = true; edits.current.clear(); clearTimeout(fxTimer.current);setFxWaiting(false); setDeleteTarget(undefined);
    setPreset(physicalPresetFromUnknown(value)); setName(value.name);
    if (client && ready) await operation(() => client.apply(value));
  };
  const setEffects=(effects:FxRack)=>{
    retainedDraft.current=true;setPreset(p=>({...p,effects}));
    clearTimeout(fxTimer.current);edits.current.delete("fx");
    setFxWaiting(Boolean(client&&ready));
    fxTimer.current=setTimeout(()=>{setFxWaiting(false);queue("fx",()=>client!.effects(effects));},1000);
  };
  const moveEffect=(id:number,before:number,after=false)=>{
    const order=preset.effects.order.filter(v=>v!==id);order.splice(order.indexOf(before)+(after?1:0),0,id);
    setEffects({...preset.effects,order});
  };
  const setParameter = (id: number, value: number) => {
    retainedDraft.current = true;
    setPreset(p => ({ ...p, parameters: p.parameters.map((v, i) => i === id ? value : v) }));
    queue(`p${id}`, () => client!.parameter(id, value));
  };
  const setRoute = (id: number, which: number, value: number) => {
    retainedDraft.current = true;
    if(which>=3){setPreset(p=>({...p,tiltRoutes:p.tiltRoutes.map((v,i)=>i===id*2+which-3?value:v)}));queue(`t${id}:${which}`,()=>client!.tiltRoute(id,which-3,value));}
    else {setPreset(p => ({ ...p, routes: p.routes.map((v, i) => i === id * 3 + which ? value : v) }));queue(`r${id}:${which}`, () => client!.route(id, which, value));}
  };
  const changeVelocityEngine = (kind: PhysicalVelocityEngine) => {
    retainedDraft.current = true;
    setPreset(p => ({ ...p, velocityEngine: kind }));
    if (client && ready) void operation(() => client.velocityEngine(kind));
  };
  const changeBend = (value: number) => { setBend(value); queue("bend", () => client!.bend(value)); };
  const busy = loading || device?.state === "loading";
  const sources = client && ready ? [live?.velocity ?? 0, live?.pressure ?? 0, live?.release ?? 0].map((v, i) => v / (i === 1 ? 65535 : 127)) : [0.8, previewPressure / 65535, 0];
  sources.push(live?.tiltX??0,live?.tiltY??0);
  const effective = effectiveParameters(preset, sources);
  const pickup = 0.05 + 0.9 * effective[5], rightPickup = 0.05 + 0.9 * effective[14];
  const bowMode=preset.parameters[21]>32767;
  const showBowPad=bowMode;
  const marbleMode = Math.round(preset.parameters[8]*4/65535)===4;
  const dropCenter=.05+.9*effective[18], dropRadius=.45*effective[19];
  const pluck = 0.05 + 0.9 * preset.parameters[4] / 65535;
  const position = (id: number) => 30 + (0.05 + 0.9 * preset.parameters[id] / 65535) * 540;
  const dragPosition = (event: React.PointerEvent<SVGGElement>, id: number) => {
    if (busy) return;
    const svg = event.currentTarget.ownerSVGElement!;
    const transform = svg.getScreenCTM(); if (!transform) return;
    const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
    const x = point.matrixTransform(transform.inverse()).x;
    setParameter(id, Math.round(Math.max(0, Math.min(1, ((x - 30) / 540 - .05) / .9)) * 65535));
  };
  const handle = (id: number, label: string, y: number, color: string) => <g key={id} className="string-handle" role="slider" tabIndex={busy ? -1 : 0} aria-label={label} aria-valuemin={5} aria-valuemax={95} aria-valuenow={Math.round(5 + 90 * preset.parameters[id] / 65535)} aria-disabled={busy}
    onPointerDown={event => { if (!busy) { event.currentTarget.setPointerCapture(event.pointerId); dragPosition(event, id); } }}
    onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) dragPosition(event, id); }}
    onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onKeyDown={event => { if (!busy && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); const step = event.shiftKey ? 6554 : 1311; setParameter(id, event.key === "Home" ? 0 : event.key === "End" ? 65535 : Math.max(0, Math.min(65535, preset.parameters[id] + (event.key === "ArrowRight" ? step : -step)))); } }}>
    <rect x={position(id)-20} y={y-20} width={40} height={40} rx={12} fill="transparent" />
    <circle cx={position(id)} cy={y} r={id === 4 ? 8 : 7} fill={color} stroke="#16271f" strokeWidth={2} />
    <text x={position(id)} y={y + (id === 4 || id === 18 ? -15 : 25)} textAnchor="middle" fill="currentColor" fontSize={12}>{label}</text>
  </g>;
  const materialMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setParameter(6, Math.round(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * 65535));
    setParameter(1, Math.round(Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) * 65535));
  };
  const strikerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect=e.currentTarget.getBoundingClientRect();
    setParameter(showBowPad?23:2,Math.round(Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width))*65535));
    setParameter(showBowPad?22:12,Math.round((1-Math.max(0,Math.min(1,(e.clientY-rect.top)/rect.height)))*65535));
  };
  const marbleMaterialMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect=e.currentTarget.getBoundingClientRect();
    setParameter(24,Math.round(Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width))*65535));
    setParameter(25,Math.round((1-Math.max(0,Math.min(1,(e.clientY-rect.top)/rect.height)))*65535));
  };
  const control = (id: number) => {
    const p = physicalParameters[id], unavailable = id===29 && bowMode, modulatable = !unavailable && ![7,8,21,27,28,30].includes(id);
    const routes = physicalSources.map((label, i) => ({ label, i, depth: i<3?preset.routes[id*3+i]:preset.tiltRoutes[id*2+i-3] })).filter(r => r.depth !== 0);
    const modulating = tool === "modulate" && modulatable;
    const value = modulating ? (source<3?preset.routes[id*3+source]:preset.tiltRoutes[id*2+source-3]) : preset.parameters[id];
    return <div className="physical-control" key={id} data-modulatable={modulatable}>
      <strong>{p.name}</strong>
      <div className="knob-wrap" onClick={() => { if (tool !== "delete" || busy) return; if (routes.length === 1) setRoute(id, routes[0].i, 0); else if (routes.length > 1) setDeleteTarget(deleteTarget === id ? undefined : id); }}>
        <Knob label={modulating ? `${physicalSources[source]} to ${p.name}` : p.name} value={value} min={modulating ? -65536 : 0} max={modulating ? 65536 : 65535} disabled={busy || unavailable || tool === "delete"} baseValue={preset.parameters[id]} effectiveValue={effective[id]} routes={routes}
          onChange={v => modulating ? setRoute(id, source, Math.round(v)) : setParameter(id, Math.round(v))} onRelease={() => { if (modulating) setTool("value"); }} />
        {tool === "delete" && routes.length > 0 && <button className="delete-knob" aria-label={`Delete modulation from ${p.name}`}>×</button>}
      </div>
      <output title={`${"strike" in p ? "Next strike" : "Live"}: ${p.describe(Math.round(effective[id]*65535))}`}>{modulating ? `${Math.round(value/65536*100)}%` : p.describe(value)}</output>
      <div className="knob-routes">{routes.map(r => <span key={r.i} style={{ color: sourceColors[r.i] }} title={`${r.label}: ${Math.round(r.depth/65536*100)}%`}>{sourceShortNames[r.i]} {r.depth > 0 ? "+" : ""}{Math.round(r.depth/65536*100)}%</span>)}</div>
      {deleteTarget === id && tool === "delete" && <div className="mod-delete-menu" role="menu" aria-label={`Delete ${p.name} modulation`}>{routes.map(r => <button role="menuitem" key={r.i} onClick={() => { setRoute(id,r.i,0); setDeleteTarget(undefined); }}>Delete {r.label}</button>)}</div>}

    </div>;
  };
  return <section className="card physical-editor" data-modulating={tool === "modulate" || undefined} style={{ "--modulation-cursor": modulationCursor(source) } as CSSProperties} aria-label="Physical string editor">
    <div className="modulation-toolbar" role="toolbar" aria-label="Modulation tools">
      <button aria-pressed={tool === "value"} onClick={() => { setTool("value"); setDeleteTarget(undefined); }}>Edit values</button>
      {physicalSources.map((label,i) => <button key={label} style={{ borderColor: sourceColors[i] }} aria-pressed={tool === "modulate" && source === i} onClick={() => { setSource(i); setTool("modulate"); setDeleteTarget(undefined); }}><span className="source-dot" style={{ background: sourceColors[i] }} />{label}</button>)}
      <button aria-pressed={tool === "delete"} onClick={() => { setTool("delete"); setDeleteTarget(undefined); }}>Delete modulation</button>
      <small>{tool === "modulate" ? source >= 3 ? `${physicalSources[source]} ±45° → drag a knob · Neutral uses the base value; negative depth reverses direction` : `${physicalSources[source]} → drag a knob · Release to return to Edit values` : tool === "delete" ? "Click a modulated knob; choose a source if it has several" : "Drag knobs up / down · Shift for fine adjustment"}</small>
    </div>
    <header className="instrument-title"><h2>Physical Strings</h2><span>8 voices · stereo</span><p role="status" className={failed ? "error" : ""}>{message}</p></header>
    <fieldset className="preset-strip" disabled={busy}><legend>Presets</legend><div className="preset-controls">
      <label>Preset <select value={selection} onChange={e => setSelection(Number(e.target.value))}>{presets.map((p, i) => <option value={i} key={`${i}:${p.name}`}>{p.name}</option>)}</select></label><button onClick={() => void apply(presets[selection])}>Load preset</button>
      <label>Name <input maxLength={80} value={name} onChange={e => setName(e.target.value)} /></label>
      <button onClick={() => { try { const p = physicalPresetFromUnknown({ ...preset, name }); const next = [...saved.filter(v => v.name !== p.name), p]; window.localStorage.setItem(storageKey, JSON.stringify(next)); setSaved(next); setSelection(factoryPhysicalPresets.length + next.length - 1); setMessage("Preset saved on this computer."); setFailed(false); } catch (error) { fail(error); } }}>Save on computer</button>
      <button onClick={() => { try { const p = physicalPresetFromUnknown({ ...preset, name }); const url = URL.createObjectURL(new Blob([JSON.stringify(p, null, 2)], { type: "application/json" })); const a = document.createElement("a"); a.href = url; a.download = `${p.name.replace(/[^a-z0-9_-]/gi, "_")}.physical.json`; a.click(); URL.revokeObjectURL(url); } catch (error) { fail(error); } }}>Export preset</button>
      <label>Import preset <input type="file" accept=".json,application/json" onChange={e => { const file = e.target.files?.[0]; if (!file) return; void file.text().then(text => apply(physicalPresetFromUnknown(JSON.parse(text)))).catch(fail); e.target.value = ""; }} /></label>
    </div></fieldset>
    <div className="synth-activation" aria-label="Instrument playback">
      <div><strong>{!transport ? "Connect Advanced to play" : !ready ? "Synth connection unavailable" : device?.state === "loading" ? "Starting synth…" : device?.state === "playing" ? "Synth running" : "Synth stopped"}</strong>
        <small>{!transport ? "Use Connect HexBoard above, then start the synth here." : !ready ? "Waiting for the synth controls. Retry if the connection was interrupted." : device?.state === "playing" ? "Play the keys. Preview draft applies your current sound." : "Start loads your current draft and enables the instrument’s audio."}</small></div>
      <div className="button-row">
        <button className="synth-start" disabled={!ready || busy || !client || device?.state === "playing"} onClick={() => { edits.current.clear(); void operation(async () => { await client!.apply({ ...preset, name }); return client!.start(); }); }}>{busy ? "Starting synth…" : "Start synth"}</button>
        <button disabled={!ready || busy || !client || device?.state !== "playing"} onClick={() => void operation(() => client!.stop())}>Stop synth</button>
        {client && <button disabled={!ready || busy} onClick={() => void apply({ ...preset, name })}>Preview draft</button>}
        {transport && failed && <button onClick={() => setConnectionAttempt(value => value + 1)}>Retry synth connection</button>}
      </div>
    </div>
    <div className="physical-workspace"><div className="instrument-workspace">
    <div className="physical-grid compact-shaping"><fieldset className="material-panel exciter-panel" disabled={busy}><legend>Exciter</legend>


        <div className="material-body"><div className="material-surface"><div className="exciter-mode" role="radiogroup" aria-label="Excitation mode">{["Strike","Bow"].map((label,i)=><label key={label} className={(bowMode?1:0)===i?"selected":""}><input type="radio" name="physical-exciter-mode" value={i} checked={(bowMode?1:0)===i} onChange={()=>setParameter(21,i*65535)} />{label}</label>)}</div><div className="material-axes"><span>{showBowPad?"Slow / creak":"Rubber"}</span><span>{showBowPad?"Fast / scrape →":"Steel →"}</span></div>
        <div className="material-pad" role="slider" tabIndex={busy ? -1 : 0} aria-label={showBowPad?"Bow character":"Striker material"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(preset.parameters[showBowPad?23:2]/65535*100)} aria-valuetext={showBowPad?`${Math.round(preset.parameters[23]/65535*100)} percent speed, ${Math.round(preset.parameters[22]/65535*100)} percent force`:`${Math.round(preset.parameters[2]/65535*100)} percent hardness, ${Math.round(preset.parameters[12]/65535*100)} percent resonance`}
          onPointerDown={e=>{if(!busy){e.currentTarget.setPointerCapture(e.pointerId);strikerMove(e);}}}
          onPointerMove={e=>{if(!busy && e.currentTarget.hasPointerCapture(e.pointerId))strikerMove(e);}}
          onPointerUp={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}
          onKeyDown={e=>{if(busy)return;const horizontal=e.key==="ArrowLeft"||e.key==="ArrowRight";const axis=showBowPad?(horizontal?23:22):(horizontal?2:12); if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key)){e.preventDefault();setParameter(axis,Math.max(0,Math.min(65535,preset.parameters[axis]+(e.key==="ArrowRight"||e.key==="ArrowUp"?1:-1)*(e.shiftKey?6554:1311))));}}}>
          <span className="material-label" style={{top:8}}>{showBowPad?"Firm / grip":"Ringing"}</span><span className="material-label" style={{bottom:8}}>{showBowPad?"Light / slip":"Dead"}</span>
          <span className="material-dot" style={{left:`${preset.parameters[showBowPad?23:2]/65535*100}%`,top:`${100-preset.parameters[showBowPad?22:12]/65535*100}%`}} />
          {showBowPad && <span className="material-live-dot" aria-hidden="true" style={{left:`${effective[23]*100}%`,top:`${100-effective[22]*100}%`}} />}
        </div>
        </div><div className="physical-grid mini-controls">{(showBowPad?[23,22]:[2,12]).map(control)}</div></div>


      </fieldset>
      <fieldset className="material-panel resonator-panel" disabled={busy}><legend>Resonator</legend>
        <div className="material-body"><div className="material-surface"><div className="material-context"><span>Stiffness × loss</span></div><div className="material-axes"><span>Soft string</span><span>Stiff / metallic →</span></div>
        <div className="material-pad" role="slider" tabIndex={busy ? -1 : 0} aria-label="String material" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(preset.parameters[6] / 65535 * 100)} aria-valuetext={`${Math.round(preset.parameters[6] / 65535 * 100)} percent stiffness, ${Math.round(preset.parameters[1] / 65535 * 100)} percent loss`}
          onPointerDown={e => { if (!busy) { e.currentTarget.setPointerCapture(e.pointerId); materialMove(e); } }}
          onPointerMove={e => { if (!busy && e.currentTarget.hasPointerCapture(e.pointerId)) materialMove(e); }}
          onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
          onKeyDown={e => { if (busy) return; const delta = e.shiftKey ? 6554 : 1311; const axis = e.key === "ArrowLeft" || e.key === "ArrowRight" ? 6 : 1; if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) { e.preventDefault(); setParameter(axis, Math.max(0, Math.min(65535, preset.parameters[axis] + (e.key === "ArrowRight" || e.key === "ArrowDown" ? delta : -delta)))); } }}>
          <span className="material-label" style={{ top: 8 }}>Ringing</span><span className="material-label" style={{ bottom: 8 }}>Lossy</span>
          <span className="material-dot" style={{ left: `${preset.parameters[6] / 65535 * 100}%`, top: `${preset.parameters[1] / 65535 * 100}%` }} />
        </div>
        </div><div className="physical-grid mini-controls">{[6,1].map(control)}</div></div>


      </fieldset>
      <fieldset className="spatial-panel" disabled={busy}><legend>String · drag the strike and pickups</legend>
      <svg className="string-view" viewBox={marbleMode ? "0 -32 600 177" : "0 0 600 145"} role="group" aria-label="String positions">
        <path d={`M30 82 L${30 + pluck * 540} 40 L570 82`} fill="none" stroke="currentColor" strokeWidth="2" opacity=".45" />
        <line x1="30" x2="570" y1="82" y2="82" stroke="currentColor" />
        <line x1={30 + pickup * 540} x2={30 + pickup * 540} y1="64" y2="104" stroke="#73c6ae" strokeDasharray="3 3" opacity=".7" />
        <line x1={30 + rightPickup * 540} x2={30 + rightPickup * 540} y1="70" y2="115" stroke="#a4a2e6" strokeDasharray="3 3" opacity=".7" />
        {marbleMode && <><line x1={30+540*Math.max(.05,dropCenter-dropRadius)} x2={30+540*Math.min(.95,dropCenter+dropRadius)} y1="0" y2="0" stroke="#b9d6f0" strokeWidth="8" opacity=".4" />{handle(18,"Drop center",0,"#b9d6f0")}</>}{handle(4, "Strike", 40, "#d7ac68")}{handle(5, "Pickup L", 75, "#73c6ae")}{handle(14, "Pickup R", 106, "#a4a2e6")}
        <text x="30" y="99" fill="currentColor" fontSize="11">Nut</text><text x="570" y="99" textAnchor="end" fill="currentColor" fontSize="11">Bridge</text>
      </svg>
      <div className="pickup-readout"><span>Strike {Math.round(pluck*100)}%</span><span>L {Math.round(pickup*100)}% · R {Math.round(rightPickup*100)}%</span></div>
      <div className="physical-grid mini-controls">{[4,5,14,15].map(control)}</div>
    </fieldset>

    </div>
    <div className="performance-grid">
    <fieldset disabled={busy}><legend>Excitation</legend>
      <label className="velocity-engine-control">Velocity engine
        <select aria-label="Velocity engine" value={preset.velocityEngine} onChange={e => changeVelocityEngine(Number(e.target.value) as PhysicalVelocityEngine)}>
          {velocityEngines.map(engine => <option key={engine.id} value={engine.id}>{engine.name}</option>)}
        </select>
      </label>
      <p className="engine-hint">{velocityEngines[preset.velocityEngine].hint} · {preset.velocityEngine === 0 ? "Damper pressure" : preset.velocityEngine === 3 ? "No pressure" : "Full-travel pressure"}</p>
      <div className="source-tabs" role="group" aria-label="Strike shape" aria-disabled={bowMode} title="Strike shapes apply to the initial note attack">{["Normal","Felt","Double","Scrape"].map((label,i)=><button key={label} disabled={bowMode} aria-pressed={Math.round(preset.parameters[28]*3/65535)===i} onClick={()=>setParameter(28,i*21845)}>{label}</button>)}</div>
      <p className="panel-note">{bowMode?"Bow starts from rest. Pressure controls force; speed moves from creaking drag through singing to scrape.":"Strike energy follows key velocity. Shape impacts in the Exciter pad."}</p>
    </fieldset>
    <fieldset disabled={busy}><legend>Contact</legend>
      <div className="source-tabs" aria-label="Contact mode">{["Off", "Bounce", "Rattle", "Mute", "Marbles"].map((mode, index) => <button key={mode} aria-pressed={Math.round(preset.parameters[8]*4/65535) === index} onClick={() => setParameter(8,Math.round(index*65535/4))}>{mode}</button>)}</div>
      {marbleMode && <div className="contact-material"><div className="material-surface"><div className="material-axes"><span>Rubber</span><span>Steel →</span></div><div className="material-pad" role="slider" tabIndex={busy?-1:0} aria-label="Marble material" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(preset.parameters[24]/65535*100)} aria-valuetext={`${Math.round(preset.parameters[24]/65535*100)} percent hardness, ${Math.round(preset.parameters[25]/65535*100)} percent resonance`}
        onPointerDown={e=>{if(!busy){e.currentTarget.setPointerCapture(e.pointerId);marbleMaterialMove(e);}}} onPointerMove={e=>{if(!busy&&e.currentTarget.hasPointerCapture(e.pointerId))marbleMaterialMove(e);}} onPointerUp={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}
        onKeyDown={e=>{if(busy)return;const axis=e.key==="ArrowLeft"||e.key==="ArrowRight"?24:25;if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key)){e.preventDefault();setParameter(axis,Math.max(0,Math.min(65535,preset.parameters[axis]+(e.key==="ArrowRight"||e.key==="ArrowUp"?1:-1)*(e.shiftKey?6554:1311))));}}}><span className="material-label" style={{top:8}}>Ringing</span><span className="material-label" style={{bottom:8}}>Dead</span><span className="material-dot" style={{left:`${preset.parameters[24]/65535*100}%`,top:`${100-preset.parameters[25]/65535*100}%`}} /></div></div><div className="physical-grid mini-controls">{[24,25].map(control)}</div></div>}
      <div className="knob-bank">{(marbleMode ? [16,17,18,19,20] : [16,9,10,11,13]).map(control)}</div>
    </fieldset>
    <fieldset className="response-panel" disabled={busy}><legend>String response</legend><div className="knob-bank">{control(0)}{control(3)}{control(26)}{control(29)}</div><div className="source-tabs" role="group" aria-label="Drive behavior">{["Original","Gentle"].map((name,i)=><button type="button" key={name} aria-pressed={(preset.parameters[30]>32767?1:0)===i} title={i?"Preserve quieter string motion; shape stronger peaks":"Original saturation curves with matched output level"} onClick={()=>setParameter(30,i*65535)}>{name}</button>)}</div><div className="source-tabs drive-characters" role="group" aria-label="Saturation character">{["Warm","Edge","Fold"].map((name,i)=><button type="button" key={name} aria-pressed={Math.round(preset.parameters[27]*2/65535)===i} onClick={()=>setParameter(27,Math.round(i*65535/2))}>{name}</button>)}</div><p className="panel-note">Drive acts inside the string · Preparation is Strike-only · release sampled on key lift</p></fieldset>
    </div>
    <div className="monitor-grid">
    <fieldset className="expression-panel" disabled={busy}><legend>Expression</legend>
      <p className="panel-note">Tilt X ± {((live?.tiltX??0)*45).toFixed(1)}° · Y {((live?.tiltY??0)*45).toFixed(1)}° · {live?.motionValid?"Live":live?.motionDetected?"Waiting for valid gravity":"Connect for tilt"} {client&&ready&&<button disabled={busy||!live?.motionValid} onClick={()=>void operation(async()=>{await client.zeroMotion();return client.read();})}>Set tilt neutral</button>}</p>
      <p className="panel-note">{client && ready ? live?.key === null || live?.key === undefined ? "Play a calibrated key to see its pressure." : `Latest played key: ${live.key} · ${live.held ? "held" : "released"}` : "Preview pressure offline; connect to see live key expression."}</p>
      {physicalSources.map((label, i) => <div className="source-meter" key={label}><span>{sourceShortNames[i]}</span><meter aria-label={`${label} meter`} min={i<3?0:-1} max={1} value={sources[i]} /><output>{i<3?`${Math.round(sources[i]*100)}%`:`${Math.round(sources[i]*45)}°`}</output></div>)}
      {!client && <label className="physical-control">Pressure preview<Knob label="Pressure preview" value={previewPressure} onChange={setPreviewPressure} /></label>}
    </fieldset>
    <fieldset className="output-panel" disabled={busy}><legend>Output</legend>{control(7)}<small>Stereo limiter active<br />Before volume rocker</small>
        {client && <label className="physical-control">Global bend: {bend.toFixed(2)} semitones<Knob label="Global pitch bend" min={-2} max={2} value={bend} disabled={!ready || busy || device?.state !== "playing"} onChange={changeBend} onRelease={() => changeBend(0)} /><button onClick={() => changeBend(0)} disabled={!ready || device?.state !== "playing"}>Center bend</button></label>}
      </fieldset>
    </div>
    </div><aside className="fx-rack" aria-label="Effect rack">
      <header><h3>FX rack</h3><button aria-label="Add effect" disabled={busy||preset.effects.order.length===effectTypes.length} onClick={()=>setAddingFx(!addingFx)}>＋</button></header>
      <small>{fxWaiting?"Applying after adjustments settle…":"Signal flows from top to bottom"}</small>
      {addingFx && <div className="fx-add-menu">{effectTypes.filter(f=>!preset.effects.order.includes(f.id)).map(f=><button key={f.id} onClick={()=>{setEffects({...preset.effects,order:[...preset.effects.order,f.id]});setAddingFx(false);}}>{f.name}</button>)}</div>}
      {!preset.effects.order.length && <p className="panel-note">Add an effect to shape your sound.</p>}
      {preset.effects.order.map((id,index)=>{const f=effectTypes[id-1];return <section className={`fx-card ${dragFx===id?"dragging":""}`} key={id} data-effect={id} onDragOver={e=>{if(dragFx!==undefined)e.preventDefault();}} onDrop={e=>{e.preventDefault();if(dragFx!==undefined&&dragFx!==id)moveEffect(dragFx,id);setDragFx(undefined);}}>
        <header onPointerDown={e=>{if(busy || (e.target as HTMLElement).closest("button"))return;setDragFx(id);e.currentTarget.setPointerCapture(e.pointerId);}} onPointerUp={e=>{if(!e.currentTarget.hasPointerCapture(e.pointerId))return;e.currentTarget.releasePointerCapture(e.pointerId);const target=document.elementFromPoint(e.clientX,e.clientY)?.closest("[data-effect]");const before=Number(target?.getAttribute("data-effect"));if(before&&before!==id){const rect=target!.getBoundingClientRect();moveEffect(id,before,e.clientY>rect.top+rect.height/2);}setDragFx(undefined);}} onPointerCancel={()=>setDragFx(undefined)} onDragStart={e=>{setDragFx(id);e.dataTransfer.setData("text/plain",String(id));e.dataTransfer.effectAllowed="move";}} onDragEnd={()=>setDragFx(undefined)}><span className="fx-grip" aria-hidden="true">⠿</span><strong>{f.name}</strong>
          <button aria-label={`Move ${f.name} up`} disabled={busy||index===0} onClick={()=>moveEffect(id,preset.effects.order[index-1])}>↑</button>
          <button aria-label={`Move ${f.name} down`} disabled={busy||index===preset.effects.order.length-1} onClick={()=>{const order=[...preset.effects.order];[order[index],order[index+1]]=[order[index+1],order[index]];setEffects({...preset.effects,order});}}>↓</button>
          <button aria-label={`Remove ${f.name}`} disabled={busy} onClick={()=>setEffects({...preset.effects,order:preset.effects.order.filter(v=>v!==id)})}>×</button>
        </header><div className="fx-controls">{f.controls.map((label,param)=><div className="physical-control" key={label}><strong>{label}</strong><Knob label={`${f.name} ${label}`} value={preset.effects.values[id-1][param]} disabled={busy} onChange={value=>{const values=preset.effects.values.map(row=>[...row]);values[id-1][param]=Math.round(value);setEffects({...preset.effects,values});}}/><output>{effectDescription(id,param,preset.effects.values[id-1][param])}</output></div>)}</div>
      </section>;})}
      <footer className="panel-note">One of each effect · limiter after rack</footer>
    </aside></div>
    <p className="editor-footnote">Pressure range: Calibration · Presets saved on this computer · Rings: clockwise + / counterclockwise −</p>
  </section>;
}
