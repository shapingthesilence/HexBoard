import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {SamplerKeyPreview} from './SamplerKeyPreview.tsx';
import {samplerKeys,assignSequentially,mappedZones,removeRecording,sliceRecording} from './sampler/mapping.ts';
import {preparePatch} from './sampler/prepare.mjs';
describe('Sampler physical key map',()=>{
 it('maps all 133 Advanced scanner keys and excludes the command column',()=>{expect(samplerKeys).toHaveLength(133);expect(samplerKeys.map(k=>k.key)).toEqual(Array.from({length:133},(_,i)=>i));expect(samplerKeys[0].index).toBe(1);expect(samplerKeys[8].index).toBe(9);expect(samplerKeys[9].index).toBe(10);expect(samplerKeys.at(-1)?.index).toBe(139);});
 it('renders keyboard-accessible keys with sound names and selected assignments',()=>{const html=renderToStaticMarkup(createElement(SamplerKeyPreview,{map:assignSequentially(2),names:['Kick','Snare'],selected:1,onSelect:()=>{}}));expect(html.match(/type="button"/g)).toHaveLength(133);expect(html).toContain('Key 1: Kick');expect(html).toContain('Key 2: Snare');expect(html).toContain('Key 133: Unassigned');expect(html).toContain('aria-pressed="true"');});
 it('preserves remapped sample/color pairs when a recording is removed',()=>{expect(removeRecording({0:{asset:0,color:'#123456'},132:{asset:2,color:'#abcdef'}},0)).toEqual({132:{asset:1,color:'#abcdef'}});});
 it('keeps every stereo frame in contiguous slices with a common root',()=>{const left=Float32Array.from({length:103},(_,i)=>i),right=Float32Array.from(left,x=>-x),slices=sliceRecording({channels:[left,right],rate:44100,rootMidi:43},7);expect(slices.flatMap(s=>Array.from(s.channels[0]))).toEqual(Array.from(left));expect(slices.flatMap(s=>Array.from(s.channels[1]))).toEqual(Array.from(right));expect(slices.every(s=>s.mode===2&&s.rootMidi===43)).toBe(true);});
 it('exports a remapped physical key with its color and fixed sample pitch',async()=>{const result=await preparePatch({assets:[{channels:[new Float32Array(512)],rate:44100,rootMidi:60}],zones:mappedZones({132:{asset:0,color:'#1a2b3c'}},1)}),v=new DataView(result.bytes.buffer),at=128+48+v.getUint16(14,true)*16;expect(v.getUint16(at+10,true)).toBe(132);expect(Array.from(result.bytes.slice(at+20,at+25))).toEqual([1,26,43,60,1]);});
});
