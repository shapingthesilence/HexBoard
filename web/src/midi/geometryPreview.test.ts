import { describe, it, expect } from "vitest";
import { PresetSyncClient } from "./presetSyncClient.ts";
import { createDefaultTuningBundle, encodeTuningBundle } from "../catalogs/layoutsCatalog.ts";
import { decodePresetSyncFrame, encodeAckFrame, encodeDefaultPresetSyncFrame, MessageType } from "../protocol/index.ts";
import type { MidiMessageListener, MidiTransport } from "./types.ts";
class Transport implements MidiTransport {
  label = "Advanced"; listeners = new Set<MidiMessageListener>(); messages: number[] = []; fail = false;
  subscribe(listener: MidiMessageListener) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  async send(bytes: ArrayLike<number>) {
    const f = decodePresetSyncFrame(bytes); this.messages.push(f.message);
    const chunk = f.message === MessageType.DataChunk ? ((f.payload[2] << 14) | (f.payload[3] << 7) | f.payload[4]) + 1 : 0;
    const b = this.fail && f.message === MessageType.WriteCommit
      ? encodeDefaultPresetSyncFrame(MessageType.Nack, f.transactionId, [f.message,13,0,0,0,0])
      : encodeAckFrame(f.transactionId,f.message,chunk);
    for (const listener of this.listeners) listener(Uint8Array.from(b));
  }
}
describe("Hall calibration wire contract", () => {
  it("decodes calibrated coverage without inventing a physical sweep", async () => {
    const t = new Transport();
    t.send = async bytes => {
      const f=decodePresetSyncFrame(bytes);
      expect(f.message).toBe(MessageType.CalibrationRequest);
      expect(f.payload).toEqual([0]);
      const reply=encodeDefaultPresetSyncFrame(MessageType.CalibrationResponse,f.transactionId,[3,1,5,1,5]);
      for(const listener of t.listeners) listener(Uint8Array.from(reply));
    };
    expect(await new PresetSyncClient(t).calibration()).toEqual({state:3,validKeys:133,totalKeys:133});
  });
  it("rejects a truncated coverage response", async () => {
    const t=new Transport();
    t.send=async bytes=> { const f=decodePresetSyncFrame(bytes); for(const listener of t.listeners) listener(Uint8Array.from(encodeDefaultPresetSyncFrame(MessageType.CalibrationResponse,f.transactionId,[3]))); };
    await expect(new PresetSyncClient(t).calibration()).rejects.toThrow("Invalid Hall calibration response");
  });
});
describe("atomic geometry preview", () => {
  it("publishes only after all existing HBS1 objects transfer", async () => {
    const t = new Transport(), client = new PresetSyncClient(t), b = encodeTuningBundle(createDefaultTuningBundle());
    await client.sendGeometryPreviewConfirmed([b.tuning,b.layouts[0],b.scaleColorMap],true);
    expect(t.messages[0]).toBe(MessageType.PreviewBegin);
    expect(t.messages.at(-1)).toBe(MessageType.PreviewCommit);
    expect(t.messages.filter(m => m === MessageType.WriteCommit)).toHaveLength(3);
    expect(t.listeners.size).toBe(0);
  });
  it("aborts a rejected staged object, leaving the prior live preview intact", async () => {
    const t = new Transport(); t.fail = true;
    await expect(new PresetSyncClient(t).sendGeometryPreviewConfirmed([encodeTuningBundle(createDefaultTuningBundle()).tuning],true)).rejects.toThrow("ValidationFailed");
    expect(t.messages.at(-1)).toBe(MessageType.PreviewAbort);
    expect(t.messages).not.toContain(MessageType.PreviewCommit);
  });
  it("preserves the existing board single-object protocol", async () => {
    const t = new Transport(); await new PresetSyncClient(t).sendGeometryPreviewConfirmed([encodeTuningBundle(createDefaultTuningBundle()).tuning]);
    expect(t.messages).not.toContain(MessageType.PreviewBegin);
    expect(t.messages.at(-1)).toBe(MessageType.WriteCommit);
  });
});
