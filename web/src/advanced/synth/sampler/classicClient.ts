import { PresetSyncClient } from "../../../midi/presetSyncClient.ts";
import type { MidiTransport } from "../../../midi/types.ts";
import { NEW_OBJECT_HANDLE, ObjectType, WriteFlag, decodeU21, decodeU28 } from "../../../protocol/index.ts";
import { createSynthPresetObject, type SynthPresetValues } from "../../../catalogs/synthPresets.ts";
import { deterministicObjectId } from "../../../catalogs/objectId.ts";
import { HEXBOARD_PRESET_NAME_MAX_BYTES } from "../../../catalogs/hexboardPresetCapacity.ts";
import { encodeHexSound } from "../../../catalogs/hexSound.ts";

/** HexBoard Classic sampler sounds. Each sound file holds its own instrument. */
export class ClassicSamplerClient {
  private client: PresetSyncClient;
  /** Pass the page's own client to share its transaction numbers. */
  constructor(transport: MidiTransport, client?: PresetSyncClient) { this.client = client ?? new PresetSyncClient(transport); }
  async status() {
    const p = await this.client.compactSampler(0);
    if (p.length < 12 || p.length !== 12 + p[11]) throw Error("Invalid Classic sampler status");
    return { active: p[1] !== 127, assets:p[2], zones:p[3], pcmBytes:decodeU21(p.slice(4,7)), freeHeap:decodeU28(p.slice(7,11)), name:String.fromCharCode(...p.slice(12)) };
  }
  /** Stores a `.hexsound` on the board: a new sound, or the sound with the same
   *  object id with its instrument replaced. With play, the board loads it. */
  async sendSound(sound: Uint8Array, options: { play?: boolean; progress?: (sent: number, total: number) => void } = {}) {
    await this.client.sendObjectWriteConfirmed({objectType:ObjectType.CompactSampler,handle:NEW_OBJECT_HANDLE,body:sound,
      writeFlags:WriteFlag.SaveToFlash | (options.play ? WriteFlag.ApplyToRuntime : 0),
      onProgress:p=>options.progress?.(p.transferredBytes,p.totalBytes)});
  }
  /** The board's sampler sound at this preset handle, as a `.hexsound`. */
  async readSound(handle: number) { return this.client.readSamplerSound(handle); }
  async saveStartup() { await this.client.compactSampler(4); }
}

/** Values a new sampler sound starts with: modulation the sampler ignores is off. */
export const newSamplerSoundValues: SynthPresetValues = {
  SynthModTarget: 0, EffectEnvelopeTarget: 0, EffectEnvelope2Target: 0, SynthLfoTarget: 0
};

/** A new sampler sound for this instrument. Its id follows its folder and name,
 *  so sending the same name again replaces that sound's instrument. */
export function newSamplerSound(instrument: Uint8Array, sound: { name: string; folderPath: string }) {
  const instrumentName = instrumentNameFromHbc(instrument);
  const name = clampBytes(sound.name.trim() || instrumentName, HEXBOARD_PRESET_NAME_MAX_BYTES);
  const folderPath = sound.folderPath.trim().replace(/^\/+|\/+$/g, "") || "/";
  const encoded = createSynthPresetObject({
    objectId: deterministicObjectId(`hexboard.classicSamplerPreset\0${folderPath}\0${name}`),
    name, folderPath, favorite: false, values: newSamplerSoundValues,
    sampler: { name: instrumentName, envelopeOverride: 0 }
  });
  return { name, folderPath, sound: encodeHexSound(encoded.body, instrument) };
}

function clampBytes(value: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  let output = "";
  for (const character of value) {
    if (encoder.encode(output + character).length > maxBytes) break;
    output += character;
  }
  return output;
}

/** The instrument name stored in an HBC1 file's header (bytes 32..63). */
export function instrumentNameFromHbc(bytes: Uint8Array): string {
  const field = bytes.slice(32, 64);
  const end = field.indexOf(0);
  return String.fromCharCode(...field.slice(0, end < 0 ? field.length : end));
}
