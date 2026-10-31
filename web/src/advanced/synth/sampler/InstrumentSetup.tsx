import {useState} from 'react';
import type {Patch} from './prepare.mjs';
import {resourceSummary} from './playback.mjs';
import {WorkspaceDialog} from './WorkspaceDialog.tsx';
export type SustainDesign='natural'|'tiny';
export function InstrumentSetup({patch,classic,design,cycles,mode,onApply,onClose}:{patch:Patch;classic:boolean;design:SustainDesign;cycles:number;mode:string;onApply:(patch:Patch,design:SustainDesign,cycles:number,mode:string)=>void;onClose:()=>void}) {
 const current=resourceSummary(patch,classic);
 const [purpose,setPurpose]=useState(mode==='kit'||mode==='slices'?mode:design==='tiny'?'compact':'natural');
 const [voices,setVoices]=useState(current.voices),[tails,setTails]=useState(current.tails),[room,setRoom]=useState(current.room),[loop,setLoop]=useState(design),[count,setCount]=useState(cycles),[mono,setMono]=useState(false);
 const apply=()=>{const assets=mono?patch.assets.map(a=>a.channels.length===1?a:{...a,channels:[Float32Array.from(a.channels[0],(x,i)=>(x+a.channels[1][i])*.5)]}):patch.assets;onApply({...patch,assets,playback:classic?undefined:{voices,tails},settings:{...patch.settings,space:classic?0:room?(patch.settings?.space||.18):0}},loop,count,purpose==='kit'||purpose==='slices'?purpose:'instrument');onClose();};
 return <WorkspaceDialog title="Instrument setup" onClose={onClose}>
 <p className="panel-note">Choose a starting point. Every choice stays editable; recordings and authored loops are kept.</p>
 <div className="sampler-setup-grid">
 <label>Starting point<select aria-label="Starting point" value={purpose} onChange={e=>{const value=e.target.value;setPurpose(value);setLoop(value==='compact'?'tiny':'natural');if(value==='texture'&&!classic)setRoom(true);}}><option value="natural">Natural instrument</option><option value="compact">Compact tonal sound</option><option value="texture">Evolving texture</option>{!classic&&<><option value="kit">Drum kit</option><option value="slices">Slices</option></>}</select><small>Suggestions for your sound. Imported tuning, envelopes and loops are preserved.</small></label>
 <label>Sustain character<select aria-label="Sustain character" value={loop} onChange={e=>setLoop(e.target.value as SustainDesign)}><option value="natural">Natural · retain movement</option><option value="tiny">Compact · stable tonal loop</option></select><small>{loop==='tiny'?'Good for organs and game sounds. Find a 2–8-cycle loop in Sample; the source stays intact.':'Good for acoustic instruments and textures. Keep natural endings or suggest a longer loop in Sample.'}</small></label>
 {loop==='tiny'&&<label>Loop cycles<select aria-label="Setup loop cycles" value={count} onChange={e=>setCount(+e.target.value)}>{[2,4,8].map(n=><option key={n} value={n}>{n} cycles</option>)}</select></label>}
 <label>Held voices<input aria-label="Held voices" type="number" min={1} max={classic?8:16} value={voices} disabled={classic} onChange={e=>setVoices(Math.max(1,Math.min(16,Math.round(+e.target.value)||1)))}/><small>{classic?'Classic uses its eight-voice profile.':'Fewer held voices reduce reader and filter work. Sixteen is the usual starting point.'}</small></label>
 {!classic&&<label>Release tails<select aria-label="Release tails" value={tails} onChange={e=>setTails(+e.target.value)}>{[0,1,2,3,4].map(n=><option key={n} value={n}>{n} tail slots</option>)}</select><small>Extra slots let released notes finish while new notes start. Fewer slots can shorten old releases.</small></label>}
 <label>Recording channels<select aria-label="Recording channels" value={mono?'mono':'source'} onChange={e=>setMono(e.target.value==='mono')}><option value="source">Keep source channels</option><option value="mono">Mix to mono</option></select><small>{classic?'Classic export fits recordings to mono sample RAM.':'Resident sounds can retain stereo. The current SD profile converts stereo to mono and reports the change.'}</small></label>
 {!classic&&<label>Room<select aria-label="Setup room" value={room?'on':'off'} onChange={e=>setRoom(e.target.value==='on')}><option value="off">Off · dry</option><option value="on">On · gentle room</option></select><small>One shared effect for the whole instrument.</small></label>}
 </div>
 <footer className="sampler-setup-footer"><span>{voices} held + {tails} tails{!classic&&room?' · Room':''}. Device performance needs measurement.</span><button className="primary" onClick={apply}>Use these settings</button></footer>
 </WorkspaceDialog>;
}
export function InstrumentResources({patch,classic,onSetup,disabled=false}:{patch:Patch;classic:boolean;onSetup:()=>void;disabled?:boolean}) {
 const [open,setOpen]=useState(false),r=resourceSummary(patch,classic);
 return <div className="sampler-resource-strip"><button disabled={disabled} onClick={onSetup}>Instrument setup</button><span>{r.voices} voices · {r.sd||!r.stereo?'Mono': 'Stereo'}{r.room?' · Room':''}</span><button aria-expanded={open} onClick={()=>setOpen(!open)}>Resources{open?' −':' +'}</button>
 {open&&<div className="sampler-resource-details"><p><strong>Audio:</strong> up to {r.readers} readers including tails. {r.room?'Shared room enabled.':'Room bypassed.'} No device timing measurement for this patch.</p><p><strong>Memory:</strong> {(r.pcm/1048576).toFixed(2)} MiB of source PCM16 before conversion. {classic?'Export fits the 48 KiB sample budget.':'Preparation determines pitch copies, pinned starts and cache fit.'}</p><p><strong>SD:</strong> {r.sd?'Expected SD profile · forward reads · mono conversion.':'Expected resident profile · no streaming reads during playback.'} Final export reports the actual profile.</p></div>}
 </div>;
}
