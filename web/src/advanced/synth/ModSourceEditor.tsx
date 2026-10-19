import { useEffect, useRef, type ReactNode } from "react";
import { modulationSeconds, modulationRate, physicalSources } from "./schema.ts";

const shapes=["Sine","Triangle","Rise","Fall","Square","Random"];
const timeValue=(seconds:number)=>seconds<=.001?0:Math.round(Math.max(0,Math.min(1,Math.log(seconds/.001)/9.903488))*65535);
export function envelopePoints(s:number[]) {
  const times=[modulationSeconds(s[4]),modulationSeconds(s[0]),modulationSeconds(s[5]),modulationSeconds(s[1]),.3,modulationSeconds(s[3])];
  const total=Math.max(.02,times.reduce((a,b)=>a+b,0));let x=10;
  return [[x,86],...times.map((t,i)=>{x+=280*t/total;return [x,i===0?86:i<=2?14:i<=4?86-72*s[2]/65535:86];})];
}
export function lfoWave(shape:number,phase:number){const p=phase-Math.floor(phase);return shape===0?Math.sin(p*2*Math.PI):shape===1?1-4*Math.abs(p-.5):shape===2?2*p-1:shape===3?1-2*p:shape===4?p<.5?1:-1:Math.sin(Math.floor(phase)*13.7);}
export function ModSourceEditor({source,settings:s,onChange,onClose,onAssign,disabled,renderControl}:{source:number;settings:number[];onChange:(id:number,value:number)=>void;onClose:()=>void;onAssign:()=>void;disabled:boolean;renderControl:(id:number,label:string)=>ReactNode}){
  const root=useRef<HTMLDivElement>(null);const close=useRef(onClose);close.current=onClose;
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==="Escape")close.current();};const outside=(e:PointerEvent)=>{if(e.target instanceof Element&&!root.current?.contains(e.target)&&!e.target.closest(".modulation-toolbar"))close.current();};document.addEventListener("keydown",key);document.addEventListener("pointerdown",outside);root.current?.focus();return()=>{document.removeEventListener("keydown",key);document.removeEventListener("pointerdown",outside);};},[source]);
  const points=envelopePoints(s),shape=Math.round(s[9]/13107);
  const envelope=source===5,lfo=source===6;
  const quick=(values:Record<number,number>)=>Object.entries(values).forEach(([id,v])=>onChange(Number(id),v));
  const curve=2*s[6]/65535-1;
  const envPath=`M${points[0].join(',')} `+points.slice(1).map(([x,y],i)=>{
    const [px,py]=points[i];return Array.from({length:12},(_,j)=>{const t=(j+1)/12;const f=curve>=0?t+curve*(t*t-t):t-curve*((1-(1-t)*(1-t))-t);return `L${(px+(x-px)*t).toFixed(1)},${(py+(y-py)*f).toFixed(1)}`;}).join(' ');
  }).join(' ');
  const lfoPath=Array.from({length:161},(_,i)=>{const w=lfoWave(shape,i/80+s[11]/65535);return `${i?"L":"M"}${10+i*1.75},${s[14]?78-(w+1)*32:50-w*32}`;}).join(" ");
  const move=(e:React.PointerEvent<SVGCircleElement>,id:number)=>{
    if(disabled||!e.currentTarget.hasPointerCapture(e.pointerId))return;
    const r=e.currentTarget.ownerSVGElement!.getBoundingClientRect();const x=(e.clientX-r.left)/r.width*300,y=(e.clientY-r.top)/r.height*100;
    if(id===2)onChange(2,Math.round(Math.max(0,Math.min(1,(86-y)/72))*65535));
    else {const total=Math.max(.02,[0,1,3,4,5].reduce((a,i)=>a+modulationSeconds(s[i]),.3));const previous=id===0?points[1][0]:id===1?points[3][0]:points[5][0];onChange(id,timeValue(Math.max(0,x-previous)/280*total));}
  };
  return <div ref={root} tabIndex={-1} className="mod-source-editor" role="dialog" aria-label={`${physicalSources[source]} editor`}>
    <header><strong>{physicalSources[source]}</strong><button type="button" aria-label="Close source editor" onClick={onClose}>×</button></header>
    {envelope||lfo ? <>
      <svg className="mod-source-graph" viewBox="0 0 300 100" aria-label={envelope?"Envelope shape · drag the handles":"LFO waveform preview"}>
        <path className="mod-graph-grid" d="M10 14H290M10 50H290M10 86H290"/><path className="mod-graph-wave" d={envelope?envPath:lfoPath}/>
        {envelope&&[[0,2],[1,4],[2,5],[3,6]].map(([id,index])=><circle key={id} cx={points[index][0]} cy={points[index][1]} r="5" className="mod-graph-handle" role="slider" tabIndex={disabled?-1:0} aria-label={`Envelope ${["attack","decay","sustain","release"][id]} handle`} aria-valuemin={0} aria-valuemax={65535} aria-valuenow={s[id]} onKeyDown={e=>{if(!disabled&&["ArrowUp","ArrowRight","ArrowDown","ArrowLeft"].includes(e.key)){e.preventDefault();onChange(id,Math.max(0,Math.min(65535,s[id]+(["ArrowUp","ArrowRight"].includes(e.key)?1:-1)*(e.shiftKey?65:655))));}}} onPointerDown={e=>{if(!disabled)e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>move(e,id)} />)}
      </svg>
      {envelope?<>
        <div className="mod-source-knobs">{[[0,"Attack"],[1,"Decay"],[2,"Sustain"],[3,"Release"]].map(([id,label])=><div key={id}>{renderControl(Number(id),String(label))}</div>)}</div>
        <div className="source-tabs" aria-label="Envelope quick settings"><button disabled={disabled} onClick={()=>quick({0:0,1:30000,2:0,3:26000,4:0,5:0,7:0})}>Pluck</button><button disabled={disabled} onClick={()=>quick({0:42000,1:32000,2:50000,3:45000,4:0,5:0,7:0})}>Swell</button><button disabled={disabled} onClick={()=>quick({0:0,1:0,2:65535,3:0,4:0,5:0,7:0})}>Gate</button></div>
        <details><summary>Timing & curve</summary><div className="mod-source-knobs">{renderControl(4,"Delay")}{renderControl(5,"Hold")}{renderControl(6,"Curve")}</div><label className="mod-switch"><input type="checkbox" checked={!!s[7]} disabled={disabled} onChange={e=>onChange(7,e.target.checked?65535:0)}/>Loop attack / decay while held</label></details>
        <small>Per note · releases from its current value. Voice level +100% applies the envelope; other controls add its value.</small>
      </>:<>
        <div className="source-tabs mod-shapes" aria-label="LFO waveform">{shapes.map((name,i)=><button disabled={disabled} key={name} aria-pressed={shape===i} onClick={()=>onChange(9,i*13107)}>{name}</button>)}</div>
        <div className="mod-source-knobs">{renderControl(8,"Rate")}{renderControl(11,"Phase")}</div>
        <div className="source-tabs" aria-label="LFO timing"><button disabled={disabled} aria-pressed={!!s[10]} onClick={()=>onChange(10,65535)}>Restart each note</button><button disabled={disabled} aria-pressed={!s[10]} onClick={()=>onChange(10,0)}>Free running</button></div>
        <details><summary>Fade & smoothing</summary><div className="mod-source-knobs">{renderControl(12,"Delay")}{renderControl(13,"Fade in")}{renderControl(15,"Smoothing")}</div><label className="mod-switch"><input type="checkbox" checked={!!s[14]} disabled={disabled} onChange={e=>onChange(14,e.target.checked?65535:0)}/>Positive only</label></details>
        <small>{modulationRate(s[8]).toFixed(2)} Hz · {s[14]?"0 to +1":"−1 to +1"} · generated on the board at block rate.</small>
      </>}
    </>:<p className="mod-source-help">{source===0?"Note-on velocity follows your selected velocity engine. Positive modulation adds more as you strike harder.":source===1?"Continuous key pressure follows the velocity engine’s pressure mode. Route it to a continuous sound control.":source===2?"Note-off velocity acts on release. Useful for damping and release time.":"Signed tilt around your captured neutral position. Tilting either way moves the destination in that direction; negative depth reverses it."}{source<3&&<a href="#/calibration">Edit keyboard response →</a>}</p>}
    <footer><button type="button" className="primary" onClick={onAssign}>Assign to controls</button><small>Drag a destination knob to set depth</small></footer>
  </div>;
}
