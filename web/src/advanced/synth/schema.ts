export function releaseSeconds(value:number) { const v=value/65535; return v<=.8 ? .03+.7125*v : .6*Math.exp(14.978661*(v-.8)); }
export function releaseDescription(value:number) { const t=releaseSeconds(value); return t<1 ? `${Math.round(t*1000)} ms` : `${t.toFixed(2)} s`; }
export const physicalParameters = [
  { id: 0, name: "Ring time", describe: (v: number) => `${(0.15 * Math.exp(4.38202663 * v / 65535)).toFixed(2)} s`, behavior: "Longer ring" },
  { id: 1, name: "Material loss", describe: (v: number) => `${Math.round(v / 65535 * 100)}%`, behavior: "More damping" },
  { id: 2, name: "Striker hardness", describe: (v: number) => `${Math.round(v / 65535 * 100)}%`, behavior: "Harder attack", strike: true },
  { id: 3, name: "Release time", describe: (v: number) => releaseDescription(v), behavior: "Longer release" },
  { id: 4, name: "Strike position", describe: (v: number) => `${Math.round(5 + 90 * v / 65535)}% along string`, behavior: "Pluck toward bridge", strike: true },
  { id: 5, name: "Left pickup", describe: (v: number) => `${Math.round(5 + 90 * v / 65535)}% along string`, behavior: "Pickup toward bridge" },
  { id: 6, name: "Stiffness", describe: (v: number) => `${Math.round(v / 65535 * 100)}%`, behavior: "More metallic" },
  { id: 7, name: "Output level", describe: (v: number) => `${(-12 + 36 * v / 65535).toFixed(1)} dB`, behavior: "" },
  { id: 8, name: "Contact mode", describe: (v: number) => ["Off", "Bounce", "Rattle", "Mute", "Marbles"][Math.round(v * 4 / 65535)], behavior: "" },
  { id: 9, name: "Clearance", describe: (v: number) => `${Math.round(v / 65535 * 100)}%`, behavior: "More space above string" },
  { id: 10, name: "Contact mass", describe: (v: number) => `${Math.round(v / 65535 * 100)}%`, behavior: "Heavier object" },
  { id: 11, name: "Gravity", describe: (v: number) => `${Math.round(v / 65535 * 100)}%`, behavior: "Faster return" },
  { id: 12, name: "Striker resonance", describe: (v: number) => `${Math.round(v / 65535 * 100)}%`, behavior: "More striker ringing" },
  { id: 13, name: "Contact damping", describe: (v: number) => `${Math.round(v / 65535 * 100)}%`, behavior: "Less bounce" },
  { id: 14, name: "Right pickup", describe: (v: number) => `${Math.round(5 + 90 * v / 65535)}% along string`, behavior: "Pickup toward bridge" },
  { id: 15, name: "Stereo width", describe: (v: number) => `${Math.round(v / 65535 * 100)}%`, behavior: "Wider stereo" },
  { id: 16, name: "Contact strength", describe: (v: number) => `${Math.round(v / 65535 * 100)}%`, behavior: "Stronger impacts" },
  { id: 17, name: "Marbles", describe: (v: number) => v === 0 ? "Off" : `${(.5 + 29.5 * v / 65535).toFixed(1)}/s average`, behavior: "More marbles" },
  { id: 18, name: "Drop center", describe: (v: number) => `${Math.round(5+90*v/65535)}% along string`, behavior: "Drops toward bridge" },
  { id: 19, name: "Drop spread", describe: (v: number) => `${Math.round(90*v/65535)}% of string`, behavior: "Wider drop region" } ,{ id: 20, name: "Timing randomness", describe: (v: number) => `${Math.round(v / 65535 * 100)}%`, behavior: "Less regular timing" } ,{id:21,name:"Excitation mode",describe:(v:number)=>v>32767?"Bow":"Strike",behavior:""}
 ,{id:22,name:"Bow force",describe:(v:number)=>`${Math.round(v/65535*100)}%`,behavior:"More bow pressure"}
 ,{id:23,name:"Bow speed",describe:(v:number)=>`${Math.round(v/65535*100)}%`,behavior:"Faster bow"},
  { id: 24, name: "Marble hardness", describe: (v: number) => `${Math.round(v / 65535 * 100)}%`, behavior: "Harder marble impacts" },
  { id: 25, name: "Marble resonance", describe: (v: number) => `${Math.round(v / 65535 * 100)}%`, behavior: "More marble ringing" },
  { id: 26, name: "Drive", describe: (v: number) => `${Math.round(v / 65535 * 100)}%`, behavior: "More bridge saturation" },
  { id: 27, name: "Saturation character", describe: (v: number) => ["Warm", "Edge", "Fold"][Math.round(v / 65535 * 2)], behavior: "" },
  { id: 28, name: "Strike shape", describe: (v: number) => ["Normal", "Felt", "Double", "Scrape"][Math.round(v / 65535 * 3)], behavior: "", strike: true },
  { id: 29, name: "Preparation", describe: (v: number) => `${Math.round(v / 65535 * 100)}%`, behavior: "More bridge buzz" },
  { id: 30, name: "Reserved", describe: (_v: number) => "", behavior: "" },
  { id: 31, name: "Contact starts", describe:(v:number)=>v>32767?"Note off":"Note on", behavior:"" },
] as const;
export const negativePhysicalBehaviors = ["Shorter ring", "Less damping", "Softer attack", "Shorter release", "Pluck toward nut", "Pickup toward nut", "Softer string", "", "", "Less space above string", "Lighter object", "Slower return", "Softer collisions", "More bounce", "Pickup toward nut", "Toward mono", "Weaker impacts", "Fewer marbles", "Drops toward nut", "Narrower drop region", "More regular timing", "", "Less bow pressure", "Slower bow", "Softer marble impacts", "Less marble ringing", "Cleaner bridge"];
export const physicalSources = ["Strike velocity", "Key pressure", "Release velocity", "X tilt", "Y tilt", "Envelope", "LFO"] as const;
export const velocityEngines = [
  { id: 0, name: "Threshold Strike", hint: "Threshold timing · dynamic strikes" },
  { id: 1, name: "Expressive Strike", hint: "Peak press speed · expressive attacks" },
  { id: 2, name: "Distance Window", hint: "Travel over a short sample window" },
  { id: 3, name: "Peak Gesture", hint: "Peak then retreat · timed note pulses" },
  { id: 4, name: "Fixed Velocity", hint: "Constant attack and release · continuous pressure" }
] as const;
export type PhysicalVelocityEngine = typeof velocityEngines[number]["id"];
export interface FxRack { order: number[]; values: number[][] }
export const defaultFx = (): FxRack => ({order:[],values:[[20000,16000,0,0],[24000,45000,30000,0],[16000,35000,0,0],[18000,22000,18000,0],[22000,26000,16000,0]]});
export const effectTypes = [
  {id:1,name:"Distortion",controls:["Drive","Mix"]},
  {id:2,name:"Reverb",controls:["Mix","Size","Damping"]},
  {id:3,name:"Volume LFO",controls:["Rate","Depth"]},
  {id:4,name:"Chorus",controls:["Mix","Rate","Depth"]}
];
export function validateFx(value: unknown, legacy=false): FxRack {
  const f=value as FxRack;
  if(!f || !Array.isArray(f.order) || f.order.length>5 || new Set(f.order).size!==f.order.length || f.order.some(id=>!Number.isInteger(id)||id<1||id>(legacy?5:4)) || !Array.isArray(f.values) || f.values.length!==5 || f.values.some(row=>!Array.isArray(row)||row.length!==4||row.some(v=>!Number.isInteger(v)||v<0||v>65535)))throw Error("Invalid effect rack.");
  return {order:[...f.order],values:f.values.map(row=>[...row])};
}
export function effectDescription(id:number,index:number,value:number) {
  const v=value/65535;
  if(id===1 && index===0)return `${(1+15*v).toFixed(1)}×`;
  if((id===3||id===4) && index===(id===3?0:1))return `${(.1+(id===3?11.9:2.9)*v).toFixed(2)} Hz`;
  if(id===5 && index===0)return `${Math.round(10+170*v)} ms`;
  return `${Math.round(v*(id===5&&index===1?75:100))}%`;
}
export const modulationRouteLimit=6;
export function modulationRouteCount(routes:number[],source:number){return routes.filter((v,i)=>i%2===source&&v!==0).length;}
export function canAssignModulation(routes:number[],id:number,source:number){return routes[id*2+source]!==0||modulationRouteCount(routes,source)<modulationRouteLimit;}
export interface ModulationSources { settings:number[]; routes:number[] }
export const defaultModulation = ():ModulationSources => ({settings:[14000,30000,42000,34000,0,0,32768,0,30000,0,65535,0,0,0,0,0],routes:Array(64).fill(0)});
export function modulationSeconds(v:number){return v===0?0:.001*Math.exp(9.903488*v/65535);}
export function modulationRate(v:number){return .05*Math.exp(5.991465*v/65535);}
export function validateModulation(value:unknown):ModulationSources {
  const m=value as ModulationSources;
  if(!m||!Array.isArray(m.settings)||m.settings.length!==16||m.settings.some(v=>!Number.isInteger(v)||v<0||v>65535)||[7,10,14].some(i=>m.settings[i]!==0&&m.settings[i]!==65535)||m.settings[9]%13107!==0||!Array.isArray(m.routes)||m.routes.length!==64||m.routes.some(v=>!Number.isInteger(v)||v<-65536||v>65536)||[8,21,27,28,30,31].some(id=>m.routes.slice(id*2,id*2+2).some(Boolean)))throw Error("Invalid envelope / LFO modulation.");
  for(let source=0;source<2;++source)if(modulationRouteCount(m.routes,source)>modulationRouteLimit)throw Error(`${source===0?"Envelope":"LFO"} allows ${modulationRouteLimit} routes. Remove an assignment before adding another.`);
  return {settings:[...m.settings],routes:[...m.routes]};
}
export interface PhysicalPreset { format: "hexboard.physical.v19"; modulation:ModulationSources; tiltRoutes: number[]; effects: FxRack; name: string; parameters: number[]; routes: number[]; velocityEngine: PhysicalVelocityEngine }
export const initialPreset: PhysicalPreset = {
  format: "hexboard.physical.v19", modulation:defaultModulation(), tiltRoutes: Array(64).fill(0), effects: defaultFx(), name: "Pressure Sweep", velocityEngine: 0,
  parameters: [56000, 9000, 36000, 30000, 24000, 12000, 14000, 43690, 0, 65535, 30000, 18000, 10000, 18000, 50000, 32768, 32768, 0, 32768, 22000, 16000],
  routes: [0, 0, 0, 0, 0, 0, 14000, 0, 0, 0, 0, -26000, 0, 0, 0, 0, 42000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -50000, 0, ...Array(12).fill(0), 0, -20000, 0, 0, 0, 0, ...Array(15).fill(0)]
};
export const factoryPhysicalPresets: PhysicalPreset[] = [initialPreset,
  { ...initialPreset, name: "Glass Pressure", parameters: [61000, 4000, 46000, 34000, 15000, 17000, 26000, 43690, 0, 65535, 30000, 18000, 49000, 18000, 45000, 45000, 32768, 0, 32768, 22000, 16000],
    routes: [0, 0, 0, 0, 0, 0, 10000, 0, 0, 0, 0, -22000, 0, 0, 0, 0, 22000, 0, 0, 30000, 0, 0, 0, 0, 0, 0, 0, 0, -50000, 0, ...Array(12).fill(0), 0, -16000, 0, 0, 0, 0, ...Array(15).fill(0)] },
  { ...initialPreset, name: "Wood Touch", parameters: [61000, 33000, 14000, 26000, 36000, 19000, 7000, 43690, 0, 65535, 30000, 18000, 10000, 18000, 44000, 24000, 32768, 0, 32768, 22000, 16000],
    routes: [0, -13000, 0, 0, 23000, 0, 11000, 0, 0, 0, 0, -22000, 0, 0, 0, 0, 16000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -50000, 0, ...Array(12).fill(0), 0, -14000, 0, 0, 0, 0, ...Array(15).fill(0)] },
  { ...initialPreset, name: "Pressure Bounce", parameters: [60000, 5000, 38000, 34000, 22000, 14000, 8000, 43690, 16384, 56000, 37000, 35000, 10000, 12000, 45000, 40000, 50000, 0, 32768, 22000, 16000], routes: initialPreset.routes.map((v, i) => i === 28 ? -65536 : i === 40 ? 35000 : i === 16 || i === 43 ? 0 : v) }
];
const marbleBase = factoryPhysicalPresets.find(p => p.name === "Pressure Bounce")!;
factoryPhysicalPresets.push({ ...marbleBase, name: "Falling Marbles",
  parameters: marbleBase.parameters.map((v,i) => ({ 8:65535, 9:38000, 10:46000, 11:38000, 2:52000, 12:44000, 13:8000, 16:57000, 17:26000, 18:32768, 19:30000 } as Record<number,number>)[i] ?? v),
  routes: marbleBase.routes.map((v,i) => i === 28 ? 0 : i === 40 ? 0 : i === 49 ? 8000 : i === 52 ? 16000 : v) });
// Material dominates the factory identity; velocity already shapes each impact.
for(const preset of factoryPhysicalPresets) {
  preset.parameters=preset.parameters.map((v,i)=>i===3?Math.round(v*.8):i===7?21845:v).concat([0,12000,30000]);
  preset.routes=preset.routes.map((v,i)=>i>=6 && i<9 ? 0 : i>=9 && i<12 ? Math.round(v*.8) : v).concat(Array(9).fill(0));
}
for(const material of [{name:"Rubber",h:3300,r:0},{name:"Wood",h:23000,r:9800},{name:"Glass",h:52000,r:49000},{name:"Steel",h:65535,r:46000}])
  factoryPhysicalPresets.push({...initialPreset,name:`Strike · ${material.name}`,
    parameters:initialPreset.parameters.map((v,i)=>i===2?material.h:i===12?material.r:i===1?9000:i===6?14000:v),routes:[...initialPreset.routes]});
factoryPhysicalPresets.push({...initialPreset,name:"Pressure Bow",velocityEngine:4,
  parameters:initialPreset.parameters.map((v,i)=>({1:4000,2:20000,3:63000,5:16000,6:8000,8:0,12:0,14:47000,15:40000,21:65535,22:7000,23:30000} as Record<number,number>)[i]??v),
  routes:initialPreset.routes.map((v,i)=>i===11||i===16||i===43?0:i===67?50000:i===69?8000:v)});
for(const preset of factoryPhysicalPresets) {
  preset.parameters.push(preset.parameters[2],preset.parameters[12],0,0,0,0,0,0);
  preset.routes.push(...Array(24).fill(0));
}
const alienPiano=physicalPresetFromUnknown({...initialPreset,name:"Otherworldly Piano",parameters:initialPreset.parameters.map((v,i)=>({2:16000,3:63000,6:38000,12:18000,28:21845,29:18000} as Record<number,number>)[i]??v),routes:initialPreset.routes.map((v,i)=>i===88?12000:v)});
factoryPhysicalPresets.push(alienPiano);
export const materialChoices = [
  { name: "Nylon", stiffness: 1300, loss: 19000 }, { name: "Wood", stiffness: 6500, loss: 42000 },
  { name: "Wire", stiffness: 16000, loss: 5000 }, { name: "Glass", stiffness: 46000, loss: 3000 },
  { name: "Metal", stiffness: 61000, loss: 8000 }
];
export const strikerChoices = [{name:"Rubber",hardness:3300,resonance:0},{name:"Wood",hardness:23000,resonance:9800},{name:"Plastic",hardness:36000,resonance:6500},{name:"Glass",hardness:52000,resonance:49000},{name:"Steel",hardness:65535,resonance:46000}];
export function physicalPresetFromUnknown(value: unknown): PhysicalPreset {
  if (!value || typeof value !== "object") throw Error("Invalid physical preset.");
  const p = value as Record<string, unknown>;
  const valid = (v: unknown, count: number, low: number, high: number): v is number[] =>
    Array.isArray(v) && v.length === count && v.every(n => Number.isInteger(n) && n >= low && n <= high);
  if (typeof p.name !== "string" || !p.name.trim() || p.name.length > 80) throw Error("Give the preset a name.");
  if (p.format === "hexboard.physical.v1" && valid(p.parameters, 4, 0, 65535) && valid(p.routes, 12, -65536, 65536)) {
    const parameters = [...p.parameters, 32768, 32768, 0, 43690];
    parameters[0] = Math.min(65535, Math.round(parameters[0] + 2.5 / 4.38202663 * parameters[1]));
    return physicalPresetFromUnknown({ ...p, format: "hexboard.physical.v2", parameters, routes: [...p.routes, ...Array(12).fill(0)] });
  }
  if (p.format === "hexboard.physical.v2" && valid(p.parameters, 8, 0, 65535) && valid(p.routes, 24, -65536, 65536) && p.routes.slice(21).every(v => v === 0)) {
    return physicalPresetFromUnknown({ format: "hexboard.physical.v3", name: p.name.trim(), parameters: [...p.parameters, 0, 65535, 30000, 18000, 36000, 18000, p.parameters[5], 0], routes: [...p.routes, ...Array(24).fill(0)] });
  }
  if (p.format === "hexboard.physical.v3" && valid(p.parameters, 16, 0, 65535) && valid(p.routes, 48, -65536, 65536) && p.routes.slice(21,27).every(v => v === 0))
    return physicalPresetFromUnknown({ format: "hexboard.physical.v4", name: p.name.trim(), parameters: [...p.parameters, 32768, 0], routes: [...p.routes, ...Array(6).fill(0)] });
  if (p.format === "hexboard.physical.v4" && valid(p.parameters,18,0,65535) && valid(p.routes,54,-65536,65536) && p.routes.slice(21,27).every(v=>v===0)) {
    const parameters=[...p.parameters,32768,22000];
    const mode=Math.round(parameters[8]/21845);
    parameters[8]=Math.round((mode===1 && (parameters[17]>0 || p.routes.slice(51,54).some(v=>v!==0)) ? 4 : mode)*65535/4);
    return physicalPresetFromUnknown({format:"hexboard.physical.v5",name:p.name.trim(),parameters,routes:[...p.routes,...Array(6).fill(0)]});
  }
  if (p.format === "hexboard.physical.v5" && valid(p.parameters,20,0,65535) && valid(p.routes,60,-65536,65536) && p.routes.slice(21,27).every(v=>v===0)) {
    const parameters=[...p.parameters,16000], routes=[...p.routes,0,0,0];
    if(parameters[8]!==0) { parameters[2]=parameters[12]; for(let i=0;i<3;i++)routes[6+i]=routes[36+i]; }
    parameters[12]=10000; routes.splice(36,3,0,0,0);
    return physicalPresetFromUnknown({format:"hexboard.physical.v6",name:p.name,parameters,routes});
  }
  if(p.format==="hexboard.physical.v6" && valid(p.parameters,21,0,65535) && valid(p.routes,63,-65536,65536) && p.routes.slice(21,27).every(v=>v===0)) {
    return physicalPresetFromUnknown({format:"hexboard.physical.v7",name:p.name,
      parameters:p.parameters.map((v,i)=>i===3?Math.round(v*.8):v).concat([0,12000,30000]),
      routes:p.routes.map((v,i)=>i>=9&&i<12?Math.round(v*.8):v).concat(Array(9).fill(0))});
  }
  if(p.format==="hexboard.physical.v7" && valid(p.parameters,24,0,65535) && valid(p.routes,72,-65536,65536))
    return physicalPresetFromUnknown({...p,format:"hexboard.physical.v8",parameters:p.parameters.map((v,i)=>i===7?Math.min(v,21845):v)});
  if (p.format === "hexboard.physical.v8" && valid(p.parameters,24,0,65535) && valid(p.routes,72,-65536,65536))
    return physicalPresetFromUnknown({...p,format:"hexboard.physical.v9",velocityEngine:0});
  if(p.format === "hexboard.physical.v9")return physicalPresetFromUnknown({...p,format:"hexboard.physical.v11",effects:defaultFx()});
  if(p.format === "hexboard.physical.v10"){const effects=validateFx(p.effects,true);return physicalPresetFromUnknown({...p,format:"hexboard.physical.v11",effects:{...effects,order:effects.order.filter(id=>id!==5)}});}
  if(p.format === "hexboard.physical.v11")return physicalPresetFromUnknown({...p,format:"hexboard.physical.v12",tiltRoutes:Array(48).fill(0)});
  if(p.format === "hexboard.physical.v12" && valid(p.parameters,24,0,65535) && valid(p.routes,72,-65536,65536) && valid(p.tiltRoutes,48,-65536,65536)) {
    return physicalPresetFromUnknown({...p,format:"hexboard.physical.v13",parameters:[...p.parameters,p.parameters[2],p.parameters[12]],routes:[...p.routes,...p.routes.slice(6,9),...p.routes.slice(36,39)],tiltRoutes:[...p.tiltRoutes,...p.tiltRoutes.slice(4,6),...p.tiltRoutes.slice(24,26)]});
  }
  if(p.format === "hexboard.physical.v13" && valid(p.parameters,26,0,65535) && valid(p.routes,78,-65536,65536) && valid(p.tiltRoutes,52,-65536,65536)) {
    return physicalPresetFromUnknown({...p,format:"hexboard.physical.v14",parameters:[...p.parameters,0],routes:[...p.routes,0,0,0],tiltRoutes:[...p.tiltRoutes,0,0]});
  }
  if(p.format === "hexboard.physical.v14" && valid(p.parameters,27,0,65535) && valid(p.routes,81,-65536,65536) && valid(p.tiltRoutes,54,-65536,65536)) {
    return physicalPresetFromUnknown({...p,format:"hexboard.physical.v15",parameters:[...p.parameters,0],routes:[...p.routes,0,0,0],tiltRoutes:[...p.tiltRoutes,0,0]});
  }
  if(p.format==="hexboard.physical.v15" && valid(p.parameters,28,0,65535) && valid(p.routes,84,-65536,65536) && valid(p.tiltRoutes,56,-65536,65536)) {
    if(p.routes.slice(81,84).some(Boolean)||p.tiltRoutes.slice(54,56).some(Boolean))throw Error("Invalid discrete modulation routes.");
    return physicalPresetFromUnknown({...p,format:"hexboard.physical.v16",parameters:[...p.parameters,0,0],routes:[...p.routes,0,0,0,0,0,0],tiltRoutes:[...p.tiltRoutes,0,0,0,0]});
  }
  if(p.format==="hexboard.physical.v16" && valid(p.parameters,30,0,65535) && valid(p.routes,90,-65536,65536) && valid(p.tiltRoutes,60,-65536,65536)) {
    return physicalPresetFromUnknown({...p,format:"hexboard.physical.v17",parameters:[...p.parameters,0],routes:[...p.routes,0,0,0],tiltRoutes:[...p.tiltRoutes,0,0]});
  }
  if(p.format==="hexboard.physical.v17")return physicalPresetFromUnknown({...p,format:"hexboard.physical.v18",modulation:{settings:defaultModulation().settings,routes:Array(62).fill(0)}});
  if(p.format==="hexboard.physical.v18" && valid(p.parameters,31,0,65535)&&valid(p.routes,93,-65536,65536)&&valid(p.tiltRoutes,62,-65536,65536)){
    const m=p.modulation as ModulationSources;
    if(!m||!Array.isArray(m.routes)||m.routes.length!==62)throw Error("Invalid envelope / LFO modulation.");
    return physicalPresetFromUnknown({...p,format:"hexboard.physical.v19",parameters:[...p.parameters,0],routes:[...p.routes,0,0,0],tiltRoutes:[...p.tiltRoutes,0,0],modulation:{...m,routes:[...m.routes,0,0]}});
  }
  const discrete=[7,8,21,27,28,30,31];
  if (!valid(p.tiltRoutes,64,-65536,65536) || discrete.some(id=>(p.tiltRoutes as number[]).slice(id*2,id*2+2).some(Boolean)))throw Error("Invalid tilt modulation routes.");
  if (p.format !== "hexboard.physical.v19" || !valid(p.parameters,32,0,65535) || !valid(p.routes,96,-65536,65536) || discrete.some(id=>(p.routes as number[]).slice(id*3,id*3+3).some(Boolean)) || !velocityEngines.some(e => e.id === p.velocityEngine))
    throw Error("This file is not a supported physical string preset.");
  return {format:"hexboard.physical.v19",modulation:validateModulation(p.modulation),tiltRoutes:[...(p.tiltRoutes as number[])],effects:validateFx(p.effects),name:p.name.trim(),parameters:p.parameters.map((v,i)=>i===30?0:v),routes:[...p.routes],velocityEngine:p.velocityEngine as PhysicalVelocityEngine};
}

export function effectiveParameters(p: PhysicalPreset, sources: number[]): number[] {
  return p.parameters.map((base,id)=>{
    if(id===7)return Math.max(0,Math.min(1,base/65535*Math.max(0,Math.min(2,1+p.modulation.routes[14]*((sources[5]??0)-1)/65536+p.modulation.routes[15]*(sources[6]??0)/65536))));
    return Math.max(0,Math.min(1,base/65535+sources.reduce((sum,source,i)=>sum+source*(i<3?p.routes[id*3+i]:i<5?p.tiltRoutes[id*2+i-3]:p.modulation.routes[id*2+i-5])/65536,0)));
  });
}
export function encodeLogPitchHz(hz: number): number[] {
  if (!Number.isFinite(hz) || hz < 2 ** -16 || hz > 2 ** 16) throw Error("Pitch is outside the transport range.");
  const biased = Math.round(Math.log2(hz) * 2 ** 24) + 2 ** 31;
  return Array.from({ length: 5 }, (_, i) => Math.floor(biased / 2 ** (7 * (4 - i))) % 128);
}
