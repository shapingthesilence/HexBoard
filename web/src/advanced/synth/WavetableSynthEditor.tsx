import {useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode} from 'react';
import type {MidiTransport} from '../../midi/types.ts';
import {PhysicalSynthClient, type ControllerState, type PhysicalExpression, type PhysicalState} from './client.ts';
import {synthErrorMessage} from './requestError.ts';
import {useEditHistory} from './useEditHistory.ts';
import {useSourcePreview} from './sourcePreview.ts';
import {PerformanceRow} from './PerformanceRow.tsx';
import {ControllerControls} from './ControllerControls.tsx';
import {ModulationBudget} from './ModulationBudget.tsx';
import {ModSourceEditor, modSourceHelp} from './ModSourceEditor.tsx';
import {SynthProgress} from './SynthProgress.tsx';
import type {SynthProgress as Progress} from './progress.ts';
import {Knob, ModSourceButton, modulationCursor} from './SynthControls.tsx';
import {targetingEscape} from './modulationTargeting.ts';
import {RouteChip, RouteMenu, dropDepth, useSourceDrag} from './modulationGestures.tsx';
import {modulationRate, modulationSeconds} from './schema.ts';
import {
  P, S, effectiveWavetable, ensembleNames, factoryWavetablePresets, filterNames, modulatable, option, optionValue, parameterCount,
  resonatorNames, routeDepth, routesUsed, sameWavetable, sourceCount, transientNames, warpAmountDescription, warpNames, wavetableEngine,
  wavetableFromUnknown, wavetableParameters, wavetablePreset, wavetableSourceColors, wavetableSourceShort, wavetableSources, withRoute, bipolarSource, type WavetablePreset
} from './wavetableSchema.ts';
import {filterOpen, wavetableCapacityUs, wavetableCost, wavetableSourceCost, wavetableRouteLimit, type WavetableStage} from './wavetableBudget.ts';
import {EnvelopeGraph, FilterCurve, ResonatorPartials, SignalFlow, TableTerrain, UnisonField, WarpScope} from './WavetableVisuals.tsx';
import './PhysicalSynthEditor.css';
import './WavetableSynthEditor.css';

const draftKey = 'hexboard.wavetable.draft.v1', libraryKey = 'hexboard.wavetable.presets.v1';
export function wavetableDraft(): WavetablePreset {
  try { const raw = localStorage.getItem(draftKey); if (raw) return wavetableFromUnknown(JSON.parse(raw)); } catch { /* Fall back to the first factory sound. */ }
  return factoryWavetablePresets[0];
}
// Browser storage can be unavailable (private windows, tests); nothing here depends on it.
const stored = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const store = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Keep working without persistence. */ } };
function readLibrary(): WavetablePreset[] {
  try { const raw = localStorage.getItem(libraryKey); return raw ? (JSON.parse(raw) as unknown[]).flatMap(p => { try { return [wavetableFromUnknown(p)]; } catch { return []; } }) : []; } catch { return []; }
}
const stageOrder: {id: WavetableStage; label: string}[] = [
  {id: 'oscillator', label: 'Oscillator'}, {id: 'warp', label: 'Warp'}, {id: 'unison', label: 'Unison'}, {id: 'layers', label: 'Layers'},
  {id: 'resonator', label: 'Resonator'}, {id: 'filter', label: 'Filter'}, {id: 'amp', label: 'Amp'}, {id: 'output', label: 'Output'}
];
function modText(id: number, v: number) {
  if (id === 2) return `${Math.round(v / 65535 * 100)}%`;
  if (id === 8) return `${modulationRate(v).toFixed(2)} Hz`;
  if (id === 11) return `${Math.round(v / 65535 * 360)}°`;
  if (id === 15) return `${Math.round(v / 65535 * 500)} ms`;
  if (id === 6) return v < 24000 ? 'Fast rise' : v > 41000 ? 'Slow rise' : 'Linear';
  const t = modulationSeconds(v); return t < 1 ? `${Math.round(t * 1000)} ms` : `${t.toFixed(1)} s`;
}

export function WavetableSynthEditor({transport}: {transport?: MidiTransport}) {
  const {value: preset, set: setPreset, reset: resetPreset, replace: replacePreset, undo, redo, canUndo, canRedo, begin: beginEdit, end: endEdit} = useEditHistory<WavetablePreset>(wavetableDraft, sameWavetable);
  const p = preset.parameters;
  const [client, setClient] = useState<PhysicalSynthClient>();
  const [device, setDevice] = useState<PhysicalState>(), [ready, setReady] = useState(false), [loading, setLoading] = useState(false), [attempt, setAttempt] = useState(0);
  const [message, setMessage] = useState(''), [failed, setFailed] = useState(false), [progress, setProgress] = useState<Progress>(), [operationLabel, setOperationLabel] = useState('Updating synth…');
  const [live, setLive] = useState<PhysicalExpression>(), [controller, setController] = useState<ControllerState>(), [previewPressure, setPreviewPressure] = useState(0);
  const [tool, setTool] = useState<'value' | 'modulate'>('value'), [locked, setLocked] = useState(false), [source, setSource] = useState<number>(S.Pressure);
  const [routeMenu, setRouteMenu] = useState<{target: number; source: number; x: number; y: number}>(), [sourceEditor, setSourceEditor] = useState<number>(), [budgetSource, setBudgetSource] = useState<number>(), [hoverTarget, setHoverTarget] = useState<number>();
  const [library, setLibrary] = useState(readLibrary), [focused, setFocused] = useState<string>();
  const edits = useRef(new Map<string, () => Promise<unknown>>()), flushing = useRef(false), alive = useRef(true), progressRef = useRef<Progress | undefined>(undefined), retainedDraft = useRef(stored(draftKey) !== null);
  const deviceRef = useRef<PhysicalState | undefined>(undefined); deviceRef.current = device;
  const onDevice = ready && device?.instrument === wavetableEngine;
  const fail = (error: unknown) => { const text = synthErrorMessage(error); if (alive.current && text !== undefined) { setFailed(true); setMessage(text); } };

  useEffect(() => store(draftKey, preset), [preset]);
  useEffect(() => {
    let disposed = false, polling = false;
    const c = transport ? new PhysicalSynthClient(transport, value => { if (!disposed) { progressRef.current = value; setProgress(value); if (value) setFailed(false); } }, true) : undefined;
    setClient(c); setReady(false); setLive(undefined); edits.current.clear(); flushing.current = false; alive.current = true;
    if (!c) { setMessage('Offline · edits stay in this browser. Connect HexBoard to play.'); return () => { alive.current = false; }; }
    void (async () => {
      try {
        const state = await c.status(); if (disposed) return;
        setDevice(state); setReady(true); setFailed(false);
        if (state.instrument === wavetableEngine && !retainedDraft.current) { const held = await c.readWavetable(); if (!disposed) resetPreset(wavetablePreset('Device RAM', held.patch)); }
        setMessage(state.instrument === wavetableEngine ? state.state === 'playing' ? 'Wavetable running. Play the keys.' : 'Wavetable selected. Start the synth to play.' : retainedDraft.current ? 'Draft retained. Start synth to hear it.' : 'Start synth to load this sound.');
      } catch (error) { if (!disposed) fail(error); }
    })();
    const poll = setInterval(() => { if (disposed || progressRef.current || flushing.current) return; void c.status().then(s => { if (!disposed) { setDevice(s); setReady(true); } }).catch(error => { if (!disposed) fail(error); }); }, 2000);
    const expression = setInterval(() => { if (polling || disposed || progressRef.current) return; polling = true; void c.expression().then(v => { if (!disposed) setLive(v); }).catch(() => undefined).finally(() => { polling = false; }); }, 60);
    const flush = setInterval(() => {
      if (flushing.current || !edits.current.size) return; flushing.current = true;
      void (async () => {
        try { while (edits.current.size && !disposed) { const [key, update] = edits.current.entries().next().value!; edits.current.delete(key); await update(); } if (!disposed) setFailed(false); }
        catch (error) { if (!disposed) { edits.current.clear(); fail(error); } }
        finally { flushing.current = false; }
      })();
    }, 100);
    return () => { disposed = true; alive.current = false; clearInterval(poll); clearInterval(expression); clearInterval(flush); edits.current.clear(); c.close(); };
  }, [transport, attempt]);
  useEffect(() => { if (tool === 'value') return; return targetingEscape(document, () => { setTool('value'); setLocked(false); setSourceEditor(undefined); }); }, [tool]);
  useEffect(() => {
    const finish = () => endEdit();
    for (const e of ['pointerup', 'pointercancel', 'keyup', 'blur']) window.addEventListener(e, finish);
    return () => { for (const e of ['pointerup', 'pointercancel', 'keyup', 'blur']) window.removeEventListener(e, finish); };
  }, [endEdit]);

  // Live edits reach the board only while it holds the wavetable patch.
  const queue = (key: string, update: () => Promise<unknown>) => { if (client && deviceRef.current?.instrument === wavetableEngine) edits.current.set(key, update); };
  const operation = async (run: () => Promise<PhysicalState>, label: string) => {
    setOperationLabel(label); setFailed(false); setLoading(true);
    try { const state = await run(); if (alive.current) { setDevice(state); setMessage(state.state === 'playing' ? 'Sound updated · play the keys.' : 'Wavetable patch loaded.'); } }
    catch (error) { fail(error); } finally { if (alive.current) setLoading(false); }
  };
  const settle = async () => { edits.current.clear(); while (flushing.current && alive.current) await new Promise(r => setTimeout(r, 15)); };
  const loadOnDevice = (next: WavetablePreset, start: boolean) => client && ready ? operation(async () => {
    await settle(); const state = await client.status();
    if (state.instrument !== wavetableEngine && state.state !== 'stopped') await client.stopAndWait();
    await client.applyWavetable(next);
    return start && (await client.status()).state !== 'playing' ? client.start(wavetableEngine) : client.status();
  }, start ? 'Starting wavetable…' : 'Loading sound…') : Promise.resolve();
  const apply = (next: WavetablePreset) => { retainedDraft.current = true; resetPreset(next); setTool('value'); setLocked(false); setRouteMenu(undefined); if (onDevice) void loadOnDevice(next, false); };
  const restore = (direction: 'undo' | 'redo') => { setRouteMenu(undefined); const next = direction === 'undo' ? undo() : redo(); if (next && onDevice) void loadOnDevice(next, false); };

  const setParameter = (id: number, value: number) => {
    retainedDraft.current = true; setPreset(x => ({...x, parameters: x.parameters.map((v, i) => i === id ? value : v)}));
    queue(`p${id}`, () => client!.editWavetable(id, value));
  };
  const setModSetting = (bank: number, id: number, value: number) => {
    retainedDraft.current = true; setPreset(x => ({...x, mod: x.mod.map((m, b) => b === bank ? m.map((v, i) => i === id ? value : v) : m) as [number[], number[]]}));
    queue(`m${bank}:${id}`, () => client!.editWavetable(parameterCount + bank * 16 + id, value));
  };
  const setRoute = (destination: number, from: number, depth: number) => {
    const result = withRoute(preset, destination, from, depth);
    if (!result) { setFailed(true); setMessage(`All ${wavetableRouteLimit} modulation routes are in use. Delete one to add another.`); return false; }
    if (result.index < 0) return true;
    retainedDraft.current = true; setPreset(x => ({...x, routes: result.patch.routes}));
    const route = result.patch.routes[result.index];
    queue(`r${result.index}`, () => client!.routeWavetable(result.index, route.source, route.destination, route.depth));
    return true;
  };

  // Live modulation sources: connected expression, previewed envelopes/LFOs.
  const env1 = useSourcePreview(preset.mod[0], live), env2 = useSourcePreview(preset.mod[1], live);
  const sources = [...(client && ready ? [(live?.velocity ?? 0) / 127, (live?.pressure ?? 0) / 65535, (live?.release ?? 0) / 127] : [.8, previewPressure / 65535, 0]),
    live?.tiltX ?? 0, live?.tiltY ?? 0, env1[0], env1[1], env2[0], env2[1], controller?.modulation ?? 0, controller?.expression ?? 0];
  const effective = effectiveWavetable(preset, sources);
  const cost = useMemo(() => wavetableCost(preset), [preset]);
  const hoverCost = hoverTarget !== undefined && tool === 'modulate' ? wavetableCost(withRoute(preset, hoverTarget, source, 1)?.patch ?? preset).us : undefined;
  const busy = loading || Boolean(progress) || (!failed && device?.state === 'loading');
  const activity = failed ? undefined : progress ?? (loading ? {label: operationLabel} : undefined);
  const playing = onDevice && device?.state === 'playing';
  const pct = (us: number) => Math.round(us / wavetableCapacityUs * 100);

  /** A source reaches a knob when the parameter accepts it and a route slot is free or already held. */
  const canDrop = (id: number, src: number) => modulatable(id, src) && (routeDepth(preset, id, src) !== 0 || routesUsed(preset) < wavetableRouteLimit);
  const {drag, bind: dragBind, dragged} = useSourceDrag((id, src) => { if (canDrop(id, src) && !routeDepth(preset, id, src)) setRoute(id, src, dropDepth); });
  const highlight = drag?.source ?? budgetSource;
  const control = (id: number, label = wavetableParameters[id].name, describe = wavetableParameters[id].describe): ReactNode => {
    const canRoute = modulatable(id, source), modulating = tool === 'modulate' && canRoute;
    const menu = (i: number, x: number, y: number) => setRouteMenu({target: id, source: i, x, y});
    const routes = preset.routes.filter(r => r.destination === id && r.source < sourceCount && r.depth).map(r => ({label: wavetableSources[r.source], i: r.source, depth: r.depth, color: wavetableSourceColors[r.source], bipolar: bipolarSource(r.source, preset)}));
    const full = modulating && !routeDepth(preset, id, source) && routesUsed(preset) >= wavetableRouteLimit;
    const value = modulating ? routeDepth(preset, id, source) : p[id];
    const why = tool === 'modulate' && !canRoute ? id === P.EnsembleWidth ? 'Ensemble width is shared by all voices · use tilt, joystick or expression' : 'Not modulatable' : full ? `All ${wavetableRouteLimit} routes in use` : undefined;
    const alternate = tool === 'value' && canDrop(id, source) ? {value: routeDepth(preset, id, source), onChange: (d: number) => { setRoute(id, source, d); }} : undefined;
    return <div className="physical-control" key={id} data-mod-target={id} data-drop={drag ? canDrop(id, drag.source) ? 'ok' : 'blocked' : undefined} data-drop-hover={drag?.target === id || undefined}
      data-source-route={highlight === undefined ? undefined : routes.some(r => r.i === highlight) ? 'yes' : 'no'} data-modulatable={canRoute} data-route-full={full || undefined} title={why}
      onPointerEnter={() => setHoverTarget(id)} onPointerLeave={() => setHoverTarget(undefined)}>
      <strong>{label}</strong>
      <div className="knob-wrap">
        <Knob key={modulating ? `route-${source}` : 'value'} label={modulating ? `${wavetableSources[source]} to ${label}` : label} value={value} min={modulating ? -65536 : 0} max={modulating ? 65536 : 65535}
          disabled={busy || full || (tool === 'modulate' && !canRoute)} baseValue={p[id]} effectiveValue={effective[id]} routes={routes}
          onRouteDepth={(i, d) => { setRoute(id, i, d); }} onRouteMenu={menu} alternate={alternate}
          onChange={v => modulating ? setRoute(id, source, Math.round(v)) : setParameter(id, Math.round(v))} onRelease={() => { if (modulating && !locked) setTool('value'); }}/>
      </div>
      <output title={`Live: ${describe(Math.round(effective[id] * 65535))}`}>{modulating ? `${Math.round(value / 65536 * 100)}%` : describe(value)}</output>
      <div className="knob-routes">{routes.map(r => <RouteChip key={r.i} short={wavetableSourceShort[r.i]} label={`${r.label} → ${label}`} color={r.color} depth={r.depth} disabled={busy} onDepth={d => { setRoute(id, r.i, d); }} onMenu={(x, y) => menu(r.i, x, y)}/>)}</div>
    </div>;
  };
  const choice = (id: number, names: readonly string[], label: string, values?: number[]) => <div className="source-tabs wt-choice" role="radiogroup" aria-label={label}>
    {names.map((name, i) => <button type="button" role="radio" key={name} aria-checked={option(id, p[id]) === i} aria-pressed={option(id, p[id]) === i} disabled={busy} onClick={() => setParameter(id, values?.[i] ?? optionValue(id, i))}>{name}</button>)}
  </div>;
  const stage = (id: WavetableStage, title: string, active: boolean, children: ReactNode, note?: string) =>
    <fieldset id={`wt-stage-${id}`} className={`wt-stage wt-stage-${id}`} data-active={active || undefined} data-focused={focused === id || undefined} disabled={busy}>
      <legend>{title}{cost.stages[id] > 0 && <span className="wt-cost" title="Share of the DSP estimate">{pct(cost.stages[id])}%</span>}</legend>
      {note && <p className="panel-note wt-stage-note">{note}</p>}
      {children}
    </fieldset>;

  const copies = option(P.Unison, p[P.Unison]) + 1, warpMode = option(P.WarpMode, p[P.WarpMode]), resonator = option(P.Resonator, p[P.Resonator]), ensemble = option(P.Ensemble, p[P.Ensemble]);
  const filterBypassed = filterOpen(preset);
  const flow = stageOrder.map(s => ({...s, cost: pct(cost.stages[s.id]),
    active: s.id === 'warp' ? warpMode > 0 : s.id === 'unison' ? copies > 1 : s.id === 'layers' ? p[P.Noise] > 0 || p[P.Transient] > 0 : s.id === 'resonator' ? resonator > 0 : s.id === 'filter' ? !filterBypassed : s.id === 'output' ? true : true}));
  const select = (id: string) => { setFocused(id); document.getElementById(`wt-stage-${id}`)?.scrollIntoView({behavior: 'smooth', block: 'nearest'}); window.setTimeout(() => setFocused(f => f === id ? undefined : f), 1200); };
  const editorBank = sourceEditor === undefined ? 0 : sourceEditor === S.Env1 || sourceEditor === S.Lfo1 ? 0 : 1;
  const hint = tool === 'modulate' ? `${wavetableSources[source]}${locked ? ' locked' : ''} → drag knobs · ${locked ? 'click it again or Esc to finish' : 'double-click to lock'}` : `Drag knobs or pictures · drag a source onto a knob · ⌥/Alt-drag adds ${wavetableSourceShort[source]} · drag a route ring or chip for depth`;
  const userNames = new Set(library.map(x => x.name));

  return <section className="card physical-editor wavetable-editor" aria-label="Wavetable synth editor" data-modulating={tool === 'modulate' || undefined}
    data-source-dragging={drag ? true : undefined} data-source-preview={(drag === undefined && budgetSource !== undefined) || undefined}
    style={{'--modulation-cursor': modulationCursor(0, wavetableSourceColors[source], wavetableSourceShort[source]), '--modulation-color': wavetableSourceColors[source], '--highlight-color': wavetableSourceColors[highlight ?? source]} as CSSProperties}
    onPointerDownCapture={() => beginEdit()} onClick={() => endEdit()}
    onKeyDownCapture={e => {
      const text = (e.target as HTMLElement).closest('input:not([type="range"]),textarea,select,[contenteditable="true"]');
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !text && ['z', 'y'].includes(e.key.toLowerCase())) { e.preventDefault(); restore(e.key.toLowerCase() === 'y' || e.shiftKey ? 'redo' : 'undo'); return; }
      if (!e.metaKey && !e.ctrlKey && !e.altKey) beginEdit();
    }}>
    <PerformanceRow transport={transport} disabled={busy}/><ControllerControls transport={transport} disabled={busy} onState={setController}/>

    <div className="modulation-toolbar" role="toolbar" aria-label="Modulation tools">
      <div className="sound-history" role="group" aria-label="Sound edit history"><button type="button" disabled={!canUndo || busy} title="Undo · Ctrl/⌘ Z" onClick={() => restore('undo')}>Undo</button><button type="button" disabled={!canRedo || busy} title="Redo · Ctrl/⌘ Shift Z" onClick={() => restore('redo')}>Redo</button></div>
      <button aria-pressed={tool === 'value'} onClick={() => { setTool('value'); setLocked(false); setSourceEditor(undefined); }}>Edit values</button>
      {wavetableSources.map((label, i) => <ModSourceButton key={label} label={wavetableSourceShort[i]} color={wavetableSourceColors[i]} pressed={tool === 'modulate' && source === i} locked={locked && tool === 'modulate' && source === i}
        title={i < S.Env1 ? modSourceHelp(i) : label} editorOpen={sourceEditor === i} events={{...dragBind(i), onPointerEnter: () => setBudgetSource(i), onPointerLeave: () => setBudgetSource(undefined), onFocus: () => setBudgetSource(i), onBlur: () => setBudgetSource(undefined)}}
        onSelect={lock => { if (dragged()) return; if (!lock && locked && tool === 'modulate' && source === i) { setTool('value'); setLocked(false); return; } setSource(i); setLocked(lock || (locked && tool === 'modulate')); setTool('modulate'); setSourceEditor(v => v === i ? v : undefined); }}
        onEditor={i >= S.Env1 && i <= S.Lfo2 ? () => { setSourceEditor(v => v === i ? undefined : i); } : undefined}/>)}
      <small>{hint}</small>
      <ModulationBudget label="DSP budget" capacity={wavetableCapacityUs} used={cost.us} connections={routesUsed(preset)} connectionLimit={wavetableRouteLimit} projected={hoverCost}
        contribution={budgetSource !== undefined ? wavetableSourceCost(preset, budgetSource) : undefined} blocked={!cost.fits ? 'Over budget · may drop audio' : undefined}/>
      {sourceEditor !== undefined && <ModSourceEditor source={sourceEditor === S.Env1 || sourceEditor === S.Env2 ? 5 : 6} title={wavetableSources[sourceEditor]} settings={preset.mod[editorBank]}
        onChange={(id, v) => setModSetting(editorBank, id, v)} onClose={() => setSourceEditor(undefined)} onAssign={() => { setSource(sourceEditor); setTool('modulate'); setSourceEditor(undefined); }} disabled={busy}
        renderControl={(id, label) => <div className="mod-source-control"><span>{label}</span><Knob label={label} value={preset.mod[editorBank][id]} disabled={busy} onChange={v => setModSetting(editorBank, id, Math.round(v))}/><output>{modText(id, preset.mod[editorBank][id])}</output></div>}/>}
    </div>

    <header className="instrument-title"><h2>Wavetable</h2><span>Stereo · 8 voices + 2 tails · Basic Shapes table</span>{activity ? <SynthProgress progress={activity}/> : <p role="status" className={failed ? 'error' : ''}>{message}</p>}</header>
    <div className="wt-library" role="group" aria-label="Wavetable sounds">
      <select aria-label="Load a sound" value="" disabled={busy} onChange={e => { const [kind, index] = e.target.value.split(':'); const next = kind === 'f' ? factoryWavetablePresets[Number(index)] : library[Number(index)]; if (next) apply(next); }}>
        <option value="">Load a sound…</option>
        <optgroup label="Factory">{factoryWavetablePresets.map((x, i) => <option key={x.name} value={`f:${i}`}>{x.name}</option>)}</optgroup>
        {library.length > 0 && <optgroup label="Saved in this browser">{library.map((x, i) => <option key={x.name} value={`u:${i}`}>{x.name}</option>)}</optgroup>}
      </select>
      <input aria-label="Sound name" value={preset.name} maxLength={80} onChange={e => replacePreset(x => ({...x, name: e.target.value}))}/>
      <button type="button" disabled={!preset.name.trim()} onClick={() => { const saved = {...preset, name: preset.name.trim()}; const next = [...library.filter(x => x.name !== saved.name), saved].sort((a, b) => a.name.localeCompare(b.name)); setLibrary(next); store(libraryKey, next); setFailed(false); setMessage(`Saved “${saved.name}” in this browser.`); }}>{userNames.has(preset.name.trim()) ? 'Update saved' : 'Save'}</button>
      {userNames.has(preset.name.trim()) && <button type="button" onClick={() => { const next = library.filter(x => x.name !== preset.name.trim()); setLibrary(next); store(libraryKey, next); }}>Delete saved</button>}
      <button type="button" onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify(preset, null, 1)], {type: 'application/json'})); const a = document.createElement('a'); a.href = url; a.download = `${preset.name.trim() || 'wavetable'}.json`; a.click(); URL.revokeObjectURL(url); }}>Export</button>
      <label className="wt-import"><input type="file" accept="application/json,.json" onChange={async e => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; try { apply(wavetableFromUnknown(JSON.parse(await file.text()))); } catch (error) { fail(error); } }}/>Import…</label>
    </div>
    <div className="synth-activation" aria-label="Instrument playback">
      <div><strong>{!transport ? 'Connect Advanced to play' : !ready ? 'Synth connection unavailable' : playing ? 'Wavetable running' : device?.state === 'loading' ? 'Starting synth…' : device?.state === 'playing' ? 'Another engine is playing' : 'Synth stopped'}</strong>
        <small>{playing ? 'Edits apply on the next audio block.' : 'Start loads this sound and switches the board to Wavetable.'}</small></div>
      <div className="button-row">
        <button className="synth-start" disabled={!ready || busy || playing} onClick={() => void loadOnDevice(preset, true)}>Start synth</button>
        <button disabled={!ready || busy || device?.state !== 'playing'} onClick={() => void operation(() => client!.stop(), 'Stopping…')}>Stop synth</button>
        {onDevice && <button disabled={busy} onClick={() => void loadOnDevice(preset, false)}>Resend sound</button>}
        {transport && failed && <button onClick={() => setAttempt(v => v + 1)}>Retry synth connection</button>}
      </div>
    </div>

    <SignalFlow stages={flow} subActive={p[P.Sub] > 0} playing={!!live?.held} onSelect={select}/>

    <div className="wt-workspace">
      <div className="wt-stages">
        {stage('oscillator', 'Oscillator', true, <>
          <TableTerrain frame={p[P.Frame] / 65535} live={effective[P.Frame]} spread={effective[P.FrameSpread]} copies={copies} warpMode={warpMode} warpAmount={effective[P.WarpAmount]} brightness={effective[P.Brightness]} disabled={busy || tool !== 'value'} onFrame={v => setParameter(P.Frame, v)}/>
          <div className="knob-bank">{control(P.Frame)}{control(P.FrameSpread)}{control(P.Brightness)}</div>
        </>, 'Scan the table with Frame · pressure moves it by default. Spread fans unison copies across neighbouring frames.')}
        {stage('warp', 'Warp', warpMode > 0, <>
          {choice(P.WarpMode, warpNames, 'Warp mode')}
          <WarpScope mode={warpMode} amount={effective[P.WarpAmount]} frame={effective[P.Frame]} brightness={effective[P.Brightness]}/>
          <div className="knob-bank">{control(P.WarpAmount, warpMode === 4 ? 'Sync ratio' : 'Amount', v => warpAmountDescription(warpMode, v))}{control(P.WarpBias)}</div>
        </>, warpMode ? 'Alias guard trades top-end sparkle for cleaner highs as warp adds harmonics.' : 'Bend the phase for new harmonics without another oscillator.')}
        {stage('unison', 'Unison', copies > 1, <>
          {choice(P.Unison, ['1', '2', '3', '4', '5', '6', '7'], 'Unison voices')}
          <UnisonField copies={copies} detune={effective[P.Detune]} width={effective[P.Width]} spread={effective[P.FrameSpread]}/>
          <div className="knob-bank">{control(P.Detune)}{control(P.Width)}</div>
        </>)}
        {stage('layers', 'Layers', p[P.Noise] > 0 || p[P.Transient] > 0 || p[P.Sub] > 0, <>
          <div className="wt-layer"><div className="knob-bank">{control(P.Noise)}{control(P.Transient, 'Attack transient')}</div>{choice(P.TransientShape, transientNames, 'Transient shape')}</div>
          <div className="wt-layer wt-sub"><div className="knob-bank">{control(P.Sub)}</div>{choice(P.SubOctave, ['−1 oct', '−2 oct'], 'Sub octave')}{choice(P.SubShape, ['Sine', 'Triangle'], 'Sub shape')}<small>Clean sub skips the resonator, filter and ensemble.</small></div>
        </>)}
        {stage('resonator', 'Resonator', resonator > 0, <>
          {choice(P.Resonator, resonatorNames, 'Resonator')}
          <ResonatorPartials mode={resonator} tune={effective[P.ResonatorTune]} decay={effective[P.ResonatorDecay]} mix={effective[P.ResonatorMix]}/>
          <div className="knob-bank">{control(P.ResonatorMix, 'Mix')}{control(P.ResonatorTune)}{control(P.ResonatorDecay)}</div>
        </>, resonator ? 'The transient and noise excite it hardest · try Pressure → Ring.' : undefined)}
        {stage('filter', 'Filter', !filterBypassed, <>
          {choice(P.FilterMode, filterNames, 'Filter mode')}
          <FilterCurve cutoff={p[P.Cutoff] / 65535} resonance={p[P.Resonance] / 65535} mode={option(P.FilterMode, p[P.FilterMode])} live={effective[P.Cutoff]} disabled={busy || tool !== 'value'} onChange={(c, r) => { setParameter(P.Cutoff, c); setParameter(P.Resonance, r); }}/>
          <div className="knob-bank">{control(P.Cutoff)}{control(P.Resonance)}{control(P.KeyTrack)}{control(P.FilterEnvelope, 'Env 1 amount')}</div>
        </>, filterBypassed ? 'Fully open · bypassed to save DSP.' : 'Per voice, stereo. Envelope 1 moves the cutoff by Env 1 amount.')}
        {stage('amp', 'Amp', true, <>
          <EnvelopeGraph values={[p[P.AmpAttack], p[P.AmpDecay], p[P.AmpSustain], p[P.AmpRelease]]} disabled={busy || tool !== 'value'} onChange={(i, v) => setParameter(P.AmpAttack + i, v)}/>
          <div className="knob-bank">{control(P.AmpAttack)}{control(P.AmpDecay)}{control(P.AmpSustain)}{control(P.AmpRelease)}</div>
        </>)}
        {stage('output', 'Output', true, <>
          {choice(P.Ensemble, ensembleNames, 'Ensemble')}
          <div className="knob-bank">{control(P.EnsembleWidth, 'Width')}{control(P.Level)}</div>
          <small>{ensemble ? `${ensemble === 1 ? 'Two' : 'Four'} modulated delay taps thicken every voice for one fixed cost.` : 'Ensemble off.'} Sub joins after the ensemble.</small>
        </>)}
      </div>
      <aside className="wt-side">
        <fieldset className="wt-sources"><legend>Motion sources</legend>
          {[S.Env1, S.Lfo1, S.Env2, S.Lfo2].map(i => { const bank = i <= S.Lfo1 ? 0 : 1, lfo = i === S.Lfo1 || i === S.Lfo2, count = preset.routes.filter(r => r.source === i && r.depth).length;
            return <button type="button" key={i} className="wt-source-card" style={{'--source-color': wavetableSourceColors[i]} as CSSProperties} aria-pressed={sourceEditor === i}
              {...dragBind(i)} onPointerEnter={() => setBudgetSource(i)} onPointerLeave={() => setBudgetSource(undefined)} onClick={() => { if (dragged()) return; setSource(i); setTool('modulate'); setSourceEditor(v => v === i ? undefined : i); }}>
              <span className="wt-source-name">{wavetableSources[i]}</span><span className="wt-source-meter"><i style={{width: `${Math.abs(sources[i]) * 100}%`, marginLeft: lfo && sources[i] < 0 && !preset.mod[bank][14] ? `${50 + sources[i] * 50}%` : undefined}}/></span>
              <small>{lfo ? `${modulationRate(preset.mod[bank][8]).toFixed(2)} Hz` : `${modText(0, preset.mod[bank][0])} · ${modText(1, preset.mod[bank][1])}`} · {count} route{count === 1 ? '' : 's'}</small>
            </button>; })}
        </fieldset>
        <fieldset className="wt-expression"><legend>Expression</legend>
          <p className="panel-note">{client && ready ? live?.key == null ? 'Play a key to see its pressure.' : `Key ${live.key} · ${live.held ? 'held' : 'released'}` : 'Offline preview'}</p>
          {wavetableSources.map((label, i) => <div className="source-meter" key={label}><span className="wt-meter-label" style={{borderColor: wavetableSourceColors[i]}}>{wavetableSourceShort[i]}</span><meter aria-label={`${label} meter`} min={bipolarSource(i, preset) ? -1 : 0} max={1} value={sources[i]}/><output>{Math.round(sources[i] * 100)}%</output></div>)}
          {!client && <div className="physical-control"><strong>Pressure preview</strong><Knob label="Pressure preview" value={previewPressure} onChange={setPreviewPressure}/></div>}
        </fieldset>
        <p className="panel-note wt-budget-note">DSP estimate {cost.us} µs of {wavetableCapacityUs} µs per block, fitted to measured 8-voice workloads. Advisory: going over may drop audio, nothing is switched off for you.</p>
      </aside>
    </div>
    {drag && <div className="mod-drag-ghost" data-blocked={(drag.target !== undefined && !canDrop(drag.target, drag.source)) || undefined} style={{left: drag.x + 14, top: drag.y + 14, borderColor: wavetableSourceColors[drag.source]}}><span className="source-dot" style={{background: wavetableSourceColors[drag.source]}}/>{wavetableSourceShort[drag.source]}</div>}
    {routeMenu && routeDepth(preset, routeMenu.target, routeMenu.source) !== 0 && <RouteMenu title={`${wavetableSources[routeMenu.source]} → ${wavetableParameters[routeMenu.target].name}`} color={wavetableSourceColors[routeMenu.source]}
      depth={routeDepth(preset, routeMenu.target, routeMenu.source)} x={routeMenu.x} y={routeMenu.y} onDepth={d => { setRoute(routeMenu.target, routeMenu.source, d); }} onClose={() => setRouteMenu(undefined)}/>}
  </section>;
}
