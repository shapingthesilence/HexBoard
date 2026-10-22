import {describe,it,expect} from 'vitest';
import {dspUsage,dspAllows,dspRouteAllows,routePatch,parameterPatch} from './dspBudget.ts';
import {physicalPresetFromUnknown,initialPreset,effectiveParameters} from './schema.ts';
describe('global Physical Strings DSP admission',()=>{
 it('counts a shared eight-voice pool for samples, the rack, body and feedback features',()=>{
  const p=physicalPresetFromUnknown(initialPreset);p.routes.fill(0);p.modulation.routes.fill(0);p.tiltRoutes.fill(0);
  expect(dspUsage(p).units).toBe(1250);p.sample.enabled=true;p.sample.frames=[0,1000,-1000,0];p.effects.order=[1,2,3,4];p.sample.loop={mode:1,start:0,end:200,crossfade:0};
  p.parameters[26]=65535;expect(dspUsage(p).fits).toBe(true);const both=parameterPatch(p,29,65535);expect(dspUsage(both).fits).toBe(false);expect(dspAllows(p,both)).toBe(false);expect(dspAllows(both,p)).toBe(true);
 });
 it('prices controllers as continuous sources and keeps target / connection bounds',()=>{
  let p=physicalPresetFromUnknown(initialPreset);p.routes.fill(0);p.tiltRoutes.fill(0);p.modulation.routes.fill(0);
  p=routePatch(p,5,7,20000);p=routePatch(p,5,8,20000);expect(dspUsage(p).modulationUnits).toBe(10);expect(dspUsage(p).connections).toBe(2);
  p=routePatch(p,5,0,1000);p=routePatch(p,5,1,1000);expect(dspRouteAllows(p,5,6)).toBe(false);
  expect(physicalPresetFromUnknown(p).controllerRoutes).toEqual(p.controllerRoutes);
 });
 it('does not multiply-attenuate Expression when it is assigned to volume',()=>{
  const p=routePatch(physicalPresetFromUnknown(initialPreset),7,8,65536),base=p.parameters[7]/65535;
  expect(effectiveParameters(p,[0,0,0,0,0,0,0,0,1])[7]).toBeCloseTo(base);expect(effectiveParameters(p,[0,0,0,0,0,0,0,0,.5])[7]).toBeCloseTo(base*.5);
 });
});
