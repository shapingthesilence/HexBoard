export type AdvancedEngine = 2 | 3 | 4 | 5;
export interface AdvancedRoute {
    destination: number;
    depth: number;
}
export const advancedWordCount = 220;
export interface AdvancedPatch {
    engine: AdvancedEngine;
    parameters: number[];
    settings: number[];
    routes: AdvancedRoute[];
}
export const parameterCount = (e: number) => e === 4 ? 28 : e === 5 ? 148 : 33;
export function parameterMaximum(e: number, id: number) {
    if (id >= parameterCount(e))
        return 0;
    if (e !== 5 || id >= 145)
        return 65535;
    if (id < 126)
        return ({ 11: 3, 12: 3, 13: 7, 14: 3, 15: 7, 17: 1, 18: 31, 20: 14 } as Record<number, number>)[id % 21] ?? 99;
    return ({ 134: 31, 135: 7, 136: 1, 141: 1, 142: 5, 143: 7, 144: 48 } as Record<number, number>)[id] ?? 99;
}
export function continuousParameter(e: number, id: number) {
    if (id < 0 || id >= parameterCount(e))
        return false;
    return e === 4 ? ![25, 26, 27].includes(id) : e === 5 ? id >= 145 || (id < 126 ? ![11, 12, 17].includes(id % 21) : ![134, 136, 141, 142, 144].includes(id)) : ![8, 21, 27, 31].includes(id);
}
export function initialAdvanced(engine: AdvancedEngine): AdvancedPatch {
    const p: AdvancedPatch = { engine, parameters: Array(148).fill(0), settings: [14000, 30000, 42000, 34000, 0, 0, 32768, 0, 30000, 0, 65535, 0, 0, 0, 0, 0], routes: Array.from({ length: 28 }, () => ({ destination: 65535, depth: 0 })) };
    if (engine === 4)
        p.parameters.splice(0, 28, ...[65535, 65535, 9000, 0, 32768, 10000, 42000, 32768, 8000, 0, 16000, 30000, 14000, 30000, 45000, 24000, 14000, 30000, 45000, 24000, 30000, 0, 0, 30000, 32768, 32768, 0, 0]);
    if (engine === 5) {
        for (let op = 0; op < 6; op++) {
            const at = op * 21;
            for (let n = 0; n < 3; n++)
                p.parameters[at + n] = 80;
            p.parameters[at + 3] = 60;
            p.parameters[at + 4] = 99;
            p.parameters[at + 5] = 75;
            p.parameters[at + 6] = 60;
            p.parameters[at + 8] = 39;
            p.parameters[at + 16] = op === 5 ? 99 : 75;
            p.parameters[at + 18] = 1;
            p.parameters[at + 20] = 7;
        }
        for (let i = 0; i < 4; i++) {
            p.parameters[126 + i] = 99;
            p.parameters[130 + i] = 50;
        }
        Object.entries({ 134: 4, 137: 35, 141: 1, 142: 4, 144: 24, 145: 32768, 146: 30000, 147: 32768 }).forEach(([id, v]) => p.parameters[+id] = v);
    }
    return p;
}
const integer = (v: unknown, low: number, high: number): v is number => Number.isInteger(v) && Number(v) >= low && Number(v) <= high;
export function validateAdvanced(value: unknown): AdvancedPatch {
    const p = value as AdvancedPatch;
    if (!p || ![2, 3, 4, 5].includes(p.engine) || !Array.isArray(p.parameters) || p.parameters.length !== 148 || p.parameters.some((v, i) => !integer(v, 0, parameterMaximum(p.engine, i))) || !Array.isArray(p.settings) || p.settings.length !== 16 || p.settings.some((v, i) => !integer(v, 0, 65535) || [7, 10, 14].includes(i) && v !== 0 && v !== 65535 || i === 9 && v % 13107 !== 0) || !Array.isArray(p.routes) || p.routes.length !== 28)
        throw Error('Invalid Advanced engine settings.');
    for (let source = 0; source < 7; source++) {
        const seen = new Set<number>();
        for (const r of p.routes.slice(source * 4, source * 4 + 4)) {
            if (!r || !integer(r.destination, 0, 65535) || !integer(r.depth, -65536, 65536))
                throw Error('Invalid modulation route.');
            if (r.destination === 65535) {
                if (r.depth)
                    throw Error('Empty routes must have zero depth.');
                continue;
            }
            if (p.engine <= 3 || !continuousParameter(p.engine, r.destination) || seen.has(r.destination))
                throw Error('Invalid or duplicate modulation target.');
            seen.add(r.destination);
        }
    }
    return { engine: p.engine, parameters: [...p.parameters], settings: [...p.settings], routes: p.routes.map(r => ({ ...r })) };
}
export const advancedWords = (p: AdvancedPatch) => [...p.parameters, ...p.settings, ...p.routes.flatMap(r => [r.destination, r.depth + 65536])];
export function advancedFromWords(engine: AdvancedEngine, w: number[]) { if (w.length !== 220)
    throw Error('Incomplete engine readback.'); return validateAdvanced({ engine, parameters: w.slice(0, 148), settings: w.slice(148, 164), routes: Array.from({ length: 28 }, (_, i) => ({ destination: w[164 + 2 * i], depth: w[165 + 2 * i] - 65536 })) }); }
export function assignAdvanced(p: AdvancedPatch, source: number, destination: number, depth: number) {
    if (source < 0 || source >= 7 || !continuousParameter(p.engine, destination))
        throw Error('Choose a direct modulation source and sound control.');
    const next = validateAdvanced(p);
    const start = source * 4;
    let at = next.routes.findIndex((r, i) => i >= start && i < start + 4 && r.destination === destination);
    if (at < 0)
        at = next.routes.findIndex((r, i) => i >= start && i < start + 4 && r.destination === 65535);
    if (at < 0)
        throw Error('This source has four routes. Remove one before adding another.');
    next.routes[at] = depth === 0 ? { destination: 65535, depth: 0 } : { destination, depth };
    return { patch: validateAdvanced(next), index: at };
}
export function effectiveAdvanced(p: AdvancedPatch, sources: number[]) {
    const values = p.parameters.map((v, i) => v / (parameterMaximum(p.engine, i) || 1));
    for (let s = 0; s < 7; s++)
        for (const r of p.routes.slice(s * 4, s * 4 + 4))
            if (r.destination < parameterCount(p.engine))
                values[r.destination] += sources[s] * r.depth / 65536;
    return values.map(v => Math.max(0, Math.min(1, v)));
}
