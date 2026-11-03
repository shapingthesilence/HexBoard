import {PresetLibrary} from './PresetLibrary.tsx';
import {synthErrorMessage} from "./requestError.ts";
import {PerformanceRow} from './PerformanceRow.tsx';
import { attachVoiceBudget } from "./voiceBudget.ts";
import {useAutosave} from '../../editor/useAutosave.ts';
import {writeStoredText} from '../../editor/autosave.ts';
import { VoiceBudgetEditor } from "./VoiceBudgetEditor.tsx";
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { MidiTransport } from '../../midi/types.ts';
import { PhysicalSynthClient } from './client.ts';
import { classicFromUnknown, initialClassic, parameterName, addExpression, classicEffects, type ClassicPreset } from './classicSchema.ts';
import { assignAdvanced, continuousParameter, parameterMaximum } from './advancedSchema.ts';
import { Knob, sourceColors, sourceShortNames, modulationCursor } from './SynthControls.tsx';
import { FxRackEditor } from './FxRackEditor.tsx';
import { ModSourceEditor } from './ModSourceEditor.tsx';
import { SynthProgress } from './SynthProgress.tsx';
import type { SynthProgress as Progress } from './progress.ts';
import { physicalSources, type FxRack } from './schema.ts';
import {ClassicPreview} from './enginePreview.ts';
import {PreviewContext, PreviewValues, PreviewSource, PreviewExpression} from './SynthVisualPreview.tsx';
import {startVisibleAnimation} from '../../animation.ts';
import { AlgorithmDiagram } from './AlgorithmDiagram.tsx';
import { targetingEscape } from './modulationTargeting.ts';
import './PhysicalSynthEditor.css';
import './ClassicSynthEditor.css';
const sourceLabels = physicalSources.slice(0,7);
const key = (engine: number) => `hexboard.advanced.${engine}`;
function draft(engine: 4 | 5) {
    try {
        const raw = localStorage.getItem(key(engine) + '.draft');
        return raw ? classicFromUnknown(JSON.parse(raw)) : initialClassic(engine);
    }
    catch {
        return initialClassic(engine);
    }
}
export function ClassicSynthEditor({ engine, transport,onDeviceEngineLoaded }: {
    onDeviceEngineLoaded?:(engine:2|4|5)=>void;
    engine: 4 | 5;
    transport?: MidiTransport;
}) {
    const [preset, setPreset] = useState(() => draft(engine));
    const root = useRef<HTMLElement>(null);
    const [visual] = useState(() => new ClassicPreview(preset.patch));
    const [client, setClient] = useState<PhysicalSynthClient>(), [ready, setReady] = useState(false), [state, setState] = useState(0), [loading, setLoading] = useState(false), [progress, setProgress] = useState<Progress>(), [retry, setRetry] = useState(0);
    const [message, setMessage] = useState('Connect Advanced to hear this engine.'), [failed, setFailed] = useState(false), [pressure, setPressure] = useState(0), [bend, setBend] = useState(0);
    const [tool, setTool] = useState<'value' | 'modulate' | 'delete'>('value'), [source, setSource] = useState(1), [sourceEditor, setSourceEditor] = useState<number>(), [operator, setOperator] = useState(5), [waiting, setWaiting] = useState(false);
    const edits = useRef(new Map<string, () => Promise<unknown>>()), flushing = useRef(false), fxTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), alive = useRef(true), busyRef = useRef(false), retained = useRef(false);
    useEffect(() => visual.configure(preset.patch, !!client && ready, pressure), [visual, preset.patch, client, ready, pressure]);
    useEffect(() => startVisibleAnimation(root.current!, visual.advance), [visual]);
    const fail = (e: unknown) => {
        const message = synthErrorMessage(e);
        if (alive.current && message !== undefined) {
            setFailed(true);
            setMessage(message);
        }
    };
    useAutosave(() => {
        try {
            writeStoredText(localStorage, key(engine) + '.draft', JSON.stringify(preset));
        }
        catch { /* Explicit save reports errors. */ }
    }, [engine, preset]);
    useEffect(() => {
        let disposed = false, polling = false, statusPolling = false;
        alive.current = true;
        setReady(false);
        visual.setExpression();
        edits.current.clear();
        flushing.current = false;
        const c = transport ? new PhysicalSynthClient(transport, p => {
            if (!disposed) {
                setProgress(p);
                busyRef.current = !!p;
            }
        }) : undefined;
        setClient(c);
        if (c)
            void c.readAdvanced().then(async (r) => {
                if (disposed)
                    return;
                if (r.patch.engine !== engine) {
                    if (r.state)
                        throw Error("Stop the current engine before editing this one.");
                    await c.applyAdvanced(preset.patch);
                }
                if (disposed)
                    return;
                setReady(true);
                setState(r.state);
                if (r.patch.engine === engine && !retained.current) {
                    setPreset(p => { const next = { ...p, voiceBudget: undefined, patch: r.patch, effects: r.effects }; return r.budget.qualified && r.budget.phase === 3 ? attachVoiceBudget(next, r.budget) : next; });
                }
                setMessage('Connected. Load a preset or preview your draft.');
            }).catch(fail);
        const expression = setInterval(() => {
            if (!c || disposed || polling || document.hidden || busyRef.current)
                return;
            polling = true;
            void c.expression().then(e => {
                if (!disposed)
                    visual.setExpression(e);
            }).catch(fail).finally(() => polling = false);
        }, 50);
        const status = setInterval(() => {
            if (c && !disposed && !statusPolling && !document.hidden && !busyRef.current) {
                statusPolling = true; void c.status().then(s => {
                    if (!disposed)
                        setState(s.state === 'stopped' ? 0 : 1);
                }).catch(fail).finally(() => { statusPolling = false; });
            }
        }, 2000);
        const flush = setInterval(() => {
            if (flushing.current || busyRef.current || !edits.current.size)
                return;
            flushing.current = true;
            void (async () => {
                try {
                    while (!disposed && edits.current.size) {
                        const [id, run] = edits.current.entries().next().value!;
                        edits.current.delete(id);
                        await run();
                    }
                }
                catch (e) {
                    edits.current.clear();
                    fail(e);
                }
                finally {
                    flushing.current = false;
                }
            })();
        }, 100);
        return () => { disposed = true; alive.current = false; clearInterval(expression); clearInterval(status); clearInterval(flush); clearTimeout(fxTimer.current); edits.current.clear(); c?.close(); };
    }, [transport, engine, retry]);
    useEffect(() => tool === 'modulate' ? targetingEscape(document, () => { setTool('value'); setSourceEditor(undefined); }) : undefined, [tool]);
    useEffect(() => {
        if (sourceEditor === undefined || sourceEditor < 5)
            return;
        const key = (e: KeyboardEvent) => {
            if (e.key === 'Escape')
                setSourceEditor(undefined);
        };
        const outside = (e: PointerEvent) => {
            if (e.target instanceof Element && !e.target.closest('.modulation-toolbar'))
                setSourceEditor(undefined);
        };
        document.addEventListener('keydown', key);
        document.addEventListener('pointerdown', outside);
        return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', outside); };
    }, [sourceEditor]);
    const queue = (id: string, run: () => Promise<unknown>) => {
        if (client && ready)
            edits.current.set(id, run);
    };
    const busy = loading || !!progress;
    const operation = async (run: () => Promise<void>) => {
        setLoading(true);
        busyRef.current = true;
        edits.current.clear();
        clearTimeout(fxTimer.current);
        setWaiting(false);
        setFailed(false);
        try {
            await run();
        }
        catch (e) {
            fail(e);
        }
        finally {
            busyRef.current = false;
            if (alive.current)
                setLoading(false);
        }
    };
    const apply = async (value: ClassicPreset) => {
        edits.current.clear();clearTimeout(fxTimer.current);
        while(flushing.current&&alive.current)await new Promise(r=>setTimeout(r,10));
        const p = classicFromUnknown(value);
        retained.current = true;
        setPreset(p);
        if (client && ready)
            await operation(async () => {
                const r = await client.loadClassic(p);
                if (!r.budget.qualified)
                    setPreset(v => ({ ...v, voiceBudget: undefined }));
                setState(r.state);
                setMessage('Preset loaded. Play the keys.');
            });
    };
    const edit = (index: number, value: number) => { const field = index < 148 ? 'parameters' : 'settings', at = index < 148 ? index : index - 148; retained.current = true; setPreset(p => ({ ...p, patch: { ...p.patch, [field]: p.patch[field].map((v, i) => i === at ? value : v) } })); queue(`p${index}`, () => client!.editAdvanced(index, value)); };
    const route = (destination: number, depth: number) => {
        try {
            const result = assignAdvanced(preset.patch, source, destination, depth);
            retained.current = true;
            setPreset(p => ({ ...p, patch: result.patch }));
            const r = result.patch.routes[result.index];
            queue(`r${result.index}`, () => client!.routeAdvanced(result.index, r.destination, r.depth));
        }
        catch (e) {
            fail(e);
        }
    };
    const setEffects = (effects: FxRack, reorder = false) => {
        retained.current = true;
        setPreset(p => ({ ...p, effects }));
        clearTimeout(fxTimer.current);
        if (reorder || waiting) {
            setWaiting(!!client && ready);
            fxTimer.current = setTimeout(() => { setWaiting(false); queue('fx', () => client!.effects(effects)); }, 1000);
        }
        else
            queue('fx', () => client!.effects(effects));
    };
    const control = (id: number) => {
        const max = parameterMaximum(engine, id), base = preset.patch.parameters[id], label = parameterName(engine, id), continuous = continuousParameter(engine, id), r = preset.patch.routes.slice(source * 4, source * 4 + 4).find(r => r.destination === id), modulating = tool === 'modulate' && continuous;
        const routes = preset.patch.routes.flatMap((r, i) => r.destination === id ? [{ label: sourceLabels[Math.floor(i / 4)], i: Math.floor(i / 4), depth: r.depth }] : []);
        const options = continuous ? undefined : engine === 4 ? (id === 25 ? Array.from({ length: 49 }, (_, i) => ({ value: Math.round(i * 65535 / 48), label: `${i - 24} st` })) : [{ value: 0, label: id === 26 ? 'Envelope' : 'Positive' }, { value: 65535, label: id === 26 ? 'Gate' : 'Negative' }]) : id === 134 ? Array.from({ length: 32 }, (_, i) => ({ value: i, label: `Algorithm ${i + 1}` })) : id === 142 ? ['Triangle', 'Fall', 'Rise', 'Square', 'Sine', 'Random'].map((label, value) => ({ label, value })) : id < 126 && id % 21 === 17 ? [{ value: 0, label: 'Ratio' }, { value: 1, label: 'Fixed Hz' }] : id < 126 && [11, 12].includes(id % 21) ? ['− Linear', '− Exponential', '+ Exponential', '+ Linear'].map((label, value) => ({ label, value })) : max === 1 ? [{ value: 0, label: 'Free' }, { value: 1, label: 'Restart' }] : undefined;
        return <div className="physical-control" key={id} data-unavailable={tool === 'modulate' && !continuous || undefined} onClick={() => {
                if (tool === 'delete') {
                    const r = preset.patch.routes.findIndex(r => r.destination === id);
                    if (r >= 0) {
                        const next = structuredClone(preset.patch);
                        next.routes[r] = { destination: 65535, depth: 0 };
                        setPreset(p => ({ ...p, patch: next }));
                        queue(`r${r}`, () => client!.routeAdvanced(r, 65535, 0));
                    }
                }
                if (tool === 'modulate')
                    setSourceEditor(undefined);
            }}><strong>{label}</strong>
   {continuous ? <PreviewValues ids={[id]}>{([effective]) => <Knob label={label} value={modulating ? r?.depth ?? 0 : base} min={modulating ? -65536 : 0} max={modulating ? 65536 : max} baseValue={Math.round(base / max * 65535)} effectiveValue={effective} routes={routes} disabled={busy || tool === 'delete'} onChange={v => modulating ? route(id, Math.round(v)) : edit(id, Math.round(v))} onRelease={() => {
                    if (modulating)
                        setTool('value');
                }}/>}</PreviewValues> : options ? <select aria-label={label} value={base} disabled={busy || tool !== 'value'} onChange={e => edit(id, +e.target.value)}>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select> : <input aria-label={label} type="number" min={0} max={max} step={1} value={base} disabled={busy || tool !== 'value'} onChange={e => edit(id, Math.max(0, Math.min(max, Math.round(+e.target.value))))}/>}
   <output>{modulating ? `${Math.round((r?.depth ?? 0) / 65536 * 100)}%` : engine === 4 ? id === 6 ? `${Math.round(65 * 2 ** (8 * base / 65535))} Hz` : id === 20 ? `${(.05 * 2 ** (8.65 * base / 65535)).toFixed(2)} Hz` : id === 25 ? `${Math.round(base * 48 / 65535) - 24} st` : `${Math.round(base / max * 100)}%` : id === 134 ? `${base + 1}` : base}</output><div className="knob-routes">{routes.map(r => <button key={r.i} title="Remove assignment" disabled={busy} style={{ color: sourceColors[r.i] }} onClick={e => { e.stopPropagation(); const at = preset.patch.routes.findIndex((v, i) => v.destination === id && Math.floor(i / 4) === r.i); const next = structuredClone(preset.patch); next.routes[at] = { destination: 65535, depth: 0 }; setPreset(p => ({ ...p, patch: next })); queue(`r${at}`, () => client!.routeAdvanced(at, 65535, 0)); }}>{sourceShortNames[r.i]} {Math.round(r.depth / 65536 * 100)}%</button>)}</div></div>;
    };
    const group = (name: string, ids: number[]) => <fieldset disabled={busy}><legend>{name}</legend><div className="knob-bank">{ids.map(control)}</div></fieldset>;
    return <PreviewContext.Provider value={visual}><section ref={root} className={`card physical-editor classic-editor ${engine === 4 ? 'juno-editor' : 'dx7-editor'}`} style={{ '--modulation-cursor': modulationCursor(source), '--modulation-color': sourceColors[source] } as CSSProperties} data-modulating={tool === 'modulate' || undefined} aria-label={engine === 4 ? 'Juno editor' : 'DX7 editor'}>
 <PerformanceRow transport={transport} disabled={busy} physical={false}/>
 <div className="modulation-toolbar" role="toolbar" aria-label="Modulation tools"><button aria-pressed={tool === 'value'} onClick={() => { setTool('value'); setSourceEditor(undefined); }}>Edit values</button>{sourceLabels.map((label, i) => <button key={i} style={{ borderColor: sourceColors[i] }} aria-pressed={tool === 'modulate' && source === i} onClick={() => { setSource(i); setTool(i >= 5 && i < 7 ? 'value' : 'modulate'); setSourceEditor(i < 7 ? i : undefined); }}><span className="source-dot" style={{ background: sourceColors[i] }}/>{label}<span className="source-route-count">{preset.patch.routes.slice(i * 4, i * 4 + 4).filter(r => r.destination !== 65535).length}/4</span></button>)}<button aria-pressed={tool === 'delete'} onClick={() => setTool('delete')}>Delete modulation</button><small>{tool === 'modulate' ? `${sourceLabels[source]} → drag a knob · release to return to Edit values` : 'Drag knobs up / down · Shift for fine adjustment'}</small>
 {sourceEditor !== undefined && sourceEditor < 5 && <ModSourceEditor source={sourceEditor} settings={preset.patch.settings} disabled={busy} onChange={(id, v) => edit(148 + id, v)} onClose={() => setSourceEditor(undefined)} onAssign={() => { setTool('modulate'); setSourceEditor(undefined); }} renderControl={(id, label) => <label className="physical-control">{label}<Knob label={label} value={preset.patch.settings[id]} onChange={v => edit(148 + id, Math.round(v))}/></label>}/>}{sourceEditor !== undefined && sourceEditor >= 5 && <div className="mod-source-editor native-source-editor" role="dialog" aria-label={sourceEditor === 5 ? "Envelope source editor" : "LFO source editor"}><header><strong>{sourceEditor === 5 ? "Envelope" : "LFO"}</strong><button aria-label="Close source editor" onClick={() => setSourceEditor(undefined)}>×</button></header>
 {sourceEditor === 5 && <div className="native-source"><label>Envelope source<select aria-label="Envelope source" disabled={busy} value={engine === 4 ? (preset.patch.settings[5] >= 32768 ? 65535 : 0) : Math.round(preset.patch.settings[5] / 13107) * 13107} onChange={e => edit(153, +e.target.value)}>{engine === 4 ? <><option value={0}>Amplitude envelope</option><option value={65535}>Filter envelope</option></> : Array.from({ length: 6 }, (_, i) => <option value={i * 13107} key={i}>OP{i + 1} envelope</option>)}</select></label><p className="panel-note">Uses the voice envelope shown in the sound controls. Each note has its own envelope.</p><button disabled={busy} onClick={() => { setTool('modulate'); setSourceEditor(undefined); }}>Assign to controls</button></div>}
 {sourceEditor === 6 && <div className="native-source"><p className="panel-note">The engine's LFO also drives every LFO assignment.</p>{group('LFO', engine === 4 ? [20, 21, 22] : [137, 138, 139, 140, 141, 142, 143])}{engine === 4 && <><label>Waveform<select aria-label="LFO waveform" disabled={busy} value={preset.patch.settings[9]} onChange={e => edit(157, +e.target.value)}>{['Sine', 'Triangle', 'Rise', 'Fall', 'Square', 'Random'].map((n, i) => <option key={n} value={i * 13107}>{n}</option>)}</select></label><label><input type="checkbox" checked={!!preset.patch.settings[10]} disabled={busy} onChange={e => edit(158, e.target.checked ? 65535 : 0)}/>Restart each note</label></>}<button disabled={busy} onClick={() => { setTool('modulate'); setSourceEditor(undefined); }}>Assign to controls</button></div>}
 </div>}</div>
 <div className="physical-heading"><div><p className="eyebrow">HexBoard Advanced</p><h2>{engine === 4 ? 'Juno' : 'DX7'}</h2><p>{engine === 4 ? 'Analog color, shaped by touch.' : 'Six operators, played with expression.'}</p></div><PresetLibrary preset={preset} client={ready?client:undefined} disabled={busy} onRename={name=>setPreset(p=>({...p,name}))} onBusy={v=>{if(v){edits.current.clear();clearTimeout(fxTimer.current);}busyRef.current=v;setLoading(v);}} onLoad={async p=>{if(p.format!=='hexboard.advanced.v2'||p.engine!==engine)throw Error('Select the matching engine.');await apply(p);}} onDeviceLoad={async(next,name)=>{edits.current.clear();clearTimeout(fxTimer.current);retained.current=true;const value=await client!.readSound(name);if(next!==engine){writeStoredText(localStorage, next<4?'hexboard.physical.draft.v1':`hexboard.advanced.${next}.draft`,JSON.stringify(value));onDeviceEngineLoaded?.((next===3?2:next) as 2|4|5);return;}if(value.format!=='hexboard.advanced.v2')return;setPreset(value);setState((await client!.status()).state==='playing'?1:0);}}/>{engine===5&&<button disabled={busy} onClick={()=>void apply(addExpression(preset))}>Add Advanced expression</button>}</div>
 {preset.conversionNotes?.length ? <details className="preset-conversion"><summary>AMY conversion notes</summary>{preset.conversionNotes.map(note => <p key={note}>{note}</p>)}</details> : null}
 <p className={`synth-message${failed ? ' error' : ''}`} role="status">{message}</p>{(progress || loading) && <SynthProgress progress={progress ?? { label: "Updating synth…" }}/>}
 <div className="synth-playbar"><div><strong>{state ? 'Synth playing' : 'Synth stopped'}</strong><small>{!transport ? 'Connect Advanced to audition presets.' : 'Load or Preview draft saves this as your startup sound.'}</small></div><div className="button-row"><button className="synth-start" disabled={!ready || busy || state === 1} onClick={() => void operation(async () => { await client!.loadClassic(preset); await client!.start(engine); setState(1); })}>Start synth</button><button disabled={!ready || busy || !state} onClick={() => void operation(async () => { await client!.stop(); setState(0); })}>Stop synth</button><button disabled={!ready || busy} onClick={() => void apply(preset)}>Preview draft</button>{failed && transport && <button onClick={() => setRetry(v => v + 1)}>Retry connection</button>}</div></div>
 <VoiceBudgetEditor preset={preset} busy={busy} testing={!!progress && /voic/.test(progress.label)} connected={!!client && ready} onCancel={() => void client?.cancelVoiceTest().catch(fail)} onInvalidate={() => {
            setPreset(p => ({ ...p, voiceBudget: undefined }));
            if (client && ready)
                void client.resetVoiceBudget().catch(fail);
        }} onTest={() => { setPreset(p => ({ ...p, voiceBudget: undefined })); void operation(async () => { const value = await client!.testVoiceLimit(preset); setPreset(value); setState(0); setMessage(`${value.voiceBudget.voices} voices tested. Save this sound in Presets to keep the result.`); }); }}/>
 <div className="physical-workspace"><div className="instrument-workspace">
 {engine === 4 ? <>{group('Oscillator', [0, 1, 2, 3, 4, 5, 24, 25])}{group('Filter', [6, 8, 9, 10, 11, 27])}{group('Amplitude envelope', [12, 13, 14, 15, 26])}{group('Filter envelope', [16, 17, 18, 19])}{group('Voice', [23])}</> : <><fieldset><legend>Algorithm {preset.patch.parameters[134] + 1}</legend><AlgorithmDiagram algorithm={preset.patch.parameters[134] + 1} selected={operator} onSelect={setOperator}/><div className="knob-bank">{[134, 135, 136].map(control)}</div></fieldset><fieldset disabled={busy}><legend>Operators</legend><div className="source-tabs">{[0, 1, 2, 3, 4, 5].map(i => <button key={i} aria-pressed={operator === i} onClick={() => setOperator(i)}>OP{6 - i}</button>)}</div><div className="knob-bank">{Array.from({ length: 21 }, (_, i) => control(operator * 21 + i))}</div></fieldset>{group('Pitch envelope', Array.from({ length: 8 }, (_, i) => 126 + i))}{group('Voice', [144, 146, 147])}</>}
 {group('Output', [engine === 4 ? 7 : 145])}<fieldset disabled={busy}><legend>Expression</legend>{sourceLabels.map((label, i) => <div className="source-meter" key={label}><span>{label}{i >= 5 ? ' · preview' : ''}</span><PreviewSource id={i}>{value => <><meter min={i === 3 || i === 4 || i === 6 ? -1 : 0} max={1} value={value}/><output aria-live="off">{Math.round(value * 100)}%</output></>}</PreviewSource></div>)}{!client && <label className="physical-control">Pressure preview<Knob label="Pressure preview" value={pressure} onChange={v => setPressure(Math.round(v))}/></label>}{client && <><PreviewExpression>{live => <button disabled={!live?.motionValid} onClick={() => void client.zeroMotion().catch(fail)}>Set tilt neutral</button>}</PreviewExpression><label className="physical-control">Global pitch bend<Knob label="Global pitch bend" min={-2} max={2} value={bend} onChange={v => { setBend(v); queue('bend', () => client.bend(v)); }} onRelease={() => { setBend(0); queue('bend', () => client.bend(0)); }}/></label></>}</fieldset></div><div className="engine-side"><FxRackEditor available={classicEffects(engine)} rack={preset.effects} busy={busy} waiting={waiting} onChange={setEffects}/></div></div>
 <p className="editor-footnote">Pressure range: Calibration · Presets: computer / HexBoard · Rings: clockwise + / counterclockwise −</p></section></PreviewContext.Provider>;
}
