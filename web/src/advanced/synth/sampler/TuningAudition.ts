import type { Recording } from './prepare.mjs';
import { crossfadeRecording, trimRecording } from './encode.mjs';
import { hzForMidi } from './analysis.ts';
export class TuningAudition {
 private ctx?:AudioContext;private nodes:AudioNode[]=[];private sources:(AudioBufferSourceNode|OscillatorNode)[]=[];private timer?:ReturnType<typeof setTimeout>;private epoch=0;
 private reference?:OscillatorNode;private sample?:AudioBufferSourceNode;private asset?:Recording;private target=440;
 stop(){++this.epoch;if(this.timer)clearTimeout(this.timer);for(const source of this.sources)try{source.stop();}catch{}for(const n of this.nodes)n.disconnect();this.nodes=[];this.sources=[];this.sample=undefined;this.reference=undefined;}
 async play(a:Recording,hz:number,mode:'sample'|'together'|'alternate'|'reference',loopOnly=false){
  this.stop();if(!Number.isFinite(hz)||hz<20||hz>16000)throw Error('Audition target must be between 20 and 16000 Hz.');
  const request=this.epoch;this.ctx??=new AudioContext();await this.ctx.resume();if(request!==this.epoch)return;
  const ctx=this.ctx,now=ctx.currentTime, rendered=crossfadeRecording(trimRecording(a)), sr=Math.max(8000,Math.min(96000,rendered.rate));
  const limiter=ctx.createDynamicsCompressor();limiter.threshold.value=-8;limiter.knee.value=0;limiter.ratio.value=20;limiter.attack.value=.002;limiter.release.value=.15;limiter.connect(ctx.destination);this.nodes.push(limiter);
  const sampleGain=ctx.createGain(),refGain=ctx.createGain();sampleGain.connect(limiter);refGain.connect(limiter);this.nodes.push(sampleGain,refGain);
  let sum=0,count=0;for(const c of rendered.channels){const step=Math.max(1,Math.floor(c.length/8192));for(let i=0;i<c.length;i+=step){sum+=c[i]**2;count++;}}
  const level=Math.min(2,.07/Math.sqrt(sum/Math.max(count,1)+1e-10));sampleGain.gain.value=0;refGain.gain.value=0;
  const envelope=(gain:GainNode,value:number,begin:number,end:number)=>{gain.gain.setValueAtTime(0,begin);gain.gain.linearRampToValueAtTime(value,begin+.015);gain.gain.setValueAtTime(value,end-.015);gain.gain.linearRampToValueAtTime(0,end);};
  if(mode==='alternate'){for(let i=0;i<4;i++){envelope(sampleGain,level,now+i*2,now+i*2+.9);envelope(refGain,.1,now+i*2+1,now+i*2+1.9);}}
  else{if(mode!=='reference')envelope(sampleGain,level,now,now+8);if(mode!=='sample')envelope(refGain,.1,now,now+8);}
  const buffer=ctx.createBuffer(rendered.channels.length,rendered.channels[0].length,sr);rendered.channels.forEach((c,i)=>buffer.copyToChannel(new Float32Array(c),i));
  const sample=ctx.createBufferSource();sample.buffer=buffer;sample.loop=[1,3].includes(a.mode??0);sample.loopStart=(rendered.loopStart??0)/sr;sample.loopEnd=(rendered.loopEnd??buffer.length)/sr;sample.playbackRate.value=hz/hzForMidi(a.rootMidi)*a.rate/sr;sample.connect(sampleGain);sample.start(now,loopOnly&&sample.loop?sample.loopStart:0);
  const reference=ctx.createOscillator();reference.type='sine';reference.frequency.value=hz;reference.connect(refGain);reference.start(now);this.nodes.push(sample,reference);this.sources.push(sample,reference);this.reference=reference;this.sample=sample;this.asset=a;this.target=hz;
  this.timer=setTimeout(()=>{if(request===this.epoch)this.stop();},8100);
 }
 retarget(hz:number){if(!Number.isFinite(hz)||hz<20||hz>16000)return;this.target=hz;if(this.ctx)this.reference?.frequency.setTargetAtTime(hz,this.ctx.currentTime,.012);if(this.asset)this.update(this.asset);}
 update(a:Recording){if(this.sample&&this.ctx&&this.asset?.channels[0]===a.channels[0]){this.asset=a;this.sample.playbackRate.setTargetAtTime(this.target/hzForMidi(a.rootMidi)*a.rate/this.sample.buffer!.sampleRate,this.ctx.currentTime,.012);}}
 close(){this.stop();void this.ctx?.close();this.ctx=undefined;}
}
