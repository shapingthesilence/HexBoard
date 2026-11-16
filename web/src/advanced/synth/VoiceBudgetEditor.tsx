import { useEffect, useMemo, useRef } from 'react';
import { validVoiceBudget, type VoiceBudgetProfile } from './voiceBudget.ts';
export function VoiceBudgetEditor<T extends {
    voiceBudget?: VoiceBudgetProfile;mono?:{flags:number};
}>({ preset, busy, testing = false, connected, onTest, onCancel, onInvalidate, dsp=false }: {
    dsp?:boolean;
    preset: T;
    busy: boolean;
    testing?: boolean;
    connected: boolean;
    onTest: () => void;
    onCancel: () => void;
    onInvalidate: () => void;
}) {
    const valid = useMemo(() => validVoiceBudget(preset, preset.voiceBudget), [preset]), invalid = preset.voiceBudget && !valid;
    const invalidator = useRef(onInvalidate);
    invalidator.current = onInvalidate;
    useEffect(() => { if (invalid)
        invalidator.current(); }, [invalid]);
    return <section className="voice-budget" aria-label="Preset voice budget"><div><strong>{valid ? valid.voices===1?'Mono · measured DSP':`${valid.voices} tested voices` : dsp?((preset.mono?.flags??0)&3?'Mono · estimated DSP budget':'8 voices · estimated DSP budget'):'8 voices · test required'}</strong><small>{valid ? `${valid.voices===1?"One string":"Two tail slots"} · peak ${valid.peakUs} µs · saved with this preset` : dsp?'Test the complete patch and FX rack on the board. Any sound edit invalidates the measurement.':'Test this patch and FX rack for more voices. Any edit returns to eight.'}</small></div><button disabled={!connected || busy} onClick={onTest}>{dsp?"Test DSP budget":"Test voice limit"}</button>{testing && <button onClick={onCancel}>Cancel voice test</button>}</section>;
}
