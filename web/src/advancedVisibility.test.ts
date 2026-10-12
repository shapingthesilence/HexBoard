import { describe, expect, it } from 'vitest';
import { visibleLocation } from './advancedVisibility.ts';
import type { AppLocation } from './navigation.ts';
describe('unreleased Advanced navigation',()=>{
  it('blocks direct and restored Advanced routes without an Advanced connection',()=>{
    for(const view of ['menu','calibration'] as const){
      const location: AppLocation={view};
      expect(visibleLocation(location,false)).toEqual({view:'layouts'});
      expect(visibleLocation(location,true)).toBe(location);
    }
  });
  it('preserves original HexBoard views and Learn details',()=>{
    for(const location of [{view:'layouts'},{view:'synth'},{view:'learn',page:'course',courseId:'course'}] as AppLocation[])
      expect(visibleLocation(location,false)).toBe(location);
  });
});
