import { describe, expect, it } from "vitest";
import { deterministicObjectId } from "../catalogs/objectId.ts";
import { createSynthPresetObject } from "../catalogs/synthPresets.ts";
import {
  MessageType,
  ObjectType,
  decodePresetSyncFrame,
  decodeAckPayload,
  decodeDataChunkPayload,
  decodeWriteBeginPayload,
  decodeWriteCommitPayload,
  encodeAckFrame,
  encodeDataChunkPayload,
  encodeDefaultPresetSyncFrame,
  encodeTransferEndPayload
} from "../protocol/index.ts";
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

  it("can wait for ACKs before completing a saved synth preset transfer", async () => {
    const transport = new MockMidiTransport();
    const originalSend = transport.send.bind(transport);
    transport.send = async (bytes) => {
      await originalSend(bytes);
      const frame = decodePresetSyncFrame(bytes);
      const nextChunkIndex = frame.message === MessageType.DataChunk
        ? decodeDataChunkPayload(frame.payload).chunkIndex + 1
        : 0;
      transport.emit(encodeAckFrame(frame.transactionId, frame.message, nextChunkIndex));
    };
    const client = new PresetSyncClient(transport);
    const preset = createSynthPresetObject({
      objectId: deterministicObjectId("confirmed preset"),
      name: "Confirmed",
      folderPath: "Pads",
      values: {
        PlaybackMode: 3,
        Waveform: 1
      }
    });

    const frames = await client.sendSynthPresetSaveConfirmed(preset);
    const decoded = frames.map((frame) => decodePresetSyncFrame(frame));

    expect(decoded[0].message).toBe(MessageType.WriteBegin);
    expect(decoded.at(-1)?.message).toBe(MessageType.WriteCommit);
    expect(decodeWriteCommitPayload(decoded.at(-1)?.payload ?? [])).toMatchObject({
      commitFlags: 0x03
    });
  });

  it("ignores non-preset-sync MIDI while waiting for device storage responses", async () => {
    const transport = new MockMidiTransport();
    const client = new PresetSyncClient(transport);
    const request = client.listSynthPresets();

    transport.emit([0xfe]);
    transport.emit([0x90, 60, 100]);
    transport.emit(encodeDefaultPresetSyncFrame(MessageType.ObjectListResponse, 1, [
      ObjectType.SynthPreset,
      0x00,
      0x00,
      0x00,
      0x01,
      0x00
    ]));

    await expect(request).resolves.toEqual([]);
  });

  it("ACKs device-to-host read chunks before completing a synth preset read", async () => {
    const transport = new MockMidiTransport();
    const client = new PresetSyncClient(transport);
    const request = client.readSynthPreset(0);
    const transaction = decodePresetSyncFrame(transport.sentMessages[0]).transactionId;
    const transferId = 7;
    const rawData = new Uint8Array([0x48, 0x42, 0x53]);

    transport.emit(encodeDefaultPresetSyncFrame(MessageType.ReadBegin, transaction, [
      ObjectType.SynthPreset,
      0x00,
      0x00,
      0x00,
      transferId,
      0x01,
      0x00,
      0x00,
      0x00,
      0x00,
      rawData.length,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x40,
      0x00
    ]));
    let ack = decodePresetSyncFrame(transport.sentMessages.at(-1) ?? []);
    expect(ack.message).toBe(MessageType.Ack);
    expect(decodeAckPayload(ack.payload)).toMatchObject({
      message: MessageType.ReadBegin,
      nextChunkIndex: 0
    });

    transport.emit(encodeDefaultPresetSyncFrame(
      MessageType.DataChunk,
      transaction,
      encodeDataChunkPayload({
        transferId,
        chunkIndex: 0,
        rawOffset: 0,
        rawData
      })
    ));
    ack = decodePresetSyncFrame(transport.sentMessages.at(-1) ?? []);
    expect(decodeAckPayload(ack.payload)).toMatchObject({
      message: MessageType.DataChunk,
      nextChunkIndex: 1
    });

    transport.emit(encodeDefaultPresetSyncFrame(
      MessageType.TransferEnd,
      transaction,
      encodeTransferEndPayload(transferId, 1)
    ));

    await expect(request).resolves.toEqual(rawData);
    ack = decodePresetSyncFrame(transport.sentMessages.at(-1) ?? []);
    expect(decodeAckPayload(ack.payload)).toMatchObject({
      message: MessageType.TransferEnd,
      nextChunkIndex: 1
    });
  });
});
