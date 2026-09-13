const ENVELOPE_TIMES_SECONDS = [
  0, 0.005, 0.01, 0.015, 0.02, 0.03, 0.05, 0.075, 0.1, 0.15,
  0.2, 0.3, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4
];

const LFO_SPEEDS_HZ = [
  0.05, 0.1, 0.2, 0.333, 0.5, 0.75, 1, 1.25, 1.5, 2,
  2.5, 3, 4, 5, 6, 8, 10, 12, 16, 20
];

const FRAME_COUNT = 16;
const MIP_LIMITS = [192, 96, 48, 24, 12, 6];
const DEVICE_SAMPLE_RATE = 200000000 / 1024 / 6;
const ATTENUATION = [64, 24, 17, 14, 12, 11, 10, 9, 8];
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
const LFO_NOISE_SEGMENTS = 16;
const VIBRATO_SPEED_NOISE = 12;

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

function nextNoiseState(state) {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return state >>> 0;
}

function noiseStateSample(state) {
  return ((state >>> 24) / 127.5) - 1;
}

function blend(a, b, amount) {
  return a + (b - a) * amount;
}

// Use the same 16 x 512 byte frames and optional six mip levels as firmware.
// Missing tables stay silent instead of impersonating the selected instrument.
function wavetableFromBytes(bytes) {
  const stride = FRAME_COUNT * SAMPLE_COUNT;
  if (!bytes || (bytes.length !== stride && bytes.length !== stride * MIP_LIMITS.length)) return null;
  return Array.from({ length: bytes.length / stride }, (_, level) =>
    Array.from({ length: FRAME_COUNT }, (_, frame) =>
      Float32Array.from(bytes.subarray(level * stride + frame * SAMPLE_COUNT,
        level * stride + (frame + 1) * SAMPLE_COUNT), value => (value - 128) / 128)));
}

// Floating point equivalents of SynthModulationCache.cpp's Q4 phase warps.
function warpPhase(phase, fold, duty, poly) {
  phase = wrapPhase(phase + Math.min(phase, 1 - phase) * fold * 5 / 256);
  phase = wrapPhase(phase + (phase < 0.5 ? 1 : -1) * duty / 512);
  const triangle = Math.min(phase, 1 - phase);
  return wrapPhase(phase + triangle * (0.5 - triangle) * poly / 32);
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
    this.glideRemaining = 0;
    this.glideStep = 0;
    this.note = -1;
    this.velocity = 1;
    this.active = false;
    this.age = 0;
    this.env = new Envelope();
    this.fxEnvs = [new Envelope(), new Envelope()];
  }

  configure(patch) {
    const values = patch.values;
    this.fxSettings = ["EffectEnvelope", "EffectEnvelope2"].map(prefix => ({
      target: values[`${prefix}Target`],
      depth: values[`${prefix}Amount`] - 127,
      enabled: ["AttackIndex", "HoldIndex", "DecayIndex", "SustainLevel", "ReleaseIndex"]
        .some(key => values[`${prefix}${key}`] !== 0)
    }));
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
    const glide = ENVELOPE_TIMES_SECONDS[patch.values.SynthPortamentoTimeIndex] ?? 0;
    this.glideRemaining = this.active && glide > 0 ? Math.round(glide * sampleRate) : 0;
    this.glideStep = this.glideRemaining ? (this.targetFrequency - this.frequency) / this.glideRemaining : 0;
    if (!this.glideRemaining) this.frequency = this.targetFrequency;
    if (!this.active || retrigger) {
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

    if (this.glideRemaining > 0) {
      this.frequency += this.glideStep;
      if (--this.glideRemaining === 0) this.frequency = this.targetFrequency;
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
    addTarget(values.SynthLfoTarget, processor.lfoSample() * (values.SynthLfoAmount - 127));
    for (let i = 0; i < 2; i++) {
      const { target, depth, enabled } = this.fxSettings[i];
      if (enabled) addTarget(target, target === TARGET_VIBRATO && depth < 0
        ? -depth * (1 - fxLevels[i]) : fxLevels[i] * depth);
    }

    pitch = clamp(pitch, -127, 127);
    vibrato = clamp(vibrato, -127, 127);
    foldWarp = clamp(foldWarp, -127, 127);
    dutyWarp = clamp(dutyWarp, -127, 127);
    polyWarp = clamp(polyWarp, -127, 127);
    wavetablePosition = clamp(wavetablePosition, -127, 127);

    const pitchSemitones = (pitch / 127) * 24;
    const frequency = this.frequency * 2 ** (pitchSemitones / 12)
      * (1 + vibrato * 127 * processor.vibratoSample() / 262144);
    this.phase = wrapPhase(this.phase + frequency / sampleRate);
    const phase = warpPhase(this.phase, foldWarp, dutyWarp, polyWarp);

    const position = clamp(values.SynthWavetablePosition + wavetablePosition, 0, 127);
    const sample = processor.readWavetable(phase, position, frequency);
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
    this.arpSamplesUntilNext = 0;
    this.lfoPhase = 0;
    this.lfoNoiseState = 0x6D2B79F5;
    this.lfoNoiseSegment = -1;
    this.lfoNoisePreviousSample = 0;
    this.lfoNoiseCurrentSample = 0;
    this.vibratoPhase = 0;
    this.vibratoNoiseState = 0xB5297A4D;
    this.vibratoNoiseSegment = -1;
    this.vibratoNoisePreviousSample = 0;
    this.vibratoNoiseCurrentSample = 0;
    this.currentLfoSample = 0;
    this.currentVibratoSample = 0;
    this.activeWavetable = null;
    this.voiceAge = 0;

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
    const previousMode = this.patch.values.PlaybackMode;
    this.patch = {
      ...this.defaultPatch(),
      ...patch,
      values: {
        ...this.defaultPatch().values,
        ...(patch?.values ?? {})
      }
    };
    const sampleBytes = patch?.wavetableSamples ? new Uint8Array(patch.wavetableSamples) : null;
    this.activeWavetable = wavetableFromBytes(sampleBytes);
    if (previousMode !== this.patch.values.PlaybackMode) this.allNotesOff();
    this.voices.forEach((voice) => voice.configure(this.patch));
  }

  noteOn(note, velocity) {
    const mode = this.patch.values.PlaybackMode;
    if (mode === 0) {
      return;
    }
    if (this.heldNotes.includes(note)) return;
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
    voice.age = ++this.voiceAge;
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
      if (this.voices[0].note !== note) return;
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
    this.arpCursor = 0;
    this.voices.forEach((voice) => { voice.active = false; voice.env.stage = "idle"; voice.env.level = 0; });
  }

  lfoSample() {
    return this.currentLfoSample;
  }

  vibratoSample() {
    return this.currentVibratoSample;
  }

  updateLfoNoiseSegment() {
    const segment = Math.floor(this.lfoPhase * LFO_NOISE_SEGMENTS);
    if (segment === this.lfoNoiseSegment) {
      return;
    }
    this.lfoNoiseSegment = segment;
    this.lfoNoisePreviousSample = this.lfoNoiseCurrentSample;
    this.lfoNoiseState = nextNoiseState(this.lfoNoiseState);
    this.lfoNoiseCurrentSample = noiseStateSample(this.lfoNoiseState);
  }

  lfoSmoothNoiseSample() {
    this.updateLfoNoiseSegment();
    const segmentPhase = (this.lfoPhase * LFO_NOISE_SEGMENTS) % 1;
    return blend(this.lfoNoisePreviousSample, this.lfoNoiseCurrentSample, segmentPhase);
  }

  updateVibratoNoiseSegment() {
    const segment = Math.floor(this.vibratoPhase * LFO_NOISE_SEGMENTS);
    if (segment === this.vibratoNoiseSegment) {
      return;
    }
    this.vibratoNoiseSegment = segment;
    this.vibratoNoisePreviousSample = this.vibratoNoiseCurrentSample;
    this.vibratoNoiseState = nextNoiseState(this.vibratoNoiseState);
    this.vibratoNoiseCurrentSample = noiseStateSample(this.vibratoNoiseState);
  }

  vibratoSmoothNoiseSample() {
    this.updateVibratoNoiseSegment();
    const segmentPhase = (this.vibratoPhase * LFO_NOISE_SEGMENTS) % 1;
    return blend(this.vibratoNoisePreviousSample, this.vibratoNoiseCurrentSample, segmentPhase);
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
      case 4:
        this.updateLfoNoiseSegment();
        this.currentLfoSample = this.lfoNoiseCurrentSample;
        break;
      case 5:
        this.currentLfoSample = this.lfoSmoothNoiseSample();
        break;
      case 0:
      default:
        this.currentLfoSample = sine(this.lfoPhase);
        break;
    }
    const rawVibratoSpeed = Math.round(values.SynthVibratoSpeed ?? 5);
    const vibratoSpeedSetting =
      rawVibratoSpeed < 0 || rawVibratoSpeed > VIBRATO_SPEED_NOISE ? 5 : rawVibratoSpeed;
    const vibratoSpeed = vibratoSpeedSetting === VIBRATO_SPEED_NOISE ? 12 : vibratoSpeedSetting + 1;
    this.vibratoPhase = wrapPhase(this.vibratoPhase + vibratoSpeed / sampleRate);
    this.currentVibratoSample =
      vibratoSpeedSetting === VIBRATO_SPEED_NOISE ? this.vibratoSmoothNoiseSample() : sine(this.vibratoPhase);
  }

  readWavetable(phase, position, frequency = 440) {
    if (!this.activeWavetable) return 0;
    const safeHarmonics = Math.min(sampleRate, DEVICE_SAMPLE_RATE) / (2 * frequency);
    let level = 0;
    while (level < this.activeWavetable.length - 1 && MIP_LIMITS[level] > safeHarmonics) level++;
    const table = this.activeWavetable[level];
    let framePosition = (position / 127) * (FRAME_COUNT - 1);
    // Firmware snaps the 16 UI frame positions to exact frames.
    const nearest = Math.round(framePosition);
    if (position === Math.round(nearest * 127 / (FRAME_COUNT - 1))) framePosition = nearest;
    const frameA = Math.floor(framePosition);
    const frameB = Math.min(FRAME_COUNT - 1, frameA + 1);
    const frameFrac = framePosition - frameA;
    const samplePosition = phase * SAMPLE_COUNT;
    const sampleA = Math.floor(samplePosition) % SAMPLE_COUNT;
    const sampleB = (sampleA + 1) % SAMPLE_COUNT;
    const sampleFrac = samplePosition - Math.floor(samplePosition);
    const tableA = table[frameA] ?? table[0];
    const tableB = table[frameB] ?? tableA;
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
    const gain = [0, 1, 1.5, 2.5][this.patch.values.SynthDrive] ?? 0;
    if (!gain) return sample;
    const x = clamp(sample * gain, -1, 1);
    return (3 * x - x * x * x) / 2;
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
      for (const voice of this.voices) {
        const rendered = voice.render(this);
        mix += rendered.sample;
        envelopeSum += rendered.envelope;
      }

      if (this.patch.values.PlaybackMode === MODE_POLY) {
        const count = clamp(envelopeSum, 0, MAX_VOICES);
        const whole = Math.floor(count);
        mix *= blend(ATTENUATION[whole], ATTENUATION[Math.min(8, whole + 1)], count - whole) / 64;
      }
      const sample = clamp(this.applyDrive(mix) * this.volume, -1, 1);
      left[index] = sample;
      right[index] = sample;
    }
    return true;
  }
}

registerProcessor("hexboard-synth-preview", SynthPreviewProcessor);
