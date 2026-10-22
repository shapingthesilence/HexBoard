import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {modulationUsage,budgetAllows,sourceContribution,modulationCapacity} from './modulationBudget.ts';
import {ModulationBudget} from './ModulationBudget.tsx';
import {initialPreset,physicalPresetFromUnknown,defaultModulation} from './schema.ts';
const empty=()=>({...initialPreset,routes:Array(99).fill(0),tiltRoutes:Array(66).fill(0),modulation:defaultModulation()});
describe('Shared modulation capacity',()=>{
 it('charges continuous destinations once and keeps strike-only routes inexpensive',()=>{const p=empty();p.routes[3]=1;expect(modulationUsage(p).units).toBe(1);p.routes[3]=0;p.routes[4]=1;expect(modulationUsage(p).units).toBe(10);p.modulation.routes[2]=1;expect(modulationUsage(p).units).toBe(13);p.modulation.routes[0]=1;expect(modulationUsage(p).units).toBe(22);});
 it('lets one source use spare capacity and rejects an over-budget patch without pruning it',()=>{const p=empty();for(const id of [2,4,7,9,13,16,17,18])p.modulation.routes[id*2]=1000;expect(()=>physicalPresetFromUnknown(p)).not.toThrow();expect(modulationUsage(p).connections).toBe(8);for(let id=0;id<33;++id)if(![8,21,27,31].includes(id))p.modulation.routes[id*2]=1;expect(modulationUsage(p).units).toBeGreaterThan(modulationCapacity);expect(()=>physicalPresetFromUnknown(p)).toThrow(/capacity/);expect(budgetAllows(p,0,5,0)).toBe(true);});
 it('previews marginal cost without mutating routes and frees capacity on removal',()=>{const p=empty(),before=JSON.stringify(p);expect(modulationUsage(p,{id:1,source:5,value:1}).units).toBe(11);expect(JSON.stringify(p)).toBe(before);p.modulation.routes[2]=-500;expect(sourceContribution(p,5)).toBe(11);expect(modulationUsage(p,{id:1,source:5,value:500}).units).toBe(11);expect(modulationUsage(p,{id:1,source:5,value:0}).units).toBe(0);});
 it('renders a compact accessible bar with distinct available and projected capacity',()=>{const html=renderToStaticMarkup(createElement(ModulationBudget,{used:30,connections:5,projected:41}));expect(html).toContain('role="meter"');expect(html).toContain('budget-preview');expect(html).toContain('+11 units');expect(html).toContain('budget-used');const full=renderToStaticMarkup(createElement(ModulationBudget,{used:90,connections:20,projected:100}));expect(full).toContain('data-over="true"');expect(full).toContain('exceeds capacity');});
});
