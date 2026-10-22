// Matches main/audio src/synth/modulation_budget.h. Capacity units bound patch
// complexity; they are deliberately not presented as measured CPU percentage.
export const modulationCapacity=96, modulationConnections=32;
export interface Routing {routes:number[];tiltRoutes:number[];modulation:{routes:number[]}}
export function destinationCost(id:number){return id===7||id===32?1:[0,1,3,6].includes(id)?8:[5,14,15].includes(id)?6:[2,10,11,12,13,22,23,24,25,26].includes(id)?4:2;}
export function routeDepth(p:Routing,id:number,source:number){return source<3?p.routes[id*3+source]:source<5?p.tiltRoutes[id*2+source-3]:p.modulation.routes[id*2+source-5];}
export function modulationUsage(p:Routing,edit?:{id:number;source:number;value:number}){
 let units=0,connections=0,sources=0,targetsValid=true;
 for(let id=0;id<33;++id){let bits=0,count=0;for(let source=0;source<7;++source){const value=edit?.id===id&&edit.source===source?edit.value:routeDepth(p,id,source);if(value){bits|=1<<source;++count;++connections;++units;}}if(count>4)targetsValid=false;if(bits&0x7a)units+=destinationCost(id);sources|=bits;}
 for(let source=1;source<7;++source)if(source!==2&&(sources&(1<<source)))units+=source>=5?2:1;
 return {units,connections,targetsValid,fits:units<=modulationCapacity&&connections<=modulationConnections&&targetsValid};
}
export function budgetAllows(p:Routing,id:number,source:number,value=1){const before=modulationUsage(p),after=modulationUsage(p,{id,source,value});return after.fits||(after.targetsValid&&after.units<=before.units&&after.connections<=before.connections);}
export function sourceContribution(p:Routing,source:number){const copy={routes:[...p.routes],tiltRoutes:[...p.tiltRoutes],modulation:{routes:[...p.modulation.routes]}};for(let id=0;id<33;++id){if(source<3)copy.routes[id*3+source]=0;else if(source<5)copy.tiltRoutes[id*2+source-3]=0;else copy.modulation.routes[id*2+source-5]=0;}return modulationUsage(p).units-modulationUsage(copy).units;}
