import type {CourseLesson} from "./beginnerCourse.ts";
import {recommendCourseRoute} from "./curriculumKeys.ts";

// Evaluator fixtures are independent of the teaching sequence.
export const lessonFixtures: CourseLesson[] = [
  {id:"home",title:"Home",section:"Test",instruction:"Play C–G–C.",targets:[[60],[67],[60]]},
  {id:"major",title:"Scale",section:"Test",instruction:"Play the scale.",targets:[60,62,64,65,67,69,71,72].map(note=>[note])},
  {id:"major-triad",title:"Triad",section:"Test",instruction:"Hold the chord.",targets:[[60,64,67]]},
  {id:"contrast",title:"Shared tones",section:"Test",instruction:"Change the third.",targets:[[60,64,67],[60,63,67],[60,64,67]]},
].map(lesson=>recommendCourseRoute(lesson));
