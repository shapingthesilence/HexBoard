import {describe,it,expect} from 'vitest';
import {defaultTuning,gridOffset,intervalPitch,intervalValue,parseRatio,customBody,bodyPartials,bodyLines,unisonPitches} from './wavetableIntervals.ts';
import {initialWavetable,P,optionValue,validWavetable} from './wavetableSchema.ts';

describe('portable musical intervals',()=>{
 it('preserves exact ratios and accepts familiar ratio notation',()=>{
  expect(parseRatio('3:2')).toEqual([3,2]);expect(parseRatio('1.5')).toEqual([3,2]);expect(parseRatio('7/4')).toEqual([7,4]);
  for(const text of ['', 'no', '3/0', '-1', '100', '1/100', '1/2/3'])expect(parseRatio(text)).toBeUndefined();
  expect(2**intervalPitch(defaultTuning,Math.log2(220),1,32768,3,2)).toBeCloseTo(330,8);
 });
 it('walks unequal steps and non-octave periods in either direction',()=>{
  const root=Math.log2(220),g={revision:1,count:3,root,period:1,pitches:[0,Math.log2(1.2),Math.log2(1.6)]};
  expect(2**gridOffset(g,Math.log2(264),1)).toBeCloseTo(352,8);expect(2**gridOffset(g,root,-1)).toBeCloseTo(176,8);
  g.period=Math.log2(3);g.pitches=[0,g.period/3,2*g.period/3];
  expect(2**intervalPitch(g,root,3,intervalValue(1,2),1,1)).toBeCloseTo(660,8);
 });
 it('opens a built-in body for editing without changing its voicing',()=>{
  const p=initialWavetable();p.parameters[P.Resonator]=optionValue(P.Resonator,2);
  const parts=bodyPartials(p),custom=customBody(p);expect(bodyPartials(custom)).toEqual(parts);expect(validWavetable(custom)).toBe(true);
  expect(p.parameters[P.Resonator]).toBe(optionValue(P.Resonator,2));expect(custom.parameters[P.Partial4Num]).toBe(20);
 });
 it('keeps crossfade endpoints on the selected scale and level motion pitch-stable',()=>{
  const p=initialWavetable();p.parameters[P.Resonator]=optionValue(P.Resonator,1);p.parameters[P.NaturalTuned]=65535;
  p.parameters[P.BodyMotion]=optionValue(P.BodyMotion,2);p.parameters[P.ResonatorTune]=11000;
  for(const line of bodyLines(p,defaultTuning)){const steps=Math.log2(line.ratio)*12;expect(steps).toBeCloseTo(Math.round(steps),7);}
  p.parameters[P.BodyMotion]=optionValue(P.BodyMotion,3);const first=bodyLines(p,defaultTuning);p.parameters[P.ResonatorTune]=55000;const last=bodyLines(p,defaultTuning);
  expect(first.map(x=>x.ratio)).toEqual(last.map(x=>x.ratio));expect(first.map(x=>x.level)).not.toEqual(last.map(x=>x.level));
 });
});

it('previews beat-Hz spacing and alternating ratio stacks',()=>{
 const p=initialWavetable();p.parameters[P.Unison]=optionValue(P.Unison,2);p.parameters[P.UnisonMode]=optionValue(P.UnisonMode,1);p.parameters[P.BeatRate]=32768;
 let q=unisonPitches(p,defaultTuning,p.parameters.map(v=>v/65535));expect(q.frequencies[1]-q.frequencies[0]).toBeCloseTo(2,3);expect(q.frequencies[2]-q.frequencies[1]).toBeCloseTo(2,3);
 p.parameters[P.UnisonMode]=optionValue(P.UnisonMode,2);q=unisonPitches(p,defaultTuning,p.parameters.map(v=>v/65535));[1,1.5,2/3].forEach((r,i)=>expect(q.frequencies[i]/q.base).toBeCloseTo(r,10));
});
