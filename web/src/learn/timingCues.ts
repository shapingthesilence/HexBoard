// Mount slightly ahead of the animation window so a React update cannot cause
// a late start. The animation itself stays invisible until one quarter remains.
export function upcomingTimingSteps(offsets:readonly number[],startAt:number,periodMs:number,now:number,firstStep:number) {
  return offsets.flatMap((offset,step)=>{const dueAt=startAt+offset*periodMs;return step>=firstStep&&dueAt>=now&&dueAt-now<=periodMs+50?[{step,dueAt}]:[];});
}
export function timingCueFrame(dueAt:number,periodMs:number,now:number,reduced=false) {
  const remaining=(dueAt-now)/periodMs;
  const progress=Math.max(0,Math.min(1,remaining));
  return {opacity:remaining<0||remaining>1?0:0.35+0.65*(1-progress),scale:reduced?1.1:1+1.4*progress};
}
