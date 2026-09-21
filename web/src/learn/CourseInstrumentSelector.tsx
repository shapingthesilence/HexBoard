import { useEffect, useRef, useState } from "react";
import type { MidiTransport } from "../midi/types.ts";
import { parseTuningBundleLibrary, type TuningBundle } from "../catalogs/layoutsCatalog.ts";
import { lessonDeviceLibrary } from "./deviceLibrary.ts";
import { ObjectType, type ObjectListRecord } from "../protocol/index.ts";

type InstrumentProps = {current:TuningBundle;bundles:TuningBundle[];transport:MidiTransport;connected:boolean;onApply:(bundle:TuningBundle)=>void};
export function CourseInstrumentSelector({current,bundles,transport,connected,onApply}: InstrumentProps) {
  const [source,setSource]=useState("browser");
  const [browserBundles]=useState(()=>{let saved:TuningBundle[]=[];try{saved=parseTuningBundleLibrary(JSON.parse(localStorage.getItem("hexboard.tuningBundles.v1")??"[]"));}catch{} const candidates=new Map<string,TuningBundle>();for(const item of [...bundles,...saved,current]){const old=candidates.get(item.objectIdHex);candidates.set(item.objectIdHex,old?{...item,layouts:[...new Map([...old.layouts,...item.layouts].map(layout=>[layout.objectIdHex,layout])).values()],scales:[...new Map([...old.scales,...item.scales].map(scale=>[scale.objectIdHex,scale])).values()]}:item);}return [...candidates.values()];});
  const [candidate,setCandidate]=useState(browserBundles.find(item=>item.objectIdHex===current.objectIdHex)??current);
  const [names,setNames]=useState<ObjectListRecord[]>([]);
  const [layoutNames,setLayoutNames]=useState<ObjectListRecord[]>([]);
  const [scaleNames,setScaleNames]=useState<ObjectListRecord[]>([]);
  const [tuningHandle,setTuningHandle]=useState("");
  const [selectedLayouts,setSelectedLayouts]=useState<string[]>(current.layouts.map(item=>item.objectIdHex));
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const generation=useRef(0);
  useEffect(()=>()=>{generation.current++;},[]);
  async function changeSource(value:string){
    const request=++generation.current; setSource(value);setError("");setTuningHandle("");setSelectedLayouts([]);
    if(value==="browser"){setCandidate(browserBundles[0]);setBusy(false);return;}
    setBusy(true);
    try{const next=await lessonDeviceLibrary(transport).tuningNames();if(request===generation.current)setNames(next);}catch(error){if(request===generation.current)setError(String(error));}finally{if(request===generation.current)setBusy(false);}
  }
  async function chooseTuning(value:string){
    setSelectedLayouts([]);setError("");
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
  function toggle(id:string,selected:string[],set:(value:string[])=>void){set(selected.includes(id)?selected.filter(item=>item!==id):[...selected,id]);}
  async function apply(){
    const request=++generation.current;setBusy(true);setError("");
    try{
      let bundle:TuningBundle;
      if(source==="browser"){
        const scale=candidate.scales.find(item=>item.objectIdHex===candidate.activeScaleIdHex)??candidate.scales[0];
        bundle={...candidate,layouts:candidate.layouts.filter(item=>selectedLayouts.includes(item.objectIdHex)),scales:[scale]};
      }
      else{
        const reader=lessonDeviceLibrary(transport), layouts=[],scales=[];
        for(const id of selectedLayouts){const layout=await reader.layout(Number(tuningHandle),layoutNames.find(item=>String(item.handle)===id)!);layouts.push(layout);}
        if(!scaleNames.length)throw new Error("This tuning has no compatible scale definition.");
        scales.push(await reader.scale(scaleNames[0],candidate.tuning.cycleLength));
        bundle={...candidate,layouts,scales};
      }
      if(request!==generation.current)return;
      bundle.activeLayoutIdHex=bundle.layouts[0].objectIdHex;bundle.activeScaleIdHex=bundle.scales[0].objectIdHex;
      onApply(structuredClone(bundle));
    }catch(error){if(request===generation.current)setError(String(error));}finally{if(request===generation.current)setBusy(false);}
  }
  return <div className="courseLibraryChoices">
    <h4>Tuning &amp; layouts</h4><p className="learnMuted">Choose exactly what to include. Selected definitions are copied into the course.</p>
    <label className="learnField">Library<select value={source} disabled={busy} onChange={event=>void changeSource(event.target.value)}><option value="browser">Browser library</option><option value="device" disabled={!connected}>Connected HexBoard library</option></select></label>
    <label className="learnField">Tuning<select disabled={busy} value={source==="browser"?candidate.objectIdHex:tuningHandle} onChange={event=>void chooseTuning(event.target.value)}>{source==="browser"?browserBundles.map(item=><option key={item.objectIdHex} value={item.objectIdHex}>{item.tuning.name}</option>):<><option value="">Choose tuning</option>{names.map(item=><option key={item.handle} value={item.handle}>{item.name}</option>)}</>}</select></label>
    {(source==="browser"||tuningHandle)&&<><fieldset disabled={busy}><legend>Supported layouts</legend>{layouts.map(item=><label className="checkField" key={item.id}><input type="checkbox" checked={selectedLayouts.includes(item.id)} onChange={()=>toggle(item.id,selectedLayouts,setSelectedLayouts)}/>{item.name}</label>)}</fieldset>
    </>}
    <button type="button" disabled={busy||!selectedLayouts.length} onClick={()=>void apply()}>{busy?"Loading…":"Use selected layouts"}</button>
    <p className="learnMuted">Lessons use their written notes, not a selected scale. One internal default is retained only for tuning compatibility.</p>{error&&<p role="alert">{error}</p>}
  </div>;
}
