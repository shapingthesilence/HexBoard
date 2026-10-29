import { verifyPreparedTuning } from "./verifyTuning.ts";
import { TuningAudition } from "./TuningAudition.ts";
import {describe,it,expect,vi} from 'vitest';
import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {analyzePitch,suggestLoops,verifyLoop,hzForMidi,midiForHz,centsBetween,retuneRecording} from './analysis.ts';
import {SampleAnalysis} from './SampleAnalysis.tsx';
import {preparePatch,crc32,type Recording} from './prepare.mjs';import {prepareCompactPatch,readCompactPatch} from './compact.mjs';import {readBank} from './bank.mjs';
const tone=(hz:number,rate=44100,seconds=1.2):Recording=>({rate,rootMidi:69,mode:0,channels:[Float32Array.from({length:Math.ceil(rate*seconds)},(_,i)=>.6*Math.sin(2*Math.PI*hz*i/rate))]});
describe('Shared sample tuning and loop analysis',()=>{
 for(const hz of [40.3,55.17,261.625565,440.1234,997.33,2012.7])it(`measures fractional ${hz} Hz without quantizing to a MIDI note`,()=>{const a=tone(hz);const p=analyzePitch(a,0,a.channels[0].length,4);expect(p.hz).not.toBeNull();expect(Math.abs(centsBetween(p.hz!,hz))).toBeLessThan(.35);expect(p.confidence).toBeGreaterThan(.9);});
 it('handles independent sample clocks and anti-phase stereo',()=>{for(const sr of [22050,32000,48000]){const a=tone(432.123,sr);a.channels.push(Float32Array.from(a.channels[0],v=>-v));const p=analyzePitch(a,0,a.channels[0].length,3);expect(Math.abs(centsBetween(p.hz!,432.123))).toBeLessThan(.35);}});
 it('does not invent a pitch for silence, short clips or noise',()=>{let seed=7;const a=tone(440);const noise=Float32Array.from(a.channels[0],()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32-.5;});for(const c of [new Float32Array(44100),noise,new Float32Array(16)])expect(analyzePitch({...a,channels:[c]},0,c.length,3).hz).toBeNull();});
 it('verifies HBS loops on demand without decoding unused attacks and tails',async()=>{
   const a={...tone(441,44100,.6),mode:3 as const,loopStart:4410,loopEnd:8820};a.rootMidi=midiForHz(441);
   const source={assets:[a],zones:[{asset:0,lowMidi:68,highMidi:70}]},bytes=(await preparePatch(source)).bytes;
   const eager=readBank(bytes),windows=readBank(bytes,{loopWindows:true});expect(Object.getOwnPropertyDescriptor(windows.assets[0],'channels')?.get).toBeTypeOf('function');
   expect(windows.assets[0].channels[0].length).toBe(eager.assets[0].loopEnd!-eager.assets[0].loopStart!);expect(windows.assets[0].channels[0][0]).toBe(eager.assets[0].channels[0][eager.assets[0].loopStart!]);
   expect(verifyPreparedTuning(source,windows)).toEqual(verifyPreparedTuning(source,eager));
 },20000);
 it('checks a valid bank larger than 32 MiB through bounded loop windows',async()=>{
   const a={...tone(441,44100,.5),mode:3 as const,loopStart:1000,loopEnd:2000};a.rootMidi=midiForHz(441);
   const source={assets:[a],zones:[{asset:0,lowMidi:68,highMidi:70}],storage:'streaming' as const},small=(await preparePatch(source)).bytes;
   const old=new DataView(small.buffer),pages=8193,base=128+48+16+48,meta=Math.ceil((base+pages*4+184)/4096)*4096,large=new Uint8Array(meta+pages*4096),v=new DataView(large.buffer);
   large.set(small.subarray(0,base));large.set(small.subarray(base+old.getUint32(40,true)*4,base+old.getUint32(40,true)*4+184),base+pages*4);large.set(small.subarray(old.getUint32(24,true)),meta);
   const payload=crc32(large.subarray(meta)),zero=crc32(new Uint8Array(4096)),oldPages=old.getUint32(40,true);
   for(let i=0;i<pages;i++)v.setUint32(base+i*4,i<oldPages?crc32(large.subarray(meta+i*4096,meta+(i+1)*4096)):zero,true);
   for(const [at,value] of [[20,large.length],[24,meta],[32,payload],[40,pages],[128,pages*2048],[176,meta],[180,pages*2048],[184,payload]])v.setUint32(at,value,true);
   v.setUint32(28,crc32(large.subarray(128,meta)),true);v.setUint32(36,0,true);v.setUint32(36,crc32(large.subarray(0,128)),true);
   expect(large.length).toBeGreaterThan(32*1024*1024);const window=readBank(large,{loopWindows:true});expect(window.assets[0].channels[0]).toHaveLength(1000);expect(verifyPreparedTuning(source,window).join(' ')).toContain('Measured');
 },20000);
 it('rejects high tones instead of inventing in-range subharmonics or decimation aliases',()=>{for(const hz of [3100,5000,10000,13000]){const a=tone(hz);expect(analyzePitch(a,0,a.channels[0].length,4).hz).toBeNull();}});
 it('shows pitch drift rather than silently correcting it',()=>{const sr=44100;let phase=0;const a=tone(440,sr,2);a.channels=[Float32Array.from(a.channels[0],(_,i)=>{phase+=2*Math.PI*(430+20*i/(sr*2))/sr;return .5*Math.sin(phase);})];const p=analyzePitch(a);expect(p.spread).toBeGreaterThan(30);expect(p.warnings.some(w=>w.includes('varies'))).toBe(true);expect(suggestLoops(a,0,a.channels[0].length,p)).toEqual([]);});
 it('ranks three loop styles and measures the rendered repeat, keeping stereo PCM intact',()=>{const a=tone(440.123,32000,1.5), original=a.channels[0].slice();a.channels.push(Float32Array.from(original,v=>v*.7));const p=analyzePitch(a,3200,42000,3),loops=suggestLoops(a,3200,42000,p);expect(loops.map(l=>l.style)).toEqual(['Natural','Compact','Smooth']);for(const l of loops){expect(l.start).toBeGreaterThanOrEqual(3200);expect(l.end).toBeLessThanOrEqual(42000);expect(l.analysis.hz).not.toBeNull();expect(Number.isFinite(l.changeCents)).toBe(true);}expect(a.channels[0]).toEqual(original);expect(loops[0].end-loops[0].start).toBeGreaterThan(loops[1].end-loops[1].start);});
 it('distinguishes multi-cycle loop repeat rate from fundamental pitch',()=>{const a=tone(441);const loop={...a,mode:1 as const,loopStart:2000,loopEnd:3000};const p=verifyLoop(loop);expect(Math.abs(centsBetween(p.hz!,441))).toBeLessThan(.35);expect(p.hz!).toBeGreaterThan(a.rate/(loop.loopEnd-loop.loopStart)*9);});
 it('preserves tuning metadata in both board formats',async()=>{const hz=432.123456,a=tone(hz,22050,.2);a.rootMidi=midiForHz(hz);const patch={assets:[a],zones:[{asset:0,lowMidi:59,highMidi:61}]};const advanced=readBank((await preparePatch(patch)).bytes),classic=readCompactPatch((await prepareCompactPatch(patch)).bytes);for(const p of [advanced,classic])expect(Math.abs(centsBetween(hzForMidi(p.assets[0].rootMidi),hz))).toBeLessThan(.001);},20000);
 it('retunes on export non-destructively and leaves imported correction alone until chosen',()=>{const a=tone(447);const p=analyzePitch(a,0,a.channels[0].length,2);expect(a.rootMidi).toBe(69);const b=retuneRecording(a,p.hz!,440);expect(b.channels).toBe(a.channels);expect(b.rate/a.rate).toBeCloseTo(440/447,4);expect(b.rootMidi).toBe(69);for(const hz of [432.123,440,10**3])expect(hzForMidi(midiForHz(hz))).toBeCloseTo(hz,9);});
 it('exposes precise shared authoring and safe audition tools',()=>{const html=renderToStaticMarkup(createElement(SampleAnalysis,{recording:tone(440),onChange:()=>{}}));for(const name of ['Root frequency (Hz)','Fine tune anchor (cents)','Analyze pitch','Verify rendered loop tuning','Original on opening analysis','Sample + reference','Alternate sample','Stop tuning audition'])expect(html).toContain(name);});
 it('checks converted playback pitch including root compensation on both models',async()=>{
   const a={...tone(441,22050,.5),mode:1 as const,loopStart:500,loopEnd:5500};a.rootMidi=midiForHz(441);
   const patch={assets:[a],zones:[{asset:0,lowMidi:68,highMidi:70}]};
   for(const converted of [readBank((await preparePatch(patch)).bytes),readCompactPatch((await prepareCompactPatch(patch)).bytes)]){
     const report=verifyPreparedTuning(patch,converted);expect(report.join(' ')).toContain('Measured');expect(report.join(' ')).not.toContain('Compare converted');
     const wrong={...converted,assets:converted.assets.map(asset=>({...asset,rootMidi:asset.rootMidi+.1}))};expect(verifyPreparedTuning(patch,wrong).join(' ')).toContain('Compare converted');
   }
 },20000);
 it('does not report protected octave copies above the analysis range as mistuning',async()=>{
   const a={...tone(439.123,44100,.7),name:"Test tone",mode:1 as const,loopStart:4410,loopEnd:22050};a.rootMidi=midiForHz(439.123);
   const patch={assets:[a],zones:[{asset:0,lowMidi:-.5,highMidi:127.5}]};const converted=readBank((await preparePatch(patch)).bytes);
   expect(converted.assets.length).toBeGreaterThan(3);const warnings=verifyPreparedTuning(patch,converted);expect(warnings.join(' ')).not.toContain('Compare converted');expect(warnings.join(' ')).toContain('could not be verified');expect(warnings.join(' ')).toContain('Uncertain pitch: Test tone');
 },20000);
 it('fades reference/sample auditions, supports live root changes and stops pending playback',async()=>{
   const sources:{stopped:boolean;playbackRate:{value:number;setTargetAtTime:ReturnType<typeof vi.fn>}}[]=[];
   const param=()=>({value:0,setValueAtTime:vi.fn(),linearRampToValueAtTime:vi.fn(),setTargetAtTime:vi.fn()});
   class Context {currentTime=0;destination={};resume=vi.fn(async()=>{});close=vi.fn(async()=>{});
     createGain(){return{gain:param(),connect:vi.fn(),disconnect:vi.fn()};}
     createDynamicsCompressor(){return{threshold:param(),knee:param(),ratio:param(),attack:param(),release:param(),connect:vi.fn(),disconnect:vi.fn()};}
     createBuffer(_c:number,_n:number,sr:number){return {sampleRate:sr,copyToChannel:vi.fn()};}
     createBufferSource(){const node={buffer:null,loop:false,loopStart:0,loopEnd:0,playbackRate:param(),connect:vi.fn(),disconnect:vi.fn(),start:vi.fn(),stopped:false,stop(){this.stopped=true;}};sources.push(node);return node;}
     createOscillator(){return {frequency:param(),type:'sine',connect:vi.fn(),disconnect:vi.fn(),start:vi.fn(),stop:vi.fn()};}
   }
   vi.stubGlobal('AudioContext',Context);vi.useFakeTimers();try{const audition=new TuningAudition(),a=tone(440);await audition.play(a,440,'together');expect(sources[0].playbackRate.value).toBe(1);audition.update({...a,rootMidi:70});expect(sources[0].playbackRate.setTargetAtTime).toHaveBeenCalled();audition.retarget(442);expect(sources[0].playbackRate.setTargetAtTime).toHaveBeenCalledTimes(2);audition.stop();expect(sources[0].stopped).toBe(true);
     const pending=audition.play(a,440,'alternate');audition.stop();await pending;expect(sources).toHaveLength(1);await audition.play(a,440,'sample');vi.advanceTimersByTime(8200);expect(sources[1].stopped).toBe(true);audition.close();
   }finally{vi.useRealTimers();vi.unstubAllGlobals();}
 });

});
