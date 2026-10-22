import {monoEnabled} from './mono.ts';
import {modulationUsage,routeDepth,type Routing} from './modulationBudget.ts';
import type {PhysicalPreset,FxRack} from './schema.ts';
export const dspCapacity=2873,dspDeadline=2902;
export const effectDspCost=(id:number)=>id===1?60:id===2?220:id===3?40:id===4?200:0;
export function dspUsage(p:PhysicalPreset){
 const mono=monoEnabled(p),routing=modulationUsage(p),bow=p.parameters[21]>32767;
 const enabled=(id:number)=>p.parameters[id]>0||Array.from({length:9},(_,s)=>routeDepth(p,id,s)).some(Boolean);
 const rack=p.effects.order.reduce((sum,id)=>sum+effectDspCost(id),p.effects.values[4][0]>0?80:0);
 const units=(mono?650:1250)+rack+(mono?1:3)*routing.units+(bow?(mono?100:350):p.sample.enabled&&p.sample.frames.length?(mono?200:730)+(p.sample.loop?.mode?40:0):0)+(enabled(26)?(mono?40:150):0)+(!bow&&enabled(29)?(mono?55:200):0)+(enabled(28)?(mono?20:60):0)+(p.parameters[8]>0?(mono?25:70):0);
 return {...routing,units,modulationUnits:routing.units,fits:units<=dspCapacity&&routing.connections<=32&&routing.targetsValid};
}
export function dspAllows(before:PhysicalPreset,after:PhysicalPreset){const a=dspUsage(before),b=dspUsage(after);return b.fits||(b.targetsValid&&b.units<=a.units&&b.connections<=a.connections);}
export function routePatch(p:PhysicalPreset,id:number,source:number,value:number):PhysicalPreset{return source<3?{...p,routes:p.routes.map((v,i)=>i===id*3+source?value:v)}:source<5?{...p,tiltRoutes:p.tiltRoutes.map((v,i)=>i===id*2+source-3?value:v)}:source>=7?{...p,controllerRoutes:(p.controllerRoutes??Array(66).fill(0)).map((v,i)=>i===id*2+source-7?value:v)}:{...p,modulation:{...p.modulation,routes:p.modulation.routes.map((v,i)=>i===id*2+source-5?value:v)}};}
export function dspRouteAllows(p:PhysicalPreset,id:number,source:number,value=1){return dspAllows(p,routePatch(p,id,source,value));}
export function dspSourceContribution(p:PhysicalPreset,source:number){let next=p;for(let id=0;id<33;++id)next=routePatch(next,id,source,0);return dspUsage(p).units-dspUsage(next).units;}
export const parameterPatch=(p:PhysicalPreset,id:number,value:number):PhysicalPreset=>({...p,parameters:p.parameters.map((v,i)=>i===id?value:v)});
export const rackPatch=(p:PhysicalPreset,effects:FxRack):PhysicalPreset=>({...p,effects});
