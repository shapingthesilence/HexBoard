import {describe,it,expect} from "vitest";
import {lessonPreviewEvents} from "./lessonPreview.ts";
import type {CourseLesson} from "./beginnerCourse.ts";
const phrase:CourseLesson={id:"preview",title:"Preview",section:"Songs",instruction:"Play",targets:[[60,64.25],[],[60]],timing:{goalBpm:120,beats:[1,1,1],holdBeats:[[4,0.5],[],[1]]}};
describe("authoring preview",()=>{
  it("plays chords, microtonal pitches and rests, and retriggers overlapping pitches safely",()=>{
    expect(lessonPreviewEvents(phrase)).toEqual([
      {at:0,pitch:60,on:true},{at:0,pitch:64.25,on:true},
      {at:250,pitch:64.25,on:false},
      {at:1000,pitch:60,on:false},{at:1000,pitch:60,on:true},
      {at:1500,pitch:60,on:false},
    ]);
  });
  it("uses even quarter notes for free timing and accepts empty drafts",()=>{
    expect(lessonPreviewEvents({...phrase,targets:[[60],[62]],timing:undefined})).toEqual([
      {at:0,pitch:60,on:true},{at:750,pitch:60,on:false},
      {at:750,pitch:62,on:true},{at:1500,pitch:62,on:false},
    ]);
    expect(lessonPreviewEvents({...phrase,targets:[[]],timing:{goalBpm:80,beats:[1]}})).toEqual([]);
  });
});
