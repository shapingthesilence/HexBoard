export const sampleRate=16000,maxSampleFrames=64000;
export function prepareSamplePCM(input:Float32Array,normalize=true,fadeInMs=2,fadeOutMs=2):number[]{
 if(![fadeInMs,fadeOutMs].every(v=>Number.isFinite(v)&&v>=0))throw Error('Fade times must be zero or positive.');
 if(!input.length||input.length>maxSampleFrames||input.some(v=>!Number.isFinite(v)))throw Error('Trim to 4 seconds or less.');
 const mean=input.reduce((a,b)=>a+b,0)/input.length;
 let peak=0;for(const v of input)peak=Math.max(peak,Math.abs(v-mean));
 if(peak<.00001)throw Error('This selection is silent. Choose another region.');
 const gain=normalize?.85/peak:Math.min(1,.98/peak);
 const fadeIn=Math.min(input.length-1,Math.round(fadeInMs*sampleRate/1000)),fadeOut=Math.min(input.length-1,Math.round(fadeOutMs*sampleRate/1000));
 return Array.from(input,(v,i)=>Math.round(Math.max(-1,Math.min(.999969,(v-mean)*gain*Math.min(1,fadeIn?i/fadeIn:1,fadeOut?(input.length-1-i)/fadeOut:1)))*32768)||0);
}
export function waveformPath(samples:ArrayLike<number>,width=560,height=100){
 const points=280,result:string[]=[];for(let x=0;x<points;++x){const begin=Math.floor(x*samples.length/points),end=Math.max(begin+1,Math.floor((x+1)*samples.length/points));let lo=0,hi=0;for(let i=begin;i<Math.min(end,samples.length);++i){lo=Math.min(lo,samples[i]);hi=Math.max(hi,samples[i]);}result.push(`M${(x*width/(points-1)).toFixed(1)},${(height/2-lo*height*.45).toFixed(1)}V${(height/2-hi*height*.45).toFixed(1)}`);}return result.join('');
}

export function fadeEnvelopePath(start:number,end:number,duration:number,fadeInMs:number,fadeOutMs:number){
 if(!duration||end<=start)return '';
 const length=end-start,fi=Math.min(length,fadeInMs/1000),fo=Math.min(length,fadeOutMs/1000);
 const times=[0,fi,length-fo,length];if(fi+fo>length)times.push(length*fi/(fi+fo));
 return [...new Set(times)].sort((a,b)=>a-b).map((t,i)=>{const level=Math.min(1,fi?t/fi:1,fo?(length-t)/fo:1);return `${i?'L':'M'}${((start+t)/duration*560).toFixed(1)},${(92-84*level).toFixed(1)}`;}).join('');
}

// UI positions are seconds in the original recording; wire positions are PCM
// frames relative to the trimmed selection. End is exclusive.
export function sampleLoopFromSelection(mode:0|1|2,trimStart:number,loopStart:number,loopEnd:number,crossfadeMs:number,frames:number){
 if(!mode)return {mode:0 as const,start:0,end:0,crossfade:0};
 if(![trimStart,loopStart,loopEnd,crossfadeMs].every(Number.isFinite)||crossfadeMs<0)throw Error('Invalid loop region.');
 const start=Math.max(0,Math.min(frames,Math.round((loopStart-trimStart)*sampleRate))),end=Math.max(0,Math.min(frames,Math.round((loopEnd-trimStart)*sampleRate)));
 if(end-start<160)throw Error('Choose a loop of at least 10 ms.');
 let crossfade=Math.min(3200,Math.floor((end-start)/2),Math.round(crossfadeMs*sampleRate/1000));if(crossfade===1)crossfade=2;
 return {mode,start,end,crossfade};
}
