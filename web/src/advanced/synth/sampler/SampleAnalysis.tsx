import {noteName} from "./import.mjs";
import { waveformDetail } from "./loopEditing.ts";
import {useEffect,useRef,useState,useMemo} from 'react';
import type {Recording} from './prepare.mjs';
import {hzForMidi,midiForHz,centsBetween,retuneRecording,analysisChannel,type PitchAnalysis,type LoopCandidate} from './analysis.ts';
import {TuningAudition} from './TuningAudition.ts';
function AnalysisNumber({label,value,change,step}:{label:string;value:number;change:(n:number)=>void;step:number}) {
 const [draft,setDraft]=useState(String(Number(value.toFixed(6)))),dirty=useRef(false);
 useEffect(()=>{if(!dirty.current)setDraft(String(Number(value.toFixed(6))));},[value]);
 const commit=()=>{if(dirty.current&&draft.trim()&&Number.isFinite(Number(draft)))change(Number(draft));dirty.current=false;setDraft(String(Number(value.toFixed(6))));};
 return <label>{label}<input aria-label={label} type="number" step={step} value={draft} onChange={event=>{dirty.current=true;setDraft(event.target.value);}} onBlur={commit}
 onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();commit();event.currentTarget.blur();}else if(event.key==='Escape'){dirty.current=false;setDraft(String(Number(value.toFixed(6))));event.currentTarget.blur();}else if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();const base=dirty.current&&draft.trim()&&Number.isFinite(Number(draft))?Number(draft):value;const next=base+(event.key==='ArrowUp'?1:-1)*step*(event.shiftKey?10:1);dirty.current=false;change(next);setDraft(String(Number(next.toFixed(6))));}}}/></label>;
}
export interface TuningTarget {name:string;hz:number}
export function SampleAnalysis({recording:a,onChange,targets=[],stopSignal=0,sharedSelection,onSelection,inlineResults=false}:{recording:Recording;onChange:(change:Partial<Recording>)=>void;targets?:TuningTarget[];stopSignal?:number;sharedSelection?:[number,number];onSelection?:(s:[number,number])=>void;inlineResults?:boolean}){
 const bounds={start:a.start??0,end:a.end??a.channels[0].length};
 const [localSelection,setLocalSelection]=useState<[number,number]>([bounds.start+Math.floor((bounds.end-bounds.start)*.15),Math.min(bounds.end,bounds.start+Math.floor((bounds.end-bounds.start)*.15)+Math.floor(a.rate*5))]);
 const selection=sharedSelection??localSelection;
 const setSelection=(s:[number,number]|((s:[number,number])=>[number,number]))=>{const next=typeof s==='function'?s(selection):s;if(onSelection)onSelection(next);else setLocalSelection(next);};
 const [resultsOpen,setResultsOpen]=useState(false);
 const resultsDialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{if(resultsOpen&&!inlineResults)resultsDialog.current?.showModal();},[resultsOpen,inlineResults]);
 const [analysis,setAnalysis]=useState<PitchAnalysis>(),[loops,setLoops]=useState<LoopCandidate[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[target,setTarget]=useState(hzForMidi(a.rootMidi)),[originalVersion,setOriginalVersion]=useState(false),[loopOnly,setLoopOnly]=useState(false);
 const lastOperation=useRef<'analyze'|'verify'>('analyze');
 const worker=useRef<Worker|undefined>(undefined), original=useRef(a), audition=useRef<TuningAudition|undefined>(undefined), current=useRef(a);current.current=a;
 useEffect(()=>{audition.current=new TuningAudition();return()=>{worker.current?.terminate();audition.current?.close();};},[]);
 useEffect(()=>{worker.current?.terminate();worker.current=undefined;setBusy(false);setAnalysis(undefined);setLoops([]);setResultsOpen(false);audition.current?.stop();},[a.channels,a.rate,selection[0],selection[1],a.start,a.end]);
 useEffect(()=>{if(original.current.channels!==a.channels){original.current=a;setSelection([bounds.start+Math.floor((bounds.end-bounds.start)*.15),Math.min(bounds.end,bounds.start+Math.floor((bounds.end-bounds.start)*.15)+Math.floor(a.rate*5))]);setTarget(hzForMidi(a.rootMidi));setOriginalVersion(false);}},[a.channels]);
 useEffect(()=>{audition.current?.stop();},[stopSignal]);
 useEffect(()=>{audition.current?.update(originalVersion?original.current:a);},[a,originalVersion]);
 useEffect(()=>{audition.current?.retarget(target);},[target]);
 useEffect(()=>{if(lastOperation.current==='verify'){worker.current?.terminate();worker.current=undefined;setBusy(false);setAnalysis(undefined);setMessage('Loop changed; verify its rendered tuning again.');}},[a.loopStart,a.loopEnd,a.crossfade,a.mode]);
 const valid=selection[0]>=bounds.start&&selection[1]<=bounds.end&&selection[1]>selection[0]&&selection[1]-selection[0]<=a.rate*30;
 const run=(operation:'analyze'|'verify')=>{
  lastOperation.current=operation;worker.current?.terminate();setMessage('');if(!valid){setMessage('Select a nonempty region inside the trimmed sample.');return;}
  const instance=new Worker(new URL('./analysis.worker.ts',import.meta.url),{type:'module'});worker.current=instance;setBusy(true);const source=a;
  instance.onmessage=event=>{if(worker.current!==instance)return;instance.terminate();worker.current=undefined;setBusy(false);if(current.current.channels!==source.channels||current.current.rate!==source.rate)return;if(operation==='verify'&&(current.current.loopStart!==source.loopStart||current.current.loopEnd!==source.loopEnd||current.current.crossfade!==source.crossfade))return;if(event.data.error){setMessage(event.data.error);return;}if(operation==='analyze'){event.data.analysis.points.forEach((p:{seconds:number})=>p.seconds+=origin/a.rate);event.data.loops.forEach((l:LoopCandidate)=>{l.start+=origin;l.end+=origin;});}setAnalysis(event.data.analysis);setLoops(event.data.loops);setResultsOpen(true);setMessage(operation==='verify'?'Measured the rendered crossfade and repeating loop.':'Analysis is advisory. Existing imported tuning has not changed.');};
  instance.onerror=event=>{if(worker.current!==instance)return;instance.terminate();worker.current=undefined;setBusy(false);setMessage(event.message||'Analysis failed.');};
  const origin=operation==='analyze'?selection[0]:(a.loopStart??bounds.start), finish=operation==='analyze'?selection[1]:(a.loopEnd??bounds.end);
  const channels=a.channels.map(c=>c.slice(origin,Math.min(bounds.end,finish+Math.ceil(a.rate*.02))));
  const recording={...a,channels,start:0,end:channels[0].length,loopStart:0,loopEnd:finish-origin};
  instance.postMessage({operation,recording,start:0,end:finish-origin});
 };
 const play=(mode:'sample'|'together'|'alternate'|'reference')=>{void audition.current?.play(originalVersion?original.current:a,target,mode,loopOnly).catch(e=>setMessage(String(e)));};
 const analysisPath=useMemo(()=>waveformDetail(analysisChannel(a,bounds.start,bounds.end),bounds.start,bounds.end,560,80,1),[a.channels,bounds.start,bounds.end]);
 const moveSelection=(index:number,n:number)=>setSelection(current=>index===0?[Math.max(bounds.start,Math.min(current[1]-1,Math.round(n))),current[1]]:[current[0],Math.min(bounds.end,Math.max(current[0]+1,Math.round(n)))]);
 const fine=(a.rootMidi-original.current.rootMidi)*100;
 const root=hzForMidi(a.rootMidi), deviation=analysis?.hz?centsBetween(analysis.hz,root):undefined;
 const pointPath=analysis?.points.map((p,i)=>p.hz?`${i===0||!analysis.points[i-1].hz?'M':'L'}${i*560/Math.max(1,analysis.points.length-1)},${50-Math.max(-40,Math.min(40,centsBetween(p.hz,analysis.hz!)))*.9}`:'').join('');
 const number=(label:string,value:number,change:(n:number)=>void,step=.001)=><AnalysisNumber key={label} label={label} value={value} change={change} step={step}/>;
 const results=(<>
  <h3 id="analysisResultTitle">Pitch and loop results</h3>
  {analysis&&<><p role="status">{analysis.hz?`Detected ${noteName(midiForHz(analysis.hz))} · ${analysis.spread>8?'pitch varies through the recording':'steady pitch'}`:'No reliable musical pitch found. Set the original note manually.'}</p>
  <details><summary>Measurement details</summary><p role="status">{analysis.hz?`${analysis.hz.toFixed(4)} Hz · ${(analysis.confidence*100).toFixed(0)}% confidence · ${analysis.spread.toFixed(2)} cents variation · ${deviation!>=0?'+':''}${deviation?.toFixed(2)} cents from current anchor`:'No reliable single pitch detected.'}</p>
  <svg className="sampler-pitch-trace" viewBox="0 0 560 100" role="img" aria-label="Pitch trace, cents relative to the measured median"><line x1="0" y1="50" x2="560" y2="50"/><path d={pointPath}/><text x="4" y="14">+40 cents</text><text x="4" y="96">−40 cents · gaps indicate uncertain pitch</text></svg>
</details>
  {analysis.warnings.map(w=><p className="panel-note" key={w}>{w}</p>)}
  <button disabled={!analysis.hz||analysis.confidence<.7} onClick={()=>{onChange({rootMidi:midiForHz(analysis.hz!)});}}>Set original pitch from measurement</button>
  <details><summary>Retune audio…</summary><p>This changes playback speed and duration to match the reference pitch. Setting the original pitch above only tells the sampler how the recording is tuned.</p>  <button disabled={!analysis.hz||analysis.confidence<.7||analysis.spread>8} onClick={()=>{try{onChange(retuneRecording(a,analysis.hz!,target));}catch(error){setMessage(String(error));return;}setAnalysis(undefined);setLoops([]);setMessage('Tuning correction will be rendered by export. Original PCM is preserved; compare Original and Edited or Undo.');}}>Retune recording to target on export</button></details></>}
  {loops.map(candidate=><article className="sampler-loop-candidate" key={candidate.style}><strong>{candidate.style} loop</strong><p>{((candidate.end-candidate.start)/a.rate*1000).toFixed(0)} ms · {candidate.analysis.hz&&candidate.analysis.confidence>=.7?(Math.abs(candidate.changeCents??0)>2?'Check tuning after applying':'Pitch stays close to source'):'Check pitch by ear'}</p>
   <button onClick={()=>{void audition.current?.play({...a,mode:a.mode===3?3:1,loopStart:candidate.start,loopEnd:candidate.end,crossfade:candidate.crossfade},target,'sample',true).catch(e=>setMessage(String(e)));}}>Hear {candidate.style.toLowerCase()} loop</button>
   <button onClick={()=>onChange({mode:a.mode===3?3:1,loopStart:candidate.start,loopEnd:candidate.end,crossfade:candidate.crossfade})}>Use {candidate.style.toLowerCase()} loop</button>
   <details><summary>Loop tuning details</summary><p>Seam score {candidate.seam.toFixed(4)} · {candidate.crossfade.toFixed(1)} ms crossfade · {candidate.analysis.hz?`${candidate.analysis.hz.toFixed(4)} Hz / ${candidate.changeCents!.toFixed(2)} cents from source`:'pitch uncertain'}</p><button disabled={!candidate.analysis.hz||candidate.analysis.confidence<.7} onClick={()=>onChange({mode:a.mode===3?3:1,loopStart:candidate.start,loopEnd:candidate.end,crossfade:candidate.crossfade,rootMidi:midiForHz(candidate.analysis.hz!)})}>Use {candidate.style.toLowerCase()} loop &amp; measured anchor</button></details>
  </article>)}
  {analysis&&lastOperation.current==='analyze'&&!loops.length&&<p className="panel-note">No automatic loop candidates for this result. Try a longer, more stable selection, or use the manual loop editor.</p>}
  {message&&<p role="status">{message}</p>}
 </>);
 return <fieldset className="sampler-analysis"><legend>Pitch &amp; listening</legend>
  <details><summary>Analysis region</summary>  <div className="sampler-fields">{number('Analysis start (s)',selection[0]/a.rate,n=>setSelection([Math.round(n*a.rate),selection[1]]))}{number('Analysis end (s)',selection[1]/a.rate,n=>setSelection([selection[0],Math.round(n*a.rate)]))}
</div></details>
  <div className="sampler-fields">
  <button disabled={busy||!valid} onClick={()=>run('analyze')}>{busy?'Analyzing…':'Analyze pitch & suggest loops'}</button>{busy&&<button onClick={()=>{worker.current?.terminate();worker.current=undefined;setBusy(false);}}>Cancel analysis</button>}
  <button disabled={busy||![1,3].includes(a.mode??0)} onClick={()=>run('verify')}>Verify rendered loop tuning</button></div>
  {!sharedSelection&&<svg className="sampler-analysis-range" viewBox="0 0 560 80" role="group" aria-label="Pitch analysis selection">
    <path d={analysisPath}/><rect x={(selection[0]-bounds.start)*560/(bounds.end-bounds.start)} width={Math.max(0,(selection[1]-selection[0])*560/(bounds.end-bounds.start))} height="80"/>
    {selection.map((frame,index)=><g key={index} role="slider" tabIndex={0} aria-label={index?'Analysis end handle':'Analysis start handle'} aria-valuenow={frame} aria-valuemin={bounds.start} aria-valuemax={bounds.end}
      onKeyDown={event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();moveSelection(index,frame+(event.key==='ArrowLeft'?-1:1)*(event.shiftKey?100:1));}}}
      onPointerDown={event=>event.currentTarget.setPointerCapture(event.pointerId)}
      onPointerMove={event=>{if(!event.currentTarget.hasPointerCapture(event.pointerId))return;const rect=event.currentTarget.ownerSVGElement!.getBoundingClientRect();moveSelection(index,bounds.start+(event.clientX-rect.left)/rect.width*(bounds.end-bounds.start));}}
      onPointerUp={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}}>
      <line x1={(frame-bounds.start)*560/(bounds.end-bounds.start)} x2={(frame-bounds.start)*560/(bounds.end-bounds.start)} y1="0" y2="80"/><rect x={Math.max(0,Math.min(550,(frame-bounds.start)*560/(bounds.end-bounds.start)-5))} width="10" height="20"/>
    </g>)}
  </svg>}
  <p className="panel-note">Analyze a stable part after the attack. Use the result only when you want to change the original-pitch anchor.</p>
  <button disabled={!analysis} onClick={()=>setResultsOpen(true)}>View analysis results</button>
  {!analysis&&message&&<p role="status">{message}</p>}
  <details><summary>Precise original pitch and reference</summary>  <div className="sampler-fields">{number('Root frequency (Hz)',root,n=>{if(n>0&&n<=22000){onChange({rootMidi:midiForHz(n)});}},.0001)}
  {number('Fine tune anchor (cents)',fine,n=>{if(Math.abs(n)<=1200){onChange({rootMidi:original.current.rootMidi+n/100});}},.1)}
  <button onClick={()=>{onChange({rootMidi:a.rootMidi-12});}}>Anchor − octave</button><button onClick={()=>{onChange({rootMidi:a.rootMidi+12});}}>Anchor + octave</button>
  {number('Target frequency (Hz)',target,n=>{if(n>0&&n<=22000)setTarget(n);},.0001)}
  {!!targets.length&&<label>Tuning key<select aria-label="Tuning key" value="" onChange={e=>{const value=targets[+e.target.value];if(value)setTarget(value.hz);}}><option value="">Choose a key from the tuning editor</option>{targets.map((t,i)=><option key={i} value={i}>{t.name} · {t.hz.toFixed(4)} Hz</option>)}</select></label>}</div>
</details>
  <div className="sampler-fields"><label>Reference note<select aria-label="Reference note" value={Math.max(0,Math.min(127,Math.round(midiForHz(target))))} onChange={e=>setTarget(hzForMidi(+e.target.value))}>{Array.from({length:128},(_,n)=><option key={n} value={n}>{noteName(n)}</option>)}</select></label><label>Compare<select aria-label="Tuning audition version" value={originalVersion?'original':'edited'} onChange={e=>{audition.current?.stop();setOriginalVersion(e.target.value==='original');}}><option value="edited">Edited</option><option value="original">Original on opening analysis</option></select></label>
  <label><input type="checkbox" checked={loopOnly} onChange={e=>setLoopOnly(e.target.checked)}/>Loop-only audition</label>
  <button onClick={()=>play('sample')}>Hear sample</button><button onClick={()=>play('reference')}>Hear reference</button><button onClick={()=>play('together')}>Sample + reference</button><button onClick={()=>play('alternate')}>Alternate sample / reference</button><button onClick={()=>audition.current?.stop()}>Stop tuning audition</button></div>
  <details><summary>How comparison and retuning work</summary>  <p className="panel-note">Reference is a quiet sine at the target frequency. Listen for beating; octave buttons let you correct overtone/octave detection. Auditions stop after eight seconds. Fine cents are relative to the opening anchor. Root changes affect held tuning audition immediately. Correction uses ordinary resampling and changes duration; it does not time-stretch or automatically flatten vibrato, drift or piano stretch tuning.</p></details>

  {inlineResults&&resultsOpen&&<div className="sampler-analysis-results">{results}</div>}
  {resultsOpen&&!inlineResults&&<dialog ref={resultsDialog} className="sampler-review-dialog" aria-labelledby="analysisResultTitle" onCancel={e=>{e.preventDefault();audition.current?.stop();setResultsOpen(false);}}>{results}<button onClick={()=>{audition.current?.stop();setResultsOpen(false);}}>Close results</button></dialog>}

 </fieldset>;
}
