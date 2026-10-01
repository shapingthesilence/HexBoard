import { useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { builtinCourses } from "./curriculumCourses.ts";
import type { UserCourse } from "./courseFiles.ts";

export function LessonStartGuidance({ step = false }: { step?: boolean }) {
  return <section className="learnLessonStart" role="status"><h3>Start when ready</h3><p><strong>Orange: hints · Yellow: no hints.</strong>{!step && " Four count-in clicks, then play."}</p></section>;
}

// Measure real typography at the current panel width, reserving one shared
// height across lessons. Longer imported instructions still have a scroll fallback.
export function LessonPanel({ course, children }: { course: UserCourse; children: ReactNode }) {
  const panel = useRef<HTMLElement>(null);
  const measurement = useRef<HTMLDivElement>(null);
  const examples = useMemo(() => {
    const courses = builtinCourses.includes(course) ? builtinCourses : [...builtinCourses, course];
    return courses.flatMap(item => item.lessons.flatMap((lesson, index) => lesson.kind === "content" ? [] : [
      <div key={`${item.id}:${lesson.id}`} className="learnLessonMeasureCase">
        <div className="learnLessonReading">
          <header className="learnLessonHeading"><div><span className="learnEyebrow">{lesson.section} · {index + 1} of {item.lessons.length}</span><h2>{lesson.title}</h2></div><span className="learnLessonMode">{lesson.kind === "exploration" ? "Explore · no score" : lesson.timing ? `Goal ${lesson.timing.goalBpm} BPM` : "At your pace"}</span></header>
          <section className="learnLessonInstruction"><p>{lesson.instruction}</p></section>
        </div>
      </div>
    ]));
  }, [course]);
  useLayoutEffect(() => {
    const element = panel.current, samples = measurement.current;
    if (!element || !samples) return;
    let lastWidth = -1;
    const fit = () => {
      const width = element.clientWidth;
      if (!width || width === lastWidth) return;
      lastWidth = width;
      const height = Math.max(...Array.from(samples.children, child => child.getBoundingClientRect().height));
      // Bound unusual imported copy while fitting all normal course messages.
      element.style.setProperty("--learnLessonPanelHeight", `${Math.min(420, Math.ceil(height) + 2)}px`);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [examples]);
  return <aside ref={panel} className="learnLessonPane" aria-label="Lesson instructions">
    {children}
    <div ref={measurement} className="learnLessonMeasurement" aria-hidden="true">{examples}</div>
  </aside>;
}
