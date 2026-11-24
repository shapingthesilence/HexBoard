import {crc32} from './prepare.mjs';
import {decodePianoMix, encodePianoMix, pianoMixKeys, pianoMixParameter} from './pianoMix.mjs';
import type {SamplerLoadingState} from '../client.ts';

export const roomAmount = 12;
export const outputEffects = [
  {id: 13, offset: 108, label: 'Room decay', min: 200, max: 8000, initial: 1600},
  {id: 14, offset: 110, label: 'Room tone', min: 0, max: 65535, initial: Math.round(.34090909 * 65535)},
  {id: 15, offset: 112, label: 'Room width', min: 0, max: 65535, initial: 65535},
  {id: 19, offset: 120, label: 'Ensemble', min: 0, max: 65535, initial: 0},
  {id: 20, offset: 122, label: 'Drive', min: 0, max: 65535, initial: 0},
] as const;

export function sameSamplerSession(current: SamplerLoadingState | undefined, next: SamplerLoadingState) {
  return current?.phase === 2 && next.phase === 2 && current.source === next.source && current.session === next.session;
}

export function readLiveSettings(header: Uint8Array) {
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const name = new TextDecoder().decode(header.subarray(64, 96)).split('\0')[0];
  const piano = header[127] === 1;
  const words = new Map([[roomAmount, view.getUint16(62, true)]]);
  const mix = decodePianoMix(view.getUint32(44, true));
  pianoMixKeys.forEach((key, index) => words.set(pianoMixParameter + index, mix[key]));
  for (const effect of outputEffects) {
    const value = view.getUint16(effect.offset, true);
    const normalized = effect.id === 14 || effect.id === 15;
    words.set(effect.id, normalized ? (value ? Math.round((value - 1) * 65535 / 65534) : effect.initial)
      : effect.id === 13 ? value || effect.initial : value);
  }
  return {name, piano, words};
}

// Legacy main firmware reads back a saved header during playback. Patch only
// the edits that it acknowledged, preserving the bank's other header settings.
export function mergeLegacySamplerEdits(header: Uint8Array, edits: ReadonlyMap<number, number>) {
  const result = header.slice();
  const view = new DataView(result.buffer, result.byteOffset, result.byteLength);
  const storage = view.getUint32(44, true);
  const mix = decodePianoMix(storage);
  for (const [id, value] of edits) {
    if (id === roomAmount) view.setUint16(62, value, true);
    else if (id >= pianoMixParameter && id < pianoMixParameter + pianoMixKeys.length) mix[pianoMixKeys[id - pianoMixParameter]] = value;
    else {
      const effect = outputEffects.find(effect => effect.id === id);
      if (!effect) continue;
      const word = id === 14 || id === 15 ? 1 + Math.floor(value * 65534 / 65535) : value;
      view.setUint16(effect.offset, word, true);
    }
  }
  view.setUint32(44, encodePianoMix(Boolean(storage & 1), mix), true);
  view.setUint32(36, 0, true);
  view.setUint32(36, crc32(result), true);
  return result;
}
