import {useEffect,useRef,useMemo} from 'react';
import type {PhysicalExpression} from './client.ts';
import {StringMotion,type MotionInput} from './stringMotion.ts';
export function StringAnimation({values,signature,live,playing,replay,enabled}:{values:number[];signature:string;live?:PhysicalExpression;playing:boolean;replay:number;enabled:boolean}){
  const root=useRef<SVGGElement>(null),engine=useMemo(()=>new StringMotion(),[]);
  const inputs=useRef<MotionInput>({values,held:false,key:null,velocity:.8,playing});
  inputs.current={values,held:!!live?.held,key:live?.key??null,velocity:(live?.velocity??100)/127,playing};
  const wake=useRef(()=>{}),demo=useRef(()=>{});
  const state=useRef({signature,replay,playing,enabled});
  useEffect(()=>{
    const node=root.current!;const wave=node.querySelector<SVGPathElement>('[data-motion="wave"]')!;
    const pickup=Array.from(node.querySelectorAll<SVGCircleElement>('[data-motion="pickup"]'));
    const balls=Array.from(node.querySelectorAll<SVGCircleElement>('[data-motion="ball"]'));
    const bow=node.querySelector<SVGGElement>('[data-motion="bow"]')!,mute=node.querySelector<SVGPathElement>('[data-motion="mute"]')!;
    const preference=window.matchMedia('(prefers-reduced-motion: reduce)');
    let raf:number|undefined,last=0,visible=true,disposed=false;
    const paint=(now:number)=>{
      const v=inputs.current.values,f=engine.frame(now/1000,inputs.current);
      wave.setAttribute('d',f.path);wave.style.strokeWidth=String(1.7+v[26]);wave.style.stroke=`color-mix(in srgb, var(--brand) ${100-70*v[26]}%, ${['#efb86b','#ef9479','#b29aff'][Math.round(v[27]*2)]})`;
      pickup.forEach((c,i)=>{c.setAttribute('cx',String(30+540*(.05+.9*v[i?14:5])));c.setAttribute('cy',String(f.pickups[i]));c.style.opacity=f.amplitude>.1?'.85':'0';});
      balls.forEach((c,i)=>{const b=f.balls[i];c.style.opacity=b?String(b.opacity):'0';if(b){c.setAttribute('cx',String(b.x));c.setAttribute('cy',String(b.y));c.setAttribute('r',String(b.r));}});
      bow.setAttribute('transform',`translate(${30+540*(.05+.9*v[4])+f.bow} 82)`);bow.style.opacity=v[21]>.5&&f.amplitude>.1?'.8':'0';
      mute.style.opacity=f.contact&&Math.round(v[8]*4)===3?String(v[16]):'0';
      return f.active;
    };
    const tick=(now:number)=>{
      raf=undefined;if(disposed||document.hidden||!visible)return;
      if(now-last<1000/30){raf=requestAnimationFrame(tick);return;}last=now;
      const active=paint(now);if(active&&state.current.enabled&&!preference.matches)raf=requestAnimationFrame(tick);
    };
    const cancel=()=>{if(raf!==undefined)cancelAnimationFrame(raf);raf=undefined;};
    const schedule=()=>{if(disposed||document.hidden||!visible)return;if(!state.current.enabled||preference.matches){cancel();wave.setAttribute('d','M30 82H570');[...pickup,...balls,bow,mute].forEach(e=>e.style.opacity='0');}else if(raf===undefined)raf=requestAnimationFrame(tick);};
    wake.current=schedule;demo.current=()=>{if(!inputs.current.playing||!inputs.current.held){engine.replay(performance.now()/1000,inputs.current.values);schedule();}};
    const visibility=()=>{if(document.hidden)cancel();else schedule();};
    const motion=()=>{cancel();schedule();};
    document.addEventListener('visibilitychange',visibility);preference.addEventListener('change',motion);
    const observer=typeof IntersectionObserver==='undefined'?undefined:new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible)schedule();else cancel();});observer?.observe(node.ownerSVGElement!);schedule();
    return()=>{disposed=true;cancel();observer?.disconnect();document.removeEventListener('visibilitychange',visibility);preference.removeEventListener('change',motion);wake.current=()=>{};demo.current=()=>{};};
  },[]);
  const effective=values.join(',');
  useEffect(()=>{
    const old=state.current;if(old.playing&&!playing)engine.reset();
    state.current={signature,replay,playing,enabled};
    if(old.replay!==replay||old.signature!==signature&&(!playing||!live?.held))demo.current();else wake.current();
  },[signature,replay,playing,enabled,effective,live?.held,live?.key,live?.velocity]);
  return <g ref={root} className="string-animation" aria-hidden="true">
    <path data-motion="wave" d="M30 82H570" fill="none" stroke="currentColor" strokeWidth="2"/>
    <circle data-motion="pickup" r="4" fill="#73c6ae" opacity="0"/><circle data-motion="pickup" r="4" fill="#a4a2e6" opacity="0"/>
    {Array.from({length:6},(_,i)=><circle data-motion="ball" key={i} r="4" fill="#b9d6f0" stroke="var(--surface)" strokeWidth="1" opacity="0"/>)}
    <g data-motion="bow" opacity="0"><path d="M-22 -10L22 10M-19 -13L25 7" fill="none" stroke="#efb86b" strokeWidth="3"/></g>
    <path data-motion="mute" d="M540 69H560V80H540Z" fill="#b29aff" opacity="0"/>
  </g>;
}
