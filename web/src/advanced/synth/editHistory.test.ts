import {describe, expect, it} from 'vitest';
import {EditHistory} from './editHistory.ts';
import {samePhysicalSound} from './physicalHistory.ts';
import {initialPreset, physicalPresetFromUnknown} from './schema.ts';

describe('sound edit history', () => {
  it('groups both axes and repeated movement into one reversible gesture', () => {
    const h = new EditHistory({x: 1, y: 2});
    h.begin(); h.set({x: 3, y: 2}); h.set({x: 3, y: 4}); h.set({x: 5, y: 4}); h.end();
    expect(h.undo()).toEqual({x: 1, y: 2}); expect(h.canUndo).toBe(false);
    expect(h.redo()).toEqual({x: 5, y: 4});
    h.begin(); h.end(); expect(h.undo()).toEqual({x: 1, y: 2});
  });
  it('keeps no-ops out of history and discards redo after a new edit', () => {
    const h = new EditHistory(1);
    h.set(1); expect(h.canUndo).toBe(false);
    h.set(2); h.set(3); expect(h.undo()).toBe(2);
    h.set(2); expect(h.canRedo).toBe(true);
    h.set(4); expect(h.canRedo).toBe(false); expect(h.undo()).toBe(2);
  });
  it('bounds retained snapshots and resets a newly connected baseline', () => {
    const h = new EditHistory(0, 2);
    h.set(1); h.set(2); h.set(3); expect(h.undo()).toBe(2); expect(h.undo()).toBe(1); expect(h.undo()).toBeUndefined();
    h.reset(10); expect(h.canRedo).toBe(false); h.set(11); expect(h.undo()).toBe(10);
  });
  it('restores whole presets, including sample content, rack order and assignments', () => {
    const before = physicalPresetFromUnknown(initialPreset), h = new EditHistory(before, 64, samePhysicalSound);
    const after = {...before, name: 'Edited', sample: {...before.sample, frames: [1, 2, 3]},
      effects: {...before.effects, order: [1, 2]}, routes: before.routes.map((v, i) => i === 3 ? 1000 : v)};
    h.set(after); expect(h.undo()).toBe(before); expect(h.redo()).toBe(after);
    h.set({...after, parameters: [...after.parameters]}); expect(h.undo()).toBe(before);
  });
});
