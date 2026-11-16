import {hexBoardGeometry} from '../../../catalogs/hexBoardGeometry.ts';
import type {Recording,Zone} from './prepare.mjs';
export interface Assignment {asset:number;color:string}
export type KeyMap=Record<number,Assignment>;
// Content geometry contains seven command keys. Advanced scanner IDs contain
// only the 133 playing keys, in alternating rows of nine and ten.
export const samplerKeys=hexBoardGeometry.filter(k=>k.role==='note').map((k,key)=>({...k,key}));
export const sampleColors=['#bb668e','#658eda','#dfad57','#63b899','#9979d4','#d37a55'];
export function assignSequentially(count:number):KeyMap{return Object.fromEntries(samplerKeys.slice(0,count).map((k,i)=>[k.key,{asset:i,color:sampleColors[i%sampleColors.length]}]));}
export function mappedZones(map:KeyMap,count:number,previous:Zone[]=[]):Zone[]{return Object.entries(map).filter(([key,a])=>samplerKeys.some(k=>k.key===+key)&&Number.isInteger(a.asset)&&a.asset>=0&&a.asset<count).map(([key,a])=>({...previous.find(z=>z.key===+key&&z.asset===a.asset),asset:a.asset,key:+key,lowMidi:0,highMidi:127,fixed:true,color:a.color}));}
export function removeRecording(map:KeyMap,index:number):KeyMap{return Object.fromEntries(Object.entries(map).filter(([,a])=>a.asset!==index).map(([k,a])=>[k,{...a,asset:a.asset>index?a.asset-1:a.asset}]));}
/** Next unassigned keys, in board order, for `count` new recordings starting at `firstAsset`. */
export function assignToFreeKeys(map:KeyMap,firstAsset:number,count:number):KeyMap{
 const free=samplerKeys.filter(k=>!map[k.key]).slice(0,count);
 return {...map,...Object.fromEntries(free.map((k,i)=>[k.key,{asset:firstAsset+i,color:sampleColors[(firstAsset+i)%sampleColors.length]}]))};
}
/** Equal-length slice starts across the retained audio. */
export function equalSlicePoints(source:Recording,count:number):number[]{
 const start=source.start??0,end=source.end??source.channels[0].length,length=end-start;
 if(!Number.isInteger(count)||count<2||count>64||length<count*4||start<0||end>source.channels[0].length)throw Error('Choose 2–64 slices with at least four retained frames each.');
 return Array.from({length:count},(_,i)=>start+Math.floor(i*length/count));
}
/**
 * Slice starts at percussive hits: frames where short-term energy jumps well
 * above the preceding level. Each start is moved back to the quietest frame
 * just before the hit so slices begin without a click. Always includes the
 * retained start; keeps the strongest hits when there are more than `max`.
 */
export function findHits(source:Recording,max=32,sensitivity=.5):number[]{
 const start=source.start??0,end=source.end??source.channels[0].length,hop=256,minGap=Math.round(source.rate*.06);
 const level:number[]=[];
 for(let at=start;at<end;at+=hop){let sum=0,n=0;for(let i=at;i<Math.min(end,at+hop);i++){let x=0;for(const c of source.channels)x+=c[i];x/=source.channels.length;sum+=x*x;n++;}level.push(Math.sqrt(sum/Math.max(1,n)));}
 const peak=Math.max(...level,1e-9),ratio=2.6-1.6*Math.max(0,Math.min(1,sensitivity)),floor=peak*(.12-.1*Math.max(0,Math.min(1,sensitivity)));
 const hits:{frame:number;strength:number}[]=[];
 for(let i=1;i<level.length;i++){
  const before=Math.max(level[i-1],(level[i-2]??0)*.8,peak*1e-3),strength=level[i]/before;
  if(level[i]<floor||strength<ratio)continue;
  let frame=start+i*hop,quiet=Infinity;
  for(let f=Math.max(start,frame-hop);f<frame;f++){const x=Math.abs(source.channels[0][f]);if(x<quiet){quiet=x;frame=f;}}
  const last=hits.at(-1);
  if(last&&frame-last.frame<minGap){if(strength>last.strength)hits[hits.length-1]={frame,strength};continue;}
  if(frame-start<minGap)continue;
  hits.push({frame,strength});
 }
 return [start,...hits.sort((a,b)=>b.strength-a.strength).slice(0,Math.max(0,max-1)).map(h=>h.frame).sort((a,b)=>a-b)];
}
/** Split the retained audio at `points` (frame starts, ascending). */
export function sliceAt(source:Recording,points:number[]):Recording[]{
 const end=source.end??source.channels[0].length,starts=[...new Set(points)].filter(p=>p>=0&&p<end).sort((a,b)=>a-b);
 if(starts.length<2)throw Error('Need at least two slices.');
 return starts.map((first,i)=>{const last=starts[i+1]??end;return {...source,id:`${source.id??source.name??'Recording'}:slice:${i}`,name:`${source.name??'Recording'} · ${i+1}`,channels:source.channels.map(c=>c.slice(first,last)),mode:2,start:0,end:last-first,loopStart:undefined,loopEnd:undefined,crossfade:0};});
}
export function sliceRecording(source:Recording,count:number):Recording[]{return sliceAt(source,equalSlicePoints(source,count));}
