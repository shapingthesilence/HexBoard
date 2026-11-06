import {useEffect,useRef,useState} from 'react';
import {useAutosave} from '../../editor/useAutosave.ts';
import {writeStoredText} from '../../editor/autosave.ts';
import {createPortal} from 'react-dom';
import {DevicePresetLibrary,useDeviceLibrary,deviceEngineBase,type DeviceMedium,type DeviceRow} from './DevicePresetLibrary.tsx';
import {deviceFavoriteLimit,type PhysicalSynthClient,type DeviceFavorite} from './client.ts';
import {factoryPhysicalPresets} from './schema.ts';
import {factoryClassicPresets} from './classicSchema.ts';
import {importDx7} from './dx7Import.ts';
import {LibraryBulkActions} from '../../components/LibraryBulkActions.tsx';
import {OrganizeLibraryItemDialog} from '../../components/OrganizeLibraryItemDialog.tsx';
import {storedPreset,presetEngine,libraryFolder,readLibrary,putLibraryPreset,removeLibraryPreset,downloadPreset,downloadPresets,importedPresets,folderName,presetName,favoritesFilter,filterEntries,folderCounts,sameName,browserSaveTarget,closeMenu,type SoundPreset,type LibraryPreset} from './presetLibrary.ts';
import './PresetLibrary.css';

interface Link {browser?:string;device?:{slot:number;folder:string;medium:1|2}}
interface Identity {link:Link;folder:string}
const identityKey=(engine:number)=>`hexboard.advanced.library.${engine}`;
function readIdentity(engine:number):Identity{try{const v=JSON.parse(localStorage.getItem(identityKey(engine))??'null');if(v&&typeof v.folder==='string'&&typeof v.link==='object')return v;}catch{/* Private windows may refuse storage. */}return {link:{},folder:''};}
function writeIdentity(engine:number,value:Identity){try{writeStoredText(localStorage,identityKey(engine),JSON.stringify(value));}catch{/* The current page still holds the identity. */}}
const engineName=(engine:number)=>engine===2?'Physical Strings':engine===4?'Juno':'DX7';
const folderOf=(slot:number)=>Math.floor(slot/32)%32;
const browserFavoriteLimit=32; // Shared across engines, like HexBoard favorites.

function FolderChips({label,rows,folder,favorites,onFolder}:{label:string;rows:LibraryPreset[];folder:string|null;favorites?:boolean;onFolder:(f:string|null)=>void}){
 const starred=rows.filter(r=>r.favorite).length;
 return <div className="folderTargets" role="group" aria-label={`${label} folders`}>
  <button type="button" aria-pressed={folder===null} className={`folderTarget systemFolderTarget${folder===null?' active':''}`} onClick={()=>onFolder(null)}><span>All</span><span>{rows.length}</span></button>
  {favorites&&starred>0&&<button type="button" aria-pressed={folder===favoritesFilter} className={`folderTarget systemFolderTarget${folder===favoritesFilter?' active':''}`} onClick={()=>onFolder(favoritesFilter)}><span>★ Favorites</span><span>{starred}</span></button>}
  {folderCounts(rows).map(([f,n])=><button key={f} type="button" aria-pressed={folder===f} className={`folderTarget${folder===f?' active':''}`} onClick={()=>onFolder(f)}><span>{folderName(f)}</span><span>{n}</span></button>)}
 </div>;
}

export function PresetLibrary({preset,client,disabled,onLoad,onDeviceLoad,onBusy,onRename}:{preset:SoundPreset;client?:PhysicalSynthClient;disabled?:boolean;onLoad:(p:SoundPreset)=>Promise<void>;onDeviceLoad:(engine:number,name:string)=>Promise<void>;onBusy?:(v:boolean)=>void;onRename:(name:string)=>void}){
 const engine=presetEngine(preset),label=engineName(engine);
 const [open,setOpen]=useState(false),[entries,setEntries]=useState<LibraryPreset[]>([]),[extra,setExtra]=useState<SoundPreset[]>([]),[identity,setIdentity]=useState(()=>readIdentity(engine)),[medium,setMedium]=useState<DeviceMedium>(0),[working,setWorking]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
 const [browserFolder,setBrowserFolder]=useState<string|null>(null),[browserQuery,setBrowserQuery]=useState(''),[factoryFolder,setFactoryFolder]=useState<string|null>(null),[factoryQuery,setFactoryQuery]=useState(''),[selected,setSelected]=useState<string[]>([]),[organizing,setOrganizing]=useState<LibraryPreset>(),[organizingDevice,setOrganizingDevice]=useState<DeviceRow>();
 const library=useDeviceLibrary(open?client:undefined,engine,medium);
 const pendingDevice=useRef<{engine:number;name:string}|undefined>(undefined);
 const dialog=useRef<HTMLDialogElement>(null),launcher=useRef<HTMLButtonElement>(null),files=useRef<HTMLInputElement>(null);
 const {link,folder}=identity;
 const updateIdentity=(next:Partial<Identity>)=>setIdentity(v=>({...v,...next}));
 useAutosave(()=>writeIdentity(engine,identity),[engine,identity]);
 useEffect(()=>{void readLibrary().then(setEntries).catch(e=>setError(String(e)));},[]);
 useEffect(()=>{if(!open)return;const d=dialog.current;d?.showModal();void readLibrary().then(setEntries).catch(e=>setError(String(e)));return()=>{d?.close();launcher.current?.focus();};},[open]);
 const operation=async(fn:()=>Promise<void>)=>{setWorking(true);onBusy?.(true);setError('');setNotice('');try{await fn();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{onBusy?.(false);setWorking(false);}};
 const run=(fn:()=>Promise<void>)=>void operation(fn);
 const mine=entries.filter(e=>presetEngine(e.preset)===engine),linked=mine.find(e=>e.id===link.browser);
 const factory:LibraryPreset[]=[...(engine===2?factoryPhysicalPresets:factoryClassicPresets.filter(p=>p.engine===engine)),...extra].map((p,i)=>({id:`factory-${i}`,preset:p,folder:'factoryBank' in p?p.factoryBank??'Factory':'Factory',favorite:false,updated:0}));
 const current=()=>storedPreset({...preset,name:presetName(preset.name)});
 // A device audition is only read back (with any PCM) when it is needed.
 const sound=async()=>pendingDevice.current&&client?storedPreset(await client.readSound(pendingDevice.current.name)):current();
 const refreshEntries=async()=>setEntries(await readLibrary());

 const saveBrowser=async(p:SoundPreset,path:string,linkedId?:string)=>{
  const t=browserSaveTarget(await readLibrary(),engine,linkedId,p.name,path);
  if(t.conflict&&!window.confirm(`Overwrite “${p.name}” in ${folderName(path)} in this browser?`))return undefined;
  const entry:LibraryPreset={id:t.id??crypto.randomUUID(),preset:p,folder:path,favorite:t.favorite,updated:Date.now()};
  await putLibraryPreset(entry);if(t.remove)await removeLibraryPreset(t.remove);await refreshEntries();return entry;
 };
 const saveCurrentToBrowser=(asNew:boolean)=>run(async()=>{const p=current(),path=libraryFolder(folder),entry=await saveBrowser(p,path,asNew?undefined:link.browser);if(!entry)return;updateIdentity({folder:path,link:{...link,browser:entry.id}});setNotice(`Saved “${p.name}” in this browser${p.format!=='hexboard.advanced.v2'&&p.sample.enabled?', including its sample':''}.`);});
 const saveCurrentToHexBoard=()=>run(async()=>{
  if(!client)return;const p=current(),path=libraryFolder(folder),d=link.device,replace=d&&d.folder===path?d:undefined;
  const favorite=!!replace&&!!library.catalog?.rows.find(row=>row.id===replace.slot)?.label.favorite;
  const r=await client.saveDevicePreset(p,replace?replace.slot:deviceEngineBase(engine),{name:p.name,folder:path,favorite},replace?replace.medium:medium,undefined,!replace);
  updateIdentity({folder:path,link:{...link,device:{slot:r.slot,folder:path,medium:r.medium===2?2:1}}});await library.refresh([folderOf(r.slot)]);setNotice(`Saved “${p.name}” to the HexBoard ${r.medium===2?'SD card':'internal flash'}.`);
 });
 const loadBrowser=async(row:LibraryPreset)=>{pendingDevice.current=undefined;await onLoad(storedPreset(row.preset));updateIdentity({folder:row.folder,link:{browser:row.id}});setNotice(`Loaded ${row.preset.name}.`);};
 const loadFactory=async(row:LibraryPreset)=>{pendingDevice.current=undefined;await onLoad(storedPreset(row.preset));updateIdentity({folder:'',link:{}});setNotice(`Loaded ${row.preset.name}. Save it to keep your changes.`);};
 const loadDevice=async(r:DeviceRow)=>{const s=await client!.presetCatalog(2,r.id,r.medium);pendingDevice.current={engine:r.label.engine,name:r.label.name};updateIdentity({folder:r.label.folder,link:{device:{slot:r.id,folder:r.label.folder,medium:r.medium}}});setNotice(`Loaded ${r.label.name} in ${(s.elapsedMs/1000).toFixed(2)} s.`);};
 const loadFavorite=async(f:DeviceFavorite)=>{
  const s=await client!.presetCatalog(2,f.slot,f.medium);pendingDevice.current={engine:f.engine,name:f.name};
  const row=library.catalog?.rows.find(r=>r.id===f.slot&&r.medium===f.medium);updateIdentity({folder:row?.label.folder??'',link:{device:{slot:f.slot,folder:row?.label.folder??'',medium:f.medium}}});
  setNotice(`Loaded ${f.name} in ${(s.elapsedMs/1000).toFixed(2)} s.`);
 };
 // Saving never changes the playing sound: the HexBoard stores it without loading it.
 const copyToHexBoard=async(rows:LibraryPreset[])=>{
  if(!client||!rows.length)return;const touched=new Set<number>();let copied=0;
  try{for(const r of rows){const s=await client.saveDevicePreset(r.preset,deviceEngineBase(engine),{name:r.preset.name,folder:r.folder,favorite:false},medium,undefined,true);touched.add(folderOf(s.slot));copied++;}}
  finally{if(touched.size)await library.refresh([...touched]);}
  setSelected([]);setNotice(`Copied ${copied===1?`“${rows[0].preset.name}”`:`${copied} presets`} to the HexBoard.`);
 };
 const copyToBrowser=async(r:DeviceRow)=>{await loadDevice(r);const p=storedPreset(await client!.readSound(r.label.name)),entry=await saveBrowser(p,libraryFolder(r.label.folder));if(!entry)return;updateIdentity({folder:entry.folder,link:{browser:entry.id,device:{slot:r.id,folder:r.label.folder,medium:r.medium}}});setNotice(`Copied ${r.label.name} to this browser.`);};
 const replaceDevice=async(r:DeviceRow)=>{
  const p=await sound();if(!window.confirm(`Replace “${r.label.name}” on the HexBoard with “${p.name}”?`))return;
  await client!.saveDevicePreset(p,r.id,{name:p.name,folder:r.label.folder,favorite:r.label.favorite},r.medium,undefined,false);
  updateIdentity({folder:r.label.folder,link:{...link,device:{slot:r.id,folder:r.label.folder,medium:r.medium}}});await library.refresh([folderOf(r.id)]);setNotice(`Replaced ${r.label.name} on the HexBoard.`);
 };
 const favoriteDevice=async(r:DeviceRow)=>{
  const on=!r.label.favorite;if(on&&library.favorites.length>=deviceFavoriteLimit)throw Error(`The HexBoard already has ${deviceFavoriteLimit} favorites. Remove one before adding another.`);
  await client!.relabelDevicePreset(r.id,{name:r.label.name,folder:r.label.folder,favorite:on},r.medium);await library.refresh([folderOf(r.id)]);
 };
 const unfavoriteDevice=async(f:DeviceFavorite)=>{
  // Favorites span engines; read the sound's own label so it stays in its folder.
  await client!.presetCatalog(5,f.slot,f.medium);const l=await client!.presetLabel(f.slot);
  await client!.relabelDevicePreset(f.slot,{name:l.name,folder:l.folder,favorite:false},f.medium);
  if(Math.floor(f.slot/1024)*1024===deviceEngineBase(engine))await library.refresh([folderOf(f.slot)]);else await library.refreshFavorites();
 };
 const organizeDevice=async(r:DeviceRow,name:string,path:string)=>{
  const conflict=library.catalog?.rows.find(row=>row.id!==r.id&&row.label.name===name&&row.label.folder===path);
  const s=await client!.relabelDevicePreset(r.id,{name,folder:path,favorite:r.label.favorite},r.medium);
  if(conflict)await client!.presetCatalog(3,conflict.id,conflict.medium);
  if(link.device?.slot===r.id){updateIdentity({folder:path,link:{...link,device:{slot:s.slot,folder:path,medium:r.medium}}});onRename(name);}
  await library.refresh([...new Set([folderOf(r.id),folderOf(s.slot)])]);setNotice(`Updated ${name} on the HexBoard.`);
 };
 const deleteDevice=async(r:DeviceRow)=>{if(!window.confirm(`Delete “${r.label.name}” from the HexBoard?`))return;await client!.presetCatalog(3,r.id,r.medium);if(link.device?.slot===r.id)updateIdentity({link:{...link,device:undefined}});await library.refresh([folderOf(r.id)]);setNotice(`Deleted ${r.label.name} from the HexBoard.`);};
 const deleteBrowser=async(row:LibraryPreset)=>{if(!window.confirm(`Delete “${row.preset.name}” from this browser?`))return;await removeLibraryPreset(row.id);if(link.browser===row.id)updateIdentity({link:{...link,browser:undefined}});setSelected(v=>v.filter(id=>id!==row.id));await refreshEntries();setNotice(`Deleted ${row.preset.name}.`);};
 const importFiles=(list:File[])=>run(async()=>{
  let added=0,skipped=0;
  for(const file of list){
   if(file.name.toLowerCase().endsWith('.syx')){if(engine!==5){skipped++;continue;}const bank=importDx7(new Uint8Array(await file.arrayBuffer())).map(p=>({...p,factoryBank:file.name.replace(/\.syx$/i,'')}));setExtra(v=>[...v,...bank]);setFactoryFolder(null);setNotice(`${bank.length} DX7 voices are under Factory. Load one, then save it to keep it.`);continue;}
   for(const p of importedPresets(JSON.parse(await file.text()))){if(presetEngine(p)!==engine){skipped++;continue;}await putLibraryPreset({id:crypto.randomUUID(),folder:'Imports',favorite:false,updated:Date.now(),preset:p});added++;}
  }
  await refreshEntries();if(added){setBrowserFolder('Imports');setNotice(`Imported ${added} preset${added===1?'':'s'} into Imports${skipped?`; skipped ${skipped} for another engine`:''}.`);}else if(skipped)setError(`No ${label} presets found. Open the matching engine to import those files.`);
 });
 const close=()=>run(async()=>{if(pendingDevice.current){const p=pendingDevice.current;await onDeviceLoad(p.engine,p.name);pendingDevice.current=undefined;}setOpen(false);});

 const visibleBrowser=filterEntries(mine,browserFolder,browserQuery),visibleIds=visibleBrowser.map(r=>r.id),selectedRows=mine.filter(r=>selected.includes(r.id));
 const visibleFactory=filterEntries(factory,factoryFolder,factoryQuery);
 const where=[linked&&`Browser · ${folderName(linked.folder)}`,link.device&&`HexBoard · ${folderName(link.device.folder)}`].filter(Boolean).join(' and ')||'Not saved yet';
 const fileInput=<input ref={files} className="hiddenFileInput" type="file" multiple accept={engine===5?'.json,.syx':'.json'} onChange={e=>{const list=[...(e.target.files??[])];e.target.value='';if(list.length)importFiles(list);}}/>;
 const status=<>{error&&<p role="alert" className="error">{error}</p>}{!error&&notice&&<p role="status" className="muted">{notice}</p>}</>;

 return <div className="sound-identity">
  {fileInput}
  <div className="sound-identity-bar">
   <button ref={launcher} className="sound-library-button" aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={()=>{setOpen(true);setError('');setNotice('');}}>Library</button>
   <label className="field"><span>Name</span><input value={preset.name} maxLength={60} disabled={disabled||working} onChange={e=>onRename(e.target.value)}/></label>
   <label className="field"><span>Folder</span><input list={`sound-folders-${engine}`} value={folder} maxLength={39} placeholder="Unfiled" disabled={disabled||working} onChange={e=>updateIdentity({folder:e.target.value})}/><datalist id={`sound-folders-${engine}`}>{folderCounts(mine).filter(([f])=>f).map(([f])=><option key={f} value={f}/>)}</datalist></label>
   <div className="row sound-identity-actions">
    <span className="muted sound-identity-where">{where}</span>
    <button type="button" disabled={disabled||working} onClick={()=>saveCurrentToBrowser(false)}>Save to Browser</button>
    <button type="button" className="primary" disabled={disabled||working||!client} title={client?undefined:'Connect HexBoard Advanced to save on the instrument'} onClick={saveCurrentToHexBoard}>Save to HexBoard</button>
    <details className="presetOverflowMenu"><summary aria-label="Sound actions" title="More actions">•••</summary><div className="presetOverflowActions" onClick={closeMenu}>
     <button type="button" disabled={disabled||working} onClick={()=>saveCurrentToBrowser(true)}>Save as new in Browser</button>
     <button type="button" disabled={disabled||working} onClick={()=>downloadPreset(current())}>Export file</button>
     <button type="button" disabled={disabled||working} onClick={()=>files.current?.click()}>Import files…</button>
    </div></details>
   </div>
  </div>
  {!open&&status}
  {/* Rendered at page level so it shares the tuning library's styling rather than the editor's controls. */}
  {open&&createPortal(<dialog ref={dialog} className="tuningLibraryDialog soundLibraryDialog" aria-labelledby={`sound-library-title-${engine}`} onCancel={e=>{e.preventDefault();if(!working)close();}} onClick={e=>{if(e.target===dialog.current&&!working)close();}}>
   <div className="stack tuningLibraryContent">
    <div className="libraryToolbar">
     <div><span className="eyebrow">{label}</span><h2 id={`sound-library-title-${engine}`}>Preset library</h2></div>
     <div className="row">
      <button type="button" disabled={working} onClick={()=>files.current?.click()}>Import Files</button>
      <button type="button" disabled={working||!client} onClick={()=>run(()=>library.refresh())}>Refresh HexBoard</button>
      <button className="dialogCloseButton" type="button" aria-label="Close library" title="Close library" disabled={working} onClick={close}>×</button>
     </div>
    </div>
    <div className="libraryUtilityBar"><span className="muted">Click a sound to load it. The library stays open so you can audition.</span>{working?<span className="muted" role="status">Working…</span>:status}</div>
    <div className="librarySpaces geometryLibrarySpaces soundLibrarySpaces" aria-busy={working}>
     <section className="librarySpace">
      <div className="librarySpaceHeader"><div><h3>Browser Library</h3><span className="muted">Saved in this browser</span></div><span className="countBadge">{visibleBrowser.length}</span></div>
      <input type="search" aria-label="Search browser presets" placeholder="Search presets" value={browserQuery} onChange={e=>setBrowserQuery(e.target.value)}/>
      <FolderChips label="Browser" rows={mine} folder={browserFolder} favorites onFolder={setBrowserFolder}/>
      <LibraryBulkActions selectedCount={selectedRows.length} visibleCount={visibleIds.length} allVisibleSelected={visibleIds.length>0&&visibleIds.every(id=>selected.includes(id))} transferLabel="Copy selected to HexBoard" transferDisabled={!client} busy={working} onSelectVisible={on=>setSelected(v=>on?[...new Set([...v,...visibleIds])]:v.filter(id=>!visibleIds.includes(id)))} onClear={()=>setSelected([])} onTransfer={()=>run(()=>copyToHexBoard(selectedRows))} onExport={()=>downloadPresets(selectedRows.map(r=>r.preset),`${label} presets`)}/>
      <ul className="list">
       {visibleBrowser.length===0?<li className="emptyListItem">{browserQuery.trim()?`No presets match “${browserQuery.trim()}”`:mine.length?'No presets in this folder':'Use Save to Browser to keep your first sound, or start from Factory'}</li>:visibleBrowser.map(row=><li key={row.id} className={`listItem presetListItem${row.id===link.browser?' activeListItem':''}`}>
        <label className="libraryItemSelection" title={`Select ${row.preset.name}`}><input type="checkbox" aria-label={`Select ${row.preset.name}`} checked={selected.includes(row.id)} onChange={e=>setSelected(v=>e.target.checked?[...v,row.id]:v.filter(id=>id!==row.id))}/></label>
        <button className="presetNameButton" type="button" disabled={working} title={`Load ${row.preset.name}`} onClick={()=>run(()=>loadBrowser(row))}><strong>{row.preset.name}</strong><span>{folderName(row.folder)}{row.preset.format!=='hexboard.advanced.v2'&&row.preset.sample.enabled?' · Sample':''}</span></button>
        <button type="button" className="iconButton soundFavorite" aria-pressed={row.favorite} aria-label={`${row.favorite?'Unfavorite':'Favorite'} ${row.preset.name}`} disabled={working} onClick={()=>run(async()=>{if(!row.favorite&&entries.filter(e=>e.favorite).length>=browserFavoriteLimit)throw Error(`This browser already has ${browserFavoriteLimit} favorites across all engines. Remove one before adding another.`);await putLibraryPreset({...row,favorite:!row.favorite});await refreshEntries();})}>{row.favorite?'★':'☆'}</button>
        <details className="presetOverflowMenu"><summary aria-label={`More actions for ${row.preset.name}`} title="More actions">•••</summary><div className="presetOverflowActions" onClick={closeMenu}>
         <button type="button" disabled={working} onClick={()=>run(()=>loadBrowser(row))}>Load</button>
         <button type="button" disabled={working} onClick={()=>setOrganizing(row)}>Rename / Move</button>
         <button type="button" disabled={working||!client} onClick={()=>run(()=>copyToHexBoard([row]))}>Copy to HexBoard</button>
         <button type="button" onClick={()=>downloadPreset(row.preset)}>Export file</button>
         <button type="button" className="warning" disabled={working} onClick={()=>run(()=>deleteBrowser(row))}>Delete</button>
        </div></details>
       </li>)}
      </ul>
     </section>
     <DevicePresetLibrary client={client} library={library} medium={medium} onMedium={setMedium} activeSlot={link.device?.slot} busy={working} run={run} onLoad={loadDevice} onLoadFavorite={loadFavorite} onCopy={copyToBrowser} onReplace={replaceDevice} onDelete={deleteDevice} onOrganize={setOrganizingDevice} onFavorite={favoriteDevice} onUnfavorite={unfavoriteDevice}/>
     <section className="librarySpace">
      <div className="librarySpaceHeader"><div><h3>Factory</h3><span className="muted">Read-only starting points</span></div><span className="countBadge">{visibleFactory.length}</span></div>
      <input type="search" aria-label="Search factory presets" placeholder="Search factory" value={factoryQuery} onChange={e=>setFactoryQuery(e.target.value)}/>
      <FolderChips label="Factory" rows={factory} folder={factoryFolder} onFolder={setFactoryFolder}/>
      <ul className="list">
       {visibleFactory.length===0?<li className="emptyListItem">No presets match “{factoryQuery.trim()}”</li>:visibleFactory.map(row=><li key={row.id} className="listItem presetListItem">
        <button className="presetNameButton" type="button" disabled={working} title={`Load ${row.preset.name}`} onClick={()=>run(()=>loadFactory(row))}><strong>{row.preset.name}</strong><span>{folderName(row.folder)}</span></button>
        <details className="presetOverflowMenu"><summary aria-label={`More actions for ${row.preset.name}`} title="More actions">•••</summary><div className="presetOverflowActions" onClick={closeMenu}>
         <button type="button" disabled={working} onClick={()=>run(()=>loadFactory(row))}>Load</button>
         <button type="button" disabled={working} onClick={()=>run(async()=>{const entry=await saveBrowser(storedPreset(row.preset),'Factory copies');if(entry){setBrowserFolder('Factory copies');setNotice(`Copied ${row.preset.name} to Factory copies.`);}})}>Copy to Browser</button>
         <button type="button" onClick={()=>downloadPreset(row.preset)}>Export file</button>
        </div></details>
       </li>)}
      </ul>
     </section>
    </div>
   </div>
   {organizing&&<OrganizeLibraryItemDialog itemLabel="preset" libraryLabel="Browser Library" name={organizing.preset.name} folderPath={organizing.folder} folders={folderCounts(mine).map(([f])=>f)} maxNameLength={60} maxFolderLength={39} normalizeName={presetName} normalizeFolderPath={libraryFolder} folderLabel={folderName}
    findConflict={(name,path)=>{const c=sameName(mine,engine,name,path,organizing.id);return c?{name:c.preset.name,folderPath:c.folder}:null;}}
    onCancel={()=>setOrganizing(undefined)}
    onSave={async(name,path)=>{const row=organizing,c=sameName(mine,engine,name,path,row.id);await putLibraryPreset({...row,folder:path,preset:{...row.preset,name},updated:Date.now()});if(c)await removeLibraryPreset(c.id);await refreshEntries();if(link.browser===row.id){onRename(name);updateIdentity({folder:path});}setNotice(`Updated ${name}.`);return true;}}/>}
   {organizingDevice&&<OrganizeLibraryItemDialog itemLabel="preset" libraryLabel="HexBoard Library" name={organizingDevice.label.name} folderPath={organizingDevice.label.folder} folders={(library.catalog?.folders??[]).filter(f=>f.mask).map(f=>f.name)} maxNameLength={60} maxFolderLength={39} normalizeName={presetName} normalizeFolderPath={libraryFolder} folderLabel={folderName}
    findConflict={(name,path)=>{const c=library.catalog?.rows.find(r=>r.id!==organizingDevice.id&&r.label.name===name&&r.label.folder===path);return c?{name:c.label.name,folderPath:c.label.folder}:null;}}
    onCancel={()=>setOrganizingDevice(undefined)}
    onSave={async(name,path)=>{await operation(()=>organizeDevice(organizingDevice,name,path));return true;}}/>}
  </dialog>,document.body)}
 </div>;
}
