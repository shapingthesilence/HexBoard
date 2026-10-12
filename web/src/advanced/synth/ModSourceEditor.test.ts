import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ModSourceEditor,envelopePoints,lfoWave} from './ModSourceEditor.tsx';
import {modulationRouteLimit,modulationRouteCount,canAssignModulation,defaultModulation,validateModulation,physicalPresetFromUnknown,initialPreset,effectiveParameters} from './schema.ts';
import {decodeModulation} from './client.ts';
import {encodeU21} from '../../protocol/index.ts';
describe('Editable envelope and LFO sources',()=>{
  it('migrates old presets with inactive routes and validates discrete source settings',()=>{
    const migrated=physicalPresetFromUnknown({...initialPreset,format:'hexboard.physical.v17',parameters:initialPreset.parameters.slice(0,31),routes:initialPreset.routes.slice(0,93),tiltRoutes:initialPreset.tiltRoutes.slice(0,62),modulation:undefined});
    expect(migrated.modulation).toEqual(defaultModulation());
    for(const id of [7,9,10,14]){const m=defaultModulation();m.settings[id]=1;expect(()=>validateModulation(m)).toThrow();}
    const m=defaultModulation();m.routes[16]=1;expect(()=>validateModulation(m)).toThrow();m.routes[16]=0;m.routes[14]=65536;expect(validateModulation(m)).toEqual(m);
    const packet=[14,...m.settings.flatMap(encodeU21),...m.routes.flatMap(v=>encodeU21(v+65536))];expect(decodeModulation(packet)).toEqual(m);expect(()=>decodeModulation(packet.slice(1))).toThrow();
  });
  it('persists both routes independently and evaluates envelope/LFO destination previews',()=>{
    const modulation=defaultModulation();modulation.routes[10]=32000;modulation.routes[11]=-16000;
    const p=physicalPresetFromUnknown({...initialPreset,modulation});expect(p.modulation).toEqual(modulation);
    expect(effectiveParameters(p,[0,0,0,0,0,1,-1])[5]).toBeCloseTo(initialPreset.parameters[5]/65535+48000/65536);
  });
  it('caps generated sources at six destinations while allowing edits, removals and reuse',()=>{
    const m=defaultModulation();for(const id of [0,1,3,5,6,7])m.routes[id*2]=1000;
    expect(modulationRouteCount(m.routes,0)).toBe(modulationRouteLimit);expect(canAssignModulation(m.routes,7,0)).toBe(true);expect(canAssignModulation(m.routes,14,0)).toBe(false);expect(canAssignModulation(m.routes,14,1)).toBe(true);
    expect(validateModulation(m)).toEqual(m);m.routes[28]=1000;expect(()=>validateModulation(m)).toThrow('Envelope allows 6 routes');m.routes[10]=0;expect(validateModulation(m)).toEqual(m);
  });
  it('offers compact graphical source editors with accessible controls and advanced sections',()=>{
    const props={settings:defaultModulation().settings,onChange:()=>{},onClose:()=>{},onAssign:()=>{},disabled:false,renderControl:(_id:number,label:string)=>createElement('span',{},label)};
    const env=renderToStaticMarkup(createElement(ModSourceEditor,{...props,source:5}));expect(env).toContain('Envelope editor');for(const label of ['Attack','Decay','Sustain','Release','Timing &amp; curve','Swell','Assign to controls'])expect(env).toContain(label);
    const lfo=renderToStaticMarkup(createElement(ModSourceEditor,{...props,source:6}));for(const label of ['LFO editor','Sine','Random','Restart each note','Free running','Smoothing','Positive only'])expect(lfo).toContain(label);
    const points=envelopePoints(props.settings);expect(points[0]).toEqual([10,86]);expect(points[6][0]).toBeCloseTo(290);expect(lfoWave(0,.25)).toBe(1);expect(lfoWave(4,.75)).toBe(-1);
  });
});
