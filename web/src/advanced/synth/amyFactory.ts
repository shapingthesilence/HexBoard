import bank from './amy-factory/bank.json';
import { initialAdvanced } from './advancedSchema.ts';
import { defaultFx } from './schema.ts';
import type { ClassicPreset } from './classicSchema.ts';
const unit = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 65535);
// Invert the existing Advanced control curves. This is a bank conversion,
// not a DSP change; unsupported ranges are disclosed on the loaded preset.
export function amyFactoryPresets(): ClassicPreset[] {
    const juno = (bank.juno as [
        string,
        number[],
        number
    ][]).map(([name, raw, gain], index) => {
        const patch = initialAdvanced(4), p = patch.parameters, x = raw.map(v => v / 127), switches = raw[16], flags = raw[17], notes = ['AMY Juno converted to Advanced controls; global EQ/HPF and chorus are approximations.'];
        const time = (seconds: number) => { if (seconds > 20)
            notes.push('An original envelope or LFO delay exceeds the 20-second control range and is limited.'); return seconds <= 0 ? 0 : unit(Math.log(seconds / .001) / 9.903488); };
        const env = [time((6 + 8 * raw[11]) / 1000), time((80 * 2 ** (.085 * raw[12]) - 80) / 1000), unit(x[13]), time((70 * 2 ** (.066 * raw[14]) - 70) / 1000)];
        const gainValue = x[10] * gain, minGain = .32 * 10 ** (-12 / 20), mixScale = Math.min(1, gainValue / minGain);
        p[0] = switches & 16 ? unit(mixScale) : 0;
        p[1] = switches & 8 ? unit(mixScale) : 0;
        p[2] = unit(x[15] * mixScale);
        p[3] = unit(x[4] * mixScale);
        p[4] = unit(((flags & 1 ? .5 + .5 * x[3] : .5) - .05) / .9);
        p[5] = flags & 1 ? 0 : unit(.5 * x[3] / .45);
        const cutoff = 13 * 2 ** (.0938 * raw[5] + .75 * x[9]);
        if (cutoff < 65 || cutoff > 16640)
            notes.push('Original filter cutoff is outside the Advanced 65–16640 Hz control range.');
        p[6] = unit(Math.log2(cutoff / 65) / 8);
        p[7] = unit((20 * Math.log10(Math.max(minGain, gainValue) / .32) + 12) / 24);
        p[8] = unit(x[6]);
        const hpf = [3, 2, 1, 0][(flags >> 3) & 3];
        p[9] = hpf <= 1 ? 0 : unit(hpf === 2 ? .4 : .65);
        if (11 * x[7] > 8)
            notes.push('Original filter-envelope depth exceeds eight octaves and is limited.');
        p[10] = unit(11 * x[7] / 8);
        p[11] = unit(x[9]);
        p.splice(12, 4, ...env);
        p.splice(16, 4, ...env);
        p[20] = unit(Math.log2((.6 * 2 ** (.04 * raw[0]) - .1) / .05) / 8.65);
        p[21] = time((18 * 2 ** (.066 * raw[1]) - 13) / 1000);
        p[22] = unit(x[2]);
        p[23] = 0;
        p[24] = 32768;
        p[25] = unit((switches & 1 ? 12 : switches & 4 ? 36 : 24) / 48);
        p[26] = flags & 4 ? 65535 : 0;
        p[27] = flags & 2 ? 65535 : 0;
        patch.settings[9] = 13107;
        patch.settings[10] = 0;
        // AMY's native filter LFO becomes a direct route from that same LFO.
        if (raw[8])
            patch.routes[24] = { destination: 6, depth: Math.round(1.25 * x[8] / 8 * 65536) };
        const effects = defaultFx(), chorus = [2, 0, 1, 0][switches >> 5];
        if (chorus) {
            effects.order = [4];
            effects.values[3] = [32768, unit(((chorus === 1 ? .5 : .83) - .1) / 2.9), unit(.5 / .95), 0];
        }
        return { format: 'hexboard.advanced.v2', engine: 4, name: `AMY Juno ${name}`, patch, effects, velocityEngine: 4, conversionNotes: [...new Set(notes)], factoryBank: index < 64 ? 'AMY Juno A' : 'AMY Juno B' } as ClassicPreset;
    });
    const dx7 = (bank.dx7 as [
        string,
        number[]
    ][]).map(([name, data], index) => {
        const patch = initialAdvanced(5);
        patch.parameters.splice(0, 145, ...data);
        patch.parameters[146] = 0;
        return { format: 'hexboard.advanced.v2', engine: 5, name: `AMY DX7 ${String(index + 1).padStart(4, '0')} · ${name}`, patch, effects: defaultFx(), velocityEngine: 4, factoryBank: index < 128 ? 'AMY DX7 built-ins' : `AMY DX7 additional ${1 + Math.floor((index - 128) / 128)}` } as ClassicPreset;
    });
    return [...juno, ...dx7];
}
