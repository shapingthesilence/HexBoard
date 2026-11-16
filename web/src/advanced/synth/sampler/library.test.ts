import {describe,it,expect} from 'vitest';
import {decodeSamplerLibrary} from '../client.ts';
function page(first=0,slot=1){const raw=new Uint8Array(144);raw.set(new TextEncoder().encode('Marimba'),slot*36);new DataView(raw.buffer).setUint32(slot*36+32,512,true);return [17,first>>7,first&127,4,...Array.from(raw).flatMap(b=>[b>>7,b&127])];}
describe('sampler SD library',()=>{
 it('preserves sparse slot identity and filters absent files',()=>{expect(decodeSamplerLibrary(page(),0)).toEqual([{id:3,name:'Marimba',bytes:512}]);});
 it('supports the final slot beyond 32 instruments',()=>{expect(decodeSamplerLibrary(page(1020,3),1020)[0].id).toBe(1025);});
 it('rejects truncated pages, bad offsets and non-byte pairs',()=>{const p=page();expect(()=>decodeSamplerLibrary(p.slice(1),0)).toThrow();expect(()=>decodeSamplerLibrary(p,4)).toThrow();p[4]=2;expect(()=>decodeSamplerLibrary(p,0)).toThrow();});
 it('rejects names for missing files and unsafe file sizes',()=>{const p=page();p[5]=65;expect(()=>decodeSamplerLibrary(p,0)).toThrow();const q=page();q[5+(36+32)*2]=1;expect(()=>decodeSamplerLibrary(q,0)).toThrow();});
});
