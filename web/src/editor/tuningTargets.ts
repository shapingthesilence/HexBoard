import { useSyncExternalStore } from 'react';
export interface TuningTarget {name:string;hz:number}
let targets: TuningTarget[]=[];
const listeners=new Set<()=>void>();
export function publishTuningTargets(next:TuningTarget[]){
 if(JSON.stringify(targets)===JSON.stringify(next))return;
 targets=next.filter(t=>Number.isFinite(t.hz)&&t.hz>0&&t.hz<=22000);for(const listener of listeners)listener();
}
export function useTuningTargets(){return useSyncExternalStore(listener=>{listeners.add(listener);return()=>{listeners.delete(listener);};},()=>targets,()=>targets);}
