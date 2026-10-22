import {describe,it,expect} from 'vitest';import {renderToStaticMarkup} from 'react-dom/server';
import {ModulationBudget} from './ModulationBudget.tsx';
import {PerformanceRow} from './PerformanceRow.tsx';import {ControllerControls} from './ControllerControls.tsx';
import {MonoControls,MonoOptions} from './MonoControls.tsx';import {defaultMono,validateMono} from './mono.ts';
import {initialPreset,physicalPresetFromUnknown} from './schema.ts';import {dspUsage,dspAllows} from './dspBudget.ts';import {samePhysicalSound} from './physicalHistory.ts';
describe('Physical mono modes',()=>{
 it('places voice modes beside the arp without a separate settings row',()=>{
  const html=renderToStaticMarkup(<PerformanceRow voiceControls={<MonoControls disabled={false} onChange={()=>{}}/>}/>);
  expect(html).toContain('aria-label="Enable arpeggiator"');expect(html).toContain('aria-label="Voice mode"');expect(html.indexOf('aria-label="Voice mode"')).toBeLessThan(html.indexOf('class="performance-clock"'));expect(html).not.toContain('Glide time');
  expect(renderToStaticMarkup(<ControllerControls disabled={false} onState={()=>{}}/>)).toBe('');
 });
 it('validates bounded settings and preserves old poly patches',()=>{
  expect(validateMono(undefined)).toEqual(defaultMono());for(const flags of [3,12,128,-1])expect(()=>validateMono({flags,glideMs:0})).toThrow();expect(()=>validateMono({flags:2,glideMs:5001})).toThrow();
  const p=physicalPresetFromUnknown({...initialPreset,mono:undefined});expect(p.mono).toEqual(defaultMono());
  expect(physicalPresetFromUnknown({...p,mono:{flags:2|8|16|32|64,glideMs:3000}}).mono).toEqual({flags:122,glideMs:3000});
 });
 it('reserves fixed rack cost and gives one object a lower DSP cost',()=>{
  const p=physicalPresetFromUnknown(initialPreset),mono={...p,mono:{flags:2,glideMs:1000}};
  expect(dspUsage(mono).units).toBeLessThan(dspUsage(p).units);expect(dspAllows(p,mono)).toBe(true);expect(renderToStaticMarkup(<ModulationBudget mono label='DSP budget' used={700} capacity={2873} connections={4}/>)).toContain('one string');
  const rack={...mono,effects:{...mono.effects,order:[1,2,3,4]}};expect(dspUsage(rack).units-dspUsage(mono).units).toBe(520);
  expect(samePhysicalSound(p,mono)).toBe(false);expect(samePhysicalSound(mono,{...mono,mono:{flags:2,glideMs:2000}})).toBe(false);
 });
 it('keeps poly compact and exposes complete mono playing controls',()=>{
  const render=(flags:number)=>renderToStaticMarkup(<MonoControls value={{flags,glideMs:100}} disabled={false} onChange={()=>{}}/>);
  expect(render(0)).not.toContain('Mono note priority');expect(render(2)).toContain('Mono settings');expect(render(2)).not.toContain('Glide time');const mono=renderToStaticMarkup(<MonoOptions value={{flags:2,glideMs:100}} disabled={false} onChange={()=>{}}/>);for(const name of ['Mono note priority','Glide time','Glide trigger','Glide timing','Legato velocity'])expect(mono).toContain(name);
  expect(renderToStaticMarkup(<MonoOptions value={{flags:1,glideMs:0}} disabled={false} onChange={()=>{}}/>)).not.toContain('Legato velocity');
 });
});
