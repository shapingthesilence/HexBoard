import {useState,type ReactNode} from 'react';
import {effectTypes,effectDescription,type FxRack} from './schema.ts';
import {Knob} from './SynthControls.tsx';
import {VolumeStepEditor} from './VolumeStepEditor.tsx';
export function FxRackEditor({rack,busy=false,waiting=false,onChange,before,available=[1,2,3,4]}:{rack:FxRack;busy?:boolean;waiting?:boolean;onChange:(rack:FxRack,reorder?:boolean)=>void;before?:ReactNode;available?:number[]}){
 const choices=effectTypes.filter(f=>available.includes(f.id));
 const [addingFx,setAddingFx]=useState(false),[dragFx,setDragFx]=useState<number>(),[stepEditor,setStepEditor]=useState(false);
 const setEffects=(rack:FxRack)=>onChange(rack,true),setRackControls=(rack:FxRack)=>onChange(rack);
 const moveEffect=(id:number,before:number,after=false)=>{const order=rack.order.filter(v=>v!==id);order.splice(order.indexOf(before)+(after?1:0),0,id);setEffects({...rack,order});};
 return <><aside className="fx-rack" aria-label="Effect rack">
      <header><h3>FX rack</h3><button aria-label="Add effect" disabled={busy||rack.order.length>=choices.length} onClick={()=>setAddingFx(!addingFx)}>＋</button></header>
      <small>{waiting?"Applying after adjustments settle…":"Signal flows from top to bottom"}</small>
      {before}
      {addingFx && <div className="fx-add-menu">{choices.filter(f=>!rack.order.includes(f.id)).map(f=><button key={f.id} onClick={()=>{setEffects({...rack,order:[...rack.order,f.id]});setAddingFx(false);}}>{f.name}</button>)}</div>}
      {!rack.order.length && <p className="panel-note">Add an effect to shape your sound.</p>}
      {rack.order.map((id,index)=>{const f=effectTypes[id-1];return <section className={`fx-card ${dragFx===id?"dragging":""}`} key={id} data-effect={id} onDragOver={e=>{if(dragFx!==undefined)e.preventDefault();}} onDrop={e=>{e.preventDefault();if(dragFx!==undefined&&dragFx!==id)moveEffect(dragFx,id);setDragFx(undefined);}}>
        <header onPointerDown={e=>{if(busy || (e.target as HTMLElement).closest("button"))return;setDragFx(id);e.currentTarget.setPointerCapture(e.pointerId);}} onPointerUp={e=>{if(!e.currentTarget.hasPointerCapture(e.pointerId))return;e.currentTarget.releasePointerCapture(e.pointerId);const target=document.elementFromPoint(e.clientX,e.clientY)?.closest("[data-effect]");const before=Number(target?.getAttribute("data-effect"));if(before&&before!==id){const rect=target!.getBoundingClientRect();moveEffect(id,before,e.clientY>rect.top+rect.height/2);}setDragFx(undefined);}} onPointerCancel={()=>setDragFx(undefined)} onDragStart={e=>{setDragFx(id);e.dataTransfer.setData("text/plain",String(id));e.dataTransfer.effectAllowed="move";}} onDragEnd={()=>setDragFx(undefined)}><span className="fx-grip" aria-hidden="true">⠿</span><strong>{f.name}</strong>
          <button aria-label={`Move ${f.name} up`} disabled={busy||index===0} onClick={()=>moveEffect(id,rack.order[index-1])}>↑</button>
          <button aria-label={`Move ${f.name} down`} disabled={busy||index===rack.order.length-1} onClick={()=>{const order=[...rack.order];[order[index],order[index+1]]=[order[index+1],order[index]];setEffects({...rack,order});}}>↓</button>
          <button aria-label={`Remove ${f.name}`} disabled={busy} onClick={()=>setEffects({...rack,order:rack.order.filter(v=>v!==id)})}>×</button>
        </header><div className="fx-controls">{f.controls.map((label,param)=><div className="physical-control" key={label}><strong>{label}</strong><Knob label={`${f.name} ${label}`} value={rack.values[id-1][param]} disabled={busy} onChange={value=>{const values=rack.values.map(row=>[...row]);values[id-1][param]=Math.round(value);setRackControls({...rack,values});}}/><output>{effectDescription(id,param,rack.values[id-1][param])}</output></div>)}</div>{id===1&&<label className="fx-character">Character<select aria-label="Distortion character" value={rack.values[0][2]} disabled={busy} onChange={e=>{const values=rack.values.map(row=>[...row]);values[0][2]=Number(e.target.value);setRackControls({...rack,values});}}>{["Warm","Clip","Fold","Diode","Crush"].map((name,i)=><option key={name} value={i}>{name}</option>)}</select></label>}{id===3&&<button type="button" className="step-open" disabled={busy} onClick={()=>setStepEditor(true)} aria-label="Edit volume sequence"><span className="step-mini" aria-hidden="true">{rack.steps.slice(0,1+(rack.values[2][3]&15)).map((v,i)=><i key={i} style={{height:`${Math.max(5,v/65535*100)}%`}}/>)}</span><span>Edit sequence…</span></button>}
      </section>;})}
      <footer className="panel-note">One of each effect · limiter after rack</footer>
    </aside>{stepEditor&&<VolumeStepEditor rack={rack} onChange={setRackControls} onClose={()=>setStepEditor(false)}/>}</>;
}
