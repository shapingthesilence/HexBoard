import {defaultFx,validateFx,type FxRack,modulationSeconds} from './schema.ts';
import {fxRoutePatch} from './fxRouting.ts';
// Wavetable patch: mirrors Advanced src/synth/wavetable_patch.h. Normalized U16
// parameters, two envelope/LFO banks in the Physical Strings layout and sparse
// source -> parameter routes, carried on the generic engine transport.
export const wavetableEngine = 7, wavetableSchema = 3;  // 3: table identity and unison controls
export const P = {
  Frame: 0, FrameSpread: 1, Unison: 2, Detune: 3, Width: 4, WarpMode: 5, WarpAmount: 6, WarpBias: 7, Brightness: 8,
  Noise: 9, Transient: 10, TransientShape: 11, Sub: 12, SubOctave: 13, SubShape: 14,
  Cutoff: 15, Resonance: 16, FilterMode: 17, KeyTrack: 18, FilterEnvelope: 19,
  AmpAttack: 20, AmpDecay: 21, AmpSustain: 22, AmpRelease: 23,
  Resonator: 24, ResonatorMix: 25, ResonatorTune: 26, ResonatorDecay: 27,
  Level: 28, Classic: 29, EdgeBlend: 30, PhaseMode: 31, TableLow: 32, TableHigh: 33
} as const;
export const parameterCount = 34, modSettingCount = 16, routeCount = 16;
export const editCount = parameterCount + 2 * modSettingCount, wordCount = editCount + 2 * routeCount;
export const S = {Velocity: 0, Pressure: 1, Release: 2, TiltX: 3, TiltY: 4, Env1: 5, Lfo1: 6, Env2: 7, Lfo2: 8, Joystick: 9, Pedal: 10} as const;
export const sourceCount = 11;
export const wavetableSources = ['Strike velocity', 'Key pressure', 'Release velocity', 'X tilt', 'Y tilt', 'Envelope 1', 'LFO 1', 'Envelope 2', 'LFO 2', 'Joystick Mod', 'Expression'] as const;
export const wavetableSourceShort = ['Strike', 'Pressure', 'Release', 'X tilt', 'Y tilt', 'Env 1', 'LFO 1', 'Env 2', 'LFO 2', 'Joystick', 'Expression'];
// Shared sources keep Physical Strings colors; the second envelope/LFO get their own.
export const wavetableSourceColors = ['#efb86b', '#5cdac6', '#b29aff', '#70b8ff', '#ef8eb8', '#f3cf6e', '#91aaff', '#ff9f73', '#62d6ec', '#f39cce', '#a7dc82'];
export const warpNames = ['Off', 'Fold', 'Poly', 'Duty', 'Sync'] as const;
export const resonatorNames = ['Off', 'Comb', 'Bell', 'Marimba'] as const;
export const filterNames = ['Low-pass', 'Band-pass', 'High-pass'] as const;
export const transientNames = ['Pick', 'Mallet', 'Breath'] as const;
export const shapeNames = ['Sine', 'Triangle', 'Saw', 'Square'] as const;
const optionCounts: Record<number, number> = {[P.Unison]: 7, [P.WarpMode]: 5, [P.TransientShape]: 3, [P.SubOctave]: 2, [P.SubShape]: 2, [P.FilterMode]: 3, [P.Resonator]: 4, [P.Classic]: 2,[P.PhaseMode]:3};
export const options = (id: number) => optionCounts[id] ?? 0;
export const discrete = (id: number) => options(id) !== 0;
export function option(id: number, value: number) { const n = options(id); return n < 2 ? 0 : Math.floor((value * (n - 1) + 32767) / 65535); }
export function optionValue(id: number, choice: number) { const n = options(id); return n < 2 ? 0 : Math.floor(choice * 65535 / (n - 1)); }
export const modulatable = (id: number, _source?: number) => id >= 0 && id < P.TableLow && !discrete(id) && id !== P.Classic;
export const validModSetting = (id: number, v: number) => Number.isInteger(v) && v >= 0 && v <= 65535 && ((id !== 7 && id !== 10 && id !== 14) || v === 0 || v === 65535) && (id !== 9 || v % 13107 === 0);
/** Bipolar: signed sources move the target both ways around its base value. */
export const bipolarSource = (source: number, p?: WavetablePatch) => source === S.TiltX || source === S.TiltY || source === S.Joystick || ((source === S.Lfo1 || source === S.Lfo2) && !p?.mod[source === S.Lfo1 ? 0 : 1][14]);

export interface WavetableRoute {source: number; destination: number; depth: number}
export interface WavetablePatch {parameters: number[]; mod: [number[], number[]]; routes: WavetableRoute[]}
export const wavetableFormat = 'hexboard.wavetable.v3';
export interface WavetablePreset extends WavetablePatch {format: typeof wavetableFormat; name: string; effects: FxRack; table?: {id:string;name:string}}
/** New wavetable sounds start with the two-voice Ensemble in the shared FX rack. */
export const wavetableDefaultFx = (): FxRack => ({...defaultFx(), order: [6]});
const unused = (): WavetableRoute => ({source: sourceCount, destination: 0, depth: 0});

export function validWavetable(p: WavetablePatch): boolean {
  if (!Array.isArray(p.parameters) || p.parameters.length !== parameterCount || p.parameters.some(v => !Number.isInteger(v) || v < 0 || v > 65535)) return false;
  if (!Array.isArray(p.mod) || p.mod.length !== 2 || p.mod.some(m => !Array.isArray(m) || m.length !== modSettingCount || m.some((v, i) => !validModSetting(i, v)))) return false;
  if (!Array.isArray(p.routes) || p.routes.length !== routeCount) return false;
  return p.routes.every(r => Number.isInteger(r.source) && Number.isInteger(r.destination) && Number.isInteger(r.depth) && (r.source === sourceCount ? r.depth === 0 : r.source >= 0 && r.source < sourceCount && modulatable(r.destination, r.source) && r.depth >= -65536 && r.depth <= 65536));
}
// Times use StringModulation::seconds: 0 = instant, else 1 ms * e^(9.9 v).
const defaultMod = [30000, 42000, 32768, 40000, 0, 0, 32768, 0, 26000, 0, 65535, 0, 0, 0, 0, 0];
export function initialWavetable(): WavetablePatch {
  const routes = Array.from({length: routeCount}, unused);
  routes[0] = {source: S.Pressure, destination: P.Frame, depth: 26000};
  routes[1] = {source: S.Velocity, destination: P.Cutoff, depth: 0};
  return {
    parameters: [22000, 8000, optionValue(P.Unison, 2), 23600, 65535, 0, 0, 65535, 65535,
      0, 0, 0, 0, 0, 0,
      65535, 6000, 0, 0, 32768,
      10650, 37740, 52428, 37740,
      0, 26000, 0, 40000,
      46000, 0, 65535, 0, 0, 0],
    mod: [[...defaultMod], [...defaultMod]], routes
  };
}
function validTableRef(value:unknown):{id:string;name:string}|undefined {if(value===undefined)return undefined;const v=value as {id?:unknown;name?:unknown};if(!v||typeof v.id!=='string'||!v.id||v.id.length>100||typeof v.name!=='string'||!v.name||v.name.length>80)throw Error('Invalid table reference.');return {id:v.id,name:v.name};}
export const tableCrc=(p:WavetablePatch)=>(p.parameters[P.TableLow]|p.parameters[P.TableHigh]<<16)>>>0;
export function wavetableFromUnknown(value: unknown): WavetablePreset {
  const p = value as Partial<WavetablePreset> | undefined;
  if (!p || typeof p !== 'object' || p.format !== wavetableFormat) throw Error(`This file is not a current wavetable preset. Use ${wavetableFormat}.`);
  if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 80) throw Error('Give the preset a name.');
  const patch = {parameters: [...(p.parameters ?? [])], mod: [[...(p.mod?.[0] ?? [])], [...(p.mod?.[1] ?? [])]] as [number[], number[]], routes: (p.routes ?? []).map(r => ({...r}))};
  if (!validWavetable(patch)) throw Error('This wavetable preset has invalid settings or routes.');
  return {format: wavetableFormat, name: p.name.trim(), table:validTableRef(p.table), effects:validateFx(p.effects ?? wavetableDefaultFx()), ...patch};
}
export const wavetablePreset = (name: string, patch: WavetablePatch): WavetablePreset => ({format: wavetableFormat, name, table:validTableRef('table' in patch ? patch.table : undefined), effects:validateFx('effects' in patch ? patch.effects : wavetableDefaultFx()), parameters: [...patch.parameters], mod: [[...patch.mod[0]], [...patch.mod[1]]], routes: patch.routes.map(r => ({...r}))});
export const sameWavetable = (a: WavetablePreset, b: WavetablePreset) => a.name === b.name && JSON.stringify([a.parameters, a.mod, a.routes,a.effects,a.table]) === JSON.stringify([b.parameters, b.mod, b.routes,b.effects,b.table]);

// Word layout: parameters, Mod 1, Mod 2, then per route source << 8 | destination
// and depth + 65536.
export const routeKey = (source: number, destination: number) => source * 256 + destination;
export function wavetableWords(p: WavetablePatch): number[] {
  return [...p.parameters, ...p.mod[0], ...p.mod[1], ...p.routes.flatMap(r => [routeKey(r.source, r.destination), r.depth + 65536])];
}
export function wavetableFromWords(words: number[]): WavetablePatch {
  if (words.length !== wordCount) throw Error('Incomplete wavetable patch.');
  const patch: WavetablePatch = {parameters: words.slice(0, parameterCount), mod: [words.slice(parameterCount, parameterCount + 16), words.slice(parameterCount + 16, editCount)],
    routes: Array.from({length: routeCount}, (_, i) => { const key = words[editCount + i * 2]; const r = {source: key >> 8, destination: key & 255, depth: words[editCount + 1 + i * 2] - 65536}; return r.source >= sourceCount ? unused() : r; })};
  if (!validWavetable(patch)) throw Error('Invalid wavetable patch from the board.');
  return patch;
}

export function routeDepth(p: WavetablePatch, destination: number, source: number) { return p.routes.find(r => r.source === source && r.destination === destination)?.depth ?? 0; }
/** Set, change or clear one source -> destination depth. Undefined: all 16 routes in use. */
export function withRoute(p: WavetablePatch, destination: number, source: number, depth: number): {patch: WavetablePatch; index: number} | undefined {
  let index = p.routes.findIndex(r => r.source === source && r.destination === destination);
  if (index < 0 && depth === 0) return {patch: p, index: -1};
  // A zero-depth route is inert and its slot is free.
  if (index < 0) index = p.routes.findIndex(r => r.source === sourceCount || r.depth === 0);
  if (index < 0) return undefined;
  const routes = p.routes.map((r, i) => i === index ? (depth ? {source, destination, depth} : unused()) : r);
  return {patch: {...p, routes}, index};
}
export const routesUsed = (p: WavetablePatch) => p.routes.filter(r => r.source !== sourceCount && r.depth !== 0).length;
/** Values the board computes per voice: base + sum(source * depth), clamped. */
export function effectiveWavetable(p: WavetablePatch, sources: number[]): number[] {
  const values = p.parameters.map(v => v / 65535);
  for (const r of p.routes) if (r.source < sourceCount && r.destination < parameterCount) values[r.destination] += (sources[r.source] ?? 0) * r.depth / 65536;
  return values.map(v => Math.max(0, Math.min(1, v)));
}

const pct = (v: number) => `${Math.round(v / 65535 * 100)}%`;
const seconds = (v: number) => { const t = modulationSeconds(v); return t === 0 ? '0 ms' : t < 1 ? `${Math.round(t * 1000)} ms` : `${t.toFixed(2)} s`; };
export const cutoffHz = (v: number) => 20 * 2 ** (9.813781 * v);
const hz = (f: number) => f >= 1000 ? `${(f / 1000).toFixed(f >= 10000 ? 0 : 1)} kHz` : `${Math.round(f)} Hz`;
export function frameShape(position: number) {
  const x = 3 * position / 15, a = Math.min(2, Math.floor(x)), t = x - a;
  return t < .08 ? shapeNames[a] : t > .92 ? shapeNames[a + 1] : `${shapeNames[a]} → ${shapeNames[a + 1]}`;
}
export interface ParameterInfo {name: string; describe: (v: number) => string}
export const wavetableParameters: ParameterInfo[] = [
  {name: 'Frame', describe: v => `${(v / 65535 * 15 + 1).toFixed(1)} · ${frameShape(v / 65535 * 15)}`},
  {name: 'Frame spread', describe: v => `±${(v / 65535 * 4).toFixed(1)} frames`},
  {name: 'Voices', describe: v => `${option(P.Unison, v) + 1}`},
  {name: 'Detune', describe: v => `±${(v / 65535 * 50).toFixed(1)} cents`},
  {name: 'Width', describe: pct},
  {name: 'Warp', describe: v => warpNames[option(P.WarpMode, v)]},
  {name: 'Warp amount', describe: pct},
  {name: 'Alias guard', describe: pct},
  {name: 'Brightness', describe: v => { const n = Math.round(2 ** (8 * v / 65535)); return n <= 1 ? 'Fundamental' : `${n} harmonics`; }},
  {name: 'Noise', describe: pct},
  {name: 'Transient', describe: pct},
  {name: 'Transient shape', describe: v => transientNames[option(P.TransientShape, v)]},
  {name: 'Sub level', describe: pct},
  {name: 'Sub octave', describe: v => option(P.SubOctave, v) ? '−2 oct' : '−1 oct'},
  {name: 'Sub shape', describe: v => option(P.SubShape, v) ? 'Triangle' : 'Sine'},
  {name: 'Cutoff', describe: v => hz(cutoffHz(v / 65535))},
  {name: 'Resonance', describe: pct},
  {name: 'Filter mode', describe: v => filterNames[option(P.FilterMode, v)]},
  {name: 'Key track', describe: pct},
  {name: 'Env 1 → cutoff', describe: v => { const d = Math.round((v / 65535 - .5) * 200); return `${d > 0 ? '+' : ''}${d}%`; }},
  {name: 'Attack', describe: seconds},
  {name: 'Decay', describe: seconds},
  {name: 'Sustain', describe: pct},
  {name: 'Release', describe: seconds},
  {name: 'Resonator', describe: v => resonatorNames[option(P.Resonator, v)]},
  {name: 'Resonator mix', describe: pct},
  {name: 'Tune', describe: v => `×${(2 ** (3 * v / 65535)).toFixed(2)}`},
  {name: 'Ring', describe: v => `${(.2 * 2 ** (4 * v / 65535)).toFixed(2)} s`},
  {name: 'Level', describe: v => { const g = (v / 65535) ** 2; return g <= 0 ? '−∞ dB' : `${(20 * Math.log10(g)).toFixed(1)} dB`; }},
  {name: 'Classic stepping', describe: v => v ? 'On' : 'Off'},
  {name: 'Edge blend', describe: pct},
  {name: 'Start phase', describe: v => ['Random','Reset','Evenly spread'][option(P.PhaseMode,v)]},
  {name: 'Table identity', describe: v => String(v)},
  {name: 'Table identity', describe: v => String(v)}
];
export function warpAmountDescription(mode: number, v: number) { return mode === 4 ? `×${(1 + 7 * v / 65535).toFixed(2)} sync` : pct(v); }

// Factory sounds: each stays valid and within the measured combined workload.
const preset = (name: string, values: Record<number, number>, routes: WavetableRoute[] = [], mod?: [Record<number, number>?, Record<number, number>?], effects: FxRack = wavetableDefaultFx()): WavetablePreset => {
  const p: WavetablePatch & {effects: FxRack; table?: {id:string;name:string}} = {...initialWavetable(), effects};
  for (const [id, v] of Object.entries(values)) p.parameters[Number(id)] = v;
  p.routes = Array.from({length: routeCount}, (_, i) => routes[i] ? {...routes[i]} : unused());
  mod?.forEach((m, bank) => { if (m) for (const [id, v] of Object.entries(m)) p.mod[bank][Number(id)] = v; });
  return wavetablePreset(name, p);
};
const o = optionValue;
// Ensemble rack: voices 0 Duo / 1 Quad, at the default mix and rate.
const ensembleRack = (voices: number, width = 52000): FxRack => { const f = wavetableDefaultFx(); f.values[6] = [32768, width, voices, 32768]; return f; };
export const factoryWavetablePresets: WavetablePreset[] = [
  wavetablePreset('Pressure Scan', initialWavetable()),
  preset('Glass Pad', {[P.Frame]: 9000, [P.FrameSpread]: 26000, [P.Unison]: o(P.Unison, 4), [P.Detune]: 30000, [P.Brightness]: 52000, [P.Cutoff]: 52000, [P.Resonance]: 9000, [P.AmpAttack]: 40000, [P.AmpRelease]: 48000},
    [{source: S.Pressure, destination: P.Frame, depth: 30000}, {source: S.Lfo1, destination: P.FrameSpread, depth: 12000}], [{8: 15000}],
    fxRoutePatch(ensembleRack(1, 62000), 25, 3, 20000)),
  preset('Fold Lead', {[P.Frame]: 30000, [P.Unison]: o(P.Unison, 2), [P.Detune]: 14000, [P.WarpMode]: o(P.WarpMode, 1), [P.WarpAmount]: 22000, [P.Cutoff]: 47000, [P.Resonance]: 22000, [P.FilterEnvelope]: 44000, [P.AmpAttack]: 0, [P.AmpSustain]: 56000},
    [{source: S.Pressure, destination: P.WarpAmount, depth: 38000}, {source: S.Lfo1, destination: P.WarpAmount, depth: 6000}, {source: S.Velocity, destination: P.Cutoff, depth: 9000}], [{0: 0, 1: 30000, 2: 0, 3: 26000, 8: 33000}]),
  preset('Sync Bass', {[P.Frame]: 44000, [P.Unison]: 0, [P.WarpMode]: o(P.WarpMode, 4), [P.WarpAmount]: 9000, [P.Sub]: 42000, [P.Cutoff]: 38000, [P.Resonance]: 16000, [P.FilterEnvelope]: 52000, [P.KeyTrack]: 30000, [P.AmpAttack]: 0, [P.AmpDecay]: 34000, [P.AmpSustain]: 46000, [P.AmpRelease]: 26000},
    [{source: S.Pressure, destination: P.WarpAmount, depth: 36000}, {source: S.Env1, destination: P.WarpAmount, depth: 14000}], [{0: 0, 1: 31000, 2: 0, 3: 28000}], defaultFx()),
  preset('Bell Keys', {[P.Frame]: 6000, [P.Unison]: o(P.Unison, 1), [P.Detune]: 9000, [P.Transient]: 30000, [P.TransientShape]: o(P.TransientShape, 1), [P.Resonator]: o(P.Resonator, 2), [P.ResonatorMix]: 34000, [P.ResonatorDecay]: 42000, [P.AmpAttack]: 0, [P.AmpDecay]: 46000, [P.AmpSustain]: 12000, [P.AmpRelease]: 44000},
    [{source: S.Velocity, destination: P.Transient, depth: 24000}, {source: S.Pressure, destination: P.ResonatorDecay, depth: 18000}, {source: S.Pressure, destination: P.Frame, depth: 16000}]),
  preset('Breath Choir', {[P.Frame]: 3000, [P.FrameSpread]: 14000, [P.Unison]: o(P.Unison, 4), [P.Detune]: 20000, [P.Noise]: 15000, [P.Transient]: 20000, [P.TransientShape]: o(P.TransientShape, 2), [P.FilterMode]: o(P.FilterMode, 1), [P.Cutoff]: 41000, [P.Resonance]: 26000, [P.AmpAttack]: 43000, [P.AmpRelease]: 46000},
    [{source: S.Pressure, destination: P.Cutoff, depth: 14000}, {source: S.Lfo1, destination: P.Cutoff, depth: 3500}, {source: S.Pressure, destination: P.Noise, depth: 12000}], [{8: 31000}], ensembleRack(1)),
  preset('Comb Pluck', {[P.Frame]: 50000, [P.Unison]: 0, [P.Transient]: 38000, [P.Resonator]: o(P.Resonator, 1), [P.ResonatorMix]: 44000, [P.ResonatorDecay]: 34000, [P.Cutoff]: 50000, [P.AmpAttack]: 0, [P.AmpDecay]: 42000, [P.AmpSustain]: 0, [P.AmpRelease]: 36000},
    [{source: S.Velocity, destination: P.Transient, depth: 20000}, {source: S.Pressure, destination: P.ResonatorDecay, depth: 22000}])
];
