import { PresetSyncClient } from "../../../midi/presetSyncClient.ts";
import type { MidiTransport } from "../../../midi/types.ts";
import { ObjectType, WriteFlag, decodeU21, decodeU28 } from "../../../protocol/index.ts";
import { createSynthPresetObject } from "../../../catalogs/synthPresets.ts";
import { deterministicObjectId } from "../../../catalogs/objectId.ts";
import { HEXBOARD_PRESET_NAME_MAX_BYTES } from "../../../catalogs/hexboardPresetCapacity.ts";

// Slot 127 means the wavetable engine on the wire, so slots stay below it.
export const MAX_CLASSIC_SAMPLER_SLOTS = 127;

export interface ClassicInstrument { id: number; name: string; bytes: number }
export class ClassicSamplerClient {
  private client: PresetSyncClient;
  constructor(transport: MidiTransport) { this.client = new PresetSyncClient(transport); }
  async status() {
    const p = await this.client.compactSampler(0);
    if (p.length < 12 || p.length !== 12 + p[11]) throw Error("Invalid Classic sampler status");
    return { slot:p[1], assets:p[2], zones:p[3], pcmBytes:decodeU21(p.slice(4,7)), freeHeap:decodeU28(p.slice(7,11)), name:String.fromCharCode(...p.slice(12)) };
  }
  /** Slots the connected board has: firmware rejects slot info past its last slot. */
  slotCount = 0;
  async library() {
    const records: ClassicInstrument[] = [];
    let id = 0;
    for (; id < MAX_CLASSIC_SAMPLER_SLOTS; ++id) {
      let p: number[];
      try { p = await this.client.compactSampler(1, id); }
      catch (error) {
        if (id > 0 && error instanceof Error && error.message.startsWith("HexBoard rejected")) break;
        throw error;
      }
      if (p.length < 7 || p[1] !== id || p.length !== 7 + p[6]) throw Error("Invalid Classic sampler entry");
      if (p[2]) records.push({id,name:String.fromCharCode(...p.slice(7)),bytes:decodeU21(p.slice(3,6))});
    }
    this.slotCount = id;
    return records;
  }
  async upload(bytes: Uint8Array, progress?: (n:number,total:number)=>void) {
    const entries = await this.library(), slot = Array.from({length:this.slotCount},(_,i)=>i).find(i=>!entries.some(e=>e.id===i));
    if (slot === undefined) throw Error(`All ${this.slotCount} sampler slots are occupied. Delete an instrument first.`);
    await this.client.sendObjectWriteConfirmed({objectType:ObjectType.CompactSampler,handle:slot,body:bytes,writeFlags:WriteFlag.SaveToFlash,
      onProgress:p=>progress?.(p.transferredBytes,p.totalBytes)});
    return slot;
  }
  /** Saves a synth preset that plays an installed instrument. The id comes from
   *  the folder and name, so saving the same name again updates that preset. */
  async savePreset(preset: { name: string; folderPath: string; instrumentName: string; envelopeOverride?: number }) {
    const name = clampBytes(preset.name.trim() || preset.instrumentName, HEXBOARD_PRESET_NAME_MAX_BYTES);
    const folderPath = preset.folderPath.trim().replace(/^\/+|\/+$/g, "") || "/";
    const encoded = createSynthPresetObject({
      objectId: deterministicObjectId(`hexboard.classicSamplerPreset\0${folderPath}\0${name}`),
      name, folderPath, favorite: false, values: {},
      sampler: { name: preset.instrumentName, envelopeOverride: preset.envelopeOverride ?? 0 }
    });
    await this.client.sendSynthPresetSaveConfirmed(encoded);
    return { name, folderPath };
  }
  async select(slot: number) { await this.client.compactSampler(2,slot); }
  async saveStartup() { await this.client.compactSampler(4); }
  async remove(slot: number) { await this.client.compactSampler(3,slot); }
  async read(slot: number) { return this.client.readCompactSampler(slot); }
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
