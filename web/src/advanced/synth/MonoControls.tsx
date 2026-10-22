import {useEffect,useId,useRef,useState} from 'react';
import {defaultMono,type MonoConfig} from './mono.ts';
type Props={polyAvailable?:boolean;value?:MonoConfig;disabled:boolean;onChange:(value:MonoConfig)=>void};
export function MonoOptions({value=defaultMono(),disabled,onChange}:Props){
 const mode=value.flags&3,priority=(value.flags>>2)&3;
 const flag=(mask:number,set:boolean)=>onChange({...value,flags:set?value.flags|mask:value.flags&~mask});
 return <div className="mono-options">
  <label>Note priority<select aria-label="Mono note priority" value={priority} disabled={disabled} onChange={e=>onChange({...value,flags:(value.flags&~12)|(Number(e.target.value)<<2)})}><option value={0}>Last played</option><option value={1}>Lowest pitch</option><option value={2}>Highest pitch</option></select></label>
  {mode!==1&&<label>Legato velocity<select aria-label="Legato velocity" value={Number(!!(value.flags&64))} disabled={disabled} onChange={e=>flag(64,!!Number(e.target.value))}><option value={0}>Keep first</option><option value={1}>Follow keys</option></select></label>}
  <label className="mono-glide">Glide<output>{value.glideMs<1000?`${value.glideMs} ms`:`${(value.glideMs/1000).toFixed(2)} s`}{value.flags&32?'/oct':''}</output><input aria-label="Glide time" type="range" min={0} max={100} value={Math.sqrt(value.glideMs/5000)*100} disabled={disabled} onChange={e=>onChange({...value,glideMs:Math.round(5000*(Number(e.target.value)/100)**2)})}/></label>
  <label>When<select aria-label="Glide trigger" value={Number(!!(value.flags&16))} disabled={disabled} onChange={e=>flag(16,!!Number(e.target.value))}><option value={0}>Overlapping keys</option><option value={1}>Every note</option></select></label>
  <label>Timing<select aria-label="Glide timing" value={Number(!!(value.flags&32))} disabled={disabled} onChange={e=>flag(32,!!Number(e.target.value))}><option value={0}>Fixed time</option><option value={1}>Time / octave</option></select></label>
 </div>;
}
export function MonoControls({value=defaultMono(),disabled,onChange,polyAvailable=true}:Props){
 const [open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null),toggle=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null),id=useId();
 const mode=value.flags&3;
 useEffect(()=>{if(!open)return;panel.current?.querySelector<HTMLElement>('select')?.focus();const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setOpen(false);toggle.current?.focus();}};document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape,true);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape,true);};},[open]);
 return <div className="mono-access" ref={root} aria-label="Onboard synth voice mode" onBlurCapture={e=>{if(e.relatedTarget&&!e.currentTarget.contains(e.relatedTarget as Node))setOpen(false);}}>
  <div className="mono-selector" role="group" aria-label="Voice mode">{['Poly','Mono','Legato'].map((label,i)=><button key={i} type="button" disabled={disabled||(i===0&&!polyAvailable)} aria-pressed={mode===i} title={i===0&&!polyAvailable?'Reduce DSP processing to return to eight voices':i===0?'Eight held strings plus two release tails':i===1?'One string; retrigger attacks and envelopes':'One string; preserve excitation and envelopes while keys overlap'} onClick={()=>onChange({...value,flags:(value.flags&~3)|i})}>{label}</button>)}</div>
  <button className="mono-open" type="button" ref={toggle} aria-label="Mono settings" aria-haspopup="dialog" aria-controls={id} aria-expanded={open} disabled={disabled} title="Note priority, glide and legato velocity" onClick={()=>setOpen(v=>!v)}>⌄</button>
  {open&&<div className="mono-popover" ref={panel} id={id} role="dialog" aria-label="Mono settings"><header><strong>Mono playing</strong><button type="button" aria-label="Close mono settings" onClick={()=>{setOpen(false);toggle.current?.focus();}}>×</button></header><MonoOptions value={value} disabled={disabled} onChange={onChange}/></div>}
 </div>;
}
