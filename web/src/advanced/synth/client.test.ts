import {DevicePresetLibrary} from './DevicePresetLibrary.tsx';
import {SynthRequestCancelledError,synthErrorMessage} from "./requestError.ts";
import {SynthProgress} from './SynthProgress.tsx';
import type {SynthProgress as Progress} from './progress.ts';
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { encodeDefaultPresetSyncFrame, decodePresetSyncFrame, encodeU14, encodeU21 } from "../../protocol/index.ts";
import type { MidiMessageListener, MidiTransport } from "../../midi/types.ts";
import { PhysicalSynthClient, decodePhysicalState, decodePhysicalExpression, decodeMotion, decodeModulation } from "./client.ts";
import { initialPreset, factoryPhysicalPresets, physicalPresetFromUnknown, encodeLogPitchHz, effectiveParameters, releaseSeconds, defaultModulation, validateModulation, defaultFx, validateFx } from "./schema.ts";
import { PhysicalSynthEditor } from "./PhysicalSynthEditor.tsx";

function payload() { return [17, 1, 2, ...encodeU21(131072), ...initialPreset.parameters.flatMap(encodeU21), ...initialPreset.routes.flatMap(v => encodeU21(v + 65536)), initialPreset.velocityEngine]; }
class Transport implements MidiTransport {
  label = "Advanced test";
  listeners = new Set<MidiMessageListener>();
  sent: number[][] = [];
  samplerBytes=0;samplerReceived=0;badSamplerOffset=false;respond = true;state = 1;sampleLoop:number[]|undefined;sampleReplyLength?:number;catalogReplies?:number[][];
  modulation=defaultModulation();
  async send(bytes: ArrayLike<number>) {
    this.sent.push(Array.from(bytes));
    const frame = decodePresetSyncFrame(bytes);
    if(frame.payload[1]===1)this.state=1;if(frame.payload[1]===2)this.state=0;
    if(frame.payload[1]===64){const reply=[17,...frame.payload.slice(2,4),4,...Array(288).fill(0)];queueMicrotask(()=>this.listeners.forEach(l=>l(Uint8Array.from(encodeDefaultPresetSyncFrame(0x48,frame.transactionId,reply)))));return;}
    if(frame.payload[1]===69){const bytes=frame.payload[2]?frame.payload.slice(3):Array(256).fill(0);queueMicrotask(()=>this.listeners.forEach(l=>l(Uint8Array.from(encodeDefaultPresetSyncFrame(0x4a,frame.transactionId,[17,...bytes])))));return;}
    if(frame.payload[1]>=65&&frame.payload[1]<=67){const op=frame.payload[1],n=(p:number[])=>p.reduce((x,y)=>x*128+y,0),encoded=(x:number)=>Array.from({length:5},(_,i)=>Math.floor(x/128**(4-i))%128);if(op===65){const at=5+frame.payload[3]+frame.payload[4];this.samplerBytes=n(frame.payload.slice(at,at+5));this.samplerReceived=0;}if(op===66)this.samplerReceived=n(frame.payload.slice(2,7))+n(frame.payload.slice(7,9));const received=op===67?this.samplerBytes:this.samplerReceived+(this.badSamplerOffset?1:0);queueMicrotask(()=>this.listeners.forEach(l=>l(Uint8Array.from(encodeDefaultPresetSyncFrame(0x49,frame.transactionId,[17,...encoded(received)])))));return;}
    if(frame.payload[1]===28){queueMicrotask(()=>this.listeners.forEach(l=>l(Uint8Array.from(encodeDefaultPresetSyncFrame(0x35,frame.transactionId,[17,this.state,...payload().slice(2)])))));return;}
    if(frame.payload[1]>=46&&frame.payload[1]<=51){queueMicrotask(()=>this.listeners.forEach(l=>l(Uint8Array.from(encodeDefaultPresetSyncFrame(0x35,frame.transactionId,[17,this.state,...payload().slice(2)])))));return;}
    if(frame.payload[1]===52){const values=frame.payload.length===11?frame.payload.slice(2):[1,2,0,...encodeU21(0),...encodeU21(4095)];const reply=[17,...values,...encodeU21(1000),...encodeU21(2000),1,0,1,...encodeU21(32768),...encodeU21(0)];queueMicrotask(()=>this.listeners.forEach(l=>l(Uint8Array.from(encodeDefaultPresetSyncFrame(0x40,frame.transactionId,reply)))));return;}
    if(frame.payload[1]>=53&&frame.payload[1]<=55){const reply=[17,...(frame.payload[1]===53?frame.payload.slice(2):Array(66).fill(65536).flatMap(encodeU21))];queueMicrotask(()=>this.listeners.forEach(l=>l(Uint8Array.from(encodeDefaultPresetSyncFrame(0x41,frame.transactionId,reply)))));return;}
    if(frame.payload[1]===37){const reply=[17,0,8,8,8,2,0,0,0,0,0,0,0,...encodeU21(0),4];queueMicrotask(()=>this.listeners.forEach(l=>l(Uint8Array.from(encodeDefaultPresetSyncFrame(0x3e,frame.transactionId,reply)))));return;}
    if(frame.payload[1]===61||frame.payload[1]===62){queueMicrotask(()=>this.listeners.forEach(l=>l(Uint8Array.from(encodeDefaultPresetSyncFrame(0x45,frame.transactionId,[17])))));return;}
    if((frame.payload[1]===57||frame.payload[1]===58)&&this.catalogReplies){const reply=this.catalogReplies.shift()!;queueMicrotask(()=>this.listeners.forEach(l=>l(Uint8Array.from(encodeDefaultPresetSyncFrame(0x43,frame.transactionId,reply)))));return;}
    if(frame.payload[1]===57||frame.payload[1]===58){const phase=frame.payload[1]===58?1:2,reply=[17,2,phase,0,0,0,phase===1?0:2,phase===1?0:100,0,0,0,0,phase===1?0:1,...encodeU21(phase===1?0:100),...encodeU21(phase===1?0:400),2,0,...encodeU14(3072),32,...encodeU21(8000)];queueMicrotask(()=>this.listeners.forEach(l=>l(Uint8Array.from(encodeDefaultPresetSyncFrame(0x43,frame.transactionId,reply)))));return;}
    if(frame.payload[1]===59){const b=new Uint8Array(128);b[8]=5;b.set(new TextEncoder().encode('High ID sound'),12);const reply=[17,...frame.payload.slice(2,4),...Array.from(b).flatMap(v=>[v>>7,v&127])];queueMicrotask(()=>this.listeners.forEach(l=>l(Uint8Array.from(encodeDefaultPresetSyncFrame(0x44,frame.transactionId,reply)))));return;}
    if(frame.payload[1]===60){const b=new Uint8Array(48);new DataView(b.buffer).setUint32(0,0x80000000,true);b.set(new TextEncoder().encode('Glass'),4);const reply=[17,...frame.payload.slice(2,4),...Array.from({length:frame.payload[3]},()=>Array.from(b).flatMap(v=>[v>>7,v&127])).flat()];queueMicrotask(()=>this.listeners.forEach(l=>l(Uint8Array.from(encodeDefaultPresetSyncFrame(0x46,frame.transactionId,reply)))));return;}
    const modulation=frame.payload[1]>=16;
    if(frame.payload[1]===17)this.modulation=decodeModulation([17,...frame.payload.slice(2)]);
    if(frame.payload[1]===18)this.modulation.settings[frame.payload[2]]=decodeModulation([17,...this.modulation.settings.map((v,i)=>i===frame.payload[2]?frame.payload.slice(3).reduce((a,b)=>a*128+b,0):v).flatMap(encodeU21),...this.modulation.routes.flatMap(v=>encodeU21(v+65536))]).settings[frame.payload[2]];
    if(frame.payload[1]===19)this.modulation.routes[frame.payload[2]*2+frame.payload[3]]=frame.payload.slice(4).reduce((a,b)=>a*128+b,0)-65536;
    const modResponse=[17,...this.modulation.settings.flatMap(encodeU21),...this.modulation.routes.flatMap(v=>encodeU21(v+65536))];
    const motion=frame.payload[1]>=12;
    const fx=frame.payload[1]>=10;
    const motionResponse=[17,1,1,...encodeU21(32767),...encodeU21(32767),...(frame.payload[1]===13?frame.payload.slice(2):Array(66).fill(65536).flatMap(encodeU21))];
    if(frame.payload[1]===27)this.sampleLoop=frame.payload.slice(2);
    if(frame.payload[1]>=20){const sample=[17,0,...encodeU21(32768),...encodeU21(this.sampleLoop?1600:0),0,0,0,0,0,0,...encodeU21(65535),...(this.sampleLoop??[0,...encodeU21(0),...encodeU21(0),...encodeU21(0)])];const reply=this.sampleReplyLength===undefined?sample:Array.from({length:this.sampleReplyLength},(_,i)=>sample[i]??0);queueMicrotask(()=>this.listeners.forEach(l=>l(Uint8Array.from(encodeDefaultPresetSyncFrame(0x3b,frame.transactionId,reply)))));return;}
    const response=frame.payload[1]===11?[17,...frame.payload.slice(2)]:[17,0,0,0,0,0,...defaultFx().values.flat().flatMap(encodeU21),...defaultFx().steps.flatMap(encodeU21),...Array(70).fill(65536).flatMap(encodeU21)];
    if (this.respond) for (const listener of this.listeners) listener(Uint8Array.from(encodeDefaultPresetSyncFrame(modulation?0x39:motion?0x38:fx?0x37:0x35, frame.transactionId, modulation?modResponse:motion?motionResponse:fx?response:[17,this.state,...payload().slice(2)])));
  }
  subscribe(listener: MidiMessageListener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
}
describe("Advanced physical editor", () => {
  it('refreshes SD names without stopping the active synth',async()=>{const t=new Transport(),c=new PhysicalSynthClient(t);try{expect(await c.samplerLibrary(true,32)).toEqual([]);const frames=t.sent.map(decodePresetSyncFrame);expect(frames).toHaveLength(8);expect(frames.every(f=>f.payload[1]===64&&f.payload[4]===1)).toBe(true);expect(t.state).toBe(1);}finally{c.close();}});
  it('reads and writes a settings header while stopping only the music lease',async()=>{const t=new Transport(),c=new PhysicalSynthClient(t);try{const header=await c.samplerSettings();expect(header).toHaveLength(128);header[62]=135;const readback=await c.samplerSettings(header);expect(readback[62]).toBe(135);expect(t.sent.map(decodePresetSyncFrame).filter(f=>f.payload[1]===69).map(f=>f.payload[2])).toEqual([0,1]);expect(t.sent.map(decodePresetSyncFrame).some(f=>f.payload[1]===2)).toBe(true);}finally{c.close();}});
  it('copies named sampler instruments with verified offsets and safe human filenames',async()=>{const t=new Transport(),c=new PhysicalSynthClient(t);try{await c.uploadSamplerNamed(new Uint8Array(512),'My instruments','Warm piano.hbs');const frames=t.sent.map(decodePresetSyncFrame);const begin=frames.find(f=>f.payload[1]===65)!.payload;expect(begin.slice(5,5+14)).toEqual(Array.from('My instruments',x=>x.charCodeAt(0)));expect(frames.filter(f=>f.payload[1]===66)).toHaveLength(3);expect(frames.at(-1)!.payload[1]).toBe(67);await expect(c.uploadSamplerNamed(new Uint8Array(512),'../bad','Test.hbs')).rejects.toThrow(/plain/);t.badSamplerOffset=true;await expect(c.uploadSamplerNamed(new Uint8Array(512),'My instruments','Other.hbs')).rejects.toThrow(/offset/);}finally{c.close();}});
  it("stops before selecting the SD piano and decodes sampler acknowledgements",async()=>{
    const t=new Transport(),c=new PhysicalSynthClient(t);try{
      await c.samplerSource('piano');await c.samplerParameter(4,18000);await c.samplerSource('patch');
      const frames=t.sent.map(decodePresetSyncFrame);expect(frames.findIndex(f=>f.payload[1]===2)).toBeLessThan(frames.findIndex(f=>f.payload[1]===51));
      expect(frames.filter(f=>f.payload[1]===51).map(f=>f.payload.slice(2))).toEqual([encodeU14(1),encodeU14(0)]);expect(frames.some(f=>f.payload[1]===46)).toBe(true);
    }finally{c.close();}
  });
  it("uses one source-ID encoding for working, piano and stored instruments",async()=>{
    const t=new Transport(),c=new PhysicalSynthClient(t);
    try{for(const id of [0,1,2,127,128,1025])await c.samplerInstrument(id);
      expect(t.sent.map(decodePresetSyncFrame).filter(f=>f.payload[1]===51).map(f=>f.payload.slice(2))).toEqual([0,1,2,127,128,1025].map(encodeU14));
      await expect(c.samplerInstrument(1026)).rejects.toThrow();
    }finally{c.close();}
  });
  it("rejects obsolete sample metadata instead of inventing loop settings",async()=>{
    for(const length of [17,18,28]){
      const t=new Transport();t.sampleReplyLength=length;const c=new PhysicalSynthClient(t);
      try{await expect(c.read()).rejects.toThrow(/sample response/);}finally{c.close();}
    }
  });
  it("configures samples without changing stored Drive and Pin",async()=>{
    const t=new Transport(),c=new PhysicalSynthClient(t);t.state=0;
    try{await c.setSample({enabled:false,gain:32768,direct:65535,name:"",frames:[]});const state=await c.read();expect(state.preset.parameters[26]).toBe(initialPreset.parameters[26]);expect(state.preset.parameters[29]).toBe(initialPreset.parameters[29]);expect(t.sent.map(decodePresetSyncFrame).find(f=>f.payload[1]===24)?.payload).toHaveLength(9);}finally{c.close();}
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

  it("decodes signed flat/tilted motion and rejects invalid routes",()=>{
    const packet=[17,1,1,...encodeU21(49151),...encodeU21(16384),...Array(66).fill(65536).flatMap(encodeU21)];
    expect(decodeMotion(packet).tiltX).toBeCloseTo(.5,3);expect(decodeMotion(packet).tiltY).toBeCloseTo(-.5,3);
    expect(()=>decodeMotion([17,1,1,...encodeU21(65535),...packet.slice(6)])).toThrow();
    const routes=Array(66).fill(0);routes[14]=1;expect(()=>physicalPresetFromUnknown({...initialPreset,tiltRoutes:routes})).toThrow();
  });

  it("round-trips ordered singleton effects and rejects duplicate instances",async()=>{
    const fx={...defaultFx(),order:[4,1,2]};
    expect(physicalPresetFromUnknown({...initialPreset,effects:fx}).effects).toEqual(fx);
    expect(()=>validateFx({...fx,order:[1,1]})).toThrow();
    expect(()=>validateFx({...fx,order:[6]})).toThrow();
    expect(()=>validateFx({...fx,values:[[65536,0,0,0]]})).toThrow();
    const transport=new Transport(),client=new PhysicalSynthClient(transport);
    const result=await client.effects(fx);expect(result.preset.effects).toEqual(fx);
    expect(decodePresetSyncFrame(transport.sent[0]).payload.slice(2,7)).toEqual([4,1,2,0,0]);
    client.close();
  });
  it("validates presets and rejects unsupported or malformed state before use", () => {
    expect(decodePhysicalState(payload()).preset.parameters).toEqual(initialPreset.parameters);
    expect(() => decodePhysicalState(payload().slice(1))).toThrow();
    expect(() => physicalPresetFromUnknown({ ...initialPreset, routes: [0] })).toThrow();
    expect(() => physicalPresetFromUnknown({ ...initialPreset, parameters: [NaN, 0, 0, 0] })).toThrow();
    expect(() => physicalPresetFromUnknown({ ...initialPreset, routes: Array(12).fill(65537) })).toThrow();
    expect(() => physicalPresetFromUnknown({ ...initialPreset, format: "hexboard-v3" })).toThrow();
    for (let version = 1; version < 22; version++)
      expect(() => physicalPresetFromUnknown({ ...initialPreset, format: `hexboard.physical.v${version}` })).toThrow(/supported physical string preset/);
    expect(physicalPresetFromUnknown(JSON.parse(JSON.stringify(initialPreset)))).toEqual(initialPreset);
  });
  it("encodes fractional retunes and full negative bend independently, then sends complete presets", async () => {
    const t = new Transport(), c = new PhysicalSynthClient(t);
    await Promise.all([c.retuneHz(61, 0, 261.123456), c.bend(-2), c.apply(initialPreset)]);
    const frames = t.sent.map(decodePresetSyncFrame);
    expect(frames.slice(0,2).map(f=>f.payload[1])).toEqual([6,5]);
    const operations=frames.map(f=>f.payload[1]);expect(operations.indexOf(24)).toBeLessThan(operations.indexOf(7));expect(operations.indexOf(21)).toBeLessThan(operations.indexOf(23));expect(operations.indexOf(23)).toBeLessThan(operations.lastIndexOf(24));
    expect(frames[0].payload.slice(5)).toHaveLength(5);
    expect(frames[1].payload).toEqual([17, 5, 0, 0, 0]);
    expect(frames.find(f=>f.payload[1]===7)!.payload).toHaveLength(399);
    expect(t.listeners.size).toBe(0); c.close();
  });
  it("maps pressure to pickup without changing output gain", () => {
    const light = effectiveParameters(initialPreset, [0.8, 0, 0]), deep = effectiveParameters(initialPreset, [0.8, 1, 0]);
    expect(deep[5]).toBeGreaterThan(light[5]); expect(deep[7]).toBe(light[7]);
    expect(() => physicalPresetFromUnknown({ ...initialPreset, routes: initialPreset.routes.map((v, i) => i === 21 ? 1 : v) })).toThrow();
  });
  it("round-trips factory sounds and evaluates pressure-to-clearance contacts", () => {
    for (const preset of factoryPhysicalPresets) expect(physicalPresetFromUnknown(preset)).toEqual(preset);
    const marbles = factoryPhysicalPresets.find(p => p.name === "Falling Marbles")!;
    expect(marbles.parameters[16]).toBeGreaterThan(32768); expect(marbles.parameters[17]).toBeGreaterThan(0);
    const bounce = factoryPhysicalPresets.find(p => p.name === "Pressure Bounce")!;
    expect(effectiveParameters(bounce,[1,1,0])[9]).toBeLessThan(effectiveParameters(bounce,[1,0,0])[9]);
    expect(() => physicalPresetFromUnknown({ ...bounce, routes: bounce.routes.map((v,i) => i === 25 ? 1 : v) })).toThrow();
  });
  it("supports long releases and independent bow controls",()=>{
    expect(releaseSeconds(65535)).toBeCloseTo(12,3);
    const bow=factoryPhysicalPresets.find(p=>p.name==="Pressure Bow")!;
    expect(bow.parameters[21]).toBe(65535);expect(effectiveParameters(bow,[.8,1,0])[22]).toBeGreaterThan(effectiveParameters(bow,[.8,0,0])[22]);
    expect(()=>physicalPresetFromUnknown({...bow,routes:bow.routes.map((v,i)=>i===64?1:v)})).toThrow();
  });
  it("round-trips every saved velocity engine", async () => {
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
    expect(frames.find(f=>f.payload[1]===7)!.payload.at(-1)).toBe(4);
    expect(frames.find(f=>f.payload[1]===7)!.payload).toHaveLength(399);
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
    c.close(); await expect(pending).rejects.toBeInstanceOf(SynthRequestCancelledError);
    expect(t.listeners.size).toBe(0);
    await expect(c.read()).rejects.toBeInstanceOf(SynthRequestCancelledError);
  });
  it("does not report a board disconnect when an old editor cancels requests", async () => {
    const transport = new Transport(); transport.respond = false;
    const retired = new PhysicalSynthClient(transport);
    const active = retired.status().catch(error => error);
    const queued = retired.expression().catch(error => error);
    await Promise.resolve(); await Promise.resolve();
    retired.close();
    transport.respond = true;
    const replacement = new PhysicalSynthClient(transport);
    try {
      expect((await replacement.status()).state).toBe("playing");
      for (const error of await Promise.all([active, queued])) {
        expect(error).toBeInstanceOf(SynthRequestCancelledError);
        expect(synthErrorMessage(error)).toBeUndefined();
      }
      expect((await replacement.status()).state).toBe("playing");
      expect(transport.listeners.size).toBe(0);
    } finally { replacement.close(); }
  });
  it("still displays real reply failures and can use the same connection afterward", async () => {
    vi.useFakeTimers();
    const transport = new Transport(); transport.respond = false;
    const client = new PhysicalSynthClient(transport);
    try {
      const pending = client.status().catch(error => error);
      await vi.advanceTimersByTimeAsync(5000);
      const error = await pending;
      expect(error).not.toBeInstanceOf(SynthRequestCancelledError);
      expect(synthErrorMessage(error)).toMatch(/board did not reply/i);
      transport.respond = true;
      expect((await client.status()).state).toBe("playing");
      expect(transport.listeners.size).toBe(0);
    } finally { client.close(); vi.useRealTimers(); }
  });
  it("restores a browser draft instead of replacing it with factory defaults", () => {
    vi.stubGlobal("window", { localStorage: { getItem: (key: string) => key.endsWith("draft.v1")
      ? JSON.stringify({ ...initialPreset, name: "Retained draft", parameters: initialPreset.parameters.map((v, i) => i ? v : 5566) }) : "[]" } });
    try {
      const html = renderToStaticMarkup(createElement(PhysicalSynthEditor));
      expect(html).toContain('title="Retained draft"');
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
      expect(html).toContain('aria-label="Marble material"');
      expect(html).toMatch(/checked=""[^>]*value="1"/);
      expect(html).toContain('aria-label="Bow speed"');expect(html).toContain('aria-label="Bow force"');
    } finally {vi.unstubAllGlobals();}
  });
  it("keeps activation visible offline and explains how to connect", () => {
    const html = renderToStaticMarkup(createElement(PhysicalSynthEditor));
    expect(html).toContain("Presets");
    expect(html).toContain("Start synth"); expect(html).toContain("Connect Advanced to play");
  });
});

 it("round trips Body controls, pin position and irregularity without enabling delay",()=>{
 const p=physicalPresetFromUnknown({...initialPreset,effects:{...defaultFx(),values:defaultFx().values.map((row,i)=>i===4?[40000,12000,63000,24000]:row)},parameters:initialPreset.parameters.map((v,i)=>i===28?48000:i===29?50000:i===30?8000:v)});
 expect(physicalPresetFromUnknown(JSON.parse(JSON.stringify(p)))).toEqual(p);expect(p.effects.order).toEqual([]);
 const m=defaultModulation();m.routes[56]=1000;m.routes[60]=2000;expect(validateModulation(m)).toEqual(m);
 });

it("round-trips direct sample mix with live pressure/LFO routes",()=>{
 const preset=structuredClone(initialPreset);preset.parameters[32]=17000;preset.sample.direct=17000;
 preset.routes[97]=22000;preset.modulation.routes[65]=16000;
 const loaded=physicalPresetFromUnknown(JSON.parse(JSON.stringify(preset)));
 expect(loaded).toEqual(preset);
 expect(effectiveParameters(loaded,[0,1,0,0,0,0,1])[32]).toBeCloseTo(17000/65535+38000/65536);
});

it('applies loop geometry while stopped and resumes after configuration',async()=>{
 const t=new Transport(),c=new PhysicalSynthClient(t);
 try{await c.setSample({enabled:true,gain:32768,direct:65535,name:'Loop',frames:Array(1600).fill(10000),loop:{mode:1,start:100,end:1400,crossfade:160}});const commands=t.sent.map(decodePresetSyncFrame).map(f=>f.payload);const loop=commands.findIndex(p=>p[1]===27);expect(commands[loop]).toEqual([17,27,1,...encodeU21(100),...encodeU21(1400),...encodeU21(160)]);expect(commands.slice(0,loop).some(p=>p[1]===2)).toBe(true);expect(commands.slice(loop+1).some(p=>p[1]===1)).toBe(true);expect(t.state).toBe(1);}finally{c.close();}
});

it('keeps Drive and Pin explicit choices with the full sample rack',()=>{
 for(const fullRack of [false,true]){
  const patch={...initialPreset,sample:{...initialPreset.sample,enabled:true,frames:[0,12000,-12000,0]},effects:{...defaultFx(),order:fullRack?[1,2,3]:[1,2]}};
  vi.stubGlobal('window',{localStorage:{getItem:(key:string)=>key.endsWith('draft.v1')?JSON.stringify(patch):'[]'}});
  try{const html=renderToStaticMarkup(createElement(PhysicalSynthEditor));
   for(const name of ['Drive','Pin pressure','Pin position']){const group=html.match(new RegExp('<div class="physical-control"([^>]*)><strong>'+name+'</strong>'));expect(group).not.toBeNull();expect(group![1]).not.toContain('data-unavailable="true"');}
   const characters=html.match(/<div class="source-tabs drive-characters"([^>]*)>([\s\S]*?)<\/div>/)!;expect(characters[1].includes('data-unavailable="true"')).toBe(false);
  }finally{vi.unstubAllGlobals();}
 }
});

it('reports acknowledged sample frames and clears progress after completion',async()=>{
 const t=new Transport(),events:(Progress|undefined)[]=[],c=new PhysicalSynthClient(t,p=>events.push(p));
 try{await c.setSample({enabled:true,gain:32768,direct:65535,name:'Progress',frames:Array(1024).fill(1000)});const sent=events.filter((p):p is Progress=>p?.label==='Sending sample…');expect(sent[0]).toMatchObject({completed:0,total:1024});expect(sent.at(-1)).toMatchObject({completed:1024,total:1024});expect(sent.map(p=>p.completed)).toEqual([...sent.map(p=>p.completed)].sort((a,b)=>a!-b!));expect(events.some(p=>p?.label==='Preparing synth…'&&p.completed===undefined)).toBe(true);expect(events.at(-1)).toBeUndefined();}finally{c.close();}
});
it('clears sample progress when the connection is closed mid-operation',async()=>{
 vi.useFakeTimers();const t=new Transport();t.respond=false;const events:(Progress|undefined)[]=[],c=new PhysicalSynthClient(t,p=>events.push(p));
 try{const pending=c.setSample({enabled:true,gain:32768,direct:65535,name:'Cancel',frames:[0,1000,-1000,0]});const rejected=expect(pending).rejects.toBeInstanceOf(SynthRequestCancelledError);await vi.advanceTimersByTimeAsync(0);c.close();await rejected;expect(events.at(-1)).toBeUndefined();expect(t.listeners.size).toBe(0);}finally{c.close();vi.useRealTimers();}
});
it('renders measured transfer progress and honest indeterminate preparation',()=>{
 const measured=renderToStaticMarkup(createElement(SynthProgress,{progress:{label:'Sending sample…',completed:512,total:1024}}));expect(measured).toContain('50%');expect(measured).toContain('value="512"');expect(measured).toContain('max="1024"');
 const waiting=renderToStaticMarkup(createElement(SynthProgress,{progress:{label:'Starting synth…'}}));expect(waiting).toContain('<progress');expect(waiting).not.toContain('value=');expect(waiting).not.toContain('%');
});

it('stores explicit loads while stopped, after the complete patch, then resumes',async()=>{
 const t=new Transport(),c=new PhysicalSynthClient(t),events:(Progress|undefined)[]=[];
 const observed=new PhysicalSynthClient(t,p=>events.push(p));
 try{await observed.load(initialPreset);const ops=t.sent.map(decodePresetSyncFrame).map(f=>f.payload[1]);const save=ops.indexOf(28);expect(save).toBeGreaterThan(ops.indexOf(24));expect(ops.slice(0,save)).toContain(2);expect(ops.slice(save+1)).toContain(1);expect(ops.indexOf(61)).toBeLessThan(ops.indexOf(2));expect(ops.indexOf(62)).toBeGreaterThan(ops.indexOf(1));expect(t.state).toBe(1);expect(events.some(p=>p?.label==='Saving startup patch…')).toBe(true);}finally{c.close();observed.close();}
});
it('does not save ordinary RAM apply or live parameter changes',async()=>{
 const t=new Transport(),c=new PhysicalSynthClient(t);try{await c.apply(initialPreset);await c.parameter(0,30000);expect(t.sent.map(decodePresetSyncFrame).some(f=>f.payload[1]===28)).toBe(false);}finally{c.close();}
});

it('clears an old full graph before a valid replacement even in a fresh client',async()=>{
 const t=new Transport();for(const id of [0,1,3,6,5,14,15,26,22,23])t.modulation.routes[id*2]=1000;
 const p=physicalPresetFromUnknown(initialPreset);for(const id of [2,10,11,12,13,24,25])p.routes[id*3+1]=1000;
 const c=new PhysicalSynthClient(t);try{await c.apply(p);const ops=t.sent.map(decodePresetSyncFrame).map(f=>f.payload[1]);expect(ops.indexOf(17)).toBeLessThan(ops.indexOf(7));expect(ops.filter(op=>op===7)).toHaveLength(2);}finally{c.close();}
});

it('reads device-owned pedal / joystick values without writing hardware settings',async()=>{const t=new Transport(),c=new PhysicalSynthClient(t);try{const state=await c.controls();expect(state.expression).toBeCloseTo(.5,4);expect(state.modulation).toBe(-1);expect(t.sent.map(decodePresetSyncFrame).filter(f=>f.payload[1]===52).every(f=>f.payload.length===2)).toBe(true);await c.controllerRoute(22,1,40000);expect(t.sent.map(decodePresetSyncFrame).some(f=>f.payload[1]===54&&f.payload[2]===22&&f.payload[3]===1)).toBe(true);}finally{c.close();}});

it("accepts the current DSP qualification revision from the board",async()=>{const transport=new Transport(),client=new PhysicalSynthClient(transport);expect((await client.voiceBudget()).revision).toBe(4);client.close();});

it('explicitly clears a previous device sample even with a fresh browser client',async()=>{const t=new Transport(),c=new PhysicalSynthClient(t);t.state=0;try{await c.apply(initialPreset);const sent=t.sent.map(decodePresetSyncFrame);expect(sent.some(f=>f.payload[1]===21&&f.payload.slice(2,5).every(v=>v===0))).toBe(true);expect(sent.some(f=>f.payload[1]===23)).toBe(true);}finally{c.close();}});

it('polls an automatic-storage catalog operation through completion',async()=>{const t=new Transport(),c=new PhysicalSynthClient(t),progress:number[]=[];try{const result=await c.presetCatalog(0,0,0,s=>progress.push(s.progress));expect(result).toMatchObject({phase:2,medium:2,mask:1,elapsedMs:100});expect(progress).toEqual([0,100]);expect(t.listeners.size).toBe(0);}finally{c.close();}});

it('uses wide device IDs and preserves the top occupancy bit in folder pages',async()=>{const t=new Transport(),c=new PhysicalSynthClient(t);try{await c.presetCatalog(0,2080,1);expect(decodePresetSyncFrame(t.sent[0]).payload).toEqual([17,58,0,...encodeU14(2080),1]);expect(await c.presetLabel(3071)).toMatchObject({engine:5,name:'High ID sound'});const folders=await c.presetFolders();expect(folders).toHaveLength(32);expect(folders[31]).toEqual({index:31,name:'Glass',mask:0x80000000});}finally{c.close();}});

it('keeps device library controls disabled while the parent reads an audition into the editor',()=>{const t=new Transport(),c=new PhysicalSynthClient(t);const html=renderToStaticMarkup(createElement(DevicePresetLibrary,{client:c,engine:2,busy:true,getCurrent:async()=>initialPreset,onAudition:()=>{},onBusy:()=>{}}));expect(html).toContain('aria-busy="true"');expect(html).toContain('Reading sound…');expect(html.match(/<button[^>]*disabled=""/g)).toHaveLength(2);c.close();});

it('reveals cached names top to bottom while a folder is still loading, without repeated reads',async()=>{
 const t=new Transport(),c=new PhysicalSynthClient(t),mask=0x80000009,seen:{polls:number;ids:number[]}[]=[];
 const packet=(phase:number,progress:number)=>[17,2,phase,0,...encodeU14(2048),2,progress,...Array.from({length:5},(_,i)=>Math.floor(mask/2**(7*(4-i)))%128),...encodeU21(0),...encodeU21(0),5,0,...encodeU14(3072),32,...encodeU21(8000)];
 t.catalogReplies=[packet(1,8),packet(1,11),packet(2,100)];
 try{await c.browsePresetFolder(2048,2,()=>{},rows=>seen.push({polls:t.sent.filter(p=>decodePresetSyncFrame(p).payload[1]===57).length,ids:rows.map(r=>r.id)}));
 expect(seen).toEqual([{polls:0,ids:[2048]},{polls:1,ids:[2048,2051]},{polls:2,ids:[2048,2051,2079]}]);
 expect(t.sent.map(p=>decodePresetSyncFrame(p).payload).filter(p=>p[1]===59).map(p=>p.slice(2))).toEqual([encodeU14(2048),encodeU14(2051),encodeU14(2079)]);
 }finally{c.close();}
});
