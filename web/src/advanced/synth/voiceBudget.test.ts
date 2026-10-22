import {describe,it,expect} from 'vitest';
import {attachVoiceBudget,validVoiceBudget,presetFingerprint,type VoiceBudgetState} from './voiceBudget.ts';
import {initialClassic,classicFromUnknown} from './classicSchema.ts';
import {initialPreset,physicalPresetFromUnknown} from './schema.ts';
const result:VoiceBudgetState={phase:3,voices:10,candidate:11,ceiling:13,engine:5,qualified:true,reason:1,signature:0xfedcba98,peakUs:2700,revision:3};
describe('preset voice budget',()=>{
 it('saves a qualification with the preset and preserves it through JSON',()=>{const p=attachVoiceBudget(initialClassic(5),result);const restored=classicFromUnknown(JSON.parse(JSON.stringify(p)));expect(restored.voiceBudget).toEqual(p.voiceBudget);expect(validVoiceBudget(p,p.voiceBudget)?.voices).toBe(10);});
 it('invalidates after every kind of authoring edit',()=>{const p=attachVoiceBudget(initialClassic(5),result);for(const change of [(v:typeof p)=>v.name+=' edit',(v:typeof p)=>v.patch.parameters[1]++,(v:typeof p)=>v.patch.settings[0]++,(v:typeof p)=>v.patch.routes[4]={destination:147,depth:12000},(v:typeof p)=>v.effects.order=[4],(v:typeof p)=>v.effects.values[0][0]++,(v:typeof p)=>v.velocityEngine=1]){const edited=structuredClone(p);change(edited);expect(validVoiceBudget(edited,edited.voiceBudget)).toBeUndefined();expect(classicFromUnknown(edited).voiceBudget).toBeUndefined();}});
 it('supports physical presets and invalidates sample edits',()=>{const p=attachVoiceBudget(physicalPresetFromUnknown(initialPreset),{...result,engine:2,voices:8,ceiling:8});expect(physicalPresetFromUnknown(JSON.parse(JSON.stringify(p))).voiceBudget?.voices).toBe(8);p.sample.gain++;expect(physicalPresetFromUnknown(p).voiceBudget).toBeUndefined();});
 it('rejects stale firmware, impossible counts and over-budget results',()=>{const p=attachVoiceBudget(initialClassic(5),result);for(const changes of [{revision:2},{voices:14},{peakUs:2874},{signature:-1},{fingerprint:'bad'}])expect(validVoiceBudget(p,{...p.voiceBudget,...changes})).toBeUndefined();expect(()=>attachVoiceBudget(initialClassic(5),{...result,qualified:false})).toThrow(/baseline/);});
 it('fingerprints ignore property ordering and the certificate itself',()=>{expect(presetFingerprint({b:2,a:1})).toBe(presetFingerprint({a:1,b:2,voiceBudget:{voices:9}}));});
});
