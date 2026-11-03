import {useSyncExternalStore} from 'react';
import {Autosave,writeStoredText} from '../../editor/autosave.ts';
export const S={enabled:0,mode:1,division:2,timing:3,range:4,gate:5,swing:6,latch:7,restart:8,quantize:9,velocityMode:10,velocity:11,pressureMode:12,pressure:13,destination:14,clock:15,followPreset:16,bpm10:17,periodMode:18,length:19,volumeSync:20,lfoSync:21,lfoDivision:22} as const;
export interface ArpStep {on:boolean;tie:boolean;velocity:number;probability:number;ratchets:number}
export interface PerformanceConfig {format:'hexboard.performance.v1';values:number[];steps:ArpStep[]}
export interface PerformanceState {config:PerformanceConfig;step:number;notes:number;running:boolean;limited:boolean;external:boolean;bpm10:number;skipped:number;full:number}
export const arpModes=['Up','Down','Up / Down','As played','Random','Chord'];
export const arpRates=['1/4','1/8','1/16','1/32','1/64','1/128'];
export function defaultPerformance():PerformanceConfig{return {format:'hexboard.performance.v1',values:[0,0,2,0,1,65,0,0,0,0,0,90,0,32768,0,0,0,1200,0,16,1,0,2,0],steps:Array.from({length:32},()=>({on:true,tie:false,velocity:100,probability:100,ratchets:1}))};}
export function validatePerformance(value:unknown):PerformanceConfig{
 const p=value as PerformanceConfig;const max=[1,5,5,2,4,100,75,1,1,1,1,127,1,65535,2,1,1,2400,1,32,1,1,5,0];
 if(!p||p.format!=='hexboard.performance.v1'||!Array.isArray(p.values)||p.values.length!==24||p.values.some((v,i)=>!Number.isInteger(v)||v<0||v>max[i])||p.values[4]<1||p.values[5]<5||p.values[11]<1||p.values[17]<400||p.values[19]<1||!Array.isArray(p.steps)||p.steps.length!==32||p.steps.some(s=>!s||typeof s.on!=='boolean'||typeof s.tie!=='boolean'||!Number.isInteger(s.velocity)||s.velocity<0||s.velocity>127||!Number.isInteger(s.probability)||s.probability<0||s.probability>100||!Number.isInteger(s.ratchets)||s.ratchets<1||s.ratchets>4||(s.tie&&s.ratchets!==1)))throw Error('Invalid performance settings.');
 return {format:p.format,values:[...p.values],steps:p.steps.map(s=>({...s}))};
}
export function performanceWords(p:PerformanceConfig){const c=validatePerformance(p);return [...c.values,...c.steps.map(s=>Number(s.on)|(Number(s.tie)<<1)|(s.velocity<<2)|(s.probability<<9)|(s.ratchets<<16))];}
export function performanceFromWords(words:number[]):PerformanceConfig{
 if(words.length!==56||words.some(v=>!Number.isInteger(v)||v<0||v>2097151))throw Error('Invalid performance response.');
 const c=validatePerformance({format:'hexboard.performance.v1',values:words.slice(0,24),steps:words.slice(24).map(v=>({on:!!(v&1),tie:!!(v&2),velocity:(v>>2)&127,probability:(v>>9)&127,ratchets:(v>>16)&7}))});
 if(performanceWords(c).some((v,i)=>v!==words[i]))throw Error('Invalid performance response.');return c;
}
export function euclidean(steps:ArpStep[],length:number,hits:number,rotation:number){return steps.map((s,i)=>i>=length?s:{...s,on:((i-rotation+length)%length)*hits%length<hits,tie:false});}
const storage='hexboard.performance.v1';
let snapshot=defaultPerformance();try{const raw=localStorage.getItem(storage);if(raw)snapshot=validatePerformance(JSON.parse(raw));}catch{/* Fresh session uses Threshold Strike. */}
let actualTempo10=snapshot.values[S.bpm10];
const listeners=new Set<()=>void>();
const writes=new Autosave();
const flush=()=>{void writes.flush().catch(()=>{});};
const hidden=()=>{if(document.hidden)flush();};
export function subscribePerformance(fn:()=>void){
 if(!listeners.size&&typeof window!=='undefined'){window.addEventListener('pagehide',flush);document.addEventListener('visibilitychange',hidden);}
 listeners.add(fn);
 return()=>{listeners.delete(fn);if(!listeners.size){flush();if(typeof window!=='undefined'){window.removeEventListener('pagehide',flush);document.removeEventListener('visibilitychange',hidden);}}};
}
function updatePerformance(p:PerformanceConfig, tempo=actualTempo10){
 const next=validatePerformance(p);
 const changed=next.values.some((v,i)=>v!==snapshot.values[i])||next.steps.some((s,i)=>{const old=snapshot.steps[i];return s.on!==old.on||s.tie!==old.tie||s.velocity!==old.velocity||s.probability!==old.probability||s.ratchets!==old.ratchets;});
 if(!next.values[S.clock])tempo=next.values[S.bpm10];
 if(!changed&&tempo===actualTempo10)return;
 actualTempo10=tempo;
 if(changed){snapshot=next;writes.schedule(()=>{try{writeStoredText(localStorage,storage,JSON.stringify(snapshot));}catch{/* Explicit export remains available. */}});}
 listeners.forEach(f=>f());
}
export function publishPerformance(p:PerformanceConfig){updatePerformance(p);}
export function usePerformance(){return useSyncExternalStore(subscribePerformance,()=>snapshot,()=>snapshot);}

export function publishPerformanceState(state:PerformanceState){updatePerformance(state.config,state.bpm10);}
export function usePerformanceTempo(){return useSyncExternalStore(subscribePerformance,()=>actualTempo10,()=>actualTempo10);}
