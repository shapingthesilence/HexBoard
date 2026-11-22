import type {PhysicalPreset} from './schema.ts';
// Modulation settings words, after the eighteen envelope/LFO words. Mirrors
// src/synth/pitch_spring.h in HexBoard Advanced.
export const springWords={source:18,amount:19,return:20,bounce:21,routes:22,weight:40,direction:41} as const;
/** Pressure is per note; Rock (how fast the board rocks) is global and zero at rest. */
export const springSourceNames=['Pressure','Rock'];
export const springSourceWords=[0,32768];
export const springDirectionWords=[0,32768,65535];
export const springDefaults=[0,32768,23200,0,...Array(18).fill(32768),16384,0];
const step=512/44100,onsetSeconds=.05,knee=.02,cents=200;
export const springSigned=(v:number)=>Math.max(-1,(v-32768)/32767);
export const springReturn=(v:number)=>.03+2.97*(v/65535)**2;
/** Return at its maximum holds the bend: Pressure while held, Rock until rocked the other way. */
export const springHolds=(v:number)=>v/65535>=.9995;
export const springHertz=(v:number)=>20*2**(-3.3*v/65535);
export const springDamping=(v:number)=>Math.exp(-1.9*v/65535);
/** Time for a critically damped spring to cover 90% of a step. */
export const springRise=(v:number)=>3.89/(2*Math.PI*springHertz(v));
export const springSource=(settings:number[])=>settings[springWords.source]>=32768?1:0;
export const springDirection=(settings:number[])=>Math.round(settings[springWords.direction]*2/65535);
export const springRouteWord=(id:number,s:number)=>springWords.routes+(id-33)*9+s;
export const springWord=(depth:number)=>Math.round(32768+Math.max(-1,Math.min(1,depth/65536))*32767);
export const springBase=(p:PhysicalPreset,id:number)=>p.modulation.settings[id===33?springWords.amount:springWords.return];
export const springNames=[{name:'Amount',describe:(v:number)=>`${(cents*springSigned(v)).toFixed(1)} ct`,behavior:'More upward bend'}, {name:'Return',describe:(v:number)=>springHolds(v)?'Hold':`${Math.round(springReturn(v)*1000)} ms`,behavior:'Slower centering'}];
export function springEffective(settings:number[],sources:number[],target:number){let value=target===0?springSigned(settings[springWords.amount]):settings[springWords.return]/65535;for(let s=0;s<9;++s)value+=springSigned(settings[springWords.routes+target*9+s])*sources[s];value=Math.max(target===0?-1:0,Math.min(1,value));return target===0?(32768+value*32767)/65535:value;}
export function springEnabled(settings:number[]){return settings[springWords.amount]!==32768||settings.slice(springWords.routes,springWords.routes+18).some(v=>v!==32768);}
/** Superseded settings: 40 words (Warble becomes Bounce, new words take defaults) or the 44-word draft with key-edge amounts. */
export const springUpgrade=(settings:number[])=>settings.length===40?[...settings,...springDefaults.slice(22)]:settings.length===44?settings.slice(0,42):settings;
/** v24 offered seven sources: Tilt X/Y become Rock, the rest Pressure. A v25 Shake becomes Rock. */
export const springSourceUpgrade=(word:number,v25=false)=>(v25?word>=32768:word===10922||word===21844)?springSourceWords[1]:springSourceWords[0];

interface Poles {a1:number;a2:number;b0:number}
const poles=(settings:number[]):Poles=>{const w=2*Math.PI*springHertz(settings[springWords.weight])*step,z=springDamping(settings[springWords.bounce]),r=Math.exp(-z*w),a1=2*r*Math.cos(w*Math.sqrt(Math.max(0,1-z*z))),a2=r*r;return {a1,a2,b0:1-a1+a2};};
/** One voice's spring, advanced in firmware-sized steps. Output is displacement, −1.75…1.75. */
export class SpringState {
 private input=0;private center=0;private held=0;private y1=0;private y2=0;private age=0;
 /** Motion sources are absolute, so a note started mid-gesture swings into it. */
 seed(source:number,x:number){this.input=this.center=this.held=source===0?x:0;this.y1=this.y2=this.age=0;}
 step(settings:number[],p:Poles,x:number,ret:number,amount:number,released:boolean,source:number){
  const direction=springDirection(settings),holds=ret>=.9995,release=step/(springReturn(ret*65535)/Math.LN10+step);
  if(source===0){if(released)x=this.held;else this.held=x;}
  this.input+=(x-this.input)*step/(.01+step);
  let gesture=this.input;
  if(source===0){
   if(this.age<onsetSeconds){this.age+=step;if(!holds)this.input=this.center=x;}
   gesture=this.input-this.center;
   if(!holds)this.center+=gesture*release;
   if(Math.abs(gesture)<1e-6){gesture=0;if(!holds)this.center=this.input;}
  }else if(source===1){
   // Kick: follow a rock outward at once, then ease back over Return.
   if(this.input>=0?this.input>=this.center:this.input<=this.center)this.center=this.input;else if(!holds)this.center+=(this.input-this.center)*release;
   gesture=this.center;
  }
  let target=Math.max(-1,Math.min(1,gesture));
  if(Math.abs(target)<1e-6)target=0;
  // Direction names the pitch side, whatever Amount's sign.
  if(direction!==0&&((target>=0)===(amount>=0))!==(direction===1))target=0;
  target*=Math.abs(target)/(Math.abs(target)+knee);
  let y=p.a1*this.y1-p.a2*this.y2+p.b0*target;
  y=Math.max(-1.75,Math.min(1.75,y));
  if(target===0&&Math.abs(y)<1e-6&&Math.abs(this.y1)<1e-6)y=0;
  this.y2=this.y1;this.y1=y;return y;
 }
}
const sourceInput=(source:number,sources:number[],rock:number)=>source===1?rock:sources[1];
/** UI approximation for the selected note, never hardware pitch telemetry. */
export class PitchSpringPreview {
 private state=new SpringState();private source=-1;private key:unknown;private last=0;private pending=0;value=0;
 advance(settings:number[],sources:number[],now:number,key:unknown,held=true,rock=0){
  const source=springSource(settings),input=sourceInput(source,sources,rock);
  if(this.source!==source||this.key!==key||!springEnabled(settings)){const onset=this.key!==key;this.source=source;this.key=key;this.state.seed(source,onset&&source===0?0:input);this.value=0;this.last=now;this.pending=0;}
  this.pending+=Math.max(0,Math.min(.06,(now-this.last)/1000));this.last=now;
  if(this.pending>=step){const p=poles(settings),amount=springSigned(Math.round(springEffective(settings,sources,0)*65535)),ret=springEffective(settings,sources,1);
   while(this.pending>=step){this.pending-=step;this.value=cents*amount*this.state.step(settings,p,input,ret,amount,!held,source);}}
  return Math.abs(this.value)<.002?0:this.value;
 }
}
export interface SpringResponse {bend:Float32Array;gesture:Float32Array;marks:{at:number;label:string}[];seconds:number;peak:number}
/**
 * The bend a standard gesture produces at full positive Amount. Pressure:
 * strike, press in, ease off, let go. Rock: a quick rock and back (the lane
 * shows the board's angle).
 */
export function springResponse(settings:number[],points=240):SpringResponse {
 const source=springSource(settings),pressure=source===0,ret=settings[springWords.return]/65535,amount=1;
 const stage=springHolds(settings[springWords.return])?.7:Math.max(.45,Math.min(2.4,1.5*springReturn(settings[springWords.return])+2*springRise(settings[springWords.weight])));
 const lead=.3*stage,times=[lead,lead+stage,lead+2*stage],seconds=lead+2.8*stage,steps=Math.ceil(seconds/step),p=poles(settings),state=new SpringState();
 const bend=new Float32Array(points),gesture=new Float32Array(points);let peak=0;state.seed(source,0);
 // Pressure: the strike lands lightly, a deliberate press follows, then eases
 // part of the way back so letting go still has pressure to release.
 const rest=pressure?.25:0,back=pressure?.5:0,rockTime=.15,kick=.6;
 const ramp=(t:number,from:number,to:number,start:number,length:number)=>from+(to-from)*Math.max(0,Math.min(1,(t-start)/length));
 const angle=(t:number)=>{const u=(s:number)=>Math.max(0,Math.min(1,(t-s)/rockTime));return .5-.5*Math.cos(Math.PI*u(times[0]))-(.5-.5*Math.cos(Math.PI*u(times[1])));};
 const pulse=(t:number,s:number)=>t>=s&&t<s+rockTime?Math.sin(Math.PI*(t-s)/rockTime):0;
 for(let n=0,next=0;n<steps;++n){const t=n*step,released=pressure&&t>=times[2];
  let x:number,lane:number;
  if(!pressure){x=kick*(pulse(t,times[0])-pulse(t,times[1]));lane=angle(t);}
  else{x=t<times[0]?ramp(t,0,rest,0,.02):t<times[1]?ramp(t,rest,1,times[0],.07):ramp(t,1,back,times[1],.07);lane=released?0:x;}
  const y=state.step(settings,p,x,ret,amount,released,source);peak=Math.max(peak,Math.abs(y));
  for(;next<points&&next/(points-1)*seconds<=t+step;++next){bend[next]=y;gesture[next]=lane;}
 }
 const marks=pressure?[{at:0,label:'strike'},{at:times[0]/seconds,label:'press in'},{at:times[1]/seconds,label:'ease off'},{at:times[2]/seconds,label:'let go'}]:
  [{at:times[0]/seconds,label:'rock'},{at:times[1]/seconds,label:'back'}];
 return {bend,gesture,seconds,peak,marks};
}
