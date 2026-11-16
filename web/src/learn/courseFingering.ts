import type {TuningBundle} from "../catalogs/layoutsCatalog.ts";
import {resolveLessonKeys} from "./majorScale.ts";
import type {RollNote} from "./courseTimeline.ts";

// Translate each layout's whole pattern by one shared board displacement.
// A note that falls off the board loses its button, but keeps finger advice.
export function translateCopiedFingerings(source:RollNote[],placed:RollNote[],from:TuningBundle,to:TuningBundle):RollNote[]{
  const result=placed.map(note=>({...note,cues:Object.fromEntries(Object.entries(note.cues??{}).map(([id,cue])=>[id,{...cue,note:note.pitch}]))}));
  for(const id of new Set(source.flatMap(note=>Object.keys(note.cues??{})))){
    const oldLayout=from.layouts.find(layout=>layout.objectIdHex===id),layout=to.layouts.find(layout=>layout.objectIdHex===id);
    if(!oldLayout||!layout){for(const note of result)delete note.cues[id];continue;}
    const oldKeys=resolveLessonKeys({id,label:oldLayout.name,bundle:from,layout:oldLayout});
    const keys=resolveLessonKeys({id,label:layout.name,bundle:to,layout});
    const assigned=source.flatMap((note,i)=>{const button=note.cues?.[id]?.button;return button===undefined?[]:[{i,key:oldKeys[button]?.key}];}).filter(item=>item.key);
    const offsets=new Map<string,{x:number;y:number}>();
    for(const {i,key} of assigned)for(const target of keys)if(target.note===placed[i].pitch){const x=target.key.coordCol-key.coordCol,y=target.key.row-key.row;offsets.set(`${x}:${y}`,{x,y});}
    const match=(i:number,key:typeof keys[number]["key"],offset:{x:number;y:number})=>keys.find(target=>target.key.coordCol===key.coordCol+offset.x&&target.key.row===key.row+offset.y&&target.note===placed[i].pitch);
    const best=[...offsets.values()].sort((a,b)=>assigned.filter(({i,key})=>match(i,key,b)).length-assigned.filter(({i,key})=>match(i,key,a)).length||(a.x*a.x+3*a.y*a.y)-(b.x*b.x+3*b.y*b.y)||a.y-b.y||a.x-b.x)[0];
    for(const {i,key} of assigned){const cue=result[i].cues[id],target=best&&match(i,key,best);if(target)cue.button=target.key.index;else{delete cue.button;delete cue.acceptDuplicates;}}
  }
  return result;
}
