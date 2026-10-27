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
function open():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const r=indexedDB.open(database,1);r.onupgradeneeded=()=>{r.result.createObjectStore('presets',{keyPath:'id'});r.result.createObjectStore('meta');};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('Could not open the computer preset library.'));});}
async function transaction<T>(store:'presets'|'meta',mode:IDBTransactionMode,run:(s:IDBObjectStore)=>IDBRequest<T>):Promise<T>{const db=await open();try{return await new Promise<T>((resolve,reject)=>{const tx=db.transaction(store,mode),request=run(tx.objectStore(store));let value:T;request.onsuccess=()=>{value=request.result;};tx.oncomplete=()=>resolve(value);tx.onerror=tx.onabort=()=>reject(Error('Preset storage failed. Check available browser storage.'));});}finally{db.close();}}
export const putLibraryPreset=(entry:LibraryPreset)=>transaction('presets','readwrite',s=>s.put(libraryEntry(entry)));
export const removeLibraryPreset=(id:string)=>transaction('presets','readwrite',s=>s.delete(id));
export async function readLibrary():Promise<LibraryPreset[]>{
 if(!await transaction('meta','readonly',s=>s.get('imported-local-libraries'))){
  // Keep the old keys as a recovery copy. IDs are deterministic, so an
  // interrupted import is harmless and can be retried.
  for(const [engine,key] of [[2,'hexboard.physical.library.v1'],[4,'hexboard.advanced.4.library'],[5,'hexboard.advanced.5.library']] as const){
   let old:unknown;try{old=JSON.parse(localStorage.getItem(key)??'[]');}catch{continue;}
   if(Array.isArray(old))for(let i=0;i<old.length;i++){let p:SoundPreset;try{p=storedPreset(old[i]);}catch{continue;}await putLibraryPreset({id:`legacy-${engine}-${i}`,folder:'',favorite:false,updated:0,preset:p});}
  }
  await transaction('meta','readwrite',s=>s.put(true,'imported-local-libraries'));
 }
 return (await transaction('presets','readonly',s=>s.getAll())).map(libraryEntry);
}
export function downloadPreset(value:unknown){const p=storedPreset(value),url=URL.createObjectURL(new Blob([JSON.stringify(p)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`${p.name.replace(/[^a-z0-9_-]/gi,'_')}.hexboard.json`;a.click();URL.revokeObjectURL(url);}
