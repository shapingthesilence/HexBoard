import { describe, expect, it, vi } from "vitest";
import { deterministicObjectId } from "../catalogs/objectId.ts";
import {
  GeometryObjectSchemaVersion,
  createDefaultLayoutBundle,
  createGeneratedEdoTuning,
  encodeGeometryCatalogOrder,
  encodeLayoutBundle
} from "../catalogs/layoutsCatalog.ts";
import { createSynthPresetObject } from "../catalogs/synthPresets.ts";
import { createSynthWavetableObject, SYNTH_WAVETABLE_SAMPLE_BYTES } from "../catalogs/synthWavetables.ts";
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

  it("sends a compact live synth parameter frame", async () => {
    const transport = new MockMidiTransport();
    const client = new PresetSyncClient(transport);

    const frame = await client.sendSynthParameterPreview(59, 191);
    const decoded = decodePresetSyncFrame(frame);

    expect(decoded.message).toBe(MessageType.SynthParamSet);
    expect(decoded.payload).toEqual([1, 59, 63, 1]);
    expect(Array.from(transport.sentMessages[0])).toEqual(frame);
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

  it("sends an imported synth wavetable transfer with apply and flash flags", async () => {
    const transport = new MockMidiTransport();
    const client = new PresetSyncClient(transport);
    const wavetable = createSynthWavetableObject({
      objectId: deterministicObjectId("wavetable"),
      name: "Wavetable",
      samples: new Uint8Array(SYNTH_WAVETABLE_SAMPLE_BYTES).fill(128)
    });

    const frames = await client.sendSynthWavetableImport(wavetable);
    const decoded = frames.map((frame) => decodePresetSyncFrame(frame));

    expect(decodeWriteBeginPayload(decoded[0].payload)).toMatchObject({
      objectType: ObjectType.SynthWavetable,
      rawByteLength: wavetable.body.length,
      writeFlags: 0x03
    });
    expect(decoded.slice(1, -2).every((frame) => frame.message === MessageType.DataChunk)).toBe(true);
    expect(decodeWriteCommitPayload(decoded.at(-1)?.payload ?? [])).toMatchObject({
      rawByteLength: wavetable.body.length,
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

  it("saves a complete geometry bundle as one file transfer", async () => {
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
    const bundle = encodeLayoutBundle(createDefaultLayoutBundle());
    const frames = await client.sendGeometryBundleSaveConfirmed(bundle.bundleFile);
    const decoded = frames.map((frame) => decodePresetSyncFrame(frame));

    expect(decodeWriteBeginPayload(decoded[0].payload)).toMatchObject({
      objectType: ObjectType.GeometryBundle,
      rawByteLength: bundle.bundleFile.length,
      writeFlags: 0x02
    });
    expect(decodeWriteCommitPayload(decoded.at(-1)?.payload ?? [])).toMatchObject({
      commitFlags: 0x02
    });
  });

  it("saves geometry order as one small flash transfer", async () => {
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
    const order = encodeGeometryCatalogOrder([
      deterministicObjectId("first geometry"),
      deterministicObjectId("second geometry")
    ]);
    const frames = await client.sendGeometryOrderSaveConfirmed(order);
    const decoded = frames.map((frame) => decodePresetSyncFrame(frame));

    expect(decodeWriteBeginPayload(decoded[0].payload)).toMatchObject({
      objectType: ObjectType.GeometryOrder,
      rawByteLength: order.length,
      writeFlags: 0x02
    });
  });

  it("sends geometry preview objects with apply-to-runtime only", async () => {
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
    const tuning = createGeneratedEdoTuning({
      objectId: deterministicObjectId("preview geometry tuning"),
      name: "Preview Geometry Tuning",
      edoDivisions: 19
    });

    const frames = await client.sendGeometryObjectPreviewConfirmed(tuning);
    const decoded = frames.map((frame) => decodePresetSyncFrame(frame));

    expect(decodeWriteBeginPayload(decoded[0].payload)).toMatchObject({
      objectType: ObjectType.UserTuning,
      schemaMajor: GeometryObjectSchemaVersion,
      schemaMinor: 0,
      rawByteLength: tuning.body.length,
      writeFlags: 0x01
    });
    expect(decodeWriteCommitPayload(decoded.at(-1)?.payload ?? [])).toMatchObject({
      commitFlags: 0x01
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

  it("aborts an active device-to-host read when the object read times out", async () => {
    vi.useFakeTimers();
    try {
      const transport = new MockMidiTransport();
      const client = new PresetSyncClient(transport);
      const request = client.readSynthPreset(0);
      const transaction = decodePresetSyncFrame(transport.sentMessages[0]).transactionId;
      const transferId = 7;

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
        0x03,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x40,
        0x00
      ]));

      const rejection = expect(request).rejects.toThrow("Timed out waiting for HexBoard object read");
      await vi.advanceTimersByTimeAsync(15001);
      await rejection;

      const abort = decodePresetSyncFrame(transport.sentMessages.at(-1) ?? []);
      expect(abort.message).toBe(MessageType.TransferAbort);
      expect(abort.payload).toEqual([0x00, transferId, 0x01]);
    } finally {
      vi.useRealTimers();
    }
  });
});
