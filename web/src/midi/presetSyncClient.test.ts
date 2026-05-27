import { describe, expect, it } from "vitest";
import { deterministicObjectId } from "../catalogs/objectId.ts";
import { createSynthPresetObject } from "../catalogs/synthPresets.ts";
import { MessageType, ObjectType, decodePresetSyncFrame, decodeWriteBeginPayload, decodeWriteCommitPayload } from "../protocol/index.ts";
import { MockMidiTransport } from "./mockTransport.ts";
import { PresetSyncClient } from "./presetSyncClient.ts";

describe("PresetSyncClient", () => {
  it("sends an apply-only synth preset transfer", async () => {
    const transport = new MockMidiTransport();
    const client = new PresetSyncClient(transport);
    const preset = createSynthPresetObject({
      objectId: deterministicObjectId("live preset"),
      name: "Live",
      folderPath: "Leads",
      values: {
        PlaybackMode: 1,
        Waveform: 9,
        SynthDrive: 2
      }
    });

    const frames = await client.sendSynthPresetPreview(preset);
    const decoded = frames.map((frame) => decodePresetSyncFrame(frame));

    expect(decoded[0].message).toBe(MessageType.WriteBegin);
    expect(decoded.at(-2)?.message).toBe(MessageType.TransferEnd);
    expect(decoded.at(-1)?.message).toBe(MessageType.WriteCommit);
    expect(decoded.slice(1, -2).every((frame) => frame.message === MessageType.DataChunk)).toBe(true);
    expect(decodeWriteBeginPayload(decoded[0].payload)).toMatchObject({
      objectType: ObjectType.SynthPreset,
      rawByteLength: preset.body.length,
      writeFlags: 0x01
    });
    expect(decodeWriteCommitPayload(decoded[4].payload)).toMatchObject({
      rawByteLength: preset.body.length,
      commitFlags: 0x01
    });
    expect(transport.sentMessages).toHaveLength(frames.length);
  });

  it("sends a save synth preset transfer with apply and flash flags", async () => {
    const transport = new MockMidiTransport();
    const client = new PresetSyncClient(transport);
    const preset = createSynthPresetObject({
      objectId: deterministicObjectId("saved preset"),
      name: "Saved",
      folderPath: "Pads",
      values: {
        PlaybackMode: 3,
        Waveform: 1
      }
    });

    const frames = await client.sendSynthPresetSave(preset);
    const decoded = frames.map((frame) => decodePresetSyncFrame(frame));

    expect(decodeWriteBeginPayload(decoded[0].payload).writeFlags).toBe(0x03);
    expect(decodeWriteCommitPayload(decoded.at(-1)?.payload ?? [])).toMatchObject({
      commitFlags: 0x03
    });
  });
});
