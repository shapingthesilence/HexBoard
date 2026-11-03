import {describe, expect, it} from 'vitest';
import {canvasSize} from './canvasSize.ts';

describe('plot backing memory', () => {
  it('retains native detail through 2x display density', () => {
    expect(canvasSize(600, 240, 1)).toEqual({width: 600, height: 240});
    expect(canvasSize(600, 240, 2)).toEqual({width: 1200, height: 480});
    expect(canvasSize(600, 240, 4)).toEqual({width: 1200, height: 480});
  });
  it.each([[7680, 4320, 3], [4000, 100, 4], [100, 4000, 2], [0, 0, 1]])('bounds a %i by %i surface at density %i', (width, height, ratio) => {
    const size = canvasSize(width, height, ratio);
    expect(size.width).toBeGreaterThanOrEqual(1);
    expect(size.height).toBeGreaterThanOrEqual(1);
    expect(size.width).toBeLessThanOrEqual(2048);
    expect(size.height).toBeLessThanOrEqual(1024);
    expect(size.width * size.height * 4).toBeLessThanOrEqual(8 * 1024 * 1024);
  });
});
