import { describe, expect, it } from "vitest";
import source from "../../public/synth-preview-worklet.js?raw";
import { createBasicShapesSamples, createFactorySynthWavetables } from "../catalogs/factoryWavetables.ts";

// Run the shipped worklet itself with an AudioWorklet host stub.
function engine(values: Record<string, number> = {}, rate = 48000, samples = createBasicShapesSamples()) {
  let Constructor: any;
  new Function("AudioWorkletProcessor", "registerProcessor", "sampleRate", source)(
    class { port = {}; }, (_name: string, ctor: any) => { Constructor = ctor; }, rate
  );
  const processor = new Constructor();
  processor.setPatch({ wavetableSamples: samples, values: {
    PlaybackMode: 1, EnvelopeAttackIndex: 0, EnvelopeHoldIndex: 0,
    EnvelopeDecayIndex: 0, EnvelopeSustainLevel: 127, EnvelopeReleaseIndex: 6,
    ...values
  } });
  processor.volume = 1;
  return processor;
}
function render(processor: any, count: number) {
  const output = new Float32Array(count);
  processor.process([], [[output]]);
  return output;
}
function rms(samples: Float32Array) {
  return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
}
function crossings(samples: Float32Array) {
  return samples.reduce((n, value, i) => n + Number(i > 0 && samples[i - 1] <= 0 && value > 0), 0);
}

describe("firmware synth audition", () => {
  it.each([44100, 48000])("renders A4 at 440 Hz at %i Hz", rate => {
    const synth = engine({}, rate);
    synth.noteOn(69, 1);
    const output = render(synth, rate);
    expect(crossings(output)).toBeGreaterThanOrEqual(439);
    expect(crossings(output)).toBeLessThanOrEqual(441);
    expect(rms(output)).toBeGreaterThan(0.5);
  });

  it("loads all actual factory tables, including the separate immutable rescue table", () => {
    const basic = createBasicShapesSamples();
    expect(basic.length).toBe(16 * 512 * 6);
    expect(createFactorySynthWavetables().some(table => table.name === "Basic Shapes")).toBe(false);
    for (const samples of [basic, ...createFactorySynthWavetables().map(table => table.samples)]) {
      const synth = engine({}, 48000, samples);
      expect(synth.activeWavetable).toHaveLength(6);
      expect(synth.activeWavetable[0]).toHaveLength(16);
      synth.noteOn(60, 1);
      const output = render(synth, 4800);
      expect(output.every(Number.isFinite)).toBe(true);
      expect(rms(output)).toBeGreaterThan(0.01);
    }
  });

  it("does not invent a sound when samples are unavailable", () => {
    const synth = engine({}, 48000, new Uint8Array());
    synth.noteOn(60, 1);
    expect(rms(render(synth, 1000))).toBe(0);
  });

  it("applies full LFO pitch depth as two octaves, with signed inversion", () => {
    for (const [amount, hz] of [[254, 1760], [0, 110]]) {
      const synth = engine({ SynthLfoWave: 3, SynthLfoSpeed: 0, SynthLfoTarget: 2, SynthLfoAmount: amount });
      synth.noteOn(69, 1);
      expect(crossings(render(synth, 24000))).toBeCloseTo(hz / 2, -1);
    }
  });

  it("follows attack and release timing without squaring the amplitude envelope", () => {
    const synth = engine({ EnvelopeAttackIndex: 8, EnvelopeReleaseIndex: 8 });
    synth.noteOn(69, 1);
    render(synth, 2400);
    expect(synth.voices[0].env.level).toBeCloseTo(0.5, 3);
    expect(rms(render(synth, 480))).toBeGreaterThan(0.34);
    synth.noteOff(69);
    render(synth, 4801);
    expect(rms(render(synth, 512))).toBe(0);
  });

  it("glides linearly to the destination within the selected time", () => {
    const synth = engine({ PlaybackMode: 4, SynthPortamentoTimeIndex: 8 });
    synth.noteOn(69, 1);
    synth.noteOn(81, 1);
    render(synth, 2400);
    expect(synth.voices[0].frequency).toBeCloseTo(660, 3);
    render(synth, 2400);
    expect(synth.voices[0].frequency).toBe(880);
    synth.noteOff(69); // Releasing an older held note must not retarget the lead.
    expect(synth.voices[0].note).toBe(81);
  });

  it("uses the firmware's cubic drive curve", () => {
    const synth = engine({ SynthDrive: 1 });
    expect(synth.applyDrive(0.5)).toBe(0.6875);
    expect(synth.applyDrive(-0.5)).toBe(-0.6875);
  });

  it("steals the oldest poly voice and silences all voices on stop or mode change", () => {
    const synth = engine({ PlaybackMode: 3 });
    for (let note = 60; note <= 68; note++) synth.noteOn(note, 1);
    expect(synth.voices.some((voice: any) => voice.note === 60)).toBe(false);
    expect(synth.voices.filter((voice: any) => voice.active)).toHaveLength(8);
    synth.allNotesOff();
    expect(rms(render(synth, 256))).toBe(0);
    synth.noteOn(60, 1);
    synth.setPatch({ values: { PlaybackMode: 0 } });
    expect(rms(render(synth, 256))).toBe(0);
  });
});
