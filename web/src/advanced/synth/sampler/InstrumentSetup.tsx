import {motionActive,motionSettings} from "./motion.mjs";
import {useState} from 'react';
import type {Patch} from './prepare.mjs';
import {resourceSummary} from './playback.mjs';
import {WorkspaceDialog} from './WorkspaceDialog.tsx';
export type SustainDesign='natural'|'tiny';
export function InstrumentSetup({patch,classic,design,cycles,mode,onApply,onClose}:{patch:Patch;classic:boolean;design:SustainDesign;cycles:number;mode:string;onApply:(patch:Patch,design:SustainDesign,cycles:number,mode:string)=>void;onClose:()=>void}) {
 const current=resourceSummary(patch,classic);
 const [motionPreset,setMotionPreset]=useState("keep");
 const [purpose,setPurpose]=useState(mode==='kit'||mode==='slices'?mode:design==='tiny'?'compact':'natural');
 const [voices,setVoices]=useState(current.voices),[tails,setTails]=useState(current.tails),[room,setRoom]=useState(current.room),[loop,setLoop]=useState(design),[count,setCount]=useState(cycles),[mono,setMono]=useState(false);
 const apply=()=>{const assets=mono?patch.assets.map(a=>a.channels.length===1?a:{...a,channels:[Float32Array.from(a.channels[0],(x,i)=>(x+a.channels[1][i])*.5)]}):patch.assets;const motion=motionPreset==="keep"?patch.motion:motionSettings(motionPreset==="off"?{}:motionPreset==="expressive"?{vibratoDepth:35,source:2,vibratoFade:300}:{vibratoDepth:25,vibratoDelay:150,vibratoFade:400,source:1,attack:400});onApply({...patch,assets,motion,zones:motionPreset==="keep"?patch.zones:patch.zones?.map(z=>({...z,motion})),playback:classic?undefined:{voices,tails},settings:{...patch.settings,space:classic?(patch.settings?.space??0):room?(patch.settings?.space||.18):0}},loop,count,purpose==='kit'||purpose==='slices'?purpose:'instrument');onClose();};
 return <WorkspaceDialog title="Instrument setup" onClose={onClose}>
 <p className="panel-note">Choose a starting point. Every choice stays editable; recordings and authored loops are kept.</p>
 <div className="sampler-setup-grid">
 <label>Starting point<select aria-label="Starting point" value={purpose} onChange={e=>{const value=e.target.value;setPurpose(value);setLoop(value==='compact'?'tiny':'natural');if(value==='texture'&&!classic)setRoom(true);}}><option value="natural">Natural instrument</option><option value="compact">Compact tonal sound</option><option value="texture">Evolving texture</option>{!classic&&<><option value="kit">Drum kit</option><option value="slices">Slices</option></>}</select><small>Suggestions for your sound. Imported tuning, envelopes and loops are preserved.</small></label>
 <label>Sustain character<select aria-label="Sustain character" value={loop} onChange={e=>setLoop(e.target.value as SustainDesign)}><option value="natural">Natural · retain movement</option><option value="tiny">Compact · stable tonal loop</option></select><small>{loop==='tiny'?'Good for organs and game sounds. Find a 2–8-cycle loop in Sample; the source stays intact.':'Good for acoustic instruments and textures. Keep natural endings or suggest a longer loop in Sample.'}</small></label>
 {loop==='tiny'&&<label>Loop cycles<select aria-label="Setup loop cycles" value={count} onChange={e=>setCount(+e.target.value)}>{[2,4,8].map(n=><option key={n} value={n}>{n} cycles</option>)}</select></label>}
 <label>Held voices<input aria-label="Held voices" type="number" min={1} max={classic?8:16} value={voices} disabled={classic} onChange={e=>setVoices(Math.max(1,Math.min(16,Math.round(+e.target.value)||1)))}/><small>{classic?'Classic uses its eight-voice profile.':current.stereo&&!mono?'Start at eight held voices plus two tails for stereo with motion and room. Larger stereo profiles need device testing.':'Fewer held voices reduce reader and filter work. Sixteen is the usual mono starting point.'}</small>{!classic&&current.stereo&&!mono&&(voices>8||tails>2)&&<button onClick={()=>{setVoices(8);setTails(2);}}>Use stereo starting profile · 8 + 2</button>}</label>
 {!classic&&<label>Release tails<select aria-label="Release tails" value={tails} onChange={e=>setTails(+e.target.value)}>{[0,1,2,3,4].map(n=><option key={n} value={n}>{n} tail slots</option>)}</select><small>Extra slots let released notes finish while new notes start. Fewer slots can shorten old releases.</small></label>}
 <label>Motion starting point<select aria-label="Setup motion" value={motionPreset} onChange={e=>setMotionPreset(e.target.value)}><option value="keep">Keep authored motion</option><option value="off">Off</option><option value="gentle">Gentle delayed vibrato</option><option value="expressive">Pressure vibrato</option></select><small>{classic?'Shared audition supports motion; Classic device export reports its omission.':'Changes motion for every region when applied. Fine-tune the selected region in Sound → Motion.'}</small></label>
 <label>Recording channels<select aria-label="Recording channels" value={mono?'mono':'source'} onChange={e=>setMono(e.target.value==='mono')}><option value="source">Keep source channels</option><option value="mono">Mix to mono</option></select><small>{classic?'Classic export fits recordings to mono sample RAM.':'Stereo is preserved in RAM and on SD. It needs twice the sample bandwidth; choose fewer voices if the device test needs more headroom.'}</small></label>
 {!classic&&<label>Room<select aria-label="Setup room" value={room?'on':'off'} onChange={e=>setRoom(e.target.value==='on')}><option value="off">Off · dry</option><option value="on">On · gentle room</option></select><small>One shared effect for the whole instrument.</small></label>}
 </div>
 <footer className="sampler-setup-footer"><span>{classic?'8 voices':`${voices} held voices + ${tails} release tails`}{!classic&&room?' · Room':''}</span><button className="primary" onClick={apply}>Use these settings</button></footer>
 </WorkspaceDialog>;
}
export function InstrumentResources({patch,classic,onSetup,disabled=false}:{patch:Patch;classic:boolean;onSetup:()=>void;disabled?:boolean}) {
 const r=resourceSummary(patch,classic),motion=motionActive(motionSettings(patch.motion))||patch.zones?.some(z=>motionActive(motionSettings(z.motion)));
 const summary=[`${r.voices} voices`,!r.stereo||classic?'Mono':'Stereo',r.room&&'Room',motion&&'Motion'].filter(Boolean).join(' · ');
 return <button className="sampler-setup-button" disabled={disabled} onClick={onSetup} aria-label={`Instrument setup: ${summary}`}>Setup<small>{summary}</small></button>;
}
