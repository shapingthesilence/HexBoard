import {fxTargetIds,fxSourceIds,type FxRack} from './schema.ts';
export function fxRoutingUsage(rack:FxRack){
 let cost=0,connections=0,valid=true;const routes=rack.routes??Array(70).fill(0);
 for(let t=0;t<14;++t){const count=routes.slice(t*5,t*5+5).filter(Boolean).length;connections+=count;cost+=count;if(count)cost+=[5,6].includes(fxTargetIds[t])?8:2;if(count>4)valid=false;}
 return {cost,connections,valid};
}
export function fxRouteDepth(rack:FxRack,id:number,source:number){const t=fxTargetIds.indexOf(id),s=fxSourceIds.indexOf(source);return t<0||s<0?0:rack.routes?.[t*5+s]??0;}
export function fxRoutePatch(rack:FxRack,id:number,source:number,value:number):FxRack{
 const t=fxTargetIds.indexOf(id),s=fxSourceIds.indexOf(source);if(t<0||s<0)return rack;
 const routes=[...(rack.routes??Array(70).fill(0))];routes[t*5+s]=value;return {...rack,routes};
}

export function removeFx(rack:FxRack,id:number):FxRack{const row=id===5?5:id-1;return {...rack,order:rack.order.filter(v=>v!==id),routes:(rack.routes??Array(70).fill(0)).map((v,i)=>Math.floor(fxTargetIds[Math.floor(i/5)]/4)===row?0:v)};}
