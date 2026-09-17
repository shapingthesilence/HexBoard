import {describe,it,expect} from "vitest";
import {beginnerLessons} from "./beginnerCourse.ts";
import {intermediateCourse,intermediateLessons} from "./intermediateCourse.ts";
import {courseFormat,parseCourse,lessonCues,cueAccepts,courseProgressId} from "./courseFiles.ts";
import {parseCourseProgress,recordCourseRun} from "./beginnerCourse.ts";
import {resolveLessonKeys,starterLayouts} from "./majorScale.ts";
import {BeatScaleRun} from "./scalePractice.ts";
const layouts=starterLayouts();
describe("built-in teaching courses",()=>{
  it("exports both courses as valid self-contained course files",()=>{
    expect(parseCourse(intermediateCourse).lessons).toHaveLength(10);
    expect(parseCourse({format:courseFormat,id:"hexboard-beginner",revision:1,title:"Beginner",author:"HexBoard",bundle:intermediateCourse.bundle,lessons:beginnerLessons}).lessons).toHaveLength(15);
  });
  for(const layout of layouts)it(`uses compact stable physical recommendations on ${layout.layout.name}`,()=>{
    const keys=resolveLessonKeys(layout),assigned=new Map<number,number>();
    for(const lesson of [...beginnerLessons,...intermediateLessons.slice(0,8)]){
      lesson.targets.forEach((notes,step)=>{
        const cues=lessonCues(lesson,layout.layout.objectIdHex,step);
        expect(cues).toHaveLength(notes.length);
        for(const cue of cues){
          expect(keys[cue.button!].note).toBe(cue.note);
          expect(cue.acceptDuplicates).toBe(true);
          if(assigned.has(cue.note))expect(cue.button).toBe(assigned.get(cue.note));
          assigned.set(cue.note,cue.button!);
          for(const duplicate of keys.filter(key=>key.note===cue.note))expect(cueAccepts(cues,duplicate.key.index,cue.note)).toBe(true);
        }
      });
    }
    const distance=(a:number,b:number)=>Math.hypot((keys[a].key.coordCol-keys[b].key.coordCol)*25,(keys[a].key.row-keys[b].key.row)*42);
    const diameter=(buttons:number[])=>Math.max(...buttons.flatMap(a=>buttons.map(b=>distance(a,b))));
    const preferred=[...assigned.values()];
    const firstMatches=[...assigned.keys()].map(pitch=>keys.find(key=>key.note===pitch)!.key.index);
    expect(diameter(preferred)).toBeLessThanOrEqual(diameter(firstMatches));
    // Under seven physical key spacings, across all course pitches together.
    expect(diameter(preferred)).toBeLessThan(350);
  });
  it("withdraws preferred-button cues only at the explicit duplicate lesson",()=>{
    expect(intermediateLessons[8].id).toBe("duplicate-buttons");
    for(const layout of layouts)for(const pitch of intermediateLessons[8].targets.flat())expect(resolveLessonKeys(layout).filter(key=>key.note===pitch).length,`${layout.layout.name}: ${pitch}`).toBeGreaterThan(1);
    expect(intermediateLessons.slice(8).every(lesson=>!lesson.fingerings)).toBe(true);
    expect(intermediateLessons.slice(0,8).every(lesson=>lesson.fingerings?.length===3)).toBe(true);
  });
  it("scores every timed lesson at its authored goal on all supported layouts",()=>{
    for(const layout of layouts)for(const lesson of intermediateLessons){
      if(!lesson.timing)continue;
      const keys=resolveLessonKeys(layout),period=60000/lesson.timing.goalBpm;
      const run=new BeatScaleRun(lesson.targets.map(target=>target[0]??-1),10000,lesson.timing.goalBpm,undefined,{targets:lesson.targets,beats:lesson.timing.beats,accepts:(step,index,note)=>cueAccepts(lessonCues(lesson,layout.layout.objectIdHex,step),index,note)});
      let offset=0;
      lesson.targets.forEach((target,step)=>{
        const at=10000+offset*period;
        for(const [index] of run.held)run.release(index,at);
        for(const note of target){const cue=lessonCues(lesson,layout.layout.objectIdHex,step).find(cue=>cue.note===note);run.press(cue?.button??keys.find(key=>key.note===note)!.key.index,note,at);}
        offset+=lesson.timing!.beats[step];
        run.tick(10000+offset*period-1);
      });
      run.tick(10000+offset*period+1);
      expect(run.complete,lesson.title).toBe(true);
      expect(run.result().score,lesson.title).toBe(100);
    }
  });
  it("retains intermediate progress through export and reload",()=>{
    const key=courseProgressId(intermediateCourse,intermediateLessons[0].id);
    const progress=recordCourseRun({},key,"layout",0,true,undefined,{score:100,bpm:60});
    expect(parseCourseProgress(JSON.stringify(progress))).toEqual(progress);
  });
});
