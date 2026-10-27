import {synthErrorMessage} from "./requestError.ts";
import {useEffect,useRef,useState,type ReactNode} from 'react';
import type {MidiTransport} from '../../midi/types.ts';
import {PhysicalSynthClient} from './client.ts';
import {velocityEngines,type PhysicalVelocityEngine} from './schema.ts';
import {ArpeggiatorEditor} from './ArpeggiatorEditor.tsx';
import {S,arpModes,arpRates,publishPerformance,publishPerformanceState,usePerformance,type PerformanceConfig,type PerformanceState} from './performanceSchema.ts';
import './PerformanceRow.css';
export function PerformanceRow({transport,disabled=false,physical=true,voiceControls}:{voiceControls?:ReactNode;transport?:MidiTransport;disabled?:boolean;physical?:boolean}){
 const config=usePerformance(),v=config.values;
 const [open,setOpen]=useState(false),[velocity,setVelocity]=useState<PhysicalVelocityEngine>(0),[state,setState]=useState<PerformanceState>(),[error,setError]=useState(''),[ready,setReady]=useState(!transport),[pending,setPending]=useState(false),[saved,setSaved]=useState(false);
 const client=useRef<PhysicalSynthClient|undefined>(undefined),latest=useRef(config),queued=useRef<PerformanceConfig|undefined>(undefined),sending=useRef(false),mounted=useRef(true),epoch=useRef(0),taps=useRef<number[]>([]);
 const blocked=disabled||!!transport&&!ready;
 const [tempoText,setTempoText]=useState(String(v[S.bpm10]/10)),tempoEditing=useRef(false),busyRef=useRef(disabled);busyRef.current=disabled;
 useEffect(()=>{if(!tempoEditing.current)setTempoText(String((v[S.clock]?state?.bpm10??v[S.bpm10]:v[S.bpm10])/10));},[v[S.bpm10],v[S.clock],state?.bpm10]);
 const fail=(e:unknown)=>{const message=synthErrorMessage(e);if(mounted.current&&message!==undefined)setError(message);};
 useEffect(()=>{let disposed=false,polling=false;++epoch.current;mounted.current=true;setReady(!transport);setError('');const c=transport?new PhysicalSynthClient(transport):undefined;client.current=c;
  if(c)void c.performance().then(r=>{if(!disposed){latest.current=r.config;publishPerformanceState(r);setState(r);setReady(true);}}).catch(e=>{if(!disposed)fail(e);});
  const poll=setInterval(()=>{if(!c||disposed||polling||sending.current||busyRef.current)return;polling=true;void Promise.all([c.performance(),c.status()]).then(([r,s])=>{if(!disposed){setState(r);setVelocity(s.preset.velocityEngine);if(!queued.current&&!sending.current){latest.current=r.config;publishPerformanceState(r);}setReady(true);}}).catch(e=>{if(!disposed)fail(e);}).finally(()=>polling=false);},250);
  return()=>{disposed=true;mounted.current=false;clearInterval(poll);c?.close();client.current=undefined;queued.current=undefined;sending.current=false;};
 },[transport]);
 const change=(next:PerformanceConfig)=>{latest.current=next;publishPerformance(next);setSaved(false);setError('');if(!client.current)return;queued.current=next;
  if(sending.current)return;const current=client.current,generation=epoch.current;sending.current=true;setPending(true);
  void(async()=>{try{while(queued.current&&epoch.current===generation){const p=queued.current;queued.current=undefined;const r=await current.performance(p);if(mounted.current&&epoch.current===generation){setState(r);if(!queued.current){latest.current=r.config;publishPerformanceState(r);}}}}catch(e){if(epoch.current!==generation)return;queued.current=undefined;fail(e);try{const r=await current.performance();if(r&&mounted.current&&epoch.current===generation){latest.current=r.config;publishPerformanceState(r);}}catch{/* Connection error already visible. */}}finally{if(epoch.current===generation){sending.current=false;if(mounted.current)setPending(false);}}})();
 };
 const set=(index:number,value:number)=>{const p=latest.current;change({...p,values:p.values.map((v,i)=>i===index?value:v)});};
 const tap=()=>{const now=performance.now();taps.current=taps.current.filter(t=>now-t<3000).slice(-4);taps.current.push(now);if(taps.current.length>=2)set(S.bpm10,Math.max(400,Math.min(2400,Math.round(600000*(taps.current.length-1)/(now-taps.current[0])))));};
 const clear=()=>{if(client.current)void client.current.clearArpeggio().then(setState).catch(fail);};
 return <div className="performance-area">
  <div className="performance-row" role="group" aria-label="Performance">
   <span className="performance-caption">Performance</span>
   <label className="performance-velocity"><span>Velocity</span><select aria-label="Velocity engine" value={velocity} disabled={blocked||pending} onChange={e=>{const kind=Number(e.target.value) as PhysicalVelocityEngine;if(client.current)void client.current.velocityEngine(kind).then(()=>setVelocity(kind)).catch(fail);else setVelocity(kind);}}>{velocityEngines.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
   <div className={`arp-access${v[S.enabled]?' enabled':''}`}><button type="button" className="arp-power" aria-label="Enable arpeggiator" aria-pressed={!!v[S.enabled]} disabled={blocked||pending} onClick={()=>set(S.enabled,1-v[S.enabled])}><span className="arp-led"/>Arp</button><button type="button" className="arp-open" aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={()=>setOpen(true)}><span>{arpModes[v[S.mode]]}</span><small>{arpRates[v[S.division]]}{v[S.timing]===1?' · dotted':v[S.timing]===2?' · triplet':''}</small><span aria-hidden="true">⌄</span></button></div>
   <button className="arp-hold" type="button" aria-pressed={!!v[S.latch]} disabled={blocked} onClick={()=>set(S.latch,1-v[S.latch])} title="Keep the chord playing after you release the keys">Hold</button>
   {voiceControls}
   <div className="performance-clock"><span className={`clock-pulse${state?.running?' active':''}`} aria-hidden="true"/><label><span>BPM</span><input aria-label="Performance BPM" type="number" min="40" max="240" step=".1" disabled={blocked||!!v[S.clock]} value={tempoText} onFocus={()=>tempoEditing.current=true} onChange={e=>setTempoText(e.target.value)} onBlur={()=>{tempoEditing.current=false;const bpm=Number(tempoText);if(Number.isFinite(bpm)&&tempoText.trim()){const value=Math.max(400,Math.min(2400,Math.round(bpm*10)));setTempoText(String(value/10));if(value!==v[S.bpm10])set(S.bpm10,value);}else setTempoText(String(v[S.bpm10]/10));}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/></label><button type="button" disabled={blocked||!!v[S.clock]} onClick={tap}>Tap</button>{!!v[S.clock]&&<small>{state?.external?'USB clock':'Waiting for clock'}</small>}</div>
   <span className="arp-live" aria-live="off">{pending?'Updating…':state?.notes?`${state.notes} notes${state.running?' · playing':''}`:v[S.enabled]?'Play a chord':'Ready'}</span>
  </div>
  {error&&<div className="performance-error" role="alert">{error}</div>}
  {open&&<ArpeggiatorEditor config={config} state={state} disabled={blocked} physical={physical} onChange={change} onClose={()=>setOpen(false)} onClear={clear} onSave={()=>{if(!client.current){setSaved(true);return;}void client.current.savePerformance().then(()=>setSaved(true)).catch(fail);}} saved={saved} connected={!!transport} error={error}/>}
 </div>;
}
