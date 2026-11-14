import {useEffect,useRef,useState,type ReactNode} from 'react';
import {P,option,optionValue,pitchNames} from './wavetableSchema.ts';
import {bipolar,defaultTuning,gridOffset,intervalDescription,intervalPitch,intervalValue,parseRatio,ratioText,type TuningGrid} from './wavetableIntervals.ts';
export interface IntervalSpec{mode:number;amount:number;num:number;den:number;fine?:number}
/** Pitch as a unit, an optional ratio, and offset knobs. `before` places related knobs on the same row. */
export function IntervalControls({label,parameters:p,spec,disabled,onFields,control,before}:{label:string;parameters:number[];spec:IntervalSpec;disabled:boolean;onFields:(values:Record<number,number>)=>void;control:(id:number,label?:string,describe?:(v:number)=>string)=>ReactNode;before?:ReactNode}){
 const mode=option(spec.mode,p[spec.mode]);
 const [text,setText]=useState(ratioText(p[spec.num],p[spec.den])),[invalid,setInvalid]=useState(false);
 useEffect(()=>{setText(ratioText(p[spec.num],p[spec.den]));setInvalid(false);},[p[spec.num],p[spec.den]]);
 const commit=()=>{const ratio=parseRatio(text);setInvalid(!ratio);if(ratio)onFields({[spec.num]:ratio[0],[spec.den]:ratio[1]});};
 const help=mode===1?'Ratio stays relative to the played note in every tuning.':mode===2?'Whole steps follow the board’s current tuning, including unequal intervals.':mode===3?'A period follows the tuning’s repeat interval.':'Cents are a fixed frequency interval.';
 return <div className="wt-interval">
  <div className="wt-interval-fields"><label title={help}>Pitch unit<select aria-label={`${label} unit`} disabled={disabled} value={mode} onChange={e=>onFields({[spec.mode]:optionValue(spec.mode,Number(e.target.value)),[spec.amount]:32768})}>{pitchNames.map((name,i)=><option key={name} value={i}>{name}</option>)}</select></label>
  {mode===1&&<label title="A ratio to the played note, such as 3/2">Ratio<input aria-label={`${label} ratio`} value={text} list="wt-ratio-choices" disabled={disabled} aria-invalid={invalid} onChange={e=>setText(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/>{invalid&&<small role="alert">Use a positive ratio such as 3/2, between 1/32 and 32.</small>}</label>}</div>
  <div className="knob-bank">{before}{control(spec.amount,mode===1?'Offset':'Interval',v=>intervalDescription(mode,v))}{spec.fine!==undefined&&control(spec.fine,'Fine')}</div>
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

/** The attack recording at a glance. */
/** Built-in attack shapes as loudness outlines: click, tonal pop, air puff. */
const attackShapes=[(i:number)=>Math.exp(-i/2.5),(i:number)=>Math.exp(-i/11)*Math.abs(Math.sin(i*.8+.9)),(i:number)=>i/9*Math.exp(1-i/9)*(.55+.45*grain(i))];
function grain(i:number){const x=Math.sin(i*127.1+3.3)*43758.5453;return x-Math.floor(x);}
/** One strip for the layer mix: the attack burst at note-on over the steady noise bed, each as tall as its level. */
export function LayersPicture({shape,frames,level,noise}:{shape:number;frames?:ArrayLike<number>;level:number;noise:number}){
 const columns=120,span=columns,gain=level?level**.6:0,bed=noise?noise**.6:0;
 let burst:number[];
 if(frames?.length){const peak=Math.max(1,...Array.from(frames,Math.abs)),step=frames.length/span;
  burst=Array.from({length:span},(_,i)=>{let top=0;for(let k=Math.floor(i*step);k<Math.min(frames.length,Math.floor((i+1)*step)+1);++k)top=Math.max(top,Math.abs(frames[k]));return top/peak;});
 }else burst=Array.from({length:span},(_,i)=>(attackShapes[shape]??attackShapes[0])(i));
 const bars=(height:(i:number)=>number,count:number)=>Array.from({length:count},(_,i)=>{const v=13*height(i);return v<.2?'':`M${i+.5} ${(14-v).toFixed(1)}V${(14+v).toFixed(1)}`;}).join('');
 return <svg className="wt-layers-picture" viewBox={`0 0 ${columns} 28`} preserveAspectRatio="none" role="img" aria-label="Attack and noise levels">
  <path className="wt-layers-axis" d={`M0 14H${columns}`}/>
  <path className="wt-layers-ghost" d={bars(i=>burst[i],span)}/>
  <path className="wt-layers-noise" d={bars(i=>bed*(.35+.65*grain(i+40)),columns)}/>
  <path className="wt-layers-attack" d={bars(i=>gain*burst[i],span)}/>
 </svg>;
}
/** Two cycles of the sub's wave, as tall as its level. */
export function SubWave({triangle,level}:{triangle:boolean;level:number}){
 const wave=(amp:number)=>`M${Array.from({length:49},(_,i)=>{const t=i/24%1,v=triangle?(t<.25?4*t:t<.75?2-4*t:4*t-4):Math.sin(2*Math.PI*t);return `${i} ${(12-amp*v).toFixed(1)}`;}).join('L')}`;
 return <svg className="wt-sub-wave" viewBox="0 0 48 24" preserveAspectRatio="none" role="img" aria-label="Sub wave"><path className="wt-sub-ghost" d={wave(10)}/><path d={wave(level?10*level**.6:0)}/></svg>;
}
