import {it,expect} from 'vitest';
import {estimatedProgress} from './loadTiming.ts';
it('tracks measured time monotonically and reserves completion for readiness',()=>{expect(estimatedProgress(0,4000)).toBe(0);expect(estimatedProgress(2000,4000)).toBeCloseTo(.475);expect(estimatedProgress(4000,4000)).toBeCloseTo(.95);let previous=0;for(let t=0;t<30000;t+=50){const p=estimatedProgress(t,4000);expect(p).toBeGreaterThanOrEqual(previous);expect(p).toBeLessThan(1);previous=p;}});
