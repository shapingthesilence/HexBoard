import { useState } from "react";
import type { CourseLesson } from "./beginnerCourse.ts";
import { reorderCourse } from "./courseStructure.ts";

interface CourseOutlineProps {
  lessons: CourseLesson[];
  selected: string;
  disabled: boolean;
  onSelect: (id: string) => void;
  onChange: (lessons: CourseLesson[]) => void;
  onAdd: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}

export function CourseOutline({ lessons, selected, disabled, onSelect, onChange, onAdd, onDuplicate, onDelete }: CourseOutlineProps) {
  const [drag, setDrag] = useState<{ lesson?: string; section?: string }>();
  const [menu, setMenu] = useState<string>();
  const sections = [...new Set(lessons.map(lesson => lesson.section))];
  function drop(target: { lesson?: string; section: string }) {
    if (drag && !disabled) onChange(reorderCourse(lessons, drag, target));
    setDrag(undefined);
  }
  return <aside className="courseOutline" aria-label="Course outline">
    <div className="courseOutlineHeader"><h3>Course outline</h3><button type="button" disabled={disabled || lessons.length >= 100} onClick={onAdd}>+ Add lesson</button></div>
    {sections.map(section => <section key={section} className="courseOutlineSection" onDragOver={event => { if (!disabled) event.preventDefault(); }} onDrop={event => { event.preventDefault(); event.stopPropagation(); drop({ section }); }}>
      <h4 draggable={!disabled} onDragStart={event => { event.stopPropagation(); event.dataTransfer.setData("text/plain", section); setDrag({ section }); }}>📁 {section}</h4>
      {lessons.filter(lesson => lesson.section === section).map(lesson => <div className="courseOutlineItem" key={lesson.id}>
        <button className="courseOutlineLesson" type="button" disabled={disabled} draggable={!disabled} aria-current={selected === lesson.id ? "page" : undefined}
          onDragStart={event => { event.stopPropagation(); event.dataTransfer.setData("text/plain", lesson.id); setDrag({ lesson: lesson.id }); }} onDragEnd={() => setDrag(undefined)}
          onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); event.stopPropagation(); drop({ section, lesson: lesson.id }); }} onClick={() => onSelect(lesson.id)}>
          <span aria-label={lesson.kind === "content" ? "Content page" : lesson.kind === "exploration" ? "Exploration" : "Practice lesson"}>{lesson.kind === "content" ? "▤" : "♫"}</span> {lesson.title}
        </button>
        <button className="courseOutlineMore" type="button" aria-label={`Actions for ${lesson.title}`} aria-expanded={menu === lesson.id} disabled={disabled} onClick={() => setMenu(menu === lesson.id ? undefined : lesson.id)}>…</button>
        {menu === lesson.id && <div className="courseOutlineMenu" role="menu"><button type="button" role="menuitem" disabled={lessons.length >= 100} onClick={() => { setMenu(undefined); onDuplicate(lesson.id); }}>Duplicate</button><button type="button" role="menuitem" disabled={lessons.length === 1} onClick={() => { setMenu(undefined); onDelete(lesson.id); }}>Delete</button></div>}
      </div>)}
    </section>)}
  </aside>;
}
