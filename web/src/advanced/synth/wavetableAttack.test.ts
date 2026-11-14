import {it,expect} from 'vitest';
import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {SampleEditor} from './SampleEditor.tsx';import {defaultSample} from './schema.ts';
import {factoryAttackSamples,validateAttack,sampleChecksum,maxAttackFrames,attackRootHz,attackRootWord} from './wavetableAttack.ts';
import {P,initialWavetable,wavetablePreset,wavetableFromUnknown,optionValue,validWavetable,modulatable,wordCount,parameterCount} from './wavetableSchema.ts';
it('saves sample bytes with their checked identity and refuses missing or changed PCM',()=>{
 const attack=factoryAttackSamples[0],p=initialWavetable(),crc=sampleChecksum(attack.frames);
 p.parameters[P.AttackFrames]=attack.frames.length;p.parameters[P.AttackCrcLow]=crc&65535;p.parameters[P.AttackCrcHigh]=crc>>>16;p.parameters[P.TransientShape]=optionValue(P.TransientShape,3);
 const sound=wavetablePreset('Grain',{...p,attack});expect(wavetableFromUnknown(JSON.parse(JSON.stringify(sound)))).toEqual(sound);
 expect(()=>wavetableFromUnknown({...sound,attack:undefined})).toThrow('attack');
 const altered={...attack,frames:[...attack.frames]};altered.frames[100]^=1;expect(()=>wavetableFromUnknown({...sound,attack:altered})).toThrow('attack');
 expect(parameterCount).toBe(100);expect(wordCount).toBe(168);for(const id of [P.AttackFrames,P.AttackCrcLow,P.AttackCrcHigh,P.AttackRoot,P.AttackPlayback])expect(modulatable(id)).toBe(false);
 expect(validWavetable(p)).toBe(true);p.parameters[P.AttackFrames]=4097;expect(validWavetable(p)).toBe(false);
});
it('bounds short samples, keeps contrasting deterministic textures and exact tuning roots',()=>{
 for(const sample of factoryAttackSamples){expect(validateAttack(sample)).toEqual(sample);expect(sample.frames.length).toBeLessThanOrEqual(maxAttackFrames);expect(sample.frames[0]).toBe(0);expect(sample.frames.at(-1)).toBe(0);}
 expect(new Set(factoryAttackSamples.map(s=>sampleChecksum(s.frames))).size).toBe(9);
 expect(()=>validateAttack({name:'long',frames:Array(4097).fill(0)})).toThrow();expect(()=>validateAttack({name:'bad',frames:Array(100).fill(40000)})).toThrow();
 expect(attackRootHz(attackRootWord(220))).toBeCloseTo(220,1);
});
it('reuses the import editor with short one-shot controls and preserves the string editor',()=>{
 const props={sample:defaultSample(),onApply:async()=>{},onPreview:async()=>{},onClose:()=>{}};
 const attack=renderToStaticMarkup(createElement(SampleEditor,{...props,options:{maxFrames:4096,looping:false,title:'Wavetable attack',previewLabel:'Preview in synth'}}));
 expect(attack).toContain('256');expect(attack).toContain('Wavetable attack');expect(attack).toContain('Preview in synth');expect(attack).not.toContain('Sustain loop');
 const physical=renderToStaticMarkup(createElement(SampleEditor,props));expect(physical).toContain('up to 4 seconds');expect(physical).toContain('Sustain loop');expect(physical).toContain('Preview in string');
});
