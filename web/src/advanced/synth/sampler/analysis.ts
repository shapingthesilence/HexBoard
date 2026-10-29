import type { Recording } from './prepare.mjs';
import { crossfadeRecording, trimRecording } from './encode.mjs';
import { loopSeam } from './loopEditing.ts';
export const hzForMidi = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
export const midiForHz = (hz: number) => { if (!Number.isFinite(hz) || hz <= 0) throw Error('Frequency must be positive.'); return 69 + 12 * Math.log2(hz / 440); };
export const centsBetween = (a: number, b: number) => 1200 * Math.log2(a / b);
export interface PitchPoint { seconds: number; hz: number | null; confidence: number }
export interface PitchAnalysis { hz: number | null; confidence: number; spread: number; coverage: number; points: PitchPoint[]; warnings: string[] }
export interface LoopCandidate { style: 'Natural' | 'Compact' | 'Smooth'; start: number; end: number; crossfade: number; seam: number; analysis: PitchAnalysis; changeCents: number | null }
const decimators=new Map<number,Float64Array>();
const median = (values: number[]) => { const sorted = values.slice().sort((a,b)=>a-b); return sorted.length ? (sorted[Math.floor((sorted.length-1)/2)]+sorted[Math.ceil((sorted.length-1)/2)])/2 : 0; };
export function analysisChannel(a: Recording, start: number, end: number) {
  let best=a.channels[0], energy=-1;
  for(const c of a.channels){let sum=0; const step=Math.max(1,Math.floor((end-start)/4096)); for(let i=start;i<end;i+=step)sum+=c[i]*c[i]; if(sum>energy){best=c;energy=sum;}}
  return best; // Never sum anti-phase stereo into silence.
}
function estimate(source: Float32Array, rate: number, begin: number, end: number): {hz:number;confidence:number}|null {
  const stride=Math.max(1,Math.floor(rate/12000)), sr=rate/stride, count=Math.min(6144,Math.floor((end-begin)/stride));
  if(count<512)return null;
  const data=new Float64Array(count); let mean=0, power=0;
  // Bandlimit before decimation: ultrasonic content must not alias into a
  // plausible low fundamental. Analysis never changes source PCM.
  let kernel=decimators.get(stride);
  if(!kernel){const radius=stride===1?0:24*stride;kernel=new Float64Array(radius*2+1);let norm=0;for(let k=-radius;k<=radius;k++){const cutoff=.45/stride,x=2*cutoff*k;const sinc=x===0?1:Math.sin(Math.PI*x)/(Math.PI*x);const w=radius?.42+.5*Math.cos(Math.PI*k/radius)+.08*Math.cos(2*Math.PI*k/radius):1;kernel[k+radius]=sinc*w;norm+=kernel[k+radius];}for(let i=0;i<kernel.length;i++)kernel[i]/=norm;decimators.set(stride,kernel);}
  const radius=(kernel.length-1)/2;
  for(let n=0;n<count;n++){let v=0;for(let k=0;k<kernel.length;k++)v+=source[Math.max(0,Math.min(source.length-1,begin+n*stride+k-radius))]*kernel[k]; data[n]=v;mean+=v;}
  mean/=count;for(let n=0;n<count;n++){data[n]-=mean;power+=data[n]*data[n];}if(power/count<1e-9)return null;
  const max=Math.min(Math.floor(sr/30),Math.floor(count/3)), min=2, window=Math.min(2048,count-max), difference=new Float64Array(max+1);
  let sum=0, lag=0;
  for(let tau=1;tau<=max;tau++){let d=0;for(let n=0;n<window;n++){const x=data[n]-data[n+tau];d+=x*x;}sum+=d;difference[tau]=sum?d*tau/sum:1;}
  // First sufficiently periodic trough avoids choosing a long multiple of the fundamental.
  for(let tau=min;tau<max;tau++)if(difference[tau]<.16){while(tau+1<=max&&difference[tau+1]<difference[tau])tau++;lag=tau;break;}
  if(!lag||difference[lag]>.16)return null;
  const l=difference[lag-1],c=difference[lag],r=difference[lag+1]??c, denominator=l-2*c+r;
  let period=lag+(denominator?Math.max(-.5,Math.min(.5,.5*(l-r)/denominator)):0);
  // Refine using many periods: fractional-lag error is divided across cycles.
  const cycles=Math.max(1,Math.min(24,Math.floor(count/(period*3)))), target=period*cycles;
  const correlation=(shift:number)=>{let xy=0,xx=0,yy=0;const n=Math.min(4096,count-Math.ceil(target)-4);for(let i=0;i<n;i++){const x=data[i],y=data[i+shift];xy+=x*y;xx+=x*x;yy+=y*y;}return xy/Math.sqrt(xx*yy+1e-30);};
  const center=Math.round(target);let best=center, value=-2;for(let t=center-2;t<=center+2;t++)if(t>0&&t<count-4){const v=correlation(t);if(v>value){value=v;best=t;}}
  const a=correlation(best-1),b=correlation(best),d=correlation(best+1),den=a-2*b+d;
  if(den<0)period=(best+Math.max(-.5,Math.min(.5,.5*(a-d)/den)))/cycles;
  const hz=sr/period, confidence=Math.max(0,Math.min(1,Math.min(1-difference[lag],value)));
  return hz>=30&&hz<=2500&&confidence>=.8?{hz,confidence}:null;
}
export function analyzePitch(a: Recording, start=a.start??0, end=a.end??a.channels[0].length, maxPoints=32):PitchAnalysis {
  if(!Number.isFinite(a.rate)||a.rate<100||!a.channels.length||a.channels.some(c=>c.length!==a.channels[0].length))throw Error('Invalid recording.');
  start=Math.max(0,Math.floor(start));end=Math.min(a.channels[0].length,Math.floor(end));if(end<=start)throw Error('Select a nonempty analysis region.');
  const source=analysisChannel(a,start,end), size=Math.min(end-start,Math.floor(a.rate*.45)), frames=Math.max(1,Math.min(maxPoints,Math.ceil((end-start)/(a.rate*.12)))), points:PitchPoint[]=[];
  for(let i=0;i<frames;i++){const from=Math.round(start+(end-start-size)*(frames===1?0:i/(frames-1))), p=estimate(source,a.rate,from,from+size);points.push({seconds:(from+size/2)/a.rate,hz:p?.hz??null,confidence:p?.confidence??0});}
  const reliable=points.filter(p=>p.hz!==null), hz=reliable.length?2**median(reliable.map(p=>Math.log2(p.hz!))):null, deviations=hz?reliable.map(p=>centsBetween(p.hz!,hz)):[],spread=deviations.length?Math.max(...deviations)-Math.min(...deviations):0, coverage=reliable.length/points.length;
  const warnings:string[]=[];if(coverage<.7)warnings.push('Uncertain pitch: noise, attacks, short recordings or multiple simultaneous pitches may prevent a reliable anchor.');if(spread>8)warnings.push('Pitch varies through this selection. Vibrato, drift or ensemble beating may be intentional.');
  return {hz,confidence:median(reliable.map(p=>p.confidence))*coverage,spread,coverage,points,warnings};
}
export function verifyLoop(a:Recording):PitchAnalysis {
  const rendered=crossfadeRecording(trimRecording(a)), start=rendered.loopStart??0,end=rendered.loopEnd??rendered.channels[0].length,length=end-start;
  if(length<1||![1,3].includes(rendered.mode??0))throw Error('Choose a valid sustain loop.');
  const size=Math.max(Math.ceil(rendered.rate*.9),length*2);
  // Bound verification memory even for minute-long source selections.
  const count=Math.min(size,Math.ceil(rendered.rate*2));
  const channels=rendered.channels.map(c=>Float32Array.from({length:count},(_,i)=>c[start+i%length]));
  return analyzePitch({...rendered,channels,start:0,end:count},0,count,8);
}
export function suggestLoops(a:Recording,start:number,end:number,analysis=analyzePitch(a,start,end)):LoopCandidate[]{
  if(!analysis.hz||analysis.confidence<.7||analysis.spread>25||end-start<a.rate*.12)return [];
  const period=a.rate/analysis.hz, available=end-start, result:LoopCandidate[]=[];
  for(const [style,fraction] of [['Natural',.75],['Compact',.18],['Smooth',.45]] as const){
    const power=(from:number,to:number)=>{let energy=0;for(const channel of a.channels)for(let n=0;n<127;n++){const v=channel[Math.min(channel.length-1,Math.floor(from+(to-from)*n/127))];energy+=v*v;}return energy/(127*a.channels.length);};
    const minimumPower=Math.max(1e-9,power(start,end)*.1);
    const cycles=Math.max(4,Math.floor(Math.min(available*.85,a.rate*2)*fraction/period)),length=Math.round(cycles*period);if(length>=available||length<4)continue;
    let bestStart=start,best=Infinity;
    for(let i=0;i<40;i++){const base=Math.round(start+(available-length)*i/39);for(let d=-2;d<=2;d++){const from=base+d;if(from<start||from+length>end||power(from,from+length)<minimumPower)continue;const seam=loopSeam(a,from,from+length), score=seam.score+seam.slope**2;if(score<best){best=score;bestStart=from;}}}
    if(!Number.isFinite(best))continue;
    const fade=style==='Smooth'?Math.min(12,length/a.rate*1000/12):0, recording={...a,mode:1 as const,loopStart:bestStart,loopEnd:bestStart+length,crossfade:fade}, verified=verifyLoop(recording);
    result.push({style,start:bestStart,end:bestStart+length,crossfade:fade,seam:Math.sqrt(best),analysis:verified,changeCents:verified.hz?centsBetween(verified.hz,analysis.hz):null});
  }return result;
}
export function retuneRecording(a:Recording,measured:number,target:number):Recording {
  if(!Number.isFinite(measured)||measured<=0||!Number.isFinite(target)||target<=0)throw Error('Choose positive measured and target pitches.');
  if(Math.abs(centsBetween(target,measured))>1200)throw Error('For corrections beyond one octave, set the tuning anchor instead.');
  // A sample-rate correction is exact, lossless metadata. Playback/export use
  // their existing bandlimited resamplers; original PCM and loop frames survive.
  return {...a,rate:a.rate*target/measured,rootMidi:midiForHz(target)};
}
