import {describe,it,expect} from "vitest";
import {courseJourney,completionGuidance,beatLabel} from "./courseJourney.ts";
import {movementCourse,firstStepsCourse,rhythmCourse} from "./curriculumCourses.ts";
import {recordCourseRun} from "./beginnerCourse.ts";
import {courseProgressId,courseLayoutProgressId} from "./courseFiles.ts";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {CourseJourney} from "./CourseJourney.tsx";

describe("learner guidance",()=>{
  it("counts assessed exercises only and isolates layout achievements",()=>{
    const course=movementCourse,layout=courseLayoutProgressId(course.bundle,course.bundle.layouts[0]);
    const initial=courseJourney(course,layout,{});
    expect(initial.total).toBe(15);
    expect(initial.next).toBe(1);
    const progress=recordCourseRun({},courseProgressId(course,course.lessons[1].id),layout,0,false);
    const played=courseJourney(course,layout,progress);
    expect(played.completed).toBe(1);
    expect(played.entries[1].independent).toBe(true);
    expect(played.next).toBe(2);
    expect(courseJourney(course,"another-layout",progress).completed).toBe(0);
    expect(played.entries.filter(entry=>!entry.assessed).map(entry=>entry.lesson.kind)).toEqual(["content","exploration"]);
  });
  it("offers no resume when all assessed exercises are complete",()=>{
    const layout="test";
    const progress=firstStepsCourse.lessons.filter(lesson=>lesson.kind!=="content").reduce((progress,lesson)=>recordCourseRun(progress,courseProgressId(firstStepsCourse,lesson.id),layout,0,true),{});
    expect(courseJourney(firstStepsCourse,layout,progress).next).toBeUndefined();
  });
  it("distinguishes rehearsal, missed timing, clean streaks, and exploration",()=>{
    const checkpoint=rhythmCourse.lessons.at(-1)!;
    const clean={mistakes:0,beat:{score:100,missed:0,extras:0}};
    expect(completionGuidance(checkpoint,clean,50,0,false)).toContain("60 BPM");
    expect(completionGuidance(checkpoint,clean,60,0,true)).toContain("rehearsed");
    expect(completionGuidance(checkpoint,{mistakes:1,beat:{score:60,missed:1,extras:0}},60,0,false)).toContain("Slow down");
    expect(completionGuidance(checkpoint,clean,60,1,false)).toContain("1 of 2");
    expect(completionGuidance(checkpoint,clean,60,2,false)).toContain("played it through");
    expect(completionGuidance(movementCourse.lessons.find(lesson=>lesson.kind==="exploration")!,undefined,60,0,false)).toContain("one idea");
  });
  it("displays triplets and mixed lengths without floating point noise",()=>{
    expect([1/3,2/3,0.5,1.5,10/3,4].map(beatLabel)).toEqual(["⅓","⅔","½","1 ½","3 ⅓","4"]);
  });
  it("renders the full lesson outline without a disclosure control",()=>{
    const course=firstStepsCourse,layout=courseLayoutProgressId(course.bundle,course.bundle.layouts[0]);
    const html=renderToStaticMarkup(createElement(CourseJourney,{journey:courseJourney(course,layout,{}),currentIndex:0,layoutName:"Wicki-Hayden",disabled:false,onSelect:()=>{}}));
    expect(html).toContain('aria-label="Course lessons"');
    expect(html).toContain(course.lessons.at(-1)!.title);
    expect(html).not.toContain("<details");
  });
});
