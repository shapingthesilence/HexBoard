import {describe,it,expect} from 'vitest';
import {partialAmountFor,partialOctaves,partialRing} from './WavetableIntervalControls.tsx';
import {defaultTuning} from './wavetableIntervals.ts';
import {P,optionValue} from './wavetableSchema.ts';

const part=(mode:number,num=1,den=1)=>[optionValue(P.Partial1Mode,mode),32768,num,den,30000,40000,32768];
describe('partials picture',()=>{
 it('retunes a dragged partial to the nearest pitch its unit can reach',()=>{
  // Ratio and cents move freely; the offset is what remains after the ratio.
  const fifth=part(1,3,2),moved=[...fifth];moved[1]=partialAmountFor(defaultTuning,fifth,1);
  expect(partialOctaves(defaultTuning,moved)).toBeCloseTo(1,3);
  // Steps and periods land on the tuning.
  const steps=part(2),stepped=[...steps];stepped[1]=partialAmountFor(defaultTuning,steps,.6);
  expect(partialOctaves(defaultTuning,stepped)).toBeCloseTo(7/12,5);
  const periods=part(3),octave=[...periods];octave[1]=partialAmountFor(defaultTuning,periods,1.4);
  expect(partialOctaves(defaultTuning,octave)).toBeCloseTo(1,5);
 });
 it('draws longer trails for longer decays',()=>{
  expect(partialRing(.5,1,0)).toBe(.5);
  expect(partialRing(.5,1,1)).toBeGreaterThan(partialRing(.5,.2,1)*10);
 });
});
