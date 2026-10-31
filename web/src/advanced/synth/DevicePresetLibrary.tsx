import {useEffect,useRef,useState} from 'react';
import {deviceFavoriteLimit,type PhysicalSynthClient,type DevicePresetLabel,type DevicePresetFolder,type DeviceFavorite} from './client.ts';
import {folderName,closeMenu} from './presetLibrary.ts';
export const deviceEngineBase=(engine:number)=>(engine===4?1:engine===5?2:0)*1024;
export const folderFull=(mask:number)=>mask===0xffffffff;
const occupied=(mask:number)=>{let n=0;for(let m=mask>>>0;m;m&=m-1)n++;return n;};
export type DeviceMedium=0|1|2;
export const deviceFolderLimit=32,devicePresetsPerFolder=32;
export interface DeviceRow {id:number;label:DevicePresetLabel;medium:1|2}
const engineLabel=(engine:number)=>engine===4?'Juno':engine===5?'DX7':'Physical Strings';
/** Every HexBoard library holds up to 32 folders of 32 items; explain a save that would exceed either limit. */
export function deviceFolderProblem(folders:DevicePresetFolder[],path:string){
 const used=folders.filter(f=>f.mask),target=used.find(f=>f.name===path);
 if(target)return folderFull(target.mask)?`“${path||'Unfiled'}” already holds ${devicePresetsPerFolder} presets. Choose another folder.`:undefined;
 return used.length>=deviceFolderLimit?`The HexBoard already has ${deviceFolderLimit} folders for this engine. Choose an existing folder with space.`:undefined;
}

interface DeviceCatalog {medium:1|2;folders:DevicePresetFolder[];rows:DeviceRow[]}
// One read per engine and storage choice per page visit; later changes re-read only their folders.
const catalogs=new Map<string,DeviceCatalog>();

/** The HexBoard catalog for one engine, read in full so every folder can be browsed at once.
 * Reading pauses the synth (storage is maintenance work), so it stops once and restarts after. */
export function useDeviceLibrary(client:PhysicalSynthClient|undefined,engine:number,medium:DeviceMedium){
 const key=`${engine}:${medium}`;
 const [catalog,setCatalog]=useState<DeviceCatalog|undefined>(()=>catalogs.get(key)),[favorites,setFavorites]=useState<DeviceFavorite[]>([]),[reading,setReading]=useState('');
 const live=useRef(true);useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 const publish=(value:DeviceCatalog)=>{catalogs.set(key,value);if(live.current)setCatalog(value);};
 const readFolder=async(index:number,m:DeviceMedium,force:boolean)=>{let rows:{id:number;label:DevicePresetLabel}[]=[];const state=await client!.browsePresetFolder(deviceEngineBase(engine)+index*32,m,()=>{},r=>{rows=r;},force);return {state,rows};};
 const paused=async(work:()=>Promise<void>)=>{
  const status=await client!.status(),resume=status.state!=='stopped';if(resume)await client!.stopAndWait();
  try{await work();}finally{if(resume)await client!.start(status.instrument);if(live.current)setReading('');}
 };
 /** Read the directory, then the given folders (every occupied one when omitted). */
 const refresh=async(only?:number[],force=true)=>{
  if(!client){catalogs.delete(key);return;} // Changed while closed: read again on the next visit.
  await paused(async()=>{
   if(live.current)setReading('Reading HexBoard folders…');
   const firstIndex=only?.[0]??0,first=await readFolder(firstIndex,medium,force),actual:1|2=first.state.medium===2?2:1,folders=await client.presetFolders();
   const wanted=(only??folders.filter(f=>f.mask).map(f=>f.index)).filter(i=>folders[i]?.mask);
   const previous=catalogs.get(key);let rows=only&&previous?.medium===actual?previous.rows.filter(r=>!only.includes(Math.floor(r.id/32)%32)):[];
   publish({medium:actual,folders,rows});
   for(const [n,index] of wanted.entries()){
    if(live.current)setReading(`Reading folder ${n+1} of ${wanted.length}…`);
    const read=index===firstIndex?first:await readFolder(index,actual,force);
    rows=[...rows,...read.rows.map(r=>({...r,medium:actual}))];publish({medium:actual,folders,rows});
   }
  });
  if(live.current)setFavorites(await client.presetFavorites());
 };
 const refreshFavorites=async()=>{if(client&&live.current)setFavorites(await client.presetFavorites());};
 useEffect(()=>{
  if(!client)return;
  if(catalogs.has(key)){setCatalog(catalogs.get(key));void refreshFavorites().catch(()=>{});}
  else void refresh(undefined,false).catch(()=>{if(live.current)setReading('');});
 },[client,key]); // eslint-disable-line react-hooks/exhaustive-deps -- one read per engine/storage
 return {catalog,favorites,reading,refresh,refreshFavorites};
}
export type DeviceLibrary=ReturnType<typeof useDeviceLibrary>;

export function DevicePresetLibrary({client,library,medium,onMedium,activeSlot,busy=false,run,onLoad,onLoadFavorite,onCopy,onReplace,onDelete,onOrganize,onFavorite,onUnfavorite}:{client?:PhysicalSynthClient;library:DeviceLibrary;medium:DeviceMedium;onMedium:(m:DeviceMedium)=>void;activeSlot?:number;busy?:boolean;run:(fn:()=>Promise<void>)=>void;onLoad:(row:DeviceRow)=>Promise<void>;onLoadFavorite:(favorite:DeviceFavorite)=>Promise<void>;onCopy:(row:DeviceRow)=>Promise<void>;onReplace:(row:DeviceRow)=>Promise<void>;onDelete:(row:DeviceRow)=>Promise<void>;onOrganize:(row:DeviceRow)=>void;onFavorite:(row:DeviceRow)=>Promise<void>;onUnfavorite:(favorite:DeviceFavorite)=>Promise<void>}){
 const [folder,setFolder]=useState<number|'all'|'favorites'>('all'),[query,setQuery]=useState('');
 if(!client)return <section className="librarySpace"><div className="librarySpaceHeader"><div><h3>HexBoard Library</h3><span className="muted">Saved on your instrument</span></div></div><p className="emptyListItem">Connect to see your saved sounds</p></section>;
 const {catalog,favorites,reading}=library,blocked=busy||!!reading,shown=(catalog?.folders??[]).filter(f=>f.mask).sort((a,b)=>a.name.localeCompare(b.name));
 const q=query.trim().toLowerCase(),match=(text:string)=>!q||text.toLowerCase().includes(q);
 const rows=(catalog?.rows??[]).filter(r=>(folder==='all'||Math.floor(r.id/32)%32===folder)&&match(`${r.label.name} ${r.label.folder}`)).sort((a,b)=>a.label.folder.localeCompare(b.label.folder)||a.label.name.localeCompare(b.label.name,undefined,{numeric:true}));
 const starred=favorites.filter(f=>match(f.name)),count=folder==='favorites'?starred.length:rows.length;
 const chip=(key:typeof folder,label:string,n:string,system=false)=><button key={String(key)} type="button" aria-pressed={folder===key} className={`folderTarget${system?' systemFolderTarget':''}${folder===key?' active':''}`} onClick={()=>setFolder(key)}><span>{label}</span><span>{n}</span></button>;
 return <section className="librarySpace">
  <div className="librarySpaceHeader"><div><h3>HexBoard Library</h3><span className="muted">{catalog?`${catalog.medium===2?'SD card':'Internal flash'} · ${shown.length}/${deviceFolderLimit} folders`:'Saved on your instrument'}</span></div><span className="countBadge">{count}</span></div>
  <div className="soundLibraryControls"><input type="search" aria-label="Search HexBoard presets" placeholder="Search presets" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="HexBoard storage" value={medium} disabled={blocked} onChange={e=>{onMedium(+e.target.value as DeviceMedium);setFolder('all');}}><option value={0}>SD preferred</option><option value={2}>SD card</option><option value={1}>Internal flash</option></select></div>
  <div className="folderTargets" role="group" aria-label="HexBoard folders">
   {chip('all','All',String(catalog?.rows.length??0),true)}
   {chip('favorites','★ Favorites',`${favorites.length}/${deviceFavoriteLimit}`,true)}
   {shown.map(f=>chip(f.index,folderName(f.name),`${occupied(f.mask)}/${devicePresetsPerFolder}`))}
  </div>
  {reading&&<p className="muted soundLibraryReading" role="status">{reading}</p>}
  <ul className="list" aria-busy={blocked}>
   {folder==='favorites'?(starred.length===0?<li className="emptyListItem">{favorites.length?`No favorites match “${query.trim()}”`:'Star up to 32 HexBoard sounds from any engine to collect them here'}</li>:starred.map(f=><li key={`${f.medium}:${f.slot}`} className={`listItem presetListItem${f.slot===activeSlot?' activeListItem':''}`}>
     <button className="presetNameButton" type="button" disabled={blocked} title={`Load ${f.name}`} onClick={()=>run(()=>onLoadFavorite(f))}><strong>{f.name}</strong><span>{engineLabel(f.engine)} · {f.medium===2?'SD card':'Internal flash'}</span></button>
     <button type="button" className="iconButton soundFavorite" aria-pressed="true" aria-label={`Unfavorite ${f.name}`} disabled={blocked} onClick={()=>run(()=>onUnfavorite(f))}>★</button>
    </li>))
   :rows.length===0?<li className="emptyListItem">{reading?'Reading preset names…':catalog?.rows.length?`No presets match “${query.trim()}”`:'Use Save to HexBoard to create your first folder'}</li>:rows.map(r=><li key={r.id} className={`listItem presetListItem${r.id===activeSlot?' activeListItem':''}`}>
    <button className="presetNameButton" type="button" disabled={blocked} title={`Load ${r.label.name}`} onClick={()=>run(()=>onLoad(r))}><strong>{r.label.name}</strong><span>{folderName(r.label.folder)}</span></button>
    <button type="button" className="iconButton soundFavorite" aria-pressed={r.label.favorite} aria-label={`${r.label.favorite?'Unfavorite':'Favorite'} ${r.label.name}`} disabled={blocked} onClick={()=>run(()=>onFavorite(r))}>{r.label.favorite?'★':'☆'}</button>
    <details className="presetOverflowMenu"><summary aria-label={`More actions for ${r.label.name}`} title="More actions">•••</summary><div className="presetOverflowActions" onClick={closeMenu}>
     <button type="button" disabled={blocked} onClick={()=>run(()=>onLoad(r))}>Load</button>
     <button type="button" disabled={blocked} onClick={()=>onOrganize(r)}>Rename / Move</button>
     <button type="button" disabled={blocked} onClick={()=>run(()=>onCopy(r))}>Copy to Browser</button>
     <button type="button" disabled={blocked} onClick={()=>run(()=>onReplace(r))}>Replace with current sound</button>
     <button type="button" className="warning" disabled={blocked} onClick={()=>run(()=>onDelete(r))}>Delete</button>
    </div></details></li>)}
  </ul>
 </section>;
}
