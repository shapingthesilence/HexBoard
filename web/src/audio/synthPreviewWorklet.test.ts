import { describe, expect, it } from "vitest";
import source from "./synth-preview-worklet.js?raw";
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
  it("renders a bent MIDI note and retunes it without restarting its envelope", () => {
    const synth = engine();
    synth.noteOn(69, 1, "midi:1:69", 12);
    expect(crossings(render(synth, 48000))).toBeCloseTo(880, -1);
    synth.setPitch("midi:1:69", 0);
    expect(crossings(render(synth, 48000))).toBeCloseTo(440, -1);
    expect(synth.voices[0].env.stage).toBe("sustain");
  });

  it("releases channel unisons independently from each other and onscreen notes", () => {
    const synth = engine({ PlaybackMode: 3 });
    synth.noteOn(60, 1);
    synth.noteOn(60, 0.5, "midi:1:60", 0.5);
    synth.noteOn(60, 1, "midi:2:60", -0.5);
    synth.noteOff("midi:1:60");
    expect(synth.voices[0].env.stage).toBe("sustain");
    expect(synth.voices[1].env.stage).toBe("release");
    expect(synth.voices[2].env.stage).toBe("sustain");
    synth.noteOff("midi:2:60", true);
    expect(synth.voices[2].active).toBe(false);
  });

  it("restores the previous mono note's velocity and bend when the newest is released", () => {
    const synth = engine({ PlaybackMode: 4 });
    synth.noteOn(60, 0.25, "midi:1:60", 0.5);
    synth.noteOn(67, 1, "midi:2:67", -0.5);
    synth.setPitch("midi:1:60", 1);
    synth.noteOff("midi:2:67");
    expect(synth.voices[0].id).toBe("midi:1:60");
    expect(synth.voices[0].pitchOffset).toBe(1);
    expect(synth.voices[0].velocity).toBe(0.25);
  });

  it("sorts MIDI arpeggios by bent pitch and retains velocity", () => {
    const synth = engine({ PlaybackMode: 2 });
    synth.noteOn(60, 0.25, "midi:1:60", 12);
    synth.noteOn(67, 0.5, "midi:2:67", 0);
    expect(synth.orderedArpNotes()).toEqual(["midi:2:67", "midi:1:60"]);
    synth.arpCursor = 0;
    synth.triggerArpNote();
    render(synth, 97); // finish the 2 ms handoff
    expect(synth.voices[0].note).toBe(67);
    expect(synth.voices[0].velocity).toBe(0.5);
  });
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
    render(synth, 97);
    expect(synth.voices.some((voice: any) => voice.note === 60)).toBe(false);
    expect(synth.voices.filter((voice: any) => voice.active)).toHaveLength(8);
    synth.allNotesOff();
    expect(rms(render(synth, 256))).toBe(0);
    synth.noteOn(60, 1);
    synth.setPatch({ values: { PlaybackMode: 0 } });
    expect(rms(render(synth, 256))).toBe(0);
  });
});

it("plays fractional pitches without quantizing microtonal intervals", () => {
  const processor = engine();
  const pitch = 60 + 12 / 19;
  processor.noteOn(pitch, 1);
  expect(processor.voices.find((voice: any) => voice.active).targetFrequency).toBeCloseTo(440 * 2 ** ((pitch - 69) / 12), 8);
  expect(rms(render(processor, 1024))).toBeGreaterThan(0);
  processor.noteOff(pitch);
  expect(processor.heldNotes).toHaveLength(0);
});


describe("arp gates and smooth retriggers", () => {
  it.each([2, 6])("releases at the selected percentage in mode %i", mode => {
    const synth = engine({ PlaybackMode: mode, SynthBPM: 120, ArpeggiatorDivision: 4, ArpeggiatorNoteLength: 25 });
    synth.noteOn(60, 1);
    render(synth, 5999);
    expect(synth.voices[0].env.stage).toBe("sustain");
    render(synth, 1);
    expect(synth.voices[0].env.stage).toBe("release");
    render(synth, 18000);
    expect(synth.arpVoice).not.toBeNull();
  });

  it("overlaps poly arp releases without playing the full held chord", () => {
    const synth = engine({ PlaybackMode: 6, SynthBPM: 120, ArpeggiatorDivision: 16,
      ArpeggiatorNoteLength: 100, EnvelopeReleaseIndex: 12 });
    synth.noteOn(60, 1);
    synth.noteOn(64, 0.5);
    expect(synth.voices.filter((v: any) => v.active)).toHaveLength(1);
    render(synth, 6001);
    expect(synth.voices[0].env.stage).toBe("release");
    expect(synth.voices[1].note).toBe(64);
    expect(synth.voices[1].env.stage).toBe("sustain");
    expect(synth.voices[1].velocity).toBe(0.5);
    synth.noteOff(60);
    synth.noteOff(64);
    render(synth, 24001);
    expect(synth.voices.every((v: any) => !v.active)).toBe(true);
  });

  it("fades the old oscillator before restarting a mono note", () => {
    const table = new Uint8Array(16 * 512).fill(255);
    const synth = engine({}, 48000, table);
    synth.noteOn(60, 1);
    render(synth, 100);
    synth.noteOn(64, 1);
    const fade = render(synth, 96);
    expect(fade[0]).toBeGreaterThan(0.9);
    expect(fade[95]).toBeLessThan(0.02);
    for (let i = 1; i < fade.length; i++) expect(fade[i]).toBeLessThan(fade[i - 1]);
    render(synth, 1);
    expect(synth.voices[0].note).toBe(64);
  });

  it("cancels pending notes on release and panic", () => {
    const synth = engine();
    synth.noteOn(60, 1);
    synth.noteOn(64, 1);
    synth.noteOff(64);
    render(synth, 100);
    expect(synth.voices[0].note).toBe(60);
    synth.noteOn(67, 1);
    synth.allNotesOff();
    expect(rms(render(synth, 500))).toBe(0);
    expect(synth.voices.every((v: any) => !v.pendingTrigger)).toBe(true);
  });

  it("Off targets leave the sound unchanged even at full modulation depth", () => {
    const plain = engine();
    const off = engine({ SynthModTarget: 6, SynthModAmount: 127, SynthLfoTarget: 6, SynthLfoAmount: 254,
      EffectEnvelopeTarget: 6, EffectEnvelopeAmount: 254, EffectEnvelopeSustainLevel: 127,
      EffectEnvelope2Target: 6, EffectEnvelope2Amount: 254, EffectEnvelope2SustainLevel: 127 });
    off.modValue = 127;
    plain.noteOn(60, 1); off.noteOn(60, 1);
    expect(render(off, 1000)).toEqual(render(plain, 1000));
  });
});


describe("latched volume envelope wheel targets and short timing", () => {
  it.each([[7, "attack"], [8, "hold"], [9, "decay"], [10, "sustain"], [11, "release"]])(
    "captures target %i for new envelopes without changing existing %s", (target, parameter) => {
      const synth = engine({ PlaybackMode: 3, SynthModTarget: Number(target), SynthModAmount: 127,
        EnvelopeAttackIndex: 1, EnvelopeHoldIndex: 1, EnvelopeDecayIndex: 1,
        EnvelopeSustainLevel: 32, EnvelopeReleaseIndex: 1 });
      synth.modValue = 127;
      synth.noteOn(60, 1);
      const expected = parameter === "sustain" ? 1 : 4;
      expect(synth.voices[0].env.params[parameter]).toBe(expected);
      synth.modValue = 0;
      render(synth, 2400);
      render(synth, 1);
      expect(synth.voices[0].env.params[parameter]).toBe(expected);
      synth.noteOn(64, 1);
      expect(synth.voices[1].env.params[parameter]).toBe(parameter === "sustain" ? 32 / 127 : 0.005);
      expect(synth.patch.values.EnvelopeAttackIndex).toBe(1);
    });

  it("scales depth at attack and leaves held sustain alone", () => {
    const synth = engine({ PlaybackMode: 3, SynthModTarget: 10, SynthModAmount: 64, EnvelopeSustainLevel: 32 });
    synth.noteOn(60, 1);
    synth.modValue = 127;
    render(synth, 2400);
    render(synth, 1);
    expect(synth.voices[0].env.level).toBeCloseTo(32 / 127);
    synth.noteOn(64, 1);
    expect(synth.voices[1].env.level).toBeCloseTo(32 / 127 + (1 - 32 / 127) * 64 / 127);
  });

  it("captures wheel release duration at note-off and keeps that duration afterward", () => {
    const synth = engine({ SynthModTarget: 11 });
    synth.noteOn(60, 1);
    synth.modValue = 127;
    render(synth, 2400);
    render(synth, 1);
    synth.noteOff(60);
    synth.modValue = 0;
    render(synth, 2400);
    render(synth, 45600);
    expect(synth.voices[0].env.level).toBeCloseTo(0.75, 3);
    expect(synth.voices[0].env.params.release).toBe(4);
  });

  it("polls the envelope wheel no faster than 20 Hz", () => {
    const synth = engine({ PlaybackMode: 3, SynthModTarget: 10, EnvelopeSustainLevel: 32 });
    synth.noteOn(60, 1);
    synth.modValue = 127;
    render(synth, 128);
    synth.noteOn(64, 1);
    expect(synth.voices[1].env.params.sustain).toBe(32 / 127);
    render(synth, 2400);
    synth.noteOn(67, 1);
    expect(synth.voices[2].env.params.sustain).toBe(1);
  });

  it("retains original time indices and appends approximately 3 ms", () => {
    const synth = engine({ EnvelopeAttackIndex: 20, EnvelopeHoldIndex: 20,
      EnvelopeDecayIndex: 20, EnvelopeReleaseIndex: 20, EnvelopeSustainLevel: 64,
      EffectEnvelopeAttackIndex: 20, EffectEnvelopeHoldIndex: 20,
      EffectEnvelopeDecayIndex: 20, EffectEnvelopeReleaseIndex: 20 });
    synth.noteOn(60, 1);
    const voice = synth.voices[0];
    for (const param of ["attack", "hold", "decay", "release"]) {
      expect(voice.env.params[param]).toBe(0.003);
      expect(voice.fxEnvs[0].params[param]).toBe(0.003);
    }
    render(synth, 72);
    expect(voice.env.level).toBeCloseTo(0.5);
    render(synth, 450);
    synth.noteOff(60);
    render(synth, 145);
    expect(voice.active).toBe(false);
    const legacy = engine({ EnvelopeAttackIndex: 1, EnvelopeReleaseIndex: 19 });
    legacy.noteOn(60, 1);
    expect(legacy.voices[0].env.params.attack).toBe(0.005);
    expect(legacy.voices[0].env.params.release).toBe(4);
  });
});

describe("negative wheel depth", () => {
  it.each([[7, "attack"], [8, "hold"], [9, "decay"], [10, "sustain"], [11, "release"]])(
    "lowers volume envelope target %i toward zero", (target, parameter) => {
      const synth = engine({ SynthModTarget: Number(target), SynthModAmount: 254,
        EnvelopeAttackIndex: 1, EnvelopeHoldIndex: 1, EnvelopeDecayIndex: 1,
        EnvelopeSustainLevel: 64, EnvelopeReleaseIndex: 1 });
      synth.modValue = 127;
      synth.noteOn(60, 1);
      expect(synth.voices[0].env.params[parameter]).toBe(0);
      if (parameter === "release") {
        synth.noteOff(60);
        expect(synth.voices[0].env.params.release).toBe(0.002);
      }
    });
  it("bends pitch downward and leaves saved depth intact", () => {
    const plain = engine();
    const synth = engine({ SynthModTarget: 2, SynthModAmount: 254 });
    plain.noteOn(60, 1); synth.noteOn(60, 1);
    synth.modValue = 127;
    render(plain, 100); render(synth, 100);
    expect(synth.voices[0].phase).toBeCloseTo(plain.voices[0].phase / 4, 6);
    expect(synth.patch.values.SynthModAmount).toBe(254);
  });
});
