import {describe,it,expect} from "vitest";
import {builtinCourses,firstStepsCourse,movementCourse,rhythmCourse,majorScaleCourse} from "./curriculumCourses.ts";
import {parseCourse,readCourseFile,lessonCues,cueAccepts,courseProgressId} from "./courseFiles.ts";
import {CourseRun,parseCourseProgress,recordCourseRun} from "./beginnerCourse.ts";
import {resolveLessonKeys,starterLayouts} from "./majorScale.ts";
import {compatibilityReport} from "./courseStructure.ts";
import {BeatScaleRun} from "./scalePractice.ts";
const layouts=starterLayouts();
describe("foundation curriculum",()=>{
  it("teaches the physical instrument with sourced, rehearsed melodies",()=>{
    for(const course of builtinCourses){
      const teaching=[course.description,...course.lessons.flatMap(lesson=>[lesson.instruction,lesson.markdown])].join(" ");
      expect(teaching).not.toMatch(/on screen|click (?:a |the )?key|Try on screen/i);
      expect(teaching).not.toMatch(/Turn off Hints|Try without hints|Toggle hints/i);
      for(const lesson of course.lessons.filter(lesson=>lesson.kind==="content"&&/Hear example/i.test(lesson.markdown??"")))
        expect(lesson.markdown).toMatch(/Continue/i);
    }
    const first=firstStepsCourse.lessons.find(lesson=>lesson.id==="homecoming")!;
    expect(first.title).toContain("Ode to Joy");
    expect(first.targets).toEqual(firstStepsCourse.lessons.find(lesson=>lesson.id==="homecoming-rehearsal")!.targets);
    expect(first.timing!.beats.reduce((a,b)=>a+b,0)).toBe(16);
    const play=movementCourse.lessons.find(lesson=>lesson.kind==="exploration")!;
    expect(play.assessment?.graded).toBe(false);
    expect(play.exploration?.durationSeconds).toBe(45);
  });
  it("ships ordered self-contained courses with unique identities",()=>{
    expect(builtinCourses.map(course=>course.lessons.length)).toEqual([13,19,27,28]);
    expect(new Set(builtinCourses.map(course=>course.id)).size).toBe(builtinCourses.length);
    for(const course of builtinCourses){
      const loaded=readCourseFile(JSON.stringify(course));
      expect(loaded).toEqual(parseCourse(course));
      expect(new Set(loaded.lessons.map(lesson=>lesson.id)).size).toBe(loaded.lessons.length);
      expect(compatibilityReport(loaded).flatMap(row=>row.issues)).toEqual([]);
      expect(loaded.lessons.at(-1)?.repetitions).toBeGreaterThanOrEqual(1);
    }
  });
  for(const layout of layouts)it(`completes all practice on ${layout.layout.name}`,()=>{
    const keys=resolveLessonKeys(layout);
    for(const course of builtinCourses)for(const lesson of parseCourse(course).lessons){
      if(lesson.kind==="content"||lesson.kind==="exploration")continue;
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
      for(const [id,size,groups] of [["moon-travel",6,2],["interval-locations",3,2],["move-fifth",3,2],["duplicate-route",5,2],["transpose-motif",5,3],["twinkle-travel",7,2],["shape-checkpoint",7,2]] as const){
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
  it("keeps the whole major-scale and melody routes intact when changing key",()=>{
    const lessons=majorScaleCourse.lessons;
    for(const [from,to] of [["scale-up","d-scale"],["degree-walk","d-degree-walk"],["twinkle-c-pulse","twinkle-d-notes"]]){
      const original=lessons.find(l=>l.id===from)!,moved=lessons.find(l=>l.id===to)!;
      expect(moved.targets).toEqual(original.targets.map(chord=>chord.map(note=>note+2)));
      for(const layout of layouts){
        const keys=resolveLessonKeys(layout);
        const points=(lesson:typeof original)=>lesson.fingerings!.find(f=>f.layoutId===layout.layout.objectIdHex)!.steps.map(step=>keys[step[0].button!].key);
        const relative=(lesson:typeof original)=>{const route=points(lesson);return route.map(key=>[key.coordCol-route[0].coordCol,key.row-route[0].row]);};
        expect(relative(moved),`${layout.layout.name}: ${to}`).toEqual(relative(original));
      }
    }
  });
  it("builds scale fluency before timing and distinguishes scale steps from fixed intervals",()=>{
    const lessons=majorScaleCourse.lessons,up=lessons.find(l=>l.id==="scale-up")!.targets.flat();
    expect(up.slice(1).map((note,index)=>note-up[index])).toEqual([2,2,1,2,2,2,1]);
    expect(lessons.find(l=>l.id==="joy-scale")!.targets.flat()).toEqual([...up].reverse());
    expect(lessons.find(l=>l.id==="scale-return")!.targets.flat()).toEqual([...up,...up.slice(0,-1).reverse()]);
    const thirds=lessons.find(l=>l.id==="scale-thirds")!.targets.flat();
    for(let i=0;i<thirds.length;i+=2)expect(up.indexOf(thirds[i+1])-up.indexOf(thirds[i])).toBe(2);
    expect(new Set(thirds.filter((_,i)=>i%2===0).map((note,i)=>thirds[2*i+1]-note))).toEqual(new Set([3,4]));
    const firstTimed=lessons.findIndex(l=>l.timing),dPractice=lessons.findIndex(l=>l.id==="twinkle-d-notes"),dTimed=lessons.findIndex(l=>l.id==="twinkle-d-rehearsal");
    expect(firstTimed).toBeGreaterThan(lessons.findIndex(l=>l.id==="moon-degrees"));
    expect(dTimed).toBeGreaterThan(dPractice);
    const rehearsal=lessons[dTimed],final=lessons.at(-1)!;
    expect(final.targets).toEqual(rehearsal.targets);
    expect(final.timing!.beats).toEqual(rehearsal.timing!.beats);
    expect(final.timing!.goalBpm).toBeGreaterThan(rehearsal.timing!.goalBpm);
    expect(final.timing!.beats.reduce((a,b)=>a+b,0)).toBe(16);
  });
  it("prepares larger jumps with familiar music and isolated rhythm changes",()=>{
    const first=firstStepsCourse.lessons;
    expect(first.findIndex(l=>l.id==="first-moon-tune")).toBeLessThan(first.findIndex(l=>l.id==="octaves"));
    const movement=movementCourse.lessons;
    expect(movement.find(l=>l.id==="twinkle-home")!.targets).toEqual(movement.find(l=>l.id==="twinkle-travel")!.targets.slice(0,7));
    const rhythm=rhythmCourse.lessons,rehearsal=rhythm.find(l=>l.id==="six-eight-rehearsal")!,dance=rhythm.find(l=>l.id==="six-eight")!;
    expect(rehearsal.targets).toEqual(dance.targets);
    expect(rehearsal.timing).toBeUndefined();
    expect(rhythm.find(l=>l.id==="six-eight-spacing")!.timing!.beats).toEqual(dance.timing!.beats);
    const switcher=rhythm.find(l=>l.id==="switch-subdivision")!;
    expect(switcher.targets.flat().every(note=>note===60)).toBe(true);
    expect(switcher.timing!.beats.reduce((a,b)=>a+b,0)).toBeCloseTo(4);
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
