import {describe,it,expect} from 'vitest';
import {PitchSpringPreview,springDefaults,springSourceWords,springReturn} from './pitchSpring.ts';
import {initialPreset,physicalPresetFromUnknown,validateModulation} from './schema.ts';
import {dspUsage,routePatch,dspAllows} from './dspBudget.ts';
import {routeDepth} from './modulationBudget.ts';
import {canAssignTarget} from './targetModulation.ts';
describe('Pitch Spring',()=>{
 it('round trips its neutral defaults and seven inputs',()=>{expect(initialPreset.modulation.settings.slice(18)).toEqual(springDefaults);for(const source of springSourceWords){const p=structuredClone(initialPreset);p.modulation.settings[18]=source;expect(physicalPresetFromUnknown(p).modulation.settings[18]).toBe(source);}expect(()=>validateModulation({...initialPreset.modulation,settings:initialPreset.modulation.settings.map((v,i)=>i===18?5:v)})).toThrow();expect(springReturn(23200)).toBeCloseTo(.402,2);});
 it('counts gesture routes in the same budget and applies the four-source cap',()=>{let p=structuredClone(initialPreset);const before=dspUsage(p);p=routePatch(p,33,8,32768);expect(Math.abs(routeDepth(p,33,8)-32768)).toBeLessThanOrEqual(2);expect(dspUsage(p).connections).toBe(before.connections+1);expect(dspUsage(p).units).toBeGreaterThan(before.units+190);for(const s of [3,4,6])p=routePatch(p,33,s,32768);expect(canAssignTarget(p,33,1)).toBe(false);expect(dspAllows(p,routePatch(p,33,1,32768))).toBe(false);p=routePatch(p,33,8,0);expect(routeDepth(p,33,8)).toBe(0);});
 it('previews a pressure change, settling, reversal and a separately enabled warble',()=>{const state=new PitchSpringPreview(),settings=[...initialPreset.modulation.settings],inputs=Array(9).fill(0);settings[19]=65535;state.advance(settings,inputs,0,1);inputs[1]=1;expect(state.advance(settings,inputs,40,1)).toBeGreaterThan(20);for(let t=80;t<=2000;t+=40)state.advance(settings,inputs,t,1);expect(Math.abs(state.value)).toBeLessThan(.01);inputs[1]=0;expect(state.advance(settings,inputs,2040,1)).toBeLessThan(0);settings[19]=32768;settings[21]=65535;state.advance(settings,inputs,2080,2);inputs[1]=1;expect(state.advance(settings,inputs,2120,2)).not.toBe(0);});
});

it('uses a zero damper-pressure reference at onset in the gesture preview',()=>{const state=new PitchSpringPreview(),s=[...initialPreset.modulation.settings],inputs=Array(9).fill(0);s[19]=65535;inputs[1]=.8;state.advance(s,inputs,0,12);expect(state.advance(s,inputs,40,12)).toBeGreaterThan(20);});
