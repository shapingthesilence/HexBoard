import {describe,expect,it} from 'vitest';
import {knobRingPoint,modulationRing,modulationRings} from './modulationRing.ts';
describe('modulation anchored to the base knob',()=>{
 it('starts both directions at the current pointer',()=>{
  const base=.25, positive=modulationRing(16384,28,base),negative=modulationRing(-16384,28,base);
  expect(positive.start).toEqual(knobRingPoint(base,28));expect(negative.start).toEqual(positive.start);
  expect(positive.angle).toBe(0);expect(negative.angle).toBe(-135);
  expect(positive.path).toContain('A 28 28 0 0 1');expect(negative.path).toContain('A 28 28 0 0 0');
 });
 it('moves its origin with base edits and clamps depth to reachable values',()=>{
  expect(modulationRing(32768,28,.5).angle).toBe(135);
  expect(modulationRing(65536,28,.9).angle).toBe(135);
  expect(modulationRing(-65536,28,.1).angle).toBe(-135);
  expect(modulationRing(0,28,.5).path).toBe('');expect(modulationRing(65536,28,1).path).toBe('');
  expect(modulationRing(65536,28,0).path).toContain('A 28 28 0 1 1');
 });
 it('places the live dot on the same scale, including saturation and opposing routes',()=>{
  expect(knobRingPoint(.5,34)).toEqual({x:36,y:2,angle:0});
  expect(knobRingPoint(2,34)).toEqual(knobRingPoint(1,34));
  expect(knobRingPoint(-1,34)).toEqual(knobRingPoint(0,34));
  expect(knobRingPoint(.4+.3-.2,34).angle).toBeCloseTo(0);
 });
});

describe('bipolar tilt range',()=>{
 it('shows both directions around neutral and reverses signed depth',()=>{
  const arcs=modulationRings(16384,28,.5,true);
  expect(arcs.map(a=>a.angle)).toEqual([67.5,-67.5]);
  expect(modulationRings(-16384,28,.5,true).map(a=>a.angle)).toEqual([-67.5,67.5]);
  expect(modulationRings(16384,28,.5,false)).toHaveLength(1);
 });
 it('shows the reachable side when neutral is at a parameter limit',()=>{
  const arcs=modulationRings(32768,28,0,true);
  expect(arcs[0].path).not.toBe('');expect(arcs[1].path).toBe('');
 });
});

import {effectiveParameters,initialPreset,physicalPresetFromUnknown} from './schema.ts';
it('applies signed X and Y tilt above and below neutral, with reversible depth',()=>{
 const p=physicalPresetFromUnknown(initialPreset);p.parameters[1]=32768;
 for(const axis of [0,1])for(const sign of [-1,1]){
  p.tiltRoutes.fill(0);p.tiltRoutes[2+axis]=sign*16384;
  const source=[0,0,0,0,0];source[3+axis]=1;
  expect(effectiveParameters(p,source)[1]).toBeCloseTo(32768/65535+sign*.25);
  source[3+axis]=-1;
  expect(effectiveParameters(p,source)[1]).toBeCloseTo(32768/65535-sign*.25);
 }
});
