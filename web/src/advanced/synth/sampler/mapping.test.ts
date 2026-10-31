import {describe,it,expect} from 'vitest';
import {mappedZones,sliceRecording,assignSequentially} from './mapping.ts';
import {preparePatch} from './prepare.mjs';
import type {Recording} from './prepare.mjs';
describe('Sampler key editing and slices',()=>{
 it('preserves existing per-key sound settings when editing an assignment color',()=>{const old={asset:0,key:9,color:'#112233',release:780,attack:35,gain:.7,pan:-.3,choke:3};const zones=mappedZones({9:{asset:0,color:'#abcdef'},10:{asset:1,color:'#aabbcc'}},2,[old]);expect(zones[0]).toMatchObject({...old,color:'#abcdef'});expect(zones[1].release).toBeUndefined();expect(old.color).toBe('#112233');expect(mappedZones({9:{asset:1,color:'#abcdef'}},2,[old])[0].release).toBeUndefined();});
 it('slices retained audio and resets old trim/loop coordinates without touching PCM',async()=>{const data=Float32Array.from({length:1024},(_,i)=>i/2048);const a:Recording={id:'source',name:'Trimmed reed',rate:44100,rootMidi:69.0123,channels:[data,data],start:100,end:900,mode:1,loopStart:300,loopEnd:850,crossfade:3};const slices=sliceRecording(a,4);expect(slices).toHaveLength(4);expect(new Set(slices.map(s=>s.id)).size).toBe(4);expect(slices[0].channels[0]).toEqual(data.slice(100,300));for(const s of slices){expect(s).toMatchObject({start:0,end:200,rootMidi:69.0123,mode:2,crossfade:0});expect(s.loopStart).toBeUndefined();expect(s.loopEnd).toBeUndefined();}expect(a.channels[0]).toBe(data);await expect(preparePatch({assets:slices,zones:mappedZones(assignSequentially(slices.length),slices.length)})).resolves.toBeDefined();});
});
