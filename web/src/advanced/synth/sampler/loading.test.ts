import {describe,it,expect} from 'vitest';
import {decodeSamplerLoading} from '../client.ts';
import {samplerLoadingLabel} from './loading.ts';
const u35=(x:number)=>Array.from({length:5},(_,i)=>Math.floor(x/2**(7*(4-i)))%128);
const packet=(phase:number,voices:number,ready:number,total:number,loaded:number,size:number)=>[17,phase,voices,ready>>7,ready&127,total>>7,total&127,...u35(loaded),...u35(size),0];
describe('progressive sampler readiness',()=>{
 it('distinguishes playable loading from full polyphony',()=>{const state=decodeSamplerLoading(packet(1,4,3,14,25,100));expect(samplerLoadingLabel(state)).toContain('25%');expect(samplerLoadingLabel(state)).toContain('3/14');expect(samplerLoadingLabel(state)).toContain('4 notes');expect(samplerLoadingLabel(decodeSamplerLoading(packet(2,16,14,14,100,100)))).toBe('Ready · 16 notes available');});
 it('does not claim readiness for checksum errors or incomplete progress',()=>{expect(samplerLoadingLabel(decodeSamplerLoading(packet(3,4,3,14,25,100)))).toContain('reload');for(const p of [packet(2,16,3,14,100,100),packet(2,16,14,14,99,100),packet(1,16,3,14,25,100),packet(3,16,3,14,25,100),packet(1,4,0,0,0,100),packet(1,4,0,14,0,0),packet(1,4,15,14,25,100),packet(1,4,3,14,101,100),packet(1,4,3,14,0,0x40000001)])expect(()=>decodeSamplerLoading(p)).toThrow();});
 it('identifies streaming readiness and rejects unknown extensions',()=>{const ready=[...packet(2,16,14,14,100,100).slice(0,-1),1];expect(samplerLoadingLabel(decodeSamplerLoading(ready))).toBe('Streaming from SD · 16 notes available');expect(samplerLoadingLabel(decodeSamplerLoading([...packet(1,4,3,14,25,100).slice(0,-1),1]))).toContain('Loading sample starts');expect(()=>decodeSamplerLoading([...ready.slice(0,-1),2])).toThrow();expect(()=>decodeSamplerLoading(ready.slice(0,-1))).toThrow();});
 it('shows pending status until telemetry arrives',()=>{expect(samplerLoadingLabel()).toContain('Checking');});
});
