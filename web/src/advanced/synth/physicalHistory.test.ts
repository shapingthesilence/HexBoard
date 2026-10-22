import {it,expect} from 'vitest';
import {physicalPresetFromUnknown,initialPreset} from './schema.ts';
import {samePhysicalSound} from './physicalHistory.ts';
it('tracks controller route edits and treats omitted routes as zero',()=>{const a=physicalPresetFromUnknown(initialPreset),b=structuredClone(a);b.controllerRoutes![45]=20000;expect(samePhysicalSound(a,b)).toBe(false);b.controllerRoutes=undefined;expect(samePhysicalSound(a,b)).toBe(true);});
