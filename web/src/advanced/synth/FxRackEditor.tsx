import {FilterResponse} from './FilterResponse.tsx';
import {moveFx,removeFx} from './fxRouting.ts';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {effectTypes,ensembleVoices,type FxRack} from './schema.ts';
import {FxModControl,type FxTargeting} from './FxModControl.tsx';
import {VolumeStepEditor} from './VolumeStepEditor.tsx';

/** A drag in progress: the effect being moved and the slot it would land in among the others. */
interface FxDrag {id:number;slot?:number}

export function FxRackEditor({rack,busy=false,waiting=false,onChange,before,available=[1,2,3,4,5,6],canApply=()=>true,onPreview,targeting}:{rack:FxRack;busy?:boolean;waiting?:boolean;onChange:(rack:FxRack,reorder?:boolean)=>void;before?:ReactNode;available?:number[];canApply?:(rack:FxRack)=>boolean;onPreview?:(rack?:FxRack)=>void;targeting?:FxTargeting}){
 const [localSource,setLocalSource]=useState(-1);
 const editTarget=targeting??{tool:localSource<0?'value' as const:'modulate' as const,source:localSource,values:[],finish:()=>setLocalSource(-1)};
 const choices=effectTypes.filter(f=>available.includes(f.id)),unused=choices.filter(f=>!rack.order.includes(f.id));
 const [addingFx,setAddingFx]=useState(false),[drag,setDrag]=useState<FxDrag>(),[stepEditor,setStepEditor]=useState(false);
 const chain=useRef<HTMLOListElement>(null);
 const setEffects=(rack:FxRack)=>onChange(rack,true),setRackControls=(rack:FxRack)=>onChange(rack);
 const moveTo=(id:number,slot:number)=>{const order=moveFx(rack.order,id,slot);if(order.some((v,i)=>v!==rack.order[i]))setEffects({...rack,order});};
 // The slot counts the other cards whose middle sits above the pointer.
 const slotAt=(id:number,y:number)=>Array.from(chain.current?.querySelectorAll<HTMLElement>('[data-effect]')??[]).filter(card=>Number(card.dataset.effect)!==id).filter(card=>{const r=card.getBoundingClientRect();return r.top+r.height/2<y;}).length;
 // Show the line only where a drop would change the order.
 const target=drag?.slot===undefined?undefined:moveFx(rack.order,drag.id,drag.slot);
 const changes=target?.some((v,i)=>v!==rack.order[i]);
 const others=drag?rack.order.filter(v=>v!==drag.id):[];
 const dropMark=(id:number)=>!changes||drag?.slot===undefined?undefined:others[drag.slot]===id?'before':drag.slot===others.length&&others[others.length-1]===id?'after':undefined;
 // While dragging, follow the pointer anywhere on the page; Escape cancels.
 const latest=useRef({drag,moveTo,slotAt});latest.current={drag,moveTo,slotAt};
 const dragging=drag?.id;
 useEffect(()=>{
  if(dragging===undefined)return;
  const move=(e:PointerEvent)=>{const slot=latest.current.slotAt(dragging,e.clientY);if(slot!==latest.current.drag?.slot)setDrag({id:dragging,slot});};
  const drop=()=>{const d=latest.current.drag;if(d?.slot!==undefined)latest.current.moveTo(d.id,d.slot);setDrag(undefined);};
  const cancel=(e:Event)=>{if(!(e instanceof KeyboardEvent)||e.key==='Escape')setDrag(undefined);};
  window.addEventListener('pointermove',move);window.addEventListener('pointerup',drop);window.addEventListener('pointercancel',cancel);window.addEventListener('keydown',cancel);
  return()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',drop);window.removeEventListener('pointercancel',cancel);window.removeEventListener('keydown',cancel);};
 },[dragging]);
 const add=(id:number)=>({...rack,order:[...rack.order,id]});
 return <><aside className="fx-rack" aria-label="Effect rack" data-dragging={drag?true:undefined}>
      <header className="fx-rack-head"><h3>FX rack</h3><span className="fx-count">{rack.order.length}/{choices.length}</span><button className="fx-add" aria-label="Add effect" aria-expanded={addingFx} disabled={busy||!unused.length} onClick={()=>setAddingFx(!addingFx)}>{addingFx?'Close':'＋ Add'}</button></header>
      {waiting&&<p className="fx-status">Applying after adjustments settle…</p>}
      {!targeting&&<label className="fx-character">Modulate<select aria-label="FX modulation source" value={localSource} onChange={e=>setLocalSource(Number(e.target.value))}><option value={-1}>Edit values</option>{[[3,'X tilt'],[4,'Y tilt'],[7,'Joystick'],[8,'Expression']].map(([i,label])=><option key={i} value={i}>{label}</option>)}</select></label>}
      {before}
      {addingFx && <div className="fx-add-menu">{unused.map(f=><button key={f.id} disabled={!canApply(add(f.id))} title={!canApply(add(f.id))?"DSP budget full · remove another feature first":undefined} onPointerEnter={()=>onPreview?.(add(f.id))} onPointerLeave={()=>onPreview?.()} onFocus={()=>onPreview?.(add(f.id))} onBlur={()=>onPreview?.()} onClick={()=>{setEffects(add(f.id));setAddingFx(false);onPreview?.();}}>{f.name}</button>)}</div>}
      <div className="fx-io">In</div>
      <ol className="fx-chain" ref={chain}>
      {!rack.order.length && <li className="fx-empty panel-note">Add an effect to shape your sound.</li>}
      {rack.order.map((id,index)=>{const f=effectTypes[id-1];return <li className={`fx-card${drag?.id===id?" dragging":""}`} key={id} data-effect={id} data-drop={dropMark(id)}>
        <header onPointerDown={e=>{if(busy||e.button!==0||(e.target as HTMLElement).closest("button"))return;e.preventDefault();setDrag({id});}} title="Drag to reorder">
          <span className="fx-grip" aria-hidden="true">⠿</span><span className="fx-index" aria-hidden="true">{index+1}</span><strong>{f.name}</strong>
          <button aria-label={`Move ${f.name} up`} disabled={busy||index===0} onClick={()=>moveTo(id,index-1)}>↑</button>
          <button aria-label={`Move ${f.name} down`} disabled={busy||index===rack.order.length-1} onClick={()=>moveTo(id,index+1)}>↓</button>
          <button className="fx-remove" aria-label={`Remove ${f.name}`} disabled={busy} onClick={()=>setEffects(removeFx(rack,id))}>×</button>
        </header>{id===5&&<FilterResponse rack={rack} sources={targeting?.values}/>}<div className={`fx-controls${id===5?" fx-filter-controls":""}`}>{f.controls.map((label,i)=><FxModControl key={label} label={label} rack={rack} id={id} param={f.params?.[i]??i} busy={busy} onChange={setRackControls} targeting={editTarget} canApply={canApply} onPreview={onPreview}/>)}{id===5&&<label className="physical-control fx-filter-mode"><strong>Mode</strong><select aria-label="Filter mode" value={rack.values[5][3]} disabled={busy} onChange={e=>{const values=rack.values.map(row=>[...row]);values[5][3]=Number(e.target.value);setRackControls({...rack,values});}}>{['Low-pass','Band-pass','High-pass'].map((label,i)=><option key={label} value={i}>{label}</option>)}</select></label>}</div>{id===1&&<label className="fx-character">Character<select aria-label="Distortion character" value={rack.values[0][2]} disabled={busy} onChange={e=>{const values=rack.values.map(row=>[...row]);values[0][2]=Number(e.target.value);setRackControls({...rack,values});}}>{["Warm","Clip","Fold","Diode","Crush"].map((name,i)=><option key={name} value={i}>{name}</option>)}</select></label>}{id===6&&<label className="fx-character">Voices<select aria-label="Ensemble voices" value={rack.values[6][2]} disabled={busy} onChange={e=>{const values=rack.values.map(row=>[...row]);values[6][2]=Number(e.target.value);setRackControls({...rack,values});}}>{ensembleVoices.map((name,i)=><option key={name} value={i}>{name}</option>)}</select></label>}{id===3&&<button type="button" className="step-open" disabled={busy} onClick={()=>setStepEditor(true)} aria-label="Edit volume sequence"><span className="step-mini" aria-hidden="true">{rack.steps.slice(0,1+(rack.values[2][3]&15)).map((v,i)=><i key={i} style={{height:`${Math.max(5,v/65535*100)}%`}}/>)}</span><span>Edit sequence…</span></button>}
      </li>;})}
      </ol>
      <div className="fx-io fx-out">Limiter → Out</div>
    </aside>{stepEditor&&<VolumeStepEditor rack={rack} onChange={setRackControls} onClose={()=>setStepEditor(false)}/>}</>;
}
