import { useEffect, useReducer, useRef, useState } from 'react';
import type { MidiTransport } from '../../midi/types.ts';
import { advancedNoteSurface } from '../../midi/boardContext.ts';
import { categories, choices, initialMenu, reduceMenu, displayedSelection, defaultCalibration, normalize, sector, calibrate, type Calibration, type Action } from './model.ts';
import { readJoystick } from './inputClient.ts';
import './menu.css';
const calibrationKey='hexboard-advanced-menu-joystick-v1';
function loadCalibration():Calibration {
  try { const c=JSON.parse(localStorage.getItem(calibrationKey)??'null');
    if(c && Object.keys(defaultCalibration).every(k=>typeof c[k]==='number'&&Number.isFinite(c[k])) && [1,-1].includes(c.signX) && [1,-1].includes(c.signY) && c.deadZone>=.03&&c.deadZone<=.4 && c.centerX-c.minX>=.3&&c.maxX-c.centerX>=.3&&c.centerY-c.minY>=.3&&c.maxY-c.centerY>=.3)return c;
  }catch{/* Storage is optional. */} return {...defaultCalibration};
}
export function MenuPrototype({transport,connected}:{transport:MidiTransport;connected:boolean}) {
  const [menu,reactDispatch]=useReducer(reduceMenu,initialMenu);
  const dispatch=(action:Action)=>{current.current.menu=reduceMenu(current.current.menu,action);reactDispatch(action);};
  const [livePreview,setLivePreview]=useState(true),[sound,setSound]=useState(false);
  const [raw,setRaw]=useState<[number,number]>([0,0]);
  const [calibration,setCalibration]=useState<Calibration>(loadCalibration);
  const [phase,setPhase]=useState<'idle'|'center'|'sweep'>('idle');
  const [source,setSource]=useState<'screen'|'physical'>('screen');
  const [retry,setRetry]=useState(0);
  const [inputStatus,setInputStatus]=useState('On-screen input'),[armed,setArmed]=useState<number|null>(null);
  const [message,setMessage]=useState(''),[parameter,setParameter]=useState(0),[attack,setAttack]=useState(25),[release,setRelease]=useState(60),[joystickRow,setJoystickRow]=useState(0);
  const samples=useRef<[number,number][]>([]),centers=useRef<[number,number][]>([]),center=useRef<[number,number]>([0,0]);
  const current=useRef({menu,calibration,phase,source,parameter,joystickRow});current.current={menu,calibration,phase,source,parameter,joystickRow};
  const gesture=useRef({armed:null as number|null,direction:'',since:0,next:0,neutral:true});
  const pressedAt=useRef(0),pressHandled=useRef(false),buttonState=useRef(false);
  const audio=useRef<AudioContext|null>(null);
  const calibrationActionRef=useRef(()=>{}),saveCalibrationRef=useRef(()=>{});
  const normalized=normalize(...raw,calibration);
  const shown=displayedSelection(menu,livePreview);
  const isPreview=menu.page==='list'&&menu.category!=='Settings'&&livePreview&&menu.cursor!==menu.applied[menu.category];
  const [displaySelection,setDisplaySelection]=useState(shown);
  useEffect(()=>{const timer=setTimeout(()=>setDisplaySelection(shown),isPreview?160:0);return()=>clearTimeout(timer);},[JSON.stringify(shown),isPreview]);
  const [pressedKey,setPressedKey]=useState<number|null>(null);
  const ingest=useRef((x:number,y:number)=>{});
  ingest.current=(x,y)=>{
    setRaw([x,y]);const s=current.current;
    if(s.phase==='center'){if(centers.current.length<300)centers.current.push([x,y]);return;}
    if(s.phase==='sweep'){if(samples.current.length<2000)samples.current.push([x,y]);return;}
    const [nx,ny]=normalize(x,y,s.calibration),r=Math.hypot(nx,ny),g=gesture.current,now=performance.now();
    if(!g.neutral){if(r<.08)g.neutral=true;return;}
    if(s.menu.page==='performance')return;
    if(s.menu.page==='pie'){
      if(r>.38){g.armed=sector(nx,ny);setArmed(g.armed);}
      else if(r<.08&&g.armed!==null){dispatch({type:'open',category:categories[g.armed]});g.armed=null;setArmed(null);}
      return;
    }
    const direction=r>.4 ? Math.abs(nx)>Math.abs(ny)?nx>0?'right':'left':ny>0?'down':'up' : '';
    if(!direction){g.direction='';return;}
    if(direction!==g.direction){g.direction=direction;g.since=now;g.next=now;}
    if(now<g.next)return;g.next=now+(now-g.since>1200?90:now-g.since>400?180:400);
    if(s.menu.page==='list'){
      if(direction==='up'||direction==='down')dispatch({type:'browse',delta:direction==='up'?-1:1});
      else {dispatch({type:direction==='right'?'apply':'back'});g.next=Infinity;g.neutral=false;setMessage(direction==='right'?'Applied for this session':'Preview cancelled');}
    }else if(direction==='left'&&s.menu.page!=='sound'&&s.menu.page!=='joystick'){dispatch({type:'back'});g.next=Infinity;g.neutral=false;}
    else if(s.menu.page==='joystick'){
      if(s.phase!=='idle'){
        if(direction==='right'){calibrationActionRef.current();g.next=Infinity;}
        if(direction==='left'){setPhase('idle');g.next=Infinity;}
      }else if(direction==='up'||direction==='down')setJoystickRow(v=>Math.max(0,Math.min(5,v+(direction==='up'?-1:1))));
      else if(s.joystickRow===0)setCalibration(c=>({...c,deadZone:Math.max(.03,Math.min(.4,c.deadZone+(direction==='right'?.01:-.01)))}));
      else if(direction==='left'){dispatch({type:'back'});g.next=Infinity;g.neutral=false;}
      else {g.next=Infinity;
        if(s.joystickRow===1)calibrationActionRef.current();
        else if(s.joystickRow===2)setCalibration(c=>({...c,signX:-c.signX}));
        else if(s.joystickRow===3)setCalibration(c=>({...c,signY:-c.signY}));
        else if(s.joystickRow===4)saveCalibrationRef.current();
        else dispatch({type:'back'});
      }
    }
    else if(s.menu.page==='sound'){
      if(direction==='up'||direction==='down')setParameter(p=>p===0?1:0);
      else (s.parameter===0?setAttack:setRelease)(v=>Math.max(0,Math.min(100,v+(direction==='right'?2:-2))));
    }
  };
  useEffect(()=>{gesture.current.armed=null;setArmed(null);gesture.current.neutral=source==='screen'&&Math.hypot(...normalize(...raw,calibration))<.08;gesture.current.direction='';gesture.current.next=0;},[menu.page]);
  const toggle=()=>{dispatch({type:'toggle'});gesture.current={armed:null,direction:'',since:0,next:0,neutral:source==='screen'&&Math.hypot(...normalize(...raw,calibration))<.08};setArmed(null);setPhase('idle');setMessage('');};
  const toggleRef=useRef(toggle);toggleRef.current=toggle;
  useEffect(()=>{
    if(source!=='physical')return;
    if(!connected){setInputStatus('Connect Advanced main USB to use the joystick.');return;}
    const abort=new AbortController();let timer:ReturnType<typeof setTimeout>;
    let validBefore=false;
    const poll=async()=>{
      try{const p=await readJoystick(transport,abort.signal);if(abort.signal.aborted)return;
        setInputStatus(p.valid?'Receiving audio-board joystick input':'Waiting for audio-board input…');
        if(p.valid){if(!validBefore){gesture.current.neutral=false;buttonState.current=p.pressed;pressHandled.current=p.pressed;}validBefore=true;
          ingest.current(p.x,p.y);
          if(p.pressed&&!buttonState.current){pressedAt.current=performance.now();pressHandled.current=false;}
          if(p.pressed&&!pressHandled.current&&performance.now()-pressedAt.current>=500){pressHandled.current=true;toggleRef.current();}
          buttonState.current=p.pressed;
        }else{validBefore=false;buttonState.current=false;gesture.current.neutral=false;gesture.current.armed=null;setArmed(null);}
        timer=setTimeout(poll,30);
      }catch(e){if(!abort.signal.aborted){setInputStatus(e instanceof Error?e.message:'Input lost');gesture.current.neutral=false;gesture.current.armed=null;setArmed(null);buttonState.current=false;}}
    };void poll();return()=>{abort.abort();clearTimeout(timer);buttonState.current=false;};
  },[source,connected,transport,retry]);
  useEffect(()=>{
    const keys=new Set<string>();let held=false,started=0,handled=false;
    const reset=()=>{keys.clear();held=false;gesture.current.armed=null;setArmed(null);ingest.current(0,0);};
    const down=(e:KeyboardEvent)=>{if(/INPUT|TEXTAREA|SELECT|BUTTON/.test((e.target as HTMLElement).tagName)||source!=='screen')return;
      if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)){e.preventDefault();keys.add(e.key);if(e.key===' '&&!held){held=true;started=performance.now();handled=false;}}
      if(e.key.startsWith('Arrow')){keyboardActive.current=true;ingest.current((keys.has('ArrowRight')?1:0)-(keys.has('ArrowLeft')?1:0),(keys.has('ArrowDown')?1:0)-(keys.has('ArrowUp')?1:0));}
      if(e.key==='Escape'){dispatch({type:'back'});setPhase('idle');}
    };
    const up=(e:KeyboardEvent)=>{keys.delete(e.key);if(e.key===' ')held=false;if(source==='screen'&&e.key.startsWith('Arrow'))ingest.current((keys.has('ArrowRight')?1:0)-(keys.has('ArrowLeft')?1:0),(keys.has('ArrowDown')?1:0)-(keys.has('ArrowUp')?1:0));};
    const timer=setInterval(()=>{if(source!=='screen')return;
      if(held&&!handled&&performance.now()-started>=500){handled=true;toggleRef.current();}
      if(keys.size||keyboardActive.current){keyboardActive.current=keys.size>0;ingest.current((keys.has('ArrowRight')?1:0)-(keys.has('ArrowLeft')?1:0),(keys.has('ArrowDown')?1:0)-(keys.has('ArrowUp')?1:0));}
    },30);
    window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',reset);
    return()=>{clearInterval(timer);window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',reset);};
  },[source]);
  const keyboardActive=useRef(false);
  useEffect(()=>()=>{void audio.current?.close();},[]);
  useEffect(()=>{if(!message)return;const t=setTimeout(()=>setMessage(''),1600);return()=>clearTimeout(t);},[message]);
  useEffect(()=>{if(source!=='screen'||phase==='idle')return;const t=setInterval(()=>ingest.current(...raw),30);return()=>clearInterval(t);},[source,phase,raw]);
  function saveCalibration(c:Calibration){setCalibration(c);try{localStorage.setItem(calibrationKey,JSON.stringify(c));setMessage('Saved in this browser');}catch{setMessage('Applied for this session; browser storage unavailable');}}
  function calibrationAction(){
    if(phase==='idle'){centers.current=[];setPhase('center');}
    else if(phase==='center'){
      if(centers.current.length<10){setMessage('Release the stick and wait at least 300 ms');return;}
      center.current=[0,1].map(i=>centers.current.reduce((sum,p)=>sum+p[i],0)/centers.current.length) as [number,number];
      samples.current=[];setPhase('sweep');
    }else{
      const c=calibrate(center.current,samples.current,calibration.deadZone);
      if(!c){setMessage('Sweep all four directions fully, then try Finish again');return;}
      saveCalibration({...c,signX:calibration.signX,signY:calibration.signY});setPhase('idle');gesture.current.neutral=false;
    }
  }
  calibrationActionRef.current=calibrationAction;saveCalibrationRef.current=()=>saveCalibration(calibration);
  function audition(key:number,row:number,col:number){
    if(menu.page==='sound'&&row===0&&col<2){setParameter(col);return;}
    setPressedKey(key);setTimeout(()=>setPressedKey(null),180);
    if(!sound)return;
    const divisions=[12,19,31][displaySelection.Tuning];const steps=displaySelection.Layout===0?col*2-row*5:displaySelection.Layout===1?col*4-row*3:col-row*2;
    const scale=displaySelection.Scale;
    const allowed=scale===0|| (scale===1?[0,2,4,5,7,9,11]:scale===2?[0,2,3,5,7,8,10]:[0,2,4,7,9]).includes(((steps%12)+12)%12);
    if(!allowed)return;
    const context=audio.current??new AudioContext();audio.current=context;
    void context.resume().then(()=>{if(audio.current!==context||context.state==='closed')return;
      const o=context.createOscillator(),gain=context.createGain();o.type=(['triangle','sine','sawtooth'] as const)[displaySelection.Presets];
      o.frequency.value=220*Math.pow(2,steps/divisions);const now=context.currentTime;
      gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(.04,now+.01+attack/500);gain.gain.exponentialRampToValueAtTime(.0001,now+.3+release/100);
      o.connect(gain);gain.connect(context.destination);o.start();o.stop(now+.4+release/100);
    }).catch(()=>setMessage('Browser audio unavailable'));
  }
  const list=choices[menu.category];const start=Math.max(0,menu.cursor-2);
  const screenTitle=menu.page==='performance'?'Performance':menu.page==='pie'?'Quick menu':menu.page==='list'?menu.category:menu.page==='joystick'?'Joystick':menu.page==='preview'?'Live preview':'Sound';
  const hex=Array.from({length:6},(_,i)=>{const a=(-60+i*60)*Math.PI/180;return [64+52*Math.cos(a),71+52*Math.sin(a)];});
  return <section className="menuPrototype" tabIndex={0} aria-label="Advanced menu prototype">
    <div className="menuIntro"><div><span className="eyebrow">HexBoard Advanced · interactive prototype</span><h2>Device menu</h2><p>A 128 × 128 screen, six directions, one stick.</p></div><span className="menuPrototypeBadge">Browser audition · no device content changes</span></div>
    <div className="menuWorkbench">
      <div className="menuDisplayColumn">
        <svg className="menuOled" viewBox="0 0 128 128" role="img" aria-label={`${screenTitle}${isPreview?' — Preview':''}`}>
          <rect width="128" height="128" fill="#101a24"/><rect width="128" height="15" fill="#233444"/>
          <text x="5" y="10" className="oledTitle">{screenTitle}</text>{isPreview&&<text x="123" y="10" textAnchor="end" fill="#fbcf70">Preview</text>}
          {menu.page==='pie'&&categories.map((name,i)=>{const a=(-30+i*60)*Math.PI/180;return <g key={name} className="menuSector" onClick={()=>dispatch({type:'open',category:name})}>
            <path d={`M64 71 L${hex[i][0]} ${hex[i][1]} L${hex[(i+1)%6][0]} ${hex[(i+1)%6][1]} Z`} fill={armed===i?'#e9b85f':'#243a4c'} stroke="#101a24" strokeWidth="1.5"/>
            <text x={64+34*Math.cos(a)} y={73+34*Math.sin(a)} textAnchor="middle" fill={armed===i?'#101a24':'#edf5ff'}>{name}</text>
          </g>;})}
          {menu.page==='performance'&&<g><text x="8" y="32" fill="#6ad5c0">Ready to play</text>{(['Layout','Tuning','Scale','Presets'] as const).map((c,i)=><g key={c}><text x="8" y={48+i*15} fill="#8fa8ba">{c}</text><text x="120" y={48+i*15} textAnchor="end">{choices[c][menu.applied[c]]}</text></g>)}</g>}
          {menu.page==='list'&&list.slice(start,start+5).map((name,j)=>{const i=start+j;return <g key={name} onClick={()=>dispatch({type:'browse',delta:i-menu.cursor})}>
            {i===menu.cursor&&<rect x="3" y={23+j*17} width="122" height="15" rx="2" fill="#354e61"/>}<text x="8" y={33+j*17}>{menu.applied[menu.category]===i&&menu.category!=='Settings'?'● ':''}{name}</text>{i===menu.cursor&&<text x="119" y={33+j*17} textAnchor="end" fill="#fbcf70">›</text>}
          </g>;})}
          {menu.page==='joystick'&&<g>{phase==='idle'?['Dead zone '+Math.round(calibration.deadZone*100)+'%', 'Calibrate stick', 'Reverse X: '+(calibration.signX<0?'On':'Off'), 'Reverse Y: '+(calibration.signY<0?'On':'Off'), 'Save in browser', 'Back'].slice(Math.max(0,joystickRow-2),Math.max(0,joystickRow-2)+5).map((name,i)=>{const index=Math.max(0,joystickRow-2)+i;return <g key={name}>{index===joystickRow&&<rect x="3" y={23+i*17} width="122" height="15" rx="2" fill="#354e61"/>}<text x="7" y={33+i*17}>{name}{index===joystickRow?' ‹ ›':''}</text></g>;}) : <><text x="7" y="30">{phase==='center'?'Release the stick':'Sweep all directions'}</text><circle cx="64" cy="66" r="24" fill="none" stroke="#607e95"/><circle cx="64" cy="66" r={calibration.deadZone*24} fill="#4b5360"/><circle cx={64+normalized[0]*24} cy={66+normalized[1]*24} r="3" fill="#6ad5c0"/><text x="64" y="103" textAnchor="middle">{phase==='center'?'Capture center below':'Finish below'}</text></>}</g>}
          {menu.page==='preview'&&<g><text x="8" y="38">Live preview: {livePreview?'On':'Off'}</text><text x="8" y="56">Audition before applying</text><text x="8" y="74">Left cancels preview</text><text x="8" y="92">Right applies choice</text></g>}
          {menu.page==='sound'&&<g>{['Attack','Release'].map((n,i)=><g key={n}><rect x="7" y={29+i*31} width="5" height="5" fill={i===0?'#e9b85f':'#6ad5c0'}/><text x="16" y={35+i*31}>{n} {i===0?attack:release}% {parameter===i?'‹ ›':''}</text><rect x="16" y={41+i*31} width={(i===0?attack:release)*.95} height="3" fill={i===0?'#e9b85f':'#6ad5c0'}/></g>)}<text x="8" y="107">Use the colored edge keys</text></g>}
          <rect x="0" y="115" width="128" height="13" fill="#233444"/><text x="64" y="124" textAnchor="middle" fill="#c4d7e5">{menu.page==='performance'?'Hold button: menu':menu.page==='pie'?'Flick + release':menu.page==='list'?'↑↓ browse  → apply  ← back':'Hold button: perform'}</text>
        </svg>
        <div className="menuActionRow"><button onClick={toggle}> {menu.page==='performance'?'Enter menu':'Return to performance'}</button>{menu.page!=='performance'&&<button onClick={()=>{dispatch({type:'back'});setPhase('idle');}}>Back</button>}</div>
        <p className="menuStatus" role="status">{message||'● Applied choice · previews are temporary'}</p>
      </div>
      <div className="menuInputColumn">
        <h3>Joystick</h3><div className="menuActionRow"><button aria-pressed={source==='screen'} onClick={()=>{setSource('screen');setRaw([0,0]);gesture.current={armed:null,direction:'',since:0,next:0,neutral:true};setArmed(null);}}>On screen</button><button aria-pressed={source==='physical'} disabled={!connected} onClick={()=>{setSource('physical');gesture.current={armed:null,direction:'',since:0,next:0,neutral:false};setArmed(null);}}>Physical joystick</button></div>
        <p role="status">{source==='physical'?inputStatus:'Drag the stick; release to choose a sector.'}</p>{source==='physical'&&<button onClick={()=>setRetry(v=>v+1)}>Reconnect joystick</button>}
        <div className={`menuStick ${source==='physical'?'physical':''}`} role="group" aria-label="On-screen joystick" onPointerDown={e=>{if(source!=='screen')return;e.currentTarget.setPointerCapture(e.pointerId);const b=e.currentTarget.getBoundingClientRect();ingest.current(Math.max(-1,Math.min(1,(e.clientX-b.left-b.width/2)/(b.width*.4))),Math.max(-1,Math.min(1,(e.clientY-b.top-b.height/2)/(b.height*.4))));}} onPointerMove={e=>{if(source!=='screen'||!e.currentTarget.hasPointerCapture(e.pointerId))return;const b=e.currentTarget.getBoundingClientRect();ingest.current(Math.max(-1,Math.min(1,(e.clientX-b.left-b.width/2)/(b.width*.4))),Math.max(-1,Math.min(1,(e.clientY-b.top-b.height/2)/(b.height*.4))));}} onPointerUp={()=>{if(source==='screen')ingest.current(0,0);}} onPointerCancel={()=>{if(source==='screen')ingest.current(0,0);}}>
          <div className="stickDeadZone" style={{width:`${calibration.deadZone*80}%`,height:`${calibration.deadZone*80}%`}}/><div className="stickKnob" style={{transform:`translate(${raw[0]*80}px,${raw[1]*80}px)`}}/>
        </div>
        <p className="menuHint">Focus this panel, then use arrow keys (combine two for diagonals). Hold Space for ½ second to enter or exit. Escape goes back.</p>
        {menu.page==='list'&&<div className="menuActionRow"><button onClick={()=>dispatch({type:'browse',delta:-1})}>↑</button><button onClick={()=>dispatch({type:'browse',delta:1})}>↓</button><button onClick={()=>{dispatch({type:'apply'});setMessage(menu.category==='Settings'?'':'Applied for this session');}}>Apply →</button></div>}
        {menu.page==='joystick'&&<div className="menuSettings"><label>Radial dead zone <input type="range" min="3" max="40" value={Math.round(calibration.deadZone*100)} onChange={e=>setCalibration(c=>({...c,deadZone:Number(e.target.value)/100}))}/>{Math.round(calibration.deadZone*100)}%</label><div className="menuActionRow"><button onClick={()=>saveCalibration(calibration)}>Save dead zone</button><button onClick={calibrationAction}>{phase==='idle'?'Calibrate joystick':phase==='center'?'Capture center →':'Finish calibration'}</button>{phase!=='idle'&&<button onClick={()=>setPhase('idle')}>Cancel</button>}</div><p>{phase==='center'?'Release the stick and wait a moment, then capture its center.':phase==='sweep'?'Move fully left, right, up and down, then use Finish calibration below. Finish accepts only a complete sweep.':'Center, asymmetric travel and dead zone are saved in this browser, separately from Hall calibration.'}</p><label><input type="checkbox" checked={calibration.signX===-1} onChange={e=>setCalibration(c=>({...c,signX:e.target.checked?-1:1}))}/> Reverse horizontal axis</label><label><input type="checkbox" checked={calibration.signY===-1} onChange={e=>setCalibration(c=>({...c,signY:e.target.checked?-1:1}))}/> Reverse vertical axis</label><button onClick={()=>{setCalibration({...defaultCalibration});setPhase('idle');setMessage('Defaults restored; Save to keep them');}}>Reset calibration</button></div>}
        {menu.page==='preview'&&<label><input type="checkbox" checked={livePreview} onChange={e=>setLivePreview(e.target.checked)}/> Preview while browsing</label>}
        <label><input type="checkbox" checked={sound} onChange={e=>setSound(e.target.checked)}/> Browser sound for audition keys</label>
      </div>
    </div>
    <div className="menuSurfaceHeader"><h3>Audition surface</h3><p>{menu.page==='sound'?'Gold = Attack · Mint = Release · unlit separator · remaining keys audition':'Click a key to try the highlighted layout and tuning.'}</p></div>
    <div className="menuSurface" aria-label="133-key Advanced audition surface">{advancedNoteSurface.map(k=>{
      const soft=menu.page==='sound'&&k.row===0&&k.coordCol<2;const separator=menu.page==='sound'&&k.row===1;
      const steps=displaySelection.Layout===0?k.coordCol*2-k.row*5:displaySelection.Layout===1?k.coordCol*4-k.row*3:k.coordCol-k.row*2;
      const hue=displaySelection.Colors===1?185+steps%35:displaySelection.Colors===2?20+steps%30:(steps*27%360+360)%360;
      return <button key={k.hallKey} style={{gridRow:k.row+1,gridColumn:k.coordCol+1,background:separator?'#1e2935':soft?k.coordCol===0?'#e9b85f':'#6ad5c0':`hsl(${hue} 48% ${pressedKey===k.hallKey?75:38}%)`}} disabled={separator} aria-label={soft?k.coordCol===0?'Select Attack':'Select Release':`Audition key ${k.hallKey}`} onClick={()=>audition(k.hallKey,k.row,k.coordCol)}>{soft?k.coordCol===0?'A':'R':k.hallKey}</button>;
    })}</div>
    <p className="menuHint">This prototype uses example content and browser sound. Applied markers describe this session; device presets, LEDs and musical mappings are unchanged. Physical input requires updated main and audio firmware.</p>
  </section>;
}
