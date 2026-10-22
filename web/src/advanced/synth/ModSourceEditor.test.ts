import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ModSourceEditor,envelopePoints,lfoWave} from './ModSourceEditor.tsx';
import {modulationRouteCount,canAssignModulation,defaultModulation,validateModulation,physicalPresetFromUnknown,initialPreset,effectiveParameters} from './schema.ts';
import {decodeModulation} from './client.ts';
import {encodeU21} from '../../protocol/index.ts';
describe('Editable envelope and LFO sources',()=>{
  it('validates discrete source settings and signed wire routes',()=>{
    for(const id of [7,9,10,14]){const m=defaultModulation();m.settings[id]=1;expect(()=>validateModulation(m)).toThrow();}
    const m=defaultModulation();m.routes[16]=1;expect(()=>validateModulation(m)).toThrow();m.routes[16]=0;m.routes[14]=65536;expect(validateModulation(m)).toEqual(m);
    const packet=[17,...m.settings.flatMap(encodeU21),...m.routes.flatMap(v=>encodeU21(v+65536))];expect(decodeModulation(packet)).toEqual(m);expect(()=>decodeModulation(packet.slice(1))).toThrow();
  });
  it('persists both routes independently and evaluates envelope/LFO destination previews',()=>{
    const modulation=defaultModulation();modulation.routes[10]=32000;modulation.routes[11]=-16000;
    const p=physicalPresetFromUnknown({...initialPreset,modulation});expect(p.modulation).toEqual(modulation);
    expect(effectiveParameters(p,[0,0,0,0,0,1,-1])[5]).toBeCloseTo(initialPreset.parameters[5]/65535+48000/65536);
  });
  it('shares generated capacity instead of imposing four routes per source',()=>{
    const m=defaultModulation();for(const id of [0,1,5,7,14])m.routes[id*2]=1000;
    expect(modulationRouteCount(m.routes,0)).toBe(5);expect(canAssignModulation(m.routes,16,0)).toBe(true);expect(validateModulation(m)).toEqual(m);
  });
  it('offers compact graphical source editors with accessible controls and advanced sections',()=>{
    const props={settings:defaultModulation().settings,onChange:()=>{},onClose:()=>{},onAssign:()=>{},disabled:false,renderControl:(_id:number,label:string)=>createElement('span',{},label)};
    const env=renderToStaticMarkup(createElement(ModSourceEditor,{...props,source:5}));expect(env).toContain('Envelope editor');for(const label of ['Attack','Decay','Sustain','Release','Timing &amp; curve','Swell','Assign to controls'])expect(env).toContain(label);
    const lfo=renderToStaticMarkup(createElement(ModSourceEditor,{...props,source:6}));for(const label of ['LFO editor','Sine','Random','Restart each note','Free running','Smoothing','Positive only'])expect(lfo).toContain(label);
    const points=envelopePoints(props.settings);expect(points[0]).toEqual([10,86]);expect(points[6][0]).toBeCloseTo(290);expect(lfoWave(0,.25)).toBe(1);expect(lfoWave(4,.75)).toBe(-1);
  });
});
