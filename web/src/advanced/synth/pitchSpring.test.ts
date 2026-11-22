import {describe,it,expect} from 'vitest';
import {PitchSpringPreview,springDefaults,springDirectionWords,springResponse,springSourceWords,springReturn,springHolds,springRise,springWords as W} from './pitchSpring.ts';
import {initialPreset,physicalPresetFromUnknown,validateModulation} from './schema.ts';
import {dspUsage,routePatch,dspAllows} from './dspBudget.ts';
import {routeDepth} from './modulationBudget.ts';
import {canAssignTarget} from './targetModulation.ts';
const settings=(edit:Record<number,number>={})=>initialPreset.modulation.settings.map((v,i)=>edit[i]??v);
/** Press at 100 ms into a held note, sampling every 12 ms. */
function press(s:number[],until=1200,release?:number){const state=new PitchSpringPreview(),inputs=Array(9).fill(0),trace:number[]=[];state.advance(s,inputs,0,1);
 for(let t=12;t<=until;t+=12){const held=release===undefined||t<release;inputs[1]=held&&t>=100?1:0;trace.push(state.advance(s,inputs,t,1,held));}return trace;}
describe('Pitch Spring',()=>{
 it('round trips its neutral defaults, three inputs and three directions',()=>{expect(initialPreset.modulation.settings.slice(18)).toEqual(springDefaults);expect(initialPreset.modulation.settings).toHaveLength(42);
  for(const source of springSourceWords){const p=structuredClone(initialPreset);p.modulation.settings[W.source]=source;expect(physicalPresetFromUnknown(p).modulation.settings[W.source]).toBe(source);}
  for(const direction of springDirectionWords){const p=structuredClone(initialPreset);p.modulation.settings[W.direction]=direction;expect(physicalPresetFromUnknown(p).modulation.settings[W.direction]).toBe(direction);}
  expect(()=>validateModulation({...initialPreset.modulation,settings:settings({[W.source]:10922})})).toThrow();expect(()=>validateModulation({...initialPreset.modulation,settings:settings({[W.direction]:100})})).toThrow();
  expect(springReturn(23200)).toBeCloseTo(.402,2);expect(springHolds(65535)).toBe(true);expect(springHolds(65000)).toBe(false);expect(springRise(0)).toBeLessThan(springRise(65535));});
 it('upgrades a v23 sound, carrying Warble into Bounce',()=>{const old={...structuredClone(initialPreset),format:'hexboard.physical.v23',modulation:{...initialPreset.modulation,settings:[...initialPreset.modulation.settings.slice(0,40)]}};old.modulation.settings[21]=40000;
  const p=physicalPresetFromUnknown(old);expect(p.format).toBe('hexboard.physical.v25');expect(p.modulation.settings[W.bounce]).toBe(40000);expect(p.modulation.settings.slice(40)).toEqual(springDefaults.slice(22));});
 it('counts gesture routes in the same budget and applies the four-source cap',()=>{let p=structuredClone(initialPreset);const before=dspUsage(p);p=routePatch(p,33,8,32768);expect(Math.abs(routeDepth(p,33,8)-32768)).toBeLessThanOrEqual(2);expect(dspUsage(p).connections).toBe(before.connections+1);expect(dspUsage(p).units).toBeGreaterThan(before.units+190);for(const s of [3,4,6])p=routePatch(p,33,s,32768);expect(canAssignTarget(p,33,1)).toBe(false);expect(dspAllows(p,routePatch(p,33,1,32768))).toBe(false);p=routePatch(p,33,8,0);expect(routeDepth(p,33,8)).toBe(0);
  const bounce=structuredClone(initialPreset);bounce.modulation.settings[W.bounce]=65535;expect(dspUsage(bounce).units).toBe(before.units);});
 it('eases into a press, settles, and reverses when the key eases off',()=>{const trace=press(settings({[W.amount]:65535})),peak=Math.max(...trace),at=trace.indexOf(peak);
  expect(peak).toBeGreaterThan(100);expect(peak).toBeLessThan(200);expect(trace[8]).toBeLessThan(.3*peak);for(let i=9;i<=at;++i)expect(trace[i]).toBeGreaterThanOrEqual(trace[i-1]);
  expect(Math.abs(trace[trace.length-1])).toBeLessThan(5);expect(Math.min(...trace)).toBeGreaterThanOrEqual(0);});
 it('folds warble into Bounce: overshoot, and a ring about the note with a short Return',()=>{const plain=Math.max(...press(settings({[W.amount]:65535}))),bouncy=press(settings({[W.amount]:65535,[W.bounce]:65535}));
  expect(Math.max(...bouncy)).toBeGreaterThan(1.3*plain);const ring=press(settings({[W.amount]:65535,[W.bounce]:65535,[W.return]:0}));expect(Math.min(...ring)).toBeLessThan(-5);expect(Math.abs(ring[ring.length-1])).toBeLessThan(1);});
 it('limits the bend to one direction and holds it at maximum Return',()=>{const s=settings({[W.amount]:65535,[W.direction]:65535});expect(Math.max(...press(s).map(Math.abs))).toBe(0);
  const held=press(settings({[W.amount]:65535,[W.return]:65535}));expect(held[held.length-1]).toBeGreaterThan(190);});
 it('treats letting go as a release, not a gesture',()=>{const relaxed=press(settings({[W.amount]:65535}),2400,1500);expect(Math.min(...relaxed)).toBeGreaterThanOrEqual(0);expect(Math.abs(relaxed[relaxed.length-1])).toBeLessThan(1);});
 it('ignores the strike itself',()=>{const state=new PitchSpringPreview(),inputs=Array(9).fill(0),s=settings({[W.amount]:65535});inputs[1]=.8;state.advance(s,inputs,0,12);expect(state.advance(s,inputs,12,12)).toBe(0);});
 it('trims the 44-word draft settings',()=>{const p=structuredClone(initialPreset);p.modulation.settings=[...p.modulation.settings,0,0];expect(physicalPresetFromUnknown(p).modulation.settings).toHaveLength(42);});
 it('upgrades v24 sources and keeps a negative-Amount direction on the same pitch side',()=>{
  const v24=(source:number,amount=65535,direction=0)=>{const p={...structuredClone(initialPreset),format:'hexboard.physical.v24'};p.modulation.settings[W.source]=source;p.modulation.settings[W.amount]=amount;p.modulation.settings[W.direction]=direction;return physicalPresetFromUnknown(p).modulation.settings;};
  expect(v24(10922)[W.source]).toBe(32768);expect(v24(21844)[W.source]).toBe(32768);for(const old of [0,32766,43688,54610,65535])expect(v24(old)[W.source]).toBe(0);
  expect(v24(0,0,32768)[W.direction]).toBe(65535);expect(v24(0,0,65535)[W.direction]).toBe(32768);expect(v24(0,65535,32768)[W.direction]).toBe(32768);
  const original={...structuredClone(initialPreset),format:'hexboard.physical.v24'};original.modulation.settings[W.source]=10922;physicalPresetFromUnknown(original);expect(original.modulation.settings[W.source]).toBe(10922);});
 it('names Direction by pitch side, so a negative Amount keeps easing off for Up only',()=>{const s=settings({[W.amount]:0,[W.direction]:32768}),trace=press(s,2400,1500);
  // Pressing in bends down at negative Amount, which Up only removes; easing off at release is not a gesture.
  expect(Math.min(...trace)).toBeGreaterThanOrEqual(0);});
 /** Rock the board from 100 ms, sampling every 12 ms as the editor does. */
 const move=(s:number[],rock:(t:number)=>number,until=1600)=>{const state=new PitchSpringPreview(),inputs=Array(9).fill(0),trace:number[]=[];state.advance(s,inputs,0,1,true,rock(0));
  for(let t=12;t<=until;t+=12)trace.push(state.advance(s,inputs,t,1,true,rock(t)));return trace;};
 const kick=(t:number)=>t>=100&&t<250?.6*Math.sin(Math.PI*(t-100)/150):0;
 it('kicks on a rock and eases back over Return, ignoring key pressure',()=>{const trace=move(settings({[W.amount]:65535,[W.source]:32768}),kick),peak=Math.max(...trace),at=trace.indexOf(peak);
  expect(peak).toBeGreaterThan(40);expect(trace[at+10]).toBeGreaterThan(5);expect(Math.abs(trace[trace.length-1])).toBeLessThan(1);
  const longer=move(settings({[W.amount]:65535,[W.source]:32768,[W.return]:50000}),kick);expect(longer[at+30]).toBeGreaterThan(trace[at+30]);
  const pressed=press(settings({[W.amount]:65535,[W.source]:32768}));expect(Math.max(...pressed.map(Math.abs))).toBe(0);
  expect(Math.max(...move(settings({[W.amount]:65535,[W.source]:32768,[W.direction]:65535}),kick))).toBe(0);});
 it('loads a v25 Shake source as Rock',()=>{const p=structuredClone(initialPreset);p.modulation.settings[W.source]=65535;expect(physicalPresetFromUnknown(p).modulation.settings[W.source]).toBe(32768);});
 it('draws a standard gesture for each source',()=>{const r=springResponse(settings());expect(r.marks.map(m=>m.label)).toEqual(['strike','press in','ease off','let go']);expect(Math.max(...r.bend)).toBeGreaterThan(.4);expect(Math.min(...r.bend)).toBeLessThan(-.2);expect(Math.abs(r.bend[r.bend.length-1])).toBeLessThan(.1);
  const rock=springResponse(settings({[W.source]:32768}));expect(rock.marks.map(m=>m.label)).toEqual(['rock','back']);expect(Math.max(...rock.gesture)).toBeCloseTo(1,1);expect(Math.max(...rock.bend)).toBeGreaterThan(.2);expect(Math.min(...rock.bend)).toBeLessThan(-.2);
  const up=springResponse(settings({[W.source]:32768,[W.direction]:32768}));expect(Math.min(...up.bend)).toBeGreaterThanOrEqual(0);});
});
