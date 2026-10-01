import type { CourseLesson } from "./beginnerCourse.ts";

export function autoStartLesson(lesson: Pick<CourseLesson, "kind" | "timing">, boardSession: boolean): boolean {
  return boardSession && lesson.kind !== "content" && !lesson.timing;
}

export function afterExample(wasComplete: boolean, boardSession: boolean, timedLesson = false): "complete" | "restart" | "ready" {
  if (wasComplete) return "complete";
  return boardSession && !timedLesson ? "restart" : "ready";
}

export function repeatTempo(current: number, goal: number | undefined, stepTempo: number): number {
  return goal !== undefined && (current === stepTempo || current < goal) ? goal : current;
}
