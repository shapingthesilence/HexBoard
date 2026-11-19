import {P, option, optionValue, filterNames} from './wavetableSchema.ts';
import {describe,it,expect} from 'vitest';import {renderToStaticMarkup} from 'react-dom/server';import {defaultFx} from './schema.ts';import {filterResponse,FilterResponse} from './FilterResponse.tsx';import {FxRackEditor} from './FxRackEditor.tsx';
describe('filter response display',()=>{
 it('shows the actual filter shape, resonance and dry/wet response',()=>{const cutoff=Math.log2(1000/20)/9.813781;expect(filterResponse(cutoff,0,1,0,100)).toBeGreaterThan(filterResponse(cutoff,0,1,0,10000)*100);expect(filterResponse(cutoff,0,1,2,10000)).toBeGreaterThan(filterResponse(cutoff,0,1,2,100)*100);expect(filterResponse(cutoff,1,1,0,1000)).toBeCloseTo(8);expect(filterResponse(cutoff,1,0,0,1000)).toBe(1);});
 it('recalls the original selector words and plots the four voice colors',()=>{
   expect([0,32767,32768,65535].map(v=>option(P.FilterMode,v))).toEqual([0,1,1,2]);
   filterNames.forEach((_,i)=>expect(option(P.FilterMode,optionValue(P.FilterMode,i))).toBe(i));
   const c=Math.log2(1000/20)/9.813781;
   expect(filterResponse(c,.5,1,3,1000)).toBeCloseTo(0);
   expect(filterResponse(c,.5,1,4,1000)).toBeCloseTo(3);
   const nullHz=44100/Math.PI*Math.atan(2*Math.tan(Math.PI*1000/44100));
   expect(filterResponse(c,.5,1,5,nullHz)).toBeCloseTo(0);
   expect(filterResponse(c,.5,1,6,20)).toBeCloseTo(.25,2);
 });
 it('places Mode beside Mix in the same control grid and the visual above',()=>{const html=renderToStaticMarkup(<FxRackEditor rack={{...defaultFx(),order:[5]}} onChange={()=>{}}/>);const grid=html.slice(html.indexOf('class="fx-controls'));expect(grid).toContain('fx-filter-mode');expect(grid.indexOf('Filter Mix')).toBeLessThan(grid.indexOf('Filter mode'));expect(html.indexOf('filter response preview')).toBeLessThan(html.indexOf('class="fx-controls'));expect(renderToStaticMarkup(<FilterResponse rack={defaultFx()}/>)).not.toContain('NaN');});
});
