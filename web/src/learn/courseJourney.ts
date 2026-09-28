import type {CourseLesson, CourseProgress} from "./beginnerCourse.ts";
import {courseProgressId, type UserCourse} from "./courseFiles.ts";
import {canPassTimedLesson} from "./courseFiles.ts";

export function courseJourney(course: UserCourse, layoutProgressId: string, progress: CourseProgress) {
  const entries = course.lessons.map((lesson,index) => {
    const assessed = lesson.kind !== "content" && lesson.kind !== "exploration" && lesson.assessment?.graded !== false;
    const result = assessed ? progress[courseProgressId(course,lesson.id)]?.[layoutProgressId] : undefined;
    return {lesson,index,assessed,completed:!!result,independent:result?.independent===true};
  });
  const completed = entries.filter(entry=>entry.completed).length;
  const total = entries.filter(entry=>entry.assessed).length;
  const next = entries.find(entry=>entry.assessed&&!entry.completed)?.index;
  return {entries,completed,total,next};
}

export interface PracticeResult {
  mistakes: number;
  beat?: {score:number;missed:number;extras:number;releaseMisses?:number};
}
export function completionGuidance(lesson:CourseLesson,result:PracticeResult|undefined,bpm:number,streak:number,stepMode:boolean):string {
  if(lesson.kind === "exploration" || lesson.assessment?.graded === false) return "Keep one idea you liked. You can explore again or move on when you are ready.";
  if(lesson.timing && (stepMode || bpm < lesson.timing.goalBpm)) return `You rehearsed the phrase. When it feels comfortable, work toward ${lesson.timing.goalBpm} BPM; slower practice is always available.`;
  if(result?.beat && (!canPassTimedLesson(lesson,bpm,result.beat.score,result.beat.missed) || result.beat.releaseMisses)) return "Choose one tricky change. Slow down or use Step, listen once, then try that passage again before returning to the goal tempo.";
  if((lesson.repetitions??1)>1 && streak<(lesson.repetitions??1)) return streak>0
    ? `${streak} of ${lesson.repetitions} clean runs. Repeat with the same hints setting to finish this checkpoint.`
    : "Take your time with the difficult change, then start a fresh set of clean runs. A short break can help, too.";
  return result?.mistakes ? "You reached the end. Revisit the change that needed a correction, or continue and return to it later." : "You played it through. Try recalling it without hints, move on, or finish today with a tune you enjoy.";
}

/** Keep rhythmic fractions readable instead of showing floating-point decimals. */
export function beatLabel(beats:number):string {
  const whole=Math.floor(beats),twelfths=Math.round((beats-whole)*12);
  const fractions:Record<number,string>={1:"1/12",2:"1/6",3:"¼",4:"⅓",5:"5/12",6:"½",7:"7/12",8:"⅔",9:"¾",10:"5/6",11:"11/12"};
  if(!twelfths)return String(whole);
  if(twelfths===12)return String(whole+1);
  return `${whole?`${whole} `:""}${fractions[twelfths]}`;
}
