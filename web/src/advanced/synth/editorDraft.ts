import {initialClassic,classicFromUnknown} from './classicSchema.ts';
import {initialPreset,physicalPresetFromUnknown} from './schema.ts';
import {factoryWavetablePresets, wavetableFromUnknown, type WavetablePreset} from './wavetableSchema.ts';
export const wavetableDraftKey = 'hexboard.wavetable.draft.v3';
export function wavetableDraft(): WavetablePreset {
  try { const raw = localStorage.getItem(wavetableDraftKey); if (raw) return wavetableFromUnknown(JSON.parse(raw)); } catch { /* Use the first factory sound. */ }
  return factoryWavetablePresets[0];
}
export function editorDraft(engine:2|4|5){try{const key=engine===2?'hexboard.physical.draft.v1':`hexboard.advanced.${engine}.draft`,raw=localStorage.getItem(key);if(raw)return engine===2?physicalPresetFromUnknown(JSON.parse(raw)):classicFromUnknown(JSON.parse(raw));}catch{/* Use Init when an offline draft cannot be restored. */}return engine===2?physicalPresetFromUnknown(initialPreset):initialClassic(engine);}
