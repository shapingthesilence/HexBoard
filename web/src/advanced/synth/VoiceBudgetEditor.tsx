import { useEffect, useMemo, useRef } from 'react';
import { validVoiceBudget, type VoiceBudgetProfile } from './voiceBudget.ts';
export function VoiceBudgetEditor<T extends {
    voiceBudget?: VoiceBudgetProfile;
}>({ preset, busy, testing = false, connected, onTest, onCancel, onInvalidate }: {
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
    return <section className="voice-budget" aria-label="Preset voice budget"><div><strong>{valid ? `${valid.voices} tested voices` : '8 voices · test required'}</strong><small>{valid ? `Two tail slots · peak ${valid.peakUs} µs · saved with this preset` : 'Test this patch and FX rack for more voices. Any edit returns to eight.'}</small></div><button disabled={!connected || busy} onClick={onTest}>Test voice limit</button>{testing && <button onClick={onCancel}>Cancel voice test</button>}</section>;
}
