import { describe,it,expect } from "vitest";
import { addRollNote,removeRollNote,measureLength,editRollNote,lessonRollNotes,reorderSteps } from "./courseTimeline.ts";
import { assessmentFingerprint,courseLayoutProgressId,canPassTimedLesson,courseFormat,parseCourse,type UserCourse } from "./courseFiles.ts";
import type { CourseLesson } from "./beginnerCourse.ts";
import { recordCourseRun,parseCourseProgress } from "./beginnerCourse.ts";
import { starterLayouts } from "./majorScale.ts";
const phrase:CourseLesson={id:"phrase",title:"Phrase",section:"Songs",instruction:"Play it.",targets:[[60,64],[],[62]],timing:{goalBpm:100,beats:[1,0.5,1],holdBeats:[[0.5,2],[],[0.25]]},fingerings:[{layoutId:starterLayouts()[0].layout.objectIdHex,steps:[[{note:60,hand:"left",finger:1}],[],[]]}]};
const course:UserCourse={format:courseFormat,id:"course",revision:1,title:"Course",author:"",bundle:starterLayouts()[0].bundle,lessons:[phrase]};
describe("canonical timed course editing",()=>{
  it("moves a chord voice onto another onset and carries its cue",()=>{
    const result=editRollNote(phrase,0,0,{onset:1.5});
    expect(result.targets).toEqual([[64],[],[60,62]]);
    expect(result.timing?.beats).toEqual([1,0.5,1]);
    expect(result.timing?.holdBeats).toEqual([[2],[],[0.5,0.25]]);
    expect(result.fingerings?.[0].steps[2]).toEqual([{note:60,hand:"left",finger:1}]);
    expect(parseCourse({...course,lessons:[result]}).lessons[0]).toMatchObject(result);
  });
  it("resizes independently of onset spacing and preserves rests",()=>{
    const result=editRollNote(phrase,0,0,{hold:0.25});
    expect(result.targets).toEqual(phrase.targets);
    expect(result.timing?.beats).toEqual(phrase.timing?.beats);
    expect(lessonRollNotes(result)[0].hold).toBe(0.25);
  });
  it("supports fractional pitches and rejects invalid subdivisions or duplicate chord notes",()=>{
    expect(lessonRollNotes(editRollNote(phrase,2,0,{pitch:62.315789})).at(-1)?.pitch).toBe(62.315789);
    expect(()=>editRollNote(phrase,0,0,{onset:0.3})).toThrow();
    expect(()=>editRollNote(phrase,0,0,{pitch:64})).toThrow(/distinct/);
    expect(()=>parseCourse({...course,lessons:[{...phrase,timing:{...phrase.timing!,holdBeats:[[0,1],[],[1]]}}]})).toThrow(/note length/);
  });
  it("moves steps with their durations, rests, and fingering",()=>{
    const moved=reorderSteps(phrase,0,2);
    expect(moved.targets).toEqual([[],[62],[60,64]]);
    expect(moved.timing?.beats).toEqual([0.5,1,1]);
    expect(moved.timing?.holdBeats).toEqual([[],[0.25],[0.5,2]]);
    expect(moved.fingerings?.[0].steps[2][0].finger).toBe(1);
  });
});
describe("assessment compatibility and tempo goals",()=>{
  it("ignores metadata, course revision, playback holds, and fingering advice",()=>{
    const fingerprint=assessmentFingerprint(course,phrase);
    expect(assessmentFingerprint({...course,title:"Renamed",revision:2},{...phrase,title:"New title",instruction:"New teaching text",timing:{...phrase.timing!,holdBeats:[[4,4],[],[4]]},fingerings:[]})).toBe(fingerprint);
    const changed={...phrase,targets:[[60],[62],[64]]};
    expect(assessmentFingerprint({...course,lessons:[phrase,changed]},phrase)).toBe(fingerprint);
    expect(assessmentFingerprint(course,changed)).not.toBe(fingerprint);
    expect(assessmentFingerprint(course,{...phrase,timing:{...phrase.timing!,goalBpm:110}})).not.toBe(fingerprint);
    expect(assessmentFingerprint(course,{...phrase,fingerings:[{layoutId:"test",steps:[[{note:60,button:1,acceptDuplicates:false}],[],[]]}]})).not.toBe(fingerprint);
  });
  it("preserves mapping progress for renames but separates changed key geometry",()=>{
    const layout=course.bundle.layouts[0];
    const key=courseLayoutProgressId(course.bundle,layout);
    expect(courseLayoutProgressId(course.bundle,{...layout,name:"Renamed"})).toBe(key);
    expect(courseLayoutProgressId(course.bundle,{...layout,centerStepsFromC:layout.centerStepsFromC+1})).not.toBe(key);
    const held=editRollNote(phrase,2,0,{hold:32});
    expect(held.timing?.beats).toEqual(phrase.timing?.beats);
    expect(assessmentFingerprint(course,held)).toBe(assessmentFingerprint(course,phrase));
  });
  it("scores slower practice without permitting completion and stores strongest passing results",()=>{
    expect(canPassTimedLesson(phrase,80,100,0)).toBe(false);
    expect(canPassTimedLesson(phrase,100,75,0)).toBe(true);
    expect(canPassTimedLesson(phrase,120,74,0)).toBe(false);
    expect(canPassTimedLesson(phrase,120,100,1)).toBe(false);
    const key=`user:course:${assessmentFingerprint(course,phrase)}:phrase`;
    let progress=recordCourseRun({},key,"layout",0,false,undefined,{score:95,bpm:100});
    progress=recordCourseRun(progress,key,"layout",1,true,undefined,{score:80,bpm:120});
    expect(parseCourseProgress(JSON.stringify(progress))[key].layout).toMatchObject({bestPassingScore:95,highestPassedBpm:120,independent:true,attempts:2});
  });
});

describe("direct piano roll authoring",()=>{
  it("starts blank, groups chords, and expands with silent gaps",()=>{
    const blank={...phrase,targets:[[]],timing:{goalBpm:100,beats:[1]},fingerings:[]};
    let edited=addRollNote(blank,60,0,1);
    edited=addRollNote(edited,64,0,0.5);
    edited=addRollNote(edited,67,20,2);
    expect(edited.targets[0]).toEqual([60,64]);
    expect(lessonRollNotes(edited).at(-1)).toMatchObject({pitch:67,onset:20,hold:2});
    expect(Math.max(...edited.timing!.beats)).toBeLessThanOrEqual(8);
    expect(parseCourse({...course,lessons:[edited]}).lessons[0]).toMatchObject(edited);
  });
  it("deletes a voice without shifting music or losing another voice's cue",()=>{
    const edited=removeRollNote(phrase,0,1);
    expect(edited.targets[0]).toEqual([60]);
    expect(edited.fingerings?.[0].steps[0][0].finger).toBe(1);
    const empty=removeRollNote(edited,0,0);
    expect(empty.targets[0]).toEqual([]);
    expect(lessonRollNotes(empty)[0]).toMatchObject({pitch:62,onset:1.5});
    expect(removeRollNote(empty,2,0).targets.flat()).toEqual([]);
  });
  it("round trips meter without changing assessment or quarter-note timing",()=>{
    for(const [numerator,denominator,length] of [[3,4,3],[6,8,3],[7,8,3.5]]){
      const lesson={...phrase,timeSignature:{numerator,denominator}};
      expect(measureLength(lesson)).toBe(length);
      expect(parseCourse({...course,lessons:[lesson]}).lessons[0].timeSignature).toEqual(lesson.timeSignature);
      expect(assessmentFingerprint(course,lesson)).toBe(assessmentFingerprint(course,phrase));
    }
    expect(measureLength(phrase)).toBe(4);
    for(const meter of [{numerator:0,denominator:4},{numerator:3,denominator:3},{numerator:2.5,denominator:8}])expect(()=>parseCourse({...course,lessons:[{...phrase,timeSignature:meter}]})).toThrow(/signature/);
  });
});
