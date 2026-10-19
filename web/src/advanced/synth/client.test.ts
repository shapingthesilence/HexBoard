import {SynthProgress} from './SynthProgress.tsx';
import type {SynthProgress as Progress} from './progress.ts';
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { encodeDefaultPresetSyncFrame, decodePresetSyncFrame, encodeU21 } from "../../protocol/index.ts";
import type { MidiMessageListener, MidiTransport } from "../../midi/types.ts";
import { PhysicalSynthClient, decodePhysicalState, decodePhysicalExpression, decodeMotion, decodeModulation } from "./client.ts";
import { initialPreset, factoryPhysicalPresets, physicalPresetFromUnknown, encodeLogPitchHz, effectiveParameters, releaseSeconds, defaultModulation, validateModulation, defaultFx, validateFx } from "./schema.ts";
import { PhysicalSynthEditor } from "./PhysicalSynthEditor.tsx";

function payload() { return [17, 1, 2, ...encodeU21(131072), ...initialPreset.parameters.flatMap(encodeU21), ...initialPreset.routes.flatMap(v => encodeU21(v + 65536)), initialPreset.velocityEngine]; }
class Transport implements MidiTransport {
  label = "Advanced test";
  listeners = new Set<MidiMessageListener>();
  sent: number[][] = [];
  respond = true;state = 1;samplePriority=0;sampleLoop:number[]|undefined;
  modulation=defaultModulation();
  async send(bytes: ArrayLike<number>) {
    this.sent.push(Array.from(bytes));
    const frame = decodePresetSyncFrame(bytes);
    if(frame.payload[1]===1)this.state=1;if(frame.payload[1]===2)this.state=0;
    if(frame.payload[1]===28){queueMicrotask(()=>this.listeners.forEach(l=>l(Uint8Array.from(encodeDefaultPresetSyncFrame(0x35,frame.transactionId,[17,this.state,...payload().slice(2)])))));return;}
    if(frame.payload[1]>=46&&frame.payload[1]<=51){queueMicrotask(()=>this.listeners.forEach(l=>l(Uint8Array.from(encodeDefaultPresetSyncFrame(0x35,frame.transactionId,[17,this.state,...payload().slice(2)])))));return;}
    const modulation=frame.payload[1]>=16;
    if(frame.payload[1]===17)this.modulation=decodeModulation([17,...frame.payload.slice(2)]);
    if(frame.payload[1]===18)this.modulation.settings[frame.payload[2]]=decodeModulation([17,...this.modulation.settings.map((v,i)=>i===frame.payload[2]?frame.payload.slice(3).reduce((a,b)=>a*128+b,0):v).flatMap(encodeU21),...this.modulation.routes.flatMap(v=>encodeU21(v+65536))]).settings[frame.payload[2]];
    if(frame.payload[1]===19)this.modulation.routes[frame.payload[2]*2+frame.payload[3]]=frame.payload.slice(4).reduce((a,b)=>a*128+b,0)-65536;
    const modResponse=[17,...this.modulation.settings.flatMap(encodeU21),...this.modulation.routes.flatMap(v=>encodeU21(v+65536))];
    const motion=frame.payload[1]>=12;
    const fx=frame.payload[1]>=10;
    const motionResponse=[17,1,1,...encodeU21(32767),...encodeU21(32767),...(frame.payload[1]===13?frame.payload.slice(2):Array(66).fill(65536).flatMap(encodeU21))];
    if(frame.payload[1]===24)this.samplePriority=frame.payload[9]??0;
    if(frame.payload[1]===27)this.sampleLoop=frame.payload.slice(2);
    if(frame.payload[1]>=20){const sample=[17,0,...encodeU21(32768),...encodeU21(this.sampleLoop?1600:0),0,0,0,0,0,0,...encodeU21(65535),this.samplePriority,...(this.sampleLoop??[])];queueMicrotask(()=>this.listeners.forEach(l=>l(Uint8Array.from(encodeDefaultPresetSyncFrame(0x3b,frame.transactionId,sample)))));return;}
    const response=frame.payload[1]===11?[17,...frame.payload.slice(2)]:[17,0,0,0,0,0,...defaultFx().values.flat().flatMap(encodeU21),...defaultFx().steps.flatMap(encodeU21)];
    if (this.respond) for (const listener of this.listeners) listener(Uint8Array.from(encodeDefaultPresetSyncFrame(modulation?0x39:motion?0x38:fx?0x37:0x35, frame.transactionId, modulation?modResponse:motion?motionResponse:fx?response:[17,this.state,...payload().slice(2)])));
  }
  subscribe(listener: MidiMessageListener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
}
const legacyPreset=()=>({...initialPreset,parameters:initialPreset.parameters.slice(0,24),routes:initialPreset.routes.slice(0,72),tiltRoutes:initialPreset.tiltRoutes.slice(0,48)});
describe("Advanced physical editor", () => {
  it("stops before selecting the SD piano and decodes sampler acknowledgements",async()=>{
    const t=new Transport(),c=new PhysicalSynthClient(t);try{
      await c.samplerSource('piano');await c.samplerParameter(4,18000);await c.samplerSource('patch');
      const frames=t.sent.map(decodePresetSyncFrame);expect(frames.findIndex(f=>f.payload[1]===2)).toBeLessThan(frames.findIndex(f=>f.payload[1]===51));
      expect(frames.filter(f=>f.payload[1]===51).map(f=>f.payload[2])).toEqual([1,0]);expect(frames.some(f=>f.payload[1]===46)).toBe(true);
    }finally{c.close();}
  });
  it("persists sample priority without changing stored drive and pin controls",async()=>{
    const t=new Transport(),c=new PhysicalSynthClient(t);t.state=0;
    try{await c.setSample({enabled:false,gain:32768,direct:65535,priority:1,name:"",frames:[]});const state=await c.read();expect(state.preset.sample.priority).toBe(1);expect(state.preset.parameters[26]).toBe(initialPreset.parameters[26]);expect(state.preset.parameters[29]).toBe(initialPreset.parameters[29]);expect(t.sent.map(decodePresetSyncFrame).find(f=>f.payload[1]===24)?.payload[9]).toBe(1);expect(()=>physicalPresetFromUnknown({...initialPreset,sample:{...initialPreset.sample,priority:2}})).toThrow();}finally{c.close();}
  });

  it("waits for codec startup on the first sample preview, then previews immediately",async()=>{
    vi.useFakeTimers({toFake:["setTimeout","clearTimeout"]});const t=new Transport(),c=new PhysicalSynthClient(t);
    try{
      await c.setSample({enabled:true,gain:32768,direct:65535,name:'Test',frames:[0,12000,-12000,0]});
      const first=c.previewSample();await vi.advanceTimersByTimeAsync(0);await vi.advanceTimersByTimeAsync(1999);
      expect(t.sent.map(decodePresetSyncFrame).filter(f=>f.payload[1]===25)).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);await first;
      expect(t.sent.map(decodePresetSyncFrame).filter(f=>f.payload[1]===25)).toHaveLength(1);
      await c.previewSample();
      expect(t.sent.map(decodePresetSyncFrame).filter(f=>f.payload[1]===25)).toHaveLength(2);
      await c.start();const restarted=c.previewSample();await vi.advanceTimersByTimeAsync(0);await vi.advanceTimersByTimeAsync(1999);
      expect(t.sent.map(decodePresetSyncFrame).filter(f=>f.payload[1]===25)).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);await restarted;
      expect(t.sent.map(decodePresetSyncFrame).filter(f=>f.payload[1]===25)).toHaveLength(3);
    }finally{c.close();vi.useRealTimers();}
  });

  it("migrates tilt routes to zero and decodes signed flat/tilted motion",()=>{
    const old=physicalPresetFromUnknown({...legacyPreset(),format:"hexboard.physical.v11",tiltRoutes:undefined});expect(old.tiltRoutes).toEqual(Array(66).fill(0));
    const packet=[17,1,1,...encodeU21(49151),...encodeU21(16384),...Array(66).fill(65536).flatMap(encodeU21)];
    expect(decodeMotion(packet).tiltX).toBeCloseTo(.5,3);expect(decodeMotion(packet).tiltY).toBeCloseTo(-.5,3);
    expect(()=>decodeMotion([17,1,1,...encodeU21(65535),...packet.slice(6)])).toThrow();
    const routes=Array(66).fill(0);routes[14]=1;expect(()=>physicalPresetFromUnknown({...initialPreset,tiltRoutes:routes})).toThrow();
  });

  it("round-trips ordered singleton effects and rejects duplicate instances",async()=>{
    const fx={...defaultFx(),order:[4,1,2]};
    expect(physicalPresetFromUnknown({...initialPreset,effects:fx}).effects).toEqual(fx);
    expect(()=>validateFx({...fx,order:[1,1]})).toThrow();
    expect(()=>validateFx({...fx,order:[5]})).toThrow();
    const migrated=physicalPresetFromUnknown({...legacyPreset(),format:"hexboard.physical.v10",effects:{...fx,order:[5,4,1,2]}});
    expect(migrated.effects.order).toEqual(fx.order);expect(migrated.effects.values[0]).toEqual(fx.values[0]);expect(migrated.effects.steps).toHaveLength(16);
    expect(migrated.parameters).toEqual(initialPreset.parameters);
    expect(migrated.format).toBe("hexboard.physical.v22");
    expect(()=>validateFx({...fx,values:[[65536,0,0,0]]})).toThrow();
    const old=physicalPresetFromUnknown({...legacyPreset(),format:"hexboard.physical.v9",effects:undefined});
    expect(old.effects.order).toEqual([]);
    const transport=new Transport(),client=new PhysicalSynthClient(transport);
    const result=await client.effects(fx);expect(result.preset.effects).toEqual(fx);
    expect(decodePresetSyncFrame(transport.sent[0]).payload.slice(2,7)).toEqual([4,1,2,0,0]);
    client.close();
  });
  it("keeps marble material independent and migrates the shared material",()=>{
    const old=legacyPreset();old.parameters[2]=52000;old.parameters[12]=49000;
    const migrated=physicalPresetFromUnknown({...old,format:"hexboard.physical.v12"});
    expect(migrated.parameters.slice(24)).toEqual([52000,49000,0,0,0,0,48000,0,65535]);
    const changed={...migrated,parameters:migrated.parameters.map((v,i)=>i===24?3300:i===25?0:v)};
    expect(physicalPresetFromUnknown(changed).parameters.slice(0,24)).toEqual(migrated.parameters.slice(0,24));
  });
  it("migrates drive off without altering existing sound or routes",()=>{
    const previous={...initialPreset,format:"hexboard.physical.v13",parameters:initialPreset.parameters.slice(0,26),routes:initialPreset.routes.slice(0,78),tiltRoutes:initialPreset.tiltRoutes.slice(0,52)};
    const migrated=physicalPresetFromUnknown(previous);
    expect(migrated.parameters.slice(0,26)).toEqual(previous.parameters);
    expect(migrated.routes.slice(0,78)).toEqual(previous.routes);
    expect(migrated.tiltRoutes.slice(0,52)).toEqual(previous.tiltRoutes);
    expect(migrated.parameters[26]).toBe(0);expect(migrated.routes.slice(78)).toEqual(Array(21).fill(0));expect(migrated.tiltRoutes.slice(52)).toEqual(Array(14).fill(0));
    const driven={...migrated,parameters:migrated.parameters.map((v,i)=>i===26?18000:v),routes:migrated.routes.map((v,i)=>i===79?30000:v)};
    expect(effectiveParameters(driven,[0,1,0])[26]).toBeGreaterThan(effectiveParameters(driven,[0,0,0])[26]);
    expect(renderToStaticMarkup(createElement(PhysicalSynthEditor))).toContain('aria-label="Drive"');
  });
  it("validates presets and rejects unsupported or malformed state before use", () => {
    expect(decodePhysicalState(payload()).preset.parameters).toEqual(initialPreset.parameters);
    expect(() => decodePhysicalState(payload().slice(1))).toThrow();
    expect(() => physicalPresetFromUnknown({ ...initialPreset, routes: [0] })).toThrow();
    expect(() => physicalPresetFromUnknown({ ...initialPreset, parameters: [NaN, 0, 0, 0] })).toThrow();
    expect(() => physicalPresetFromUnknown({ ...initialPreset, routes: Array(12).fill(65537) })).toThrow();
    expect(() => physicalPresetFromUnknown({ ...initialPreset, format: "hexboard-v3" })).toThrow();
  });
  it("encodes fractional retunes and full negative bend independently, then sends complete presets", async () => {
    const t = new Transport(), c = new PhysicalSynthClient(t);
    await Promise.all([c.retuneHz(61, 0, 261.123456), c.bend(-2), c.apply(initialPreset)]);
    const frames = t.sent.map(decodePresetSyncFrame);
    expect(frames.map(f => f.payload[1])).toEqual([6, 5, 7, 13, 17, 0, 11, 0, 24, 0]);
    expect(frames[0].payload.slice(5)).toHaveLength(5);
    expect(frames[1].payload).toEqual([17, 5, 0, 0, 0]);
    expect(frames[2].payload).toHaveLength(399);
    expect(t.listeners.size).toBe(0); c.close();
  });
  it("preserves older presets and maps pressure to pickup without changing output gain", () => {
    const old = physicalPresetFromUnknown({ format: "hexboard.physical.v1", name: "Old String", parameters: [45000, 26000, 36000, 30000], routes: Array(12).fill(0) });
    expect(old.parameters).toHaveLength(33); expect(old.routes).toHaveLength(99);
    expect(old.parameters[7]).toBe(21845);
    const light = effectiveParameters(initialPreset, [0.8, 0, 0]), deep = effectiveParameters(initialPreset, [0.8, 1, 0]);
    expect(deep[5]).toBeGreaterThan(light[5]); expect(deep[7]).toBe(light[7]);
    expect(() => physicalPresetFromUnknown({ ...initialPreset, routes: initialPreset.routes.map((v, i) => i === 21 ? 1 : v) })).toThrow();
  });
  it("preserves older stereo tone and provides a pressure-to-clearance contact preset", () => {
    for (const preset of factoryPhysicalPresets) expect(physicalPresetFromUnknown(preset)).toEqual(preset);
    const old = physicalPresetFromUnknown({ format: "hexboard.physical.v2", name: "Old material", parameters: initialPreset.parameters.slice(0,8), routes: initialPreset.routes.slice(0,24) });
    expect(old.parameters[8]).toBe(0); expect(old.parameters[14]).toBe(old.parameters[5]); expect(old.parameters[15]).toBe(0);
    const v3 = physicalPresetFromUnknown({format:"hexboard.physical.v3",name:"Older contact",parameters:initialPreset.parameters.slice(0,16),routes:initialPreset.routes.slice(0,48)});
    expect(v3.parameters.slice(16)).toEqual([32768,0,32768,22000,16000,0,12000,30000,initialPreset.parameters[2],10000,0,0,0,0,48000,0,65535]); expect(v3.routes.slice(48)).toEqual(Array(51).fill(0));
    const marbles = factoryPhysicalPresets.find(p => p.name === "Falling Marbles")!;
    expect(marbles.parameters[16]).toBeGreaterThan(32768); expect(marbles.parameters[17]).toBeGreaterThan(0);
    const bounce = factoryPhysicalPresets.find(p => p.name === "Pressure Bounce")!;
    expect(effectiveParameters(bounce,[1,1,0])[9]).toBeLessThan(effectiveParameters(bounce,[1,0,0])[9]);
    expect(() => physicalPresetFromUnknown({ ...bounce, routes: bounce.routes.map((v,i) => i === 25 ? 1 : v) })).toThrow();
  });
  it("migrates split hardness into one striker without repurposing its old route as resonance",()=>{
    const parameters=initialPreset.parameters.slice(0,20); parameters[8]=65535; parameters[12]=52000;
    const routes=initialPreset.routes.slice(0,60); routes[37]=-16000;
    const migrated=physicalPresetFromUnknown({format:"hexboard.physical.v5",name:"Marbles",parameters,routes});
    expect(migrated.parameters[2]).toBe(52000); expect(migrated.routes[7]).toBe(-16000);
    expect(migrated.parameters[12]).toBe(10000); expect(migrated.routes.slice(36,39)).toEqual([0,0,0]);
    expect(migrated.parameters[20]).toBe(16000);
    expect(()=>decodePhysicalState([5,...payload().slice(1)])).toThrow();
  });
  it("preserves legacy release times and exposes long releases and independent bow controls",()=>{
    const migrated=physicalPresetFromUnknown({format:"hexboard.physical.v6",name:"Old tail",parameters:initialPreset.parameters.slice(0,21).map((v,i)=>i===3?50000:v),routes:Array(63).fill(0)});
    expect(Math.abs(releaseSeconds(migrated.parameters[3])-(.03+.57*50000/65535))).toBeLessThan(.00002);
    expect(releaseSeconds(65535)).toBeCloseTo(12,3);
    const bow=factoryPhysicalPresets.find(p=>p.name==="Pressure Bow")!;
    expect(bow.parameters[21]).toBe(65535);expect(effectiveParameters(bow,[.8,1,0])[22]).toBeGreaterThan(effectiveParameters(bow,[.8,0,0])[22]);
    expect(()=>physicalPresetFromUnknown({...bow,routes:bow.routes.map((v,i)=>i===64?1:v)})).toThrow();
  });
  it("removes preset output boosts without resetting saved attenuation",()=>{
    for(const p of factoryPhysicalPresets) expect(p.parameters[7]).toBe(21845);
    for(const level of [0,12000,21845,43690,65535]) {
      const old={...legacyPreset(),format:"hexboard.physical.v7",parameters:legacyPreset().parameters.map((v,i)=>i===7?level:v)};
      const migrated=physicalPresetFromUnknown(old);
      expect(migrated.parameters[7]).toBe(Math.min(level,21845));
      expect(migrated.parameters.slice(0,24).filter((_,i)=>i!==7)).toEqual(old.parameters.filter((_,i)=>i!==7));
      expect(migrated.routes.slice(0,72)).toEqual(old.routes);
    }
  });
  it("migrates legacy engine-less presets and round-trips every saved engine", async () => {
    const legacy = {...legacyPreset(),format:"hexboard.physical.v8",velocityEngine:undefined};
    expect(physicalPresetFromUnknown(legacy).velocityEngine).toBe(0);
    expect(factoryPhysicalPresets.find(p=>p.name==="Pressure Bow")!.velocityEngine).toBe(4);
    for (const velocityEngine of [0,1,2,3,4] as const) {
      const preset = {...initialPreset,velocityEngine};
      expect(physicalPresetFromUnknown(JSON.parse(JSON.stringify(preset)))).toEqual(preset);
      expect(decodePhysicalState([...payload().slice(0,-1),velocityEngine]).preset.velocityEngine).toBe(velocityEngine);
    }
    for (const velocityEngine of [-1,5,1.5,undefined,"4"]) {
      expect(()=>physicalPresetFromUnknown({...initialPreset,velocityEngine})).toThrow();
    }
    expect(()=>decodePhysicalState([...payload().slice(0,-1),5])).toThrow();
    const transport=new Transport(),client=new PhysicalSynthClient(transport);
    await client.velocityEngine(4); await client.apply({...initialPreset,velocityEngine:4});
    const frames=transport.sent.map(decodePresetSyncFrame);
    expect(frames[0].payload).toEqual([17,9,4]);
    expect(frames[1].payload.at(-1)).toBe(4);
    expect(frames[1].payload).toHaveLength(399);
    client.close();
  });
  it("encodes arbitrary frequencies with less than a millihertz of pairwise beat error", () => {
    const decode = (hz: number) => 2 ** ((encodeLogPitchHz(hz).reduce((v, b) => v * 128 + b, 0) - 2 ** 31) / 2 ** 24);
    for (const hz of [12.25, 261.123456, 1000, 4000]) {
      expect(Math.abs((decode(hz + 0.1) - decode(hz)) - 0.1)).toBeLessThan(0.001);
    }
    expect(() => encodeLogPitchHz(NaN)).toThrow(); expect(() => encodeLogPitchHz(0)).toThrow();
    expect(decodePhysicalExpression([17, 0, 61, 1, 100, ...encodeU21(32768), 0]).pressure).toBe(32768);
    expect(() => decodePhysicalExpression([17, 0, 61, 1, 100, ...encodeU21(65536), 0])).toThrow();
  });
  it("loads, edits and reconnects non-default envelope/LFO controls and signed routes",async()=>{
    const transport=new Transport(),client=new PhysicalSynthClient(transport);const modulation=defaultModulation();modulation.settings[0]=55000;modulation.settings[9]=52428;modulation.routes[14]=65536;modulation.routes[11]=-24000;
    expect((await client.apply({...initialPreset,modulation})).preset.modulation).toEqual(modulation);
    expect((await client.read()).preset.modulation).toEqual(modulation);
    await client.modSetting(8,44000);await client.modRoute(5,1,-32000);const changed=await client.read();expect(changed.preset.modulation.settings[8]).toBe(44000);expect(changed.preset.modulation.routes[11]).toBe(-32000);client.close();
  });
  it("cancels pending operations and detaches listeners on disconnect", async () => {
    const t = new Transport(); t.respond = false;
    const c = new PhysicalSynthClient(t), pending = c.read();
    await Promise.resolve(); await Promise.resolve();
    c.close(); await expect(pending).rejects.toThrow("disconnected");
    expect(t.listeners.size).toBe(0);
    await expect(c.read()).rejects.toThrow("disconnected");
  });
  it("restores a browser draft instead of replacing it with factory defaults", () => {
    vi.stubGlobal("window", { localStorage: { getItem: (key: string) => key.endsWith("draft.v1")
      ? JSON.stringify({ ...initialPreset, name: "Retained draft", parameters: initialPreset.parameters.map((v, i) => i ? v : 5566) }) : "[]" } });
    try {
      const html = renderToStaticMarkup(createElement(PhysicalSynthEditor));
      expect(html).toContain('value="Retained draft"');
      expect(html).toContain('aria-valuenow="5566"');
    } finally { vi.unstubAllGlobals(); }
  });
  it("shows bow character and independent impact editing for a retained bow/marble patch",()=>{
    const bow=factoryPhysicalPresets.find(p=>p.name==="Pressure Bow")!;
    const patch={...bow,parameters:bow.parameters.map((v,i)=>i===8?65535:v)};
    vi.stubGlobal("window",{localStorage:{getItem:(key:string)=>key.endsWith("draft.v1")?JSON.stringify(patch):"[]"}});
    try {
      const html=renderToStaticMarkup(createElement(PhysicalSynthEditor));
      expect(html).toContain('aria-label="Bow character"');
      expect(html).not.toContain('aria-label="Exciter pad editing"');expect(html).toContain('aria-label="Marble material"');
      expect(html).toMatch(/checked=""[^>]*value="1"/);
      expect(html).toContain('value="0"');
      expect(html).not.toContain('aria-label="Striker material"');
      expect(html).toContain('aria-label="Bow speed"');expect(html).toContain('aria-label="Bow force"');
    } finally {vi.unstubAllGlobals();}
  });
  it("keeps activation visible offline and explains how to connect", () => {
    const html = renderToStaticMarkup(createElement(PhysicalSynthEditor));
    expect(html).toContain("Physical Strings"); expect(html).toContain("Release velocity");
    expect(html).toContain('aria-label="Strike"'); expect(html).toContain('aria-label="Pickup L"'); expect(html).toContain('aria-label="Pickup R"');
    expect(html).toContain('aria-label="Strike position"'); expect(html).toContain('aria-label="Left pickup"');
    expect(html).toContain('aria-label="Stiffness"'); expect(html).toContain('aria-label="Material loss"');
    expect(html).toContain('aria-label="Modulation tools"');
    expect(html).toContain('Delete modulation');
    expect(html).toContain('role="radiogroup" aria-label="Excitation mode"');
    expect((html.match(/name="physical-exciter-mode"/g)??[])).toHaveLength(3);
    expect(html.match(/type="range"/g)).toHaveLength(2); // Compact, non-modulatable Body EQ controls.
    expect(html).not.toContain('<details');
    expect(html).toContain('aria-label="Velocity engine"'); expect(html).toContain("Fixed Velocity");
    expect(html).toContain("Stereo width"); expect(html).toContain("Bounce");
    expect(html).toContain("Pressure preview"); expect(html.match(/type="number"/g)).toHaveLength(1); expect(html).toContain('aria-label="Performance BPM"');
    expect(html).toContain("Save on computer");
    expect(html).toContain("Start synth"); expect(html).toContain("Connect Advanced to play");
    expect(html).toContain("Use Connect HexBoard above");
  });
});

it("migrates existing patches with preparation bypassed and normal strike shape",()=>{
 const old={...initialPreset,format:"hexboard.physical.v15",parameters:initialPreset.parameters.slice(0,28),routes:initialPreset.routes.slice(0,84),tiltRoutes:initialPreset.tiltRoutes.slice(0,56)};
 const next=physicalPresetFromUnknown(old);expect(next.parameters.slice(0,28)).toEqual(old.parameters);expect(next.parameters.slice(28)).toEqual([0,0,48000,0,65535]);
 const invalid={...next,routes:[...next.routes]};invalid.routes[93]=1;expect(()=>physicalPresetFromUnknown(invalid)).toThrow();
});

it("migrates contact timing to note on and preserves release contact",()=>{
 const old={...initialPreset,format:"hexboard.physical.v18",parameters:initialPreset.parameters.slice(0,31),routes:initialPreset.routes.slice(0,93),tiltRoutes:initialPreset.tiltRoutes.slice(0,62),modulation:{...initialPreset.modulation,routes:initialPreset.modulation.routes.slice(0,62)}};
 const next=physicalPresetFromUnknown(old);expect(next.parameters[31]).toBe(0);
 next.parameters[31]=65535;expect(physicalPresetFromUnknown(JSON.parse(JSON.stringify(next)))).toEqual(next);
 const invalid={...next,modulation:{...next.modulation,routes:[...next.modulation.routes]}};invalid.modulation.routes[62]=1;expect(()=>physicalPresetFromUnknown(invalid)).toThrow();
});

it("retires Gentle drive while preserving the rest of an imported sound",()=>{
 const old={...initialPreset,format:"hexboard.physical.v19",parameters:initialPreset.parameters.slice(0,32),routes:initialPreset.routes.slice(0,96),tiltRoutes:initialPreset.tiltRoutes.slice(0,64),modulation:{...initialPreset.modulation,routes:initialPreset.modulation.routes.slice(0,64)}};old.parameters[30]=65535;
 const loaded=physicalPresetFromUnknown(old);expect(loaded.parameters[30]).toBe(48000);expect(loaded.parameters.slice(0,30)).toEqual(old.parameters.slice(0,30));
 const html=renderToStaticMarkup(createElement(PhysicalSynthEditor));expect(html).not.toContain("Drive behavior");expect(html).not.toContain("Gentle");
});

 it("migrates six-route patches explicitly and keeps gain then strongest routes",()=>{
 const modulation=defaultModulation();for(const id of [0,1,3,5,6,7])modulation.routes[id*2]=id===7?1:id*1000+100;
 const p=physicalPresetFromUnknown({...initialPreset,format:"hexboard.physical.v19",parameters:initialPreset.parameters.slice(0,32),routes:initialPreset.routes.slice(0,96),tiltRoutes:initialPreset.tiltRoutes.slice(0,64),modulation:{...modulation,routes:modulation.routes.slice(0,64)}});
 expect(p.modulation.routes.filter(Boolean)).toHaveLength(4);expect(p.modulation.routes[14]).toBe(1);expect(p.modulation.routes[0]).toBe(0);expect(p.modulation.routes[2]).toBe(0);expect(p.migrationNotes?.join()).toContain("2 assignments removed");
 expect(modulation.routes.filter(Boolean)).toHaveLength(6);
 const saved=physicalPresetFromUnknown(JSON.parse(JSON.stringify(p)));expect(saved).toEqual(p);
 });
 it("round trips Body controls, pin position and irregularity without enabling delay",()=>{
 const p=physicalPresetFromUnknown({...initialPreset,effects:{...defaultFx(),values:defaultFx().values.map((row,i)=>i===4?[40000,12000,63000,24000]:row)},parameters:initialPreset.parameters.map((v,i)=>i===28?48000:i===29?50000:i===30?8000:v)});
 expect(physicalPresetFromUnknown(JSON.parse(JSON.stringify(p)))).toEqual(p);expect(p.effects.order).toEqual([]);
 const m=defaultModulation();m.routes[56]=1000;m.routes[60]=2000;expect(validateModulation(m)).toEqual(m);
 const html=renderToStaticMarkup(createElement(PhysicalSynthEditor));for(const name of ["Body size and material","Body Intensity","Irregularity","Pin position"])expect(html).toContain(name);expect(html).not.toContain('aria-label="Strike shape"');
 });

it("migrates the previous direct sample mix and accepts live pressure/LFO routes",()=>{
 const old={...initialPreset,format:"hexboard.physical.v21",parameters:initialPreset.parameters.slice(0,32),routes:initialPreset.routes.slice(0,96),tiltRoutes:initialPreset.tiltRoutes.slice(0,64),modulation:{...defaultModulation(),routes:Array(64).fill(0)},sample:{...initialPreset.sample,direct:17000}};
 const next=physicalPresetFromUnknown(old);expect(next.parameters[32]).toBe(17000);expect(next.routes.slice(96)).toEqual([0,0,0]);
 next.routes[97]=22000;next.modulation.routes[65]=16000;const p=physicalPresetFromUnknown(next);expect(effectiveParameters(p,[0,1,0,0,0,0,1])[32]).toBeCloseTo(17000/65535+38000/65536);
});

it('applies loop geometry while stopped and resumes after configuration',async()=>{
 const t=new Transport(),c=new PhysicalSynthClient(t);
 try{await c.setSample({enabled:true,gain:32768,direct:65535,name:'Loop',frames:Array(1600).fill(10000),loop:{mode:1,start:100,end:1400,crossfade:160}});const commands=t.sent.map(decodePresetSyncFrame).map(f=>f.payload);const loop=commands.findIndex(p=>p[1]===27);expect(commands[loop]).toEqual([17,27,1,...encodeU21(100),...encodeU21(1400),...encodeU21(160)]);expect(commands.slice(0,loop).some(p=>p[1]===2)).toBe(true);expect(commands.slice(loop+1).some(p=>p[1]===1)).toBe(true);expect(t.state).toBe(1);}finally{c.close();}
});

it('fades performance-gated controls and disables the associated Drive characters',()=>{
 for(const priority of [0,1] as const)for(const fullRack of [false,true]){
  const patch={...initialPreset,sample:{...initialPreset.sample,enabled:true,priority,frames:[0,12000,-12000,0]},effects:{...defaultFx(),order:fullRack?[1,2,3]:[1,2]}};
  vi.stubGlobal('window',{localStorage:{getItem:(key:string)=>key.endsWith('draft.v1')?JSON.stringify(patch):'[]'}});
  try{const html=renderToStaticMarkup(createElement(PhysicalSynthEditor));
   for(const name of ['Drive','Pin pressure','Pin position']){const group=html.match(new RegExp('<div class="physical-control"([^>]*)><strong>'+name+'</strong>'));expect(group).not.toBeNull();const gated=fullRack&&(name==='Drive'?priority===1:priority===0);expect(group![1].includes('data-unavailable="true"')).toBe(gated);if(gated)expect(group![1]).toContain('data-modulatable="false"');}
   const characters=html.match(/<div class="source-tabs drive-characters"([^>]*)>([\s\S]*?)<\/div>/)!;expect(characters[1].includes('data-unavailable="true"')).toBe(fullRack&&priority===1);if(fullRack&&priority===1)expect(characters[2].match(/disabled=""/g)).toHaveLength(3);
  }finally{vi.unstubAllGlobals();}
 }
});

it('reports acknowledged sample frames and clears progress after completion',async()=>{
 const t=new Transport(),events:(Progress|undefined)[]=[],c=new PhysicalSynthClient(t,p=>events.push(p));
 try{await c.setSample({enabled:true,gain:32768,direct:65535,name:'Progress',frames:Array(1024).fill(1000)});const sent=events.filter((p):p is Progress=>p?.label==='Sending sample…');expect(sent[0]).toMatchObject({completed:0,total:1024});expect(sent.at(-1)).toMatchObject({completed:1024,total:1024});expect(sent.map(p=>p.completed)).toEqual([...sent.map(p=>p.completed)].sort((a,b)=>a!-b!));expect(events.some(p=>p?.label==='Preparing synth…'&&p.completed===undefined)).toBe(true);expect(events.at(-1)).toBeUndefined();}finally{c.close();}
});
it('clears sample progress when the connection is closed mid-operation',async()=>{
 vi.useFakeTimers();const t=new Transport();t.respond=false;const events:(Progress|undefined)[]=[],c=new PhysicalSynthClient(t,p=>events.push(p));
 try{const pending=c.setSample({enabled:true,gain:32768,direct:65535,name:'Cancel',frames:[0,1000,-1000,0]});const rejected=expect(pending).rejects.toThrow('disconnected');await vi.advanceTimersByTimeAsync(0);c.close();await rejected;expect(events.at(-1)).toBeUndefined();expect(t.listeners.size).toBe(0);}finally{c.close();vi.useRealTimers();}
});
it('renders measured transfer progress and honest indeterminate preparation',()=>{
 const measured=renderToStaticMarkup(createElement(SynthProgress,{progress:{label:'Sending sample…',completed:512,total:1024}}));expect(measured).toContain('50%');expect(measured).toContain('value="512"');expect(measured).toContain('max="1024"');
 const waiting=renderToStaticMarkup(createElement(SynthProgress,{progress:{label:'Starting synth…'}}));expect(waiting).toContain('<progress');expect(waiting).not.toContain('value=');expect(waiting).not.toContain('%');
});

it('stores explicit loads while stopped, after the complete patch, then resumes',async()=>{
 const t=new Transport(),c=new PhysicalSynthClient(t),events:(Progress|undefined)[]=[];
 const observed=new PhysicalSynthClient(t,p=>events.push(p));
 try{await observed.load(initialPreset);const ops=t.sent.map(decodePresetSyncFrame).map(f=>f.payload[1]);const save=ops.indexOf(28);expect(save).toBeGreaterThan(ops.indexOf(24));expect(ops.slice(0,save)).toContain(2);expect(ops.slice(save+1)).toContain(1);expect(t.state).toBe(1);expect(events.some(p=>p?.label==='Saving startup patch…')).toBe(true);}finally{c.close();observed.close();}
});
it('does not save ordinary RAM apply or live parameter changes',async()=>{
 const t=new Transport(),c=new PhysicalSynthClient(t);try{await c.apply(initialPreset);await c.parameter(0,30000);expect(t.sent.map(decodePresetSyncFrame).some(f=>f.payload[1]===28)).toBe(false);}finally{c.close();}
});
