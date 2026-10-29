import type { Patch, Recording, Zone, Settings } from "./prepare.mjs";
import { defaults, trimRecording, crossfadeRecording, crossfadeFrames } from "./encode.mjs";
import { reverbImpulse } from "./reverb.mjs";
import { S } from "../performanceSchema.ts";
// Reuse fitted audio while editing envelopes/gain. Sample edits and changes to
// the recording map must finish a new conversion before converted audition.
export function editedCompactAudition(patch: Patch, source: Patch, converted: Patch): Patch | undefined {
  if (!patch.zones || !source.zones || !converted.zones || patch.assets !== source.assets
      || patch.zones.length !== source.zones.length || patch.zones.length !== converted.zones.length
      || patch.zones.some((zone, i) => zone.asset !== source.zones![i].asset || zone.fixed || zone.key !== undefined || zone.choke || zone.roundRobin)) return;
  return { ...converted, zones: converted.zones?.map((zone, i) => {
    const edited = patch.zones![i];
    return { ...zone, ...edited, asset: zone.asset, cutoff: 20000, pan: 0,
      attack: edited.attack ?? patch.settings?.attack ?? defaults.attack,
      decay: edited.decay ?? patch.settings?.decay ?? defaults.decay,
      sustain: edited.sustain ?? patch.settings?.sustain ?? defaults.sustain,
      release: Math.max(4, edited.release ?? patch.settings?.release ?? defaults.release) };
  }) };
}
export function releaseSeconds(
  settings: Settings,
  zone: Zone,
  velocity: number,
  pedal = false,
) {
  const slow = (zone.release ?? settings.release ?? defaults.release) / 1000;
  if (pedal)
    return Math.min(
      slow,
      (settings.pedalRelease ?? defaults.pedalRelease) / 1000,
    );
  const depth =
    (settings.releaseResponse ?? defaults.releaseResponse) *
    Math.pow(
      Math.max(0, Math.min(127, velocity)) / 127,
      settings.releaseCurve ?? defaults.releaseCurve,
    );
  return (
    slow *
    Math.pow(
      Math.max(
        0.000001,
        Math.min(slow, (settings.fastRelease ?? defaults.fastRelease) / 1000),
      ) / Math.max(0.000001, slow),
      depth,
    )
  );
}
interface Voice {
  source: AudioBufferSourceNode;
  gain: GainNode;
  filter: BiquadFilterNode;
  pressure: GainNode;
  zone: Zone;
  asset: Recording;
  start: number;
  peak: number;
  release?: number;
  key: string;
  pedal: boolean;
  rate: number;
}
export class PatchPreview {
  ctx?: AudioContext;
  private output?: GainNode;
  private bus?: GainNode;
  private room?: ConvolverNode;
  private roomGain?: GainNode;
  private roomBuffer?: AudioBuffer;
  private limiter?: DynamicsCompressorNode;
  private cache = new WeakMap<Recording, AudioBuffer>();
  private voices: Voice[] = [];
  private patch: Patch = { assets: [] };
  private held = new Map<
    string,
    { note: number; velocity: number; key?: number }
  >();
  private latched = new Map<
    string,
    { note: number; velocity: number; key?: number }
  >();
  private tied: string[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private gateTimers = new Set<ReturnType<typeof setTimeout>>();
  private step = 0;
  private sequence = 0;
  private rr = 0;
  private pressure = 1;
  private bend = 0;
  private sustain = false;
  async ready() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.output = this.ctx.createGain();
      this.output.gain.value = 0.6;
      this.limiter = this.ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -2;
      this.limiter.knee.value = 0;
      this.limiter.ratio.value = 20;
      this.limiter.attack.value = 0.001;
      this.limiter.release.value = 0.25;
      this.limiter.connect(this.output).connect(this.ctx.destination);
      this.bus = this.ctx.createGain();
      this.bus.connect(this.limiter);
    }
    this.setRoom(this.patch.settings?.space ?? 0);
    await this.ctx.resume();
  }
  private setRoom(amount: number) {
    if (!this.ctx || !this.bus || !this.limiter) return;
    if (amount > 0 && !this.room) {
      if (!this.roomBuffer) {
        const impulse = reverbImpulse(this.ctx.sampleRate);
        this.roomBuffer = this.ctx.createBuffer(
          2,
          impulse[0].length,
          this.ctx.sampleRate,
        );
        impulse.forEach((c, i) =>
          this.roomBuffer!.copyToChannel(new Float32Array(c), i),
        );
      }
      this.room = this.ctx.createConvolver();
      this.room.normalize = false;
      this.room.buffer = this.roomBuffer;
      this.roomGain = this.ctx.createGain();
      this.roomGain.gain.value = 0;
      this.bus.connect(this.room).connect(this.roomGain).connect(this.limiter);
    }
    this.roomGain?.gain.setTargetAtTime(amount, this.ctx.currentTime, 0.012);
  }
  setPatch(patch: Patch) {
    this.patch = patch;
    this.setRoom(patch.settings?.space ?? 0);
    for (const v of this.voices) {
      v.filter.frequency.setTargetAtTime(
        this.cutoff(v.zone),
        this.ctx!.currentTime,
        0.01,
      );
      v.filter.Q.value = patch.settings?.resonance ?? 0.7;
      v.pressure.gain.setTargetAtTime(
        this.pressureLevel(),
        this.ctx!.currentTime,
        0.01,
      );
    }
    if (!patch.performance?.values[S.enabled] && this.timer) this.clear();
  }
  private cutoff(z: Zone) {
    const p = this.patch.settings;
    return (
      Math.min(p?.cutoff ?? defaults.cutoff, z.cutoff ?? 20000) *
      (0.25 +
        0.75 *
          (1 -
            (p?.pressure ?? defaults.pressure) +
            this.pressure * (p?.pressure ?? defaults.pressure)))
    );
  }
  private pressureLevel() {
    const depth = this.patch.settings?.pressureGain ?? 0;
    return 1 - depth + this.pressure * depth;
  }
  expression(pressure = this.pressure, bend = this.bend) {
    this.pressure = pressure;
    this.bend = bend;
    for (const v of this.voices) {
      v.source.playbackRate.setTargetAtTime(
        v.rate * 2 ** (bend / 12),
        this.ctx!.currentTime,
        0.005,
      );
      v.pressure.gain.setTargetAtTime(
        this.pressureLevel(),
        this.ctx!.currentTime,
        0.01,
      );
      v.filter.frequency.setTargetAtTime(
        this.cutoff(v.zone),
        this.ctx!.currentTime,
        0.01,
      );
    }
  }
  private buffer(asset: Recording) {
    let buffer = this.cache.get(asset);
    if (buffer) return buffer;
    const a = crossfadeRecording(trimRecording(asset)),
      sampleRate = Math.max(8000, Math.min(96000, a.rate));
    buffer = this.ctx!.createBuffer(
      a.channels.length,
      a.channels[0].length,
      sampleRate,
    );
    a.channels.forEach((c, i) => buffer!.copyToChannel(new Float32Array(c), i));
    this.cache.set(asset, buffer);
    return buffer;
  }
  async on(key: string, note: number, velocity = 100, physicalKey?: number) {
    if (!this.held.size) this.latched.clear();
    const held = { note, velocity, key: physicalKey };
    this.held.set(key, held);
    this.latched.set(key, held);
    await this.ready();
    if (this.held.get(key) !== held) return;
    if (this.patch.performance?.values[S.enabled]) {
      if (!this.timer) {
        this.step = 0;
        this.sequence = 0;
        this.tick();
      }
      return;
    }
    this.play(key, note, velocity, physicalKey);
  }
  private play(
    key: string,
    note: number,
    velocity: number,
    physicalKey?: number,
  ) {
    const zones: Zone[] =
        this.patch.zones ??
        this.patch.assets.map((_, asset) => ({
          asset,
          lowMidi: -0.5,
          highMidi: 127.5,
        })),
      choices = zones.filter(
        (z) =>
          this.patch.assets[z.asset] &&
          (z.key === undefined || z.key === 65535 || z.key === physicalKey) &&
          (z.fixed ||
            (note >= (z.lowMidi ?? -0.5) && note < (z.highMidi ?? 127.5))) &&
          velocity >= (z.velocityLow ?? 1) &&
          velocity <= (z.velocityHigh ?? 127),
      );
    if (!choices.length) return;
    const order = [...new Set(choices.map((z) => z.roundRobin ?? 0))].sort(
        (a, b) => a - b,
      ),
      choice = choices.find(
        (z) => (z.roundRobin ?? 0) === order[this.rr++ % order.length],
      )!,
      a = this.patch.assets[choice.asset],
      ctx = this.ctx!,
      p = this.patch.settings ?? {},
      now = ctx.currentTime;
    if (choice.choke)
      for (const v of this.voices.filter((v) => v.zone.choke === choice.choke))
        this.stopVoice(v, 0.008);
    if (this.voices.length >= 20) this.stopVoice(this.voices[0], 0.005);
    const source = ctx.createBufferSource(),
      filter = ctx.createBiquadFilter(),
      gain = ctx.createGain(),
      pressure = ctx.createGain(),
      pan = ctx.createStereoPanner();
    source.buffer = this.buffer(a);
    filter.type = "lowpass";
    filter.frequency.value = this.cutoff(choice);
    filter.Q.value = p.resonance ?? 0.7;
    pan.pan.value = choice.pan ?? 0;
    pressure.gain.value = this.pressureLevel();
    source
      .connect(filter)
      .connect(gain)
      .connect(pressure)
      .connect(pan)
      .connect(this.bus!);
    const start = a.start ?? 0,
      fade = crossfadeFrames(a),
      rate =
        (a.rate / source.buffer.sampleRate) *
        2 **
          (((choice.fixed ? 0 : note - a.rootMidi) * (choice.keyTrack ?? 1) +
            this.bend) /
            12),
      curve = choice.velocityCurve ?? 0,
      vel =
        curve === 2
          ? 1
          : curve === 1
            ? (velocity / 127) ** 2
            : curve >= 3
              ? (velocity / 127) ** ((curve - 3) * 0.02)
              : velocity / 127,
      peak = vel * (choice.gain ?? 1) * 0.5,
      delay = (choice.delay ?? 0) / 1000,
      attack = (choice.attack ?? p.attack ?? 5) / 1000,
      hold = (choice.hold ?? 0) / 1000,
      decay = (choice.decay ?? p.decay ?? 150) / 1000,
      sustain = choice.sustain ?? p.sustain ?? 1;
    source.playbackRate.value = rate;
    if (a.mode === 1 || a.mode === 3) {
      source.loop = true;
      source.loopStart =
        ((a.loopStart ?? start) - start + fade) / source.buffer.sampleRate;
      source.loopEnd =
        ((a.loopEnd ?? a.end ?? a.channels[0].length) - start + fade) /
        source.buffer.sampleRate;
    }
    gain.gain.setValueAtTime(0, now);
    gain.gain.setValueAtTime(0, now + delay);
    gain.gain.linearRampToValueAtTime(
      peak,
      now + delay + Math.max(0.0001, attack),
    );
    gain.gain.setValueAtTime(peak, now + delay + attack + hold);
    gain.gain.linearRampToValueAtTime(
      peak * sustain,
      now + delay + attack + hold + Math.max(0.0001, decay),
    );
    const voice: Voice = {
      source,
      gain,
      filter,
      pressure,
      zone: choice,
      asset: a,
      start: now,
      peak,
      key,
      pedal: false,
      rate: rate / 2 ** (this.bend / 12),
    };
    this.voices.push(voice);
    source.onended = () => {
      this.voices = this.voices.filter((v) => v !== voice);
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
      pressure.disconnect();
      pan.disconnect();
    };
    source.start();
  }
  private stopVoice(v: Voice, seconds: number) {
    if (v.release !== undefined) return;
    v.release = this.ctx!.currentTime;
    const p = this.patch.settings ?? {},
      elapsed = v.release - v.start,
      delay = (v.zone.delay ?? 0) / 1000,
      attack = (v.zone.attack ?? p.attack ?? 5) / 1000,
      hold = (v.zone.hold ?? 0) / 1000,
      decay = (v.zone.decay ?? p.decay ?? 150) / 1000,
      sustain = v.zone.sustain ?? p.sustain ?? 1,
      t = elapsed - delay,
      level =
        t < 0
          ? 0
          : t < attack
            ? t / Math.max(0.0001, attack)
            : t < attack + hold
              ? 1
              : t < attack + hold + decay
                ? 1 +
                  ((sustain - 1) * (t - attack - hold)) /
                    Math.max(0.0001, decay)
                : sustain;
    const now = v.release;
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setValueAtTime(v.peak * level, now);
    v.gain.gain.linearRampToValueAtTime(0, now + Math.max(0.001, seconds));
    try {
      v.source.stop(now + Math.max(0.001, seconds) + 0.005);
    } catch {
      /* Already ended. */
    }
  }
  off(key: string, velocity = 64) {
    this.held.delete(key);
    for (const v of this.voices.filter(
      (v) => v.key === key && v.asset.mode !== 2,
    )) {
      if (this.sustain) {
        v.pedal = true;
        continue;
      }
      if (v.asset.mode === 3) v.source.loop = false;
      this.stopVoice(
        v,
        releaseSeconds(this.patch.settings ?? {}, v.zone, velocity),
      );
    }
    if (!this.held.size && !this.patch.performance?.values[S.latch])
      this.stopArp();
  }
  pedal(down: boolean) {
    this.sustain = down;
    if (!down)
      for (const v of this.voices.filter((v) => v.pedal)) {
        if (v.asset.mode === 3) v.source.loop = false;
        this.stopVoice(
          v,
          releaseSeconds(this.patch.settings ?? {}, v.zone, 0, true),
        );
      }
  }
  private tick() {
    const p = this.patch.performance;
    if (
      !p?.values[S.enabled] ||
      !(p.values[S.latch] ? this.latched : this.held).size
    ) {
      this.stopArp();
      return;
    }
    const v = p.values,
      step = p.steps[this.step % v[S.length]],
      notes = [...(p.values[S.latch] ? this.latched : this.held).values()],
      period =
        (60 / (v[S.bpm10] / 10) / 2 ** v[S.division]) *
        (v[S.timing] === 1 ? 1.5 : v[S.timing] === 2 ? 2 / 3 : 1),
      swing = this.step % 2 ? -v[S.swing] / 100 : v[S.swing] / 100;
    let pool = Array.from({ length: v[S.range] }, (_, octave) =>
      notes.map((n) => ({ ...n, note: n.note + 12 * octave })),
    ).flat();
    if (v[S.mode] !== 3) pool.sort((a, b) => a.note - b.note);
    if (v[S.mode] === 1) pool.reverse();
    const at =
        v[S.mode] === 4
          ? Math.floor(Math.random() * pool.length)
          : v[S.mode] === 2 && pool.length > 1
            ? this.sequence % (pool.length * 2 - 2) < pool.length
              ? this.sequence % (pool.length * 2 - 2)
              : pool.length * 2 - 2 - (this.sequence % (pool.length * 2 - 2))
            : this.sequence % pool.length,
      chosen = v[S.mode] === 5 ? pool : [pool[at]];
    const carried = this.tied.splice(0);
    if (carried.length) {
      if (step.on && step.tie) this.tied = carried;
      else {
        const release = setTimeout(
          () => {
            this.gateTimers.delete(release);
            for (const key of carried) this.off(key, 64);
          },
          step.on ? (period * 1000 * v[S.gate]) / 100 : 0,
        );
        this.gateTimers.add(release);
      }
    }
    if (!carried.length && step.on && Math.random() * 100 < step.probability)
      for (let ratchet = 0; ratchet < step.ratchets; ratchet++) {
        const timer = setTimeout(
          () => {
            this.gateTimers.delete(timer);
            for (const [i, n] of chosen.entries()) {
              const key = `arp-${this.sequence}-${i}-${ratchet}`,
                velocity = Math.max(
                  1,
                  Math.min(
                    127,
                    Math.round(
                      ((v[S.velocityMode] ? v[S.velocity] : n.velocity) *
                        step.velocity) /
                        100,
                    ),
                  ),
                );
              this.play(key, n.note, velocity, n.key);
              if (step.tie) this.tied.push(key);
              else {
                const off = setTimeout(
                  () => {
                    this.gateTimers.delete(off);
                    this.off(key, 64);
                  },
                  (period * 1000 * v[S.gate]) / 100 / step.ratchets,
                );
                this.gateTimers.add(off);
              }
            }
          },
          (ratchet * period * 1000) / step.ratchets,
        );
        this.gateTimers.add(timer);
      }
    this.sequence++;
    this.step++;
    this.timer = setTimeout(() => this.tick(), period * 1000 * (1 + swing));
  }
  private stopArp() {
    this.tied = [];
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    for (const t of this.gateTimers) clearTimeout(t);
    this.gateTimers.clear();
    for (const v of this.voices.filter((v) => v.key.startsWith("arp-")))
      this.stopVoice(v, 0.03);
  }
  clear() {
    this.held.clear();
    this.latched.clear();
    this.stopArp();
    for (const v of this.voices) this.stopVoice(v, 0.02);
    this.sustain = false;
    if (this.room) {
      this.bus?.disconnect(this.room);
      this.room.disconnect();
      this.roomGain?.disconnect();
      this.room = undefined;
      this.roomGain = undefined;
    }
  }
  close() {
    this.clear();
    void this.ctx?.close();
  }
}
