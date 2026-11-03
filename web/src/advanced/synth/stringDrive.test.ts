import {describe, expect, it} from 'vitest';
import {driveCeiling, driveScale, saturate, stringDrive} from './stringDrive.ts';

// Mirrors HexBoard_Advanced physical_model.cpp saturateWave and its per-block thresholds.
describe('string bridge saturation', () => {
  it('passes the loop through untouched at zero Drive', () => {
    for (const character of [0, 1, 2] as const) expect(stringDrive(.8, 0, character)).toBe(.8);
  });
  it('blends by Drive squared toward the saturated shape', () => {
    expect(stringDrive(.8, .5, 1)).toBeCloseTo(.8 + .25 * (.25 - .8), 6);
  });
  it('lowers the thresholds by up to 20% across the upper quarter of Drive', () => {
    expect(driveScale(.75)).toBe(1);
    expect(driveScale(1)).toBeCloseTo(.8, 6);
    expect(driveCeiling(1)).toBeCloseTo(.2, 6);
  });
  it('bounds every shape by the ceiling and never adds loop energy', () => {
    for (const character of [0, 1, 2] as const) for (const scale of [1, .8]) for (let x = -1.5; x <= 1.5; x += .01) {
      const y = saturate(x, character, scale);
      expect(Math.abs(y)).toBeLessThanOrEqual(.25 * scale + 1e-9);
      expect(Math.abs(y)).toBeLessThanOrEqual(Math.abs(x) + 1e-9);
    }
  });
  it('draws Warm as a continuous cubic, Edge as a clip and Fold as a reflection', () => {
    expect(saturate(.375, 0, 1)).toBeCloseTo(.25, 6);
    expect(saturate(.374, 0, 1)).toBeCloseTo(.25, 3);
    expect(saturate(.6, 1, 1)).toBe(.25);
    expect(saturate(.5, 2, 1)).toBeCloseTo(0, 6);
    expect(saturate(-.4, 2, 1)).toBeCloseTo(-.1, 6);
    expect(saturate(2, 2, 1)).toBeCloseTo(-.25, 6);
  });
});
