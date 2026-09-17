import { useEffect, useRef } from "react";

// Only browser SVG attributes animate. LED updates remain tied to target/held
// state changes and never follow requestAnimationFrame.
export function TimingCue({dueAt,periodMs}:{dueAt:number;periodMs:number}){
  const polygon=useRef<SVGPolygonElement>(null);
  useEffect(()=>{
    let frame=0;
    const reduced=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const draw=()=>{const remaining=(dueAt-performance.now())/(periodMs*2);const p=Math.max(0,Math.min(1,remaining));if(polygon.current){polygon.current.style.opacity=remaining<0||remaining>1?"0":String(0.35+0.65*(1-p));polygon.current.setAttribute("transform",`scale(${reduced?1.1:1+1.4*p})`);}frame=requestAnimationFrame(draw);};
    frame=requestAnimationFrame(draw);return()=>cancelAnimationFrame(frame);
  },[dueAt,periodMs]);
  return <polygon ref={polygon} className="learnTimingRing" aria-hidden="true" points="0,-25 22,-12.5 22,12.5 0,25 -22,12.5 -22,-12.5"/>;
}
