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
 });
 it("rejects overlapping maps, unsupported mappings, bad bounds and nonfinite source data",async()=>{
  const p=patch();p.zones!.push({...p.zones![0]});await expect(prepareCompactPatch(p)).rejects.toThrow(/overlapping/);
  for(const extra of [{key:3},{roundRobin:1},{choke:2}]){const q=patch();Object.assign(q.zones![0],extra);await expect(prepareCompactPatch(q)).rejects.toThrow(/pitched/);}
  const q=patch();q.assets[0].channels[0][0]=NaN;await expect(prepareCompactPatch(q)).rejects.toThrow();
 });
 it("uses the shared editor with only Classic-supported workflows",()=>{
  const html=renderToStaticMarkup(createElement(SamplerEditor,{target:"classic"}));
  for(const s of ["Import SoundFont","Classic library","48 KiB","Prepare Classic audition"])expect(html).toContain(s);
  for(const s of ["KW upright","Patch response","Fast lift","Room reverb","SD · long recordings"])expect(html).not.toContain(s);
 });
});
