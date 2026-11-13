import {P,option,optionValue,type WavetablePatch} from './wavetableSchema.ts';
export interface TuningGrid{revision:number;count:number;root:number;period:number;pitches:number[]}
export const defaultTuning:TuningGrid={revision:0,count:12,root:Math.log2(440),period:1,pitches:Array.from({length:12},(_,i)=>i/12)};
export const bipolar=(v:number)=>Math.max(-1,Math.min(1,(v-32768)/32767));
export const intervalValue=(offset:number,range:number)=>Math.round(32768+Math.max(-1,Math.min(1,offset/range))*32767);
export function gridPosition(grid:TuningGrid,pitch:number){
 const cycle=Math.floor((pitch-grid.root)/grid.period),base=grid.root+cycle*grid.period,x=pitch-base;
 let lo=0,hi=grid.count;while(lo+1<hi){const mid=(lo+hi)>>1;if(grid.pitches[mid]<=x)lo=mid;else hi=mid;}
 const low=base+grid.pitches[lo],high=base+(lo+1<grid.count?grid.pitches[lo+1]:grid.period);
 return {low,high,fraction:Math.max(0,Math.min(1,(pitch-low)/(high-low))),degree:lo,cycle};
}
export function gridOffset(grid:TuningGrid,pitch:number,steps:number){
 if(!steps)return pitch;const p=gridPosition(grid,pitch),relative=p.fraction+steps,shift=Math.floor(relative),index=p.degree+shift;
 const cycle=Math.floor(index/grid.count),degree=((index%grid.count)+grid.count)%grid.count;
 const a=grid.pitches[degree],b=degree+1<grid.count?grid.pitches[degree+1]:grid.period;
 return grid.root+(p.cycle+cycle)*grid.period+a+(relative-shift)*(b-a);
}
export function intervalPitch(grid:TuningGrid,root:number,mode:number,amount:number,num:number,den:number){
 return mode===2?gridOffset(grid,root,Math.round(32*bipolar(amount))):root+(mode===3?Math.round(2*bipolar(amount))*grid.period:2*bipolar(amount)+(mode===1?Math.log2(num/den):0));
}
export function intervalDescription(mode:number,value:number){const v=bipolar(value);return mode===2?`${Math.round(v*32)>0?'+':''}${Math.round(v*32)} steps`:mode===3?`${Math.round(v*2)>0?'+':''}${Math.round(v*2)} periods`:`${v>0?'+':''}${(v*2400).toFixed(0)}¢`;}
export function ratioText(n:number,d:number){return d===1?String(n):`${n}/${d}`;}
export function parseRatio(text:string):[number,number]|undefined{
 const parts=text.trim().split(/[/:]/);if(parts.length>2)return;
 const a=Number(parts[0]),b=parts.length===2?Number(parts[1]):1,value=a/b;
 if(!Number.isFinite(value)||a<=0||b<=0||value<1/32||value>32)return;
 if(parts.length===2&&Number.isInteger(a)&&Number.isInteger(b)&&a<=65535&&b<=65535)return [a,b];
 let x=value,h0=0,h1=1,k0=1,k1=0;
 for(let i=0;i<20;++i){const q=Math.floor(x),h=q*h1+h0,k=q*k1+k0;if(h>65535||k>65535)break;h0=h1;h1=h;k0=k1;k1=k;if(Math.abs(h/k-value)<1e-8)break;x=1/(x-q);if(!Number.isFinite(x))break;}
 return h1>0&&k1>0?[h1,k1]:undefined;
}
export function bodyPartials(p:WavetablePatch):number[][]{
 const mode=option(P.Resonator,p.parameters[P.Resonator]);
 if(mode===3)return Array.from({length:4},(_,j)=>p.parameters.slice(P.Partial1Mode+j*7,P.Partial1Mode+j*7+7));
 const wood=mode===2,nums=wood?[1,498,1067,20]:[1,689,1351,8933],dens=wood?[1,125,100,1]:[1,250,250,1000];
 const levels=wood?[.38,.32,.2,.1]:[.3,.35,.22,.13],decays=wood?[1,.35,.16,.09]:[1,.7,.45,.28],pans=[-.15,.31,-.47,.63];
 return nums.map((n,j)=>[optionValue(P.Partial1Mode,1),32768,n,dens[j],Math.round(levels[j]*65535),Math.round(decays[j]*65535),Math.round((pans[j]+1)*.5*65535)]);
}
export function customBody<T extends WavetablePatch>(p:T):T{
 const parameters=[...p.parameters];bodyPartials(p).forEach((part,j)=>parameters.splice(P.Partial1Mode+j*7,7,...part));parameters[P.Resonator]=optionValue(P.Resonator,3);return {...p,parameters};
}
export function bodyLines(p:WavetablePatch,grid:TuningGrid){
 const amount=p.parameters[P.NaturalTuned]/65535,position=3*p.parameters[P.ResonatorTune]/65535,movement=option(P.BodyMotion,p.parameters[P.BodyMotion]);
 const carrier=intervalPitch(grid,grid.root,option(P.CarrierPitchMode,p.parameters[P.CarrierPitchMode]),p.parameters[P.Coarse],p.parameters[P.CarrierRatioNum],p.parameters[P.CarrierRatioDen])+bipolar(p.parameters[P.Fine])/12;
 return bodyPartials(p).flatMap((part,j)=>{
  const base=intervalPitch(grid,carrier,option(P.Partial1Mode,part[0]),part[1],part[2],part[3]),near=gridPosition(grid,base),aligned=base+amount*((near.fraction<.5?near.low:near.high)-base);
  let pitch=(movement===0||movement===3?aligned:base)+(movement===3?0:position*grid.period),level=part[4]/65535;
  if(movement===3)level*=.12+1.4*Math.exp(-.8*(j-position)**2);
  const point=gridPosition(grid,pitch);
  if(movement===1)pitch+=amount*((point.fraction<.5?point.low:point.high)-pitch);
  if(movement===2)return [{ratio:2**(pitch+amount*(point.low-pitch)-grid.root),level:level*(1-point.fraction)},{ratio:2**(pitch+amount*(point.high-pitch)-grid.root),level:level*point.fraction}];
  return [{ratio:2**(pitch-grid.root),level}];
 });
}

export function unisonPitches(p:WavetablePatch,grid:TuningGrid,values:number[]){
 const copies=option(P.Unison,p.parameters[P.Unison])+1,mode=option(P.UnisonMode,p.parameters[P.UnisonMode]);
 const carrier=intervalPitch(grid,grid.root,option(P.CarrierPitchMode,p.parameters[P.CarrierPitchMode]),values[P.Coarse]*65535,p.parameters[P.CarrierRatioNum],p.parameters[P.CarrierRatioDen])+bipolar(values[P.Fine]*65535)/12;
 const base=2**carrier,stack=intervalPitch(grid,carrier,option(P.StackPitchMode,p.parameters[P.StackPitchMode]),values[P.StackInterval]*65535,p.parameters[P.StackRatioNum],p.parameters[P.StackRatioDen]);
 const frequencies=Array.from({length:copies},(_,c)=>{
  if(mode===1)return Math.max(.25,Math.min(18000,base+(c-(copies-1)/2)*8*values[P.BeatRate]**2));
  if(mode===2){const offset=c?Math.ceil(c/2)*(c%2?1:-1):0;return 2**Math.max(-2,Math.min(Math.log2(18000),option(P.StackPitchMode,p.parameters[P.StackPitchMode])===2?gridOffset(grid,carrier,offset*Math.round(32*bipolar(values[P.StackInterval]*65535))):carrier+offset*(stack-carrier)));}
  return base*2**((copies===1?0:2*c/(copies-1)-1)*values[P.Detune]*50/1200);
 });
 return {base,frequencies};
}
