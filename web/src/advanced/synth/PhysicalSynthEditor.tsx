import {ModulationBudget} from "./ModulationBudget.tsx";
import {modulationUsage,budgetAllows,sourceContribution} from "./modulationBudget.ts";
import {useEditHistory} from "./useEditHistory.ts";
import {samePhysicalSound} from "./physicalHistory.ts";
import {canAssignTarget} from "./targetModulation.ts";
import {usePerformance,usePerformanceTempo,S as PerformanceSetting} from './performanceSchema.ts';
import {PerformanceRow} from './PerformanceRow.tsx';
import {presetFingerprint} from "./voiceBudget.ts";
import {VoiceBudgetEditor} from "./VoiceBudgetEditor.tsx";
import {SynthProgress} from './SynthProgress.tsx';
import type {SynthProgress as Progress} from './progress.ts';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { MidiTransport } from "../../midi/types.ts";
import { PhysicalSynthClient, type PhysicalState, type PhysicalExpression } from "./client.ts";
import { useSourcePreview } from "./sourcePreview.ts";
import { StringAnimation } from "./StringAnimation.tsx";
import { SampleEditor } from "./SampleEditor.tsx";
import { ModSourceEditor } from "./ModSourceEditor.tsx";
import { modulationRouteCount, modulationSeconds, modulationRate, type FxRack, type SampleExciter, factoryPhysicalPresets, initialPreset, physicalParameters, physicalSources, physicalPresetFromUnknown, effectiveParameters, type PhysicalPreset } from "./schema.ts";
import "./PhysicalSynthEditor.css";
import {targetingEscape} from "./modulationTargeting.ts";
import {Knob,sourceColors,sourceShortNames,modulationCursor} from "./SynthControls.tsx";
import {FxRackEditor} from "./FxRackEditor.tsx";

const storageKey = "hexboard.physical.library.v1", draftKey = "hexboard.physical.draft.v1";
function readDraft(): PhysicalPreset | undefined {
  try { const raw = window.localStorage.getItem(draftKey); return raw ? physicalPresetFromUnknown(JSON.parse(raw)) : undefined; } catch { return undefined; }
}
function library(): PhysicalPreset[] {
  try { const saved: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]"); return Array.isArray(saved) ? saved.map(physicalPresetFromUnknown) : []; } catch { return []; }
}
function PadLabels({corners,x,y}:{corners:[string,string,string,string];x:string;y:string}){
 return <><span className="pad-corner top-left">{corners[0]}</span><span className="pad-corner top-right">{corners[1]}</span><span className="pad-corner bottom-left">{corners[2]}</span><span className="pad-corner bottom-right">{corners[3]}</span><span className="pad-axis-x">{x}</span><span className="pad-axis-y">{y}</span></>;
}
export function PhysicalSynthEditor({ transport,advanced=false }: { transport?: MidiTransport;advanced?:boolean }) {
  const performance=usePerformance(),performanceTempo=usePerformanceTempo();
  const [client, setClient] = useState<PhysicalSynthClient>();
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [draft] = useState(readDraft), retainedDraft = useRef(Boolean(draft));
  const {value:preset,set:setPreset,reset:resetPreset,replace:replacePreset,undo,redo,canUndo,canRedo,begin:beginEdit,end:endEdit} = useEditHistory<PhysicalPreset>(() => draft ?? physicalPresetFromUnknown(initialPreset),samePhysicalSound);
  const [saved, setSaved] = useState(library), [selection, setSelection] = useState(0);
  const name=preset.name;
  const setName=(name:string)=>{retainedDraft.current=true;setPreset(p=>({...p,name}));};
  const namedPreset=useMemo(()=>({...preset,name}),[preset,name]);
  const [progress,setProgress]=useState<Progress>(),[operationLabel,setOperationLabel]=useState("Updating synth…");
  const progressRef=useRef<Progress|undefined>(undefined);
  const [device, setDevice] = useState<PhysicalState>(), [ready, setReady] = useState(false), [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("Build your sound here. Connect Advanced to hear the physical model."), [failed, setFailed] = useState(false);
  const [bend, setBend] = useState(0), [source, setSource] = useState(1);
  const [budgetTarget,setBudgetTarget]=useState<number>();
  const [budgetFocus,setBudgetFocus]=useState<number>();
  const [budgetSource,setBudgetSource]=useState<number>();
  const [blockedTip,setBlockedTip]=useState<{x:number;y:number}>();
  const [sourceEditor,setSourceEditor]=useState<number>();
  const pinDrag=useRef<{y:number;pressure:number}|undefined>(undefined);
  const [motionReplay,setMotionReplay]=useState(0),[motionEnabled,setMotionEnabled]=useState(true);
  const [tool, setTool] = useState<"value" | "modulate" | "delete">("value");
  const [deleteTarget, setDeleteTarget] = useState<number>();
  const [live, setLive] = useState<PhysicalExpression>(), [previewPressure, setPreviewPressure] = useState(0);
  const edits = useRef(new Map<string, () => Promise<PhysicalState>>()), flushing = useRef(false), alive = useRef(true);
  const [sampleEditor,setSampleEditor]=useState(false);
  const [fxWaiting,setFxWaiting]=useState(false);
  const fxTimer=useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(()=>{clearTimeout(fxTimer.current);setFxWaiting(false);return ()=>clearTimeout(fxTimer.current);},[client]);
  useEffect(()=>{
    if(tool==="value"||sampleEditor)return;
    return targetingEscape(document,()=>{setTool("value");setDeleteTarget(undefined);setSourceEditor(undefined);setBlockedTip(undefined);});
  },[tool,sampleEditor]);
  const presets = [...factoryPhysicalPresets, ...saved];
  const fail = (error: unknown) => { if (alive.current) { setFailed(true); setMessage(error instanceof Error ? error.message : "Could not update the instrument."); } };
  useEffect(() => { try { window.localStorage.setItem(draftKey, JSON.stringify({ ...preset, name: name.trim() || "Untitled" })); } catch { /* Save reports storage errors. */ } }, [preset, name]);
  useEffect(() => {
    let disposed = false, polling = false;
    let lastState: PhysicalState["state"] | undefined;
    // Each effect setup owns a fresh client: StrictMode cleans up and starts
    // effects again, and a closed client must never be reused after reconnect.
    const client = transport ? new PhysicalSynthClient(transport,value=>{if(!disposed){progressRef.current=value;setProgress(value);if(value)setFailed(false);}},advanced) : undefined;
    setClient(client);progressRef.current=undefined;setProgress(undefined);
    alive.current = true; setReady(false); setLive(undefined); edits.current.clear(); flushing.current = false;
    if (!client) return () => { alive.current = false; };
    void client.read().then(state => {
      if (disposed) return;
      lastState = state.state; setDevice(state); if (!retainedDraft.current){const next={...state.preset,name};resetPreset(next.voiceBudget?{...next,voiceBudget:{...next.voiceBudget,fingerprint:presetFingerprint(next)}}:next);}
      setBend(state.bend); setReady(true); setFailed(false);
      setMessage(retainedDraft.current ? "Draft retained. Preview draft to hear it, or load Pressure Sweep for the new pressure mapping." : "Connected. Play a key to see pressure move the pickup.");
    }).catch(error => { if (!disposed) fail(error); });
    const poll = setInterval(() => { if(disposed||progressRef.current||flushing.current)return;void client.read().then(state => {
      if (disposed) return;
      setDevice(state); setReady(true);
      if (lastState !== state.state) {
        setFailed(false);
        setMessage(state.state === "playing" ? "Synth running. Play the keys." : state.state === "loading" ? "Preparing the instrument…" : "Synth stopped. Choose Start synth to play.");
      }
      lastState = state.state;
    }).catch(error => { if (!disposed) fail(error); }); }, 2000);
    const expression = setInterval(() => {
      if (polling || disposed || progressRef.current) return; polling = true;
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
  const operation = async (run: () => Promise<PhysicalState>,label="Updating synth…") => {
    setOperationLabel(label);setFailed(false);setLoading(true);
    try { const state = await run(); if (alive.current) { setDevice(state); setFailed(false); setMessage(state.state === "loading" ? "Preparing the instrument…" : "Sound updated in instrument RAM."); } }
    catch (error) { fail(error); } finally { if (alive.current) setLoading(false); }
  };
  const apply = async (value: PhysicalPreset) => {
    retainedDraft.current = true; edits.current.clear(); clearTimeout(fxTimer.current);setFxWaiting(false); setDeleteTarget(undefined);
    setPreset(physicalPresetFromUnknown(value));
    if (client && ready) await operation(() => client.load(value));
  };
  const restoreHistory=(direction:"undo"|"redo")=>{
    if(busy||sampleEditor)return;
    const next=direction==="undo"?undo():redo();if(!next)return;
    retainedDraft.current=true;edits.current.clear();clearTimeout(fxTimer.current);setFxWaiting(false);
    setTool("value");setDeleteTarget(undefined);setSourceEditor(undefined);setBlockedTip(undefined);
    if(client&&ready)void operation(async()=>{
      // Let an already-issued edit finish before restoring the entire RAM draft.
      while(flushing.current&&alive.current)await new Promise(resolve=>setTimeout(resolve,20));
      if(!alive.current)throw Error("Synth editor closed.");
      await client.apply({...next,name:next.name.trim()||"Untitled"});
      return client.read();
    },direction==="undo"?"Undoing sound edit…":"Redoing sound edit…");
  };
  useEffect(()=>{
    const finish=()=>endEdit();
    window.addEventListener("pointerup",finish);window.addEventListener("pointercancel",finish);
    window.addEventListener("keyup",finish);window.addEventListener("blur",finish);
    return()=>{window.removeEventListener("pointerup",finish);window.removeEventListener("pointercancel",finish);window.removeEventListener("keyup",finish);window.removeEventListener("blur",finish);};
  },[endEdit]);
  const setEffects=(effects:FxRack)=>{
    retainedDraft.current=true;setPreset(p=>({...p,effects}));
    clearTimeout(fxTimer.current);edits.current.delete("fx");
    setFxWaiting(Boolean(client&&ready));
    fxTimer.current=setTimeout(()=>{setFxWaiting(false);queue("fx",()=>client!.effects(effects));},1000);
  };
  const setRackControls=(effects:FxRack)=>{
    retainedDraft.current=true;setPreset(p=>({...p,effects}));
    if(fxWaiting)setEffects(effects);else queue("fx",()=>client!.effects(effects));
  };
  const applySample=async(sample:SampleExciter,preview=false)=>{
    sample={...sample,direct:preset.parameters[32]};
    retainedDraft.current=true;edits.current.delete("p21");setOperationLabel("Loading sample…");setFailed(false);setLoading(true);
    setPreset(p=>({...p,sample:{...sample,direct:p.parameters[32]},parameters:p.parameters.map((v,i)=>i===21?0:v)}));
    try{if(client&&ready){if(preview){await client.parameter(21,0);await client.setSample(sample);await client.previewSample();}else{edits.current.clear();clearTimeout(fxTimer.current);setFxWaiting(false);await client.load({...preset,sample,parameters:preset.parameters.map((v,i)=>i===21?0:v)});}setDevice(await client.read());setFailed(false);}else if(preview)throw Error("Connect Advanced to preview through the string.");}
    catch(error){fail(error);throw error;}finally{setLoading(false);}
  };
  const chooseExciter=(mode:number)=>{
    if(mode===2&&!preset.sample.frames.length){setSampleEditor(true);return;}
    retainedDraft.current=true;const sample={...preset.sample,enabled:mode===2};setPreset(p=>({...p,sample,parameters:p.parameters.map((v,i)=>i===21?(mode===1?65535:0):v)}));
    queue("p21",()=>client!.parameter(21,mode===1?65535:0));
    queue("sample",()=>client!.setSample(sample));
  };
  const setBody=(index:number,value:number)=>{
    const values=preset.effects.values.map(row=>[...row]);values[4][index]=Math.round(value);
    const effects={...preset.effects,values};retainedDraft.current=true;setPreset(p=>({...p,effects}));
    // Share the rack transaction, keeping a pending order change and its cooldown.
    if(fxWaiting)setEffects(effects);else queue("fx",()=>client!.effects(effects));
  };
  const setParameter = (id: number, value: number) => {
    retainedDraft.current = true;
    setPreset(p => ({ ...p, sample:id===32?{...p.sample,direct:value}:p.sample, parameters: p.parameters.map((v, i) => i === id ? value : v) }));
    queue(`p${id}`, () => client!.parameter(id, value));
  };
  const setRoute = (id: number, which: number, value: number) => {
    if(value!==0 && !canAssignTarget(preset,id,which))return;
    if(value!==0&&!budgetAllows(preset,id,which,value))return;
    retainedDraft.current = true;
    if(which>=5){setPreset(p=>({...p,modulation:{...p.modulation,routes:p.modulation.routes.map((v,i)=>i===id*2+which-5?value:v)}}));queue(`m${id}:${which}`,()=>client!.modRoute(id,which-5,value));}
    else if(which>=3){setPreset(p=>({...p,tiltRoutes:p.tiltRoutes.map((v,i)=>i===id*2+which-3?value:v)}));queue(`t${id}:${which}`,()=>client!.tiltRoute(id,which-3,value));}
    else {setPreset(p => ({ ...p, routes: p.routes.map((v, i) => i === id * 3 + which ? value : v) }));queue(`r${id}:${which}`, () => client!.route(id, which, value));}
  };

  const setModSetting=(id:number,value:number)=>{
    retainedDraft.current=true;setPreset(p=>({...p,modulation:{...p.modulation,settings:p.modulation.settings.map((v,i)=>i===id?value:v)}}));
    queue(`ms${id}`,()=>client!.modSetting(id,value));
  };
  const changeBend = (value: number) => { setBend(value); queue("bend", () => client!.bend(value)); };
  const activity=failed?undefined:progress??(loading?{label:operationLabel}:device?.state==="loading"?{label:"Starting synth…"}:undefined);
  const busy = loading || (!failed&&device?.state === "loading") || Boolean(progress);
  const sources = client && ready ? [live?.velocity ?? 0, live?.pressure ?? 0, live?.release ?? 0].map((v, i) => v / (i === 1 ? 65535 : 127)) : [0.8, previewPressure / 65535, 0];
  const generatedPreview=useSourcePreview(preset.modulation.settings,live);
  sources.push(live?.tiltX??0,live?.tiltY??0,...generatedPreview);
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
  const budget=modulationUsage(preset);
  const previewTarget=budgetTarget??budgetFocus;
  const budgetProjection=tool==="modulate"&&budgetSource===undefined&&previewTarget!==undefined?modulationUsage(preset,{id:previewTarget,source,value:1}):undefined;
  const performanceGated=(id:number)=>preset.sample.enabled&&preset.effects.order.length>=3&&((id===29||id===30)?(preset.sample.priority??0)===0:id===26&&(preset.sample.priority??0)===1);
  const driveUnavailable=performanceGated(26);
  const control = (id: number) => {
    const original = physicalParameters[id],p=bowMode&&id===28?{...original,name:"Bow texture"}:original, sampleGate=performanceGated(id), unavailable = sampleGate || ([29,30].includes(id) && bowMode) || (id===32&&(bowMode||!preset.sample.enabled)), modulatable = !unavailable && ![8,21,27,31].includes(id) && (id!==7 || source>=5);
    const routes = physicalSources.map((label, i) => ({ label:String(label), i, bipolar:i===3||i===4||(i===6&&!preset.modulation.settings[14]), depth: i<3?preset.routes[id*3+i]:i<5?preset.tiltRoutes[id*2+i-3]:preset.modulation.routes[id*2+i-5] })).filter(r => r.depth !== 0);
    const targetFull=!canAssignTarget(preset,id,source);
    const routeFull=tool==="modulate"&&modulatable&&(targetFull||!budgetAllows(preset,id,source));
    const modulating = tool === "modulate" && modulatable;
    const value = modulating ? (source<3?preset.routes[id*3+source]:source<5?preset.tiltRoutes[id*2+source-3]:preset.modulation.routes[id*2+source-5]) : preset.parameters[id];
    return <div className="physical-control" key={id} data-unavailable={unavailable||undefined} data-modulatable={modulatable} data-route-full={routeFull||undefined} title={routeFull?(targetFull?"4 sources on this target · remove one to add another":"Modulation capacity full · remove another destination"):unavailable?sampleGate?"Full rack: change Sample priority to use this control":"Available with Strike":undefined} onPointerEnter={()=>{if(modulatable){setBudgetTarget(id);setBudgetSource(undefined);}}} onFocusCapture={()=>{if(modulatable){setBudgetFocus(id);setBudgetSource(undefined);}}} onBlurCapture={()=>setBudgetFocus(undefined)} onPointerMove={e=>{if(routeFull)setBlockedTip({x:e.clientX+16,y:e.clientY+18});}} onPointerLeave={()=>{setBlockedTip(undefined);setBudgetTarget(undefined);}}>
      <strong>{p.name}</strong>
      <div className="knob-wrap" onClick={() => { if (tool !== "delete" || busy) return; if (routes.length === 1) setRoute(id, routes[0].i, 0); else if (routes.length > 1) setDeleteTarget(deleteTarget === id ? undefined : id); }}>
        {id===32?<input key={modulating?`route-${source}`:"value"} className="sample-direct-slider" type="range" aria-label={modulating?`${physicalSources[source]} to ${p.name}`:p.name} min={modulating?-65536:0} max={modulating?65536:65535} step="1" value={value} disabled={busy||unavailable||routeFull||tool==="delete"} onChange={e=>modulating?setRoute(id,source,Number(e.target.value)):setParameter(id,Number(e.target.value))} onPointerUp={()=>{if(modulating)setTool("value");}} onKeyUp={()=>{if(modulating)setTool("value");}}/>:<Knob key={modulating?`route-${source}`:"value"} label={modulating ? `${physicalSources[source]} to ${id===7?"Voice level":p.name}` : p.name} value={value} min={modulating ? -65536 : 0} max={modulating ? 65536 : 65535} disabled={busy || unavailable || routeFull || tool === "delete"} baseValue={preset.parameters[id]} effectiveValue={effective[id]} routes={routes}
          onChange={v => modulating ? setRoute(id, source, Math.round(v)) : setParameter(id, Math.round(v))} onRelease={() => { if (modulating) setTool("value"); }} />}
        {tool === "delete" && routes.length > 0 && <button className="delete-knob" aria-label={`Delete modulation from ${p.name}`}>×</button>}
      </div>
      <output title={`${"strike" in p ? "Next strike" : "Live"}: ${p.describe(Math.round(effective[id]*65535))}`}>{modulating ? `${Math.round(value/65536*100)}%` : p.describe(value)}</output>
      <div className="knob-routes">{routes.map(r => <span key={r.i} style={{ color: sourceColors[r.i] }} title={`${r.label}: ${Math.round(r.depth/65536*100)}%`}>{sourceShortNames[r.i]} {r.depth > 0 ? "+" : ""}{Math.round(r.depth/65536*100)}%</span>)}</div>
      {deleteTarget === id && tool === "delete" && <div className="mod-delete-menu" role="menu" aria-label={`Delete ${p.name} modulation`}>{routes.map(r => <button role="menuitem" key={r.i} onClick={() => { setRoute(id,r.i,0); setDeleteTarget(undefined); }}>Delete {r.label}</button>)}</div>}

    </div>;
  };
  const bodyPanel=<fieldset className="body-panel" disabled={busy}><legend>Body EQ</legend><div className="body-layout">
      <div className="material-surface"><div className="material-pad body-pad" role="slider" tabIndex={busy?-1:0} aria-label="Body size and material" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(preset.effects.values[4][1]/65535*100)} aria-valuetext={`${Math.round(preset.effects.values[4][1]/65535*100)} percent size, ${Math.round(preset.effects.values[4][2]/65535*100)} percent metal`}
        onPointerDown={e=>{if(!busy)e.currentTarget.setPointerCapture(e.pointerId);}}
        onPointerMove={e=>{if(!busy&&e.currentTarget.hasPointerCapture(e.pointerId)){const r=e.currentTarget.getBoundingClientRect();const values=preset.effects.values.map(row=>[...row]);values[4][1]=Math.round(Math.max(0,Math.min(1,(e.clientX-r.left)/r.width))*65535);values[4][2]=Math.round((1-Math.max(0,Math.min(1,(e.clientY-r.top)/r.height)))*65535);const effects={...preset.effects,values};retainedDraft.current=true;setPreset(p=>({...p,effects}));if(fxWaiting)setEffects(effects);else queue("fx",()=>client!.effects(effects));}}}
        onPointerUp={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}
        onKeyDown={e=>{if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key)){e.preventDefault();const id=e.key==="ArrowLeft"||e.key==="ArrowRight"?1:2;setBody(id,Math.max(0,Math.min(65535,preset.effects.values[4][id]+(e.key==="ArrowRight"||e.key==="ArrowUp"?1:-1)*(e.shiftKey?6554:1311))));}}}>
        <PadLabels corners={["Bell","Plate","Wood","Cabinet"]} x="Size" y="Color"/><span className="material-dot" style={{left:`${preset.effects.values[4][1]/65535*100}%`,top:`${100-preset.effects.values[4][2]/65535*100}%`}}/></div></div>
      <div className="body-levels">{["Intensity","Focus"].map((label,i)=>{const id=i?3:0;return <label key={label}><span>{label}</span><input type="range" aria-label={`Body ${label}`} min="0" max="65535" step="1" value={preset.effects.values[4][id]} disabled={busy} onChange={e=>setBody(id,Number(e.target.value))}/><output>{Math.round(preset.effects.values[4][id]/65535*100)}%</output></label>;})}</div>
    </div></fieldset>;
  return <section className="card physical-editor" data-modulating={tool === "modulate" || undefined} style={{ "--modulation-cursor": modulationCursor(source), "--modulation-color": sourceColors[source] } as CSSProperties} aria-label="Physical string editor"
    onPointerDownCapture={()=>beginEdit()} onClickCapture={()=>beginEdit()} onClick={()=>endEdit()}
    onKeyDownCapture={e=>{
      const target=e.target as HTMLElement;
      const text=target.closest('input:not([type="range"]):not([type="radio"]):not([type="checkbox"]),textarea,[contenteditable="true"]');
      if((e.metaKey||e.ctrlKey)&&!e.altKey&&!text&&(["z","y"].includes(e.key.toLowerCase()))){
        e.preventDefault();e.stopPropagation();restoreHistory(e.key.toLowerCase()==="y"||e.shiftKey?"redo":"undo");return;
      }
      if(!e.metaKey&&!e.ctrlKey&&!e.altKey)beginEdit();
    }}>

    <PerformanceRow transport={transport} disabled={busy}/>
    <div className="modulation-toolbar" role="toolbar" aria-label="Modulation tools">
      <div className="sound-history" role="group" aria-label="Sound edit history"><button type="button" disabled={!canUndo||busy||sampleEditor} title="Undo sound edit · Ctrl/⌘ Z" onClick={()=>restoreHistory("undo")}>Undo</button><button type="button" disabled={!canRedo||busy||sampleEditor} title="Redo sound edit · Ctrl/⌘ Shift Z" onClick={()=>restoreHistory("redo")}>Redo</button></div>
      <button aria-pressed={tool === "value"} onClick={() => { setTool("value"); setDeleteTarget(undefined); setSourceEditor(undefined); }}>Edit values</button>
      {physicalSources.map((label,i) => <button key={label} onPointerEnter={()=>{setBudgetTarget(undefined);setBudgetSource(i);}} onPointerLeave={()=>setBudgetSource(undefined)} onFocus={()=>{setBudgetSource(i);setBudgetFocus(undefined);}} onBlur={()=>setBudgetSource(undefined)} style={{ borderColor: sourceColors[i] }} aria-pressed={tool === "modulate" && source === i} onClick={() => { setSource(i); setTool("modulate"); setDeleteTarget(undefined); setSourceEditor(v=>v===i?undefined:i); }}><span className="source-dot" style={{ background: sourceColors[i] }} />{label}{i>=5&&<span className="source-route-count">{modulationRouteCount(preset.modulation.routes,i-5)}</span>}</button>)}
      <button aria-pressed={tool === "delete"} onClick={() => { setTool("delete"); setDeleteTarget(undefined); setSourceEditor(undefined); }}>Delete modulation</button>
      <small>{tool === "modulate" ? source >= 3 && source<5 ? `${physicalSources[source]} ±45° → drag a knob · Neutral uses the base value; negative depth reverses direction` : `${physicalSources[source]} → drag a knob · Release to return to Edit values` : tool === "delete" ? "Click a modulated knob; choose a source if it has several" : "Drag knobs up / down · Shift for fine adjustment"}</small>
    <ModulationBudget used={budget.units} connections={budget.connections} projected={budgetProjection?.units} blocked={budgetProjection&&!budgetProjection.fits?(!budgetProjection.targetsValid?"Target has 4 sources":budgetProjection.connections>32?"Connection limit reached":undefined):undefined} contribution={budgetSource!==undefined?sourceContribution(preset,budgetSource):undefined}/>
    {sourceEditor!==undefined && <ModSourceEditor source={sourceEditor} settings={preset.modulation.settings} onChange={setModSetting} onClose={()=>setSourceEditor(undefined)} onAssign={()=>{setTool("modulate");setSourceEditor(undefined);}} disabled={busy} renderControl={(id,label)=> <div className="mod-source-control"><span>{label}</span><Knob label={label} value={preset.modulation.settings[id]} disabled={busy||(id===8&&!!performance.values[PerformanceSetting.lfoSync])} onChange={v=>setModSetting(id,Math.round(v))}/><output>{id===2?`${Math.round(preset.modulation.settings[id]/65535*100)}%`:id===8?performance.values[PerformanceSetting.lfoSync]?`${Math.min(50,performanceTempo/600*(1<<performance.values[PerformanceSetting.lfoDivision])).toFixed(2)} Hz · synced`:`${modulationRate(preset.modulation.settings[id]).toFixed(2)} Hz`:id===11?`${Math.round(preset.modulation.settings[id]/65535*360)}°`:id===15?`${Math.round(preset.modulation.settings[id]/65535*500)} ms`:id===6?preset.modulation.settings[id]<24000?"Fast rise":preset.modulation.settings[id]>41000?"Slow rise":"Linear":modulationSeconds(preset.modulation.settings[id])<1?`${Math.round(modulationSeconds(preset.modulation.settings[id])*1000)} ms`:`${modulationSeconds(preset.modulation.settings[id]).toFixed(1)} s`}</output></div>} />}
    </div>


    {blockedTip && tool==="modulate"&&<div className="mod-limit-tooltip" role="tooltip" style={{left:Math.min(blockedTip.x,window.innerWidth-220),top:blockedTip.y}}>Limit reached · remove an assignment to add another</div>}
    <header className="instrument-title"><h2>Physical Strings</h2><span>8 voices · stereo</span>{activity?<SynthProgress progress={activity}/>:<p role="status" className={failed ? "error" : ""}>{message}</p>}</header>
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
        <button className="synth-start" disabled={!ready || busy || !client || device?.state === "playing"} onClick={() => { edits.current.clear(); void operation(async () => { await client!.load({ ...preset, name }); return client!.start(); },"Starting synth…"); }}>{busy ? "Starting synth…" : "Start synth"}</button>
        <button disabled={!ready || busy || !client || device?.state !== "playing"} onClick={() => void operation(() => client!.stop())}>Stop synth</button>
        {client && <button disabled={!ready || busy} onClick={() => void apply({ ...preset, name })}>Preview draft</button>}
        {transport && failed && <button onClick={() => setConnectionAttempt(value => value + 1)}>Retry synth connection</button>}
      </div>
    </div>

    {preset.migrationNotes?.length? <p className="panel-note" role="status">{preset.migrationNotes.join(" ")}</p>:null}
    <div className="physical-workspace"><div className="instrument-workspace">
    <div className="physical-grid compact-shaping"><fieldset className={`material-panel exciter-panel${preset.sample.enabled&&!bowMode?" sample-exciter":""}`} disabled={busy}><legend>Exciter</legend>


        <div className="material-body"><div className="material-surface"><div className="exciter-mode" role="radiogroup" aria-label="Excitation mode">{["Strike","Bow","Sample"].map((label,i)=><label key={label} className={(bowMode?1:preset.sample.enabled?2:0)===i?"selected":""}><input type="radio" name="physical-exciter-mode" value={i} checked={(bowMode?1:preset.sample.enabled?2:0)===i} onChange={()=>chooseExciter(i)} />{label}</label>)}</div>
        {(!preset.sample.enabled||bowMode)&&<div className="material-pad" role="slider" tabIndex={busy ? -1 : 0} aria-label={showBowPad?"Bow character":"Striker material"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(preset.parameters[showBowPad?23:2]/65535*100)} aria-valuetext={showBowPad?`${Math.round(preset.parameters[23]/65535*100)} percent speed, ${Math.round(preset.parameters[22]/65535*100)} percent force`:`${Math.round(preset.parameters[2]/65535*100)} percent hardness, ${Math.round(preset.parameters[12]/65535*100)} percent resonance`}
          onPointerDown={e=>{if(!busy){e.currentTarget.setPointerCapture(e.pointerId);strikerMove(e);}}}
          onPointerMove={e=>{if(!busy && e.currentTarget.hasPointerCapture(e.pointerId))strikerMove(e);}}
          onPointerUp={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}
          onKeyDown={e=>{if(busy)return;const horizontal=e.key==="ArrowLeft"||e.key==="ArrowRight";const axis=showBowPad?(horizontal?23:22):(horizontal?2:12); if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key)){e.preventDefault();setParameter(axis,Math.max(0,Math.min(65535,preset.parameters[axis]+(e.key==="ArrowRight"||e.key==="ArrowUp"?1:-1)*(e.shiftKey?6554:1311))));}}}>
          <PadLabels corners={showBowPad?["Grip","Scrape","Slip","Glide"]:["Wood","Steel","Rubber","Plastic"]} x={showBowPad?"Speed":"Hardness"} y={showBowPad?"Force":"Resonance"}/>
          <span className="material-dot" style={{left:`${preset.parameters[showBowPad?23:2]/65535*100}%`,top:`${100-preset.parameters[showBowPad?22:12]/65535*100}%`}} />
          {showBowPad && <span className="material-live-dot" aria-hidden="true" style={{left:`${effective[23]*100}%`,top:`${100-effective[22]*100}%`}} />}
        </div>}
        </div>{(!preset.sample.enabled||bowMode)&&<div className="physical-grid mini-controls">{(showBowPad?[23,22]:[2,12]).map(control)}</div>}</div>


      <div className="sample-panel-controls">{preset.sample.enabled&&!bowMode&&<>{control(32)}<label className="sample-priority">Full rack priority<select aria-label="Sample performance priority" value={preset.sample.priority??0} onChange={e=>{const sample={...preset.sample,priority:Number(e.target.value) as 0|1};retainedDraft.current=true;setPreset(p=>({...p,sample}));queue("sample",()=>client!.setSample(sample));}}><option value={0}>Drive</option><option value={1}>Pin</option></select></label></>}</div><div className="sample-access"><button type="button" disabled={busy} onClick={()=>setSampleEditor(true)}>{preset.sample.frames.length?"Edit sample…":"Import sample…"}</button><span>{preset.sample.frames.length?`${preset.sample.name} · ${Math.round(preset.sample.frames.length/16)} ms`: "Recorded impacts & textures"}</span></div>      <p className="panel-note">{bowMode?"Bow starts from rest. Pressure controls force; speed moves from creaking drag through singing to scrape.":preset.sample.enabled?"Sample energy follows key velocity. Direct blends the recording with the string.":"Strike energy follows key velocity. Shape impacts in the Exciter pad."}</p>
</fieldset>
      <fieldset className="material-panel resonator-panel" disabled={busy}><legend>Resonator</legend>
        <div className="material-body"><div className="material-surface"><div className="material-context" aria-hidden="true"/>
        <div className="material-pad" role="slider" tabIndex={busy ? -1 : 0} aria-label="String material" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(preset.parameters[6] / 65535 * 100)} aria-valuetext={`${Math.round(preset.parameters[6] / 65535 * 100)} percent stiffness, ${Math.round(preset.parameters[1] / 65535 * 100)} percent loss`}
          onPointerDown={e => { if (!busy) { e.currentTarget.setPointerCapture(e.pointerId); materialMove(e); } }}
          onPointerMove={e => { if (!busy && e.currentTarget.hasPointerCapture(e.pointerId)) materialMove(e); }}
          onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
          onKeyDown={e => { if (busy) return; const delta = e.shiftKey ? 6554 : 1311; const axis = e.key === "ArrowLeft" || e.key === "ArrowRight" ? 6 : 1; if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) { e.preventDefault(); setParameter(axis, Math.max(0, Math.min(65535, preset.parameters[axis] + (e.key === "ArrowRight" || e.key === "ArrowDown" ? delta : -delta)))); } }}>
          <PadLabels corners={["Nylon","Glass","Wood","Ceramic"]} x="Stiffness" y="Loss"/>
          <span className="material-dot" style={{ left: `${preset.parameters[6] / 65535 * 100}%`, top: `${preset.parameters[1] / 65535 * 100}%` }} />
        </div>
        </div><div className="physical-grid mini-controls">{[6,1].map(control)}</div></div>


      </fieldset>
      <fieldset className="spatial-panel" disabled={busy}><legend>String workspace</legend><div className="string-workspace-heading"><span>Drag the strike and pickups</span><span className="string-motion-actions"><span title="Approximation of the last reported key, not an audio waveform">Motion preview</span><button type="button" disabled={!motionEnabled} aria-label="Replay string motion preview" title="Replay motion · visual only" onClick={()=>setMotionReplay(v=>v+1)}>▷</button><button type="button" aria-label={motionEnabled?"Pause string animation":"Enable string animation"} aria-pressed={motionEnabled} title={motionEnabled?"Pause animation":"Enable animation"} onClick={()=>setMotionEnabled(v=>!v)}>{motionEnabled?"Ⅱ":"↻"}</button></span></div>
      <svg className="string-view" viewBox={marbleMode ? "0 -32 600 177" : "0 0 600 145"} role="group" aria-label="String positions">

        <StringAnimation values={effective} signature={preset.parameters.join(",")+preset.routes.join(",")+preset.modulation.routes.join(",")} live={live} playing={device?.state==="playing"} replay={motionReplay} enabled={motionEnabled}/>
        {[5,14].map(id=><circle key={id} cx={position(id)} cy="82" r="5" fill="none" stroke="currentColor" opacity=".45"/>)}
        <line x1="30" x2="570" y1="82" y2="82" stroke="currentColor" opacity=".2" />
        <line x1={30 + pickup * 540} x2={30 + pickup * 540} y1="64" y2="104" stroke="#73c6ae" strokeDasharray="3 3" opacity=".7" />
        <line x1={30 + rightPickup * 540} x2={30 + rightPickup * 540} y1="70" y2="115" stroke="#a4a2e6" strokeDasharray="3 3" opacity=".7" />
        {marbleMode && <><line x1={30+540*Math.max(.05,dropCenter-dropRadius)} x2={30+540*Math.min(.95,dropCenter+dropRadius)} y1="0" y2="0" stroke="#b9d6f0" strokeWidth="8" opacity=".4" />{handle(18,"Drop center",0,"#b9d6f0")}</>}{handle(4, bowMode?"Bow":"Strike", 40, "#d7ac68")}{handle(5, "Pickup L", 75, "#73c6ae")}{handle(14, "Pickup R", 106, "#a4a2e6")}
        <text x="30" y="99" fill="currentColor" fontSize="11">Nut</text><text x="570" y="99" textAnchor="end" fill="currentColor" fontSize="11">Bridge</text>
      {!bowMode&&!(preset.sample.enabled&&preset.effects.order.length>=3&&(preset.sample.priority??0)===0)&&preset.parameters[29]>0&&<g className="preparation-pin" role="slider" tabIndex={busy?-1:0} aria-label="Preparation pin position and pressure" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(preset.parameters[30]/65535*100)} aria-valuetext={`${Math.round(preset.parameters[30]/65535*100)} percent position, ${Math.round(preset.parameters[29]/65535*100)} percent pressure`}
        onPointerDown={e=>{if(!busy){e.preventDefault();pinDrag.current={y:e.clientY,pressure:preset.parameters[29]};e.currentTarget.setPointerCapture(e.pointerId);}}}
        onPointerMove={e=>{if(!busy&&e.currentTarget.hasPointerCapture(e.pointerId)){const r=e.currentTarget.ownerSVGElement!.getBoundingClientRect();setParameter(30,Math.round(Math.max(0,Math.min(1,((e.clientX-r.left)/r.width*600-57)/486))*65535));setParameter(29,Math.round(Math.max(0,Math.min(1,(pinDrag.current?.pressure??preset.parameters[29])/65535+(e.clientY-(pinDrag.current?.y??e.clientY))/100))*65535));}}}
        onPointerUp={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}
        onKeyDown={e=>{if(!busy&&["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key)){e.preventDefault();const id=e.key==="ArrowLeft"||e.key==="ArrowRight"?30:29;setParameter(id,Math.max(0,Math.min(65535,preset.parameters[id]+(e.key==="ArrowRight"||e.key==="ArrowDown"?1:-1)*(e.shiftKey?6554:1311))));}}}>
        <title>Drag along the string; pull down to tighten contact</title><path d={`M${57+486*effective[30]},${38+18*effective[29]} v26`} stroke="#f0b56b" strokeWidth="5"/><circle cx={57+486*effective[30]} cy={38+18*effective[29]} r="9" fill="#f0b56b"/><circle cx={57+486*effective[30]} cy={38+18*effective[29]} r="18" fill="transparent"/>
      </g>}</svg>
      <div className="pickup-readout"><span>{bowMode?"Bow":"Strike"} {Math.round(pluck*100)}%</span><span>L {Math.round(pickup*100)}% · R {Math.round(rightPickup*100)}%</span></div>
      <div className="physical-grid mini-controls">{[4,5,14,15].map(control)}</div>
      <div className="pin-controls">{[29,30].map(control)}</div>
    </fieldset>

    <fieldset className="response-panel" disabled={busy}><legend>String response</legend><div className="knob-bank">{control(0)}{control(3)}{control(26)}{control(28)}</div><div className="source-tabs drive-characters" role="group" aria-label="Saturation character" aria-disabled={driveUnavailable} data-unavailable={driveUnavailable||undefined} title={driveUnavailable?"Full rack: change Sample priority to use Drive":undefined}>{["Warm","Edge","Fold"].map((name,i)=><button type="button" key={name} disabled={busy||driveUnavailable} aria-pressed={Math.round(preset.parameters[27]*2/65535)===i} onClick={()=>setParameter(27,Math.round(i*65535/2))}>{name}</button>)}</div><p className="panel-note">Drive acts inside the string · release sampled on key lift</p></fieldset>

    <fieldset className="contact-panel" disabled={busy}><legend>Contact</legend>
      <div className="source-tabs" aria-label="Contact mode">{["Off", "Bounce", "Rattle", "Mute", "Marbles"].map((mode, index) => <button key={mode} aria-pressed={Math.round(preset.parameters[8]*4/65535) === index} onClick={() => setParameter(8,Math.round(index*65535/4))}>{mode}</button>)}</div>

      <div className="source-tabs" role="group" aria-label="Contact starts"><button type="button" aria-pressed={preset.parameters[31]<=32767} onClick={()=>setParameter(31,0)}>Note on</button><button type="button" aria-pressed={preset.parameters[31]>32767} onClick={()=>setParameter(31,65535)}>Note off</button></div>
      <p className="panel-note">{preset.parameters[31]>32767?"Contact begins on release · increase Release time for longer gestures":"Contact begins with the note and continues into its release"}</p>
      <div className="knob-bank">{(marbleMode ? [16,17,18,19,20] : [16,9,10,11,13]).map(control)}</div>
      {marbleMode && <div className="contact-material"><div className="material-surface"><div className="material-pad" role="slider" tabIndex={busy?-1:0} aria-label="Marble material" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(preset.parameters[24]/65535*100)} aria-valuetext={`${Math.round(preset.parameters[24]/65535*100)} percent hardness, ${Math.round(preset.parameters[25]/65535*100)} percent resonance`}
        onPointerDown={e=>{if(!busy){e.currentTarget.setPointerCapture(e.pointerId);marbleMaterialMove(e);}}} onPointerMove={e=>{if(!busy&&e.currentTarget.hasPointerCapture(e.pointerId))marbleMaterialMove(e);}} onPointerUp={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}
        onKeyDown={e=>{if(busy)return;const axis=e.key==="ArrowLeft"||e.key==="ArrowRight"?24:25;if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key)){e.preventDefault();setParameter(axis,Math.max(0,Math.min(65535,preset.parameters[axis]+(e.key==="ArrowRight"||e.key==="ArrowUp"?1:-1)*(e.shiftKey?6554:1311))));}}}><PadLabels corners={["Wood","Steel","Rubber","Plastic"]} x="Hardness" y="Resonance"/><span className="material-dot" style={{left:`${preset.parameters[24]/65535*100}%`,top:`${100-preset.parameters[25]/65535*100}%`}} /></div></div><div className="physical-grid mini-controls">{[24,25].map(control)}</div></div>}
    </fieldset>


    </div>
    <div className="monitor-grid">
    <fieldset className="expression-panel" disabled={busy}><legend>Expression</legend>
      <p className="panel-note">Tilt X ± {((live?.tiltX??0)*45).toFixed(1)}° · Y {((live?.tiltY??0)*45).toFixed(1)}° · {live?.motionValid?"Live":live?.motionDetected?"Waiting for valid gravity":"Connect for tilt"} {client&&ready&&<button disabled={busy||!live?.motionValid} onClick={()=>void operation(async()=>{await client.zeroMotion();return client.read();})}>Set tilt neutral</button>}</p>
      <p className="panel-note">{client && ready ? live?.key === null || live?.key === undefined ? "Play a calibrated key to see its pressure." : `Latest played key: ${live.key} · ${live.held ? "held" : "released"}` : "Preview pressure offline; connect to see live key expression."}</p>
      {physicalSources.map((label, i) => <div className="source-meter" key={label}><span>{sourceShortNames[i]}{i>=5?" · preview":""}</span><meter aria-label={`${label}${i>=5?" preview":""} meter`} min={i<3||i===5||(i===6&&preset.modulation.settings[14])?0:-1} max={1} value={sources[i]} /><output>{i<3||i>=5?`${Math.round(sources[i]*100)}%`:`${Math.round(sources[i]*45)}°`}</output></div>)}
      {!client && <label className="physical-control">Pressure preview<Knob label="Pressure preview" value={previewPressure} onChange={setPreviewPressure} /></label>}
    </fieldset>
    <fieldset className="output-panel" disabled={busy}><legend>Output</legend>{control(7)}<small>Peak safety · analog rocker volume</small>
        {client && <label className="physical-control">Global bend: {bend.toFixed(2)} semitones<Knob label="Global pitch bend" min={-2} max={2} value={bend} disabled={!ready || busy || device?.state !== "playing"} onChange={changeBend} onRelease={() => changeBend(0)} /><button onClick={() => changeBend(0)} disabled={!ready || device?.state !== "playing"}>Center bend</button></label>}
      </fieldset>
    </div>
    </div><div className="engine-side"><FxRackEditor before={bodyPanel} rack={preset.effects} busy={busy} waiting={fxWaiting} onChange={(rack,reorder)=>reorder?setEffects(rack):setRackControls(rack)}/></div></div>
    {sampleEditor&&<SampleEditor progress={progress} sample={preset.sample} onApply={sample=>applySample(sample)} onPreview={sample=>applySample(sample,true)} onClose={()=>setSampleEditor(false)}/>}
    {advanced&&<VoiceBudgetEditor preset={namedPreset} busy={busy} testing={busy&&/voic/.test(progress?.label??operationLabel)} connected={!!client&&ready} onCancel={()=>void client?.cancelVoiceTest().catch(fail)} onInvalidate={()=>{replacePreset(p=>({...p,voiceBudget:undefined}));if(client&&ready)void client.resetVoiceBudget().catch(fail);}} onTest={()=>{replacePreset(p=>({...p,voiceBudget:undefined}));edits.current.clear();clearTimeout(fxTimer.current);void operation(async()=>{const value=await client!.testVoiceLimit({...preset,name});replacePreset(value);const next=[...saved.filter(p=>p.name!==value.name),value];window.localStorage.setItem(storageKey,JSON.stringify(next));setSaved(next);setSelection(factoryPhysicalPresets.length+next.length-1);return client!.status();},"Testing voice limit…");}}/>}
    <p className="editor-footnote">Pressure range: Calibration · Presets saved on this computer · Rings: clockwise + / counterclockwise −</p>
  </section>;
}
