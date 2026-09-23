import {describe,it,expect} from "vitest";
import {starterLayouts,resolveLessonKeys} from "./majorScale.ts";
import {beginnerLessons} from "./beginnerCourse.ts";
import {courseFormat,parseCourse,assessmentFingerprint,type UserCourse} from "./courseFiles.ts";
import {transposeCourseLayout,incompatibleCourseTuning,replaceCourseBundle,compatibilityReport} from "./courseStructure.ts";
import {copyRollNotes,lessonRollNotes,pasteRollNotes} from "./courseTimeline.ts";
import {translateCopiedFingerings} from "./courseFingering.ts";
const layouts=starterLayouts();
const course:UserCourse={format:courseFormat,id:"test",revision:1,title:"Test",author:"",bundle:{...layouts[0].bundle,layouts:layouts.map(item=>item.layout)},lessons:[structuredClone(beginnerLessons[0])]};
describe("course layout workflow",()=>{
 it("preserves lesson-level required-button controls",()=>{
  const result=parseCourse({...course,lessons:[{...course.lessons[0],assessment:{requireButtons:true}}]});
  expect(result.lessons[0].assessment?.requireButtons).toBe(true);
  expect(result.lessons[0].fingerings!.every(f=>f.steps.every(cues=>cues.every(cue=>cue.acceptDuplicates!==false)))).toBe(true);
 });
 it("persists transposition offsets through export/import and reverses the mapping",()=>{
  const id=layouts[0].layout.objectIdHex;
  const moved=parseCourse(transposeCourseLayout(course,id,7));
  expect(moved.layoutTranspositions?.[id]).toBe(7);
  const restored=transposeCourseLayout(moved,id,-7);
  expect(restored.bundle.layouts[0]).toEqual(course.bundle.layouts[0]);
  expect(restored.layoutTranspositions?.[id]).toBe(0);
 });
 it("validates lesson layout requirements, limits reports, and fingerprints them",()=>{
  const lesson={...course.lessons[0],layoutId:layouts[1].layout.objectIdHex};
  const result=parseCourse({...course,lessons:[lesson]});
  expect(result.lessons[0].layoutId).toBe(lesson.layoutId);
  expect(compatibilityReport(result)).toHaveLength(1);
  expect(assessmentFingerprint(course,lesson)).not.toBe(assessmentFingerprint(course,course.lessons[0]));
  expect(()=>parseCourse({...course,lessons:[{...lesson,layoutId:"missing"}]})).toThrow(/layout/);
 });
 it("detects tuning pitch incompatibility and only clears notes on explicit replacement",()=>{
  const bundle=structuredClone(course.bundle);
  bundle.tuning={...bundle.tuning,referenceHz:bundle.tuning.referenceHz*2**(0.5/12)};
  const before=JSON.stringify(course);
  expect(incompatibleCourseTuning(course,course.bundle)).toBe(false);
  expect(incompatibleCourseTuning(course,bundle)).toBe(true);
  expect(JSON.stringify(course)).toBe(before);
  const cleared=replaceCourseBundle(course,bundle,true);
  expect(cleared.lessons[0].targets).toEqual([[]]);
  expect(cleared.lessons[0].fingerings).toEqual([]);
  expect(cleared.lessons[0].title).toBe(course.lessons[0].title);
 });
 it("translates copied fingering shapes as a unit on every layout",()=>{
  const lesson=structuredClone(course.lessons[0]);lesson.timing={goalBpm:80,beats:[1,1,1]};
  lesson.fingerings!.forEach(f=>f.steps.forEach(cues=>cues.forEach(c=>{c.finger=2;c.hand="right";})));
  const source=copyRollNotes(lesson,lessonRollNotes(lesson));
  const placed=translateCopiedFingerings(source,source.map(note=>({...note,pitch:note.pitch+2,onset:note.onset+4})),course.bundle,course.bundle);
  for(const layout of course.bundle.layouts){
   const id=layout.objectIdHex,keys=resolveLessonKeys({id,label:layout.name,layout,bundle:course.bundle});
   const offsets=placed.map((note,i)=>{const cue=note.cues![id];expect(cue.finger).toBe(2);expect(cue.hand).toBe("right");expect(cue.button).toBeDefined();const old=keys[source[i].cues![id].button!],next=keys[cue.button!];expect(next.note).toBe(note.pitch);return [next.key.coordCol-old.key.coordCol,next.key.row-old.key.row];});
   expect(new Set(offsets.map(offset=>JSON.stringify(offset)))).toHaveLength(1);
  }
  const pasted=pasteRollNotes(lesson,placed);expect(()=>parseCourse({...course,lessons:[pasted]})).not.toThrow();
  const outside=translateCopiedFingerings(source,source.map(note=>({...note,pitch:127})),course.bundle,course.bundle);
  expect(outside.every(note=>Object.values(note.cues!).every(cue=>cue.button===undefined&&cue.finger===2))).toBe(true);
 });
});
