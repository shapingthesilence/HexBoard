import type {PhysicalPreset} from './schema.ts';
// Modulation settings words, after the eighteen envelope/LFO words. Mirrors
// src/synth/pitch_spring.h in HexBoard Advanced.
export const springWords={source:18,amount:19,return:20,bounce:21,routes:22,weight:40,direction:41} as const;
export const springSourceNames=['Pressure','Tilt X','Tilt Y','Expression','Joystick Mod','Envelope','LFO'];
export const springSourceWords=[0,10922,21844,32766,43688,54610,65535];
export const springDirectionWords=[0,32768,65535];
export const springDefaults=[0,32768,23200,0,...Array(18).fill(32768),16384,0];
const step=512/44100,onsetSeconds=.05,knee=.02,cents=200;
export const springSigned=(v:number)=>Math.max(-1,(v-32768)/32767);
export const springReturn=(v:number)=>.03+2.97*(v/65535)**2;
/** Return at its maximum holds the bend for as long as the source is held. */
export const springHolds=(v:number)=>v/65535>=.9995;
export const springHertz=(v:number)=>20*2**(-3.3*v/65535);
export const springDamping=(v:number)=>Math.exp(-1.9*v/65535);
/** Time for a critically damped spring to cover 90% of a step. */
export const springRise=(v:number)=>3.89/(2*Math.PI*springHertz(v));
export const springSource=(settings:number[])=>Math.round(settings[springWords.source]*6/65535);
export const springDirection=(settings:number[])=>Math.round(settings[springWords.direction]*2/65535);
export const springRouteWord=(id:number,s:number)=>springWords.routes+(id-33)*9+s;
export const springWord=(depth:number)=>Math.round(32768+Math.max(-1,Math.min(1,depth/65536))*32767);
export const springBase=(p:PhysicalPreset,id:number)=>p.modulation.settings[id===33?springWords.amount:springWords.return];
export const springNames=[{name:'Amount',describe:(v:number)=>`${(cents*springSigned(v)).toFixed(1)} ct`,behavior:'More upward bend'}, {name:'Return',describe:(v:number)=>springHolds(v)?'Hold':`${Math.round(springReturn(v)*1000)} ms`,behavior:'Slower centering'}];
export function springEffective(settings:number[],sources:number[],target:number){let value=target===0?springSigned(settings[springWords.amount]):settings[springWords.return]/65535;for(let s=0;s<9;++s)value+=springSigned(settings[springWords.routes+target*9+s])*sources[s];value=Math.max(target===0?-1:0,Math.min(1,value));return target===0?(32768+value*32767)/65535:value;}
export function springEnabled(settings:number[]){return settings[springWords.amount]!==32768||settings.slice(springWords.routes,springWords.routes+18).some(v=>v!==32768);}
/** Superseded settings: 40 words (Warble becomes Bounce, new words take defaults) or the 44-word draft with key-edge amounts. */
export const springUpgrade=(settings:number[])=>settings.length===40?[...settings,...springDefaults.slice(22)]:settings.length===44?settings.slice(0,42):settings;

interface Poles {a1:number;a2:number;b0:number}
const poles=(settings:number[]):Poles=>{const w=2*Math.PI*springHertz(settings[springWords.weight])*step,z=springDamping(settings[springWords.bounce]),r=Math.exp(-z*w),a1=2*r*Math.cos(w*Math.sqrt(Math.max(0,1-z*z))),a2=r*r;return {a1,a2,b0:1-a1+a2};};
/** One voice's spring, advanced in firmware-sized steps. Output is displacement, −1.75…1.75. */
export class SpringState {
 private input=0;private center=0;private held=0;private y1=0;private y2=0;private age=0;
 seed(x:number){this.input=this.center=this.held=x;this.y1=this.y2=this.age=0;}
 step(settings:number[],p:Poles,x:number,ret:number,released:boolean,pressure:boolean){
  const direction=springDirection(settings),holds=ret>=.9995;
  if(pressure){if(released)x=this.held;else this.held=x;}
  this.input+=(x-this.input)*step/(.01+step);
  if(this.age<onsetSeconds){this.age+=step;if(!holds)this.input=this.center=x;}
  let gesture=this.input-this.center;
  if(!holds)this.center+=gesture*step/(springReturn(ret*65535)/Math.LN10+step);
  if(Math.abs(gesture)<1e-6){gesture=0;if(!holds)this.center=this.input;}
  let target=Math.max(-1,Math.min(1,gesture));
  if(direction===1)target=Math.max(target,0);else if(direction===2)target=Math.min(target,0);
  target*=Math.abs(target)/(Math.abs(target)+knee);
  let y=p.a1*this.y1-p.a2*this.y2+p.b0*target;
  y=Math.max(-1.75,Math.min(1.75,y));
  if(target===0&&Math.abs(y)<1e-6&&Math.abs(this.y1)<1e-6)y=0;
  this.y2=this.y1;this.y1=y;return y;
 }
}
const sourceInput=(index:number,sources:number[])=>{const x=sources[[1,3,4,8,7,5,6][index]];return [1,2,4].includes(index)?.5+.5*x:x;};
/** UI approximation for the selected note, never hardware pitch telemetry. */
export class PitchSpringPreview {
 private state=new SpringState();private source=-1;private key:unknown;private last=0;private pending=0;value=0;
 advance(settings:number[],sources:number[],now:number,key:unknown,held=true){
  const index=springSource(settings),input=sourceInput(index,sources);
  if(this.source!==index||this.key!==key||!springEnabled(settings)){const onset=this.key!==key;this.source=index;this.key=key;this.state.seed(onset&&index===0?0:input);this.value=0;this.last=now;this.pending=0;}
  this.pending+=Math.max(0,Math.min(.06,(now-this.last)/1000));this.last=now;
  if(this.pending>=step){const p=poles(settings),amount=springSigned(Math.round(springEffective(settings,sources,0)*65535)),ret=springEffective(settings,sources,1);
   while(this.pending>=step){this.pending-=step;this.value=cents*amount*this.state.step(settings,p,input,ret,!held,index===0);}}
  return Math.abs(this.value)<.002?0:this.value;
 }
}
export interface SpringResponse {bend:Float32Array;gesture:Float32Array;marks:{at:number;label:string}[];seconds:number;peak:number}
/**
 * The bend a standard gesture produces at full Amount: strike, press in, ease
 * off, let go. Each stage lasts long enough to show the Return settling.
 */
export function springResponse(settings:number[],points=240):SpringResponse {
 const pressure=springSource(settings)===0,ret=settings[springWords.return]/65535,stage=springHolds(settings[springWords.return])?.7:Math.max(.45,Math.min(2.4,1.5*springReturn(settings[springWords.return])+2*springRise(settings[springWords.weight])));
 const lead=.3*stage,times=[lead,lead+stage,lead+2*stage],seconds=lead+2.8*stage,steps=Math.ceil(seconds/step),p=poles(settings),state=new SpringState();
 const bend=new Float32Array(points),gesture=new Float32Array(points);let peak=0;state.seed(0);
 // Travel: the strike lands lightly, a deliberate press follows, then eases
 // part of the way back so letting go still has pressure to release.
 const rest=pressure?.25:0,back=pressure?.5:0;
 const ramp=(t:number,from:number,to:number,start:number,length:number)=>from+(to-from)*Math.max(0,Math.min(1,(t-start)/length));
 for(let n=0,next=0;n<steps;++n){const t=n*step,released=pressure&&t>=times[2];
  const x=t<times[0]?ramp(t,0,rest,0,.02):t<times[1]?ramp(t,rest,1,times[0],.07):ramp(t,1,back,times[1],.07);
  const y=state.step(settings,p,x,ret,released,pressure);peak=Math.max(peak,Math.abs(y));
  for(;next<points&&next/(points-1)*seconds<=t+step;++next){bend[next]=y;gesture[next]=released?0:x;}
 }
 return {bend,gesture,seconds,peak,marks:[...(pressure?[{at:0,label:'strike'}]:[]),{at:times[0]/seconds,label:pressure?'press in':'rise'},{at:times[1]/seconds,label:pressure?'ease off':'fall'},...(pressure?[{at:times[2]/seconds,label:'let go'}]:[])]};
}
