import { describe, it, expect } from 'vitest';
import { calibrate, defaultCalibration, normalize, sector, reduceMenu, initialMenu, displayedSelection } from './model.ts';
describe('hex menu interactions', () => {
  it('covers all six directions and cancels near center', () => {
    for (let i=0;i<6;i++) { const a=(-30+i*60)*Math.PI/180; expect(sector(Math.cos(a), Math.sin(a))).toBe(i); }
    expect(sector(.1,.1)).toBeNull();
  });
  it('previews without applying, cancels, and retains explicitly applied choices', () => {
    let s=reduceMenu(initialMenu,{type:'open',category:'Tuning'});
    s=reduceMenu(s,{type:'browse',delta:1});
    expect(displayedSelection(s,true).Tuning).toBe(1);
    expect(displayedSelection(s,false).Tuning).toBe(0);
    expect(s.applied.Tuning).toBe(0);
    expect(displayedSelection(reduceMenu(s,{type:'back'}),true).Tuning).toBe(0);
    s=reduceMenu(s,{type:'apply'});
    expect(reduceMenu(s,{type:'toggle'}).applied.Tuning).toBe(1);
  });
});
describe('joystick calibration', () => {
  it('removes rest noise and rescales outside a radial dead zone continuously', () => {
    expect(normalize(.1,.1,defaultCalibration)).toEqual([0,0]);
    expect(normalize(1,0,defaultCalibration)).toEqual([1,0]);
    expect(normalize(.1601,0,defaultCalibration)[0]).toBeLessThan(.001);
    expect(Math.hypot(...normalize(1,1,defaultCalibration))).toBeCloseTo(1);
  });
  it('supports asymmetric endpoints and rejects incomplete or invalid sweeps', () => {
    const c=calibrate([.1,-.05],[[-.6,-.8],[.9,.7]],.16)!;
    expect(normalize(.1,-.05,c)).toEqual([0,0]);
    expect(normalize(-.6,-.05,c)[0]).toBe(-1);
    expect(calibrate([0,0],[[0,0],[1,1]],.16)).toBeUndefined();
    expect(calibrate([0,0],[[NaN,-1],[1,1]],.16)).toBeUndefined();
  });
});
