import {describe, expect, it} from 'vitest';
import {SourcePreview, envelopePreview} from './sourcePreview.ts';
import {WavetablePreview} from './wavetablePreview.ts';
import {effectiveWavetable, initialWavetable, P, S, wavetablePreset} from './wavetableSchema.ts';
import {modulationSeconds} from './schema.ts';
import type {PhysicalExpression} from './client.ts';
import {PhysicalPreview, ClassicPreview} from './enginePreview.ts';
import {effectiveParameters, initialPreset, physicalPresetFromUnknown} from './schema.ts';
import {initialClassic} from './classicSchema.ts';
import {effectiveAdvanced} from './advancedSchema.ts';

const expression = (key: number | null, held: boolean): PhysicalExpression => ({key, held, velocity: 100, pressure: 40000, release: 60, tiltX: -.25, tiltY: .5});
describe('wavetable live preview contracts', () => {
  it('retains envelope attack, note retrigger and release timing', () => {
    const settings = initialWavetable().mod[0], source = new SourcePreview(0);
    source.advance(settings, expression(10, true), 100);
    expect(source.advance(settings, expression(10, true), 150)[0]).toBeCloseTo(envelopePreview(settings, .05));
    expect(source.advance(settings, expression(11, true), 200)[0]).toBe(0);
    const level = source.advance(settings, expression(11, true), 250)[0];
    expect(source.advance(settings, expression(11, false), 300)[0]).toBe(level);
    expect(source.advance(settings, expression(11, false), 300 + modulationSeconds(settings[3]) * 500)[0]).toBeCloseTo(level / 2);
    expect(source.advance(settings, expression(11, false), 300 + modulationSeconds(settings[3]) * 1000)[0]).toBeCloseTo(0);
  });
  it('keeps smoothing equivalent across frame rates and long pauses bounded', () => {
    const settings = initialWavetable().mod[0]; settings[9] = 4 * 13107; settings[15] = 65535;
    const slow = new SourcePreview(0), fast = new SourcePreview(0);
    slow.advance(settings, undefined, 50);
    for (let i = 1; i <= 3; ++i) fast.advance(settings, undefined, i * 50 / 3);
    expect(fast.values[1]).toBeCloseTo(slow.values[1]);
    expect(slow.values[1]).toBeCloseTo(.05 / (.05 + .5));
    expect(fast.advance(settings, undefined, 3600000).every(Number.isFinite)).toBe(true);
  });
  it('matches modulation math and replaces offline/device input without changing a patch', () => {
    const preset = wavetablePreset('Live', initialWavetable());
    preset.routes[2] = {source: S.Lfo1, destination: P.Brightness, depth: -30000};
    const before = JSON.stringify(preset), preview = new WavetablePreview(preset, 0);
    preview.configure(preset, false, 32768); preview.advance(100);
    expect(preview.sources[0]).toBe(.8); expect(preview.sources[1]).toBe(32768 / 65535);
    preview.configure(preset, true, 32768); preview.setExpression(expression(10, true)); preview.advance(200);
    expect(preview.sources[0]).toBe(100 / 127); expect(preview.sources[1]).toBe(40000 / 65535);
    expect(preview.parameters).toEqual(effectiveWavetable(preset, preview.sources));
    expect(JSON.stringify(preset)).toBe(before);
  });
  it('releases subscribers on repeated mount/teardown and keeps fixed-size snapshots', () => {
    const preview = new WavetablePreview(wavetablePreset('Live', initialWavetable()), 0);
    const parameters = preview.parameters, sources = preview.sources;
    let callbacks = 0;
    for (let i = 0; i < 100; ++i) {
      const off = preview.subscribe(() => ++callbacks), offFrame = preview.subscribeFrame(() => ++callbacks);
      preview.advance(i * 17); off(); offFrame();
    }
    preview.advance(3600000);
    expect(callbacks).toBe(200); expect(preview.parameters).toBe(parameters); expect(preview.sources).toBe(sources);
    expect(parameters).toHaveLength(30); expect(sources).toHaveLength(11);
  });
  it('does not extend a frame when a render installs another subscription', () => {
    const preview = new WavetablePreview(wavetablePreset('Live', initialWavetable()), 0);
    let first = 0, added = 0;
    const off = preview.subscribe(() => { if (++first === 1) preview.subscribe(() => ++added); });
    preview.advance(20); expect(first).toBe(1); expect(added).toBe(0);
    preview.advance(40); expect(first).toBe(2); expect(added).toBe(1); off();
  });
});

describe('shared engine live preview contracts', () => {
  it('keeps Physical Strings modulation and controller defaults consistent', () => {
    const preset = physicalPresetFromUnknown(initialPreset), visual = new PhysicalPreview(preset, 0);
    visual.configure(preset, false, 32768); visual.advance(100);
    expect(visual.sources[8]).toBe(1);
    expect(visual.parameters).toEqual(effectiveParameters(preset, visual.sources));
    visual.configure(preset, true, 0); visual.setExpression(expression(10, true)); visual.advance(200);
    expect(visual.sources[1]).toBe(40000 / 65535);
    expect(visual.parameters).toEqual(effectiveParameters(preset, visual.sources));
    const next = {...preset, parameters: preset.parameters.map((v, i) => i === 5 ? 10000 : v)};
    visual.configure(next, true, 0); visual.advance(3600000);
    expect(visual.parameters).toEqual(effectiveParameters(next, visual.sources));
  });
  it.each([4, 5] as const)('keeps engine %i native sources and modulation finite across long pauses', engine => {
    const preset = initialClassic(engine), visual = new ClassicPreview(preset.patch, 0);
    visual.configure(preset.patch, true, 0); visual.setExpression(expression(5, true)); visual.advance(100);
    visual.advance(200);
    expect(visual.parameters).toEqual(effectiveAdvanced(preset.patch, visual.sources));
    expect(visual.sources.every(Number.isFinite)).toBe(true);
    visual.setExpression(expression(5, false)); visual.advance(3600000);
    expect(visual.parameters.every(Number.isFinite)).toBe(true);
    expect(visual.parameters).toEqual(effectiveAdvanced(preset.patch, visual.sources));
  });
});
