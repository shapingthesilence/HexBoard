import {useEffect,useRef,useState,type ReactNode} from 'react';
import {option,optionValue,pitchNames} from './wavetableSchema.ts';
import {intervalDescription,parseRatio,ratioText} from './wavetableIntervals.ts';
export interface IntervalSpec{mode:number;amount:number;num:number;den:number;fine?:number}
export function IntervalControls({label,parameters:p,spec,disabled,onFields,control}:{label:string;parameters:number[];spec:IntervalSpec;disabled:boolean;onFields:(values:Record<number,number>)=>void;control:(id:number,label?:string,describe?:(v:number)=>string)=>ReactNode}){
 const mode=option(spec.mode,p[spec.mode]);
 const [text,setText]=useState(ratioText(p[spec.num],p[spec.den])),[invalid,setInvalid]=useState(false);
 useEffect(()=>{setText(ratioText(p[spec.num],p[spec.den]));setInvalid(false);},[p[spec.num],p[spec.den]]);
 const commit=()=>{const ratio=parseRatio(text);setInvalid(!ratio);if(ratio)onFields({[spec.num]:ratio[0],[spec.den]:ratio[1]});};
 return <div className="wt-interval"><label>{label} unit<select aria-label={`${label} unit`} disabled={disabled} value={mode} onChange={e=>onFields({[spec.mode]:optionValue(spec.mode,Number(e.target.value)),[spec.amount]:32768})}>{pitchNames.map((name,i)=><option key={name} value={i}>{name}</option>)}</select></label>
  {mode===1&&<label>{label} ratio<input aria-label={`${label} ratio`} value={text} list="wt-ratio-choices" disabled={disabled} aria-invalid={invalid} onChange={e=>setText(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/>{invalid&&<small role="alert">Use a positive ratio such as 3/2, between 1/32 and 32.</small>}</label>}
  <div className="knob-bank">{control(spec.amount,mode===1?'Offset':'Interval',v=>intervalDescription(mode,v))}{spec.fine!==undefined&&control(spec.fine,'Fine')}</div>
  <small>{mode===1?'Ratio stays relative to the played note in every tuning.':mode===2?'Whole steps follow the board’s current tuning, including unequal intervals.':mode===3?'A period follows the tuning’s repeat interval.':'Cents are a fixed frequency interval.'}</small>
 </div>;
}
export function PartialsDialog({children,onClose}:{children:ReactNode;onClose:()=>void}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;ref.current?.showModal();return()=>previous?.focus();},[]);
 return <dialog ref={ref} className="wt-partials-dialog" aria-label="Customize body partials" onCancel={e=>{e.preventDefault();onClose();}}><header><h3>Body partials</h3><button type="button" onClick={onClose}>Done</button></header>{children}</dialog>;
}
