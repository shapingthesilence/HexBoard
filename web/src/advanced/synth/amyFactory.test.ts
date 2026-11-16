import {describe,it,expect} from 'vitest';
import bank from './amy-factory/bank.json';
import {factoryClassicPresets,classicFromUnknown,initialClassic} from './classicSchema.ts';
describe('AMY factory catalog',()=>{
 const amy=factoryClassicPresets.filter(p=>p.factoryBank);
 it('includes every pinned voice with unique addressable names',()=>{
  expect(amy.filter(p=>p.engine===4)).toHaveLength(128);expect(amy.filter(p=>p.engine===5)).toHaveLength(1024);
  expect(new Set(amy.map(p=>p.name)).size).toBe(1152);
  expect(amy[0].name).toBe('AMY Juno A11 Brass Set 1');expect(amy[127].name).toBe('AMY Juno B88 Owgan');
  expect(amy[128].name).toContain('BRASS   1');expect(amy.at(-1)?.name).toContain('STARTREK');
 });
 it('retains all native DX7 voice fields without adding effects or expression',()=>{
  const voices=amy.filter(p=>p.engine===5);
  for(let i=0;i<1024;i++){expect(voices[i].patch.parameters.slice(0,145)).toEqual(bank.dx7[i][1]);expect(voices[i].patch.parameters[146]).toBe(0);expect(voices[i].effects.order).toEqual([]);expect(voices[i].patch.routes.every(r=>r.destination===65535)).toBe(true);}
 });
 it('converts Juno control curves and keeps chorus in the effects rack',()=>{
  const moving=amy[4],p=moving.patch.parameters;
  expect(65*2**(p[6]/65535*8)).toBeCloseTo(3058.4,0);expect(p[0]).toBe(65535);expect(p[1]).toBe(65535);expect(p[2]/65535).toBeCloseTo(14/127,4);
  expect(moving.effects.order).toEqual([4]);expect(.1+2.9*moving.effects.values[3][1]/65535).toBeCloseTo(.83,4);
  expect(amy[2].effects.order).toEqual([]);expect(amy[1].conversionNotes?.some(n=>n.includes('20-second'))).toBe(true);
 });
 it('exports valid unqualified patches without macro data',()=>{
  for(const p of amy){expect(classicFromUnknown(JSON.parse(JSON.stringify(p)))).toEqual(p);expect(p.voiceBudget).toBeUndefined();expect(p.patch.routes).toHaveLength(28);expect(p.patch).not.toHaveProperty('macros');}
  expect(()=>classicFromUnknown({...initialClassic(4),format:'hexboard.advanced.v1'})).toThrow();
 });
});
