import {describe, expect, it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {P, S, effectiveWavetable, factoryWavetablePresets, initialWavetable, option, optionValue, routeKey, routesUsed, sourceCount, validWavetable, wavetableFromUnknown, wavetableFromWords, wavetablePreset, wavetableWords, withRoute, wordCount, editCount, wavetableFormat, wavetableDefaultFx} from './wavetableSchema.ts';
import {wavetableCapacityUs, wavetableCost, filterOpen} from './wavetableBudget.ts';
import {defaultFx} from './schema.ts';
import {fxRoutePatch} from './fxRouting.ts';
import {frameSpectrum, warp} from './WavetableVisuals.tsx';
import {AdvancedSynthEditor} from './AdvancedSynthEditor.tsx';
import {WavetableSynthEditor} from './WavetableSynthEditor.tsx';

describe('wavetable patch', () => {
  it('round-trips the firmware word layout', () => {
    const patch = initialWavetable(); patch.routes[3] = {source: S.TiltX, destination: P.Width, depth: -20000};
    const words = wavetableWords(patch);
    expect(words).toHaveLength(wordCount);
    expect(words[editCount]).toBe(routeKey(S.Pressure, P.Frame));
    expect(words[editCount + 2 * 15]).toBe(routeKey(sourceCount, 0));
    expect(wavetableFromWords(words)).toEqual(patch);
  });
  it('matches firmware option rounding and route rules', () => {
    for (const id of [P.Unison, P.WarpMode, P.Resonator]) for (let c = 0; c < 4; ++c) expect(option(id, optionValue(id, c))).toBe(c);
    const bad = initialWavetable(); bad.routes[2] = {source: S.Velocity, destination: P.SubOctave, depth: 1};
    expect(validWavetable(bad)).toBe(false);
    bad.routes[2] = {source: S.Pressure, destination: P.WarpMode, depth: 1};
    expect(validWavetable(bad)).toBe(false);
    expect(() => wavetableFromUnknown({format: wavetableFormat, name: 'x', ...bad})).toThrow();
  });
  it('allocates, edits and clears sparse routes within sixteen', () => {
    let patch = initialWavetable();
    const first = withRoute(patch, P.Cutoff, S.Lfo2, 9000)!; patch = first.patch;
    expect(patch.routes[first.index]).toEqual({source: S.Lfo2, destination: P.Cutoff, depth: 9000});
    for (let i = 0; routesUsed(patch) < 16; ++i) patch = withRoute(patch, [P.Detune, P.Width, P.Noise, P.Sub, P.Resonance, P.KeyTrack, P.AmpAttack][i % 7], i % sourceCount, 100 + i)?.patch ?? patch;
    expect(withRoute(patch, P.Level, S.Joystick, 1)).toBeUndefined();
    const cleared = withRoute(patch, P.Cutoff, S.Lfo2, 0)!;
    expect(cleared.patch.routes[first.index].source).toBe(sourceCount);
  });
  it('computes live values like the board', () => {
    const values = effectiveWavetable(initialWavetable(), [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(values[P.Frame]).toBeCloseTo((22000 + 26000) / 65535 + (26000 / 65536 - 26000 / 65535), 3);
  });
  it('keeps factory sounds valid and inside the measured budget', () => {
    for (const p of factoryWavetablePresets) { expect(validWavetable(p)).toBe(true); expect(wavetableCost(p).fits).toBe(true); }
    expect(new Set(factoryWavetablePresets.map(p => p.name)).size).toBe(factoryWavetablePresets.length);
  });
});

describe('wavetable DSP estimate', () => {
  it('reproduces the measured default and combined workloads', () => {
    expect(wavetableCost(initialWavetable()).us).toBeGreaterThan(850);
    expect(wavetableCost(initialWavetable()).us).toBeLessThan(950);
    const combined = initialWavetable(); const set = (id: number, v: number) => { combined.parameters[id] = v; };
    set(P.Unison, optionValue(P.Unison, 6)); set(P.FrameSpread, 65535); set(P.WarpMode, optionValue(P.WarpMode, 4)); set(P.Brightness, 40000);
    set(P.Noise, 20000); set(P.Transient, 20000); set(P.Sub, 20000); set(P.Resonator, optionValue(P.Resonator, 2));
    const us = wavetableCost({...combined, effects: wavetableDefaultFx()}).us;
    expect(us).toBeGreaterThan(2400); expect(us).toBeLessThan(2560); expect(us).toBeLessThan(wavetableCapacityUs);
  });
  it('treats a fully open, unmoving low-pass as bypassed', () => {
    const p = initialWavetable(); p.parameters[P.Resonance] = 0;
    expect(filterOpen(p)).toBe(true);
    expect(filterOpen(withRoute(p, P.Cutoff, S.Pressure, -1000)!.patch)).toBe(false);
  });
});

describe('wavetable previews', () => {
  it('follows the Basic Shapes spectrum and warp ranges', () => {
    expect(frameSpectrum(0).slice(0, 3)).toEqual([1, 0, 0]);
    expect(frameSpectrum(15)[2]).toBeCloseTo(4 / (3 * Math.PI));
    expect(warp(.25, 4, 1)[0]).toBeCloseTo(2);
    expect(warp(.5, 1, 0)[0]).toBe(.5);
    expect(frameSpectrum(15, 0).slice(0, 3)).toEqual([4 / Math.PI, 0, 0]); // Darkest: full-level fundamental only.
  });
  it('renders offline in signal-flow order and in the engine selector', () => {
    const html = renderToStaticMarkup(createElement(WavetableSynthEditor, {}));
    const order = ['Oscillator', 'Warp', 'Unison', 'Layers', 'Resonator', 'Filter', 'Amp', 'Output'].map(s => html.indexOf(`wt-stage-${s.toLowerCase()}`));
    expect(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1]))).toBe(true);
    // Continuous meter/readout updates must not become screen-reader announcements.
    expect(html).toContain('<output aria-live="off"');
    expect(html).toContain('FX rack');expect(html).not.toContain('Motion sources');
    expect(renderToStaticMarkup(createElement(AdvancedSynthEditor, {engines: true}))).toContain('Wavetable');
    expect(wavetablePreset('x', initialWavetable()).format).toBe(wavetableFormat);
  });
});

it('retains the shared effects rack through wavetable preset export and reload',()=>{
 const p=wavetablePreset('Rack',initialWavetable());p.effects.order=[1,2,3,4,5];p.effects.values[0][0]=45678;
 const roundtrip=wavetableFromUnknown(JSON.parse(JSON.stringify(p)));
 expect(roundtrip.effects).toEqual(p.effects);
 expect(wavetableCost(roundtrip).us).toBeGreaterThan(wavetableCost(initialWavetable()).us+700);
});

it('starts wavetable sounds with the rack ensemble and refuses superseded files',()=>{
 const p=wavetablePreset('Default',initialWavetable());
 expect(p.effects.order).toEqual([6]);expect(p.effects.values[6]).toEqual([32768,52000,0,32768]);
 const pad=factoryWavetablePresets.find(f=>f.name==='Glass Pad')!;expect(pad.effects.values[6][2]).toBe(1);expect(pad.effects.routes![15*5]).toBe(20000);
 expect(factoryWavetablePresets.find(f=>f.name==='Sync Bass')!.effects.order).toEqual([]);
 expect(()=>wavetableFromUnknown({...JSON.parse(JSON.stringify(p)),format:'hexboard.wavetable.v1'})).toThrow();
});

it('pins the estimate the board enforces (Advanced wavetable_budget_test.cpp)',()=>{
 const full=()=>{let e=defaultFx();e.order=[1,2,3,4,5,6];e.values[6][2]=1;for(const [id,source,depth] of [[0,3,3000],[20,6,12000],[13,7,10000],[4,8,5000],[25,3,9000]])e=fxRoutePatch(e,id,source,depth);return e;};
 const with_=(values:[number,number][])=>{const p=initialWavetable();for(const [id,v] of values)p.parameters[id]=v;return p;};
 const dense=with_([[P.Unison,optionValue(P.Unison,4)],[P.Brightness,34000],[P.WarpMode,optionValue(P.WarpMode,1)],[P.WarpAmount,24000],[P.Noise,12000],[P.Transient,12000],[P.Sub,24000],[P.Cutoff,45000],[P.Resonance,20000]]);
 const worst=with_([[P.Unison,optionValue(P.Unison,6)],[P.Brightness,40000],[P.WarpMode,optionValue(P.WarpMode,4)],[P.Noise,1],[P.Transient,1],[P.Sub,1],[P.Resonator,optionValue(P.Resonator,1)],[P.Resonance,1]]);
 expect([wavetableCost({...initialWavetable(),effects:defaultFx()}).us,wavetableCost({...initialWavetable(),effects:wavetableDefaultFx()}).us,wavetableCost({...initialWavetable(),effects:full()}).us,wavetableCost({...dense,effects:full()}).us,wavetableCost({...worst,effects:full()}).us]).toEqual([866,952,1687,2568,3186]);
});
