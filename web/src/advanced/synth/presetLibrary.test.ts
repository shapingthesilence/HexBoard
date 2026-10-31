import {describe,it,expect} from 'vitest';
import {initialPreset,defaultSampleLoop} from './schema.ts';
import {initialClassic} from './classicSchema.ts';
import {storedPreset,libraryEntry,libraryFolder,presetEngine,browserSaveTarget,filterEntries,favoritesFilter,importedPresets,type LibraryPreset} from './presetLibrary.ts';
describe('Advanced sound library',()=>{
 it('embeds active excitation PCM and loop settings without changing the source',()=>{const p=structuredClone(initialPreset);p.parameters[21]=0;p.sample={...p.sample,enabled:true,name:'Rain',frames:Array(400).fill(123),loop:{mode:1,start:40,end:360,crossfade:40}};const result=storedPreset(p);expect(result).toEqual(p);expect(result).not.toBe(p);});
 it('discards inactive and bow-bypassed PCM on storage or a full sound switch',()=>{for(const bow of [false,true]){const p=structuredClone(initialPreset);p.parameters[21]=bow?65535:0;p.sample={...p.sample,enabled:bow,name:'Unused',frames:Array(400).fill(123),loop:{mode:1,start:0,end:400,crossfade:20}};const result=storedPreset(p);if(result.format==='hexboard.advanced.v2')throw Error('Wrong type');expect(result.sample.enabled).toBe(false);expect(result.sample.frames).toEqual([]);expect(result.sample.name).toBe('');expect(result.sample.loop).toEqual(defaultSampleLoop());expect(p.sample.frames).toHaveLength(400);}});
 it('keeps a sample saved in a different preset independent of replacement',()=>{const p=structuredClone(initialPreset);p.sample={...p.sample,enabled:true,frames:[0,123,-123,0]};const saved=storedPreset(p);storedPreset(initialPreset);if(saved.format==='hexboard.advanced.v2')throw Error('Wrong type');expect(saved.sample.frames).toEqual([0,123,-123,0]);});
 it('keeps names and folders separate from stable identity',()=>{const entry=libraryEntry({id:'stable-id',preset:initialClassic(4),folder:' / Pianos // Glass / ',favorite:true,updated:4});expect(entry.id).toBe('stable-id');expect(entry.folder).toBe('Pianos/Glass');expect(entry.favorite).toBe(true);expect(presetEngine(entry.preset)).toBe(4);expect(libraryFolder('  / / ')).toBe('');expect(()=>libraryEntry({...entry,id:''})).toThrow();});
 it('updates the linked sound in place and names any sound a save would overwrite',()=>{const row=(id:string,name:string,folder:string,engine:4|5=4):LibraryPreset=>({id,folder,favorite:id==='a',updated:1,preset:{...initialClassic(engine),name}});const rows=[row('a','Brass','Leads'),row('b','Pad','Pads'),row('c','Pad','Pads',5)];
  expect(browserSaveTarget(rows,4,'a','Brass 2','Leads')).toEqual({id:'a',favorite:true,remove:undefined,conflict:undefined});
  expect(browserSaveTarget(rows,4,'a','Pad','Pads')).toMatchObject({id:'a',remove:'b'});
  expect(browserSaveTarget(rows,4,undefined,'Pad','Pads')).toMatchObject({id:'b',conflict:rows[1]});
  expect(browserSaveTarget(rows,4,'c','New','Pads')).toEqual({id:undefined,favorite:false,conflict:undefined});
  expect(filterEntries(rows,favoritesFilter,'').map(r=>r.id)).toEqual(['a']);expect(filterEntries(rows,'Pads','pad').map(r=>r.id)).toEqual(['b','c']);});
 it('imports single sounds and exported selections',()=>{expect(importedPresets(initialClassic(4))).toHaveLength(1);expect(importedPresets([initialClassic(4),initialPreset])).toHaveLength(2);});
});
