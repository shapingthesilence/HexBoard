import {CurvedEnvelope} from './CurvedEnvelope.tsx';
import {curveBend, curveWord} from './envelopeCurve.ts';
import {factoryTables} from './wavetable/factory.ts';
import {WavetableImporter} from './WavetableImporter.tsx';
import {getTable,listTables,putTable,exportTable,importTable,type TableAsset,type TableRef} from './wavetable/library.ts';
import {FxRackEditor} from './FxRackEditor.tsx';
import {useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode} from 'react';
import type {MidiTransport} from '../../midi/types.ts';
import {PhysicalSynthClient, type PhysicalState} from './client.ts';
import {synthErrorMessage} from './requestError.ts';
import {useAutosave} from '../../editor/useAutosave.ts';
import {writeStoredText} from '../../editor/autosave.ts';
import {useEditHistory} from './useEditHistory.ts';
import {wavetableDraft, wavetableDraftKey as draftKey} from './editorDraft.ts';
import {startVisibleAnimation} from '../../animation.ts';
import {WavetablePreview} from './wavetablePreview.ts';
import {PreviewNote, PreviewContext, PreviewSource, PreviewValues} from './SynthVisualPreview.tsx';
import {PerformanceRow} from './PerformanceRow.tsx';
import {ControllerControls} from './ControllerControls.tsx';
import {ModulationBudget} from './ModulationBudget.tsx';
import {ModSourceEditor, modSourceHelp, timeValue} from './ModSourceEditor.tsx';
import {SynthProgress} from './SynthProgress.tsx';
import type {SynthProgress as Progress} from './progress.ts';
import {Knob, ModSourceButton, modulationCursor} from './SynthControls.tsx';
import {targetingEscape, sourceClickTool} from './modulationTargeting.ts';
import {RouteChip, RouteMenu, dropDepth, useSourceDrag} from './modulationGestures.tsx';
import {type FxRack,modulationRate, modulationSeconds} from './schema.ts';
import {
  P, S, modSettingCount, factoryWavetablePresets, filterNames, modulatable, option, optionValue, parameterCount,
  resonatorNames, tableCrc, routeDepth, routesUsed, sameWavetable, sourceCount, transientNames, warpAmountDescription, warpNames, wavetableEngine,
  wavetableFromUnknown, wavetableParameters, wavetablePreset, wavetableSourceColors, wavetableSourceShort, wavetableSources, withRoute, bipolarSource, type WavetablePreset
} from './wavetableSchema.ts';
import {filterOpen, wavetableCapacityUs, wavetableCost, wavetableSourceCost, wavetableRouteLimit, type WavetableStage} from './wavetableBudget.ts';
import {FilterCurve, ResonatorPartials, SignalFlow, TableTerrain, UnisonField, WarpScope} from './WavetableVisuals.tsx';
import './PhysicalSynthEditor.css';
import './SynthIdentity.css';
import './WavetableSynthEditor.css';

const libraryKey = 'hexboard.wavetable.presets.v3';
// Browser storage can be unavailable (private windows, tests); nothing here depends on it.
const stored = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const store = (key: string, value: unknown) => { try { writeStoredText(localStorage, key, JSON.stringify(value)); } catch { /* Keep working without persistence. */ } };
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
  const [tables,setTables]=useState<TableRef[]>([]),[selectedTable,setSelectedTable]=useState<TableAsset>(),[importing,setImporting]=useState<'new'|'edit'|undefined>();
  useEffect(()=>{void listTables().then(setTables).catch(()=>undefined);},[]);
  useEffect(()=>{let disposed=false;setSelectedTable(undefined);if(preset.table)void getTable(preset.table.id).then(t=>{if(!disposed)setSelectedTable(t);}).catch(error=>{if(!disposed)fail(error);});return()=>{disposed=true;};},[preset.table?.id]);
  const p = preset.parameters;
  const root = useRef<HTMLElement>(null);
  const [preview] = useState(() => new WavetablePreview(preset));
  const [client, setClient] = useState<PhysicalSynthClient>();
  const [device, setDevice] = useState<PhysicalState>(), [ready, setReady] = useState(false), [loading, setLoading] = useState(false), [attempt, setAttempt] = useState(0);
  const [message, setMessage] = useState(''), [failed, setFailed] = useState(false), [progress, setProgress] = useState<Progress>(), [operationLabel, setOperationLabel] = useState('Updating synth…');
  const [previewPressure, setPreviewPressure] = useState(0);
  const [tool, setTool] = useState<'value' | 'modulate'>('value'), [locked, setLocked] = useState(false), [source, setSource] = useState<number>(S.Pressure);
  const [routeMenu, setRouteMenu] = useState<{target: number; source: number; x: number; y: number}>(), [sourceEditor, setSourceEditor] = useState<number>(), [budgetSource, setBudgetSource] = useState<number>(), [hoverTarget, setHoverTarget] = useState<number>();
  const [library, setLibrary] = useState(readLibrary), [focused, setFocused] = useState<string>();
  const edits = useRef(new Map<string, () => Promise<unknown>>()), flushing = useRef(false), alive = useRef(true), progressRef = useRef<Progress | undefined>(undefined), retainedDraft = useRef(stored(draftKey) !== null);
  const deviceRef = useRef<PhysicalState | undefined>(undefined); deviceRef.current = device;
  const onDevice = ready && device?.instrument === wavetableEngine;
  const fail = (error: unknown) => { const text = synthErrorMessage(error); if (alive.current && text !== undefined) { setFailed(true); setMessage(text); } };

  useAutosave(() => store(draftKey, preset), [preset]);
  useEffect(() => preview.configure(preset, !!client && ready, previewPressure), [preview, preset, client, ready, previewPressure]);
  useEffect(() => startVisibleAnimation(root.current!, preview.advance), [preview]);
  useEffect(() => {
    let disposed = false, polling = false, statusPolling = true;
    const c = transport ? new PhysicalSynthClient(transport, value => { if (!disposed) { progressRef.current = value; setProgress(value); if (value) setFailed(false); } }, true) : undefined;
    setClient(c); setReady(false); preview.setExpression(); preview.setController(); edits.current.clear(); flushing.current = false; alive.current = true;
    if (!c) { setMessage('Offline · edits stay in this browser. Connect HexBoard to play.'); return () => { alive.current = false; }; }
    void (async () => {
      try {
        const state = await c.status(); if (disposed) return;
        setDevice(state); setReady(true); setFailed(false);
        if (state.instrument === wavetableEngine && !retainedDraft.current) { const held = await c.readWavetable(),effects=await c.readEffects(); if (!disposed) {const found=tableCrc(held.patch)?[...factoryTables,...await listTables()].find(t=>t.crc===tableCrc(held.patch)):undefined;if(!disposed)resetPreset({...wavetablePreset('Device RAM', held.patch),effects,table:found?{id:found.id,name:found.name}:undefined});} }
        setMessage(state.instrument === wavetableEngine ? state.state === 'playing' ? 'Wavetable running. Play the keys.' : 'Wavetable selected. Start the synth to play.' : retainedDraft.current ? 'Draft retained. Start synth to hear it.' : 'Start synth to load this sound.');
      } catch (error) { if (!disposed) fail(error); } finally { statusPolling = false; }
    })();
    const poll = setInterval(() => { if (disposed || statusPolling || document.hidden || progressRef.current || flushing.current) return; statusPolling = true; void c.status().then(s => { if (!disposed) { setDevice(s); setReady(true); } }).catch(error => { if (!disposed) fail(error); }).finally(() => { statusPolling = false; }); }, 2000);
    const expression = setInterval(() => { if (polling || disposed || document.hidden || progressRef.current) return; polling = true; void c.expression().then(v => { if (!disposed) preview.setExpression(v); }).catch(() => undefined).finally(() => { polling = false; }); }, 60);
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
    let tableChanged=state.instrument!==wavetableEngine;
    if(!tableChanged){const held=await client.readWavetable();tableChanged=tableCrc(held.patch)!==tableCrc(next);}
    if(tableChanged||state.state==='stopped'){const asset=next.table?await getTable(next.table.id):undefined;if(tableCrc(next)&&(!asset||asset.crc!==tableCrc(next)))throw Error('Import the table belonging to this sound before loading it.');await client.selectWavetableTable(tableCrc(next),asset?.prepared);}
    // The board admits a patch against the rack it holds; clear the previous
    // sound's rack first so the new patch and rack are each checked once.
    await client.effects({...next.effects, order: [], routes: next.effects.routes?.map(() => 0)});
    await client.applyWavetable(next);
    await client.effects(next.effects);
    return (start||(tableChanged&&state.state==='playing')) && (await client.status()).state !== 'playing' ? client.start(wavetableEngine) : client.status();
  }, start ? 'Starting wavetable…' : 'Loading sound…') : Promise.resolve();
  const apply = (next: WavetablePreset) => { retainedDraft.current = true; resetPreset(next); setTool('value'); setLocked(false); setRouteMenu(undefined); if (onDevice) void loadOnDevice(next, false); };
  const restore = (direction: 'undo' | 'redo') => { setRouteMenu(undefined); const next = direction === 'undo' ? undo() : redo(); if (next && onDevice) void loadOnDevice(next, false); };

  const chooseTable=(asset?:TableAsset)=>{const crc=asset?.crc??0,parameters=[...preset.parameters];parameters[P.TableLow]=crc&65535;parameters[P.TableHigh]=crc>>>16;const next={...preset,parameters,table:asset?{id:asset.id,name:asset.name}:undefined};retainedDraft.current=true;setSelectedTable(asset);setPreset(next);setTool('value');setLocked(false);setRouteMenu(undefined);if(onDevice)void loadOnDevice(next,false);};
  const useTable=async(asset:TableAsset)=>{setTables(await listTables());chooseTable(asset);setImporting(undefined);};
  const download=(data:unknown,name:string)=>{const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);};
  const exportSound=async()=>{try{const asset=preset.table?await getTable(preset.table.id):undefined;if(tableCrc(preset)&&!asset)throw Error('Import this sound’s table to export a portable sound.');download({...preset,...(asset?{tableAsset:exportTable(asset)}:{})},`${preset.name||'wavetable'}.json`);}catch(error){fail(error);}};
  const importSound=async(file:File)=>{const value=JSON.parse(await file.text());if(value.format==='hexboard.table.v1'){const asset={...importTable(value),id:crypto.randomUUID()};await putTable(asset);await useTable(asset);return;}const next=wavetableFromUnknown(value);if(tableCrc(next)){if(!value.tableAsset)throw Error('This sound is missing its table. Export it again with the table included.');const asset={...importTable(value.tableAsset),id:crypto.randomUUID()};if(asset.crc!==tableCrc(next))throw Error('The table does not match this sound.');await putTable(asset);next.table={id:asset.id,name:asset.name};setTables(await listTables());}apply(next);};
  const setEffects = (effects:FxRack) => {
    retainedDraft.current=true;setPreset(p=>({...p,effects}));
    queue('fx',()=>client!.effects(effects));
  };
  const setParameter = (id: number, value: number) => {
    retainedDraft.current = true; setPreset(x => ({...x, parameters: x.parameters.map((v, i) => i === id ? value : v)}));
    queue(`p${id}`, () => client!.editWavetable(id, value));
  };
  const setModSetting = (bank: number, id: number, value: number) => {
    retainedDraft.current = true; setPreset(x => ({...x, mod: x.mod.map((m, b) => b === bank ? m.map((v, i) => i === id ? value : v) : m) as [number[], number[]]}));
    queue(`m${bank}:${id}`, () => client!.editWavetable(parameterCount + bank * modSettingCount + id, value));
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
    const why = tool === 'modulate' && !canRoute ? 'Not modulatable' : full ? `All ${wavetableRouteLimit} routes in use` : undefined;
    const alternate = tool === 'value' && canDrop(id, source) ? {value: routeDepth(preset, id, source), onChange: (d: number) => { setRoute(id, source, d); }} : undefined;
    return <div className="physical-control" key={id} data-mod-target={id} data-drop={drag ? canDrop(id, drag.source) ? 'ok' : 'blocked' : undefined} data-drop-hover={drag?.target === id || undefined}
      data-source-route={highlight === undefined ? undefined : routes.some(r => r.i === highlight) ? 'yes' : 'no'} data-modulatable={canRoute} data-route-full={full || undefined} title={why}
      onPointerEnter={() => setHoverTarget(id)} onPointerLeave={() => setHoverTarget(undefined)}>
      <strong>{label}</strong>
      <PreviewValues ids={[id]}>{([effective]) => <><div className="knob-wrap">
        <Knob key={modulating ? `route-${source}` : 'value'} label={modulating ? `${wavetableSources[source]} to ${label}` : label} value={value} min={modulating ? -65536 : 0} max={modulating ? 65536 : 65535}
          disabled={busy || full || (tool === 'modulate' && !canRoute)} baseValue={p[id]} effectiveValue={effective} routes={routes}
          onRouteDepth={(i, d) => { setRoute(id, i, d); }} onRouteMenu={menu} alternate={alternate}
          onChange={v => modulating ? setRoute(id, source, Math.round(v)) : setParameter(id, Math.round(v))} onRelease={() => { if (modulating && !locked) setTool('value'); }}/>
      </div>
      <output aria-live="off" title={`Live: ${describe(Math.round(effective * 65535))}`}>{modulating ? `${Math.round(value / 65536 * 100)}%` : describe(value)}</output></>}</PreviewValues>
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

  const copies = option(P.Unison, p[P.Unison]) + 1, warpMode = option(P.WarpMode, p[P.WarpMode]), resonator = option(P.Resonator, p[P.Resonator]);
  const filterBypassed = filterOpen(preset);
  const flow = stageOrder.map(s => ({...s, cost: pct(cost.stages[s.id]),
    active: s.id === 'warp' ? warpMode > 0 : s.id === 'unison' ? copies > 1 : s.id === 'layers' ? p[P.Noise] > 0 || p[P.Transient] > 0 : s.id === 'resonator' ? resonator > 0 : s.id === 'filter' ? !filterBypassed : s.id === 'output' ? true : true}));
  const select = (id: string) => { setFocused(id); document.getElementById(`wt-stage-${id}`)?.scrollIntoView({behavior: 'smooth', block: 'nearest'}); window.setTimeout(() => setFocused(f => f === id ? undefined : f), 1200); };
  const editorBank = sourceEditor === undefined ? 0 : sourceEditor === S.Env1 || sourceEditor === S.Lfo1 ? 0 : 1;
  const hint = tool === 'modulate' ? `${wavetableSources[source]}${locked ? ' locked' : ''} → drag knobs · ${locked ? 'click it again or Esc to finish' : 'Shift-click to lock'}` : `Drag knobs or pictures · drag a source onto a knob · ⌥/Alt-drag adds ${wavetableSourceShort[source]} · drag a route ring or chip for depth`;
  const userNames = new Set(library.map(x => x.name));

  return <PreviewContext.Provider value={preview}><section ref={root} className="card physical-editor wavetable-editor" aria-label="Wavetable synth editor" data-modulating={tool === 'modulate' || undefined}
    data-source-dragging={drag ? true : undefined} data-source-preview={(drag === undefined && budgetSource !== undefined) || undefined}
    style={{'--modulation-cursor': modulationCursor(0, wavetableSourceColors[source], wavetableSourceShort[source]), '--modulation-color': wavetableSourceColors[source], '--highlight-color': wavetableSourceColors[highlight ?? source]} as CSSProperties}
    onPointerDownCapture={() => beginEdit()} onClick={() => endEdit()}
    onKeyDownCapture={e => {
      const text = (e.target as HTMLElement).closest('input:not([type="range"]),textarea,select,[contenteditable="true"]');
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !text && ['z', 'y'].includes(e.key.toLowerCase())) { e.preventDefault(); restore(e.key.toLowerCase() === 'y' || e.shiftKey ? 'redo' : 'undo'); return; }
      if (!e.metaKey && !e.ctrlKey && !e.altKey) beginEdit();
    }}>
    {importing&&<WavetableImporter initial={importing==='edit'?selectedTable:undefined} onClose={()=>setImporting(undefined)} onUse={asset=>void useTable(asset)}/>}
    <PerformanceRow transport={transport} disabled={busy}/><ControllerControls transport={transport} disabled={busy} onState={preview.setController}/>

    <div className="modulation-toolbar" role="toolbar" aria-label="Modulation tools">
      <div className="sound-history" role="group" aria-label="Sound edit history"><button type="button" disabled={!canUndo || busy} title="Undo · Ctrl/⌘ Z" onClick={() => restore('undo')}>Undo</button><button type="button" disabled={!canRedo || busy} title="Redo · Ctrl/⌘ Shift Z" onClick={() => restore('redo')}>Redo</button></div>
      <button aria-pressed={tool === 'value'} onClick={() => { setTool('value'); setLocked(false); setSourceEditor(undefined); }}>Edit values</button>
      {wavetableSources.map((label, i) => <ModSourceButton key={label} label={wavetableSourceShort[i]} color={wavetableSourceColors[i]} pressed={tool === 'modulate' && source === i} locked={locked && tool === 'modulate' && source === i}
        title={i < S.Env1 ? modSourceHelp(i) : label} editorOpen={sourceEditor === i} events={{...dragBind(i), onPointerEnter: () => setBudgetSource(i), onPointerLeave: () => setBudgetSource(undefined), onFocus: () => setBudgetSource(i), onBlur: () => setBudgetSource(undefined)}}
        onSelect={lock => { if (dragged()) return; if (sourceClickTool(tool === 'modulate' && source === i, lock) === 'value') { setTool('value'); setLocked(false); setSourceEditor(undefined); return; } setSource(i); setLocked(lock || (locked && tool === 'modulate')); setTool('modulate'); setSourceEditor(v => v === i ? v : undefined); }}
        onEditor={i >= S.Env1 && i <= S.Lfo2 ? () => { setSourceEditor(v => v === i ? undefined : i); } : undefined}/>)}
      <small>{hint}</small>
      <ModulationBudget label="DSP budget" capacity={wavetableCapacityUs} used={cost.us} connections={routesUsed(preset)} connectionLimit={wavetableRouteLimit} projected={hoverCost}
        contribution={budgetSource !== undefined ? wavetableSourceCost(preset, budgetSource) : undefined} blocked={!cost.fits ? 'Over budget · may drop audio' : undefined}/>
      {sourceEditor !== undefined && <ModSourceEditor source={sourceEditor === S.Env1 || sourceEditor === S.Env2 ? 5 : 6} title={wavetableSources[sourceEditor]} settings={preset.mod[editorBank]}
        onChange={(id, v) => setModSetting(editorBank, id, v)} onClose={() => setSourceEditor(undefined)} onAssign={() => { setSource(sourceEditor); setTool('modulate'); setSourceEditor(undefined); }} disabled={busy}
        renderControl={(id, label) => <div className="mod-source-control"><span>{label}</span><Knob label={label} value={preset.mod[editorBank][id]} disabled={busy} onChange={v => setModSetting(editorBank, id, Math.round(v))}/><output>{modText(id, preset.mod[editorBank][id])}</output></div>}/>}
    </div>

    <header className="instrument-title"><h2>Wavetable</h2><span>Stereo · 8 voices + 2 tails · {preset.table?.name??(tableCrc(preset)?'Custom':'Basic Shapes')} table</span>{activity ? <SynthProgress progress={activity}/> : <p role="status" className={failed ? 'error' : ''}>{message}</p>}</header>
    <div className="wt-library" role="group" aria-label="Wavetable sounds">
      <select aria-label="Load a sound" value="" disabled={busy} onChange={e => { const [kind, index] = e.target.value.split(':'); const next = kind === 'f' ? factoryWavetablePresets[Number(index)] : library[Number(index)]; if (next) apply(next); }}>
        <option value="">Load a sound…</option>
        <optgroup label="Factory">{factoryWavetablePresets.map((x, i) => <option key={x.name} value={`f:${i}`}>{x.name}</option>)}</optgroup>
        {library.length > 0 && <optgroup label="Saved in this browser">{library.map((x, i) => <option key={x.name} value={`u:${i}`}>{x.name}</option>)}</optgroup>}
      </select>
      <input aria-label="Sound name" value={preset.name} maxLength={80} onChange={e => replacePreset(x => ({...x, name: e.target.value}))}/>
      <button type="button" disabled={!preset.name.trim()} onClick={() => { const saved = {...preset, name: preset.name.trim()}; const next = [...library.filter(x => x.name !== saved.name), saved].sort((a, b) => a.name.localeCompare(b.name)); setLibrary(next); store(libraryKey, next); setFailed(false); setMessage(`Saved “${saved.name}” in this browser.`); }}>{userNames.has(preset.name.trim()) ? 'Update saved' : 'Save'}</button>
      {userNames.has(preset.name.trim()) && <button type="button" onClick={() => { const next = library.filter(x => x.name !== preset.name.trim()); setLibrary(next); store(libraryKey, next); }}>Delete saved</button>}
      <button type="button" onClick={()=>void exportSound()}>Export</button>
      <label className="wt-import"><input type="file" accept="application/json,.json" onChange={async e => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; try { await importSound(file); } catch (error) { fail(error); } }}/>Import…</label>
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

    <PreviewNote>{(_key, held) => <SignalFlow stages={flow} subActive={p[P.Sub] > 0} playing={held} onSelect={select}/>}</PreviewNote>

    <div className="wt-workspace">
      <div className="wt-stages">
        {stage('oscillator', 'Oscillator', true, <>
          <div className="wt-table-viewer" data-table-missing={!!tableCrc(preset)&&!selectedTable||undefined}><div className="wt-table-picker"><select aria-label="Wavetable table" disabled={busy} value={preset.table?.id??'basic'} onChange={e=>{const id=e.target.value;if(id==='import'){setImporting('new');return;}if(id==='edit'){setImporting('edit');return;}if(id==='export'){if(selectedTable)download(exportTable(selectedTable),`${selectedTable.name}.hexwav.json`);return;}if(id==='basic')chooseTable();else void getTable(id).then(t=>{if(!t)throw Error('The table is no longer in this browser.');chooseTable(t);}).catch(fail);}}><option value="basic">Basic Shapes</option>{['HexBoard Classic','Classic source cycles'].map(group=><optgroup key={group} label={group}>{factoryTables.filter(t=>t.group===group).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>)}{tables.length>0&&<optgroup label="My tables">{tables.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>}{preset.table&&![...factoryTables,...tables].some(t=>t.id===preset.table?.id)&&<option value={preset.table.id}>{preset.table.name}</option>}<option value="import">Import WAV…</option>{selectedTable&&<><option value="edit">Edit import settings…</option><option value="export">Export table…</option></>}</select></div>{!!tableCrc(preset)&&!selectedTable&&<div className="wt-table-unavailable">This sound uses a custom table. Import its sound file or original WAV to preview it.</div>}
          <PreviewValues ids={[P.Frame, P.FrameSpread, P.WarpAmount, P.Brightness]}>{([frame, spread, amount, brightness]) => <TableTerrain table={selectedTable?.prepared} frame={p[P.Frame] / 65535} live={frame} spread={spread} copies={copies} warpMode={warpMode} warpAmount={amount} brightness={brightness} disabled={busy || tool !== 'value'} onFrame={v => setParameter(P.Frame, v)}/>}</PreviewValues></div>
          <div className="knob-bank">{control(P.Frame,'Frame',tableCrc(preset)?v=>`${(v/65535*15+1).toFixed(1)} / 16`:undefined)}{control(P.FrameSpread)}{control(P.Brightness)}</div>
        </>, 'Scan the table with Frame · pressure moves it by default. Spread fans unison copies across neighbouring frames.')}
        {stage('warp', 'Warp', warpMode > 0, <>
          {choice(P.WarpMode, warpNames, 'Warp mode')}
          <PreviewValues ids={[P.WarpAmount, P.Frame, P.Brightness]}>{([amount, frame, brightness]) => <WarpScope table={selectedTable?.prepared} mode={warpMode} amount={amount} frame={frame} brightness={brightness}/>}</PreviewValues>
          <div className="knob-bank">{control(P.WarpAmount, warpMode === 4 ? 'Sync ratio' : 'Amount', v => warpAmountDescription(warpMode, v))}{control(P.WarpBias)}</div>
        </>, warpMode ? 'Alias guard trades top-end sparkle for cleaner highs as warp adds harmonics.' : 'Bend the phase for new harmonics without another oscillator.')}
        {stage('unison', 'Unison', copies > 1, <>
          {choice(P.Unison, ['1', '2', '3', '4', '5', '6', '7'], 'Unison voices')}
          <PreviewValues ids={[P.Detune, P.Width, P.FrameSpread,P.EdgeBlend]}>{([detune, width, spread,blend]) => <UnisonField blend={blend} copies={copies} detune={detune} width={width} spread={spread}/>}</PreviewValues>
          <div className="knob-bank">{control(P.Detune)}{control(P.Width)}{control(P.EdgeBlend)}</div>{choice(P.PhaseMode,['Random','Reset','Evenly spread'],'Start phase')}<p className="panel-note">Start phase applies to new notes. Reset strengthens the attack; evenly spread can thin a stack at very low detune.</p>
        </>)}
        {stage('layers', 'Layers', p[P.Noise] > 0 || p[P.Transient] > 0 || p[P.Sub] > 0, <>
          <div className="wt-layer"><div className="knob-bank">{control(P.Noise)}{control(P.Transient, 'Attack transient')}</div>{choice(P.TransientShape, transientNames, 'Transient shape')}</div>
          <div className="wt-layer wt-sub"><div className="knob-bank">{control(P.Sub)}</div>{choice(P.SubOctave, ['−1 oct', '−2 oct'], 'Sub octave')}{choice(P.SubShape, ['Sine', 'Triangle'], 'Sub shape')}<small>Clean sub skips the resonator, filter and FX rack.</small></div>
        </>)}
        {stage('resonator', 'Resonator', resonator > 0, <>
          {choice(P.Resonator, resonatorNames, 'Resonator')}
          <PreviewValues ids={[P.ResonatorTune, P.ResonatorDecay, P.ResonatorMix]}>{([tune, decay, mix]) => <ResonatorPartials mode={resonator} tune={tune} decay={decay} mix={mix}/>}</PreviewValues>
          <div className="knob-bank">{control(P.ResonatorMix, 'Mix')}{control(P.ResonatorTune)}{control(P.ResonatorDecay)}</div>
        </>, resonator ? 'The transient and noise excite it hardest · try Pressure → Ring.' : undefined)}
        {stage('filter', 'Filter', !filterBypassed, <>
          {choice(P.FilterMode, filterNames, 'Filter mode')}
          <PreviewValues ids={[P.Cutoff]}>{([cutoff]) => <FilterCurve cutoff={p[P.Cutoff] / 65535} resonance={p[P.Resonance] / 65535} mode={option(P.FilterMode, p[P.FilterMode])} live={cutoff} disabled={busy || tool !== 'value'} onChange={(c, r) => { setParameter(P.Cutoff, c); setParameter(P.Resonance, r); }}/>}</PreviewValues>
          <div className="knob-bank">{control(P.Cutoff)}{control(P.Resonance)}{control(P.KeyTrack)}{control(P.FilterEnvelope, 'Env 1 amount')}</div>
        </>, filterBypassed ? 'Fully open · bypassed to save DSP.' : 'Per voice, stereo. Envelope 1 moves the cutoff by Env 1 amount.')}
        {stage('amp', 'Amp', true, <>
          <CurvedEnvelope label="Amp" disabled={busy || tool !== 'value'}
            values={{attack: modulationSeconds(p[P.AmpAttack]), decay: modulationSeconds(p[P.AmpDecay]), sustain: p[P.AmpSustain] / 65535, release: modulationSeconds(p[P.AmpRelease])}}
            bends={{attack: curveBend(p[P.AmpAttackCurve]), decay: curveBend(p[P.AmpDecayCurve]), release: curveBend(p[P.AmpReleaseCurve])}}
            onTime={(segment, seconds) => setParameter(segment === 'attack' ? P.AmpAttack : segment === 'decay' ? P.AmpDecay : P.AmpRelease, timeValue(seconds))}
            onSustain={v => setParameter(P.AmpSustain, Math.round(v * 65535))}
            onBend={(segment, bend) => setParameter(segment === 'attack' ? P.AmpAttackCurve : segment === 'decay' ? P.AmpDecayCurve : P.AmpReleaseCurve, curveWord(bend))}/>
          <div className="knob-bank">{control(P.AmpAttack)}{control(P.AmpDecay)}{control(P.AmpSustain)}{control(P.AmpRelease)}</div>
        </>)}
        {stage('output', 'Output', true, <>
          <div className="knob-bank">{control(P.Level)}</div>
          <small>The FX rack, including Ensemble, follows the voice mix; the clean sub joins after it.</small>
        </>)}
      </div>
      <aside className="wt-side">
        <FxRackEditor rack={preset.effects} busy={busy} onChange={setEffects} canApply={rack => { const next = wavetableCost({...preset, effects: rack}); return next.fits || next.us <= cost.us; }}
          targeting={{tool,source:source===S.Joystick?7:source===S.Pedal?8:source===S.Env2||source===S.Lfo2?-1:source,values:[],
            previewSource:i=>i===7?S.Joystick:i===8?S.Pedal:i,
            finish:()=>{if(!locked)setTool('value');},focus:()=>setSourceEditor(undefined)}}/>
        <fieldset className="wt-expression"><legend>Expression</legend>
          <PreviewNote>{(key, held) => <p className="panel-note">{client && ready ? key == null ? 'Play a key to see its pressure.' : `Key ${key} · ${held ? 'held' : 'released'}` : 'Offline preview'}</p>}</PreviewNote>
          {wavetableSources.map((label, i) => <div className="source-meter" key={label}><span className="wt-meter-label" style={{borderColor: wavetableSourceColors[i]}}>{wavetableSourceShort[i]}</span><PreviewSource id={i}>{value => <><meter aria-label={`${label} meter`} min={bipolarSource(i, preset) ? -1 : 0} max={1} value={value}/><output aria-live="off">{Math.round(value * 100)}%</output></>}</PreviewSource></div>)}
          {!client && <div className="physical-control"><strong>Pressure preview</strong><Knob label="Pressure preview" value={previewPressure} onChange={setPreviewPressure}/></div>}
        </fieldset>
        <p className="panel-note wt-budget-note">DSP estimate {cost.us} µs of {wavetableCapacityUs} µs per block, fitted to measured 8-voice workloads. The board refuses changes that exceed the budget.</p>
      </aside>
    </div>
    {drag && <div className="mod-drag-ghost" data-blocked={(drag.target !== undefined && !canDrop(drag.target, drag.source)) || undefined} style={{left: drag.x + 14, top: drag.y + 14, borderColor: wavetableSourceColors[drag.source]}}><span className="source-dot" style={{background: wavetableSourceColors[drag.source]}}/>{wavetableSourceShort[drag.source]}</div>}
    {routeMenu && routeDepth(preset, routeMenu.target, routeMenu.source) !== 0 && <RouteMenu title={`${wavetableSources[routeMenu.source]} → ${wavetableParameters[routeMenu.target].name}`} color={wavetableSourceColors[routeMenu.source]}
      depth={routeDepth(preset, routeMenu.target, routeMenu.source)} x={routeMenu.x} y={routeMenu.y} onDepth={d => { setRoute(routeMenu.target, routeMenu.source, d); }} onClose={() => setRouteMenu(undefined)}/>}
  </section></PreviewContext.Provider>;
}
