import recordings from './attack-samples/factory-attacks.json';
import {prepareSamplePCM,sampleChecksum} from './sampleEditing.ts';
export {sampleChecksum};
export const attackRate=16000,maxAttackFrames=4096;
export interface AttackSample{name:string;frames:number[]}
export function validateAttack(value:unknown):AttackSample|undefined{
 if(value===undefined)return undefined;const a=value as AttackSample;
 if(!a||typeof a.name!=='string'||!a.name.trim()||a.name.length>80||!Array.isArray(a.frames)||a.frames.length<80||a.frames.length>maxAttackFrames||a.frames.some(v=>!Number.isInteger(v)||v<-32768||v>32767))throw Error('Use a mono attack sample between 5 and 256 ms.');
 return {name:a.name.trim(),frames:[...a.frames]};
}
export const attackRootHz=(word:number)=>20*100**(word/65535);
export const attackRootWord=(hz:number)=>Math.round(Math.log(Math.max(20,Math.min(2000,hz))/20)/Math.log(100)*65535);
function texture(name:string,kind:number):AttackSample{
 let random=0x6d2b79f5,low=0;const n=kind===2?4096:2048;
 const pcm=Float32Array.from({length:n},(_,i)=>{random^=random<<13;random^=random>>>17;random^=random<<5;const noise=(random|0)/2147483648,t=i/attackRate;low+=.09*(noise-low);
  return kind===0?(noise-low)*Math.exp(-t/ .018)*(i%83<11?.9:.15):kind===1?Math.round(noise*4)/4*Math.exp(-t/.032)*Math.sin(2*Math.PI*1370*t):(.6*Math.sin(2*Math.PI*(550*t+3000*t*t))+.4*noise)*(i/n)**2;
 });
 return {name,frames:prepareSamplePCM(pcm,true,kind===2?20:1,4)};
}
export const factoryAttackSamples=[texture('Paper grain',0),texture('Digital grit',1),texture('Reverse shimmer',2),...recordings.map(({name,frames})=>({name,frames}))];
