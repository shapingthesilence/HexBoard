export const beatTick=1/12;
export const roundBeat=(value:number)=>Math.round(value*12)/12;
export const onBeatGrid=(value:number)=>Number.isFinite(value)&&Math.abs(value*12-Math.round(value*12))<1e-6;
export const snapBeat=(value:number,snap:number)=>roundBeat(Math.round(value/snap)*snap);
export const snapOptions=[[1,"Quarter note"],[0.5,"Eighth note"],[0.25,"Sixteenth note"],[2/3,"Quarter-note triplet"],[1/3,"Eighth-note triplet"],[1/6,"Sixteenth-note triplet"]] as const;
