import {SamplerEditor} from "./SamplerEditor.tsx";
import { SynthProgress } from "./SynthProgress.tsx";
import type { SynthProgress as Progress } from "./progress.ts";
import { switchEstimate } from "./loadTiming.ts";
import { editorDraft } from "./editorDraft.ts";
import { useEffect, useState } from 'react';
import type { MidiTransport } from '../../midi/types.ts';
import { PhysicalSynthEditor } from './PhysicalSynthEditor.tsx';
import { ClassicSynthEditor } from './ClassicSynthEditor.tsx';
import { PhysicalSynthClient } from './client.ts';
import './ClassicSynthEditor.css';
export function AdvancedSynthEditor({ transport, engines = false, sampler = false }: {
    transport?: MidiTransport;
    engines?: boolean;
    sampler?: boolean;
}) {
    const [engine, setEngine] = useState<2 | 4 | 5 | 6>(2), [changing, setChanging] = useState(false), [error, setError] = useState(''), [progress, setProgress] = useState<Progress>();
    useEffect(() => { if (!transport || !engines)
        return; let disposed = false; const c = new PhysicalSynthClient(transport); void c.status().then(s => { if (!disposed)
        setEngine(s.instrument === 6 && sampler ? 6 : s.instrument === 4 ? 4 : s.instrument === 5 ? 5 : 2); }).catch(e => { if (!disposed)
        setError(String(e)); }).finally(() => c.close()); return () => { disposed = true; c.close(); }; }, [transport, engines, sampler]);
    const choose = async (next: 2 | 4 | 5 | 6) => {
        if (next === engine)
            return;
        setChanging(true);
        setError('');
        const targetPreset = next===6?undefined:editorDraft(next), startedAt = Date.now(), expectedMs = switchEstimate(engine, next, targetPreset?.voiceBudget?.voices ?? 8);
        const report = (p?: Progress) => { if (p)
            setProgress({ label: p.label, startedAt, expectedMs }); };
        const c = transport ? new PhysicalSynthClient(transport, report, true) : undefined;
        try {
            if (c) {
                setProgress({ label: 'Stopping current engine…', startedAt, expectedMs });
                const resume = (await c.status()).state !== 'stopped';
                await c.stop();
                for (let i = 0; i < 100; i++) {
                    if ((await c.status()).state === 'stopped')
                        break;
                    await new Promise(r => setTimeout(r, 30));
                    if (i === 99)
                        throw Error('Synth did not stop.');
                }
                const preset = targetPreset;
                if (preset && preset.format === 'hexboard.advanced.v2')
                    await c.loadClassic(preset);
                else if(preset)
                    await c.load(preset);
                if (resume && next!==6)
                    await c.start(next);
            }
            setEngine(next);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
        finally {
            c?.close();
            setProgress(undefined);
            setChanging(false);
        }
    };
    return <><nav className="engine-selector" aria-label="Synth engine">{([[2, 'Physical Strings'], [4, 'Juno'], [5, 'DX7'], [6, 'Sampler']] as const).map(([id, name]) => <button key={id} aria-pressed={engine === id} disabled={changing || (id !== 2 && !engines && !!transport) || (id===6 && !!transport && !sampler)} onClick={() => void choose(id)}>{name}</button>)}</nav>{progress && <SynthProgress progress={progress}/>} {error && <p role="alert">{error}</p>}{engine===6?<SamplerEditor transport={changing?undefined:transport}/>:engine === 2 ? <PhysicalSynthEditor onDeviceEngineLoaded={setEngine} advanced={engines} key={`physical:${transport?.label}`} transport={changing ? undefined : transport}/> : <ClassicSynthEditor onDeviceEngineLoaded={setEngine} key={`${engine}:${transport?.label}`} engine={engine} transport={changing ? undefined : transport}/>}</>;
}
