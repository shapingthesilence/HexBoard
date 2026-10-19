import {it,expect} from 'vitest';
import {sampleLoopFromSelection,prepareSamplePCM,waveformPath,fadeEnvelopePath} from './sampleEditing.ts';
import {defaultFx,defaultSample,initialPreset,physicalPresetFromUnknown} from './schema.ts';
import {sampleChecksum} from './client.ts';
import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {VolumeStepEditor,volumePatterns} from './VolumeStepEditor.tsx';import {SampleEditor} from './SampleEditor.tsx';
it('removes DC, bounds and fades imported PCM while preserving its texture',()=>{
 const input=Float32Array.from({length:8000},(_,i)=>.2+.3*Math.sin(i*.125));const pcm=prepareSamplePCM(input);expect(pcm).toHaveLength(8000);expect(pcm[0]).toBe(0);expect(pcm[7999]).toBe(0);expect(Math.max(...pcm)).toBeLessThan(32768);expect(Math.min(...pcm)).toBeGreaterThan(-32769);expect(Math.abs(pcm.reduce((a,b)=>a+b,0)/pcm.length)).toBeLessThan(30);expect(waveformPath(input)).not.toMatch(/NaN|Infinity/);expect(()=>prepareSamplePCM(new Float32Array(64001))).toThrow();expect(()=>prepareSamplePCM(new Float32Array(30).fill(.4))).toThrow();
});
it('persists sample PCM and volume sequences with strict bounds and upgrades earlier patches',()=>{
 const sample={...defaultSample(),enabled:true,name:'Knock',frames:prepareSamplePCM(Float32Array.from({length:400},(_,i)=>Math.sin(i*.8)*Math.exp(-i/100)))};const p=physicalPresetFromUnknown({...initialPreset,sample});expect(physicalPresetFromUnknown(JSON.parse(JSON.stringify(p)))).toEqual(p);expect(sampleChecksum(sample.frames)).toBe(sampleChecksum([...sample.frames]));expect(()=>physicalPresetFromUnknown({...p,sample:{...sample,frames:[40000]}})).toThrow();const fx=defaultFx();fx.values[2][3]=128;expect(()=>physicalPresetFromUnknown({...p,effects:fx})).toThrow();const old=physicalPresetFromUnknown({...p,format:'hexboard.physical.v20',parameters:p.parameters.slice(0,32),routes:p.routes.slice(0,96),tiltRoutes:p.tiltRoutes.slice(0,64),modulation:{...p.modulation,routes:p.modulation.routes.slice(0,64)}});expect(old.sample.enabled).toBe(false);expect(old.effects.steps).toHaveLength(16);
});
it('renders compact popup sequence and sample editors with keyboard controls',()=>{
 const step=renderToStaticMarkup(createElement(VolumeStepEditor,{rack:defaultFx(),onChange:()=>{},onClose:()=>{}}));expect(step).toContain('role="dialog"');expect(step).toContain('Step 16 volume');expect(step).toContain('Step edge softness');for(const p of volumePatterns)expect(step).toContain(p.name);
 const sample=renderToStaticMarkup(createElement(SampleEditor,{sample:defaultSample(),onApply:async()=>{},onPreview:async()=>{},onClose:()=>{}}));expect(sample).toContain('Preview in string');expect(sample).toContain('Sample trim start');expect(sample).toContain('up to 4 seconds');expect(sample).toContain('Sample fade in milliseconds');expect(sample).toContain('Sample fade out milliseconds');expect(sample).not.toContain('Direct sample');
});

it('applies independent fade lengths without normalizing their attenuation away',()=>{
 const input=Float32Array.from({length:1600},(_,i)=>Math.cos(i*.2));
 const raw=prepareSamplePCM(input,false,0,0),attack=prepareSamplePCM(input,false,20,0),tail=prepareSamplePCM(input,false,0,40);
 expect(raw[0]).not.toBe(0);expect(raw[1599]).not.toBe(0);expect(attack[0]).toBe(0);expect(attack[320]).toBe(raw[320]);expect(attack[1599]).toBe(raw[1599]);expect(tail[0]).toBe(raw[0]);expect(tail[1599]).toBe(0);expect(tail[900]).toBe(raw[900]);expect(Math.abs(tail[1500])).toBeLessThan(Math.abs(raw[1500]));
 for(const times of [[0,0],[20,80],[100,100],[10000,10000]]){const pcm=prepareSamplePCM(input,true,...times as [number,number]);expect(pcm.every(Number.isInteger)).toBe(true);expect(Math.max(...pcm)).toBeLessThan(32768);expect(fadeEnvelopePath(.1,.2,1,...times as [number,number])).not.toMatch(/NaN|Infinity/);}
 expect(()=>prepareSamplePCM(input,true,-1,2)).toThrow();expect(()=>prepareSamplePCM(input,true,NaN,2)).toThrow();
});

it("accepts a complete four-second texture and preserves it through JSON",()=>{const frames=prepareSamplePCM(Float32Array.from({length:64000},(_,i)=>Math.sin(i*.08)));expect(frames).toHaveLength(64000);const p=physicalPresetFromUnknown({...initialPreset,sample:{...defaultSample(),enabled:true,frames}});expect(physicalPresetFromUnknown(JSON.parse(JSON.stringify(p))).sample.frames).toEqual(frames);});

it('preserves loop geometry in presets and converts trimmed markers to PCM frames',()=>{
 const loop=sampleLoopFromSelection(1,.5,.6,1.5,20,16000);expect(loop).toEqual({mode:1,start:1600,end:16000,crossfade:320});
 const sample={...defaultSample(),enabled:true,frames:Array(16000).fill(12000),loop};const p=physicalPresetFromUnknown({...initialPreset,sample});expect(physicalPresetFromUnknown(JSON.parse(JSON.stringify(p))).sample.loop).toEqual(loop);
 expect(sampleLoopFromSelection(2,0,0,.01,200,160)).toEqual({mode:2,start:0,end:160,crossfade:80});
 expect(()=>sampleLoopFromSelection(1,0,0,.005,0,160)).toThrow();expect(()=>physicalPresetFromUnknown({...p,sample:{...sample,loop:{...loop,crossfade:8001}}})).toThrow();
 expect(physicalPresetFromUnknown({...p,sample:{...sample,loop:undefined}}).sample.loop?.mode).toBe(0);
 const ui=renderToStaticMarkup(createElement(SampleEditor,{sample,onApply:async()=>{},onPreview:async()=>{},onClose:()=>{}}));expect(ui).toContain('Loop start marker');expect(ui).toContain('Sample loop release');expect(ui).toContain('Keep looping');expect(ui).toContain('Loop crossfade');
});
