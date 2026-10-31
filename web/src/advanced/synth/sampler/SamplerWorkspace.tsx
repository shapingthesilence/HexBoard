import {useState,useRef,useEffect,type ReactNode} from 'react';
import type {Recording} from './prepare.mjs';
import {SamplerWaveform} from './SamplerWaveform.tsx';
import {SampleAnalysis,AnalysisNumber,type TuningTarget} from './SampleAnalysis.tsx';
import {WorkspaceDialog} from './WorkspaceDialog.tsx';
import {hzForMidi,midiForHz,sourcePitchWindow} from './analysis.ts';
import {noteName} from './import.mjs';
import {tinyLoop,reduceSampleRate,editPCM,joinEnds,retainedPCM,pcmBytes,type Selection,type ChannelChoice} from './authoring.ts';
import {loopSeam,recordingBounds} from './loopEditing.ts';
import {TuningAudition} from './TuningAudition.ts';
export function SamplerWorkspace({recording:a,onChange,mapping,sound,targets,preparedBytes,stopSignal=0,level=1,onLevel,target="advanced",view:activeView,onViewChange:setView,design:style,cycles,onDesign:setStyle,onCycles:setCycles}:{recording?:Recording;onChange:(change:Partial<Recording>,remember?:boolean)=>void;mapping:ReactNode;sound:ReactNode;targets:TuningTarget[];preparedBytes?:number;stopSignal?:number;level?:number;onLevel?:(n:number)=>void;target?:"classic"|"advanced";view:string;onViewChange:(view:string)=>void;design:"natural"|"tiny";cycles:number;onDesign:(design:"natural"|"tiny")=>void;onCycles:(cycles:number)=>void}){
 const view=activeView;
 const [inspector,setInspector]=useState<'loop'|'tune'>('loop');
 const [suggestedLoop,setSuggestedLoop]=useState<[number,number]>();
 const [overlay,setOverlay]=useState(''),[keepAttack,setKeepAttack]=useState(true),[reducedRate,setReducedRate]=useState(0),[channel,setChannel]=useState<ChannelChoice>('linked'),[tool,setTool]=useState<'select'|'pencil'|'loop'>('select'),[selections,setSelections]=useState<Record<string,Selection>>({}),[candidate,setCandidate]=useState<Partial<Recording>>(),[message,setMessage]=useState('');
 const audition=useRef<TuningAudition|undefined>(undefined);
 useEffect(()=>()=>audition.current?.close(),[]);
 useEffect(()=>{audition.current?.stop();},[stopSignal,a?.name]);
 const selection=selections[a?.id??a?.name??"selected"]??[0,0];
 const setSelection=(range:Selection)=>setSelections(current=>({...current,[a?.id??a?.name??"selected"]:range}));
 const b=a?recordingBounds(a):undefined,range:Selection=a&&selection[1]>selection[0]?selection:[b?.start??0,b?.end??0];
 const operation=(fn:()=>Partial<Recording>)=>{try{onChange(fn(),true);setMessage('');}catch(e){setMessage(String(e));}};
 const optimizeCandidate=(keep:boolean,rate:number)=>{if(!a)return;try{const trim=[1,3].includes(a.mode??0)?retainedPCM(a,keep):{start:a.start??0,end:a.end??a.channels[0].length};const retained={...a,...trim};setCandidate({...trim,...(rate?reduceSampleRate(retained,rate):{})});setMessage('');}catch(e){setCandidate(undefined);setMessage(String(e));}};
 const preview=(change:Partial<Recording>)=>{if(!a)return;audition.current??=new TuningAudition();void audition.current.play({...a,...change},hzForMidi(a.rootMidi),'sample',true).catch(e=>setMessage(String(e)));};
 const openAnalysis=()=>{if(a&&selection[1]<=selection[0])setSelection(sourcePitchWindow(a));setInspector("tune");};
 const close=()=>{audition.current?.stop();setOverlay('');setCandidate(undefined);};
 const seam=a?loopSeam(a):undefined;
 return <section className="sampler-workspace" aria-label="Recording workspace">
 <nav className="sampler-workspace-tabs" aria-label="Workspace views">{[['sample','Sample'],['mapping','Map'],['sound','Sound']].map(([v,label])=><button key={v} aria-pressed={view===v} onClick={()=>setView(v)}>{label}</button>)}<span>{a?.name??'No recording selected'}</span></nav>
 <div className="sampler-workspace-body">
 <div className="sampler-sample-view" hidden={view!=='sample'}>
 {!a?<div className="sampler-empty"><span className="sampler-empty-wave">▁▂▅▇▅▂▁</span><h3>Start with a sound.</h3><p>Add a recording, SoundFont or SFZ instrument above. Audition, shape it, then copy when it feels right.</p><p className="panel-note">Instrument setup chooses voices and sustain character. You can change it at any time.</p></div>:<>
 <div className="sampler-sample-layout"><div className="sampler-sample-header">
 <div className="sampler-workspace-heading"><div><strong>{a.name}</strong><small>{a.channels.length===2?'Stereo':'Mono'} · {(a.rate/1000).toFixed(1)} kHz · {((b!.end-b!.start)/a.rate).toFixed(2)} s</small></div><button onClick={()=>setOverlay('edit')}>Edit audio</button></div>
 <div className="sampler-sample-controls">
 <label>Playback<select aria-label="Playback" value={a.mode??0} onChange={e=>{const mode=+e.target.value as Recording['mode'];onChange({mode,...([1,3].includes(mode??0)?{loopStart:b!.loopStart,loopEnd:b!.loopEnd}:{})});}}><option value={0}>Natural ending</option><option value={1}>Loop through release</option><option value={3}>Loop → recorded tail</option><option value={2}>One shot</option></select></label>
 <div className="sampler-root-field"><AnalysisNumber label="Original pitch (Hz)" value={hzForMidi(a.rootMidi)} step={.001} change={hz=>{if(hz>0&&hz<=22000)onChange({rootMidi:midiForHz(hz)});}}/><small>{noteName(a.rootMidi)}</small></div>
 <label>Level<input aria-label="Recording region level" type="range" min={0} max={1.99} step={.01} value={level} onChange={e=>onLevel?.(+e.target.value)}/></label>
 </div>
 {a.pitchSource==='fallback'&&<p className="sampler-error">Original pitch is uncertain. Open Tune &amp; analyze or enter its frequency.</p>}

</div><div className="sampler-detail-pane">
 <div className="sampler-inspector-tabs" role="group" aria-label="Sample tools"><button aria-pressed={inspector==='loop'} onClick={()=>setInspector('loop')}>Loop</button><button aria-pressed={inspector==='tune'} onClick={openAnalysis}>Tune &amp; analyze</button><span>{[1,3].includes(a.mode??0)?`${((b!.loopEnd-b!.loopStart)/a.rate*1000).toFixed(1)} ms loop`:'Natural ending'}</span></div>
 <div hidden={inspector!=='loop'} className="sampler-loop-inspector">
 <div className="sampler-fields"><label>Sustain character<select aria-label="Loop design" value={style} onChange={e=>setStyle(e.target.value as 'natural'|'tiny')}><option value="natural">Natural · retain movement</option><option value="tiny">Compact · 2–8 cycles</option></select></label>
 {style==='tiny'?<><label>Cycles<select aria-label="Loop cycles" value={cycles} onChange={e=>setCycles(+e.target.value)}>{[2,4,8].map(n=><option key={n} value={n}>{n}</option>)}</select></label><button className="primary" onClick={()=>operation(()=>{const loop=tinyLoop(a,range,cycles);return {...loop,end:loop.loopEnd};})}>Find compact loop</button><button disabled={![1,3].includes(a.mode??0)} onClick={()=>onChange({rootMidi:midiForHz(a.rate*cycles/(b!.loopEnd-b!.loopStart))})}>Tune from cycle count</button></>:<button className="primary" onClick={openAnalysis}>Suggest natural loops</button>}
 <label>Waveform tool<select aria-label="Loop gesture" value={tool} onChange={e=>setTool(e.target.value as typeof tool)}><option value="select">Select / move markers</option><option value="loop">Draw loop</option><option value="pencil">Draw individual frames</option></select></label>
 </div>
 <p className="panel-note">{style==='tiny'?'Choose a stable section. A short loop freezes the texture and keeps the attack up to the loop; Undo restores the previous trim. Tune from cycle count removes frame-rounding detuning when your cycle assumption is correct; it changes the original-pitch anchor.':'Keep a natural ending, or choose a stable sustain and suggest longer loops. Audition each suggestion before applying.'}</p>
 </div>

 <div hidden={inspector!=='loop'}>
 <div className="sampler-fields"><button disabled={![1,3].includes(a.mode??0)} onClick={()=>setOverlay('join')}>Repair seam</button><button onClick={()=>{optimizeCandidate(keepAttack,0);setReducedRate(0);setOverlay('optimize');}} disabled={target!=='classic'&&![1,3].includes(a.mode??0)}>Keep attack / loop only</button><button onClick={()=>setOverlay('details')}>Recording information</button></div>
 </div>
 <div hidden={inspector!=='tune'}>{suggestedLoop&&<p className="panel-note">Blue outline: suggestion · gold markers: saved loop. Applying a suggestion is separate from audition.</p>}<SampleAnalysis key={a.id??a.name} recording={a} onChange={onChange} targets={targets} stopSignal={stopSignal} sharedSelection={selection[1]>selection[0]?selection:sourcePitchWindow(a)} onSelection={setSelection} inlineResults onSuggestion={setSuggestedLoop}/></div>
</div><div className="sampler-wave-pane">
 <SamplerWaveform recording={a} onChange={onChange} selection={range} onSelection={setSelection} tool={tool} channel={channel} loopToolsVisible suggestedLoop={inspector==='tune'?suggestedLoop:undefined}/>
</div></div>
 </>}
 </div><div hidden={view!=='mapping'}>{mapping}</div><div hidden={view!=='sound'}>{sound}</div>
 </div><div className="sampler-workspace-status" role="status">{message||'Selected recording and audition stay with you across Sample, Map and Sound. Changes can be undone.'}</div>
 {a&&overlay&&<WorkspaceDialog title={overlay==='edit'?'Edit selected audio':overlay==='join'?'Join loop ends':overlay==='details'?'Recording details':'Optimize retained audio'} onClose={close}>
 {overlay==='details'&&<><p>{a.channels.length===2?'Stereo':'Mono'} · {a.rate.toLocaleString()} Hz · {((a.end??a.channels[0].length)-(a.start??0)).toLocaleString()} retained frames · {(pcmBytes(a)/1024).toFixed(1)} KiB PCM</p>{[1,3].includes(a.mode??0)&&<p>Loop {b!.loopEnd-b!.loopStart} frames · cycle-based estimate {(a.rate*cycles/(b!.loopEnd-b!.loopStart)).toFixed(3)} Hz ({cycles} assumed cycles) · seam mismatch {(seam!.jump*100).toFixed(2)}%. These describe loop construction, not detected musical pitch.</p>}<p>Original pitch {hzForMidi(a.rootMidi).toFixed(4)} Hz{a.pitchConfidence!==undefined?` · source periodicity ${(a.pitchConfidence*100).toFixed(0)}% · ${(a.pitchVariation??0).toFixed(1)} cents variation`:''}. Periodicity is an estimate of waveform repetition, not a guarantee of the correct note.</p>{preparedBytes!==undefined&&<p>Last prepared instrument: {(preparedBytes/1024).toFixed(1)} KiB, including its other recordings and generated pitch copies.</p>}</>}
 {overlay==='edit'&&<><p>Select an area on the waveform, or use the current trim. Pencil editing is available at individual-frame zoom.</p><label>Channels<select value={channel} onChange={e=>setChannel(e.target.value==='linked'?'linked':+e.target.value as 0|1)}><option value="linked">Linked channels</option><option value="0">Left / mono</option>{a.channels.length===2&&<option value="1">Right</option>}</select></label>{(['dc','normalize','smooth'] as const).map(op=><button key={op} onClick={()=>operation(()=>editPCM(a,range,op,channel))}>{op==='dc'?'Remove DC':op==='normalize'?'Normalize selection':'Smooth selected points'}</button>)}<button onClick={()=>operation(()=>editPCM(a,range,'scale',channel,.8))}>Level −20%</button><button onClick={()=>operation(()=>editPCM(a,range,'scale',channel,1.25))}>Level +25%</button><button onClick={()=>{setTool('pencil');close();}}>Use pencil</button></>}
 {overlay==='join'&&<><p>Compare a nearby seam adjustment with smoothing. Smoothing preserves loop length.</p><button onClick={()=>{const c=joinEnds(a,'move',channel);setCandidate(c);preview(c);}}>Preview boundary adjustment</button><button onClick={()=>{const c=joinEnds(a,'smooth',channel);setCandidate(c);preview(c);}}>Preview smoothing</button>{candidate&&<p>Candidate seam {(loopSeam({...a,...candidate}).jump*100).toFixed(2)}% · {recordingBounds({...a,...candidate}).loopEnd-recordingBounds({...a,...candidate}).loopStart} frames</p>}</>}
 {overlay==='optimize'&&<><label>Retain<select value={![1,3].includes(a.mode??0)?'attack':keepAttack?'attack':'loop'} onChange={e=>{const k=e.target.value==='attack';setKeepAttack(k);optimizeCandidate(k,reducedRate);}}><option value="attack">{[1,3].includes(a.mode??0)?'Keep attack + loop':'Keep trimmed recording'}</option>{[1,3].includes(a.mode??0)&&<option value="loop">Loop only</option>}</select></label>{target==='classic'&&a.rate>8000&&<label>Sample rate<select aria-label="Optimize sample rate" value={reducedRate} onChange={e=>{const r=+e.target.value;setReducedRate(r);optimizeCandidate(keepAttack,r);}}><option value={0}>Keep original</option>{[32000,22050,16000,11025,8000].filter(r=>r<a.rate).map(r=><option key={r} value={r}>{(r/1000).toFixed(r%1000?3:0)} kHz · filtered</option>)}</select></label>}<p>{(pcmBytes(a)/1024).toFixed(1)} → {(pcmBytes({...a,...candidate})/1024).toFixed(1)} KiB retained PCM. Prepared export determines the final package size. {[1,3].includes(a.mode??0)&&"This removes the trailing tail."}{reducedRate>0&&<> High harmonics are conservatively filtered before downsampling.{[1,3].includes(a.mode??0)&&" The exact loop rate preserves its pitch."}</>}</p><button onClick={()=>preview({})}>Hear original</button><button disabled={!candidate} onClick={()=>preview(candidate??{})}>Preview retained audio</button></>}
 {(overlay==='join'||overlay==='optimize')&&<button disabled={!candidate} onClick={()=>{if(candidate)onChange(candidate,true);close();}}>Apply edit</button>}
 {message&&<p role="status">{message}</p>}
 </WorkspaceDialog>}
 </section>;
}
