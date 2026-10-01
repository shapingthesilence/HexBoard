import {describe,it,expect} from "vitest";
import {timingCueFrame,upcomingTimingSteps} from "./timingCues.ts";
describe("two-beat timing cues",()=>{
 it("stays hidden until two beats remain and collapses exactly at the onset",()=>{
  expect(timingCueFrame(2000,500,999).opacity).toBe(0);
  expect(timingCueFrame(2000,500,1000)).toEqual({opacity:0.35,scale:2.4});
  expect(timingCueFrame(2000,500,1500)).toEqual({opacity:0.675,scale:1.7});
  expect(timingCueFrame(2000,500,2000)).toEqual({opacity:1,scale:1});
  expect(timingCueFrame(2000,500,2001).opacity).toBe(0);
  expect(timingCueFrame(2000,500,999,true).opacity).toBe(0);
  expect(timingCueFrame(2000,500,1000,true)).toEqual({opacity:0.35,scale:1.1});
  expect(timingCueFrame(2000,500,1500,true)).toEqual({opacity:0.675,scale:1.1});
 });
 it("includes simultaneous upcoming subdivisions independently of the active target",()=>{
  expect(upcomingTimingSteps([0,0.25,0.5,1,2,3],1000,1000,1000,0)).toEqual([{step:0,dueAt:1000},{step:1,dueAt:1250},{step:2,dueAt:1500},{step:3,dueAt:2000},{step:4,dueAt:3000}]);
  expect(upcomingTimingSteps([0,0.25,0.5,1],1000,1000,1100,2)).toEqual([{step:2,dueAt:1500},{step:3,dueAt:2000}]);
 });
 it("mounts the first cue before its two-beat window during the count-in",()=>{
  expect(upcomingTimingSteps([0],4000,1000,1949,0)).toEqual([]);
  expect(upcomingTimingSteps([0],4000,1000,1950,0)).toEqual([{step:0,dueAt:4000}]);
  expect(timingCueFrame(4000,1000,1950).opacity).toBe(0);
  expect(timingCueFrame(4000,1000,2000).opacity).toBe(0.35);
 });
});
