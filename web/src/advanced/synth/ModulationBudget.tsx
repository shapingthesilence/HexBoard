import {modulationCapacity,modulationConnections} from './modulationBudget.ts';
export function ModulationBudget({used,connections,projected,contribution,blocked,capacity=modulationCapacity,label="Modulation",testedUs,mono=false}:{used:number;connections:number;projected?:number;contribution?:number;blocked?:string;capacity?:number;label?:string;testedUs?:number;mono?:boolean}){
 const extra=Math.max(0,(projected??used)-used),over=!!blocked||(projected??used)>capacity,free=Math.max(0,capacity-used),percent=(v:number)=>`${Math.min(100,v/capacity*100)}%`;
 const detail=blocked??(contribution!==undefined?label==="DSP budget"?`${Math.round(contribution/capacity*100)}% from this source`:`${contribution} units from this source`:projected!==undefined?extra?`${label==="DSP budget"?`+${Math.max(1,Math.round(extra/capacity*100))}%`:`+${extra} units`}${over?' · exceeds capacity':''}`:'No additional capacity needed':`${Math.round(free/capacity*100)}% available`);
 return <div className="modulation-budget" data-over={over||undefined} title={`${label}: ${used}/${capacity} ${label==="DSP budget"?(mono?"estimated peak µs (one string)":"estimated peak µs (8 held voices + 2 tails)"):"units"}${testedUs?` · tested peak ${testedUs} µs`:""} · ${connections}/${modulationConnections} connections. Shared moving targets cost less. This is not a CPU meter.`}>
  <span>{label}</span><div className="modulation-budget-track" role="meter" aria-label={`${label} used`} aria-valuemin={0} aria-valuemax={capacity} aria-valuenow={Math.min(used,capacity)} aria-valuetext={`${used} of ${capacity} units used. ${detail}`}>
   <i className="budget-used" style={{width:percent(used)}}/>{contribution!==undefined&&<i className="budget-source" style={{right:percent(Math.max(0,used-contribution)),width:percent(contribution)}}/>}{extra>0&&<i className="budget-preview" style={{right:percent(Math.min(used,capacity)),width:percent(Math.min(extra,free))}}/>}
  </div><output>{detail}</output>
 </div>;
}
