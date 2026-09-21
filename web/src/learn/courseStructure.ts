import {tuningPitch,tuningPeriod} from "./tuningPractice.ts";
import type {TuningBundle} from "../catalogs/layoutsCatalog.ts";
import type {UserCourse} from "./courseFiles.ts";
import {resolveLessonKeys,noteName} from "./majorScale.ts";
import type {CourseLesson} from "./beginnerCourse.ts";
export function compatibilityReport(course:UserCourse){return course.lessons.flatMap(lesson=>course.bundle.layouts.filter(layout=>!lesson.layoutId||layout.objectIdHex===lesson.layoutId).map(layout=>{
 const keys=resolveLessonKeys({id:layout.objectIdHex,label:layout.name,bundle:course.bundle,layout});
 const issues:string[]=[];
 if(lesson.kind!=="content"){
 for(const pitch of new Set(lesson.targets.flat()))if(!keys.some(key=>key.note===pitch))issues.push(`Missing ${Number.isInteger(pitch)?noteName(pitch):`pitch ${pitch.toFixed(3)}`}`);
 for(const [step,cues] of (lesson.fingerings?.find(item=>item.layoutId===layout.objectIdHex)?.steps??[]).entries())for(const cue of cues)if(cue.button!==undefined&&keys[cue.button]?.note!==cue.note)issues.push(`Step ${step+1}: reassign key ${cue.button} for ${noteName(cue.note)}`);
 }
 return {lessonId:lesson.id,lesson:lesson.title,layoutId:layout.objectIdHex,layout:layout.name,issues};
}));}
export function reorderCourse(lessons:CourseLesson[],source:{lesson?:string;section?:string},target:{lesson?:string;section:string}):CourseLesson[]{
 if(source.lesson===target.lesson&&source.lesson||source.section===target.section&&source.section)return lessons;
 const moving=lessons.filter(item=>source.lesson?item.id===source.lesson:item.section===source.section);
 const remaining=lessons.filter(item=>!moving.includes(item));
 const index=target.lesson?remaining.findIndex(item=>item.id===target.lesson):remaining.findIndex(item=>item.section===target.section);
 const changed=source.lesson?moving.map(item=>({...item,section:target.section})):moving;
 remaining.splice(index<0?remaining.length:index,0,...changed);return remaining;
}
export function transposeCourseLayout(course:UserCourse,id:string,steps:number):UserCourse{
 if(!Number.isInteger(steps))throw new Error("Transpose by a whole tuning step.");
 return {...course,layoutTranspositions:{...course.layoutTranspositions,[id]:(course.layoutTranspositions?.[id]??0)+steps},bundle:{...course.bundle,layouts:course.bundle.layouts.map(layout=>layout.objectIdHex!==id?layout:{...layout,centerStepsFromC:layout.centerStepsFromC+steps,buttonOverrides:layout.buttonOverrides.map(key=>key.stepsFromC===undefined?key:{...key,stepsFromC:key.stepsFromC+steps}),offGridOverrides:layout.offGridOverrides.map(key=>key.stepsFromC===undefined?key:{...key,stepsFromC:key.stepsFromC+steps})})}};
}

export function incompatibleCourseTuning(course:UserCourse,bundle:TuningBundle):boolean {
  if(JSON.stringify(course.bundle.tuning)===JSON.stringify(bundle.tuning))return false;
  const tuning=bundle.tuning,period=tuningPeriod(tuning)/100;
  return course.lessons.some(lesson=>lesson.kind!=="content"&&lesson.targets.flat().some(pitch=>{
    for(let degree=0;degree<tuning.cycleLength;degree++){
      const base=tuningPitch(tuning,tuning.referenceDegree+degree);
      const cycle=Math.round((pitch-base)/period);
      if(Math.abs(tuningPitch(tuning,tuning.referenceDegree+degree+cycle*tuning.cycleLength)-pitch)<1e-7)return false;
    }
    return true;
  }));
}
export function replaceCourseBundle(course:UserCourse,bundle:TuningBundle,clear=false):UserCourse {
  const changed=JSON.stringify(course.bundle.tuning)!==JSON.stringify(bundle.tuning);
  return {...course,bundle,layoutId:undefined,layoutTranspositions:Object.fromEntries(Object.entries(course.layoutTranspositions??{}).filter(([id])=>{const old=course.bundle.layouts.find(layout=>layout.objectIdHex===id),next=bundle.layouts.find(layout=>layout.objectIdHex===id);return !changed&&next&&JSON.stringify(old)===JSON.stringify(next);})),lessons:course.lessons.map(lesson=>({
    ...lesson,layoutId:bundle.layouts.some(layout=>layout.objectIdHex===lesson.layoutId)?lesson.layoutId:undefined,
    ...(clear&&lesson.kind!=="content"?{targets:[[]],timing:lesson.timing?{goalBpm:lesson.timing.goalBpm,beats:[1]}:undefined,fingerings:[]}:
    {fingerings:changed?[]:lesson.fingerings?.filter(cue=>bundle.layouts.some(layout=>layout.objectIdHex===cue.layoutId))})
  }))};
}
