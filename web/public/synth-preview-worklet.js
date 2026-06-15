const ENVELOPE_TIMES_SECONDS = [
  0, 0.005, 0.01, 0.015, 0.02, 0.03, 0.05, 0.075, 0.1, 0.15,
  0.2, 0.3, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4
];

const LFO_SPEEDS_HZ = [
  0.05, 0.1, 0.2, 0.33, 0.5, 0.75, 1, 1.25, 1.5, 2,
  2.5, 3, 4, 5, 6, 8, 10, 12, 16, 20
];

const FRAME_COUNT = 32;
const SAMPLE_COUNT = 512;
const MAX_VOICES = 8;
const TARGET_FOLD_WARP = 0;
const TARGET_VIBRATO = 1;
const TARGET_PITCH = 2;
const TARGET_WAVETABLE_POSITION = 3;
const TARGET_DUTY_WARP = 4;
const TARGET_POLY_WARP = 5;
const MODE_MONO_RETRIGGER = 1;
const MODE_ARPEGGIO = 2;
const MODE_POLY = 3;
const MODE_MONO_LEGATO = 4;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function midiToFrequency(note) {
  return 440 * 2 ** ((note - 69) / 12);
}

function wrapPhase(value) {
  value %= 1;
  return value < 0 ? value + 1 : value;
}

function triangle(phase) {
  return 1 - 4 * Math.abs(Math.round(phase - 0.25) - (phase - 0.25));
}

function saw(phase) {
  return phase * 2 - 1;
}

function square(phase, duty = 0.5) {
  return phase < duty ? 1 : -1;
}

function sine(phase) {
  return Math.sin(phase * Math.PI * 2);
}

function smoothStep(value) {
  return value * value * (3 - 2 * value);
}

function blend(a, b, amount) {
  return a + (b - a) * amount;
}

function normalizeSample(value) {
  return clamp(value, -1, 1);
}

function generatedTableSample(name, frame, phase) {
  const frameT = FRAME_COUNT <= 1 ? 0 : frame / (FRAME_COUNT - 1);
  const harmonic = (multiplier, gain) => sine(wrapPhase(phase * multiplier)) * gain;

  switch (name) {
    case "Classic":
      return normalizeSample(
        harmonic(1, 0.78)
        + harmonic(2, blend(0.05, 0.2, frameT))
        + harmonic(3, blend(0.1, 0.28, frameT))
        + harmonic(5, blend(0.03, 0.12, frameT))
      );
    case "Edge":
      return normalizeSample(
        blend(saw(phase), square(phase, blend(0.42, 0.58, frameT)), 0.35)
        + harmonic(7, 0.12)
        - harmonic(11, 0.06)
      );
    case "Glass":
      return normalizeSample(
        harmonic(1, 0.52)
        + harmonic(blend(2.01, 2.8, frameT), 0.38)
        + harmonic(blend(4.7, 6.2, frameT), 0.2)
        + harmonic(9.1, 0.08)
      );
    case "Digital":
      return normalizeSample(
        Math.tanh(
          blend(saw(phase), square(wrapPhase(phase * 2), 0.5), frameT) * 1.5
          + harmonic(8, 0.28)
        )
      );
    case "Motion":
      return normalizeSample(
        blend(sine(phase), triangle(phase), smoothStep(frameT)) * 0.8
        + harmonic(blend(2, 5, frameT), 0.18)
        + harmonic(blend(5, 2, frameT), 0.12)
      );
    case "Basic":
    default: {
      if (frameT < 1 / 3) {
        return blend(sine(phase), triangle(phase), frameT * 3);
      }
      if (frameT < 2 / 3) {
        return blend(triangle(phase), saw(phase), (frameT - 1 / 3) * 3);
      }
      return blend(saw(phase), square(phase, 0.5), (frameT - 2 / 3) * 3);
    }
  }
}

function createGeneratedWavetable(name) {
  const frames = [];
  for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
    const samples = new Float32Array(SAMPLE_COUNT);
    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      samples[index] = generatedTableSample(name, frame, index / SAMPLE_COUNT);
    }
    frames.push(samples);
  }
  return frames;
}

function wavetableFromBytes(bytes) {
  if (!bytes || bytes.length !== FRAME_COUNT * SAMPLE_COUNT) {
    return null;
  }
  const frames = [];
  for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
    const samples = new Float32Array(SAMPLE_COUNT);
    const offset = frame * SAMPLE_COUNT;
    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      samples[index] = clamp((bytes[offset + index] - 128) / 128, -1, 1);
    }
    frames.push(samples);
  }
  return frames;
}

class Envelope {
  constructor() {
    this.stage = "idle";
    this.level = 0;
    this.holdSamplesRemaining = 0;
    this.releaseStep = 0;
    this.params = {
      attack: 0,
      hold: 0,
      decay: 0,
      sustain: 0,
      release: 0
    };
  }

  configure(attackIndex, holdIndex, decayIndex, sustainLevel, releaseIndex, sampleRateValue) {
    this.params = {
      attack: ENVELOPE_TIMES_SECONDS[clamp(Math.round(attackIndex), 0, ENVELOPE_TIMES_SECONDS.length - 1)] ?? 0,
      hold: ENVELOPE_TIMES_SECONDS[clamp(Math.round(holdIndex), 0, ENVELOPE_TIMES_SECONDS.length - 1)] ?? 0,
      decay: ENVELOPE_TIMES_SECONDS[clamp(Math.round(decayIndex), 0, ENVELOPE_TIMES_SECONDS.length - 1)] ?? 0,
      sustain: clamp(sustainLevel / 127, 0, 1),
      release: ENVELOPE_TIMES_SECONDS[clamp(Math.round(releaseIndex), 0, ENVELOPE_TIMES_SECONDS.length - 1)] ?? 0,
      sampleRate: sampleRateValue
    };
  }

  attack() {
    this.releaseStep = 0;
    this.holdSamplesRemaining = 0;
    if (this.params.attack <= 0) {
      this.level = 1;
      this.advanceFromPeak();
      return;
    }
    this.level = 0;
    this.stage = "attack";
  }

  release() {
    if (this.stage === "idle" || this.level <= 0 || this.params.release <= 0) {
      this.level = 0;
      this.stage = "idle";
      return;
    }
    this.stage = "release";
    this.releaseStep = this.level / Math.max(1, this.params.release * this.params.sampleRate);
  }

  advanceFromPeak() {
    this.level = 1;
    if (this.params.hold > 0) {
      this.stage = "hold";
      this.holdSamplesRemaining = Math.max(1, Math.round(this.params.hold * this.params.sampleRate));
    } else if (this.params.decay > 0 && this.params.sustain < 1) {
      this.stage = "decay";
    } else {
      this.stage = "sustain";
      this.level = this.params.sustain;
    }
  }

  next() {
    switch (this.stage) {
      case "attack": {
        this.level += 1 / Math.max(1, this.params.attack * this.params.sampleRate);
        if (this.level >= 1) {
          this.advanceFromPeak();
        }
        break;
      }
      case "hold":
        this.level = 1;
        this.holdSamplesRemaining -= 1;
        if (this.holdSamplesRemaining <= 0) {
          this.stage = this.params.decay > 0 && this.params.sustain < 1 ? "decay" : "sustain";
          if (this.stage === "sustain") {
            this.level = this.params.sustain;
          }
        }
        break;
      case "decay": {
        const step = (1 - this.params.sustain) / Math.max(1, this.params.decay * this.params.sampleRate);
        this.level -= step;
        if (this.level <= this.params.sustain) {
          this.level = this.params.sustain;
          this.stage = "sustain";
        }
        break;
      }
      case "sustain":
        this.level = this.params.sustain;
        break;
      case "release":
        this.level -= this.releaseStep;
        if (this.level <= 0) {
          this.level = 0;
          this.stage = "idle";
        }
        break;
      case "idle":
      default:
        this.level = 0;
        break;
    }
    return this.level;
  }
}

class Voice {
  constructor() {
    this.phase = 0;
    this.frequency = 0;
    this.targetFrequency = 0;
    this.note = -1;
    this.velocity = 1;
    this.active = false;
    this.age = 0;
    this.env = new Envelope();
    this.fxEnvs = [new Envelope(), new Envelope()];
  }

  configure(patch) {
    const values = patch.values;
    this.env.configure(
      values.EnvelopeAttackIndex,
      values.EnvelopeHoldIndex,
      values.EnvelopeDecayIndex,
      values.EnvelopeSustainLevel,
      values.EnvelopeReleaseIndex,
      sampleRate
    );
    this.fxEnvs[0].configure(
      values.EffectEnvelopeAttackIndex,
      values.EffectEnvelopeHoldIndex,
      values.EffectEnvelopeDecayIndex,
      values.EffectEnvelopeSustainLevel,
      values.EffectEnvelopeReleaseIndex,
      sampleRate
    );
    this.fxEnvs[1].configure(
      values.EffectEnvelope2AttackIndex,
      values.EffectEnvelope2HoldIndex,
      values.EffectEnvelope2DecayIndex,
      values.EffectEnvelope2SustainLevel,
      values.EffectEnvelope2ReleaseIndex,
      sampleRate
    );
  }

  trigger(note, velocity, patch, retrigger) {
    this.configure(patch);
    this.note = note;
    this.targetFrequency = midiToFrequency(note);
    if (!this.active || retrigger) {
      this.frequency = this.targetFrequency;
      this.phase = 0;
      this.env.attack();
      this.fxEnvs.forEach((env) => env.attack());
    }
    this.velocity = clamp(velocity, 0, 1);
    this.active = true;
    this.age += 1;
  }

  release() {
    this.env.release();
    this.fxEnvs.forEach((env) => env.release());
  }

  render(processor) {
    if (!this.active) {
      return { sample: 0, envelope: 0 };
    }

    const patch = processor.patch;
    const values = patch.values;
    const envLevel = this.env.next();
    const fxLevels = this.fxEnvs.map((env) => env.next());
    if (this.env.stage === "idle") {
      this.active = false;
      this.note = -1;
      this.frequency = 0;
      this.targetFrequency = 0;
      return { sample: 0, envelope: 0 };
    }

    const glideSeconds = ENVELOPE_TIMES_SECONDS[clamp(values.SynthPortamentoTimeIndex, 0, ENVELOPE_TIMES_SECONDS.length - 1)] ?? 0;
    if (glideSeconds > 0 && this.frequency > 0) {
      const glideStep = 1 / Math.max(1, glideSeconds * sampleRate);
      this.frequency += (this.targetFrequency - this.frequency) * glideStep;
    } else {
      this.frequency = this.targetFrequency;
    }

    let foldWarp = 0;
    let dutyWarp = 0;
    let polyWarp = 0;
    let vibrato = 0;
    let pitch = 0;
    let wavetablePosition = 0;

    const addTarget = (target, amount) => {
      if (!Number.isFinite(amount) || amount === 0) {
        return;
      }
      switch (target) {
        case TARGET_FOLD_WARP:
          foldWarp += amount;
          break;
        case TARGET_DUTY_WARP:
          dutyWarp += amount;
          break;
        case TARGET_POLY_WARP:
          polyWarp += amount;
          break;
        case TARGET_VIBRATO:
          vibrato += amount;
          break;
        case TARGET_PITCH:
          pitch += amount;
          break;
        case TARGET_WAVETABLE_POSITION:
          wavetablePosition += amount;
          break;
        default:
          break;
      }
    };

    addTarget(values.SynthModTarget, processor.modValue * (values.SynthModAmount / 127));
    addTarget(values.SynthLfoTarget, processor.lfoSample() * ((values.SynthLfoAmount - 127) / 127));
    addTarget(values.EffectEnvelopeTarget, fxLevels[0] * (values.EffectEnvelopeAmount - 127));
    addTarget(values.EffectEnvelope2Target, fxLevels[1] * (values.EffectEnvelope2Amount - 127));

    pitch = clamp(pitch, -127, 127);
    vibrato = clamp(vibrato, -127, 127);
    foldWarp = clamp(foldWarp, -127, 127);
    dutyWarp = clamp(dutyWarp, -127, 127);
    polyWarp = clamp(polyWarp, -127, 127);
    wavetablePosition = clamp(wavetablePosition, -127, 127);

    const vibratoSemitones = (vibrato / 127) * 0.8 * processor.vibratoSample();
    const pitchSemitones = (pitch / 127) * 24;
    const frequency = this.frequency * 2 ** ((pitchSemitones + vibratoSemitones) / 12);
    this.phase = wrapPhase(this.phase + frequency / sampleRate);

    let phase = this.phase;
    if (foldWarp !== 0) {
      const amount = foldWarp / 127;
      phase = wrapPhase(phase + triangle(phase) * amount * 0.18);
    }
    if (dutyWarp !== 0) {
      const amount = dutyWarp / 127;
      const bend = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
      phase = wrapPhase(phase + bend * amount * 0.14);
    }
    if (polyWarp !== 0) {
      const amount = polyWarp / 127;
      phase = wrapPhase(phase + sine(wrapPhase(phase * 3)) * amount * 0.08);
    }

    const position = clamp(values.SynthWavetablePosition + wavetablePosition, 0, 127);
    const sample = processor.readWavetable(phase, position);
    return {
      sample: sample * envLevel * this.velocity,
      envelope: envLevel
    };
  }
}

class SynthPreviewProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.patch = this.defaultPatch();
    this.volume = 0.35;
    this.modValue = 0;
    this.voices = Array.from({ length: MAX_VOICES }, () => new Voice());
    this.heldNotes = [];
    this.heldOrder = [];
    this.arpCursor = 0;
    this.arpDirection = 1;
    this.arpSamplesUntilNext = 0;
    this.lfoPhase = 0;
    this.vibratoPhase = 0;
    this.currentLfoSample = 0;
    this.currentVibratoSample = 0;
    this.outputSmooth = 0;
    this.generatedWavetables = new Map();
    this.activeWavetable = createGeneratedWavetable("Basic");

    this.port.onmessage = (event) => {
      const message = event.data;
      switch (message.type) {
        case "setPatch":
          this.setPatch(message.patch);
          break;
        case "noteOn":
          this.noteOn(message.note, message.velocity ?? 0.9);
          break;
        case "noteOff":
          this.noteOff(message.note);
          break;
        case "allNotesOff":
          this.allNotesOff();
          break;
        case "setVolume":
          this.volume = clamp(message.volume, 0, 1);
          break;
        case "setMod":
          this.modValue = clamp(message.value, 0, 127);
          break;
        default:
          break;
      }
    };
  }

  defaultPatch() {
    return {
      wavetableName: "Basic",
      values: {
        PlaybackMode: MODE_POLY,
        SynthDrive: 0,
        SynthModTarget: TARGET_FOLD_WARP,
        SynthModAmount: 127,
        SynthVibratoSpeed: 5,
        ArpeggiatorDivision: 32,
        SynthBPM: 120,
        EnvelopeAttackIndex: 0,
        EnvelopeHoldIndex: 0,
        EnvelopeDecayIndex: 6,
        EnvelopeSustainLevel: 100,
        EnvelopeReleaseIndex: 6,
        EffectEnvelopeTarget: TARGET_VIBRATO,
        EffectEnvelopeAmount: 127,
        EffectEnvelopeAttackIndex: 0,
        EffectEnvelopeHoldIndex: 0,
        EffectEnvelopeDecayIndex: 0,
        EffectEnvelopeSustainLevel: 0,
        EffectEnvelopeReleaseIndex: 0,
        EffectEnvelope2Target: TARGET_PITCH,
        EffectEnvelope2Amount: 127,
        EffectEnvelope2AttackIndex: 0,
        EffectEnvelope2HoldIndex: 0,
        EffectEnvelope2DecayIndex: 0,
        EffectEnvelope2SustainLevel: 0,
        EffectEnvelope2ReleaseIndex: 0,
        SynthPortamentoTimeIndex: 0,
        ArpeggiatorDirection: 0,
        SynthWavetablePosition: 0,
        SynthLfoTarget: TARGET_FOLD_WARP,
        SynthLfoAmount: 127,
        SynthLfoWave: 0,
        SynthLfoSpeed: 6
      }
    };
  }

  setPatch(patch) {
    this.patch = {
      ...this.defaultPatch(),
      ...patch,
      values: {
        ...this.defaultPatch().values,
        ...(patch?.values ?? {})
      }
    };
    const sampleBytes = patch?.wavetableSamples ? new Uint8Array(patch.wavetableSamples) : null;
    this.activeWavetable = wavetableFromBytes(sampleBytes) ?? this.generatedWavetable(this.patch.wavetableName);
    this.voices.forEach((voice) => voice.configure(this.patch));
  }

  generatedWavetable(name) {
    const tableName = name || "Basic";
    if (!this.generatedWavetables.has(tableName)) {
      this.generatedWavetables.set(tableName, createGeneratedWavetable(tableName));
    }
    return this.generatedWavetables.get(tableName);
  }

  noteOn(note, velocity) {
    const mode = this.patch.values.PlaybackMode;
    if (mode === 0) {
      return;
    }
    if (!this.heldNotes.includes(note)) {
      this.heldNotes.push(note);
      this.heldOrder.push(note);
    }
    if (mode === MODE_ARPEGGIO) {
      if (!this.voices[0].active) {
        this.triggerArpNote(note);
      }
      return;
    }
    if (mode === MODE_MONO_RETRIGGER || mode === MODE_MONO_LEGATO) {
      this.voices[0].trigger(note, velocity, this.patch, mode === MODE_MONO_RETRIGGER || !this.voices[0].active);
      return;
    }

    let voice = this.voices.find((candidate) => !candidate.active);
    if (!voice) {
      voice = this.voices.reduce((oldest, candidate) => candidate.age < oldest.age ? candidate : oldest, this.voices[0]);
    }
    voice.trigger(note, velocity, this.patch, true);
  }

  noteOff(note) {
    this.heldNotes = this.heldNotes.filter((held) => held !== note);
    this.heldOrder = this.heldOrder.filter((held) => held !== note);
    const mode = this.patch.values.PlaybackMode;
    if (mode === MODE_ARPEGGIO) {
      if (this.heldNotes.length === 0) {
        this.voices[0].release();
      }
      return;
    }
    if (mode === MODE_MONO_RETRIGGER || mode === MODE_MONO_LEGATO) {
      if (this.heldNotes.length > 0) {
        const nextNote = this.heldNotes[this.heldNotes.length - 1];
        this.voices[0].trigger(nextNote, 0.9, this.patch, mode === MODE_MONO_RETRIGGER);
      } else {
        this.voices[0].release();
      }
      return;
    }
    this.voices.filter((voice) => voice.note === note).forEach((voice) => voice.release());
  }

  allNotesOff() {
    this.heldNotes = [];
    this.heldOrder = [];
    this.voices.forEach((voice) => voice.release());
  }

  lfoSample() {
    return this.currentLfoSample;
  }

  vibratoSample() {
    return this.currentVibratoSample;
  }

  stepModulators() {
    const values = this.patch.values;
    const speed = LFO_SPEEDS_HZ[clamp(values.SynthLfoSpeed, 0, LFO_SPEEDS_HZ.length - 1)] ?? 1;
    this.lfoPhase = wrapPhase(this.lfoPhase + speed / sampleRate);
    switch (values.SynthLfoWave) {
      case 1:
        this.currentLfoSample = triangle(this.lfoPhase);
        break;
      case 2:
        this.currentLfoSample = saw(this.lfoPhase);
        break;
      case 3:
        this.currentLfoSample = square(this.lfoPhase);
        break;
      case 0:
      default:
        this.currentLfoSample = sine(this.lfoPhase);
        break;
    }
    const vibratoSpeed = clamp((values.SynthVibratoSpeed ?? 5) + 1, 1, 12);
    this.vibratoPhase = wrapPhase(this.vibratoPhase + vibratoSpeed / sampleRate);
    this.currentVibratoSample = sine(this.vibratoPhase);
  }

  readWavetable(phase, position) {
    const framePosition = (position / 127) * (FRAME_COUNT - 1);
    const frameA = Math.floor(framePosition);
    const frameB = Math.min(FRAME_COUNT - 1, frameA + 1);
    const frameFrac = framePosition - frameA;
    const samplePosition = phase * SAMPLE_COUNT;
    const sampleA = Math.floor(samplePosition) % SAMPLE_COUNT;
    const sampleB = (sampleA + 1) % SAMPLE_COUNT;
    const sampleFrac = samplePosition - Math.floor(samplePosition);
    const tableA = this.activeWavetable[frameA] ?? this.activeWavetable[0];
    const tableB = this.activeWavetable[frameB] ?? tableA;
    const valueA = blend(tableA[sampleA], tableA[sampleB], sampleFrac);
    const valueB = blend(tableB[sampleA], tableB[sampleB], sampleFrac);
    return blend(valueA, valueB, frameFrac);
  }

  nextArpIntervalSamples() {
    const bpm = clamp(this.patch.values.SynthBPM || 120, 1, 255);
    const division = Math.max(1, this.patch.values.ArpeggiatorDivision || 16);
    return Math.max(1, Math.round((240 / bpm / division) * sampleRate));
  }

  orderedArpNotes() {
    const direction = this.patch.values.ArpeggiatorDirection;
    if (direction === 2 || direction === 3) {
      const ordered = [...this.heldOrder];
      return direction === 3 ? ordered.reverse() : ordered;
    }
    const sorted = [...this.heldNotes].sort((a, b) => a - b);
    if (direction === 1) {
      return sorted.reverse();
    }
    if (direction === 4) {
      return [...sorted, ...sorted.slice(1, -1).reverse()];
    }
    if (direction === 5) {
      const down = sorted.reverse();
      return [...down, ...down.slice(1, -1).reverse()];
    }
    if (direction === 6) {
      return [...sorted].sort(() => Math.random() - 0.5);
    }
    return sorted;
  }

  triggerArpNote(fallbackNote = null) {
    const notes = this.orderedArpNotes();
    if (notes.length === 0 && fallbackNote === null) {
      return;
    }
    const note = notes.length === 0 ? fallbackNote : notes[this.arpCursor % notes.length];
    this.arpCursor = (this.arpCursor + 1) % Math.max(1, notes.length);
    this.voices[0].trigger(note, 0.9, this.patch, true);
    this.arpSamplesUntilNext = this.nextArpIntervalSamples();
  }

  stepArp() {
    if (this.patch.values.PlaybackMode !== MODE_ARPEGGIO || this.heldNotes.length === 0) {
      return;
    }
    this.arpSamplesUntilNext -= 1;
    if (this.arpSamplesUntilNext <= 0) {
      this.triggerArpNote();
    }
  }

  applyDrive(sample) {
    switch (this.patch.values.SynthDrive) {
      case 1:
        return Math.tanh(sample * 1.15) / Math.tanh(1.15);
      case 2:
        return Math.tanh(sample * 1.8) / Math.tanh(1.8);
      case 3:
        return Math.tanh(sample * 2.8) / Math.tanh(2.8);
      case 0:
      default:
        return sample;
    }
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    const left = output[0];
    const right = output[1] ?? output[0];

    for (let index = 0; index < left.length; index += 1) {
      this.stepArp();
      this.stepModulators();
      let mix = 0;
      let envelopeSum = 0;
      let activeCount = 0;
      for (const voice of this.voices) {
        const rendered = voice.render(this);
        mix += rendered.sample;
        envelopeSum += rendered.envelope;
        if (rendered.envelope > 0) {
          activeCount += 1;
        }
      }

      if (activeCount > 1) {
        mix /= Math.sqrt(activeCount);
      }
      const dynamicLevel = activeCount > 0 ? clamp(envelopeSum / activeCount, 0.25, 1) : 0;
      let sample = this.applyDrive(mix * dynamicLevel) * this.volume;
      sample = clamp(sample, -0.95, 0.95);
      this.outputSmooth += (sample - this.outputSmooth) * 0.45;
      left[index] = this.outputSmooth;
      right[index] = this.outputSmooth;
    }
    return true;
  }
}

registerProcessor("hexboard-synth-preview", SynthPreviewProcessor);
