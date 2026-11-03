import manifest from './factory.json';
import {validateAsset,type TableOptions} from './prepare.mjs';
import type {TableAsset} from './library.ts';
export const factoryTables=manifest;
export async function getFactoryTable(id:string):Promise<TableAsset|undefined>{
  const row=factoryTables.find(t=>t.id===id);if(!row)return undefined;
  const base=`${import.meta.env.BASE_URL}advanced-wavetables/${row.file}`;
  const responses=await Promise.all([fetch(`${base}.hwt`),fetch(`${base}.wav`)]);
  if(responses.some(r=>!r.ok))throw Error('Could not load the default table. Check your connection and retry.');
  const [prepared,source]=await Promise.all(responses.map(async r=>new Uint8Array(await r.arrayBuffer())));
  if(validateAsset(prepared)!==row.crc)throw Error('The default table failed its integrity check. Reload Sync and retry.');
  return {id:row.id,name:row.name,crc:row.crc,prepared,source,options:row.options as TableOptions};
}
