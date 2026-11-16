import { describe, expect, it } from 'vitest';
import { colorDefaults, colorProfile, colorSetCommand } from './colorModel.ts';
describe('device color calibration', () => {
  it('round-trips the device profile without changing portable colors', () => {
    const p = colorProfile({version:'1',gain:'1000:850:900',gamma:'260:240:280',hue:'-25:0:12:0:25:0'});
    expect(colorSetCommand(p)).toBe('led color set 1000 850 900 260 240 280 -25 0 12 0 25 0');
  });
  it('rejects corrupt, missing, and out-of-range settings', () => {
    expect(() => colorProfile({version:'2'})).toThrow();
    expect(() => colorProfile({version:'1'})).toThrow();
    for (const [group, value] of [['gain',1001],['gamma',99],['hue',26],['hue',NaN]] as const) {
      const p = colorDefaults(); p[group][0] = value; expect(() => colorSetCommand(p)).toThrow();
    }
  });
});
