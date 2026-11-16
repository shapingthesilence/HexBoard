import { describe, expect, it } from "vitest";
import { CourseRun, type CourseLesson } from "./beginnerCourse.ts";
import { BeatScaleRun } from "./scalePractice.ts";
import { answerAllows, matchAnswer, parseAnswer, parseExploration } from "./lessonAnswers.ts";
import { ExplorationRun, accompanimentAt } from "./exploration.ts";
import { assessmentFingerprint, parsePhrase, courseFormat, lessonCues, parseCourse, cueAccepts, type UserCourse } from "./courseFiles.ts";
import { starterLayouts } from "./majorScale.ts";
import { editRollNote, reorderSteps } from "./courseTimeline.ts";
import { compatibilityReport } from "./courseStructure.ts";
const lesson:CourseLesson={id:"answers",title:"Answers",section:"Music",instruction:"Play",targets:[[60,64,67]],answers:[{pitchClasses:[0,4,7],min:48,max:84}]};
const course:UserCourse={format:courseFormat,id:"test",revision:1,title:"Test",author:"",bundle:starterLayouts()[0].bundle,lessons:[lesson]};
const held=(notes:number[])=>new Map(notes.map((note,i)=>[i,note]));
function timed(gradeDuration=true,hold=1) { return new BeatScaleRun([60,-1],1000,60,undefined,{targets:[[60],[]],beats:[1,1],holdBeats:[[hold],[]],gradeDuration,releaseWindowBeats:0.25}); }

describe("alternative lesson answers",()=>{
  it("accepts any C in range and rejects out-of-range and wrong pitches",()=>{
    const run=new CourseRun({...lesson,targets:[[60]],answers:[{pitchClasses:[0],min:48,max:72}]});
    run.press(0,84,10);expect(run.complete).toBe(false);run.release(0);
    run.press(1,61,20);expect(run.complete).toBe(false);run.release(1);
    run.press(2,72,30);expect(run.complete).toBe(true);
  });
  it("accepts inversions, but not missing, unrelated, or doubled chord voices",()=>{
    const rule=lesson.answers![0];
    expect(matchAnswer(lesson.targets[0],rule,held([64,67,72]))).toEqual([2,0,1]);
    for(const notes of [[60,64],[60,64,67,69],[60,64,67,72]])expect(matchAnswer(lesson.targets[0],rule,held(notes))).toBeUndefined();
    const run=new CourseRun(lesson);[64,67,72].forEach((note,i)=>run.press(i,note,10+i));expect(run.complete).toBe(true);
  });
  it("accepts only complete listed voicings, in both graders",()=>{
    const answers=[{voicings:[[60,64,67],[59,62,67]]}];
    expect(matchAnswer(lesson.targets[0],answers[0],held([60,62,67]))).toBeUndefined();
    const run=new BeatScaleRun([60],1000,60,undefined,{targets:lesson.targets,beats:[1],answers});
    [59,62,67].forEach((note,i)=>run.press(i,note,1000));run.tick(run.endAt);expect(run.result().score).toBe(100);
  });
  it("supports fractional pitches and custom periods",()=>{
    expect(parsePhrase("[@60.5 @64.25]").targets).toEqual([[60.5,64.25]]);
    const rule=parseAnswer({pitchClasses:[0.5],min:0,max:30,period:13},1);
    expect(answerAllows([0.5],rule,13.5)).toBe(true);expect(answerAllows([0.5],rule,12.5)).toBe(false);
  });
  it("round-trips and validates rules and keeps assessment progress separate",()=>{
    for(const format of ["hexboard.course.v2","hexboard.course.v3",courseFormat])expect(parseCourse({...course,format}).format).toBe(courseFormat);
    const parsed=parseCourse(course);expect(parsed.lessons[0].answers).toEqual([{pitchClasses:[0,4,7],min:48,max:84,period:12}]);
    for(const answers of [[],[{voicings:[[60]]}],[{pitchClasses:[0,0,7],min:48,max:84}],[{pitchClasses:[0,4,7],min:61,max:62}]])expect(()=>parseCourse({...course,lessons:[{...lesson,answers}]})).toThrow();
    expect(assessmentFingerprint(course,lesson)).not.toBe(assessmentFingerprint(course,{...lesson,answers:undefined}));
  });
  it("keeps rules on duration edits and reorder, clears changed pitch groups",()=>{
    const timed={...lesson,timing:{goalBpm:80,beats:[1]}};
    expect(editRollNote(timed,0,0,{hold:2}).answers).toEqual(lesson.answers);
    expect(editRollNote(timed,0,0,{pitch:61}).answers).toEqual([null]);
    const two={...lesson,targets:[...lesson.targets,[62]],answers:[lesson.answers![0],null]};
    expect(reorderSteps(two,0,1).answers).toEqual([null,lesson.answers![0]]);
  });
  it("requires only one available voicing for layout compatibility",()=>{
    const data={...course,lessons:[{...lesson,answers:[{voicings:[[0,1,2],[60,64,67]]}]}]};
    expect(compatibilityReport(data).some(row=>row.issues.length===0)).toBe(true);
  });
});

describe("optional duration grading",()=>{
  it("keeps onset-only behavior by default",()=>{const run=timed(false);run.press(0,60,1000);run.tick(run.endAt);expect(run.result()).toMatchObject({score:100,missed:0});expect(run.result().releaseMisses).toBeUndefined();});
  it("allows a forgiving early or late release",()=>{for(const release of [1750,2000,2250]){const run=timed();run.press(0,60,1000);run.release(0,release);run.tick(run.endAt);expect(run.result()).toMatchObject({score:100,releaseMisses:0});}});
  it("counts early, late and never-released notes once, including through rests",()=>{for(const release of [1200,2300,undefined]){const run=timed();run.press(0,60,1000);if(release)run.release(0,release);run.tick(run.endAt);run.tick(run.endAt+1000);expect(run.result().releaseMisses).toBe(1);expect(run.result().score).toBeLessThan(100);}});
  it("does not let a duplicate button sustain a note past its release",()=>{
    const run=timed();run.press(0,60,1000);run.press(1,60,1050);run.release(0,2000);run.tick(run.endAt);expect(run.result().releaseMisses).toBe(1);
  });
  it("waits through a final long hold and release window",()=>{const run=timed(true,4);run.press(0,60,1000);run.tick(3000);expect(run.complete).toBe(false);run.release(0,5000);run.tick(run.endAt);expect(run.result().releaseMisses).toBe(0);});
  it("grades alternative voices using their authored voice order",()=>{
    const run=new BeatScaleRun([60],1000,60,undefined,{targets:lesson.targets,beats:[1],answers:lesson.answers,gradeDuration:true,holdBeats:[[2,1,0.5]]});
    [64,67,72].forEach((note,i)=>run.press(i,note,1000));run.release(1,1500);run.release(0,2000);run.release(2,3000);run.tick(run.endAt);expect(run.result()).toMatchObject({score:100,releaseMisses:0});
  });
  it("fingerprints assessed holds but not demonstration-only holds",()=>{
    const a={...lesson,timing:{goalBpm:80,beats:[1],holdBeats:[[1,1,1]],gradeDuration:true}};
    const b={...a,timing:{...a.timing,holdBeats:[[2,2,2]]}};
    expect(assessmentFingerprint(course,a)).not.toBe(assessmentFingerprint(course,b));
    expect(assessmentFingerprint(course,{...a,timing:{...a.timing,gradeDuration:false}})).toBe(assessmentFingerprint(course,{...b,timing:{...b.timing,gradeDuration:false}}));
  });
});

describe("exploration",()=>{
  const activity={durationSeconds:10,min:48,max:84,pitchClasses:[0,2,4,5,7,9,11],highlighted:[60,64,67],accompaniment:{bpm:60,chords:[[48],[53],[]],beats:[2,1,1]}};
  it("runs without targets, accepts arbitrary ideas, and completes on time",()=>{
    const run=new ExplorationRun(activity,1000);expect(run.complete).toBe(false);run.press(0,61);expect(run.feedback).toContain("Outside");expect(run.mistakes).toBe(0);run.release(0);run.press(1,64);expect(run.step).toBe(0);run.tick(10999);expect(run.complete).toBe(false);run.tick(11000);expect(run.complete).toBe(true);expect(run.remaining(11000)).toBe(0);
  });
  it("loops chords and rests with an absolute clock and stops at the activity end",()=>{expect(accompanimentAt(activity,0)).toEqual([48]);expect(accompanimentAt(activity,2000)).toEqual([53]);expect(accompanimentAt(activity,3000)).toEqual([]);expect(accompanimentAt(activity,8500)).toEqual([48]);expect(accompanimentAt(activity,10000)).toEqual([]);});
  it("round-trips as a distinct ungraded lesson and rejects invalid activities",()=>{
    const parsed=parseCourse({...course,lessons:[{...lesson,kind:"exploration",targets:[],exploration:activity}]});expect(parsed.lessons[0]).toMatchObject({kind:"exploration",targets:[],assessment:{graded:false}});expect(parsed.lessons[0].answers).toBeUndefined();
    for(const invalid of [{...activity,durationSeconds:NaN},{...activity,min:90},{...activity,highlighted:[61]},{...activity,accompaniment:{...activity.accompaniment,beats:[0]}}])expect(()=>parseExploration(invalid)).toThrow();
  });
});

describe("lesson-wide key requirements",()=>{
  const fingered={...lesson,targets:[[60]],answers:undefined,fingerings:[{layoutId:course.bundle.layouts[0].objectIdHex,steps:[[{note:60,button:1,acceptDuplicates:false}]]}]};
  it("lets explicit lesson policy override per-note legacy flags",()=>{
    for(const required of [false,true]){
      const parsed=parseCourse({...course,lessons:[{...fingered,assessment:{requireButtons:required}}]}).lessons[0];
      expect(parsed.assessment?.requireButtons).toBe(required);expect(cueAccepts(lessonCues(parsed,course.bundle.layouts[0].objectIdHex,0),2,60)).toBe(!required);
    }
  });
  it("imports old strict cues into a durable lesson policy",()=>{expect(parseCourse({...course,lessons:[fingered]}).lessons[0].assessment?.requireButtons).toBe(true);});
});
