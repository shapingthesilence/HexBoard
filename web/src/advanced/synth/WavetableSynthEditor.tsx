import {SampleEditor} from './SampleEditor.tsx';
import {factoryAttackSamples,validateAttack,sampleChecksum,maxAttackFrames,attackRootHz} from './wavetableAttack.ts';
import {defaultSample,type SampleExciter} from './schema.ts';
import {AssetStorageSelector} from "./AssetStorageSelector.tsx";
import {LayersPicture,SubWave,IntervalControls,PartialsDialog,PartialsPicture} from './WavetableIntervalControls.tsx';
import {bodyPartials,unisonPitches,customBody,defaultTuning,type TuningGrid} from './wavetableIntervals.ts';
import {MonoControls} from './MonoControls.tsx';
import {PresetLibrary} from './PresetLibrary.tsx';
import {isWavetablePreset,presetDraftKey} from './presetLibrary.ts';
import {defaultMono, type MonoConfig} from './mono.ts';
import {CurvedEnvelope} from './CurvedEnvelope.tsx';
import {curveBend, curveWord} from './envelopeCurve.ts';
import {factoryTables} from './wavetable/factory.ts';
import {WavetableImporter} from './WavetableImporter.tsx';
import {getTable,listTables,putTable,exportTable,importTable,presetTable,type TableAsset,type TableRef} from './wavetable/library.ts';
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
  P, S, unisonNames,bodyMotionNames,partialField,modSettingCount, osc2Names, filterNames, modulatable, option, optionValue, parameterCount,
  resonatorNames, tableCrc, routeDepth, routesUsed, sameWavetable, sourceCount, transientNames, warpAmountDescription, warpNames, wavetableEngine,
  wavetableParameters, wavetablePreset, wavetableSourceColors, wavetableSourceShort, wavetableSources, withRoute, bipolarSource, type WavetablePreset
} from './wavetableSchema.ts';
import {filterOpen, wavetableCapacityUs, wavetableCost, wavetableSourceCost, wavetableRouteLimit, type WavetableStage} from './wavetableBudget.ts';
import {FilterCurve, ResonatorPartials, SignalFlow, TableTerrain, UnisonField, WarpScope} from './WavetableVisuals.tsx';
import './PhysicalSynthEditor.css';
import './SynthIdentity.css';
import './WavetableSynthEditor.css';

// Browser storage can be unavailable (private windows, tests); nothing here depends on it.
const stored = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const store = (key: string, value: unknown) => { try { writeStoredText(localStorage, key, JSON.stringify(value)); } catch { /* Keep working without persistence. */ } };
// Controls whose neutral value is the centre (double-click resets there). Level resets to 0 dB instead.
const centredParameters = new Set<number>([P.StackInterval,...Array.from({length:4},(_,j)=>P.Partial1Pan+j*7),...Array.from({length:4},(_,j)=>P.Partial1Interval+j*7),P.Coarse, P.Fine, P.SubCoarse, P.SubFine, P.Osc2Coarse, P.Osc2Fine, P.FilterEnvelope, P.AmpAttackCurve, P.AmpDecayCurve, P.AmpReleaseCurve]);
const stageOrder: {id: WavetableStage; label: string}[] = [
  {id: 'oscillator', label: 'Oscillator'}, {id: 'osc2', label: 'Osc 2'}, {id: 'warp', label: 'Warp'}, {id: 'unison', label: 'Unison'}, {id: 'layers', label: 'Layers'},
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

export function WavetableSynthEditor({ transport,onDeviceEngineLoaded }: { transport?: MidiTransport;onDeviceEngineLoaded?:(engine:2|4|5|7)=>void }) {
  const {value: preset, set: setPreset, reset: resetPreset, replace: replacePreset, undo, redo, canUndo, canRedo, begin: beginEdit, end: endEdit} = useEditHistory<WavetablePreset>(wavetableDraft, sameWavetable);
  const [tables,setTables]=useState<TableRef[]>([]),[selectedTable,setSelectedTable]=useState<TableAsset>(),[importing,setImporting]=useState<'new'|'edit'|undefined>();
  useEffect(()=>{void listTables().then(setTables).catch(()=>undefined);},[]);
  useEffect(()=>{let disposed=false;setSelectedTable(undefined);if(preset.table)void getTable(preset.table.id).then(t=>{if(!disposed)setSelectedTable(t);}).catch(error=>{if(!disposed)fail(error);});return()=>{disposed=true;};},[preset.table?.id]);
  const [attackOpen,setAttackOpen]=useState(false);
  const [partsOpen,setPartsOpen]=useState(false),[activePart,setActivePart]=useState<number>(),[tuning,setTuning]=useState<TuningGrid>(defaultTuning);
  const p = partsOpen&&option(P.Resonator,preset.parameters[P.Resonator])!==3 ? [...preset.parameters.slice(0,P.Partial1Mode),...bodyPartials(preset).flat(),...preset.parameters.slice(P.AttackFrames)] : preset.parameters;
  const root = useRef<HTMLElement>(null);
  const [preview] = useState(() => new WavetablePreview(preset));
  const [client, setClient] = useState<PhysicalSynthClient>();
  const [device, setDevice] = useState<PhysicalState>(), [ready, setReady] = useState(false), [loading, setLoading] = useState(false), [attempt, setAttempt] = useState(0);
  const [message, setMessage] = useState(''), [failed, setFailed] = useState(false), [progress, setProgress] = useState<Progress>(), [operationLabel, setOperationLabel] = useState('Updating synth…');
  const [previewPressure, setPreviewPressure] = useState(0);
  const [tool, setTool] = useState<'value' | 'modulate'>('value'), [locked, setLocked] = useState(false), [source, setSource] = useState<number>(S.Pressure);
  const [routeMenu, setRouteMenu] = useState<{target: number; source: number; x: number; y: number}>(), [sourceEditor, setSourceEditor] = useState<number>(), [budgetSource, setBudgetSource] = useState<number>(), [hoverTarget, setHoverTarget] = useState<number>();
  const [focused, setFocused] = useState<string>();
  const edits = useRef(new Map<string, () => Promise<unknown>>()), flushing = useRef(false), libraryBusy=useRef(false), alive = useRef(true), progressRef = useRef<Progress | undefined>(undefined), retainedDraft = useRef(stored(draftKey) !== null);
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
        const grid=await c.readTuning();if(!disposed)setTuning(grid);
        setDevice(state); setReady(true); setFailed(false);
        if (state.instrument === wavetableEngine && !retainedDraft.current) {
          const held = await c.readWavetable(), attack=await c.readWavetableAttack(held.patch), effects = await c.readEffects(), mono = await c.monoSettings();
          const crc = tableCrc(held.patch);
          const found = crc ? [...factoryTables, ...await listTables()].find(t => t.crc === crc) : undefined;
          if (!disposed && !retainedDraft.current)
            resetPreset({...wavetablePreset('Device RAM', {...held.patch,attack}), effects, mono, table: found ? {id: found.id, name: found.name} : undefined});
        }
        setMessage(state.instrument === wavetableEngine ? state.state === 'playing' ? 'Wavetable running. Play the keys.' : 'Wavetable selected. Start the synth to play.' : retainedDraft.current ? 'Draft retained. Start synth to hear it.' : 'Start synth to load this sound.');
      } catch (error) { if (!disposed) fail(error); } finally { statusPolling = false; }
    })();
    const poll = setInterval(() => { if (disposed || statusPolling || document.hidden || libraryBusy.current || progressRef.current || flushing.current) return; statusPolling = true; void c.status().then(s => { if (!disposed) { setDevice(s); setReady(true); } }).then(async()=>{const grid=await c.readTuning();if(!disposed)setTuning(grid);}).catch(error => { if (!disposed) fail(error); }).finally(() => { statusPolling = false; }); }, 2000);
    const expression = setInterval(() => { if (polling || disposed || document.hidden || libraryBusy.current || progressRef.current) return; polling = true; void c.expression().then(v => { if (!disposed) preview.setExpression(v); }).catch(() => undefined).finally(() => { polling = false; }); }, 60);
    const flush = setInterval(() => {
      if (libraryBusy.current || flushing.current || !edits.current.size) return; flushing.current = true;
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
    try { const state = await run(); if (alive.current) { setDevice(state); setMessage(state.state === 'playing' ? 'Sound updated · play the keys.' : 'Wavetable patch loaded.'); } return true; }
    catch (error) { fail(error);return false; } finally { if (alive.current) setLoading(false); }
  };
  const settle = async () => { edits.current.clear(); while (flushing.current && alive.current) await new Promise(r => setTimeout(r, 15)); };
  const loadOnDevice = (next: WavetablePreset, start: boolean) => client && ready ? operation(async () => {
    await settle(); const state = await client.status();
    let tableChanged=state.instrument!==wavetableEngine,attackChanged=Boolean(next.attack),attackRestart=false;
    if(!tableChanged){const held=await client.readWavetable();tableChanged=tableCrc(held.patch)!==tableCrc(next);attackChanged=[P.AttackFrames,P.AttackCrcLow,P.AttackCrcHigh].some(id=>held.patch.parameters[id]!==next.parameters[id]);}
    if(tableChanged||state.state==='stopped'){
      const crc=tableCrc(next);
      try{await client.selectWavetableTable(crc);}catch(error){
        const asset=await presetTable(crc,next.table?.id);if(!asset)throw error;
        await client.selectWavetableTable(crc,asset.prepared);
      }
    }
    if(next.attack&&(attackChanged||state.state==='stopped')){await client.setWavetableAttack(next.attack);attackRestart=state.state==='playing';}
    // The board admits a patch against the rack it holds; clear the previous
    // sound's rack first so the new patch and rack are each checked once.
    await client.effects({...next.effects, order: [], routes: next.effects.routes?.map(() => 0)});
    // Mono shares Physical Strings' main-owned setting; a voice-mode change needs a stopped synth.
    const mono=next.mono??defaultMono(),held=await client.monoSettings();let restart=false;
    if((held.flags&3)!==(mono.flags&3)&&(await client.status()).state!=='stopped'){await client.stopAndWait();restart=state.state==='playing';}
    await client.monoSettings(mono);
    await client.applyWavetable(next);
    await client.effects(next.effects);
    return (start||restart||attackRestart||(tableChanged&&state.state==='playing')) && (await client.status()).state !== 'playing' ? client.start(wavetableEngine) : client.status();
  }, start ? 'Starting wavetable…' : 'Loading sound…') : Promise.resolve();
  const apply = async (next: WavetablePreset) => { retainedDraft.current = true; resetPreset(next); setTool('value'); setLocked(false); setRouteMenu(undefined); setTables(await listTables().catch(()=>[])); if (onDevice) await loadOnDevice(next, false); };
  const restore = (direction: 'undo' | 'redo') => { setRouteMenu(undefined); const next = direction === 'undo' ? undo() : redo(); if (next && onDevice) void loadOnDevice(next, false); };

  const chooseTable=(asset?:TableAsset)=>{const crc=asset?.crc??0,parameters=[...preset.parameters];parameters[P.TableLow]=crc&65535;parameters[P.TableHigh]=crc>>>16;const next={...preset,parameters,table:asset?{id:asset.id,name:asset.name}:undefined};retainedDraft.current=true;setSelectedTable(asset);setPreset(next);setTool('value');setLocked(false);setRouteMenu(undefined);if(onDevice)void loadOnDevice(next,false);};
  const useTable=async(asset:TableAsset)=>{setTables(await listTables());chooseTable(asset);setImporting(undefined);};
  const download=(data:unknown,name:string)=>{const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);};
  const importPresetAsset=async(value:unknown)=>{
    if((value as {format?:string})?.format!=='hexboard.table.v1')return false;
    const asset={...importTable(value),id:crypto.randomUUID()};await putTable(asset);await useTable(asset);return true;
  };
  const setEffects = (effects:FxRack) => {
    retainedDraft.current=true;setPreset(p=>({...p,effects}));
    queue('fx',()=>client!.effects(effects));
  };
  const setMono = (mono: MonoConfig) => {
    const modeChanged = (mono.flags & 3) !== ((preset.mono?.flags ?? 0) & 3), next = {...preset, mono};
    retainedDraft.current = true; setPreset(x => ({...x, mono}));
    if (!onDevice) return;
    if (modeChanged) void loadOnDevice(next, false); else queue('mono', () => client!.monoSettings(mono));
  };
  const canUse=(next:WavetablePreset)=>{const before=wavetableCost(preset).us,after=wavetableCost(next).us;if(after>wavetableCapacityUs&&after>before){setFailed(true);setMessage('DSP budget full. Reduce voices or effects before adding this feature.');return false;}return true;};
  const setFields=(fields:Record<number,number>)=>{
    const custom=Object.keys(fields).some(id=>partialField(Number(id))>=0)||(fields[P.Resonator]!==undefined&&option(P.Resonator,fields[P.Resonator])===3);
    const base=custom?customBody(preset):preset,parameters=[...base.parameters];for(const [id,value] of Object.entries(fields))parameters[Number(id)]=value;
    const next={...base,parameters};if(!canUse(next))return;retainedDraft.current=true;setPreset(next);edits.current.clear();queue('whole-patch',()=>client!.applyWavetable(next));
  };
  const setParameter = (id:number,input:number)=>{
    if(partialField(id)>=0||(id===P.Resonator&&option(P.Resonator,input)===3)){setFields({[id]:input});return;}
    const next={...preset,parameters:preset.parameters.map((v,i)=>i===id?input:v)};if(!canUse(next))return;
    retainedDraft.current=true;setPreset(next);queue(`p${id}`,()=>client!.editWavetable(id,input));
  };
  const useAttack=async(sample:SampleExciter,preview=false)=>{
    const attack=validateAttack({name:sample.name,frames:sample.frames})!,parameters=[...preset.parameters],crc=sampleChecksum(attack.frames);
    parameters[P.AttackFrames]=attack.frames.length;parameters[P.AttackCrcLow]=crc&65535;parameters[P.AttackCrcHigh]=crc>>>16;
    parameters[P.TransientShape]=optionValue(P.TransientShape,3);parameters[P.Transient]=sample.gain;
    const next={...preset,parameters,attack};if(!canUse(next))throw Error('Reduce voices or effects before adding the attack.');
    retainedDraft.current=true;setPreset(next);
    if(client&&ready){if(await loadOnDevice(next,preview)===false)throw Error('Could not load the attack sample.');if(preview)await client.previewWavetableAttack();}
    else if(preview)throw Error('Connect Advanced to preview through the synth.');
  };
  const chooseAttack=(value:string)=>{
    if(value==='import'){setAttackOpen(true);return;}
    if(value.startsWith('sample:')){const attack=factoryAttackSamples[Number(value.slice(7))];void useAttack({...defaultSample(),...attack,enabled:true,gain:p[P.Transient]||30000}).catch(fail);return;}
    if(value==='custom'){setParameter(P.TransientShape,optionValue(P.TransientShape,3));return;}
    setFields({[P.TransientShape]:optionValue(P.TransientShape,Number(value)),[P.Transient]:p[P.Transient]||30000,[P.AttackRoot]:Number(value)===1?54172:34125});
  };
  const setModSetting = (bank: number, id: number, value: number) => {
    retainedDraft.current = true; setPreset(x => ({...x, mod: x.mod.map((m, b) => b === bank ? m.map((v, i) => i === id ? value : v) : m) as [number[], number[]]}));
    queue(`m${bank}:${id}`, () => client!.editWavetable(parameterCount + bank * modSettingCount + id, value));
  };
  const setRoute = (destination: number, from: number, depth: number) => {
    const bodyEdit=partialField(destination)>=0&&option(P.Resonator,preset.parameters[P.Resonator])!==3;
    const result = withRoute(bodyEdit?customBody(preset):preset, destination, from, depth);
    if (!result) { setFailed(true); setMessage(`All ${wavetableRouteLimit} modulation routes are in use. Delete one to add another.`); return false; }
    if (result.index < 0) return true;
    if (!canUse({...preset,...result.patch})) return false;
    retainedDraft.current = true; setPreset(x => ({...x,parameters:result.patch.parameters,routes: result.patch.routes}));
    const route = result.patch.routes[result.index];
    if(bodyEdit){edits.current.clear();queue('whole-patch',()=>client!.applyWavetable({...preset,...result.patch}));return true;}
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
      <PreviewValues ids={[id]}>{([live]) => {const effective=partsOpen&&partialField(id)>=0&&option(P.Resonator,preset.parameters[P.Resonator])!==3?p[id]/65535:live;return <><div className="knob-wrap">
        <Knob key={modulating ? `route-${source}` : 'value'} label={modulating ? `${wavetableSources[source]} to ${label}` : label} value={value} min={modulating ? -65536 : 0} max={modulating ? 65536 : 65535} neutral={modulating ? undefined : id === P.Level ? 65535 : centredParameters.has(id) ? 32768 : undefined} keyStep={undefined}
          disabled={busy || full || (tool === 'modulate' && !canRoute)} baseValue={p[id]} effectiveValue={effective} routes={routes}
          onRouteDepth={(i, d) => { setRoute(id, i, d); }} onRouteMenu={menu} alternate={alternate}
          onChange={v => modulating ? setRoute(id, source, Math.round(v)) : setParameter(id, Math.round(v))} onRelease={() => { if (modulating && !locked) setTool('value'); }}/>
      </div>
      <output aria-live="off" title={`Live: ${describe(Math.round(effective * 65535))}`}>{modulating ? `${Math.round(value / 65536 * 100)}%` : describe(value)}</output></>;}}</PreviewValues>
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
    active: s.id === 'osc2' ? p[P.Osc2Level] > 0 || p[P.PhaseMod] > 0 : s.id === 'warp' ? warpMode > 0 : s.id === 'unison' ? copies > 1 : s.id === 'layers' ? p[P.Noise] > 0 || p[P.Transient] > 0 : s.id === 'resonator' ? resonator > 0 : s.id === 'filter' ? !filterBypassed : s.id === 'output' ? true : true}));
  const select = (id: string) => { setFocused(id); document.getElementById(`wt-stage-${id}`)?.scrollIntoView({behavior: 'smooth', block: 'nearest'}); window.setTimeout(() => setFocused(f => f === id ? undefined : f), 1200); };
  const editorBank = sourceEditor === undefined ? 0 : sourceEditor === S.Env1 || sourceEditor === S.Lfo1 ? 0 : 1;
  const hint = tool === 'modulate' ? `${wavetableSources[source]}${locked ? ' locked' : ''} → drag knobs · ${locked ? 'click it again or Esc to finish' : 'Shift-click to lock'}` : `Drag knobs or pictures · drag a source onto a knob · ⌥/Alt-drag adds ${wavetableSourceShort[source]} · drag a route ring or chip for depth`;

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
    <PresetLibrary preset={preset} client={ready?client:undefined} disabled={busy}
      onRename={name=>replacePreset(p=>({...p,name}))} onBusy={async busy=>{libraryBusy.current=busy;setLoading(busy);if(busy)await settle();}} onImportAsset={importPresetAsset}
      onLoad={async p=>{if(!isWavetablePreset(p))throw Error('Select the matching engine.');await apply(p);}}
      onDeviceLoad={async(engine,name)=>{
        await settle();const value=await client!.readSound(name);
        if(engine!==wavetableEngine){store(presetDraftKey(engine),value);onDeviceEngineLoaded?.((engine===3?2:engine) as 2|4|5);return;}
        if(!isWavetablePreset(value))return;
        retainedDraft.current=true;resetPreset(value);setDevice(await client!.status());
      }}/>
    <PerformanceRow transport={transport} disabled={busy} voiceControls={<MonoControls value={preset.mono ?? defaultMono()} disabled={busy} onChange={setMono}/>}/><ControllerControls transport={transport} disabled={busy} onState={preview.setController}/>

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
    <div className="synth-activation" aria-label="Instrument playback">
      <div><strong>{!transport ? 'Connect Advanced to play' : !ready ? 'Synth connection unavailable' : playing ? 'Wavetable running' : device?.state === 'loading' ? 'Starting synth…' : device?.state === 'playing' ? 'Another engine is playing' : 'Synth stopped'}</strong>
        <small>{playing ? 'Edits apply on the next audio block.' : 'Start loads this sound and switches the board to Wavetable.'}</small></div>
      <AssetStorageSelector client={client??undefined} disabled={busy}/>
      <div className="button-row">
        <button className="synth-start" disabled={!ready || busy || playing} onClick={() => void loadOnDevice(preset, true)}>Start synth</button>
        <button disabled={!ready || busy || device?.state !== 'playing'} onClick={() => void operation(() => client!.stop(), 'Stopping…')}>Stop synth</button>
        {onDevice && <button disabled={busy} onClick={() => void loadOnDevice(preset, false)}>Resend sound</button>}
        {onDevice && <button disabled={busy} onClick={() => void operation(async()=>{await settle();const sound=await client!.readSound('Device RAM');if(!isWavetablePreset(sound))throw Error('Select Wavetable on the board first.');retainedDraft.current=true;resetPreset(sound);return client!.status();}, 'Reading current sound…')}>Read current sound</button>}
        {transport && failed && <button onClick={() => setAttempt(v => v + 1)}>Retry synth connection</button>}
      </div>
    </div>

    <PreviewNote>{(_key, held) => <SignalFlow stages={flow} subActive={p[P.Sub] > 0} playing={held} onSelect={select}/>}</PreviewNote>

    <datalist id="wt-ratio-choices">{['1/4','1/3','1/2','1/1','5/4','4/3','3/2','5/3','7/4','2/1','3/1','4/1'].map(v=><option key={v} value={v}/>)}</datalist>
    {attackOpen&&<SampleEditor progress={progress} options={{maxFrames:maxAttackFrames,looping:false,title:'Wavetable attack',previewLabel:'Preview in synth',gainLabel:'Attack level',gainText:v=>`${Math.round(v/65535*100)}%`}} sample={{...defaultSample(),name:preset.attack?.name??'',frames:preset.attack?.frames??[],gain:p[P.Transient]||30000}} onApply={sample=>useAttack(sample)} onPreview={sample=>useAttack(sample,true)} onClose={()=>setAttackOpen(false)}/>}
    {partsOpen&&<PartialsDialog onClose={()=>{setPartsOpen(false);setActivePart(undefined);}} actions={<div className="wt-partial-presets"><button onClick={()=>setParameter(P.Resonator,optionValue(P.Resonator,1))}>Bell</button><button onClick={()=>setParameter(P.Resonator,optionValue(P.Resonator,2))}>Wood</button><button onClick={()=>{const values:Record<number,number>={};[1,2,3,4].forEach((n,j)=>{values[P.Partial1Mode+j*7]=optionValue(P.Partial1Mode,1);values[P.Partial1Interval+j*7]=32768;values[P.Partial1Num+j*7]=n;values[P.Partial1Den+j*7]=1;});setFields(values);}}>Harmonic</button><button onClick={()=>{const values:Record<number,number>={};[1,3,3,6].forEach((n,j)=>{values[P.Partial1Mode+j*7]=optionValue(P.Partial1Mode,1);values[P.Partial1Interval+j*7]=32768;values[P.Partial1Num+j*7]=n;values[P.Partial1Den+j*7]=j===1?2:1;});setFields(values);}}>Open fifths</button></div>}>
      <PartialsPicture parts={Array.from({length:4},(_,j)=>p.slice(P.Partial1Mode+j*7,P.Partial1Mode+j*7+7))} grid={tuning} active={activePart} disabled={busy} onActive={setActivePart} onFields={setFields}/>
      <p className="panel-note">The played note excites four resonances. Across is pitch, height is level, and the trail shows how long each keeps ringing. Drag a number to retune it or change its level; drag a dot under stereo to pan. Ratios keep their musical relationship in every tuning; steps and periods follow the board’s tuning. Editing a partial creates a Custom body.</p>
      <div className="wt-partial-controls">{Array.from({length:4},(_,j)=>{const at=P.Partial1Mode+j*7;return <fieldset key={j} data-part={j+1} data-on={activePart===j||undefined} onPointerEnter={()=>setActivePart(j)} onPointerLeave={()=>setActivePart(undefined)} onFocus={()=>setActivePart(j)}><legend><span>{j+1}</span>Partial {j+1}</legend><IntervalControls label={`Partial ${j+1}`} parameters={p} spec={{mode:at,amount:at+1,num:at+2,den:at+3}} disabled={busy} onFields={setFields} control={control}/><div className="knob-bank">{control(at+4,'Level')}{control(at+5,'Decay')}{control(at+6,'Pan')}</div></fieldset>;})}</div>
    </PartialsDialog>}
    <div className="wt-workspace">
      <div className="wt-stages">
        {stage('oscillator', 'Oscillator', true, <>
          <div className="wt-table-viewer" data-table-missing={!!tableCrc(preset)&&!selectedTable||undefined}><div className="wt-table-picker"><select aria-label="Wavetable table" disabled={busy} value={preset.table?.id??'basic'} onChange={e=>{const id=e.target.value;if(id==='import'){setImporting('new');return;}if(id==='edit'){setImporting('edit');return;}if(id==='export'){if(selectedTable)download(exportTable(selectedTable),`${selectedTable.name}.hexwav.json`);return;}if(id==='basic')chooseTable();else void getTable(id).then(t=>{if(!t)throw Error('The table is no longer in this browser.');chooseTable(t);}).catch(fail);}}><option value="basic">Basic Shapes</option><optgroup label="HexBoard Classic">{factoryTables.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>{tables.length>0&&<optgroup label="My tables">{tables.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>}{preset.table&&![...factoryTables,...tables].some(t=>t.id===preset.table?.id)&&<option value={preset.table.id}>{preset.table.name}</option>}<option value="import">Import WAV…</option>{selectedTable&&<><option value="edit">Edit import settings…</option><option value="export">Export table…</option></>}</select></div>{!!tableCrc(preset)&&!selectedTable&&<div className="wt-table-unavailable">This sound uses a custom table. Import its sound file or original WAV to preview it.</div>}
          <PreviewValues ids={[P.Frame, P.FrameSpread, P.WarpAmount, P.Brightness]}>{([frame, spread, amount, brightness]) => <TableTerrain table={selectedTable?.prepared} frame={p[P.Frame] / 65535} live={frame} spread={spread} copies={copies} warpMode={warpMode} warpAmount={amount} brightness={brightness} disabled={busy || tool !== 'value'} onFrame={v => setParameter(P.Frame, v)}/>}</PreviewValues></div>
          <div className="knob-bank">{control(P.Frame,'Frame',tableCrc(preset)?v=>`${(v/65535*15+1).toFixed(1)} / 16`:undefined)}{control(P.FrameSpread)}{control(P.Brightness)}</div><IntervalControls label="Carrier" parameters={p} spec={{mode:P.CarrierPitchMode,amount:P.Coarse,num:P.CarrierRatioNum,den:P.CarrierRatioDen,fine:P.Fine}} disabled={busy} onFields={setFields} control={control}/>
        </>, 'Scan the table with Frame · pressure moves it by default. Spread fans unison copies across neighbouring frames.')}
        <div className="wt-column">
        {stage('osc2', 'Osc 2', p[P.Osc2Level] > 0 || p[P.PhaseMod] > 0, <>
          {choice(P.Osc2Shape, osc2Names, 'Osc 2 shape')}
          <IntervalControls label="Osc 2" parameters={p} spec={{mode:P.Osc2PitchMode,amount:P.Osc2Coarse,num:P.Osc2RatioNum,den:P.Osc2RatioDen,fine:P.Osc2Fine}} disabled={busy} onFields={setFields} control={control} before={<>{control(P.Osc2Level, 'Level')}{control(P.PhaseMod)}</>}/>
        </>, 'A second voice to mix in, or to bend the main oscillator’s phase with Phase mod.')}
        {stage('warp', 'Warp', warpMode > 0, <>
          {choice(P.WarpMode, warpNames, 'Warp mode')}
          <PreviewValues ids={[P.WarpAmount, P.Frame, P.Brightness]}>{([amount, frame, brightness]) => <WarpScope table={selectedTable?.prepared} mode={warpMode} amount={amount} frame={frame} brightness={brightness}/>}</PreviewValues>
          <div className="knob-bank">{control(P.WarpAmount, warpMode === 4 ? 'Sync ratio' : 'Amount', v => warpAmountDescription(warpMode, v))}{control(P.WarpBias)}</div>
        </>, warpMode ? 'Alias guard trades top-end sparkle for cleaner highs as warp adds harmonics.' : 'Bend the phase for new harmonics without another oscillator.')}
        </div>
        {stage('unison', 'Unison', copies > 1, <>
          {choice(P.Unison, ['1', '2', '3', '4', '5', '6', '7'], 'Unison voices')}
          <PreviewValues ids={[P.Detune,P.Width,P.FrameSpread,P.EdgeBlend,P.Coarse,P.Fine,P.StackInterval,P.BeatRate]}>{([detune,width,spread,blend,coarse,fine,stack,beat]) => {const values=p.map(v=>v/65535);for(const [id,v] of [[P.Detune,detune],[P.Coarse,coarse],[P.Fine,fine],[P.StackInterval,stack],[P.BeatRate,beat]])values[id]=v;return <UnisonField blend={blend} copies={copies} detune={detune} width={width} spread={spread} pitches={unisonPitches(preset,tuning,values)}/>;}}</PreviewValues>
          {choice(P.UnisonMode,unisonNames,'Unison mode')}<div className="knob-bank">{option(P.UnisonMode,p[P.UnisonMode])===0?control(P.Detune):option(P.UnisonMode,p[P.UnisonMode])===1?control(P.BeatRate):null}{control(P.Width)}{control(P.EdgeBlend)}</div>{option(P.UnisonMode,p[P.UnisonMode])===2&&<IntervalControls label="Stack" parameters={p} spec={{mode:P.StackPitchMode,amount:P.StackInterval,num:P.StackRatioNum,den:P.StackRatioDen}} disabled={busy} onFields={setFields} control={control}/>}{choice(P.PhaseMode,['Random','Reset','Evenly spread'],'Start phase')}<p className="panel-note">Start phase applies to new notes. Reset strengthens the attack; evenly spread can thin a stack at very low detune.</p>
        </>)}
        {stage('layers', 'Layers', p[P.Noise] > 0 || p[P.Transient] > 0 || p[P.Sub] > 0, <>
          <div className="wt-layer"><h4>Attack &amp; noise</h4>
            <div className="wt-layer-row"><select aria-label="Attack sample" disabled={busy} value={option(P.TransientShape,p[P.TransientShape])===3?'custom':String(option(P.TransientShape,p[P.TransientShape]))} onChange={e=>chooseAttack(e.target.value)}>{transientNames.slice(0,3).map((name,i)=><option key={name} value={i}>{name}</option>)}{preset.attack&&<option value="custom">{preset.attack.name}</option>}<optgroup label="Textures">{factoryAttackSamples.slice(0,3).map((sample,i)=><option key={sample.name} value={`sample:${i}`}>{sample.name}</option>)}</optgroup><optgroup label="Recordings · CC0">{factoryAttackSamples.slice(3).map((sample,i)=><option key={sample.name} value={`sample:${i+3}`}>{sample.name}</option>)}</optgroup><option value="import">Import audio…</option></select><button type="button" disabled={busy} onClick={()=>setAttackOpen(true)}>{preset.attack?'Edit…':'Import…'}</button></div>
            <LayersPicture shape={option(P.TransientShape,p[P.TransientShape])} frames={option(P.TransientShape,p[P.TransientShape])===3?preset.attack?.frames:undefined} level={p[P.Transient]/65535} noise={p[P.Noise]/65535}/>
            {choice(P.AttackPlayback,['Fixed texture','Follow note'],'Attack playback')}
            <div className="knob-bank">{control(P.Transient,'Attack level')}{option(P.AttackPlayback,p[P.AttackPlayback])===1&&control(P.AttackRoot,'Sample root',v=>`${attackRootHz(v).toFixed(1)} Hz`)}{control(P.Noise)}</div></div>
          <div className="wt-layer wt-sub"><h4>Sub</h4><div className="wt-layer-row">{choice(P.SubShape, ['Sine', 'Triangle'], 'Sub shape')}<SubWave triangle={option(P.SubShape,p[P.SubShape])===1} level={p[P.Sub]/65535}/></div><IntervalControls label="Sub" parameters={p} spec={{mode:P.SubPitchMode,amount:P.SubCoarse,num:P.SubRatioNum,den:P.SubRatioDen,fine:P.SubFine}} disabled={busy} onFields={setFields} control={control} before={control(P.Sub,'Level')}/><small>The clean sub skips the resonator, filter and FX rack.</small></div>
        </>)}
        {stage('resonator', 'Resonator', resonator > 0, <>
          {choice(P.Resonator, resonatorNames, 'Resonator')}
          <PreviewValues ids={[P.ResonatorTune, P.ResonatorDecay, P.ResonatorMix]}>{([tune, decay, mix]) => <ResonatorPartials mode={resonator} tune={tune} decay={decay} mix={mix} patch={preset} grid={tuning}/>}</PreviewValues>
          <div className="knob-bank">{control(P.ResonatorMix, 'Mix')}{control(P.BodyLevel)}{control(P.ResonatorTune,option(P.BodyMotion,p[P.BodyMotion])===3?'Partial focus':'Tune',v=>option(P.BodyMotion,p[P.BodyMotion])===3?`${(1+3*v/65535).toFixed(2)}`:`${(3*v/65535).toFixed(2)} periods`)}{control(P.NaturalTuned)}{control(P.ResonatorDecay)}{control(P.BodyAir)}</div>{choice(P.BodyMotion,bodyMotionNames,'Body movement')}<button type="button" disabled={busy} onClick={()=>setPartsOpen(true)}>Customize partials…</button><p className="panel-note">Follows the board’s current tuning · {tuning.count} steps · period ×{(2**tuning.period).toFixed(3)}. Sounds keep their interval choices when the tuning changes.</p>
        </>, resonator ? 'Body level balances wet and dry. Continuous sweep can leave the tuning; snapped/crossfaded pitches and partial-level movement follow it at 100% Tuned.' : undefined)}
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
