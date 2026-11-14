import {validateAttack,sampleChecksum,factoryAttackSamples,type AttackSample} from './wavetableAttack.ts';
import {validateMono, type MonoConfig} from './mono.ts';
import {curveBend, curveWord} from './envelopeCurve.ts';
import {defaultFx,validateFx,type FxRack,modulationSeconds} from './schema.ts';
import tableManifest from './wavetable/factory.json';
import {fxRoutePatch} from './fxRouting.ts';
// Wavetable patch: mirrors Advanced src/synth/wavetable_patch.h. Normalized U16
// parameters, two envelope/LFO banks in the Physical Strings layout and sparse
// source -> parameter routes, carried on the generic engine transport.
export const wavetableEngine = 7, wavetableSchema = 8;  // Voice drive and filter switch; current development format only.
export const P = {
  Frame: 0, FrameSpread: 1, Unison: 2, Detune: 3, Width: 4, WarpMode: 5, WarpAmount: 6, WarpBias: 7, Brightness: 8,
  Noise: 9, Transient: 10, TransientShape: 11, Sub: 12, SubPitchMode: 13, SubShape: 14,
  Cutoff: 15, Resonance: 16, FilterMode: 17, KeyTrack: 18, FilterEnvelope: 19,
  AmpAttack: 20, AmpDecay: 21, AmpSustain: 22, AmpRelease: 23,
  Resonator: 24, ResonatorMix: 25, ResonatorTune: 26, ResonatorDecay: 27,
  Level: 28, Classic: 29, EdgeBlend: 30, PhaseMode: 31, TableLow: 32, TableHigh: 33,
  // Amp envelope segment curves: 32768 is a straight line (envelopeCurve.ts).
  AmpAttackCurve: 34, AmpDecayCurve: 35, AmpReleaseCurve: 36,
  // Pitch: coarse +-24 semitones, fine +-100 cents (32768 unchanged).
  Coarse: 37, Fine: 38, SubCoarse: 39, SubFine: 40,
  // Second oscillator and its phase modulation of the wavetable (0..1 cycle).
  Osc2Shape: 41, Osc2Level: 42, Osc2Coarse: 43, Osc2Fine: 44, PhaseMod: 45,
  CarrierPitchMode:46, CarrierRatioNum:47, CarrierRatioDen:48, SubRatioNum:49, SubRatioDen:50,
  Osc2PitchMode:51, Osc2RatioNum:52, Osc2RatioDen:53, UnisonMode:54, BeatRate:55,
  StackPitchMode:56, StackInterval:57, StackRatioNum:58, StackRatioDen:59,
  BodyLevel:60, NaturalTuned:61, BodyMotion:62, BodyAir:63,
  Partial1Mode:64, Partial1Interval:65, Partial1Num:66, Partial1Den:67, Partial1Level:68, Partial1Decay:69, Partial1Pan:70,
  Partial2Mode:71, Partial2Interval:72, Partial2Num:73, Partial2Den:74, Partial2Level:75, Partial2Decay:76, Partial2Pan:77,
  Partial3Mode:78, Partial3Interval:79, Partial3Num:80, Partial3Den:81, Partial3Level:82, Partial3Decay:83, Partial3Pan:84,
  Partial4Mode:85, Partial4Interval:86, Partial4Num:87, Partial4Den:88, Partial4Level:89, Partial4Decay:90, Partial4Pan:91,
  AttackFrames:92,AttackCrcLow:93,AttackCrcHigh:94,AttackRoot:95,AttackPlayback:96,
  // Per-voice drive ahead of the filter, and the filter switch (0 = filter in use).
  DriveMode:97, Drive:98, FilterBypass:99
} as const;
export const parameterCount = 100, modSettingCount = 18, routeCount = 16;
export const editCount = parameterCount + 2 * modSettingCount, wordCount = editCount + 2 * routeCount;
export const S = {Velocity: 0, Pressure: 1, Release: 2, TiltX: 3, TiltY: 4, Env1: 5, Lfo1: 6, Env2: 7, Lfo2: 8, Joystick: 9, Pedal: 10} as const;
export const sourceCount = 11;
export const wavetableSources = ['Strike velocity', 'Key pressure', 'Release velocity', 'X tilt', 'Y tilt', 'Envelope 1', 'LFO 1', 'Envelope 2', 'LFO 2', 'Joystick Mod', 'Expression'] as const;
export const wavetableSourceShort = ['Strike', 'Pressure', 'Release', 'X tilt', 'Y tilt', 'Env 1', 'LFO 1', 'Env 2', 'LFO 2', 'Joystick', 'Expression'];
// Shared sources keep Physical Strings colors; the second envelope/LFO get their own.
export const wavetableSourceColors = ['#efb86b', '#5cdac6', '#b29aff', '#70b8ff', '#ef8eb8', '#f3cf6e', '#91aaff', '#ff9f73', '#62d6ec', '#f39cce', '#a7dc82'];
export const warpNames = ['Off', 'Fold', 'Poly', 'Duty', 'Sync'] as const;
export const resonatorNames = ['Off', 'Bell', 'Wood', 'Custom'] as const;
export const filterNames = ['Low-pass', 'Band-pass', 'High-pass'] as const;
export const driveNames = ['Off', 'Soft', 'Hard', 'Fold'] as const;
/** Drive pre-gain 2^(4 v) and the makeup that holds a loud note near its clean level. */
export const driveGain = (v: number) => 2 ** (4 * v);
export const driveMakeup = (v: number) => driveGain(v) ** -.25;
/** The board's drive curves: unity-slope cubic to +-1, hard clip, triangle fold. */
export function driveCurve(mode: number, x: number) {
  if (mode === 3) { const u = x + 1 - 4 * Math.floor((x + 1) / 4); return u < 2 ? u - 1 : 3 - u; }
  const a = Math.abs(x);
  if (mode === 2) return a < 1 ? x : Math.sign(x);
  return mode === 1 ? a < 1.5 ? x * (1 - 4 / 27 * a * a) : Math.sign(x) : x;
}
export const transientNames = ['Click', 'Tonal pop', 'Air puff', 'Custom sample'] as const;
export const shapeNames = ['Sine', 'Triangle', 'Saw', 'Square'] as const;
const optionCounts: Record<number, number> = {[P.Unison]: 7, [P.WarpMode]: 5, [P.TransientShape]: 4,[P.AttackPlayback]:2,[P.DriveMode]:4,[P.FilterBypass]:2, [P.SubShape]: 2, [P.FilterMode]: 3, [P.Resonator]: 4, [P.Classic]: 2,[P.PhaseMode]:3,[P.Osc2Shape]:5};
export const pitchNames = ['Cents', 'Ratio', 'Tuning steps', 'Tuning periods'] as const;
export const unisonNames = ['Cents', 'Beats / second', 'Interval stack'] as const;
export const bodyMotionNames = ['Continuous sweep', 'Snapped pitches', 'Crossfaded pitches', 'Partial levels'] as const;
export const partialField = (id:number) => id >= P.Partial1Mode && id < P.AttackFrames ? (id-P.Partial1Mode)%7 : -1;
const pitchModeIds=new Set<number>([P.CarrierPitchMode,P.SubPitchMode,P.Osc2PitchMode,P.StackPitchMode]);
export const isPitchMode = (id:number) => pitchModeIds.has(id) || partialField(id)===0;
const ratioIds=new Set<number>([P.CarrierRatioNum,P.CarrierRatioDen,P.SubRatioNum,P.SubRatioDen,P.Osc2RatioNum,P.Osc2RatioDen,P.StackRatioNum,P.StackRatioDen]);
export const isRatioWord = (id:number) => ratioIds.has(id) || partialField(id)===2 || partialField(id)===3;
export const options = (id: number) => isPitchMode(id)||id===P.BodyMotion?4:id===P.UnisonMode?3:optionCounts[id] ?? 0;
export const discrete = (id: number) => options(id) !== 0;
export function option(id: number, value: number) { const n = options(id); return n < 2 ? 0 : Math.floor((value * (n - 1) + 32767) / 65535); }
export function optionValue(id: number, choice: number) { const n = options(id); return n < 2 ? 0 : Math.floor(choice * 65535 / (n - 1)); }
export const modulatable = (id: number, _source?: number) => id >= 0 && (id < P.TableLow || (id >= P.Coarse && id < parameterCount)) && !discrete(id) && !isRatioWord(id) && id !== P.Classic && !(id>=P.AttackFrames&&id<=P.AttackRoot);
export const osc2Names = ['Sine', 'Triangle', 'Saw', 'Square', 'Noise'] as const;
/** Coarse +-24 semitones (32768 centered); whole-semitone base values. */
export const coarseSemitones = (v: number) => (v - 32768) / 32767 * 24;
export const coarseValue = (semitones: number) => Math.round(32768 + Math.max(-24, Math.min(24, Math.round(semitones))) * 32767 / 24);
export const validModSetting = (id: number, v: number) => Number.isInteger(v) && v >= 0 && v <= 65535 && ((id !== 7 && id !== 10 && id !== 14) || v === 0 || v === 65535) && (id !== 9 || v % 13107 === 0);
/** Bipolar: signed sources move the target both ways around its base value. */
export const bipolarSource = (source: number, p?: WavetablePatch) => source === S.TiltX || source === S.TiltY || source === S.Joystick || ((source === S.Lfo1 || source === S.Lfo2) && !p?.mod[source === S.Lfo1 ? 0 : 1][14]);

export interface WavetableRoute {source: number; destination: number; depth: number}
export interface WavetablePatch {parameters: number[]; mod: [number[], number[]]; routes: WavetableRoute[]}
export const wavetableFormat = 'hexboard.wavetable.v8';
/** mono: Physical Strings' shared voice mode, priority and glide. */
export interface WavetablePreset extends WavetablePatch {format: typeof wavetableFormat; name: string; effects: FxRack; table?: {id:string;name:string}; mono?: MonoConfig; attack?:AttackSample}
/** New wavetable sounds start with the two-voice Ensemble in the shared FX rack. */
export const wavetableDefaultFx = (): FxRack => ({...defaultFx(), order: [6]});
const unused = (): WavetableRoute => ({source: sourceCount, destination: 0, depth: 0});

export const attackCrc=(p:WavetablePatch)=>(p.parameters[P.AttackCrcLow]|p.parameters[P.AttackCrcHigh]<<16)>>>0;
export function validWavetable(p: WavetablePatch): boolean {
  if (!Array.isArray(p.parameters) || p.parameters.length !== parameterCount || p.parameters.some((v,i) => !Number.isInteger(v) || v < 0 || v > 65535 || (isRatioWord(i)&&v===0))) return false;
  if(p.parameters[P.AttackFrames]>4096||p.parameters[P.AttackFrames]===1||(!p.parameters[P.AttackFrames]&&attackCrc(p))||(option(P.TransientShape,p.parameters[P.TransientShape])===3&&p.parameters[P.AttackFrames]<2))return false;
  if (!Array.isArray(p.mod) || p.mod.length !== 2 || p.mod.some(m => !Array.isArray(m) || m.length !== modSettingCount || m.some((v, i) => !validModSetting(i, v)))) return false;
  if (!Array.isArray(p.routes) || p.routes.length !== routeCount) return false;
  return p.routes.every(r => Number.isInteger(r.source) && Number.isInteger(r.destination) && Number.isInteger(r.depth) && (r.source === sourceCount ? r.depth === 0 : r.source >= 0 && r.source < sourceCount && modulatable(r.destination, r.source) && r.depth >= -65536 && r.depth <= 65536));
}
// Times use Modulators::seconds: 0 = instant, else 1 ms * e^(9.9 v).
const defaultMod = [30000, 42000, 32768, 40000, 0, 0, 32768, 0, 26000, 0, 65535, 0, 0, 0, 0, 0, 32768, 32768];
export function initialWavetable(): WavetablePatch {
  const routes = Array.from({length: routeCount}, unused);
  routes[0] = {source: S.Pressure, destination: P.Frame, depth: 26000};
  routes[1] = {source: S.Velocity, destination: P.Cutoff, depth: 0};
  const parameters = [22000, 8000, optionValue(P.Unison, 2), 23600, 65535, 0, 0, 65535, 65535,
      0, 0, 0, 0, optionValue(P.SubPitchMode,1), 0,
      65535, 6000, 0, 0, 32768,
      10650, 37740, 52428, 37740,
      0, 26000, 0, 40000,
      46000, 0, 65535, 0, 0, 0,
      32768, 32768, 32768,
      32768, 32768, 32768, 32768, 0, 0, 32768, 32768, 0];
  parameters.push(...Array(parameterCount-parameters.length).fill(0));
  for(const id of [P.CarrierPitchMode,P.Osc2PitchMode,P.StackPitchMode])parameters[id]=optionValue(id,1);
  for(const id of [P.CarrierRatioNum,P.CarrierRatioDen,P.SubRatioNum,P.Osc2RatioNum,P.Osc2RatioDen,P.StackRatioDen])parameters[id]=1;
  parameters[P.SubRatioDen]=2;parameters[P.StackRatioNum]=3;parameters[P.StackRatioDen]=2;
  parameters[P.AttackRoot]=34125;
  parameters[P.BeatRate]=16384;parameters[P.StackInterval]=32768;parameters[P.BodyLevel]=21845;parameters[P.NaturalTuned]=65535;parameters[P.BodyAir]=26000;
  const nums=[1,689,1351,8933],dens=[1,250,250,1000],weights=[19661,22937,14418,8519],decays=[65535,45875,29491,18350],pans=[27852,42925,17367,53411];
  for(let j=0;j<4;++j){const at=P.Partial1Mode+7*j;parameters.splice(at,7,optionValue(at,1),32768,nums[j],dens[j],weights[j],decays[j],pans[j]);}
  return {parameters,mod:[[...defaultMod],[...defaultMod]],routes};
}
function validTableRef(value:unknown):{id:string;name:string}|undefined {if(value===undefined)return undefined;const v=value as {id?:unknown;name?:unknown};if(!v||typeof v.id!=='string'||!v.id||v.id.length>100||typeof v.name!=='string'||!v.name||v.name.length>80)throw Error('Invalid table reference.');return {id:v.id,name:v.name};}
export const tableCrc=(p:WavetablePatch)=>(p.parameters[P.TableLow]|p.parameters[P.TableHigh]<<16)>>>0;
export function wavetableFromUnknown(value: unknown): WavetablePreset {
  const p = value as Partial<WavetablePreset> | undefined;
  if (!p || typeof p !== 'object' || p.format !== wavetableFormat) throw Error(`This file is not a current wavetable preset. Use ${wavetableFormat}.`);
  if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 80) throw Error('Give the preset a name.');
  const patch = {parameters: [...(p.parameters ?? [])], mod: [[...(p.mod?.[0] ?? [])], [...(p.mod?.[1] ?? [])]] as [number[], number[]], routes: (p.routes ?? []).map(r => ({...r}))};
  if (!validWavetable(patch)) throw Error('This wavetable preset has invalid settings or routes.');
  const attack=validateAttack(p.attack);
  if((attack?.frames.length??0)!==patch.parameters[P.AttackFrames]||(attack?sampleChecksum(attack.frames):0)!==attackCrc(patch))throw Error('The attack sample does not match this sound.');
  return {format: wavetableFormat, attack, name: p.name.trim(), table:validTableRef(p.table), effects:validateFx(p.effects ?? wavetableDefaultFx()), mono: validateMono(p.mono), ...patch};
}
export const wavetablePreset = (name: string, patch: WavetablePatch & Partial<Pick<WavetablePreset,'attack'|'table'|'effects'|'mono'>>): WavetablePreset => ({format: wavetableFormat, attack:validateAttack('attack' in patch?patch.attack:undefined), name, table:validTableRef('table' in patch ? patch.table : undefined), effects:validateFx('effects' in patch ? patch.effects : wavetableDefaultFx()), mono: validateMono('mono' in patch ? patch.mono : undefined), parameters: [...patch.parameters], mod: [[...patch.mod[0]], [...patch.mod[1]]], routes: patch.routes.map(r => ({...r}))});
export const sameWavetable = (a: WavetablePreset, b: WavetablePreset) => a.name === b.name && JSON.stringify([a.parameters, a.mod, a.routes,a.effects,a.table,a.mono,a.attack]) === JSON.stringify([b.parameters, b.mod, b.routes,b.effects,b.table,b.mono,b.attack]);

// Word layout: parameters, Mod 1, Mod 2, then per route source << 8 | destination
// and depth + 65536.
export const routeKey = (source: number, destination: number) => source * 256 + destination;
export function wavetableWords(p: WavetablePatch): number[] {
  return [...p.parameters, ...p.mod[0], ...p.mod[1], ...p.routes.flatMap(r => [routeKey(r.source, r.destination), r.depth + 65536])];
}
export function wavetableFromWords(words: number[]): WavetablePatch {
  if (words.length !== wordCount) throw Error('Incomplete wavetable patch.');
  const patch: WavetablePatch = {parameters: words.slice(0, parameterCount), mod: [words.slice(parameterCount, parameterCount + modSettingCount), words.slice(parameterCount + modSettingCount, editCount)],
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

const semis = (v: number) => { const n = coarseSemitones(v), r = Math.round(n * 10) / 10; return `${r > 0 ? '+' : ''}${Number.isInteger(r) ? r : r.toFixed(1)} st`; };
const cents = (v: number) => { const c = Math.round((v - 32768) / 32767 * 100); return `${c > 0 ? '+' : ''}${c}¢`; };
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
  {name: 'Sub interval unit', describe: v => pitchNames[option(P.SubPitchMode,v)]},
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
  {name: 'Ring', describe: v => `${(.12 * 2 ** (5 * v / 65535)).toFixed(2)} s`},
  {name: 'Level', describe: v => { const g = (v / 65535) ** 2; return g <= 0 ? '−∞ dB' : `${(20 * Math.log10(g)).toFixed(1)} dB`; }},
  {name: 'Classic stepping', describe: v => v ? 'On' : 'Off'},
  {name: 'Edge blend', describe: pct},
  {name: 'Start phase', describe: v => ['Random','Reset','Evenly spread'][option(P.PhaseMode,v)]},
  {name: 'Table identity', describe: v => String(v)},
  {name: 'Table identity', describe: v => String(v)},
  ...(['Attack', 'Decay', 'Release'] as const).map(name => ({name: `${name} curve`, describe: (v: number) => { const b = curveBend(v); return b === 0 ? 'Straight' : `${b < 0 ? 'Fast' : 'Slow'} ${Math.round(Math.abs(b) * 100)}%`; }})),
  {name: 'Coarse', describe: semis}, {name: 'Fine', describe: cents}, {name: 'Sub coarse', describe: semis}, {name: 'Sub fine', describe: cents},
  {name: 'Osc 2 shape', describe: v => osc2Names[option(P.Osc2Shape, v)]}, {name: 'Osc 2 level', describe: pct}, {name: 'Osc 2 coarse', describe: semis}, {name: 'Osc 2 fine', describe: cents},
  {name: 'Phase mod', describe: v => `${(v / 65535 * 360).toFixed(0)}° peak`},
  {name:'Carrier interval unit',describe:v=>pitchNames[option(P.CarrierPitchMode,v)]},
  ...['Carrier numerator','Carrier denominator','Sub numerator','Sub denominator'].map(name=>({name,describe:(v:number)=>String(v)})),
  {name:'Osc 2 interval unit',describe:v=>pitchNames[option(P.Osc2PitchMode,v)]},
  ...['Osc 2 numerator','Osc 2 denominator'].map(name=>({name,describe:(v:number)=>String(v)})),
  {name:'Unison mode',describe:v=>unisonNames[option(P.UnisonMode,v)]},
  {name:'Beat rate',describe:v=>`${((v/65535)**2*8).toFixed(2)} Hz between copies`},
  {name:'Stack interval unit',describe:v=>pitchNames[option(P.StackPitchMode,v)]},
  {name:'Stack interval',describe:semis},
  ...['Stack numerator','Stack denominator'].map(name=>({name,describe:(v:number)=>String(v)})),
  {name:'Body level',describe:v=>`+${(v/65535*18).toFixed(1)} dB`},
  {name:'Natural → Tuned',describe:pct},
  {name:'Body movement',describe:v=>bodyMotionNames[option(P.BodyMotion,v)]},
  {name:'Excitation air',describe:pct},
  ...Array.from({length:4},(_,j)=>[
    {name:`Partial ${j+1} unit`,describe:(v:number)=>pitchNames[option(P.Partial1Mode+j*7,v)]},
    {name:`Partial ${j+1} interval`,describe:semis},
    {name:`Partial ${j+1} numerator`,describe:(v:number)=>String(v)},
    {name:`Partial ${j+1} denominator`,describe:(v:number)=>String(v)},
    {name:`Partial ${j+1} level`,describe:pct},{name:`Partial ${j+1} decay`,describe:pct},
    {name:`Partial ${j+1} pan`,describe:(v:number)=>`${Math.round((v/65535*2-1)*100)}%`}
  ]).flat(),
  {name:'Attack frames',describe:v=>String(v)},{name:'Attack CRC low',describe:v=>String(v)},{name:'Attack CRC high',describe:v=>String(v)},
  {name:'Sample root',describe:v=>`${(20*100**(v/65535)).toFixed(1)} Hz`},
  {name:'Attack playback',describe:v=>option(P.AttackPlayback,v)?'Follow note':'Fixed texture'},
  {name:'Drive shape',describe:v=>driveNames[option(P.DriveMode,v)]},
  {name:'Drive',describe:v=>`+${(24.08*v/65535).toFixed(1)} dB`},
  {name:'Filter',describe:v=>option(P.FilterBypass,v)?'Off':'On'}
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
const tableSound=(sound:WavetablePreset,file:string)=>{const table=tableManifest.find(t=>t.file===file)!;const parameters=[...sound.parameters];parameters[P.TableLow]=table.crc&65535;parameters[P.TableHigh]=table.crc>>>16;return {...sound,parameters,table:{id:table.id,name:table.name}};};
const centsValue=(cents:number)=>Math.round(32768+Math.max(-1,Math.min(1,cents/2400))*32767);
const partialRatios=(ratios:[number,number][])=>Object.fromEntries(ratios.flatMap(([n,d],j)=>[[P.Partial1Num+j*7,n],[P.Partial1Den+j*7,d]]));
function attackSound(sound:WavetablePreset,attack:AttackSample):WavetablePreset{
 const parameters=[...sound.parameters],crc=sampleChecksum(attack.frames);parameters[P.AttackFrames]=attack.frames.length;parameters[P.AttackCrcLow]=crc&65535;parameters[P.AttackCrcHigh]=crc>>>16;parameters[P.TransientShape]=optionValue(P.TransientShape,3);return {...sound,parameters,attack};
}
export const factoryWavetablePresets: WavetablePreset[] = [
  wavetablePreset('Pressure Scan', initialWavetable()),
  attackSound(preset('Grain Keys',{[P.Unison]:0,[P.Level]:38000,[P.Frame]:7000,[P.Transient]:27000,[P.AmpAttack]:0,[P.AmpDecay]:39000,[P.AmpSustain]:24000},[{source:S.Pressure,destination:P.Frame,depth:26000},{source:S.Velocity,destination:P.Transient,depth:14000}]),factoryAttackSamples[0]),
  attackSound(preset('Digital Edge',{[P.Unison]:o(P.Unison,1),[P.Level]:37000,[P.Frame]:28000,[P.Transient]:32000,[P.Osc2RatioNum]:3,[P.Osc2RatioDen]:2,[P.PhaseMod]:3500,[P.AmpAttack]:0},[{source:S.Pressure,destination:P.Frame,depth:16000},{source:S.Pressure,destination:P.PhaseMod,depth:9000}]),factoryAttackSamples[1]),
  attackSound(preset('Shimmer Bloom',{[P.Unison]:o(P.Unison,1),[P.Level]:36000,[P.Frame]:21000,[P.Transient]:34000,[P.Resonator]:o(P.Resonator,1),[P.BodyMotion]:o(P.BodyMotion,3),[P.ResonatorMix]:22000,[P.ResonatorTune]:20000,[P.AmpAttack]:27000},[{source:S.Pressure,destination:P.Frame,depth:24000},{source:S.Lfo1,destination:P.ResonatorTune,depth:10000}]),factoryAttackSamples[2]),
  tableSound(preset('Pressure Prism',{[P.Level]:37000,[P.Unison]:o(P.Unison,1),[P.UnisonMode]:o(P.UnisonMode,1),[P.BeatRate]:14000,[P.Frame]:16000,[P.Brightness]:49000,[P.Osc2RatioNum]:2,[P.PhaseMod]:2500,[P.Resonator]:o(P.Resonator,1),[P.BodyMotion]:o(P.BodyMotion,3),[P.ResonatorTune]:20000,[P.ResonatorMix]:30000,[P.BodyLevel]:18000,[P.BodyAir]:36000,[P.NaturalTuned]:56000,[P.AmpAttack]:6500,[P.AmpDecay]:39000,[P.AmpSustain]:14000,[P.AmpRelease]:39000},
    [{source:S.Pressure,destination:P.Frame,depth:16000},{source:S.Pressure,destination:P.ResonatorTune,depth:19000},{source:S.Pressure,destination:P.ResonatorDecay,depth:10000}]),'harshdigitalbois'),
  tableSound(preset('Wood Circuit',{[P.Level]:38000,[P.Unison]:0,[P.Frame]:7000,[P.Brightness]:38000,[P.Resonator]:o(P.Resonator,2),[P.ResonatorMix]:36000,[P.BodyLevel]:11000,[P.BodyAir]:24000,[P.NaturalTuned]:56000,[P.ResonatorDecay]:38000,[P.AmpAttack]:0,[P.AmpDecay]:33000,[P.AmpSustain]:4000,[P.AmpRelease]:30000},
    [{source:S.Pressure,destination:P.Frame,depth:14000},{source:S.Pressure,destination:P.ResonatorDecay,depth:12000},{source:S.Velocity,destination:P.ResonatorMix,depth:5000}],undefined,defaultFx()),'rustyblade'),
  tableSound(preset('Liquid Intervals',{[P.Level]:34000,[P.Unison]:o(P.Unison,2),[P.UnisonMode]:o(P.UnisonMode,1),[P.BeatRate]:18000,[P.Frame]:7000,[P.Brightness]:53000,[P.Resonator]:o(P.Resonator,3),[P.BodyMotion]:o(P.BodyMotion,2),[P.ResonatorMix]:36000,[P.BodyLevel]:35000,[P.BodyAir]:29000,[P.NaturalTuned]:65535,[P.ResonatorTune]:6000,[P.ResonatorDecay]:51000,[P.AmpAttack]:36500,[P.AmpSustain]:53000,[P.AmpRelease]:46500,...partialRatios([[1,1],[159,100],[273,100],[463,100]])},
    [{source:S.Pressure,destination:P.Frame,depth:30000},{source:S.Pressure,destination:P.ResonatorDecay,depth:7000},{source:S.Lfo1,destination:P.ResonatorTune,depth:3500}],[{8:18000}]),'vowels'),
  preset('Ratio Cloud',{[P.Level]:36000,[P.Frame]:25000,[P.Unison]:o(P.Unison,2),[P.UnisonMode]:o(P.UnisonMode,2),[P.StackRatioNum]:3,[P.StackRatioDen]:2,[P.Resonator]:o(P.Resonator,3),[P.BodyMotion]:o(P.BodyMotion,3),[P.ResonatorMix]:25000,[P.BodyLevel]:18000,[P.ResonatorTune]:16000,[P.NaturalTuned]:65535,...partialRatios([[1,1],[3,2],[3,1],[6,1]])},
    [{source:S.Pressure,destination:P.Frame,depth:22000},{source:S.Lfo1,destination:P.ResonatorTune,depth:9000}],[{8:15000}]),
  preset('Ratio FM Keys',{[P.Level]:37000,[P.Unison]:0,[P.Frame]:5000,[P.Osc2RatioNum]:3,[P.Osc2RatioDen]:2,[P.PhaseMod]:7000,[P.AmpAttack]:0,[P.AmpDecay]:40000,[P.AmpSustain]:10000,[P.AmpRelease]:34000},
    [{source:S.Pressure,destination:P.PhaseMod,depth:13000},{source:S.Pressure,destination:P.Frame,depth:12000}],undefined,defaultFx()),
  preset('Glass Pad', {[P.Frame]: 9000, [P.FrameSpread]: 26000, [P.Unison]: o(P.Unison, 4), [P.Detune]: 30000, [P.Brightness]: 52000, [P.Cutoff]: 52000, [P.Resonance]: 9000, [P.AmpAttack]: 40000, [P.AmpRelease]: 48000},
    [{source: S.Pressure, destination: P.Frame, depth: 30000}, {source: S.Lfo1, destination: P.FrameSpread, depth: 12000}], [{8: 15000}],
    fxRoutePatch(ensembleRack(1, 62000), 25, 3, 20000)),
  preset('Fold Lead', {[P.Frame]: 30000, [P.Unison]: o(P.Unison, 2), [P.Detune]: 14000, [P.WarpMode]: o(P.WarpMode, 1), [P.WarpAmount]: 22000, [P.Cutoff]: 47000, [P.Resonance]: 22000, [P.FilterEnvelope]: 44000, [P.AmpAttack]: 0, [P.AmpSustain]: 56000},
    [{source: S.Pressure, destination: P.WarpAmount, depth: 38000}, {source: S.Lfo1, destination: P.WarpAmount, depth: 6000}, {source: S.Velocity, destination: P.Cutoff, depth: 9000}], [{0: 0, 1: 30000, 2: 0, 3: 26000, 8: 33000}]),
  preset('Sync Bass', {[P.Frame]: 44000, [P.Unison]: 0, [P.WarpMode]: o(P.WarpMode, 4), [P.WarpAmount]: 9000, [P.Sub]: 42000, [P.Cutoff]: 38000, [P.Resonance]: 16000, [P.FilterEnvelope]: 52000, [P.KeyTrack]: 30000, [P.AmpAttack]: 0, [P.AmpDecay]: 34000, [P.AmpSustain]: 46000, [P.AmpRelease]: 26000},
    [{source: S.Pressure, destination: P.WarpAmount, depth: 36000}, {source: S.Env1, destination: P.WarpAmount, depth: 14000}], [{0: 0, 1: 31000, 2: 0, 3: 28000}], defaultFx()),
  preset('Bell Keys', {[P.AmpDecayCurve]: curveWord(-.5), [P.AmpReleaseCurve]: curveWord(-.4), [P.Frame]: 6000, [P.Unison]: o(P.Unison, 1), [P.Detune]: 9000, [P.Transient]: 30000, [P.TransientShape]: o(P.TransientShape, 1), [P.Resonator]: o(P.Resonator, 1), [P.ResonatorMix]: 34000, [P.ResonatorDecay]: 42000, [P.AmpAttack]: 0, [P.AmpDecay]: 46000, [P.AmpSustain]: 12000, [P.AmpRelease]: 44000},
    [{source: S.Velocity, destination: P.Transient, depth: 24000}, {source: S.Pressure, destination: P.ResonatorDecay, depth: 18000}, {source: S.Pressure, destination: P.Frame, depth: 16000}]),
  preset('Breath Choir', {[P.Frame]: 3000, [P.FrameSpread]: 14000, [P.Unison]: o(P.Unison, 4), [P.Detune]: 20000, [P.Noise]: 15000, [P.Transient]: 20000, [P.TransientShape]: o(P.TransientShape, 2), [P.FilterMode]: o(P.FilterMode, 1), [P.Cutoff]: 41000, [P.Resonance]: 26000, [P.AmpAttack]: 43000, [P.AmpRelease]: 46000},
    [{source: S.Pressure, destination: P.Cutoff, depth: 14000}, {source: S.Lfo1, destination: P.Cutoff, depth: 3500}, {source: S.Pressure, destination: P.Noise, depth: 12000}], [{8: 31000}], ensembleRack(1)),
];
