import {describe,it,expect} from 'vitest';
import {noteFromName} from './naming.ts';
describe('sample file name notes',()=>{
 it('reads notes from common library naming',()=>{
  expect(noteFromName('glock_medium_G4')).toBe(67);
  expect(noteFromName('LDFlute_expvib_C4_v1_1')).toBe(60);
  expect(noteFromName('pizzT_A2_v1_RR1')).toBe(45);
  expect(noteFromName('eb1_single_cycle')).toBe(27);
  expect(noteFromName('iowa-bass-pizz-e2')).toBe(40);
  expect(noteFromName('Piano F#3')).toBe(54);
  expect(noteFromName('Bass Cs-1')).toBe(1);
 });
 it('ignores names without a note',()=>{
  for(const name of ['BDrumNewhit_v5_rr1_Sum','Anvil_Hit1_v2_Sum','BellTree_Stroke1_v1_Sum','Rode_Man3Open_01','Player_dyn1_rr1_000'])expect(noteFromName(name)).toBeUndefined();
 });
});
