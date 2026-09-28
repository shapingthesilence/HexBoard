import { useEffect, useRef } from "react";
import type {courseJourney} from "./courseJourney.ts";

type Journey = ReturnType<typeof courseJourney>;
export function CourseJourney({journey,currentIndex,layoutName,disabled,onSelect}:{journey:Journey;currentIndex:number;layoutName:string;disabled:boolean;onSelect:(index:number)=>void}) {
  const sections=[...new Set(journey.entries.map(entry=>entry.lesson.section))];
  const listRef=useRef<HTMLElement>(null),currentRef=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    const list=listRef.current,button=currentRef.current;
    if(!list||!button)return;
    const viewport=list.getBoundingClientRect(),selected=button.getBoundingClientRect();
    if(selected.top<viewport.top)list.scrollTop-=viewport.top-selected.top;
    else if(selected.bottom>viewport.bottom)list.scrollTop+=selected.bottom-viewport.bottom;
  },[currentIndex]);
  return <section className="learnJourney" aria-label="Your course path">
    <div className="learnJourneySummary"><strong>Your course path</strong><span>{journey.completed}/{journey.total} exercises completed · {layoutName}</span>
      <progress aria-label={`Course completion on ${layoutName}`} value={journey.completed} max={journey.total||1}/>
    </div>
    <nav ref={listRef} tabIndex={0} aria-label="Course lessons">{sections.map(section=><div key={section} className="learnJourneySection"><h3>{section||"Lessons"}</h3><ol>{journey.entries.filter(entry=>entry.lesson.section===section).map(({lesson,index,completed,independent})=><li key={lesson.id}>
      <button ref={index===currentIndex?currentRef:undefined} type="button" disabled={disabled} aria-current={index===currentIndex?"step":undefined} onClick={()=>onSelect(index)}>
        <span aria-hidden="true">{independent?"★":completed?"✓":lesson.kind==="content"?"·":index+1}</span>
        <span>{lesson.title}<small>{lesson.kind==="content"?"Read":lesson.kind==="exploration"||lesson.assessment?.graded===false?"Explore · no score":independent?"Independent":completed?"Completed":lesson.timing?`Goal ${lesson.timing.goalBpm} BPM`:"At your pace"}</small></span>
      </button></li>)}</ol></div>)}</nav>
  </section>;
}
