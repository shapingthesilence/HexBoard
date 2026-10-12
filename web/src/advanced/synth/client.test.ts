import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { encodeDefaultPresetSyncFrame, decodePresetSyncFrame, encodeU21 } from "../../protocol/index.ts";
import type { MidiMessageListener, MidiTransport } from "../../midi/types.ts";
import { PhysicalSynthClient, decodePhysicalState, decodePhysicalExpression, decodeMotion } from "./client.ts";
import { initialPreset, factoryPhysicalPresets, physicalPresetFromUnknown, encodeLogPitchHz, effectiveParameters, releaseSeconds, defaultFx, validateFx } from "./schema.ts";
import { PhysicalSynthEditor } from "./PhysicalSynthEditor.tsx";

function payload() { return [13, 1, 2, ...encodeU21(131072), ...initialPreset.parameters.flatMap(encodeU21), ...initialPreset.routes.flatMap(v => encodeU21(v + 65536)), initialPreset.velocityEngine]; }
class Transport implements MidiTransport {
  label = "Advanced test";
  listeners = new Set<MidiMessageListener>();
  sent: number[][] = [];
  respond = true;
  async send(bytes: ArrayLike<number>) {
    this.sent.push(Array.from(bytes));
    const frame = decodePresetSyncFrame(bytes);
    const motion=frame.payload[1]>=12;
    const fx=frame.payload[1]>=10;
    const motionResponse=[13,1,1,...encodeU21(32767),...encodeU21(32767),...(frame.payload[1]===13?frame.payload.slice(2):Array(62).fill(65536).flatMap(encodeU21))];
    const response=frame.payload[1]===11?[13,...frame.payload.slice(2)]:[13,0,0,0,0,0,...defaultFx().values.flat().flatMap(encodeU21)];
    if (this.respond) for (const listener of this.listeners) listener(Uint8Array.from(encodeDefaultPresetSyncFrame(motion?0x38:fx?0x37:0x35, frame.transactionId, motion?motionResponse:fx?response:payload())));
  }
  subscribe(listener: MidiMessageListener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
}
const legacyPreset=()=>({...initialPreset,parameters:initialPreset.parameters.slice(0,24),routes:initialPreset.routes.slice(0,72),tiltRoutes:initialPreset.tiltRoutes.slice(0,48)});
describe("Advanced physical editor", () => {
  it("migrates tilt routes to zero and decodes signed flat/tilted motion",()=>{
    const old=physicalPresetFromUnknown({...legacyPreset(),format:"hexboard.physical.v11",tiltRoutes:undefined});expect(old.tiltRoutes).toEqual(Array(62).fill(0));
    const packet=[13,1,1,...encodeU21(49151),...encodeU21(16384),...Array(62).fill(65536).flatMap(encodeU21)];
    expect(decodeMotion(packet).tiltX).toBeCloseTo(.5,3);expect(decodeMotion(packet).tiltY).toBeCloseTo(-.5,3);
    expect(()=>decodeMotion([13,1,1,...encodeU21(65535),...packet.slice(6)])).toThrow();
    const routes=Array(62).fill(0);routes[14]=1;expect(()=>physicalPresetFromUnknown({...initialPreset,tiltRoutes:routes})).toThrow();
  });

  it("round-trips ordered singleton effects and rejects duplicate instances",async()=>{
    const fx={...defaultFx(),order:[4,1,2]};
    expect(physicalPresetFromUnknown({...initialPreset,effects:fx}).effects).toEqual(fx);
    expect(()=>validateFx({...fx,order:[1,1]})).toThrow();
    expect(()=>validateFx({...fx,order:[5]})).toThrow();
    const migrated=physicalPresetFromUnknown({...legacyPreset(),format:"hexboard.physical.v10",effects:{...fx,order:[5,4,1,2]}});
    expect(migrated.effects).toEqual(fx);
    expect(migrated.parameters).toEqual(initialPreset.parameters);
    expect(migrated.format).toBe("hexboard.physical.v17");
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
    expect(migrated.parameters.slice(24)).toEqual([52000,49000,0,0,0,0,0]);
    const changed={...migrated,parameters:migrated.parameters.map((v,i)=>i===24?3300:i===25?0:v)};
    expect(physicalPresetFromUnknown(changed).parameters.slice(0,24)).toEqual(migrated.parameters.slice(0,24));
  });
  it("migrates drive off without altering existing sound or routes",()=>{
    const previous={...initialPreset,format:"hexboard.physical.v13",parameters:initialPreset.parameters.slice(0,26),routes:initialPreset.routes.slice(0,78),tiltRoutes:initialPreset.tiltRoutes.slice(0,52)};
    const migrated=physicalPresetFromUnknown(previous);
    expect(migrated.parameters.slice(0,26)).toEqual(previous.parameters);
    expect(migrated.routes.slice(0,78)).toEqual(previous.routes);
    expect(migrated.tiltRoutes.slice(0,52)).toEqual(previous.tiltRoutes);
    expect(migrated.parameters[26]).toBe(0);expect(migrated.routes.slice(78)).toEqual(Array(15).fill(0));expect(migrated.tiltRoutes.slice(52)).toEqual(Array(10).fill(0));
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
    expect(frames.map(f => f.payload[1])).toEqual([6, 5, 7, 13, 11, 0]);
    expect(frames[0].payload.slice(5)).toHaveLength(5);
    expect(frames[1].payload).toEqual([13, 5, 0, 0, 0]);
    expect(frames[2].payload).toHaveLength(375);
    expect(t.listeners.size).toBe(0); c.close();
  });
  it("preserves older presets and maps pressure to pickup without changing output gain", () => {
    const old = physicalPresetFromUnknown({ format: "hexboard.physical.v1", name: "Old String", parameters: [45000, 26000, 36000, 30000], routes: Array(12).fill(0) });
    expect(old.parameters).toHaveLength(31); expect(old.routes).toHaveLength(93);
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
    expect(v3.parameters.slice(16)).toEqual([32768,0,32768,22000,16000,0,12000,30000,initialPreset.parameters[2],10000,0,0,0,0,0]); expect(v3.routes.slice(48)).toEqual(Array(45).fill(0));
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
    expect(frames[0].payload).toEqual([13,9,4]);
    expect(frames[1].payload.at(-1)).toBe(4);
    expect(frames[1].payload).toHaveLength(375);
    client.close();
  });
  it("encodes arbitrary frequencies with less than a millihertz of pairwise beat error", () => {
    const decode = (hz: number) => 2 ** ((encodeLogPitchHz(hz).reduce((v, b) => v * 128 + b, 0) - 2 ** 31) / 2 ** 24);
    for (const hz of [12.25, 261.123456, 1000, 4000]) {
      expect(Math.abs((decode(hz + 0.1) - decode(hz)) - 0.1)).toBeLessThan(0.001);
    }
    expect(() => encodeLogPitchHz(NaN)).toThrow(); expect(() => encodeLogPitchHz(0)).toThrow();
    expect(decodePhysicalExpression([13, 0, 61, 1, 100, ...encodeU21(32768), 0]).pressure).toBe(32768);
    expect(() => decodePhysicalExpression([13, 0, 61, 1, 100, ...encodeU21(65536), 0])).toThrow();
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
    expect((html.match(/name="physical-exciter-mode"/g)??[])).toHaveLength(2);
    expect(html).not.toContain('type="range"');
    expect(html).not.toContain('<details');
    expect(html).toContain('aria-label="Velocity engine"'); expect(html).toContain("Fixed Velocity");
    expect(html).toContain("Stereo width"); expect(html).toContain("Bounce");
    expect(html).toContain("Pressure preview"); expect(html).not.toContain('type="number"');
    expect(html).toContain("Save on computer");
    expect(html).toContain("Start synth"); expect(html).toContain("Connect Advanced to play");
    expect(html).toContain("Use Connect HexBoard above");
  });
});

it("migrates existing patches with preparation bypassed and normal strike shape",()=>{
 const old={...initialPreset,format:"hexboard.physical.v15",parameters:initialPreset.parameters.slice(0,28),routes:initialPreset.routes.slice(0,84),tiltRoutes:initialPreset.tiltRoutes.slice(0,56)};
 const next=physicalPresetFromUnknown(old);expect(next.parameters.slice(0,28)).toEqual(old.parameters);expect(next.parameters.slice(28)).toEqual([0,0,0]);
 const invalid={...next,routes:[...next.routes]};invalid.routes[84]=1;expect(()=>physicalPresetFromUnknown(invalid)).toThrow();
});
