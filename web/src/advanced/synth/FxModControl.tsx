import {useState} from 'react';
import {Knob,sourceColors,sourceShortNames} from './SynthControls.tsx';
import {effectDescription,effectTypes,physicalSources,fxRow,fxSourceIds,fxTargetIds,type FxRack} from './schema.ts';
import {fxRouteDepth,fxRoutePatch} from './fxRouting.ts';
import {RouteChip,RouteMenu} from './modulationGestures.tsx';
import {PreviewSelect} from './SynthVisualPreview.tsx';
export interface FxTargeting {tool:'value'|'modulate';source:number;values:number[];finish:()=>void;focus?:()=>void;previewSource?:(source:number)=>number}
export function FxModControl({rack,id,param,label,busy,onChange,targeting,canApply,onPreview}:{rack:FxRack;id:number;param:number;label:string;busy:boolean;onChange:(rack:FxRack)=>void;targeting?:FxTargeting;canApply:(rack:FxRack)=>boolean;onPreview?:(rack?:FxRack)=>void}){
 const [menu,setMenu]=useState<{source:number;x:number;y:number}>();
 const row=fxRow(id),destination=row*4+param;
 const fullLabel=`${effectTypes[id-1].name} ${label}`;
 const source=targeting?.source??-1,assigning=targeting?.tool==='modulate',modulatable=fxSourceIds.includes(source)&&fxTargetIds.includes(destination);
 const depth=fxRouteDepth(rack,destination,source),base=rack.values[row][param];
 const routes=fxSourceIds.map(i=>({i,label:physicalSources[i],depth:fxRouteDepth(rack,destination,i),bipolar:[3,4,6,7].includes(i)})).filter(r=>r.depth);
 const menuRoute=routes.find(r=>r.i===menu?.source);
 const setRouteDepth=(source:number,depth:number)=>{
  if(busy)return;
  const next=fxRoutePatch(rack,destination,source,depth);
  if(depth===0||canApply(next))onChange(next);
 };
 const candidate=fxRoutePatch(rack,destination,source,depth||1),full=routes.length>=4&&!depth;
 const blocked=assigning&&(!modulatable||full||!canApply(candidate));
 const hint=assigning&&!modulatable?'FX use global sources: tilt, LFO, joystick or expression':full?'4 sources on this target · remove one to add another':blocked?'DSP budget full · reduce another feature':undefined;
 const preview=()=>{targeting?.focus?.();if(assigning&&modulatable)onPreview?.(candidate);};
 let effective=base/65535;for(const route of routes)effective+=route.depth/65536*(targeting?.values[route.i]??0);effective=Math.max(0,Math.min(1,effective));
 return <div className="physical-control" data-modulatable={modulatable||undefined} data-route-full={blocked||undefined} data-unavailable={assigning&&!modulatable||undefined} title={hint} onPointerEnter={preview} onFocusCapture={preview} onPointerLeave={()=>onPreview?.()} onBlurCapture={()=>onPreview?.()}>
  <strong>{label}</strong><div className="knob-wrap">
  <PreviewSelect fallback={effective} select={sources => Math.max(0, Math.min(1, base/65535 + routes.reduce((sum, r) => sum + r.depth/65536 * (sources[targeting?.previewSource?.(r.i)??r.i] ?? 0), 0)))}>{value => <Knob key={assigning?`route-${source}`:'value'} label={assigning&&modulatable?`${physicalSources[source]} to ${fullLabel}`:fullLabel} value={assigning&&modulatable?depth:base} min={assigning&&modulatable?-65536:0} max={assigning&&modulatable?65536:65535} baseValue={base} effectiveValue={value} routes={routes} disabled={busy||blocked} onChange={value=>{
   if(assigning)setRouteDepth(source,Math.round(value));
   else{const values=rack.values.map(row=>[...row]);values[row][param]=Math.round(value);onChange({...rack,values});}
  }} onRelease={()=>{if(assigning){targeting?.finish();onPreview?.();}}}/>}</PreviewSelect>
  </div>
  <output>{assigning&&modulatable?`${Math.round(depth/65536*100)}%`:effectDescription(id,param,base)}</output>
  <div className="knob-routes">{routes.map(r=><RouteChip key={r.i} short={sourceShortNames[r.i]} label={`${r.label} → ${fullLabel}`}
    color={sourceColors[r.i]} depth={r.depth} disabled={busy} onDepth={depth=>setRouteDepth(r.i,depth)} onMenu={(x,y)=>setMenu({source:r.i,x,y})}/>)}</div>
  {!busy&&menu&&menuRoute&&<RouteMenu key={menuRoute.i} title={`${menuRoute.label} → ${fullLabel}`} color={sourceColors[menuRoute.i]}
    depth={menuRoute.depth} x={menu.x} y={menu.y} onDepth={depth=>setRouteDepth(menuRoute.i,depth)} onClose={()=>setMenu(undefined)}/>}
 </div>;
}
