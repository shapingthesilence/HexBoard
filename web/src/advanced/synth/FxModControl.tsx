import {useState} from 'react';
import {Knob,sourceColors,sourceShortNames} from './SynthControls.tsx';
import {effectDescription,effectTypes,physicalSources,fxRow,fxSourceIds,fxTargetIds,type FxRack} from './schema.ts';
import {fxRouteDepth,fxRoutePatch} from './fxRouting.ts';
export interface FxTargeting {tool:'value'|'modulate'|'delete';source:number;values:number[];finish:()=>void;focus?:()=>void}
export function FxModControl({rack,id,param,label,busy,onChange,targeting,canApply,onPreview}:{rack:FxRack;id:number;param:number;label:string;busy:boolean;onChange:(rack:FxRack)=>void;targeting?:FxTargeting;canApply:(rack:FxRack)=>boolean;onPreview?:(rack?:FxRack)=>void}){
 const [deleting,setDeleting]=useState(false),row=fxRow(id),destination=row*4+param;
 const fullLabel=`${effectTypes[id-1].name} ${label}`;
 const source=targeting?.source??-1,assigning=targeting?.tool==='modulate',modulatable=fxSourceIds.includes(source)&&fxTargetIds.includes(destination);
 const depth=fxRouteDepth(rack,destination,source),base=rack.values[row][param];
 const routes=fxSourceIds.map(i=>({i,label:physicalSources[i],depth:fxRouteDepth(rack,destination,i),bipolar:[3,4,6,7].includes(i)})).filter(r=>r.depth);
 const candidate=fxRoutePatch(rack,destination,source,depth||1),full=routes.length>=4&&!depth;
 const blocked=assigning&&(!modulatable||full||!canApply(candidate));
 const hint=assigning&&!modulatable?'FX use global sources: tilt, LFO, joystick or expression':full?'4 sources on this target · remove one to add another':blocked?'DSP budget full · reduce another feature':undefined;
 const preview=()=>{targeting?.focus?.();if(assigning&&modulatable)onPreview?.(candidate);};
 let effective=base/65535;for(const route of routes)effective+=route.depth/65536*(targeting?.values[route.i]??0);effective=Math.max(0,Math.min(1,effective));
 return <div className="physical-control" data-modulatable={modulatable||undefined} data-route-full={blocked||undefined} data-unavailable={assigning&&!modulatable||undefined} title={hint} onPointerEnter={preview} onFocusCapture={preview} onPointerLeave={()=>onPreview?.()} onBlurCapture={()=>onPreview?.()}>
  <strong>{label}</strong><div className="knob-wrap" onClick={()=>{if(targeting?.tool==='delete')setDeleting(!deleting);}}>
  <Knob key={assigning?`route-${source}`:'value'} label={assigning&&modulatable?`${physicalSources[source]} to ${fullLabel}`:fullLabel} value={assigning&&modulatable?depth:base} min={assigning&&modulatable?-65536:0} max={assigning&&modulatable?65536:65535} baseValue={base} effectiveValue={effective} routes={routes} disabled={busy||blocked||targeting?.tool==='delete'} onChange={value=>{
   if(assigning){const next=fxRoutePatch(rack,destination,source,Math.round(value));if(canApply(next))onChange(next);}
   else{const values=rack.values.map(row=>[...row]);values[row][param]=Math.round(value);onChange({...rack,values});}
  }} onRelease={()=>{if(assigning){targeting?.finish();onPreview?.();}}}/>
  {targeting?.tool==='delete'&&routes.length>0&&<button className="delete-knob" aria-label={`Delete modulation from ${label}`}>×</button>}</div>
  <output>{assigning&&modulatable?`${Math.round(depth/65536*100)}%`:effectDescription(id,param,base)}</output>
  <div className="knob-routes">{routes.map(r=><span key={r.i} style={{color:sourceColors[r.i]}} title={`${r.label}: ${Math.round(r.depth/65536*100)}%`}>{sourceShortNames[r.i]} {r.depth>0?'+':''}{Math.round(r.depth/65536*100)}%</span>)}</div>
  {deleting&&<div className="mod-delete-menu" role="menu">{routes.map(r=><button role="menuitem" key={r.i} onClick={()=>{onChange(fxRoutePatch(rack,destination,r.i,0));setDeleting(false);}}>Delete {r.label}</button>)}</div>}
 </div>;
}
