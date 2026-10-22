export interface VoiceBudgetProfile {
    voices: number;
    signature: number;
    peakUs: number;
    revision: number;
    fingerprint: string;
}
export interface VoiceBudgetState {
    phase: number;
    voices: number;
    candidate: number;
    ceiling: number;
    engine: number;
    qualified: boolean;
    reason: number;
    signature: number;
    peakUs: number;
    revision: number;
}
const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'voiceBudget').sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)])) : v;
export function presetFingerprint(preset: unknown) { let h = 2166136261; for (const c of JSON.stringify(canonical(preset))) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
} return (h >>> 0).toString(16).padStart(8, '0'); }
export function validVoiceBudget(preset: unknown, profile: unknown): VoiceBudgetProfile | undefined { const p = profile as VoiceBudgetProfile, engine = (preset as {
    engine?: number;
})?.engine, mono=!!(((preset as {mono?:{flags:number}})?.mono?.flags??0)&3), ceiling = engine === 4 ? 18 : engine === 5 ? 13 : mono?1:8; if (!p || !Number.isInteger(p.voices) || p.voices < (mono?1:8) || p.voices > ceiling || !Number.isInteger(p.signature) || p.signature < 0 || p.signature > 0xffffffff || !Number.isInteger(p.peakUs) || p.peakUs < 1 || p.peakUs > 2873 || p.revision !== 3 || p.fingerprint !== presetFingerprint(preset))
    return; return { ...p }; }
export function attachVoiceBudget<T>(preset: T, result: VoiceBudgetState): T & {
    voiceBudget: VoiceBudgetProfile;
} { if (!result.qualified || result.phase !== 3)
    throw Error('This patch did not pass its DSP baseline. Reduce the patch or FX load and test again.'); return { ...preset, voiceBudget: { voices: result.voices, signature: result.signature, peakUs: result.peakUs, revision: result.revision, fingerprint: presetFingerprint(preset) } }; }
