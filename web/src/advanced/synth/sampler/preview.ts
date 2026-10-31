import {motionSettings,motionActive,evaluateMotion,motionEnvelope,keyTime} from "./motion.mjs";
import {playbackLimits} from './playback.mjs';
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
    return { ...zone, ...edited, motion:undefined,resonance:undefined,fixedVelocity:undefined,fixedNote:undefined,asset: zone.asset, cutoff: 20000, pan: 0,
      attack: edited.attack ?? patch.settings?.attack ?? defaults.attack,
      decay: edited.decay ?? patch.settings?.decay ?? defaults.decay,
      sustain: edited.sustain ?? patch.settings?.sustain ?? defaults.sustain,
      release: Math.max(4, edited.release ?? patch.settings?.release ?? defaults.release) };
  }) };
}
// Bypass mapping while retaining the selected region's sound controls. Converted
// audition supplies its own fitted assets/settings, never original-only effects.
export function recordingAuditionPatch(patch:Patch,selected:number,zoneIndex=-1):Patch{
 const region=patch.zones?.[zoneIndex]??patch.zones?.find(z=>z.asset===selected),asset=patch.assets[region?.asset??selected];
 return asset?{...patch,assets:[asset],zones:[{...region,asset:0,lowMidi:-.5,highMidi:127.5,key:undefined,velocityLow:1,velocityHigh:127,choke:0,roundRobin:0}],performance:undefined}:patch;
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
  readerGain: GainNode;
  pan: StereoPannerNode;
  gain: GainNode;
  filter: BiquadFilterNode;
  pressure: GainNode;
  zone: Zone;
  asset: Recording;
  assetIndex: number;
  start: number;
  peak: number;
  release?: number;
  key: string;
  pedal: boolean;
  held: boolean;
  rate: number;
  note:number;strikeVelocity:number;zoneIndex:number;
}
export class PatchPreview {
  ctx?: AudioContext;
  private output?: GainNode;
  private bus?: GainNode;
  private room?: ConvolverNode;
  private roomGain?: GainNode;
  private roomBuffer?: AudioBuffer;
  private roomKey="";
  private roomWorker?:Worker;
  private roomRequest=0;
  private roomTimer?:ReturnType<typeof setTimeout>;
  private motionTimer?:ReturnType<typeof setTimeout>;
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
      this.output.gain.value = this.volume;
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
  private installRoom(impulse:Float32Array[]){
    if(!this.ctx||!this.bus||!this.limiter)return;
    const buffer=this.ctx.createBuffer(2,impulse[0].length,this.ctx.sampleRate);impulse.forEach((c,i)=>buffer.copyToChannel(new Float32Array(c),i));this.roomBuffer=buffer;
    const previous=this.room,oldGain=this.roomGain,room=this.ctx.createConvolver(),gain=this.ctx.createGain(),now=this.ctx.currentTime;
    room.normalize=false;room.buffer=buffer;gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(this.patch.settings?.space??0,now+.025);
    this.bus.connect(room).connect(gain).connect(this.limiter);this.room=room;this.roomGain=gain;
    if(previous&&oldGain){oldGain.gain.cancelScheduledValues(now);oldGain.gain.setTargetAtTime(0,now,.006);setTimeout(()=>{this.bus?.disconnect(previous);previous.disconnect();oldGain.disconnect();},60);}
  }
  private setRoom(amount:number){
    if(!this.ctx||!this.bus||!this.limiter)return;
    this.roomGain?.gain.setTargetAtTime(amount,this.ctx.currentTime,.012);
    const settings=this.patch.settings??{},key=JSON.stringify([settings.roomDecay??1600,settings.roomTone??.34090909,settings.roomWidth??1]);
    if(amount<=0||key===this.roomKey)return;this.roomKey=key;const id=++this.roomRequest;
    if(this.roomTimer)clearTimeout(this.roomTimer);
    this.roomTimer=setTimeout(()=>{
      this.roomTimer=undefined;if(!this.ctx)return;
      if(typeof Worker==='undefined'){this.installRoom(reverbImpulse(this.ctx.sampleRate,Math.max(4,(settings.roomDecay??1600)/1000*1.5),settings));return;}
      if(!this.roomWorker){this.roomWorker=new Worker(new URL('./reverb.worker.ts',import.meta.url),{type:'module'});this.roomWorker.onmessage=event=>{if(event.data.id===this.roomRequest&&this.ctx)this.installRoom(event.data.channels);};}
      this.roomWorker.postMessage({id,rate:this.ctx.sampleRate,settings});
    },80);
  }
  private readerTimer?: ReturnType<typeof setTimeout>;
  private expressionByKey = new Map<string,{pressure:number;bend:number}>();
  private volume=.6;
  setVolume(value:number){this.volume=Math.max(0,Math.min(1,value));if(this.output&&this.ctx)this.output.gain.setTargetAtTime(this.volume,this.ctx.currentTime,.01);}
  noteExpression(key:string,pressure:number,bend:number){this.expressionByKey.set(key,{pressure,bend});for(const v of this.voices.filter(v=>v.key===key)){v.source.playbackRate.setTargetAtTime(v.rate*2**((this.bend+bend)/12),this.ctx!.currentTime,.005);v.pressure.gain.setTargetAtTime(this.pressureLevel(pressure),this.ctx!.currentTime,.01);v.filter.frequency.setTargetAtTime(this.cutoff(v.zone,pressure),this.ctx!.currentTime,.01);}}
  stopNote(key:string){this.held.delete(key);for(const v of this.voices.filter(v=>v.key===key))this.stopVoice(v,.01);this.expressionByKey.delete(key);}
  setPatch(patch: Patch) {
    const before=playbackLimits(this.patch),after=playbackLimits(patch);
    if(before.voices!==after.voices||before.tails!==after.tails)this.clear();
    this.patch = patch;
    if(this.readerTimer)clearTimeout(this.readerTimer);
    if(this.voices.some(v=>patch.assets[v.assetIndex]!==v.asset))this.readerTimer=setTimeout(()=>{
      this.readerTimer=undefined;
      for(const v of [...this.voices]){
        if(v.release!==undefined||(!this.held.has(v.key)&&!v.pedal))continue;
        const a=patch.assets[v.assetIndex];
        if(!a||a===v.asset||![1,3].includes(a.mode??0))continue;
        const ctx=this.ctx!,now=ctx.currentTime,source=ctx.createBufferSource(),readerGain=ctx.createGain(),old=v.source,oldGain=v.readerGain,fade=crossfadeFrames(a),start=a.start??0;
        source.buffer=this.buffer(a);source.loop=true;source.loopStart=((a.loopStart??start)-start+fade)/source.buffer.sampleRate;source.loopEnd=((a.loopEnd??a.end??a.channels[0].length)-start+fade)/source.buffer.sampleRate;
        const held=this.held.get(v.key);const rate=(a.rate/source.buffer.sampleRate)*2**(((v.zone.fixed?0:(held?.note??a.rootMidi)-a.rootMidi)*(v.zone.keyTrack??1))/12);
        source.playbackRate.value=rate*2**((this.bend+(this.expressionByKey.get(v.key)?.bend??0))/12);source.connect(readerGain).connect(v.filter);readerGain.gain.setValueAtTime(0,now);readerGain.gain.linearRampToValueAtTime(1,now+.02);oldGain.gain.cancelScheduledValues(now);oldGain.gain.setValueAtTime(oldGain.gain.value,now);oldGain.gain.linearRampToValueAtTime(0,now+.02);
        v.source=source;v.readerGain=readerGain;v.asset=a;v.rate=rate;source.onended=()=>{source.disconnect();readerGain.disconnect();if(v.source===source){this.voices=this.voices.filter(x=>x!==v);v.filter.disconnect();v.gain.disconnect();v.pressure.disconnect();v.pan.disconnect();}};
        source.start(now,source.loopStart);try{old.stop(now+.025);}catch{}
      }
    },80);
    this.setRoom(patch.settings?.space ?? 0);
    for (const v of this.voices) {
      if(patch.zones?.[v.zoneIndex]?.asset===v.assetIndex)v.zone=patch.zones[v.zoneIndex];
      v.filter.frequency.setTargetAtTime(
        this.cutoff(v.zone,this.expressionByKey.get(v.key)?.pressure),
        this.ctx!.currentTime,
        0.01,
      );
      v.filter.Q.value = v.zone.resonance??patch.settings?.resonance ?? 0.7;
      v.pressure.gain.setTargetAtTime(
        this.pressureLevel(this.expressionByKey.get(v.key)?.pressure),
        this.ctx!.currentTime,
        0.01,
      );
    }
    this.updateMotion();
    if (!patch.performance?.values[S.enabled] && this.timer) this.clear();
  }
  private cutoff(z: Zone, pressure=this.pressure) {
    const p = this.patch.settings;
    return (
      Math.min(p?.cutoff ?? defaults.cutoff, z.cutoff ?? 20000) *
      (0.25 +
        0.75 *
          (1 -
            (p?.pressure ?? defaults.pressure) +
            pressure * (p?.pressure ?? defaults.pressure)))
    );
  }
  private pressureLevel(pressure=this.pressure) {
    const depth = this.patch.settings?.pressureGain ?? 0;
    return 1 - depth + pressure * depth;
  }
  expression(pressure = this.pressure, bend = this.bend) {
    this.pressure = pressure;
    this.bend = bend;
    for (const v of this.voices) {
      v.source.playbackRate.setTargetAtTime(
        v.rate * 2 ** ((bend+(this.expressionByKey.get(v.key)?.bend??0)) / 12),
        this.ctx!.currentTime,
        0.005,
      );
      v.pressure.gain.setTargetAtTime(
        this.pressureLevel(this.expressionByKey.get(v.key)?.pressure),
        this.ctx!.currentTime,
        0.01,
      );
      v.filter.frequency.setTargetAtTime(
        this.cutoff(v.zone,this.expressionByKey.get(v.key)?.pressure),
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
    const limits=playbackLimits(this.patch);
    if(this.voices.filter(v=>v.held).length>=limits.voices)return;
    if(this.voices.length>=limits.voices+limits.tails){
      const old=this.voices.find(v=>!v.held);if(!old)return;
      // Release-slot replacement is bounded; disconnect the replaced graph.
      try{old.source.stop();}catch{}old.source.disconnect();old.readerGain.disconnect();old.filter.disconnect();old.gain.disconnect();old.pressure.disconnect();old.pan.disconnect();
      this.voices=this.voices.filter(v=>v!==old);
    }
    const source = ctx.createBufferSource(),
      filter = ctx.createBiquadFilter(),
      gain = ctx.createGain(),
      pressure = ctx.createGain(),
      readerGain = ctx.createGain(),
      pan = ctx.createStereoPanner();
    source.buffer = this.buffer(a);
    filter.type = "lowpass";
    filter.frequency.value = this.cutoff(choice,this.expressionByKey.get(key)?.pressure);
    filter.Q.value = choice.resonance??p.resonance ?? 0.7;
    pan.pan.value = choice.pan ?? 0;
    pressure.gain.value = this.pressureLevel(this.expressionByKey.get(key)?.pressure);
    source
      .connect(readerGain)
      .connect(filter)
      .connect(gain)
      .connect(pressure)
      .connect(pan)
      .connect(this.bus!);
    const m=motionSettings({...this.patch.motion,...choice.motion});
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
            ? ((choice.fixedVelocity??velocity) / 127) ** 2
            : curve >= 3
              ? ((choice.fixedVelocity??velocity) / 127) ** ((curve - 3) * 0.02)
              : (choice.fixedVelocity??velocity) / 127,
      peak = vel * (choice.gain ?? 1) * 0.5,
      delay = (choice.delay ?? 0) / 1000,
      attack = (choice.attack ?? p.attack ?? 5) / 1000,
      hold = keyTime(choice.hold ?? 0,m.volHoldKey,choice.fixedNote??note) / 1000,
      decay = keyTime(choice.decay ?? p.decay ?? 150,m.volDecayKey,choice.fixedNote??note) / 1000,
      sustain = choice.sustain ?? p.sustain ?? 1;
    source.playbackRate.value = rate*2**((this.expressionByKey.get(key)?.bend??0)/12);
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
      readerGain,
      pan,
      gain,
      filter,
      pressure,
      zone: choice,
      asset: a,
      assetIndex: choice.asset,
      start: now,
      peak,
      note:choice.fixedNote??note,strikeVelocity:(choice.fixedVelocity??velocity)/127,zoneIndex:this.patch.zones?.indexOf(choice)??-1,
      key,
      pedal: false,
      held: true,
      rate: rate / 2 ** (this.bend / 12),
    };
    this.voices.push(voice);
    source.onended = () => {
      source.disconnect();readerGain.disconnect();
      if(voice.source!==source)return;
      this.voices = this.voices.filter((v) => v !== voice);
      filter.disconnect();
      gain.disconnect();
      pressure.disconnect();
      pan.disconnect();
    };
    source.start();this.updateMotion();
  }
  private updateMotion(){
    if(this.motionTimer){clearTimeout(this.motionTimer);this.motionTimer=undefined;}
    if(!this.ctx)return;const now=this.ctx.currentTime;let active=false;
    for(const v of this.voices){const m=motionSettings({...this.patch.motion,...v.zone.motion});if(motionActive(m))active=true;const time=now-v.start,pressure=this.expressionByKey.get(v.key)?.pressure??this.pressure,released=v.release===undefined?-1:v.release-v.start,value=evaluateMotion(m,time,v.note,pressure,v.strikeVelocity,released,released<0?0:motionEnvelope(m,released,v.note));
      v.source.playbackRate.setTargetAtTime(v.rate*2**((this.bend+(this.expressionByKey.get(v.key)?.bend??0)+value.pitch/100)/12),now,.004);
      v.filter.frequency.setTargetAtTime(Math.max(40,Math.min(19000,this.cutoff(v.zone,pressure)*2**(value.filter/1200))),now,.004);
      v.pressure.gain.setTargetAtTime(this.pressureLevel(pressure)*value.gain,now,.004);
    }
    if(active)this.motionTimer=setTimeout(()=>this.updateMotion(),8);
  }
  private stopVoice(v: Voice, seconds: number) {
    if (v.release !== undefined) return;
    v.held = false;
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
  off(key: string, velocity = 64, pedalRelease = false) {
    this.held.delete(key);
    for (const v of this.voices.filter(v=>v.key===key)) {
      v.held=false;
      if(v.asset.mode===2)continue;
      if (this.sustain) {
        v.pedal = true;
        continue;
      }
      if (v.asset.mode === 3) v.source.loop = false;
      this.stopVoice(
        v,
        releaseSeconds(this.patch.settings ?? {}, v.zone, velocity, pedalRelease),
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
    this.roomKey="";++this.roomRequest;if(this.roomTimer){clearTimeout(this.roomTimer);this.roomTimer=undefined;}
    if(this.motionTimer){clearTimeout(this.motionTimer);this.motionTimer=undefined;}
    if(this.readerTimer)clearTimeout(this.readerTimer);
    this.expressionByKey.clear();
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
    this.roomWorker?.terminate();this.roomWorker=undefined;++this.roomRequest;
    if(this.roomTimer){clearTimeout(this.roomTimer);this.roomTimer=undefined;}
    this.clear();
    void this.ctx?.close();
  }
}
