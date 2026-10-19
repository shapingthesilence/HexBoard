import {usePerformance,usePerformanceTempo,S} from './performanceSchema.ts';
import {useEffect,useRef} from 'react';
import type {FxRack} from './schema.ts';
export const volumePatterns=[
 {name:'Pulse',steps:[1,0,1,0,1,0,1,0]},
 {name:'Offbeat',steps:[0,.35,0,1,0,.35,0,1]},
 {name:'Trance',steps:[1,0,.4,1,0,.7,0,.4,1,0,.4,1,0,.7,1,0]},
 {name:'Swell',steps:[0,.08,.2,.4,.65,.85,1,.8]},
 {name:'Ramp',steps:[1,.85,.7,.55,.4,.25,.1,0]},
 {name:'Broken',steps:[1,0,.6,0,0,1,.25,0,1,.5,0,.8,0,0,.3,1]}
];
export function VolumeStepEditor({rack,onChange,onClose}:{rack:FxRack;onChange:(rack:FxRack)=>void;onClose:()=>void}){
 const tempo=usePerformanceTempo(),performance=usePerformance(),globalClock=!!performance.values[S.volumeSync];
 const dialog=useRef<HTMLDivElement>(null),painting=useRef(false);
 const config=rack.values[2],length=1+(config[3]&15),division=config[3]>>4;
 useEffect(()=>{const old=document.activeElement as HTMLElement|null;dialog.current?.focus();return()=>old?.focus();},[]);
 const set=(index:number,value:number)=>{const values=rack.values.map(row=>[...row]);values[2][index]=value;onChange({...rack,values});};
 const paint=(e:React.PointerEvent<HTMLDivElement>)=>{const r=e.currentTarget.getBoundingClientRect();const index=Math.max(0,Math.min(length-1,Math.floor((e.clientX-r.left)/r.width*length))),value=Math.round(Math.max(0,Math.min(1,1-(e.clientY-r.top)/r.height))*65535);const steps=[...rack.steps];steps[index]=value;onChange({...rack,steps});};
 return <div className="synth-popover-backdrop" onPointerDown={e=>{if(e.target===e.currentTarget)onClose();}}>
  <div ref={dialog} className="synth-popover step-editor" role="dialog" aria-modal="true" aria-label="Volume step editor" tabIndex={-1} onKeyDown={e=>{if(e.key==='Escape')onClose();if(e.key==='Tab'){const nodes=dialog.current?.querySelectorAll<HTMLElement>('button,input,select,[tabindex="0"]');if(nodes?.length){const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}}}}>
   <header><strong>Volume Steps</strong><button type="button" aria-label="Close volume step editor" onClick={onClose}>×</button></header>
   <div className="step-presets">{volumePatterns.map(p=><button type="button" key={p.name} onClick={()=>{const values=rack.values.map(row=>[...row]);values[2][3]=division*16+p.steps.length-1;onChange({...rack,values,steps:Array.from({length:16},(_,i)=>Math.round((p.steps[i%p.steps.length])*65535))});}}>{p.name}</button>)}</div>
   <div className="step-settings"><label>Tempo<input aria-label="Step tempo" type="number" min="40" max="240" disabled={globalClock} title={globalClock?"Set tempo in the Performance row":undefined} value={globalClock?tempo/10:Math.round(40+200*config[0]/65535)} onChange={e=>set(0,Math.round((Math.max(40,Math.min(240,Number(e.target.value)))-40)/200*65535))}/></label><label>Timing<select aria-label="Step timing" value={division} onChange={e=>set(3,Number(e.target.value)*16+length-1)}>{[4,8,16,32,64,128,256,512].map((n,i)=><option key={n} value={i}>1/{n}</option>)}</select></label><label>Steps<input aria-label="Sequence length" type="number" min="1" max="16" value={length} onChange={e=>set(3,division*16+Math.max(1,Math.min(16,Math.round(Number(e.target.value))))-1)}/></label></div>
   <div className="step-bars" onPointerDown={e=>{e.preventDefault();painting.current=true;e.currentTarget.setPointerCapture(e.pointerId);paint(e);}} onPointerMove={e=>{if(painting.current)paint(e);}} onPointerUp={e=>{painting.current=false;e.currentTarget.releasePointerCapture(e.pointerId);}} onPointerCancel={()=>painting.current=false}>
    {rack.steps.slice(0,length).map((v,i)=><div key={i} className="step-bar" role="slider" tabIndex={0} aria-label={`Step ${i+1} volume`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v/65535*100)} onKeyDown={e=>{if(['ArrowUp','ArrowDown','Home','End'].includes(e.key)){e.preventDefault();const steps=[...rack.steps];steps[i]=e.key==='Home'?0:e.key==='End'?65535:Math.max(0,Math.min(65535,v+(e.key==='ArrowUp'?1:-1)*(e.shiftKey?655:3277)));onChange({...rack,steps});}}}><span style={{height:`${v/65535*100}%`}}/><small>{i+1}</small></div>)}
   </div>
   <label className="step-softness">Edge softness<input aria-label="Step edge softness" type="range" min="0" max="65535" value={config[2]} onChange={e=>set(2,Number(e.target.value))}/><output>{Math.round(1+60*(config[2]/65535)**2)} ms</output></label>
  </div>
 </div>;
}
