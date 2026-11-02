import {P, S, option, routeCount, sourceCount, type WavetablePatch} from './wavetableSchema.ts';
// Advisory DSP estimate for eight held voices plus two tails, fitted to the
// measured hardware workloads (Advanced docs/dsp-budget-qualification.md):
// default patch 878 µs, combined bell patch 2,477 µs. Costs are cycles per
// voice-sample from the kernel benchmarks; five voices render per core.
export const wavetableCapacityUs = 2873;
const fixedUs = 372, usPerCycle = 2.56 * 1.036;
export type WavetableStage = 'oscillator' | 'warp' | 'unison' | 'layers' | 'resonator' | 'filter' | 'amp' | 'output';
export interface WavetableCost {us: number; stages: Record<WavetableStage, number>; fits: boolean}
const routed = (p: WavetablePatch, id: number) => p.routes.some(r => r.source < sourceCount && r.destination === id && r.depth !== 0);
const active = (p: WavetablePatch, id: number) => p.parameters[id] > 0 || routed(p, id);
/** True when the filter is bypassed: open low-pass with no resonance or movement. */
export function filterOpen(p: WavetablePatch) {
  return option(P.FilterMode, p.parameters[P.FilterMode]) === 0 && p.parameters[P.Cutoff] >= 65470 && p.parameters[P.Resonance] < 655 &&
    p.parameters[P.KeyTrack] === 0 && p.parameters[P.FilterEnvelope] === 32768 && ![P.Cutoff, P.Resonance, P.KeyTrack, P.FilterEnvelope].some(id => routed(p, id));
}
export function wavetableCost(p: WavetablePatch): WavetableCost {
  const copies = option(P.Unison, p.parameters[P.Unison]) + 1, warp = option(P.WarpMode, p.parameters[P.WarpMode]);
  const blend = p.parameters[P.Brightness] < 65470 || routed(p, P.Brightness);
  const resonator = option(P.Resonator, p.parameters[P.Resonator]), ensemble = option(P.Ensemble, p.parameters[P.Ensemble]);
  const cycles = {
    oscillator: 20 + (blend ? 70 : 40),
    unison: (copies - 1) * (blend ? 70 : 40),
    warp: warp === 0 ? 0 : copies * (warp === 4 ? 17 : 12),
    layers: (active(p, P.Noise) ? 8 : 0) + (active(p, P.Transient) ? 24 : 0) + (active(p, P.Sub) ? 10 : 0),
    resonator: resonator === 0 ? 0 : resonator === 1 ? 66 : 56,
    filter: filterOpen(p) ? 0 : 32
  };
  const stages: Record<WavetableStage, number> = {
    oscillator: Math.round(cycles.oscillator * usPerCycle + fixedUs), warp: Math.round(cycles.warp * usPerCycle), unison: Math.round(cycles.unison * usPerCycle),
    layers: Math.round(cycles.layers * usPerCycle), resonator: Math.round(cycles.resonator * usPerCycle), filter: Math.round(cycles.filter * usPerCycle),
    amp: 0, output: ensemble === 0 ? 0 : ensemble === 1 ? 50 : 86
  };
  const us = Object.values(stages).reduce((a, b) => a + b, 0);
  return {us, stages, fits: us <= wavetableCapacityUs};
}
/** Share of the estimate attributable to one modulation source's routes. */
export function wavetableSourceCost(p: WavetablePatch, source: number) {
  const without = {...p, routes: p.routes.map(r => r.source === source ? {source: sourceCount, destination: 0, depth: 0} : r)};
  return wavetableCost(p).us - wavetableCost(without).us;
}
export const wavetableRouteLimit = routeCount;
export const generatedSources = [S.Env1, S.Lfo1, S.Env2, S.Lfo2];
