import {useMemo} from 'react';
import type {Recording} from './prepare.mjs';
/** Overview of the retained audio with numbered slice starts. */
export function SliceStrip({recording:a,points}:{recording:Recording;points:number[]}){
 const start=a.start??0,end=a.end??a.channels[0].length,width=600,height=64;
 const path=useMemo(()=>{const data=a.channels[0],step=Math.max(1,(end-start)/width);let peak=1e-6;for(let i=start;i<end;i++)peak=Math.max(peak,Math.abs(data[i]));const scale=height/2/peak*.95;let d='';for(let x=0;x<width;x++){let lo=0,hi=0;for(let i=Math.floor(start+x*step);i<Math.min(end,start+(x+1)*step);i++){lo=Math.min(lo,data[i]);hi=Math.max(hi,data[i]);}d+=`M${x} ${height/2-hi*scale}V${height/2-lo*scale+.5}`;}return d;},[a.channels,start,end]);
 const x=(f:number)=>(f-start)/Math.max(1,end-start)*width;
 return <svg className="sampler-slice-strip" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${points.length} slices`}>
  <path d={path}/>
  {points.map((p,i)=><g key={p}><line x1={x(p)} x2={x(p)} y1={0} y2={height}/><text x={x(p)+3} y={11}>{i+1}</text></g>)}
 </svg>;
}
