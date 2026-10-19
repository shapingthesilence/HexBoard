/** Attach only while targeting; return cleanup for exit/unmount. */
export function targetingEscape(target:EventTarget,cancel:()=>void){
 const key=(event:Event)=>{if((event as KeyboardEvent).key==='Escape'&&!event.defaultPrevented)cancel();};
 target.addEventListener('keydown',key);
 return ()=>target.removeEventListener('keydown',key);
}
