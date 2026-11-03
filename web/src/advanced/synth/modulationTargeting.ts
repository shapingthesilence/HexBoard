/** Attach only while targeting; return cleanup for exit/unmount. */
export function targetingEscape(target:EventTarget,cancel:()=>void){
 const key=(event:Event)=>{if((event as KeyboardEvent).key==='Escape'&&!event.defaultPrevented)cancel();};
 target.addEventListener('keydown',key);
 return ()=>target.removeEventListener('keydown',key);
}

/** A repeated ordinary click exits targeting; explicit locking keeps it selected. */
export const sourceClickTool = (active: boolean, lock = false): 'value' | 'modulate' => active && !lock ? 'value' : 'modulate';
