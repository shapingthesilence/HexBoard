import {describe,it,expect} from "vitest";
import {builtinCourses,firstStepsCourse,movementCourse,rhythmCourse} from "./curriculumCourses.ts";
import {parseCourse,readCourseFile,lessonCues,cueAccepts,courseProgressId} from "./courseFiles.ts";
import {CourseRun,parseCourseProgress,recordCourseRun} from "./beginnerCourse.ts";
import {resolveLessonKeys,starterLayouts} from "./majorScale.ts";
import {compatibilityReport} from "./courseStructure.ts";
import {BeatScaleRun} from "./scalePractice.ts";
const layouts=starterLayouts();
describe("foundation curriculum",()=>{
  it("ships ordered self-contained courses with unique identities",()=>{
    expect(builtinCourses.map(course=>course.lessons.length)).toEqual([12,15,21]);
    expect(new Set(builtinCourses.map(course=>course.id)).size).toBe(builtinCourses.length);
    for(const course of builtinCourses){
      const loaded=readCourseFile(JSON.stringify(course));
      expect(loaded).toEqual(parseCourse(course));
      expect(new Set(loaded.lessons.map(lesson=>lesson.id)).size).toBe(loaded.lessons.length);
      expect(compatibilityReport(loaded).flatMap(row=>row.issues)).toEqual([]);
      expect(loaded.lessons.at(-1)?.repetitions).toBe(2);
    }
  });
  for(const layout of layouts)it(`completes all practice on ${layout.layout.name}`,()=>{
    const keys=resolveLessonKeys(layout);
    for(const course of builtinCourses)for(const lesson of parseCourse(course).lessons){
      if(lesson.kind==="content")continue;
      const run=new CourseRun(lesson,layout.layout.objectIdHex);
      for(let step=0;step<lesson.targets.length;step++){
        const target=lesson.targets[step];
        if(!target.length)continue;
        for(const [index] of run.held)run.release(index);
        for(const note of target){
          const cues=lessonCues(lesson,layout.layout.objectIdHex,step);
          const cue=cues.find(cue=>cue.note===note);
          const button=cue?.button??keys.find(key=>key.note===note)!.key.index;
          expect(keys[button].note,lesson.id).toBe(note);
          for(const duplicate of keys.filter(key=>key.note===note))expect(cueAccepts(cues,duplicate.key.index,note)).toBe(true);
          run.press(button,note,step*1000);
        }
      }
      expect(run.complete,`${course.title}: ${lesson.id}`).toBe(true);
      expect(run.mistakes,lesson.id).toBe(0);
      if(!lesson.timing)continue;
      const period=60000/lesson.timing.goalBpm;
      const beat=new BeatScaleRun(lesson.targets.map(target=>target[0]??-1),10000,lesson.timing.goalBpm,undefined,{targets:lesson.targets,beats:lesson.timing.beats,accepts:(step,index,note)=>cueAccepts(lessonCues(lesson,layout.layout.objectIdHex,step),index,note)});
      let offset=0;
      lesson.targets.forEach((target,step)=>{
        const at=10000+offset*period;
        for(const [index] of beat.held)beat.release(index,at);
        for(const note of target){
          const cue=lessonCues(lesson,layout.layout.objectIdHex,step).find(cue=>cue.note===note);
          beat.press(cue?.button??keys.find(key=>key.note===note)!.key.index,note,at);
        }
        offset+=lesson.timing!.beats[step];
        beat.tick(10000+offset*period-1);
      });
      beat.tick(10000+offset*period+1);
      expect(beat.complete,lesson.id).toBe(true);
      expect(beat.result().score,lesson.id).toBe(100);
    }
  });
  it("introduces duplicates before timing and leaves route choice open",()=>{
    const lessons=firstStepsCourse.lessons,duplicate=lessons.findIndex(l=>l.id==="same-pitch");
    expect(duplicate).toBeLessThan(lessons.findIndex(l=>l.timing));
    expect(lessons[duplicate].fingerings).toBeUndefined();
    for(const layout of layouts)for(const pitch of lessons[duplicate].targets.flat())expect(resolveLessonKeys(layout).filter(key=>key.note===pitch).length).toBeGreaterThan(1);
    expect(movementCourse.lessons.find(l=>l.id==="choose-route")!.fingerings).toBeUndefined();
  });
  it("translates entire physical shapes, including duplicate-position phrases",()=>{
    for(const layout of layouts){
      const keys=resolveLessonKeys(layout);
      for(const [id,size,groups] of [["interval-locations",3,2],["move-fifth",3,2],["duplicate-route",5,2],["transpose-motif",5,3],["shape-checkpoint",5,2]] as const){
        const lesson=movementCourse.lessons.find(l=>l.id===id)!;
        const points=lesson.fingerings!.find(f=>f.layoutId===layout.layout.objectIdHex)!.steps.map(step=>keys[step[0].button!].key);
        const shape=(start:number)=>points.slice(start,start+size).map(key=>[key.coordCol-points[start].coordCol,key.row-points[start].row]);
        for(let group=1;group<groups;group++){
          expect(shape(group*size),`${layout.layout.name}: ${id}`).toEqual(shape(0));
          expect(points[group*size].index).not.toBe(points[0].index);
        }
      }
    }
  });
  it("uses quarter-note units and rehearsed checkpoints",()=>{
    const lessons=rhythmCourse.lessons;
    expect(lessons.find(l=>l.id==="triplets")!.timing!.beats).toEqual(Array(12).fill(1/3));
    const compound=lessons.find(l=>l.id==="six-eight")!;
    expect(compound.timeSignature).toEqual({numerator:6,denominator:8});
    expect(compound.timing!.beats.reduce((a,b)=>a+b,0)).toBe(6);
    const rehearsal=lessons.find(l=>l.id==="etude-rehearsal")!,checkpoint=lessons.at(-1)!;
    expect(checkpoint.targets).toEqual(rehearsal.targets);
    expect(checkpoint.timing!.beats).toEqual(rehearsal.timing!.beats);
    expect(checkpoint.timing!.beats.reduce((a,b)=>a+b,0)).toBeCloseTo(16);
    for(const course of builtinCourses){
      const lesson=course.lessons.at(-1)!,key=courseProgressId(course,lesson.id);
      const progress=recordCourseRun({},key,"layout",0,false);
      expect(parseCourseProgress(JSON.stringify(progress))).toEqual(progress);
    }
  });
});
