import type {Patch,Zone} from './prepare.mjs';
import {verifyLoop,centsBetween} from './analysis.ts';
/** Compare actual rendered/repeated source and device loops, at the same zone
 * pitch. Root compensation matters: raw loop Hz alone is not playback tuning. */
export function verifyPreparedTuning(source:Patch,converted:Patch):string[]{
 const srcZones:Zone[]=source.zones??source.assets.map((_,asset)=>({asset})); const dstZones:Zone[]=converted.zones??converted.assets.map((_,asset)=>({asset}));
 const cache=new Map<unknown,ReturnType<typeof verifyLoop>>();
 const measure=(a:Patch['assets'][number])=>{let p=cache.get(a);if(!p){const {channels,...metadata}=a;p=verifyLoop({...metadata,channels});cache.set(a,p);}return p;};
 let worst=0,checked=0,uncertain=0;const uncertainNames=new Set<string>(), outOfRangeNames=new Set<string>();const seen=new Set<string>();
 for(const z of dstZones){
  const note=((z.lowMidi??-.5)+(z.highMidi??127.5))/2, velocity=((z.velocityLow??1)+(z.velocityHigh??127))/2;
  const original=srcZones.find(s=>note>=(s.lowMidi??-.5)&&note<(s.highMidi??127.5)&&velocity>=(s.velocityLow??1)&&velocity<=(s.velocityHigh??127)&&(s.key===undefined||s.key===65535||s.key===z.key)&&(s.roundRobin??0)===(z.roundRobin??0));
  if(!original)continue;const a=source.assets[original.asset],b=converted.assets[z.asset];if(!a||!b||![1,3].includes(a.mode??0)||![1,3].includes(b.mode??0))continue;
  const id=`${original.asset}:${z.asset}:${note}`;if(seen.has(id))continue;seen.add(id);
  const before=measure(a);if(!before.hz||before.confidence<.7||before.spread>25){uncertain++;uncertainNames.add(a.name ?? `Recording ${original.asset+1}`);continue;}
  // High/low protected copies can lie outside the detector range even though
  // their played note is audible. Do not mistake an octave/subharmonic for f0.
  const sourceSteps=(original.fixed?0:note-a.rootMidi)*(original.keyTrack??1), destinationSteps=(z.fixed?0:note-b.rootMidi)*(z.keyTrack??1);
  const expected=before.hz*2**((sourceSteps-destinationSteps)/12);
  if(expected<30||expected>2500){uncertain++;outOfRangeNames.add(a.name ?? `Recording ${original.asset+1}`);continue;}
  const after=measure(b);if(!after.hz||after.confidence<.7||after.spread>25){uncertain++;uncertainNames.add(a.name ?? `Recording ${original.asset+1}`);continue;}
  const at=(hz:number,asset:typeof a,zone:typeof z)=>hz*2**((zone.fixed?0:note-asset.rootMidi)*(zone.keyTrack??1)/12);
  worst=Math.max(worst,Math.abs(centsBetween(at(after.hz,b,z),at(before.hz,a,original))));checked++;
 }
 return [...(checked?[`Measured ${checked} converted loop region(s): largest estimated tuning change ${worst.toFixed(3)} cents.${worst>1?' Compare converted audition and review the tuning anchor.':''}`]:[]),...(uncertain?[`${uncertain} loop region(s) could not be verified; automatic tuning was not applied.${outOfRangeNames.size ? ` Outside the detector range: ${[...outOfRangeNames].join(", ")}.` : ""}${uncertainNames.size ? ` Uncertain pitch: ${[...uncertainNames].join(", ")}.` : ""} Inspect these loops or compare the converted sound.`]:[])];
}
