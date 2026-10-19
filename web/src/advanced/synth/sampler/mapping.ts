import {hexBoardGeometry} from '../../../catalogs/hexBoardGeometry.ts';
import type {Recording,Zone} from './prepare.mjs';
export interface Assignment {asset:number;color:string}
export type KeyMap=Record<number,Assignment>;
// Content geometry contains seven command keys. Advanced scanner IDs contain
// only the 133 playing keys, in alternating rows of nine and ten.
export const samplerKeys=hexBoardGeometry.filter(k=>k.role==='note').map((k,key)=>({...k,key}));
export const sampleColors=['#bb668e','#658eda','#dfad57','#63b899','#9979d4','#d37a55'];
export function assignSequentially(count:number):KeyMap{return Object.fromEntries(samplerKeys.slice(0,count).map((k,i)=>[k.key,{asset:i,color:sampleColors[i%sampleColors.length]}]));}
export function mappedZones(map:KeyMap,count:number):Zone[]{return Object.entries(map).filter(([key,a])=>samplerKeys.some(k=>k.key===+key)&&Number.isInteger(a.asset)&&a.asset>=0&&a.asset<count).map(([key,a])=>({asset:a.asset,key:+key,lowMidi:0,highMidi:127,fixed:true,color:a.color}));}
export function removeRecording(map:KeyMap,index:number):KeyMap{return Object.fromEntries(Object.entries(map).filter(([,a])=>a.asset!==index).map(([k,a])=>[k,{...a,asset:a.asset>index?a.asset-1:a.asset}]));}
export function sliceRecording(source:Recording,count:number):Recording[]{
 if(!Number.isInteger(count)||count<2||count>64||source.channels[0].length<count*4)throw Error('Choose 2–64 slices with at least four frames each.');
 return Array.from({length:count},(_,i)=>{const start=Math.floor(i*source.channels[0].length/count),end=Math.floor((i+1)*source.channels[0].length/count);return {...source,name:`${source.name??'Recording'} · ${i+1}`,channels:source.channels.map(c=>c.slice(start,end)),mode:2};});
}
