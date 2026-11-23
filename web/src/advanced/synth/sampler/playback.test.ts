import {decodeSamplerLoading} from "../client.ts";
import {describe,it,expect} from 'vitest';
import {playbackLimits,resourceSummary} from './playback.mjs';
import {preparePatch,crc32} from './prepare.mjs';
import {readBank} from './bank.mjs';
import type {Patch} from './prepare.mjs';
const patch:Patch={assets:[{name:'Reed',rate:44100,rootMidi:60,channels:[Float32Array.from({length:1000},(_,i)=>.1*Math.sin(i*.1))]}],zones:[{asset:0,lowMidi:60,highMidi:61}]};
describe('Sampler playback setup',()=>{
 it('validates the configured reader envelope without promising timing',()=>{expect(playbackLimits(patch)).toEqual({voices:16,tails:4});expect(playbackLimits(patch,true)).toEqual({voices:8,tails:0});for(const playback of [{voices:0,tails:4},{voices:25,tails:4},{voices:2,tails:5},{voices:1.5,tails:0}])expect(()=>playbackLimits({...patch,playback})).toThrow();expect(resourceSummary({...patch,playback:{voices:2,tails:1}}).readers).toBe(3);});
 it('round trips voice reservations through protected HBS headers',async()=>{for(const playback of [{voices:16,tails:4},{voices:24,tails:4},{voices:1,tails:0},{voices:8,tails:2}]){const result=await preparePatch({...patch,playback});expect(readBank(result.bytes).playback).toEqual(playback);}await expect(preparePatch({...patch,playback:{voices:0,tails:0}})).rejects.toThrow();});
 it('rejects corrupt or out of range reservations even with valid CRC',async()=>{const {bytes}=await preparePatch(patch);for(const [at,value] of [[106,16],[107,5],[115,0x80],[126,1],[126,25],[127,1]]){const b=bytes.slice();b[at]=value;b.fill(0,36,40);new DataView(b.buffer).setUint32(36,crc32(b.subarray(0,128)),true);expect(()=>readBank(b)).toThrow(/voice/);}});
 it('round trips a paged directory over the resident limits',async()=>{
  const assets=Array.from({length:150},(_,i)=>({...patch.assets[0],rootMidi:24+(i%75)}));
  const zones=assets.flatMap((a,i)=>[0,1].map(layer=>({asset:i,lowMidi:a.rootMidi-.4,highMidi:a.rootMidi+.4,fixed:true,velocityLow:1+32*(layer+2*Math.floor(i/75)),velocityHigh:Math.min(127,32*(layer+1+2*Math.floor(i/75)))})));
  const result=await preparePatch({assets,zones});
  const decoded=readBank(result.bytes);
  expect(decoded.assets).toHaveLength(150);
  expect(decoded.zones).toHaveLength(300);
  await expect(preparePatch({assets,zones,storage:'resident'})).rejects.toThrow(/128/);
  expect(decodeSamplerLoading([17,2,16,14,8,14,8,0,0,0,0,1,0,0,0,0,1,1]).total).toBe(1800);
  const expanded=[17,2,24,0,28,0,28,0,0,0,0,1,0,0,0,0,1,1];
  expect(decodeSamplerLoading(expanded).voices).toBe(24);
  expanded[17]=0;
  expect(()=>decodeSamplerLoading(expanded)).toThrow(/progress/);
  await expect(preparePatch({...patch,storage:'resident',playback:{voices:24,tails:4}})).rejects.toThrow(/1–16/);
 });
 it('round trips shared effects and a signed strike-to-cutoff amount',async()=>{
  const result=await preparePatch({...patch,settings:{ensemble:.35,drive:.25,velocityCutoff:-1800}});
  const settings=readBank(result.bytes).settings;
  expect(settings?.ensemble).toBeCloseTo(.35,4);
  expect(settings?.drive).toBeCloseTo(.25,4);
  expect(settings?.velocityCutoff).toBe(-1800);
  await expect(preparePatch({...patch,settings:{velocityCutoff:4801}})).rejects.toThrow();
 });
 it('reports stereo and paged playback by default',()=>{const stereo={...patch,assets:patch.assets.map(a=>({...a,channels:[a.channels[0],a.channels[0]]}))};const r=resourceSummary(stereo);expect(r.stereo&&r.streaming).toBe(true);expect(r.pcm).toBe(4000);});
});
