import { timingCueFrame } from "./timingCues.ts";
import { useEffect, useRef } from "react";
import { startVisibleAnimation } from "../animation.ts";

// Only browser SVG attributes animate. LED updates remain tied to target/held
// state changes and never follow requestAnimationFrame.
export function TimingCue({dueAt,periodMs}:{dueAt:number;periodMs:number}){
  const polygon=useRef<SVGPolygonElement>(null);
  useEffect(()=>{
    const reduced=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    return startVisibleAnimation(polygon.current!, now=>{const state=timingCueFrame(dueAt,periodMs,now,reduced);if(polygon.current){polygon.current.style.opacity=String(state.opacity);polygon.current.setAttribute("transform",`scale(${state.scale})`);}});
  },[dueAt,periodMs]);
  return <polygon ref={polygon} className="learnTimingRing" style={{opacity:0}} aria-hidden="true" points="0,-25 22,-12.5 22,12.5 0,25 -22,12.5 -22,-12.5"/>;
}
