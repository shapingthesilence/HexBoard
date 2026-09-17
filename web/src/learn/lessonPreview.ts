import type { CourseLesson } from "./beginnerCourse.ts";
import { lessonRollNotes } from "./courseTimeline.ts";

export interface PreviewEvent { at: number; pitch: number; on: boolean }
export function lessonPreviewEvents(lesson: CourseLesson): PreviewEvent[] {
  const period = 60000 / (lesson.timing?.goalBpm ?? 80);
  const notes = lessonRollNotes(lesson);
  const events = notes.flatMap(note => {
    // A repeated pitch retriggers its voice; the earlier gate cannot stop it.
    const next = notes.filter(other => other.pitch === note.pitch && other.onset > note.onset).sort((a,b)=>a.onset-b.onset)[0];
    const end = Math.min(note.onset + note.hold, next?.onset ?? Infinity);
    return [{at:note.onset*period,pitch:note.pitch,on:true},{at:end*period,pitch:note.pitch,on:false}];
  });
  return events.sort((a,b)=>a.at-b.at || Number(a.on)-Number(b.on));
}
