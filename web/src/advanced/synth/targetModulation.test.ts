import {describe,expect,it} from 'vitest';
import {initialPreset,physicalPresetFromUnknown,factoryPhysicalPresets} from './schema.ts';
import {canAssignTarget,targetDepths} from './targetModulation.ts';

describe('four modulation sources per target',()=>{
  it('counts across expression, tilt and generated sources; permits edits and frees removed routes',()=>{
    const p=physicalPresetFromUnknown(initialPreset);
    p.routes.fill(0);p.tiltRoutes.fill(0);p.modulation.routes.fill(0);
    p.routes[3]=100;p.routes[4]=-200;p.tiltRoutes[2]=300;p.modulation.routes[2]=-400;
    expect(targetDepths(p,1)).toEqual([100,-200,0,300,0,-400,0]);
    expect(canAssignTarget(p,1,6)).toBe(false);
    expect(canAssignTarget(p,1,5)).toBe(true);
    expect(canAssignTarget(p,2,6)).toBe(true);
    p.routes[3]=0;
    expect(canAssignTarget(p,1,6)).toBe(true);
  });
  it('rejects an imported fifth source without truncating assignments',()=>{
    const p=physicalPresetFromUnknown(initialPreset);
    p.routes.fill(0);p.tiltRoutes.fill(0);p.modulation.routes.fill(0);
    p.routes[3]=1;p.routes[4]=1;p.routes[5]=1;p.tiltRoutes[2]=1;p.tiltRoutes[3]=1;
    expect(()=>physicalPresetFromUnknown(p)).toThrow('four modulation sources');
    expect(p.tiltRoutes[3]).toBe(1);
  });
  it('accepts all factory presets',()=>{
    for(const p of factoryPhysicalPresets)expect(()=>physicalPresetFromUnknown(p)).not.toThrow();
  });
});
