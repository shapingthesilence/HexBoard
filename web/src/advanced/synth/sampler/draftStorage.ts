import type {Patch} from './prepare.mjs';

// One autosaved working draft per sampler target, kept in this browser only.
export interface SamplerDraft {id:'advanced'|'classic';patch:Patch;template:string;savedAt:string}

let database:Promise<IDBDatabase>|undefined;
function open(){
 database??=new Promise((resolve,reject)=>{
  const request=indexedDB.open('hexboard-sampler-drafts-v1',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('drafts',{keyPath:'id'});
  request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();database=undefined;};resolve(request.result);};
  request.onerror=()=>{database=undefined;reject(request.error);};
  request.onblocked=()=>{database=undefined;reject(new Error('Close other HexBoard tabs to restore the sampler draft.'));};
 });
 return database;
}
async function operation<T>(mode:IDBTransactionMode,action:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T>{
 const db=await open();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('drafts',mode),request=action(tx.objectStore('drafts'));
  tx.oncomplete=()=>resolve(request.result);
  tx.onerror=tx.onabort=()=>reject(tx.error??new Error('Draft storage failed.'));
 });
}
export const samplerDrafts={
 load:(id:SamplerDraft['id'])=>operation<SamplerDraft|undefined>('readonly',store=>store.get(id)),
 save:(id:SamplerDraft['id'],patch:Patch,template:string)=>operation('readwrite',store=>store.put({id,patch:{...patch,preparedSource:undefined},template,savedAt:new Date().toISOString()} satisfies SamplerDraft)),
 remove:(id:SamplerDraft['id'])=>operation('readwrite',store=>store.delete(id)),
};
/** A draft is worth keeping once it holds audio. */
export const draftWorthSaving=(patch:Patch)=>patch.assets.length>0;
