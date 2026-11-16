import type {CourseLesson, CourseProgress, LessonProgress} from "./beginnerCourse.ts";
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

/** Exercises are numbered 1..total; reading pages get no number. */
export function exerciseNumbers(lessons: readonly Pick<CourseLesson,"kind">[]) {
  let count = 0;
  const numbers = lessons.map(lesson => lesson.kind === "content" ? undefined : ++count);
  return { numbers, total: count };
}

/** Plain-language note length for the exercise strip, e.g. "1 beat", "½ beat". */
export function beatsText(beats:number):string {
  return `${beatLabel(beats)} beat${beats > 1 + 1e-9 ? "s" : ""}`;
}

export interface ProgressRow {
  lesson: CourseLesson; index: number; number?: number;
  layouts: { name: string; independent: boolean }[];
  bestScore?: number; bestBpm?: number;
}
/** Scored exercises grouped by section, with results for each known layout. */
export function courseProgressRows(course: UserCourse, progress: CourseProgress, layouts: readonly { id: string; name: string }[]) {
  const {numbers} = exerciseNumbers(course.lessons);
  const rows: ProgressRow[] = course.lessons.flatMap((lesson,index) => {
    if (lesson.kind === "content" || lesson.kind === "exploration" || lesson.assessment?.graded === false) return [];
    const saved = progress[courseProgressId(course,lesson.id)] ?? {};
    const results = layouts.flatMap(layout => saved[layout.id] ? [{name:layout.name,result:saved[layout.id] as LessonProgress}] : []);
    const scores = results.flatMap(({result}) => result.bestPassingScore === undefined ? [] : [result.bestPassingScore]);
    const tempos = results.flatMap(({result}) => result.highestPassedBpm === undefined ? [] : [result.highestPassedBpm]);
    return [{lesson,index,number:numbers[index],layouts:results.map(({name,result})=>({name,independent:result.independent})),
      ...(scores.length?{bestScore:Math.max(...scores)}:{}),...(tempos.length?{bestBpm:Math.max(...tempos)}:{})}];
  });
  const sections = [...new Set(rows.map(row => row.lesson.section))].map(section => ({section, rows: rows.filter(row => row.lesson.section === section)}));
  return {
    sections,
    total: rows.length,
    completed: rows.filter(row => row.layouts.length).length,
    independent: rows.filter(row => row.layouts.some(layout => layout.independent)).length,
  };
}

/** Remove every saved result for this course's lessons, on all layouts. */
export function resetCourseProgress(progress: CourseProgress, course: UserCourse): CourseProgress {
  const ids = new Set(course.lessons.map(lesson => courseProgressId(course, lesson.id)));
  return Object.fromEntries(Object.entries(progress).filter(([id]) => !ids.has(id)));
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
