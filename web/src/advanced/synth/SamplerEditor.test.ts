import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {SamplerEditor} from './SamplerEditor.tsx';
import {AdvancedSynthEditor} from './AdvancedSynthEditor.tsx';
import {decodePhysicalState} from './client.ts';
import {initialPreset} from './schema.ts';
import {crc32,preparePatch} from './sampler/prepare.mjs';
describe('Advanced sampler',()=>{
 it('offers a simple authoring surface with automatic pitch preparation',()=>{const html=renderToStaticMarkup(createElement(SamplerEditor,{}));for(const label of ['Sampler editor','Sound on SD','KW upright','Instrument','Kit','Attack','Release','Tone','Expression','Export sound','Save sound to SD','prepared automatically'])expect(html).toContain(label);});
 it('shows the sampler engine selector while keeping device capability gating',()=>{const html=renderToStaticMarkup(createElement(AdvancedSynthEditor,{engines:true,sampler:true}));expect(html).toContain('Sampler');});
 it('protects all header fields and preserves stereo level sizes in exported packages',async()=>{const left=Float32Array.from({length:1025},(_,i)=>.2*Math.sin(i*.1)),right=Float32Array.from(left,x=>-x);const prepared=await preparePatch({name:'Stereo',assets:[{name:'Recorded',channels:[left,right],rate:44100,rootMidi:60,mode:1}]});const bytes=prepared.bytes,view=new DataView(bytes.buffer),header=bytes.slice(0,128),stored=view.getUint32(36,true);header.fill(0,36,40);expect(crc32(header)).toBe(stored);header[48]^=1;expect(crc32(header)).not.toBe(stored);expect(view.getUint8(152)).toBe(2);expect(view.getUint32(128+48+4,true)).toBe(1025);expect(view.getUint32(128+48+16+4,true)).toBe(513);});
});
