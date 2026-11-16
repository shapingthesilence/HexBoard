import {describe, expect, it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {bendThrough, curveBend, curveWord, envelopeCurve, envelopeLevel, linearCurveWord} from './envelopeCurve.ts';
import {CurvedEnvelope} from './CurvedEnvelope.tsx';
import {defaultModulation, validateModulation} from './schema.ts';
import {P, editCount, initialWavetable, wavetableFromUnknown, wavetableFromWords, wavetableWords, wordCount} from './wavetableSchema.ts';
import {preparePatch} from './sampler/prepare.mjs';
import {readBank} from './sampler/bank.mjs';

describe('shared envelope curves', () => {
  it('matches the firmware Modulators::curve contract', () => {
    expect(envelopeCurve(.5, 0)).toBe(.5);
    expect(envelopeCurve(0, 1)).toBe(0);
    expect(envelopeCurve(1, -1)).toBe(1);
    expect(envelopeCurve(.5, -1)).toBeGreaterThan(.9);
    expect(envelopeCurve(.5, 1)).toBeLessThan(.1);
    expect(envelopeCurve(.5, .5) + envelopeCurve(.5, -.5)).toBeCloseTo(1, 6);
  });
  it('maps 32768 to exactly straight and drags through the pointer', () => {
    expect(curveBend(linearCurveWord)).toBe(0);
    for (const b of [-1, -.4, 0, .25, 1]) expect(curveBend(curveWord(b))).toBeCloseTo(b, 4);
    for (const f of [.1, .3, .5, .8]) expect(envelopeCurve(.5, bendThrough(f))).toBeCloseTo(f, 6);
  });
  it('evaluates held levels per segment', () => {
    const e = {attack: .1, decay: .1, sustain: .5, release: .1, attackBend: -1, decayBend: 1};
    expect(envelopeLevel(e, .05)).toBeGreaterThan(.9);
    expect(envelopeLevel(e, .15)).toBeGreaterThan(.95);
    expect(envelopeLevel(e, 1)).toBe(.5);
  });
  it('draws handles for each curved segment', () => {
    const html = renderToStaticMarkup(createElement(CurvedEnvelope, {label: 'Amp', values: {attack: .01, decay: .2, sustain: .6, release: .3}, bends: {attack: 0, decay: -.5, release: .5}, onBend: () => {}, onTime: () => {}}));
    for (const label of ['Amp attack curve', 'Amp decay curve', 'Amp release curve', 'Amp attack time']) expect(html).toContain(label);
  });
});

describe('18-word envelope banks', () => {
  it('keeps physical gesture settings separate from the eighteen envelope words', () => {
    const m = defaultModulation(); expect(m.settings).toHaveLength(42);
    const old = {settings: m.settings.slice(0, 16).map((v, i) => i === 6 ? 50000 : v), routes: m.routes};
    expect(() => validateModulation(old)).toThrow();
    expect(validateModulation(m).settings.slice(18)).toEqual([0,32768,23200,0,...Array(18).fill(32768),16384,0]);
  });
  it('round-trips current wavetable curves and rejects superseded development sounds', () => {
    const patch = initialWavetable(); patch.parameters[P.AmpDecayCurve] = 9000; patch.mod[1][17] = 60000;
    const words = wavetableWords(patch);
    expect(words).toHaveLength(wordCount);
    expect(editCount).toBe(100 + 36);
    expect(wavetableFromWords(words)).toEqual(patch);
    const v3 = {format: 'hexboard.wavetable.v3', name: 'Old', parameters: initialWavetable().parameters.slice(0, 34), mod: initialWavetable().mod.map(m => m.slice(0, 16)), routes: initialWavetable().routes};
    expect(() => wavetableFromUnknown(v3)).toThrow();
    for (const version of [4, 5, 6]) expect(() => wavetableFromUnknown({...patch, name: 'Old', format: `hexboard.wavetable.v${version}`})).toThrow();
  });
});

describe('sampler envelope shapes', () => {
  it('round-trips through the .hbs header and defaults to straight', async () => {
    const asset = {name: 'a', channels: [new Float32Array(1024)], rate: 44100, rootMidi: 60};
    const shaped = readBank((await preparePatch({name: 'Shaped', assets: [asset], zones: [{asset: 0, lowMidi: 0, highMidi: 127}], settings: {attackShape: -.5, decayShape: .25, releaseShape: 1}})).bytes);
    expect(shaped.settings!.attackShape).toBeCloseTo(-.5, 4);
    expect(shaped.settings!.decayShape).toBeCloseTo(.25, 4);
    expect(shaped.settings!.releaseShape).toBeCloseTo(1, 4);
    const plain = await preparePatch({name: 'Plain', assets: [asset], zones: [{asset: 0, lowMidi: 0, highMidi: 127}]});
    expect([...plain.bytes.slice(114, 120)]).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
