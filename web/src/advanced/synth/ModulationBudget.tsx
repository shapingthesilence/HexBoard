import {modulationCapacity,modulationConnections} from './modulationBudget.ts';
export function ModulationBudget({used,connections,projected,contribution,blocked}:{used:number;connections:number;projected?:number;contribution?:number;blocked?:string}){
 const extra=Math.max(0,(projected??used)-used),over=!!blocked||(projected??used)>modulationCapacity,free=Math.max(0,modulationCapacity-used),percent=(v:number)=>`${Math.min(100,v/modulationCapacity*100)}%`;
 const detail=blocked??(contribution!==undefined?`${contribution} units from this source`:projected!==undefined?extra?`+${extra} units${over?' · exceeds capacity':''}`:'No additional capacity needed':`${Math.round(free/modulationCapacity*100)}% available`);
 return <div className="modulation-budget" data-over={over||undefined} title={`Modulation capacity: ${used}/${modulationCapacity} units · ${connections}/${modulationConnections} connections. Shared moving targets cost less. This is not a CPU meter.`}>
  <span>Modulation</span><div className="modulation-budget-track" role="meter" aria-label="Modulation capacity used" aria-valuemin={0} aria-valuemax={modulationCapacity} aria-valuenow={Math.min(used,modulationCapacity)} aria-valuetext={`${used} of ${modulationCapacity} units used. ${detail}`}>
   <i className="budget-used" style={{width:percent(used)}}/>{contribution!==undefined&&<i className="budget-source" style={{right:percent(Math.max(0,used-contribution)),width:percent(contribution)}}/>}{extra>0&&<i className="budget-preview" style={{right:percent(Math.min(used,modulationCapacity)),width:percent(Math.min(extra,free))}}/>}
  </div><output>{detail}</output>
 </div>;
}
