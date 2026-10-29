import {describe,it,expect} from "vitest";
import {prepareCompactPatch,compactLimits,readCompactPatch} from "./compact.mjs";
import {crc32,type Patch} from "./prepare.mjs";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {SamplerEditor} from "../SamplerEditor.tsx";
const patch=(length=111):Patch=>({name:"Synthetic compact",assets:[{channels:[Float32Array.from({length},(_,i)=>.3*Math.sin(i*.1))],rate:22050,rootMidi:60,mode:3,loopStart:3,loopEnd:length-5}],zones:[{asset:0,lowMidi:0,highMidi:128,attack:5,release:100}]});
describe("Classic sampler",()=>{
 it("preserves native samples, odd loop endpoints and independent rate",async()=>{
  const p=patch(),r=await prepareCompactPatch(p),v=new DataView(r.bytes.buffer);
  expect(new TextDecoder().decode(r.bytes.subarray(0,4))).toBe("HBC1");expect(v.getFloat32(80,true)).toBe(22050);
  expect(v.getUint32(72,true)).toBe(3);expect(v.getUint32(76,true)).toBe(106);expect(r.residentBytes).toBe(222);
  const metadata=r.bytes.slice(0,144),stored=v.getUint32(20,true);metadata.fill(0,20,24);
  expect(crc32(metadata)).toBe(stored);expect(crc32(r.bytes.subarray(144))).toBe(v.getUint32(16,true));
  const NodeBuffer = Reflect.get(globalThis, "Buffer") as {from(bytes:Uint8Array):Uint8Array};
  const nodeBytes = NodeBuffer.from(r.bytes), before = Uint8Array.from(nodeBytes); readCompactPatch(nodeBytes); expect(Uint8Array.from(nodeBytes)).toEqual(before);
  const reopened = readCompactPatch(r.bytes); expect(reopened.assets[0].loopEnd).toBe(106);
  const damaged = r.bytes.slice(); damaged[damaged.length-1]^=1; expect(()=>readCompactPatch(damaged)).toThrow(/checksum/);
  expect(r.auditionPatch!.assets[0].rate).toBe(22050);expect(p.assets[0].channels[0].length).toBe(111);
 });
 it("fits oversized recordings with a reported reduction and exact periodic pitch",async()=>{
  const p=patch(30001),r=await prepareCompactPatch(p),a=r.auditionPatch!.assets[0];
  expect(r.residentBytes).toBeLessThanOrEqual(compactLimits.pcmBytes);expect(r.warnings.join(" ")).toContain("Reduced source rates");
  expect(a.rate/(a.loopEnd!-a.loopStart!)).toBeCloseTo(22050/(30001-5-3),8);
  expect(r.residentBytes).toBeGreaterThan(48000); // Use the budget instead of throwing half of it away.
  expect(a.rate).toBeGreaterThan(22050*.8);
 });
 it("protects high notes instead of exporting an almost silent reduction",async()=>{
  const p=patch(200000);p.assets[0]={channels:[Float32Array.from({length:200000},(_,i)=>.4*Math.sin(2*Math.PI*1760*i/44100))],rate:44100,rootMidi:93,mode:0};
  await expect(prepareCompactPatch(p)).rejects.toThrow(/sample RAM at the protected rates.*48 KiB/);
 });
 it("budgets rates independently and retains the pitch of odd loops",async()=>{
  const p=patch(30001);p.assets.push({channels:[Float32Array.from({length:4001},(_,i)=>.4*Math.sin(2*Math.PI*2093*i/44100))],rate:44100,rootMidi:96,mode:0});
  p.zones=[{asset:0,lowMidi:0,highMidi:80},{asset:1,lowMidi:80,highMidi:128}];
  const r=await prepareCompactPatch(p),[low,high]=r.auditionPatch!.assets;
  expect(high.rate).toBeGreaterThanOrEqual(2093*6);
  expect(high.rate/44100).toBeGreaterThan(low.rate/22050);
  expect(r.residentBytes).toBeLessThanOrEqual(compactLimits.pcmBytes);
  const energy=(data:Float32Array)=>data.reduce((v,x)=>v+x*x,0)/data.length;
  expect(energy(high.channels[0])/energy(p.assets[1].channels[0])).toBeGreaterThan(.95);
 });
 it("removes inaccessible continuous-loop data but retains release tails",async()=>{
  const p=patch(30001);Object.assign(p.assets[0],{mode:1,loopStart:10,loopEnd:1000});
  const r=await prepareCompactPatch(p),a=r.auditionPatch!.assets[0];expect(a.channels[0].length).toBe(1000);expect(a.rate).toBe(22050);
  p.assets[0].mode=3;const tail=(await prepareCompactPatch(p)).auditionPatch!.assets[0];
  expect((tail.channels[0].length-tail.loopEnd!)/tail.rate).toBeCloseTo((30001-1000)/22050,3);
 });
 it("preserves level through mono phase cancellation and normalizes after filtering",async()=>{
  const p=patch(),left=p.assets[0].channels[0];p.assets[0].channels=[left,left.map(x=>-x)];
  const r=await prepareCompactPatch(p);expect(r.warnings.join(" ")).toContain("cancel");expect(Math.max(...r.auditionPatch!.assets[0].channels[0])).toBeGreaterThan(.29);
  const q=patch(30001);q.assets[0].normalize=true;const a=(await prepareCompactPatch(q)).auditionPatch!.assets[0];
  expect(a.channels[0].reduce((v,x)=>Math.max(v,Math.abs(x)),0)).toBeCloseTo(.95,6);expect(a.normalize).toBe(false);
 });
 it("rejects overlapping maps, unsupported mappings, bad bounds and nonfinite source data",async()=>{
  const p=patch();p.zones!.push({...p.zones![0]});await expect(prepareCompactPatch(p)).rejects.toThrow(/overlapping/);
  for(const extra of [{key:3},{roundRobin:1},{choke:2}]){const q=patch();Object.assign(q.zones![0],extra);await expect(prepareCompactPatch(q)).rejects.toThrow(/pitched/);}
  const q=patch();q.assets[0].channels[0][0]=NaN;await expect(prepareCompactPatch(q)).rejects.toThrow();
 });
 it("uses the shared editor with only Classic-supported workflows",()=>{
  const html=renderToStaticMarkup(createElement(SamplerEditor,{target:"classic"}));
  for(const s of ["Add recordings or instrument","Save / export","48 KiB","conversion updates automatically","Send to HexBoard","Persistent browser audition","Sample key and velocity regions"])expect(html).toContain(s);
  for(const s of ["KW upright","Patch response","Fast lift","Room reverb","SD · long recordings"])expect(html).not.toContain(s);
  expect(html).not.toContain('class="sampler-editing"');expect(html).not.toContain("Prepare instrument");
  expect(html).toContain('accept=".sf2,.sf3,.sfz,.wav,.hbs,.hbc"');
 });
});
