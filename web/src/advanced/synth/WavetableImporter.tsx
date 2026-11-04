import {useEffect,useRef,useState} from 'react';
import type {PreparedTable,TableOptions} from './wavetable/prepare.mjs';
import {putTable,type TableAsset} from './wavetable/library.ts';
import {CanvasPlot,strokeWave} from './CanvasPlot.tsx';
export function WavetableImporter({initial,onUse,onClose}:{initial?:TableAsset;onUse:(asset:TableAsset)=>void|Promise<void>;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),generation=useRef(0);
 const [source,setSource]=useState<{name:string;bytes:Uint8Array}|undefined>(()=>initial?{name:initial.name,bytes:initial.source}:undefined);
 const [name,setName]=useState(initial?`${initial.name.slice(0,74)} copy`:''),[options,setOptions]=useState<TableOptions>(initial?.options??{}),[result,setResult]=useState<PreparedTable>(),[error,setError]=useState(''),[working,setWorking]=useState(false),[saving,setSaving]=useState(false),[frame,setFrame]=useState(0);
 useEffect(()=>{dialog.current?.showModal();},[]);
 useEffect(()=>{const id=++generation.current;if(!source)return;setWorking(true);setError('');const worker=new Worker(new URL('./wavetable/prepare.worker.ts',import.meta.url),{type:'module'});
  const timer=setTimeout(()=>{worker.postMessage({id,bytes:source.bytes,options});},100);
  worker.onmessage=({data})=>{if(id!==generation.current)return;setWorking(false);if(data.error)setError(data.error);else setResult(data.result);};
  worker.onerror=()=>{if(id===generation.current){setWorking(false);setError('Could not prepare the table. Try a smaller WAV file.');}};
  return()=>{clearTimeout(timer);worker.terminate();};
 },[source,options]);
 const update=(patch:Partial<TableOptions>)=>{setWorking(true);setError('');setOptions(o=>({...o,...patch}));};
 const load=async(file?:File)=>{if(!file)return;try {if(file.size>32*1024*1024)throw Error('Choose a WAV smaller than 32 MB.');const bytes=new Uint8Array(await file.arrayBuffer());setWorking(true);setResult(undefined);setSource({name:file.name,bytes});setName(file.name.replace(/\.wav$/i,''));setOptions({});setFrame(0);}catch(e){setError(e instanceof Error?e.message:String(e));}};
 const use=async()=>{if(!source||!result||working||error||!name.trim())return;setSaving(true);try {const asset:TableAsset={id:crypto.randomUUID(),name:name.trim(),source:source.bytes,options,prepared:result.bytes,crc:result.crc};await putTable(asset);await onUse(asset);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setSaving(false);}};
 const original=result?Array.from({length:256},(_,i)=>{const p=(options.firstFrame??0)+((options.lastFrame??result.source.frames-1)-(options.firstFrame??0))*frame/15,f=Math.round(p),at=f*result.source.frameSize;return result.source.samples[at+Math.floor(i*result.source.frameSize/256)]??0;}):[];
 const prepared=result?Array.from(result.preview.subarray(frame*1024,(frame+1)*1024)):[];
 const scale=Math.max(1e-6,...original.map(Math.abs),...prepared.map(Math.abs));
 return <dialog ref={dialog} className="wt-import-dialog" aria-labelledby="wt-import-title" onCancel={e=>{e.preventDefault();if(!saving)onClose();}}>
  <header><h3 id="wt-import-title">Import wavetable</h3><button type="button" aria-label="Close table importer" disabled={saving} onClick={onClose}>×</button></header>
  <p className="panel-note">WAV tables exported from Serum or Vital work directly. Your source stays in the browser so you can change these choices later.</p>
  <label className="wt-source-file">Choose WAV<input type="file" accept=".wav,audio/wav,audio/x-wav" disabled={saving} onChange={e=>{void load(e.target.files?.[0]);e.target.value='';}}/></label>
  {source&&<><label className="wt-table-name">Name<input maxLength={80} value={name} disabled={saving} onChange={e=>setName(e.target.value)}/></label>
   <div className="wt-import-preview" aria-busy={working}>
    <CanvasPlot className="wt-import-scope" width={640} height={210} role="img" aria-label={`Source and prepared waveform, frame ${frame+1} of 16`} paint={(ctx,c)=>{ctx.lineWidth=1.4;ctx.strokeStyle=c.frame;ctx.setLineDash([5,4]);strokeWave(ctx,original,12,105,616,88,scale);ctx.stroke();ctx.setLineDash([]);ctx.strokeStyle=c.trace;ctx.lineWidth=2;strokeWave(ctx,prepared,12,105,616,88,scale);ctx.stroke();}}/>
    <div className="wt-preview-legend"><span>Dashed: source frame {result?Math.round((options.firstFrame??0)+((options.lastFrame??result.source.frames-1)-(options.firstFrame??0))*frame/15)+1:1}</span><span>Solid: prepared</span><output aria-live="polite">{working?'Preparing…':result?`${result.source.frames} source frames → 16 playable frames`:''}</output></div>
    <label>Preview frame <input type="range" min={0} max={15} step={1} value={frame} onChange={e=>setFrame(+e.target.value)}/><output>{frame+1} / 16</output></label>
   </div>
   <label>Frame reduction<select value={options.reduction??'blend'} disabled={saving} onChange={e=>update({reduction:e.target.value as TableOptions['reduction']})}><option value="blend">Blend neighboring frames</option><option value="nearest">Keep nearest source frames</option><option value="spectral">Morph harmonic shape and phase</option></select></label>
   <details><summary>More options</summary><div className="wt-import-options">
    <label>Samples per source frame<select value={options.frameSize??0} disabled={saving} onChange={e=>update({frameSize:+e.target.value||undefined,firstFrame:undefined,lastFrame:undefined})}><option value={0}>Auto (metadata / Serum–Vital)</option>{[32,64,128,256,512,1024,2048,4096,8192].map(n=><option key={n} value={n}>{n}</option>)}</select></label>
    <div className="wt-frame-range"><label>First source frame<input type="number" min={1} max={result?.source.frames??2048} value={(options.firstFrame??0)+1} onChange={e=>update({firstFrame:Math.max(0,+e.target.value-1)})}/></label><label>Last source frame<input type="number" min={1} max={result?.source.frames??2048} value={(options.lastFrame??(result?.source.frames??1)-1)+1} onChange={e=>update({lastFrame:Math.max(0,+e.target.value-1)})}/></label></div>
    <label>Stereo source<select value={options.channel??'left'} onChange={e=>update({channel:e.target.value as TableOptions['channel']})}><option value="left">Left channel</option><option value="right">Right channel</option><option value="mix">Mix to mono</option></select></label>
    <label>Level<select value={options.normalization??'table'} onChange={e=>update({normalization:e.target.value as TableOptions['normalization']})}><option value="table">Normalize whole table</option><option value="preserve">Keep source level</option></select></label>
    <label><input type="checkbox" checked={options.removeDc!==false} onChange={e=>update({removeDc:e.target.checked})}/>Remove DC offset</label>
    <label><input type="checkbox" checked={!!options.alignPhase} onChange={e=>update({alignPhase:e.target.checked})}/>Align fundamental phase</label>
    <label><input type="checkbox" checked={!!options.smoothFrames} onChange={e=>update({smoothFrames:e.target.checked})}/>Smooth between frames</label>
   </div><p className="panel-note">Alignment can reduce cancellations when blending. Keep it off to preserve an already phase-aligned table. Brightness and pitch protection work automatically.</p></details>
   {!working&&!error&&result?.warnings.map(w=><p className="panel-note" key={w}>{w}</p>)}
  </>}
  {error&&<p className="error" role="alert">{error}</p>}
  <footer><button type="button" disabled={saving} onClick={onClose}>Cancel</button><button type="button" disabled={!result||!source||working||saving||!!error||!name.trim()} onClick={()=>void use()}>{saving?'Saving…':'Use table'}</button></footer>
 </dialog>;
}
