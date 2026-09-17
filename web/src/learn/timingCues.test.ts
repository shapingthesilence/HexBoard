import {describe,it,expect} from "vitest";
import {timingCueFrame,upcomingTimingSteps} from "./timingCues.ts";
describe("one-quarter timing cues",()=>{
 it("stays hidden until one quarter remains and collapses exactly at the onset",()=>{
  expect(timingCueFrame(2000,500,1499).opacity).toBe(0);
  expect(timingCueFrame(2000,500,1500)).toEqual({opacity:0.35,scale:2.4});
  expect(timingCueFrame(2000,500,2000)).toEqual({opacity:1,scale:1});
  expect(timingCueFrame(2000,500,2001).opacity).toBe(0);
  expect(timingCueFrame(2000,500,1499,true).opacity).toBe(0);
 });
 it("includes simultaneous upcoming subdivisions independently of the active target",()=>{
  expect(upcomingTimingSteps([0,0.25,0.5,1,2],1000,1000,1000,0)).toEqual([{step:0,dueAt:1000},{step:1,dueAt:1250},{step:2,dueAt:1500},{step:3,dueAt:2000}]);
  expect(upcomingTimingSteps([0,0.25,0.5,1],1000,1000,1100,2)).toEqual([{step:2,dueAt:1500},{step:3,dueAt:2000}]);
 });
});
