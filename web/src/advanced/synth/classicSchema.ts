import { amyFactoryPresets } from './amyFactory.ts';
import { validVoiceBudget, type VoiceBudgetProfile } from "./voiceBudget.ts";
import { defaultFx, validateFx, type FxRack } from './schema.ts';
import { initialAdvanced, validateAdvanced, type AdvancedPatch } from './advancedSchema.ts';
export interface ClassicPreset {
    voiceBudget?: VoiceBudgetProfile;
    format: 'hexboard.advanced.v2';
    engine: 4 | 5;
    name: string;
    patch: AdvancedPatch;
    conversionNotes?: string[];
    factoryBank?: string;
    effects: FxRack;
    velocityEngine: 0 | 1 | 2 | 3 | 4;
}
export const classicEffects = (engine: number) => engine === 4 ? [1, 3, 4] : [1, 2, 3, 4];
export function initialClassic(engine: 4 | 5): ClassicPreset { return { format: 'hexboard.advanced.v2', engine, name: engine === 4 ? 'Juno Init' : 'DX7 Init', patch: initialAdvanced(engine), effects: defaultFx(), velocityEngine: 4 }; }
export function classicFromUnknown(value: unknown): ClassicPreset {
    const p = value as ClassicPreset;
    if (!p || p.format !== 'hexboard.advanced.v2' || ![4, 5].includes(p.engine) || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 80 || !Number.isInteger(p.velocityEngine) || p.velocityEngine < 0 || p.velocityEngine > 4)
        throw Error('Invalid Advanced preset.');
    const effects = validateFx(p.effects);
    if (effects.order.some(id => !classicEffects(p.engine).includes(id)))
        throw Error('Reverb is unavailable on Juno within its current performance budget.');
    const patch = validateAdvanced(p.patch);
    if (patch.engine !== p.engine)
        throw Error('Engine and patch do not match.');
    const notes = p.conversionNotes?.filter(n => typeof n === 'string').slice(0, 8);
    const result: ClassicPreset = { format: p.format, engine: p.engine, name: p.name.trim(), patch, effects, velocityEngine: p.velocityEngine, conversionNotes: notes, factoryBank: p.factoryBank };
    const voiceBudget = validVoiceBudget(result, p.voiceBudget);
    return { ...result, voiceBudget };
}
export const junoLabels = ['Saw', 'Pulse', 'Sub', 'Noise', 'Pulse width', 'PWM depth', 'Filter cutoff', 'Output level', 'Resonance', 'High-pass', 'Filter envelope', 'Keyboard tracking', 'Amp attack', 'Amp decay', 'Amp sustain', 'Amp release', 'Filter attack', 'Filter decay', 'Filter sustain', 'Filter release', 'Native LFO rate', 'Native LFO delay', 'Pitch LFO', 'Stereo spread', 'Detune', 'Transpose', 'Gate amp', 'Invert filter envelope'];
export const dxOperatorLabels = ['Rate 1', 'Rate 2', 'Rate 3', 'Rate 4', 'Level 1', 'Level 2', 'Level 3', 'Level 4', 'Breakpoint', 'Left depth', 'Right depth', 'Left curve', 'Right curve', 'Rate scaling', 'Amplitude sensitivity', 'Velocity sensitivity', 'Operator level', 'Fixed frequency', 'Coarse', 'Fine', 'Detune'];
export const dxGlobalLabels = ['Pitch rate 1', 'Pitch rate 2', 'Pitch rate 3', 'Pitch rate 4', 'Pitch level 1', 'Pitch level 2', 'Pitch level 3', 'Pitch level 4', 'Algorithm', 'Feedback', 'Oscillator sync', 'Native LFO speed', 'Native LFO delay', 'Pitch modulation', 'Amplitude modulation', 'LFO sync', 'LFO waveform', 'Pitch sensitivity', 'Transpose', 'Output level', 'Stereo spread', 'FM brightness'];
export function parameterName(engine: number, id: number) { return engine === 4 ? junoLabels[id] : id < 126 ? `OP${6 - Math.floor(id / 21)} ${dxOperatorLabels[id % 21]}` : dxGlobalLabels[id - 126]; }
export function addExpression(preset: ClassicPreset) {
    const p = classicFromUnknown(preset), p1 = p.engine === 4 ? 6 : 147, p2 = p.engine === 4 ? 5 : 135;
    p.patch.routes[4] = { destination: p1, depth: 14000 };
    p.patch.routes[12] = { destination: p2, depth: 8000 };
    p.patch.routes[16] = { destination: p.engine === 4 ? 23 : 146, depth: 24000 };
    p.patch.routes[8] = { destination: p.engine === 4 ? 15 : 108, depth: p.engine === 4 ? -12000 : 12000 };
    return p;
}
export const factoryClassicPresets: ClassicPreset[] = [];
for (const engine of [4, 5] as const) {
    for (let i = 0; i < 6; i++) {
        const p = addExpression(initialClassic(engine));
        p.name = (engine === 4 ? ['Amber Pad', 'Moving Strings', 'Pressure Bass', 'Brass Reach', 'Soft Pluck', 'Tilt Current'] : ['Touch Electric', 'Glass Bell', 'FM Bass', 'Bright Brass', 'Orbital Pad', 'Metal Percussion'])[i];
        if (engine === 4) {
            Object.entries([{ 12: 33000, 15: 44000, 6: 32000 }, { 12: 25000, 15: 36000, 5: 26000 }, { 0: 0, 2: 48000, 6: 19000, 14: 44000, 25: 16384 }, { 10: 38000, 16: 26000, 6: 32000 }, { 12: 0, 14: 0, 13: 30000, 15: 20000, 10: 44000 }, { 5: 42000, 20: 42000, 23: 56000 }][i]).forEach(([k, v]) => p.patch.parameters[+k] = v!);
        }
        else {
            p.patch.parameters[134] = [4, 4, 0, 1, 31, 4][i];
            for (let op = 0; op < 6; op++) {
                p.patch.parameters[op * 21 + 18] = [1, 3, 1, 1, 1, 7][i] + (i === 1 ? op : 0);
                p.patch.parameters[op * 21 + 6] = i === 0 || i === 5 ? 0 : 75;
                p.patch.parameters[op * 21 + 2] = i === 4 ? 35 : 65;
            }
            if (i === 4)
                p.patch.parameters[146] = 50000;
        }
        p.effects.order = engine === 4 || i === 2 ? [4] : [4, 2];
        factoryClassicPresets.push(classicFromUnknown(p));
    }
}
factoryClassicPresets.push(...amyFactoryPresets().map(classicFromUnknown));
