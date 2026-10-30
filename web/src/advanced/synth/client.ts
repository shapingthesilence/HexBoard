import {storedPreset} from './presetLibrary.ts';
import {SynthRequestCancelledError} from "./requestError.ts";
import {defaultMono,validateMono,type MonoConfig} from './mono.ts';
import {dspUsage} from "./dspBudget.ts";
import {modulationUsage} from "./modulationBudget.ts";
import {performanceWords,performanceFromWords,type PerformanceConfig,type PerformanceState} from './performanceSchema.ts';
import {prepareEstimate,engineNames} from "./loadTiming.ts";
import {attachVoiceBudget,validVoiceBudget,type VoiceBudgetProfile,type VoiceBudgetState} from "./voiceBudget.ts";
import {advancedWords,advancedFromWords,validateAdvanced,initialAdvanced,advancedWordCount,type AdvancedPatch,type AdvancedEngine} from './advancedSchema.ts';
import {classicFromUnknown,initialClassic,type ClassicPreset} from './classicSchema.ts';
import type {SynthProgress} from './progress.ts';
import type { MidiTransport } from "../../midi/types.ts";
import { decodePresetSyncFrame, encodeDefaultPresetSyncFrame, encodeU14, encodeU21, decodeU14, decodeU21 } from "../../protocol/index.ts";
import { physicalPresetFromUnknown, defaultSample, defaultSampleLoop, validateSample, type SampleLoop, type SampleExciter, defaultModulation, validateModulation, type ModulationSources, defaultFx, validateFx, type FxRack, type PhysicalPreset, type PhysicalVelocityEngine, encodeLogPitchHz } from "./schema.ts";

export interface PresetCatalogState {phase:number;action:number;slot:number;medium:0|1|2;progress:number;mask:number;elapsedMs:number;maxSliceUs:number;engine:number;folder:number;capacity:number;folderCapacity:number;heapMin:number}
export interface DevicePresetFolder {index:number;name:string;mask:number}
export interface DevicePresetLabel {engine:number;favorite:boolean;name:string;folder:string}
export interface SamplerInstrument {id:number;name:string;bytes:number}
export function decodeSamplerLibrary(p:number[],first:number):SamplerInstrument[]{
 if(first<0||first>1052||first%4||p.length!==292||p[0]!==17||decodeU14(p.slice(1,3))!==first||p[3]!==4)throw Error('Invalid sampler library page.');
 const raw=Uint8Array.from({length:144},(_,i)=>{if(p[4+i*2]>1||p[5+i*2]>127)throw Error('Invalid sampler directory byte.');return p[4+i*2]*128+p[5+i*2];});const v=new DataView(raw.buffer),entries:SamplerInstrument[]=[];
 for(let i=0;i<4;i++){const bytes=v.getUint32(i*36+32,true),nameBytes=raw.slice(i*36,i*36+32),end=nameBytes.indexOf(0),text=nameBytes.slice(0,end<0?32:end);if(end>=0&&nameBytes.slice(end).some(Boolean)||text.some(c=>c<32||c>126)||bytes&&(!text.length||bytes%512||bytes<512||bytes>0x40000000)||!bytes&&text.length)throw Error('Invalid sampler instrument entry.');if(bytes)entries.push({id:first>=1024?first-1024+i:first+i+2,name:new TextDecoder().decode(text),bytes});}
 return entries;
}
export interface SamplerLoadingState {phase:0|1|2|3;voices:number;ready:number;total:number;loadedBytes:number;totalBytes:number;streaming?:boolean}
export function decodeSamplerLoading(p:number[]):SamplerLoadingState {
  if(p.length!==18||p[0]!==17||p[1]>3||p[17]>1)throw Error('Invalid sampler loading response.');
  const state={phase:p[1] as 0|1|2|3,voices:p[2],ready:decodeU14(p.slice(3,5)),total:decodeU14(p.slice(5,7)),loadedBytes:p.slice(7,12).reduce((a,b)=>a*128+b,0),totalBytes:p.slice(12,17).reduce((a,b)=>a*128+b,0)};
  if(state.total>128||state.ready>state.total||state.loadedBytes>state.totalBytes||state.totalBytes>0x40000000||state.voices>16||state.phase===0&&(state.voices||state.ready||state.total||state.loadedBytes||state.totalBytes)||(state.phase===1||state.phase===3)&&(!state.total||!state.totalBytes||state.voices!==4)||state.phase===2&&(!state.total||state.ready!==state.total||state.loadedBytes!==state.totalBytes||state.voices!==16))throw Error('Invalid sampler loading progress.');
  return {...state,streaming:!!p[17]};
}
export interface PhysicalState { state: "stopped" | "playing" | "loading"; instrument: number; bend: number; preset: PhysicalPreset }
export function decodePhysicalState(payload: number[]): PhysicalState {
  if (payload.length !== 403 || payload[0] !== 17 || payload[1] > 2 || payload[2] > 6)
    throw Error("Unsupported physical synth response. Update Advanced main firmware for preset velocity engines.");
  const bend = (decodeU21(payload.slice(3, 6)) - 131072) / 65536;
  if (bend < -2 || bend > 2) throw Error("Invalid pitch bend state.");
  const parameters = Array.from({ length: 33 }, (_, i) => decodeU21(payload.slice(6 + i * 3, 9 + i * 3)));
  const routes = Array.from({ length: 99 }, (_, i) => decodeU21(payload.slice(105 + i * 3, 108 + i * 3)) - 65536);
  return { state: (["stopped", "playing", "loading"] as const)[payload[1]], instrument: payload[2], bend,
    preset: physicalPresetFromUnknown({ format: "hexboard.physical.v22",sample:defaultSample(),modulation:defaultModulation(),effects:defaultFx(),tiltRoutes:Array(66).fill(0), name: "Device RAM", parameters, routes, velocityEngine: payload[402] }) };
}
export interface ControllerState {play:boolean;pedal:number;invert:boolean;minimum:number;maximum:number;tip:number;ring:number;valid:boolean;sustain:boolean;armed:boolean;expression:number;modulation:number}
export interface MotionState {detected:boolean;valid:boolean;tiltX:number;tiltY:number;tiltRoutes:number[]}
export function decodeMotion(p:number[]):MotionState {if(p.length!==207||p[0]!==17||p[1]>1||p[2]>1)throw Error("Unsupported motion response. Update Advanced firmware.");const x=decodeU21(p.slice(3,6)),y=decodeU21(p.slice(6,9)),routes=Array.from({length:66},(_,i)=>decodeU21(p.slice(9+i*3,12+i*3))-65536);if(x>65534||y>65534||routes.some(v=>v<-65536||v>65536)||[7,8,21,27,31].some(id=>routes.slice(id*2,id*2+2).some(Boolean)))throw Error("Invalid motion state.");return {detected:!!p[1],valid:!!p[2],tiltX:(x-32767)/32767,tiltY:(y-32767)/32767,tiltRoutes:routes};}
export interface PhysicalExpression { tiltX?:number;tiltY?:number;motionValid?:boolean;motionDetected?:boolean; key: number | null; held: boolean; velocity: number; pressure: number; release: number }
export function decodePhysicalExpression(p: number[]): PhysicalExpression {
  const key = decodeU14(p.slice(1, 3)), pressure = decodeU21(p.slice(5, 8));
  if (p.length !== 9 || p[0] !== 17 || (key > 132 && key !== 16383) || p[3] > 1 || p[4] > 127 || p[8] > 127 || pressure > 65535)
    throw Error("Invalid expression response.");
  return { key: key === 16383 ? null : key, held: Boolean(p[3]), velocity: p[4], pressure, release: p[8] };
}
export function decodeFx(payload:number[]): FxRack {
  if(payload.length!==336||payload[0]!==17)throw Error("Unsupported FX response. Update Advanced firmware.");
  const padded=payload.slice(1,6), end=padded.indexOf(0);
  if(end>=0 && padded.slice(end).some(id=>id!==0))throw Error("Invalid effect order.");
  return validateFx({steps:Array.from({length:16},(_,i)=>decodeU21(payload.slice(78+i*3,81+i*3))),order:padded.filter(Boolean),routes:Array.from({length:70},(_,i)=>decodeU21(payload.slice(126+i*3,129+i*3))-65536),values:Array.from({length:6},(_,i)=>Array.from({length:4},(_,j)=>decodeU21(payload.slice(6+(i*4+j)*3,9+(i*4+j)*3))))});
}
export function decodeModulation(payload:number[]):ModulationSources {
  if(payload.length!==247||payload[0]!==17)throw Error("Update Advanced firmware for envelope and LFO sources.");
  return validateModulation({settings:Array.from({length:16},(_,i)=>decodeU21(payload.slice(1+i*3,4+i*3))),routes:Array.from({length:66},(_,i)=>decodeU21(payload.slice(49+i*3,52+i*3))-65536)});
}
export function sampleChecksum(frames:number[]){let crc=0xffffffff;for(const v of frames)for(const byte of [v&255,(v>>8)&255]){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
interface SampleMeta{loop:SampleLoop;enabled:boolean;gain:number;direct:number;length:number;busy:boolean;crc:number}
function decodeSample(p:number[]):SampleMeta {if(p.length!==27||p[0]!==17||p[1]>1||p[8]>1)throw Error("Invalid sample response.");const gain=decodeU21(p.slice(2,5)),length=decodeU21(p.slice(5,8)),crc=p.slice(9,14).reduce((a,b)=>a*128+b,0);if(gain>65535||length>64000||crc>0xffffffff)throw Error("Invalid sample response.");const direct=decodeU21(p.slice(14,17));if(direct>65535)throw Error("Invalid sample attack mix.");const loop={mode:p[17] as 0|1|2,start:decodeU21(p.slice(18,21)),end:decodeU21(p.slice(21,24)),crossfade:decodeU21(p.slice(24,27))};if(loop.mode>2||loop.end>length||loop.crossfade>3200||loop.crossfade===1||(loop.mode===0?(loop.start!==0||loop.end!==0||loop.crossfade!==0):(loop.end-loop.start<160||loop.crossfade*2>loop.end-loop.start)))throw Error("Invalid sample loop response.");return {loop,enabled:!!p[1],gain,direct,length,busy:!!p[8],crc};}
const u32=(v:number)=>Array.from({length:5},(_,i)=>Math.floor(v/2**(7*(4-i)))%128);
let nextTransaction = 1000;
export class PhysicalSynthClient {
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;private voiceLimit=8;
  private fx = defaultFx();
  private sample=defaultSample();private sampleCrc=0;
  // DAC driver startup takes 1.6 s; a short preview must begin afterward.
  private previewNeedsStartup=true;
  private modulation = defaultModulation();
  private mono=defaultMono();
  private controllerRoutes:number[]=Array(66).fill(0);
  private motion:MotionState={detected:false,valid:false,tiltX:0,tiltY:0,tiltRoutes:Array(66).fill(0)};
  private abort?: () => void;
  constructor(private transport: MidiTransport,private onProgress?:(progress?:SynthProgress)=>void,private advanced=false) {}
  close() { this.closed = true; this.abort?.(); }
  async readSound(name:string){const state=await this.status();if(state.instrument===4||state.instrument===5){const r=await this.readAdvanced(),p={...initialClassic(state.instrument),name,patch:r.patch,effects:r.effects,velocityEngine:state.preset.velocityEngine};return r.budget.qualified?attachVoiceBudget(p,r.budget):p;}return {...(await this.read()).preset,name};}
  async presetLabel(slot:number):Promise<DevicePresetLabel>{return this.request(59,encodeU14(slot));}
  async presetFolders():Promise<DevicePresetFolder[]>{const rows:DevicePresetFolder[]=[];for(let at=0;at<32;at+=4)rows.push(...await this.request<DevicePresetFolder[]>(60,[at,4]));return rows;}
  async presetCatalog(action:number,slot=0,medium=0,progress?:(state:PresetCatalogState)=>unknown,label?:number[]):Promise<PresetCatalogState>{
    try{let state=await this.request<PresetCatalogState>(58,[action,...encodeU14(slot),medium,...(label??[])]),started=Date.now();
    while(state.phase===1){await progress?.(state);this.onProgress?.({label:action===2?'Loading preset…':(action===1||action===4)?'Saving preset…':'Reading preset library…',completed:state.progress,total:100});await new Promise(r=>setTimeout(r,25));state=await this.request<PresetCatalogState>(57);if(Date.now()-started>60000)throw Error('Preset operation timed out. Reconnect to inspect the device.');}
    await progress?.(state);this.onProgress?.();if(state.phase!==2)throw Error('Preset operation failed. Check storage space or the SD card; complete saved data remains recoverable.');return state;}finally{this.onProgress?.();}
  }
  async browsePresetFolder(slot:number,medium:number,progress:(state:PresetCatalogState)=>void,names:(rows:{id:number;label:DevicePresetLabel}[])=>void,force=false){
    let next=0;const rows:{id:number;label:DevicePresetLabel}[]=[],base=Math.floor(slot/32)*32;
    return this.presetCatalog(force?5:0,slot,medium,async state=>{
      progress(state);if(state.phase!==1&&state.phase!==2)return;
      // Browse progress is floor(readyRows * 90 / 32); 95 is engine resume.
      // These labels are already in the main's cache: no extra storage reads.
      const ready=state.phase===2||state.progress>=95?32:Math.ceil(state.progress*32/90);
      let pending=0;for(;next<ready;++next)if((state.mask>>>next)&1){
        rows.push({id:base+next,label:await this.presetLabel(base+next)});
        if(++pending===3){names(rows.slice());pending=0;}
      }
      if(pending)names(rows.slice());
    });
  }
  async saveDevicePreset(preset:import('./presetLibrary.ts').SoundPreset,slot:number,label:Omit<DevicePresetLabel,'engine'>,medium=0,progress?:(state:PresetCatalogState)=>void,create=false){
    const p=storedPreset(preset),before=await this.status();await this.stopAndWait();
    try{
      if(p.format==='hexboard.advanced.v2')await this.loadClassic(p,false);else await this.load(p,false);
      const bytes=new Uint8Array(128);bytes[8]=p.format==='hexboard.advanced.v2'?p.engine:2;bytes[9]=+label.favorite;
      const write=(text:string,offset:number,capacity:number)=>{const encoded=new TextEncoder().encode(text);if(encoded.length>=capacity)throw Error(`Device preset name or folder is too long (${capacity-1} UTF-8 bytes maximum).`);bytes.set(encoded,offset);};write(label.name,12,76);write(label.folder,88,40);
      return await this.presetCatalog(create?4:1,slot,medium,progress,Array.from(bytes).flatMap(v=>[v>>7,v&127]));
    }finally{if(before.state!=='stopped')await this.start(p.format==='hexboard.advanced.v2'?p.engine:2);}
  }
  controls(){return this.request<ControllerState>(52); }
  monoSettings(config?:MonoConfig){return this.request<MonoConfig>(56,config?[config.flags,...encodeU21(config.glideMs)]:[]);}
  async controllerRoute(id:number,source:number,value:number){await this.request<number[]>(54,[id,source,...encodeU21(value+65536)]);return this.request(0);}
  async read() {
    const state=await this.request(0);if(this.advanced){this.controllerRoutes=await this.request<number[]>(55);this.mono=await this.monoSettings();}this.fx=await this.request<FxRack>(10);this.motion=await this.request<MotionState>(12);this.modulation=await this.request<ModulationSources>(16);
    const meta=await this.request<SampleMeta>(20);
    if(!meta.busy&&(meta.crc!==this.sampleCrc||meta.length!==this.sample.frames.length)){
      const frames:number[]=[];
      this.onProgress?.({label:"Reading sample…",completed:0,total:meta.length});
      try{for(let offset=0;offset<meta.length;offset+=64){frames.push(...await this.request<number[]>(26,[...encodeU21(offset),Math.min(64,meta.length-offset)]));if(offset%512===0||frames.length===meta.length)this.onProgress?.({label:"Reading sample…",completed:frames.length,total:meta.length});}}finally{this.onProgress?.();}
      if(sampleChecksum(frames)!==meta.crc&&meta.length)throw Error("Sample readback checksum mismatch.");
      this.sample={...defaultSample(),name:meta.length?"Imported sample":"",frames};this.sampleCrc=meta.crc;
    }
    this.sample={...this.sample,enabled:meta.enabled&&this.sample.frames.length>0,gain:meta.gain,direct:meta.direct,loop:meta.loop};
    const advancedState=this.advanced?await this.readAdvanced():undefined;
    const preset={...state.preset,mono:this.mono,controllerRoutes:this.controllerRoutes,sample:this.sample,modulation:this.modulation,effects:this.fx,tiltRoutes:this.motion.tiltRoutes};return {...state,state:state.state!=="stopped"&&meta.busy&&meta.enabled?"loading":state.state,preset:advancedState?.budget.qualified&&advancedState.budget.phase===3?attachVoiceBudget(preset,advancedState.budget):preset};
  }
  async setSample(value:SampleExciter,force=false){
    const sample=validateSample(value),crc=sampleChecksum(sample.frames);
    this.onProgress?.({label:"Updating sample mode…"});
    try{
    const policyChanged=sample.enabled!==this.sample.enabled||JSON.stringify(sample.loop)!==JSON.stringify(this.sample.loop??defaultSampleLoop());
    let resume=false;if(policyChanged){const state=await this.request(0);resume=state.state!=="stopped";if(resume){await this.stop();for(let i=0;i<80;i++){if((await this.request(0)).state==="stopped")break;await new Promise(r=>setTimeout(r,30));}}}
    if(force||crc!==this.sampleCrc||sample.frames.length!==this.sample.frames.length){
      const state=await this.request(0),wasPlaying=state.state!=="stopped";
      if(wasPlaying){await this.stop();for(let i=0;i<80;i++){if((await this.request(0)).state==="stopped")break;await new Promise(r=>setTimeout(r,30));}}
      await this.request<SampleMeta>(21,[...encodeU21(sample.frames.length),...u32(crc)]);
      this.onProgress?.({label:"Sending sample…",completed:0,total:sample.frames.length});
      for(let offset=0;offset<sample.frames.length;offset+=64){const chunk=sample.frames.slice(offset,offset+64);await this.request<SampleMeta>(22,[...encodeU21(offset),chunk.length,...chunk.flatMap(v=>encodeU21(v+32768))]);if(offset%512===0||offset+chunk.length===sample.frames.length)this.onProgress?.({label:"Sending sample…",completed:offset+chunk.length,total:sample.frames.length});}
      this.onProgress?.({label:"Applying sample…"});
      await this.request<SampleMeta>(23);this.sampleCrc=crc;this.sample=sample;
      if(sample.loop?.mode)await this.configureSampleLoop(sample.loop);
      await this.request<SampleMeta>(24,[+sample.enabled,...encodeU21(sample.gain),...encodeU21(sample.direct)]);
      if(wasPlaying){await this.start();await this.waitSample();}
    }else{if(policyChanged)await this.configureSampleLoop(sample.loop!);await this.request<SampleMeta>(24,[+sample.enabled,...encodeU21(sample.gain),...encodeU21(sample.direct)]);this.sample=sample;}
    if(resume){await this.start();await this.waitSample();}
    return await this.request(0);
    }finally{this.onProgress?.();}
  }
  private async configureSampleLoop(loop:SampleLoop){return this.request<SampleMeta>(27,[loop.mode,...encodeU21(loop.start),...encodeU21(loop.end),...encodeU21(loop.crossfade)]);}
  private async waitSample(){this.onProgress?.({label:"Preparing synth…"});for(let i=0;i<300;i++){if(!(await this.request<SampleMeta>(20)).busy)return;await new Promise(r=>setTimeout(r,20));}throw Error("Sample transfer did not finish.");}
  async previewSample(){if(!this.sample.frames.length)throw Error("Import a sample first.");this.onProgress?.({label:"Preparing preview…"});try{await this.request<SampleMeta>(24,[1,...encodeU21(this.sample.gain),...encodeU21(this.sample.direct)]);this.sample.enabled=true;const state=await this.request(0);if(state.state==="stopped")await this.start();await this.waitSample();if(this.previewNeedsStartup){this.onProgress?.({label:"Preparing audio…"});await new Promise(resolve=>setTimeout(resolve,2000));this.previewNeedsStartup=false;}await this.request<SampleMeta>(25);return await this.request(0);}finally{this.onProgress?.();}}
  async effects(fx:FxRack) { const f=validateFx(fx);await this.request<FxRack>(11,[...f.order,...Array(5-f.order.length).fill(0),...f.values.flat().flatMap(encodeU21),...f.steps.flatMap(encodeU21),...f.routes!.flatMap(v=>encodeU21(v+65536))]);return this.request(0); }
  async expression() {const e=await this.request<PhysicalExpression>(8);this.motion=await this.request<MotionState>(12);return {...e,tiltX:this.motion.tiltX,tiltY:this.motion.tiltY,motionValid:this.motion.valid,motionDetected:this.motion.detected};}
  async zeroMotion(){this.motion=await this.request<MotionState>(15);return this.motion;}
  async tiltRoute(id:number,axis:number,depth:number){this.motion=await this.request<MotionState>(14,[id,axis,...encodeU21(depth+65536)]);return this.request(0);}
  async modSetting(id:number,value:number){this.modulation=await this.request<ModulationSources>(18,[id,...encodeU21(value)]);return this.request(0);}
  async modRoute(id:number,source:number,depth:number){this.modulation=await this.request<ModulationSources>(19,[id,source,...encodeU21(depth+65536)]);return this.request(0);}
  async setModulation(value:ModulationSources){const m=validateModulation(value);this.modulation=await this.request<ModulationSources>(17,[...m.settings.flatMap(encodeU21),...m.routes.flatMap(v=>encodeU21(v+65536))]);return this.request(0);}
  status(){return this.request(0);}
  samplerLoading(){return this.request<SamplerLoadingState>(63);}
  async samplerSource(source:'patch'|'piano'){return this.samplerInstrument(source==='piano'?1:0);}
  async samplerInstrument(id:number){if(!Number.isInteger(id)||id<0||id>1025)throw Error('Invalid sampler instrument.');await this.stopAndWait();return this.request(51,encodeU14(id));}
  async samplerLibrary(refresh=false,folder=0):Promise<SamplerInstrument[]>{if(!Number.isInteger(folder)||folder<0||folder>32)throw Error("Invalid sampler folder.");const entries:SamplerInstrument[]=[];for(let first=folder*32;first<folder*32+32;first+=4)entries.push(...await this.request<SamplerInstrument[]>(64,[...encodeU14(first),refresh?1:0]));return entries;}
  samplerParameter(id:number,value:number){return this.request(46,[id,...encodeU21(value)]);}
  async uploadSampler(bytes:Uint8Array,progress?:(received:number,total:number)=>void){
    if(bytes.length<512||bytes.length%512)throw Error('Invalid prepared sampler file.');
    await this.stopAndWait();
    const {crc32}=await import('./sampler/prepare.mjs');
    try{
      await this.request(47,[...u32(bytes.length),...u32(crc32(bytes))]);
      for(let offset=0;offset<bytes.length;offset+=128){const chunk=bytes.subarray(offset,offset+128);await this.request(48,[...u32(offset),...encodeU14(chunk.length),...Array.from(chunk).flatMap(byte=>[byte>>7,byte&127])]);progress?.(offset+chunk.length,bytes.length);}
      await this.request(49);
    }catch(error){try{await this.request(50);}catch{/* Explicit retry starts a new temporary-file transaction. */}throw error;}
  }
  async samplerSettings(header?:Uint8Array):Promise<Uint8Array>{
    if(header&&header.length!==128)throw Error('Sampler settings require a complete header.');await this.stopAndWait();return this.request<Uint8Array>(69,header?[1,...Array.from(header).flatMap(b=>[b>>7,b&127])]:[0]);
  }
  async uploadSamplerNamed(bytes:Uint8Array,folder:string,filename:string,progress?:(received:number,total:number)=>void){
    const text=(s:string)=>{if(!s.length||s.length>64||/[^\x20-\x7e]|[\\/:*?"<>|]/.test(s)||s.startsWith('.')||/[. ]$/.test(s))throw Error('Use a plain folder and filename.');return Array.from(s,c=>c.charCodeAt(0));};
    const f=text(folder),n=text(filename);if(!/\.hbs$/i.test(filename)||bytes.length<512||bytes.length%512)throw Error('Invalid prepared sampler file.');
    await this.stopAndWait();const {crc32}=await import('./sampler/prepare.mjs');
    try{const initial=await this.request<number>(65,[0,f.length,n.length,...f,...n,...u32(bytes.length),...u32(crc32(bytes))]);if(initial!==0)throw Error('Invalid sampler initial offset.');
    for(let offset=0;offset<bytes.length;offset+=176){const chunk=bytes.subarray(offset,offset+176);const end=await this.request<number>(66,[...u32(offset),...encodeU14(chunk.length),...Array.from(chunk).flatMap(b=>[b>>7,b&127])]);if(end!==offset+chunk.length)throw Error('Sampler transfer offset mismatch.');progress?.(end,bytes.length);}
    const received=await this.request<number>(67);if(received!==bytes.length)throw Error('Sampler transfer commit mismatch.');
    }catch(error){try{await this.request(50);}catch{/* A fresh transaction retries the temporary file. */}throw error;}
  }
  async readAdvanced(){
    let engine:AdvancedEngine=2,state=0,busy=false;const words:number[]=[];
    for(let offset=0;offset<advancedWordCount;offset+=64){const reply=await this.request<{engine:AdvancedEngine;state:number;busy:boolean;words:number[]}>(33,[...encodeU21(offset),Math.min(64,advancedWordCount-offset)]);engine=reply.engine;state=reply.state;busy=reply.busy;words.push(...reply.words);}
    const patch=advancedFromWords(engine,words),effects=await this.request<FxRack>(10),budget=await this.voiceBudget();return {patch,effects,state,busy,budget};
  }
  async applyAdvanced(value:AdvancedPatch){const p=validateAdvanced(value),words=advancedWords(p);await this.request(30,[p.engine]);for(let at=0;at<words.length;at+=64)await this.request(31,[...encodeU21(at),Math.min(64,words.length-at),...words.slice(at,at+64).flatMap(encodeU21)]);await this.request(32);}
  private async retryAdvanced(operation:number,data:number[]){for(let attempt=0;;attempt++){try{return await this.request(operation,data);}catch(error){if(attempt>=30||!(error instanceof Error)||error.message!=="The board rejected this synth operation.")throw error;await new Promise(r=>setTimeout(r,30));}}}
  editAdvanced(index:number,value:number){return this.retryAdvanced(34,[...encodeU21(index),...encodeU21(value)]);}
  routeAdvanced(index:number,destination:number,depth:number){return this.retryAdvanced(35,[...encodeU21(index),...encodeU21(destination),...encodeU21(depth+65536)]);}
  async loadClassic(value:ClassicPreset,persist=true){const p=classicFromUnknown(value),before=await this.status(),resume=before.state!=="stopped";await this.request(61);if(resume)await this.stopAndWait();
    this.onProgress?.({label:"Loading engine…"});
    try{await this.setSample(defaultSample(),true);await this.applyAdvanced(p.patch);await this.effects(p.effects);await this.presetVelocity(p.velocityEngine);await this.restoreVoiceBudget(p);if(persist)await this.request(28);if(resume)await this.start(p.engine);return await this.readAdvanced();}finally{this.onProgress?.();await this.request(62);}
  }
  async voiceBudget(){const s=await this.request<VoiceBudgetState>(37);this.voiceLimit=s.qualified?s.voices:8;return s;}
  resetVoiceBudget(){this.voiceLimit=8;return this.request<VoiceBudgetState>(40);}
  cancelVoiceTest(){return this.request<VoiceBudgetState>(38);}
  async restoreVoiceBudget(preset:PhysicalPreset|ClassicPreset){const p=validVoiceBudget(preset,preset.voiceBudget);if(!p){this.voiceLimit=8;return;}try{await this.request<VoiceBudgetState>(39,[p.voices,...u32(p.signature),...encodeU21(p.peakUs),p.revision]);this.voiceLimit=p.voices;}catch{await this.resetVoiceBudget();}}
  async testVoiceLimit<T extends PhysicalPreset|ClassicPreset>(preset:T,persist=true):Promise<T&{voiceBudget:VoiceBudgetProfile}>{
    this.onProgress?.({label:'Preparing voice test…'});
    try{
      await this.stopAndWait();
      if(preset.format==='hexboard.advanced.v2'){await this.applyAdvanced(preset.patch);await this.effects(preset.effects);await this.presetVelocity(preset.velocityEngine);}else await this.apply({...preset,voiceBudget:undefined});
      let result=await this.request<VoiceBudgetState>(36);const deadline=Date.now()+240000;
      while(result.phase===1||result.phase===2){
        this.onProgress?.({label:result.candidate===1?'Testing mono DSP budget…':`Testing ${result.candidate} voices + 2 tails…`});await new Promise(r=>setTimeout(r,500));
        try{result=await this.voiceBudget();}catch(error){if(Date.now()>=deadline)throw error;continue;}
        if(Date.now()>=deadline)throw Error('Voice test timed out. Reconnect to retry.');
      }
      if(result.phase===5)throw Error('Voice test cancelled. The patch remains unqualified.');
      const value=attachVoiceBudget(preset,result);if(persist)await this.request(28);return value;
    }catch(error){try{await this.cancelVoiceTest();}catch{/* Disconnect leaves a bounded, muted device test. */}throw error;}
    finally{this.onProgress?.();}
  }
  async start(instrument = 2) {
    this.previewNeedsStartup=true;const startedAt=Date.now();this.onProgress?.({label:`Preparing ${engineNames[instrument]??'synth'}…`,startedAt,expectedMs:prepareEstimate(instrument,this.voiceLimit)});
    try{let state=await this.request(1,[instrument]);while(state.state==='loading'){
      if(Date.now()-startedAt>(instrument===6?90000:45000))throw Error('The synth did not become playable. Retry the connection.');await new Promise(r=>setTimeout(r,50));
      try{state=await this.request(0);}catch(error){if(Date.now()-startedAt>(instrument===6?90000:45000))throw error;}
    }if(state.state!=='playing')throw Error('The synth stopped before it was ready.');if(this.advanced||instrument>=4)this.previewNeedsStartup=false;return state;
    }finally{this.onProgress?.();}
  }
  stop() { return this.request(2); }
  parameter(id: number, value: number) { return this.request(3, [id, ...encodeU21(value)]); }
  route(id: number, source: number, depth: number) { return this.request(4, [id, source, ...encodeU21(depth + 65536)]); }
  bend(semitones: number) { return this.request(5, encodeU21(Math.round(semitones * 65536) + 131072)); }
  retuneHz(key: number, tone: number, hz: number) { return this.request(6, [...encodeU14(key), tone, ...encodeLogPitchHz(hz)]); }
  performance(config?:PerformanceConfig){return this.request<PerformanceState>(config?42:41,config?performanceWords(config).flatMap(encodeU21):[]);}
  clearArpeggio(){return this.request<PerformanceState>(43);}
  savePerformance(){return this.request<PerformanceState>(44);}
  private presetVelocity(kind:PhysicalVelocityEngine){return this.request(45,[kind]);}
  velocityEngine(kind: PhysicalVelocityEngine) { return this.request(9, [kind]); }
  // Explicit editor loads persist once; benchmark callers keep RAM-only apply.
  async load(preset:PhysicalPreset,persist=true) {
    const before=await this.request(0),resume=before.state!=="stopped";
    await this.request(61);if(resume)await this.stopAndWait();
    try {
      await this.apply(storedPreset(preset) as PhysicalPreset);
      this.onProgress?.({label:"Saving startup patch…"});
      if(persist)await this.request(28);
    } finally {this.onProgress?.();try{if(resume)await this.start();}finally{await this.request(62);}}
    return this.read();
  }
  async stopAndWait(){await this.stop();for(let i=0;i<100;i++){if((await this.request(0)).state==="stopped")return;await new Promise(r=>setTimeout(r,30));}throw Error("Synth did not stop for patch storage.");}
  async apply(preset: PhysicalPreset) {
    const p = physicalPresetFromUnknown(preset);
    if(!dspUsage(p).fits)throw Error("DSP budget full. Reduce the effects, Drive, Pin or modulation before loading this patch.");
    if(this.advanced){await this.applyAdvanced(initialAdvanced(2));await this.monoSettings(validateMono(p.mono));}
    const retry=async(run:()=>Promise<unknown>)=>{for(let attempt=0;;++attempt){try{return await run();}catch(error){if(attempt>=24||!(error instanceof Error)||error.message!=="The board rejected this synth operation.")throw error;await new Promise(r=>setTimeout(r,30));}}};
    // Clear cost before allocating a replacement. This runs during an explicit
    // patch load, never on a normal note or expression update.
    if(this.advanced)await retry(()=>this.request(53,Array(66).fill(65536).flatMap(encodeU21)));
    await this.request<SampleMeta>(24,[0,...encodeU21(p.sample.gain),...encodeU21(p.sample.direct)]);
    this.sample={...this.sample,enabled:false};
    const neutralFx={...p.effects,order:[],routes:Array(70).fill(0),values:p.effects.values.map((row,i)=>i===4?row.map((v,j)=>j===0?0:v):row)};
    await retry(()=>this.effects(neutralFx));
    await retry(()=>this.setModulation({...p.modulation,routes:Array(66).fill(0)}));
    await retry(()=>this.request<MotionState>(13,Array(66).fill(65536).flatMap(encodeU21)));
    await retry(()=>this.request(7,[...p.parameters.flatMap(encodeU21),...Array(99).fill(65536).flatMap(encodeU21),p.velocityEngine]));
    await this.request(7, [...p.parameters.flatMap(encodeU21), ...p.routes.flatMap(v => encodeU21(v + 65536)), p.velocityEngine]);
    for(let attempt=0;;++attempt){try{this.motion=await this.request<MotionState>(13,p.tiltRoutes.flatMap(v=>encodeU21(v+65536)));break;}catch(error){if(attempt>=20 || !(error instanceof Error) || error.message!=="The board rejected this synth operation.")throw error;await new Promise(resolve=>setTimeout(resolve,30));}}
    for(let attempt=0;;++attempt){try{await this.setModulation(p.modulation);break;}catch(error){if(attempt>=20||!(error instanceof Error)||error.message!=="The board rejected this synth operation.")throw error;await new Promise(resolve=>setTimeout(resolve,30));}}
    // The model batch may still be draining through SPI. Retry rack backpressure.
    for(let attempt=0;;++attempt){try{await this.effects(p.effects);if(this.advanced)await retry(()=>this.request(53,(p.controllerRoutes??Array(66).fill(0)).flatMap(v=>encodeU21(v+65536))));const result=await this.setSample(p.sample,!p.sample.frames.length);if(this.advanced)await this.restoreVoiceBudget(p);return result;}catch(error){if(attempt>=12 || !(error instanceof Error) || error.message!=="The board rejected this synth operation.")throw error;await new Promise(resolve=>setTimeout(resolve,30));}}
  }
  protected request<T = PhysicalState>(operation: number, data: number[] = []): Promise<T> {
    const run = this.tail.catch(() => undefined).then(() => this.rpc<T>(operation, data));
    this.tail = run; return run;
  }
  private rpc<T>(operation: number, data: number[]): Promise<T> {
    if (this.closed) return Promise.reject(new SynthRequestCancelledError());
    const transaction = nextTransaction++ % 16383 + 1;
    return new Promise((resolve, reject) => {
      let unsubscribe = () => {}; let done = false;
      const finish = (error?: Error, state?: T) => {
        if (done) return;
        done = true; clearTimeout(timer); unsubscribe(); this.abort = undefined;
        if (error) reject(error); else resolve(state!);
      };
      const timer = setTimeout(() => finish(Error("The board did not reply. Reconnect to retry.")), operation===49||operation===67?90000:5000);
      this.abort = () => finish(new SynthRequestCancelledError());
      unsubscribe = this.transport.subscribe(bytes => {
        if (bytes[0] !== 0xf0 || bytes[1] !== 0x7d || bytes[2] !== 0x10) return;
        try {
          const frame = decodePresetSyncFrame(bytes);
          if (frame.transactionId !== transaction) return;
          if (frame.message === 7) {
            finish(Error(operation===41?"Update Advanced main firmware to use the global arpeggiator.":frame.payload[1] === 3 ? operation>=16?"Update Advanced firmware for envelope and LFO modulation.":"Update Advanced main firmware for preset velocity engines." : frame.payload[1] === 9 ? "DSP budget full. Reduce another effect, feature or modulation first." : frame.payload[1] === 8 ? "Stop Learn or Calibration and release keys before changing the velocity engine or loading a sound." : operation===21?"Release the keys and stop the synth before importing a sample.":operation===25?"Release the keys before sample preview.":operation===42?"Release the keys before switching Arp on/off or changing its output. If playback is being tested, wait for it to finish.":operation===44?"Stop the synth, clear held arp notes, and release the keys before saving performance settings.":"The board rejected this synth operation."));
          } else if((operation===57||operation===58)&&frame.message===0x43){
            const p=frame.payload;if(p.length!==27||p[0]!==17||p[1]!==2||p[2]>3||p[3]>5||decodeU14(p.slice(4,6))>=3072||p[6]>2||p[7]>100||![2,4,5].includes(p[19])||p[20]>=32||decodeU14(p.slice(21,23))!==3072||p[23]!==32)throw Error('Update Advanced firmware for the folder preset library.');const mask=p.slice(8,13).reduce((a,b)=>a*128+b,0);if(mask>0xffffffff)throw Error('Invalid preset folder mask.');finish(undefined,{phase:p[2],action:p[3],slot:decodeU14(p.slice(4,6)),medium:p[6],progress:p[7],mask,elapsedMs:decodeU21(p.slice(13,16)),maxSliceUs:decodeU21(p.slice(16,19)),engine:p[19],folder:p[20],capacity:3072,folderCapacity:32,heapMin:decodeU21(p.slice(24,27))} as T);
          } else if(operation===59&&frame.message===0x44){
            const p=frame.payload;if(p.length!==259||p[0]!==17||p[1]!==data[0]||p[2]!==data[1])throw Error('Invalid preset label.');const bytes=Uint8Array.from({length:128},(_,i)=>{if(p[3+i*2]>1)throw Error('Invalid preset label byte.');return (p[3+i*2]<<7)|p[4+i*2];});const text=(offset:number,n:number)=>{const b=bytes.slice(offset,offset+n),end=b.indexOf(0);return new TextDecoder('utf-8',{fatal:true}).decode(b.slice(0,end<0?n:end));};if(![2,3,4,5].includes(bytes[8])||bytes[9]>1)throw Error('Invalid preset engine.');finish(undefined,{engine:bytes[8],favorite:!!bytes[9],name:text(12,76),folder:text(88,40)} as T);
          } else if(operation===60&&frame.message===0x46){
            const p=frame.payload;if(p[0]!==17||p[1]!==data[0]||p[2]!==data[1]||p.length!==3+p[2]*96)throw Error('Invalid preset folders.');const folders=Array.from({length:p[2]},(_,row)=>{const b=Uint8Array.from({length:48},(_,i)=>{const at=3+row*96+i*2;if(p[at]>1)throw Error('Invalid folder byte.');return p[at]*128+p[at+1];}),mask=new DataView(b.buffer).getUint32(0,true),name=b.slice(4,44),end=name.indexOf(0);if(end<0)throw Error('Invalid folder name.');return {index:p[1]+row,mask,name:new TextDecoder('utf-8',{fatal:true}).decode(name.slice(0,end))};});finish(undefined,folders as T);
          } else if((operation===61||operation===62)&&frame.message===0x45){if(frame.payload.length!==1||frame.payload[0]!==17)throw Error('Invalid preset transition response.');finish(undefined,undefined as T);
          } else if(operation===52&&frame.message===0x40){
            const p=frame.payload;if(p.length!==25||p[0]!==17||p[1]>1||p[2]>2||p[3]>1||p[16]>1||p[17]>1||p[18]>1)throw Error('Invalid controller state.');const numbers=Array.from({length:4},(_,i)=>decodeU21(p.slice(4+i*3,7+i*3)));if(numbers.some(v=>v>4095))throw Error('Invalid pedal ADC state.');const expression=decodeU21(p.slice(19,22)),modulation=decodeU21(p.slice(22,25));if(expression>65535||modulation>65534)throw Error('Invalid controller values.');finish(undefined,{play:!!p[1],pedal:p[2],invert:!!p[3],minimum:numbers[0],maximum:numbers[1],tip:numbers[2],ring:numbers[3],valid:!!p[16],sustain:!!p[17],armed:!!p[18],expression:expression/65535,modulation:(modulation-32767)/32767} as T);
          } else if(operation>=53&&operation<=55&&frame.message===0x41){
            const p=frame.payload;if(p.length!==199||p[0]!==17)throw Error('Invalid controller routes.');const values=Array.from({length:66},(_,i)=>decodeU21(p.slice(1+i*3,4+i*3))-65536);if(values.some((v,i)=>v< -65536||v>65536||[8,21,27,31].includes(Math.floor(i/2))&&v!==0))throw Error('Invalid controller routes.');this.controllerRoutes=values;finish(undefined,values as T);
          } else if(operation===69&&frame.message===0x4a){
            const p=frame.payload;if(p.length!==257||p[0]!==17)throw Error('Invalid sampler settings reply.');const bytes=Uint8Array.from({length:128},(_,i)=>{if(p[1+i*2]>1)throw Error('Invalid sampler settings byte.');return p[1+i*2]*128+p[2+i*2];});finish(undefined,bytes as T);
          } else if(operation>=65&&operation<=68&&frame.message===0x49){
            const p=frame.payload;if(p.length!==6||p[0]!==17||p[1]>15)throw Error('Invalid sampler transfer acknowledgement.');finish(undefined,p.slice(1).reduce((n,b)=>n*128+b,0) as T);
          } else if(operation===64&&frame.message===0x48){
            finish(undefined,decodeSamplerLibrary(frame.payload,decodeU14(data.slice(0,2))) as T);
          } else if(operation===63&&frame.message===0x47){
            finish(undefined,decodeSamplerLoading(frame.payload) as T);
          } else if(operation>=46&&operation<=51&&frame.message===0x35){
            finish(undefined,decodePhysicalState(frame.payload) as T);
          } else if(operation>=41&&operation<=44&&frame.message===0x3f){
            const p=frame.payload;if(p.length!==182||p[0]!==17||p[1]!==1||p[2]>31||p[3]>64||p[4]>1||p[5]>1||p[6]>1)throw Error('Invalid performance response.');
            const config=performanceFromWords(Array.from({length:56},(_,i)=>decodeU21(p.slice(14+i*3,17+i*3))));
            finish(undefined,{config,step:p[2],notes:p[3],running:!!p[4],limited:!!p[5],external:!!p[6],bpm10:decodeU14(p.slice(7,9)),skipped:decodeU21(p.slice(9,12)),full:decodeU14(p.slice(12,14))} as T);
          } else if(operation>=36&&operation<=40&&frame.message===0x3e){
            const p=frame.payload,signature=p.slice(8,13).reduce((a,b)=>a*128+b,0),peakUs=decodeU21(p.slice(13,16));if(p.length!==17||p[0]!==17||p[1]>5||p[2]<1||p[2]>18||p[3]<1||p[3]>18||p[4]<1||p[4]>18||p[5]<2||p[5]>5||p[6]>1||signature>0xffffffff||p[16]!==4)throw Error('Invalid voice-budget response.');finish(undefined,{phase:p[1],voices:p[2],candidate:p[3],ceiling:p[4],engine:p[5],qualified:!!p[6],reason:p[7],signature,peakUs,revision:p[16]} as T);
          } else if(operation>=30&&operation<=35&&frame.message===0x3d){
            const p=frame.payload;if(p.length<9||p[0]!==17||p[8]!==2||p[1]<2||p[1]>5||p[2]>1||p[3]>1||p[7]>64||p.length!==9+p[7]*3||(operation===33&&(decodeU21(p.slice(4,7))!==decodeU21(data.slice(0,3))||p[7]!==data[3])))throw Error("Invalid Advanced engine response.");
            finish(undefined,{engine:p[1],state:p[2],busy:!!p[3],words:Array.from({length:p[7]},(_,i)=>decodeU21(p.slice(9+i*3,12+i*3)))} as T);
          } else if(operation>=20&&operation<=27&&frame.message===(operation===26?0x3c:0x3b)){
            if(operation===26){const p=frame.payload;if(p[0]!==17||p.length!==2+3*p[1]||p[1]>64)throw Error("Invalid sample chunk.");const values=Array.from({length:p[1]},(_,i)=>decodeU21(p.slice(2+3*i,5+3*i))-32768);if(values.some(v=>v<-32768||v>32767))throw Error("Invalid sample PCM.");finish(undefined,values as T);}
            else finish(undefined,decodeSample(frame.payload) as T);
          } else if(frame.message===0x42&&operation===56){const p=frame.payload;if(p.length!==5||p[0]!==17)throw Error('Invalid mono response.');this.mono=validateMono({flags:p[1],glideMs:decodeU21(p.slice(2,5))});finish(undefined,this.mono as T);
          } else if (frame.message === (operation === 8 ? 0x36 : (operation===28||operation===45) ? 0x35 : operation>=16 ? 0x39 : operation>=12 ? 0x38 : operation>=10 ? 0x37 : 0x35)) { if(operation>=16&&operation!==28&&operation!==45){this.modulation=decodeModulation(frame.payload);finish(undefined,this.modulation as T);}else if(operation>=12&&operation!==28&&operation!==45){this.motion=decodeMotion(frame.payload);finish(undefined,this.motion as T);}else if(operation>=10&&operation!==28&&operation!==45){this.fx=decodeFx(frame.payload);finish(undefined,this.fx as T);}else if(operation===8)finish(undefined,decodePhysicalExpression(frame.payload) as T);else {const state=decodePhysicalState(frame.payload);finish(undefined,{...state,preset:{...state.preset,mono:this.mono,controllerRoutes:this.controllerRoutes,sample:this.sample,modulation:this.modulation,effects:this.fx,tiltRoutes:this.motion.tiltRoutes}} as T);} }
        } catch (error) { finish(error instanceof Error ? error : Error("Invalid synth response.")); }
      });
      void this.transport.send(encodeDefaultPresetSyncFrame(0x34, transaction, [17, operation, ...data]))
        .catch(error => finish(error instanceof Error ? error : Error("Could not reach the board.")));
    });
  }
}
