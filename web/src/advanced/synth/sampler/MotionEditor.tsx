import {useState} from 'react';
import {Knob} from '../SynthControls.tsx';
import {motionSettings,type Motion} from './motion.mjs';
export function MotionEditor({value,onChange,onEnd,onApplyAll,classic}:{value?:Partial<Motion>;onChange:(change:Partial<Motion>)=>void;onEnd:()=>void;onApplyAll:()=>void;classic:boolean}){
 const [page,setPage]=useState('Vibrato'),m=motionSettings(value);
 const knobs:([keyof Motion,string,number,number,string])[]=page==='Vibrato'?[['vibratoDepth','Depth',0,200,'cents'],['vibratoRate','Rate',0,20,'Hz'],['vibratoDelay','Delay',0,10000,'ms'],['vibratoFade','Fade in',0,10000,'ms']]:page==='Envelope'?[['delay','Delay',0,10000,'ms'],['attack','Attack',0,10000,'ms'],['hold','Hold',0,20000,'ms'],['decay','Decay',0,20000,'ms'],['sustain','Sustain',0,1,''],['release','Release',0,20000,'ms'],['pitch','Pitch',-12000,12000,'cents'],['filter','Brightness',-12000,12000,'cents']]:[['lfoRate','Rate',0,20,'Hz'],['lfoDelay','Delay',0,10000,'ms'],['lfoFade','Fade in',0,10000,'ms'],['lfoPitch','Pitch',-1200,1200,'cents'],['lfoFilter','Brightness',-12000,12000,'cents'],['lfoVolume','Tremolo',-24,24,'dB']];
 return <fieldset><legend>Motion</legend><div className="sampler-tabs" role="group" aria-label="Motion view">{['Vibrato','Envelope','LFO'].map(p=><button key={p} aria-pressed={page===p} onClick={()=>setPage(p)}>{p}</button>)}</div>
 <p className="panel-note">Editing the selected region.{classic?' Heard in the browser only; Classic export omits motion.':''}</p>
 <div className="sampler-motion-choices">{page==='Vibrato'&&<label>Depth follows<select aria-label="Vibrato depth source" value={m.source} onChange={e=>{onChange({source:+e.target.value});onEnd();}}><option value={0}>Automatic</option><option value={1}>Motion envelope</option><option value={2}>Key pressure</option><option value={3}>Strike velocity</option></select></label>}
 {page!=='Envelope'&&<label>Waveform<select aria-label="Motion waveform" value={m.shape} onChange={e=>{onChange({shape:+e.target.value});onEnd();}}><option value={0}>Sine</option><option value={1}>Triangle</option></select></label>}
 </div><div className="knob-bank">{knobs.map(([k,label,min,max,unit])=><label className="sampler-knob" key={k}><span>{label}</span><Knob label={'Motion '+label} min={min} max={max} value={m[k]} onChange={v=>onChange({[k]:v})} onRelease={onEnd}/><output>{m[k].toFixed(max<=20?2:0)} {unit}</output></label>)}</div>
 <button onClick={onApplyAll}>Use this motion for all regions</button></fieldset>;
}
