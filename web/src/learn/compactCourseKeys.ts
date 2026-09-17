import type {CourseLesson} from "./beginnerCourse.ts";
import {resolveLessonKeys,starterLayouts,type LessonKey} from "./majorScale.ts";

const distance=(a:LessonKey,b:LessonKey)=>Math.hypot((a.key.coordCol-b.key.coordCol)*25,(a.key.row-b.key.row)*42);
function score(keys:LessonKey[]) {
  let diameter=0,total=0;
  for(let i=0;i<keys.length;i++)for(let j=0;j<i;j++){const d=distance(keys[i],keys[j]);diameter=Math.max(diameter,d);total+=d;}
  // Prefer a small overall reach, then short distances within that reach.
  return diameter*10000+total;
}
export function compactCourseKeys(lessons:readonly CourseLesson[]):CourseLesson[] {
  const pitches=[...new Set(lessons.flatMap(lesson=>lesson.targets.flat()))].sort((a,b)=>a-b);
  const maps=starterLayouts().map(layout=>{
    const keys=resolveLessonKeys(layout);
    const choices=pitches.map(pitch=>keys.filter(key=>key.note===pitch));
    if(choices.some(candidates=>!candidates.length))throw new Error(`Course notes do not fit ${layout.layout.name}.`);
    let best:LessonKey[]=[],bestScore=Infinity;
    // Seed each physical position, then refine one pitch at a time. Work is
    // bounded by the small built-in pitch set; no exponential search at startup.
    for(const anchor of choices.flat()) {
      const candidate=choices.map(options=>options.reduce((a,b)=>distance(a,anchor)<=distance(b,anchor)?a:b));
      for(let pass=0;pass<4;pass++)for(let i=0;i<candidate.length;i++) {
        let selected=candidate[i],minimum=score(candidate);
        for(const option of choices[i]){candidate[i]=option;const next=score(candidate);if(next<minimum){minimum=next;selected=option;}}
        candidate[i]=selected;
      }
      const next=score(candidate);
      if(next<bestScore){bestScore=next;best=[...candidate];}
    }
    return {layoutId:layout.layout.objectIdHex,buttons:new Map(pitches.map((pitch,i)=>[pitch,best[i].key.index]))};
  });
  // One pitch keeps the same button throughout the course, including common
  // tones in consecutive chords. Recommendations accept equivalent pitches.
  return lessons.map(lesson=>({...lesson,fingerings:maps.map(({layoutId,buttons})=>({layoutId,steps:lesson.targets.map(notes=>notes.map(note=>({note,button:buttons.get(note)!,acceptDuplicates:true})))}))}));
}
