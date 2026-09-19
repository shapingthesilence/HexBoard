import {describe,it,expect} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {CourseMarkdown} from "./CourseMarkdown.tsx";
import {courseFormat,parseCourse,assessmentFingerprint,canPassTimedLesson,lessonCues,cueAccepts,type UserCourse} from "./courseFiles.ts";
import {beginnerLessons,CourseRun} from "./beginnerCourse.ts";
import {starterLayouts} from "./majorScale.ts";
import {copyRollNotes,pasteRollNotes,lessonRollNotes,addRollNote,editRollNote} from "./courseTimeline.ts";
import {compatibilityReport,transposeCourseLayout,reorderCourse} from "./courseStructure.ts";
import {snapBeat} from "./beatGrid.ts";
const layouts=starterLayouts();
const course:UserCourse={format:courseFormat,id:"test",revision:1,title:"Test",author:"",bundle:{...layouts[0].bundle,layouts:layouts.map(item=>item.layout)},lessons:[structuredClone(beginnerLessons[0])]};
describe("expanded course authoring",()=>{
 it("supports content pages and Markdown introductions while importing v2 practice files",()=>{
  const result=parseCourse({...course,description:"# Welcome",lessons:[{id:"intro",title:"Introduction",section:"Start",kind:"content",markdown:"## Hello"},...course.lessons]});
  expect(result.lessons[0]).toMatchObject({kind:"content",targets:[],markdown:"## Hello"});
  expect(result.description).toBe("# Welcome");
  expect(parseCourse({...course,format:"hexboard.course.v2"}).format).toBe(courseFormat);
  expect(renderToStaticMarkup(createElement(CourseMarkdown,{source:'# Hello\n<script>alert(1)</script>\n[Bad](javascript:alert)\n**bold**'}))).not.toMatch(/<script|href="javascript/);
 });
 it("reports layout problems without blocking save and transposes actual key pitches",()=>{
  const changed=transposeCourseLayout(course,layouts[0].layout.objectIdHex,12);
  expect(()=>parseCourse(changed)).not.toThrow();
  expect(compatibilityReport(changed).some(row=>row.issues.some(issue=>issue.includes("reassign")))).toBe(true);
  const missing={...course,lessons:[{...course.lessons[0],targets:[[127]],fingerings:[]}]};
  expect(parseCourse(missing).lessons[0].targets).toEqual([[127]]);
  expect(compatibilityReport(missing)[0].issues.join()).toContain("Missing G9");
 });
 it("moves folders as a unit and moves individual pages into another section",()=>{
  const lessons=[{...course.lessons[0],id:"a",section:"A"},{...course.lessons[0],id:"b",section:"A"},{...course.lessons[0],id:"c",section:"B"}];
  expect(reorderCourse(lessons,{section:"B"},{section:"A"}).map(item=>item.id)).toEqual(["c","a","b"]);
  expect(reorderCourse(lessons,{lesson:"a"},{lesson:"c",section:"B"}).map(item=>[item.id,item.section])).toEqual([["b","A"],["a","B"],["c","B"]]);
 });
 it("snaps note onsets to absolute triplet divisions and retains exact mixed grids",()=>{
  const lesson={...course.lessons[0],timing:{goalBpm:80,beats:[1,1,1]}};
  expect(snapBeat(0.5,1/3)).toBe(2/3);
  const result=addRollNote(lesson,62,1/3,1/3);
  expect(()=>parseCourse({...course,lessons:[result]})).not.toThrow();
  expect(lessonRollNotes(result).some(note=>note.onset===1/3&&note.hold===1/3)).toBe(true);
  expect(()=>editRollNote(result,0,0,{onset:0.1})).toThrow();
 });
 it("copies preferred buttons, hands, and fingers separately for every layout",()=>{
  const lesson=structuredClone(course.lessons[0]);lesson.timing={goalBpm:80,beats:[1,1,1]};
  lesson.fingerings!.forEach((f,i)=>{f.steps[0][0].hand=i===0?"left":"right";f.steps[0][0].finger=i+1;});
  const copied=copyRollNotes(lesson,[lessonRollNotes(lesson)[0]]).map(note=>({...note,onset:4}));
  const result=pasteRollNotes(lesson,copied);
  const step=lessonRollNotes(result).find(note=>note.onset===4)!.step;
  for(const f of lesson.fingerings!)expect(result.fingerings!.find(item=>item.layoutId===f.layoutId)!.steps[step][0]).toEqual(f.steps[0][0]);
 });
 it("enforces simple scoring controls and fingerprints graded requirements",()=>{
  const lesson={...course.lessons[0],timing:{goalBpm:80,beats:[1,1,1]},repetitions:3,assessment:{passingScore:90,requireButtons:true,trackIndependence:false}};
  const normalized=parseCourse({...course,lessons:[lesson]}).lessons[0];
  expect(canPassTimedLesson(normalized,80,89,0)).toBe(false);
  expect(canPassTimedLesson(normalized,80,90,0)).toBe(true);
  const cues=lessonCues(normalized,layouts[0].layout.objectIdHex,0);
  expect(cueAccepts(cues,cues[0].button!+1,cues[0].note)).toBe(false);
  expect(assessmentFingerprint(course,normalized)).not.toBe(assessmentFingerprint(course,course.lessons[0]));
  expect(()=>parseCourse({...course,lessons:[{...lesson,repetitions:0}]})).toThrow(/Repetitions/);
  const reassigned=structuredClone(normalized);reassigned.fingerings![0].steps[0][0].button!++;
  expect(assessmentFingerprint(course,reassigned)).not.toBe(assessmentFingerprint(course,normalized));
  expect(assessmentFingerprint(course,{...course.lessons[0],repetitions:1})).not.toBe(assessmentFingerprint(course,course.lessons[0]));
  expect(new CourseRun(normalized,layouts[0].layout.objectIdHex).complete).toBe(false);
 });
 it("initializes learner preview safely when a lesson contains only a blank timed step",()=>{
  const blank={...course.lessons[0],targets:[[]],timing:{goalBpm:80,beats:[1]}};
  const run=new CourseRun(blank,layouts[0].layout.objectIdHex,note=>`Pitch ${note.toFixed(2)}`);
  expect(run.complete).toBe(true);
 });
});
