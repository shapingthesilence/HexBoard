import type {Recording} from './prepare.mjs';
import {hzForMidi} from './analysis.ts';
import {loopSeam, recordingBounds, matchLoop} from './loopEditing.ts';
export type Selection = [number, number];
export type ChannelChoice = 'linked' | 0 | 1;
export function selectionBounds(a: Recording, selection: Selection): Selection {
  const b = recordingBounds(a);
  const start = Math.max(b.start, Math.min(b.end - 1, Math.floor(selection[0])));
  return [start, Math.max(start + 1, Math.min(b.end, Math.ceil(selection[1])))];
}
export function editPCM(a: Recording, selection: Selection, operation: 'dc'|'normalize'|'smooth'|'scale', channel: ChannelChoice = 'linked', amount = 1): Partial<Recording> {
  const [start,end] = selectionBounds(a,selection);
  let sharedPeak=0;for(const [i,c] of a.channels.entries())if(channel==='linked'||channel===i)for(let n=start;n<end;n++)sharedPeak=Math.max(sharedPeak,Math.abs(c[n]));
  const channels = a.channels.map((c,i) => {
    if(channel !== 'linked' && channel !== i) return c;
    const out = c.slice(); let mean=0,peak=0;
    for(let n=start;n<end;n++){mean+=c[n];peak=Math.max(peak,Math.abs(c[n]));} mean/=end-start;
    for(let n=start;n<end;n++) out[n]=Math.max(-1,Math.min(1,operation==='dc'?c[n]-mean:operation==='normalize'?c[n]*(sharedPeak?.95/sharedPeak:1):operation==='scale'?c[n]*amount:(c[Math.max(start,n-1)]+2*c[n]+c[Math.min(end-1,n+1)])/4));
    return out;
  });
  return {channels};
}
export function drawPCM(a: Recording, from: number, to: number, fromValue: number, toValue: number, channel: ChannelChoice): Partial<Recording> {
  const lo=Math.max(0,Math.min(from,to)),hi=Math.min(a.channels[0].length-1,Math.max(from,to));
  return {channels:a.channels.map((c,i)=>{if(channel!=='linked'&&channel!==i)return c;const out=c.slice();for(let n=lo;n<=hi;n++){const t=from===to?1:(n-from)/(to-from);out[n]=Math.max(-1,Math.min(1,fromValue+(toValue-fromValue)*t));}return out;})};
}
export function tinyLoop(a: Recording, selection: Selection, cycles: number): Partial<Recording> {
  if(![1,2,4,8].includes(cycles))throw Error('Choose 1, 2, 4 or 8 cycles.');
  const [start,end]=selectionBounds(a,selection),length=Math.round(cycles*a.rate/hzForMidi(a.rootMidi));
  if(length<4||length>end-start)throw Error('The selected source is too short for this pitch and cycle count. Select more source or set its original pitch.');
  let referencePower=0;for(const c of a.channels)for(let i=0;i<128;i++)referencePower+=c[start+Math.floor((end-start-1)*i/127)]**2;referencePower/=128;
  let best=start,score=Infinity;const step=Math.max(1,Math.ceil((end-start-length)/2048));
  for(let n=start;n+length<=end;n+=step){const s=loopSeam(a,n,n+length);let energy=0;for(const c of a.channels)for(let i=0;i<16;i++)energy+=c[n+Math.floor((length-1)*i/15)]**2;if(energy/16<Math.max(1e-9,referencePower*.1))continue;const value=(s.score+s.slope*s.slope)/energy;if(value<score){score=value;best=n;}}
  if(!Number.isFinite(score))throw Error('The selection is silent. Choose an audible section.');
  return {mode:1,loopStart:best,loopEnd:best+length,crossfade:0};
}
export function joinEnds(a: Recording, kind: 'move'|'smooth', channel: ChannelChoice='linked'): Partial<Recording> {
  if(kind==='move')return matchLoop(a,true,'loopStart');
  const {loopStart:s,loopEnd:e}=recordingBounds(a),width=Math.max(1,Math.min(16,Math.floor((e-s)/8)));
  return {channels:a.channels.map((c,i)=>{if(channel!=='linked'&&channel!==i)return c;const out=c.slice(),slope=c[Math.min(e-1,s+1)]-c[s];for(let n=0;n<width;n++){const t=1-n/width,target=c[s]-(n+1)*slope;out[e-1-n]=c[e-1-n]*(1-t)+target*t;}return out;})};
}
export function retainedPCM(a:Recording, keepAttack:boolean):Partial<Recording>{const b=recordingBounds(a);if(![1,3].includes(a.mode??0))throw Error('Create a loop first.');return {start:keepAttack?b.start:b.loopStart,end:b.loopEnd,mode:1};}
export function pcmBytes(a:Recording){return ((a.end??a.channels[0].length)-(a.start??0))*a.channels.length*2;}

/** Offline rate reduction for targets that retain a native recording rate.
 * Blackman-windowed sinc pruning leaves a 20% transition below new Nyquist.
 * A loop's integer length determines the exact rate, preserving its cycles. */
export function reduceSampleRate(a:Recording,requestedRate:number):Partial<Recording>{
 if(!Number.isFinite(requestedRate)||requestedRate<4000||requestedRate>=a.rate)throw Error('Choose a lower sample rate of at least 4 kHz.');
 const b=recordingBounds(a),looped=[1,3].includes(a.mode??0),oldLoop=b.loopEnd-b.loopStart;
 const loopLength=looped?Math.round(oldLoop*requestedRate/a.rate):0;
 if(looped&&loopLength<4)throw Error('This loop needs a higher sample rate to retain at least four frames.');
 const ratio=looped?loopLength/oldLoop:requestedRate/a.rate,actualRate=a.rate*ratio;
 const convert=(data:Float32Array,count:number,periodic:boolean)=>{
  const out=new Float32Array(count),half=Math.min(512,Math.ceil(32/ratio)),cutoff=.4*ratio;
  for(let n=0;n<count;n++){const position=n/ratio,center=Math.floor(position);let sum=0,norm=0;
   for(let k=center-half;k<=center+half;k++){const d=k-position,window=Math.abs(d)>half?0:.42+.5*Math.cos(Math.PI*d/half)+.08*Math.cos(2*Math.PI*d/half),x=2*cutoff*d,weight=(Math.abs(x)<1e-12?1:Math.sin(Math.PI*x)/(Math.PI*x))*window;norm+=weight;sum+=(periodic?data[((k%data.length)+data.length)%data.length]:(k>=0&&k<data.length?data[k]:0))*weight;}
   out[n]=sum/Math.max(1e-12,norm);
  }return out;
 };
 const source=a.channels.map(c=>c.subarray(b.start,b.end)),length=Math.round((b.end-b.start)*ratio);
 if(length<4)throw Error('The recording is too short for this sample rate.');
 const loopStart=looped?Math.round((b.loopStart-b.start)*ratio):0,loopEnd=looped?loopStart+loopLength:0;
 const channels=source.map((c,i)=>{let out=convert(c,Math.max(length,loopEnd),false);if(looped){const loop=convert(a.channels[i].subarray(b.loopStart,b.loopEnd),loopLength,true);out.set(loop,loopStart);}return out;});
 return {channels,rate:actualRate,start:0,end:channels[0].length,loopStart,loopEnd};
}
