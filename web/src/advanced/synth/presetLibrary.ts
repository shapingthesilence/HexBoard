import {physicalPresetFromUnknown,defaultSample,type PhysicalPreset} from './schema.ts';
import {classicFromUnknown,type ClassicPreset} from './classicSchema.ts';
export type SoundPreset=PhysicalPreset|ClassicPreset;
export interface LibraryPreset {id:string;folder:string;favorite:boolean;updated:number;preset:SoundPreset}
export const presetEngine=(p:SoundPreset):2|4|5=>p.format==='hexboard.advanced.v2'?p.engine:2;
// Only the selected exciter owns a resident asset. Editing can retain an import
// temporarily, but saving/loading a sound never carries an unused PCM buffer.
export function storedPreset(value:unknown):SoundPreset {
 const p=(value as {format?:string})?.format==='hexboard.advanced.v2'?classicFromUnknown(value):physicalPresetFromUnknown(value);
 if(p.format==='hexboard.advanced.v2')return p;
 return p.sample.enabled&&p.sample.frames.length&&p.parameters[21]<=32767?p:{...p,sample:defaultSample()};
}
export function libraryFolder(value:string){return value.trim().split('/').map(v=>v.trim()).filter(Boolean).join('/').slice(0,120);}
export function libraryEntry(value:unknown):LibraryPreset {
 const v=value as LibraryPreset;if(!v||typeof v.id!=='string'||!v.id||typeof v.folder!=='string'||typeof v.favorite!=='boolean'||!Number.isFinite(v.updated))throw Error('Invalid library entry.');
 return {id:v.id,folder:libraryFolder(v.folder),favorite:v.favorite,updated:v.updated,preset:storedPreset(v.preset)};
}
const database='hexboard.advanced.presets.v1';
function open():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const r=indexedDB.open(database,1);r.onupgradeneeded=()=>{r.result.createObjectStore('presets',{keyPath:'id'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('Could not open the computer preset library.'));});}
async function transaction<T>(store:'presets',mode:IDBTransactionMode,run:(s:IDBObjectStore)=>IDBRequest<T>):Promise<T>{const db=await open();try{return await new Promise<T>((resolve,reject)=>{const tx=db.transaction(store,mode),request=run(tx.objectStore(store));let value:T;request.onsuccess=()=>{value=request.result;};tx.oncomplete=()=>resolve(value);tx.onerror=tx.onabort=()=>reject(Error('Preset storage failed. Check available browser storage.'));});}finally{db.close();}}
export const putLibraryPreset=(entry:LibraryPreset)=>transaction('presets','readwrite',s=>s.put(libraryEntry(entry)));
export const removeLibraryPreset=(id:string)=>transaction('presets','readwrite',s=>s.delete(id));
export async function readLibrary():Promise<LibraryPreset[]>{return (await transaction('presets','readonly',s=>s.getAll())).map(libraryEntry);}
function download(data:unknown,name:string){const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`${name.replace(/[^a-z0-9_-]/gi,'_')}.hexboard.json`;a.click();URL.revokeObjectURL(url);}
export function downloadPreset(value:unknown){const p=storedPreset(value);download(p,p.name);}
export function downloadPresets(values:unknown[],name:string){download(values.map(storedPreset),name);}
// Import accepts a single exported sound or an exported selection (array).
export function importedPresets(data:unknown):SoundPreset[]{return (Array.isArray(data)?data:[data]).map(storedPreset);}
// Pick an action, then fold the ••• menu away.
export const closeMenu=(e:{currentTarget:Element})=>e.currentTarget.closest('details')?.removeAttribute('open');
export const folderName=(folder:string)=>folder||'Unfiled';
export const presetName=(value:string)=>value.trim().slice(0,60)||'Untitled';
// Favorites is a filter, not a folder; it cannot collide with a normalized path.
export const favoritesFilter='\u0000favorites';
export function filterEntries(rows:LibraryPreset[],folder:string|null,query:string){
 const q=query.trim().toLowerCase();
 return rows.filter(r=>(folder===null||(folder===favoritesFilter?r.favorite:r.folder===folder))&&(!q||`${r.preset.name} ${r.folder}`.toLowerCase().includes(q)))
  .sort((a,b)=>a.folder.localeCompare(b.folder)||a.preset.name.localeCompare(b.preset.name,undefined,{numeric:true}));
}
export function folderCounts(rows:LibraryPreset[]){const counts=new Map<string,number>();for(const r of rows)counts.set(r.folder,(counts.get(r.folder)??0)+1);return [...counts].sort(([a],[b])=>a.localeCompare(b));}
export function sameName(rows:LibraryPreset[],engine:number,name:string,folder:string,except?:string){return rows.find(r=>r.id!==except&&presetEngine(r.preset)===engine&&r.folder===folder&&r.preset.name===name);}
/** Saving updates the linked browser sound in place. An unlinked save, or a
 * rename that lands on another sound, names the entry it would overwrite. */
export function browserSaveTarget(rows:LibraryPreset[],engine:number,linked:string|undefined,name:string,folder:string){
 const own=linked?rows.find(r=>r.id===linked&&presetEngine(r.preset)===engine):undefined,conflict=sameName(rows,engine,name,folder,own?.id);
 return own?{id:own.id,favorite:own.favorite,remove:conflict?.id,conflict}:{id:conflict?.id,favorite:conflict?.favorite??false,conflict};
}
