import { PresetSyncClient } from "../../../midi/presetSyncClient.ts";
import type { MidiTransport } from "../../../midi/types.ts";
import { ObjectType, WriteFlag, decodeU21, decodeU28 } from "../../../protocol/index.ts";

export interface ClassicInstrument { id: number; name: string; bytes: number }
export class ClassicSamplerClient {
  private client: PresetSyncClient;
  constructor(transport: MidiTransport) { this.client = new PresetSyncClient(transport); }
  async status() {
    const p = await this.client.compactSampler(0);
    if (p.length < 12 || p.length !== 12 + p[11]) throw Error("Invalid Classic sampler status");
    return { slot:p[1], assets:p[2], zones:p[3], pcmBytes:decodeU21(p.slice(4,7)), freeHeap:decodeU28(p.slice(7,11)), name:String.fromCharCode(...p.slice(12)) };
  }
  async library() {
    const records: ClassicInstrument[] = [];
    for (let id=0; id<32; ++id) {
      const p = await this.client.compactSampler(1, id);
      if (p.length < 7 || p[1] !== id || p.length !== 7 + p[6]) throw Error("Invalid Classic sampler entry");
      if (p[2]) records.push({id,name:String.fromCharCode(...p.slice(7)),bytes:decodeU21(p.slice(3,6))});
    }
    return records;
  }
  async upload(bytes: Uint8Array, progress?: (n:number,total:number)=>void) {
    const entries = await this.library(), slot = Array.from({length:32},(_,i)=>i).find(i=>!entries.some(e=>e.id===i));
    if (slot === undefined) throw Error("All 32 sampler slots are occupied. Delete an instrument first.");
    await this.client.sendObjectWriteConfirmed({objectType:ObjectType.CompactSampler,handle:slot,body:bytes,writeFlags:WriteFlag.SaveToFlash,
      onProgress:p=>progress?.(p.transferredBytes,p.totalBytes)});
    return slot;
  }
  async select(slot: number) { await this.client.compactSampler(2,slot); }
  async saveStartup() { await this.client.compactSampler(4); }
  async remove(slot: number) { await this.client.compactSampler(3,slot); }
  async read(slot: number) { return this.client.readCompactSampler(slot); }
}
