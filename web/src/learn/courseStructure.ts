import type {UserCourse} from "./courseFiles.ts";
import {resolveLessonKeys,noteName} from "./majorScale.ts";
import type {CourseLesson} from "./beginnerCourse.ts";
export function compatibilityReport(course:UserCourse){return course.lessons.flatMap(lesson=>course.bundle.layouts.map(layout=>{
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
 return {...course,bundle:{...course.bundle,layouts:course.bundle.layouts.map(layout=>layout.objectIdHex!==id?layout:{...layout,centerStepsFromC:layout.centerStepsFromC+steps,buttonOverrides:layout.buttonOverrides.map(key=>key.stepsFromC===undefined?key:{...key,stepsFromC:key.stepsFromC+steps}),offGridOverrides:layout.offGridOverrides.map(key=>key.stepsFromC===undefined?key:{...key,stepsFromC:key.stepsFromC+steps})})}};
}
