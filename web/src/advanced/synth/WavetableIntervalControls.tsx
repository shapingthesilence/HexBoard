import {useEffect,useRef,useState,type ReactNode} from 'react';
import {P,option,optionValue,pitchNames} from './wavetableSchema.ts';
import {bipolar,defaultTuning,gridOffset,intervalDescription,intervalPitch,intervalValue,parseRatio,ratioText,type TuningGrid} from './wavetableIntervals.ts';
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
export function PartialsDialog({children,actions,onClose}:{children:ReactNode;actions?:ReactNode;onClose:()=>void}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;ref.current?.showModal();return()=>previous?.focus();},[]);
 return <dialog ref={ref} className="wt-partials-dialog" aria-label="Customize body partials" onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===ref.current)onClose();}}><header><h3>Body partials</h3>{actions}<button type="button" className="wt-partials-done" onClick={onClose}>Done</button></header>{children}</dialog>;
}

const ringSlices=14,ringDx=9,ringDy=-5,ringLeft=40,ringRight=560,ringBase=172,ringHeight=128,panLeft=40,panRight=150,pictureHeight=206;
/** Level to picture height: quiet partials stay visible. */
const levelHeight=(level:number)=>ringHeight*level**.6,heightLevel=(height:number)=>Math.max(0,Math.min(1,height/ringHeight))**(1/.6);
/** How much of a partial is still sounding at depth t (0 = note start, 1 = the back of the picture). */
export const partialRing=(level:number,decay:number,t:number)=>level*Math.exp(-3.2*t/(.08+decay));
/** The pitch of one partial in octaves above the played note. */
export const partialOctaves=(grid:TuningGrid,part:number[])=>intervalPitch(grid,grid.root,partMode(part),part[1],part[2],part[3])-grid.root;
const partMode=(part:number[])=>option(P.Partial1Mode,part[0]);
/** The stored interval amount that puts a partial closest to a pitch, in its own unit. */
export function partialAmountFor(grid:TuningGrid,part:number[],octaves:number){
 const mode=partMode(part);
 if(mode===2){let best=0,error=Infinity;for(let steps=-32;steps<=32;++steps){const e=Math.abs(gridOffset(grid,grid.root,steps)-grid.root-octaves);if(e<error){error=e;best=steps;}}return intervalValue(best,32);}
 if(mode===3)return intervalValue(Math.max(-2,Math.min(2,Math.round(octaves/grid.period))),2);
 return intervalValue(octaves-(mode===1?Math.log2(part[2]/part[3]):0),2);
}
const ratioLabel=(octaves:number)=>{const r=2**octaves;return `×${r>=10?r.toFixed(1):r.toFixed(2)}`;};
/** Four resonances drawn as they ring out: across is pitch, up is level, depth is time, and the strip on the right is stereo position.
 * Drag a numbered handle sideways to retune it and up or down for level; drag a dot in the stereo strip to pan. */
export function PartialsPicture({parts,grid=defaultTuning,active,disabled,onActive,onFields}:{parts:number[][];grid?:TuningGrid;active?:number;disabled?:boolean;onActive:(index?:number)=>void;onFields:(values:Record<number,number>)=>void}){
 const svg=useRef<SVGSVGElement>(null);
 const pitches=parts.map(part=>partialOctaves(grid,part)),levels=parts.map(part=>part[4]/65535),decays=parts.map(part=>part[5]/65535),pans=parts.map(part=>bipolar(part[6]));
 const low=Math.min(-.5,Math.floor(Math.min(...pitches)-.3)),high=Math.max(4.5,Math.ceil(Math.max(...pitches)+.3));
 const x=(octaves:number)=>ringLeft+(octaves-low)/(high-low)*(ringRight-ringLeft),panX=(pan:number)=>(panLeft+panRight)/2+pan*(panRight-panLeft-14)/2;
 const point=(event:{clientX:number;clientY:number})=>{const box=svg.current!.getBoundingClientRect();return {x:(event.clientX-box.left)/box.width*720,y:(event.clientY-box.top)/box.height*pictureHeight};};
 const drag=(index:number,kind:'tone'|'pan')=>(event:React.PointerEvent<SVGElement>)=>{
  if(disabled||!(event.buttons&1))return;const at=P.Partial1Mode+index*7,q=point(event);
  if(kind==='pan'){onFields({[at+6]:Math.round((Math.max(-1,Math.min(1,(q.x-(panLeft+panRight)/2)/((panRight-panLeft)/2)))+1)*.5*65535)});return;}
  const octaves=low+(q.x-ringLeft)/(ringRight-ringLeft)*(high-low);
  onFields({[at+1]:partialAmountFor(grid,parts[index],octaves),[at+4]:Math.round(heightLevel(ringBase-q.y)*65535)});
 };
 const grab=(index:number)=>(event:React.PointerEvent<SVGElement>)=>{if(disabled)return;event.currentTarget.setPointerCapture(event.pointerId);onActive(index);};
 const ridge=(index:number,slice:number)=>{const t=slice/(ringSlices-1),h=levelHeight(partialRing(levels[index],decays[index],t)),cx=x(pitches[index])+slice*ringDx,y=ringBase+slice*ringDy,w=15;
  return `M${(cx-w).toFixed(1)} ${y}C${(cx-w/3).toFixed(1)} ${y} ${(cx-w/2.6).toFixed(1)} ${(y-h).toFixed(1)} ${cx.toFixed(1)} ${(y-h).toFixed(1)}S${(cx+w/3).toFixed(1)} ${y} ${(cx+w).toFixed(1)} ${y}Z`;};
 const order=[...parts.keys()].sort((a,b)=>(a===active?1:0)-(b===active?1:0));
 const backX=(ringSlices-1)*ringDx,backY=(ringSlices-1)*ringDy;
 return <svg ref={svg} className="wt-partials-picture" viewBox={`0 0 720 ${pictureHeight}`} role="img" aria-label="How the four body partials ring out" data-active={active!==undefined||undefined}>
  <path className="wt-ring-floor" d={`M${ringLeft} ${ringBase}H${ringRight}l${backX} ${backY}H${ringLeft+backX}Z`}/>
  {Array.from({length:Math.floor(high)-Math.ceil(low)+1},(_,i)=>Math.ceil(low)+i).map(octave=><g key={octave}>
   <path className={octave===0?'wt-ring-note':'wt-ring-grid'} d={`M${x(octave).toFixed(1)} ${ringBase}l${backX} ${backY}`}/>
   <text className="wt-axis" x={x(octave)} y={ringBase+15} textAnchor="middle">{octave===0?'played note':octave>0?`×${2**octave}`:`÷${2**-octave}`}</text>
  </g>)}
  <text className="wt-axis" x={ringRight+backX+6} y={ringBase+backY+4}>later</text>
  <text className="wt-axis" x={ringRight+8} y={ringBase+4}>note starts</text>
  <path className="wt-ring-grid" d={`M${ringRight+14} ${ringBase-8}l${backX-18} ${backY+10}`}/>
  {Array.from({length:ringSlices},(_,i)=>ringSlices-1-i).map(slice=><g key={slice} style={{opacity:(.4+.6*(1-slice/(ringSlices-1))).toFixed(2)}}>
   <path className="wt-ring-time" d={`M${ringLeft+slice*ringDx} ${ringBase+slice*ringDy}H${ringRight+slice*ringDx}`}/>
   {order.map(index=><path key={index} className="wt-ring-ridge" data-part={index+1} data-on={active===index||undefined} d={ridge(index,slice)}/>)}
  </g>)}
  {order.map(index=>{const cx=x(pitches[index]),cy=ringBase-levelHeight(levels[index]);return <g key={index} className="wt-ring-handle" data-part={index+1} data-on={active===index||undefined} data-disabled={disabled||undefined}
    onPointerDown={grab(index)} onPointerMove={drag(index,'tone')} onPointerEnter={()=>onActive(index)} onPointerLeave={event=>{if(!(event.buttons&1))onActive(undefined);}}>
   <title>{`Partial ${index+1}: ${ratioLabel(pitches[index])} the played note, level ${Math.round(levels[index]*100)}%, decay ${Math.round(decays[index]*100)}%. Drag sideways to retune, up or down for level.`}</title>
   <line x1={cx} x2={cx} y1={ringBase} y2={cy}/><circle cx={cx} cy={cy} r="10"/><text x={cx} y={cy+3.5} textAnchor="middle">{index+1}</text>
   <text className="wt-ring-ratio" x={cx} y={ringBase+27} textAnchor="middle">{ratioLabel(pitches[index])}</text>
  </g>;})}
  <text className="wt-axis" x={panLeft} y="16">L</text><text className="wt-axis" x={panRight} y="16" textAnchor="end">R</text><text className="wt-axis" x={(panLeft+panRight)/2} y="16" textAnchor="middle">stereo</text>
  <path className="wt-ring-grid" d={`M${(panLeft+panRight)/2} 22V${24+parts.length*17}`}/>
  {parts.map((_,index)=>{const y=31+index*17;return <g key={index} className="wt-ring-pan" data-part={index+1} data-on={active===index||undefined} data-disabled={disabled||undefined}
    onPointerDown={grab(index)} onPointerMove={drag(index,'pan')} onPointerEnter={()=>onActive(index)} onPointerLeave={event=>{if(!(event.buttons&1))onActive(undefined);}}>
   <title>{`Partial ${index+1} pan ${Math.round(pans[index]*100)}%. Drag left or right.`}</title>
   <rect x={panLeft} y={y-7} width={panRight-panLeft} height="14" rx="7"/><circle cx={panX(pans[index])} cy={y} r={(3+3.5*Math.sqrt(levels[index])).toFixed(1)}/>
  </g>;})}
 </svg>;
}
