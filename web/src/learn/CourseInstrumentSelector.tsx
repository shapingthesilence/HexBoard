import { useEffect, useRef, useState } from "react";
import type { MidiTransport } from "../midi/types.ts";
import { parseTuningBundleLibrary, type TuningBundle } from "../catalogs/layoutsCatalog.ts";
import { lessonDeviceLibrary } from "./deviceLibrary.ts";
import { ObjectType, type ObjectListRecord } from "../protocol/index.ts";

type InstrumentProps = {current:TuningBundle;requiredLayout?:string;bundles:TuningBundle[];transport:MidiTransport;connected:boolean;onApply:(bundle:TuningBundle,required?:string)=>void};
export function CourseInstrumentSelector(props: InstrumentProps) {
  const [open,setOpen]=useState(false);
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{if(open)dialog.current?.showModal();},[open]);
  return <><button type="button" onClick={()=>setOpen(true)}>Tuning, layouts &amp; scales…</button>
    {open&&<dialog ref={dialog} className="courseLibraryDialog" aria-labelledby="course-library-heading" onCancel={()=>setOpen(false)} onClose={()=>setOpen(false)}>
      <header className="learnPracticeHeader"><h2 id="course-library-heading">Tuning, layouts &amp; scales</h2><button type="button" onClick={()=>setOpen(false)} aria-label="Close tuning selection">Close</button></header>
      <InstrumentChoices {...props} onApply={(bundle,required)=>{props.onApply(bundle,required);setOpen(false);}} />
    </dialog>}
  </>;
}
function InstrumentChoices({current,requiredLayout,bundles,transport,connected,onApply}: InstrumentProps) {
  const [source,setSource]=useState("browser");
  const [browserBundles]=useState(()=>{let saved:TuningBundle[]=[];try{saved=parseTuningBundleLibrary(JSON.parse(localStorage.getItem("hexboard.tuningBundles.v1")??"[]"));}catch{} const candidates=new Map<string,TuningBundle>();for(const item of [...bundles,...saved,current]){const old=candidates.get(item.objectIdHex);candidates.set(item.objectIdHex,old?{...item,layouts:[...new Map([...old.layouts,...item.layouts].map(layout=>[layout.objectIdHex,layout])).values()],scales:[...new Map([...old.scales,...item.scales].map(scale=>[scale.objectIdHex,scale])).values()]}:item);}return [...candidates.values()];});
  const [candidate,setCandidate]=useState(browserBundles.find(item=>item.objectIdHex===current.objectIdHex)??current);
  const [names,setNames]=useState<ObjectListRecord[]>([]);
  const [layoutNames,setLayoutNames]=useState<ObjectListRecord[]>([]);
  const [scaleNames,setScaleNames]=useState<ObjectListRecord[]>([]);
  const [tuningHandle,setTuningHandle]=useState("");
  const [selectedLayouts,setSelectedLayouts]=useState<string[]>(current.layouts.map(item=>item.objectIdHex));
  const [selectedScales,setSelectedScales]=useState<string[]>(current.scales.map(item=>item.objectIdHex));
  const [required,setRequired]=useState(requiredLayout??"");
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const generation=useRef(0);
  useEffect(()=>()=>{generation.current++;},[]);
  async function changeSource(value:string){
    const request=++generation.current; setSource(value);setError("");setTuningHandle("");setSelectedLayouts([]);setSelectedScales([]);setRequired("");
    if(value==="browser"){setCandidate(browserBundles[0]);setBusy(false);return;}
    setBusy(true);
    try{const next=await lessonDeviceLibrary(transport).tuningNames();if(request===generation.current)setNames(next);}catch(error){if(request===generation.current)setError(String(error));}finally{if(request===generation.current)setBusy(false);}
  }
  async function chooseTuning(value:string){
    setSelectedLayouts([]);setSelectedScales([]);setRequired("");setError("");
    if(source==="browser"){setCandidate(browserBundles.find(item=>item.objectIdHex===value)!);return;}
    const request=++generation.current;setTuningHandle(value);setBusy(true);
    try{
      const reader=lessonDeviceLibrary(transport), record=names.find(item=>String(item.handle)===value)!;
      const bundle=await reader.tuning(record);
      bundle.palette=await reader.palette(record.handle,bundle.tuning.cycleLength);
      const layouts=await reader.names(ObjectType.UserLayout,record.handle);
      const scales=await reader.names(ObjectType.UserScale,record.handle);
      if(request!==generation.current)return;
      setCandidate(bundle);setLayoutNames(layouts);setScaleNames(scales);
    }catch(error){if(request===generation.current)setError(String(error));}finally{if(request===generation.current)setBusy(false);}
  }
  const layouts=source==="browser"?candidate.layouts.map(item=>({id:item.objectIdHex,name:item.name})):layoutNames.map(item=>({id:String(item.handle),name:item.name}));
  const scales=source==="browser"?candidate.scales.map(item=>({id:item.objectIdHex,name:item.name})):scaleNames.map(item=>({id:String(item.handle),name:item.name}));
  function toggle(id:string,selected:string[],set:(value:string[])=>void){set(selected.includes(id)?selected.filter(item=>item!==id):[...selected,id]);if(required===id)setRequired("");}
  async function apply(){
    const request=++generation.current;setBusy(true);setError("");
    try{
      let bundle:TuningBundle;
      let requiredId=required||undefined;
      if(source==="browser")bundle={...candidate,layouts:candidate.layouts.filter(item=>selectedLayouts.includes(item.objectIdHex)),scales:candidate.scales.filter(item=>selectedScales.includes(item.objectIdHex))};
      else{
        const reader=lessonDeviceLibrary(transport), layouts=[],scales=[];
        for(const id of selectedLayouts){const layout=await reader.layout(Number(tuningHandle),layoutNames.find(item=>String(item.handle)===id)!);layouts.push(layout);if(id===required)requiredId=layout.objectIdHex;}
        for(const id of selectedScales)scales.push(await reader.scale(scaleNames.find(item=>String(item.handle)===id)!,candidate.tuning.cycleLength));
        bundle={...candidate,layouts,scales};
      }
      if(request!==generation.current)return;
      bundle.activeLayoutIdHex=requiredId??bundle.layouts[0].objectIdHex;bundle.activeScaleIdHex=bundle.scales[0].objectIdHex;
      onApply(structuredClone(bundle),requiredId);
    }catch(error){if(request===generation.current)setError(String(error));}finally{if(request===generation.current)setBusy(false);}
  }
  return <div className="courseLibraryChoices">
    <p className="learnMuted">Choose exactly what to include. Selected definitions are copied into the course.</p>
    <label className="learnField">Library<select value={source} disabled={busy} onChange={event=>void changeSource(event.target.value)}><option value="browser">Browser library</option><option value="device" disabled={!connected}>Connected HexBoard library</option></select></label>
    <label className="learnField">Tuning<select disabled={busy} value={source==="browser"?candidate.objectIdHex:tuningHandle} onChange={event=>void chooseTuning(event.target.value)}>{source==="browser"?browserBundles.map(item=><option key={item.objectIdHex} value={item.objectIdHex}>{item.tuning.name}</option>):<><option value="">Choose tuning</option>{names.map(item=><option key={item.handle} value={item.handle}>{item.name}</option>)}</>}</select></label>
    {(source==="browser"||tuningHandle)&&<><fieldset disabled={busy}><legend>Supported layouts</legend>{layouts.map(item=><label className="checkField" key={item.id}><input type="checkbox" checked={selectedLayouts.includes(item.id)} onChange={()=>toggle(item.id,selectedLayouts,setSelectedLayouts)}/>{item.name}</label>)}</fieldset>
    <label className="learnField">Require one layout<select value={required} disabled={busy} onChange={event=>setRequired(event.target.value)}><option value="">Learner can choose</option>{layouts.filter(item=>selectedLayouts.includes(item.id)).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <fieldset disabled={busy}><legend>Included scales</legend>{scales.map(item=><label className="checkField" key={item.id}><input type="checkbox" checked={selectedScales.includes(item.id)} onChange={()=>toggle(item.id,selectedScales,setSelectedScales)}/>{item.name}</label>)}</fieldset></>}
    <button type="button" disabled={busy||!selectedLayouts.length||!selectedScales.length} onClick={()=>void apply()}>{busy?"Loading…":"Use selected items"}</button>
    <p className="learnMuted">Include at least one layout and scale. Only selected device definitions are downloaded.</p>{error&&<p role="alert">{error}</p>}
  </div>;
}
