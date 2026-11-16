import { describe, expect, it, vi } from "vitest";
import { deterministicObjectId } from "../catalogs/objectId.ts";
import {
  GeometryObjectSchemaVersion,
  createDefaultTuningBundle,
  createGeneratedEdoTuning,
  encodeGeometryCatalogOrder,
  encodeTuningBundle
} from "../catalogs/layoutsCatalog.ts";
import { createSynthPresetObject } from "../catalogs/synthPresets.ts";
import { createSynthWavetableObject, SYNTH_WAVETABLE_SAMPLE_BYTES } from "../catalogs/synthWavetables.ts";
import { crc32 } from "../protocol/crc32.ts";
import {
  CapabilityFlag,
  encodeU14,encodeU21,pack8To7,decodeReadBeginPayload,
  MessageType,
  ObjectType,
  SynthWavetableSelector,
  decodePresetSyncFrame,
  decodeAckPayload,
  decodeDataChunkPayload,
  decodeWriteBeginPayload,
  decodeWriteCommitPayload,
  encodeAckFrame,
  encodeDataChunkPayload,
  encodeDefaultPresetSyncFrame,
  encodeTransferEndPayload,
  encodeWriteBeginPayload
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

  it("sends a compact live wavetable selection frame", async () => {
    const transport = new MockMidiTransport();
    const client = new PresetSyncClient(transport);

    const frame = await client.sendSynthWavetableSelect(SynthWavetableSelector.Catalog, 0x0123);
    const decoded = decodePresetSyncFrame(frame);

    expect(decoded.message).toBe(MessageType.SynthWavetableSelect);
    expect(decoded.payload).toEqual([SynthWavetableSelector.Catalog, 0x02, 0x23]);
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

  it("updates preset organization in place without applying it to runtime", async () => {
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
      objectId: deterministicObjectId("organized preset"),
      name: "Renamed",
      folderPath: "Moved",
      values: { PlaybackMode: 0, Waveform: 1 }
    });

    const frames = await client.sendSynthPresetUpdateConfirmed(preset, 23);
    const decoded = frames.map((frame) => decodePresetSyncFrame(frame));

    expect(decodeWriteBeginPayload(decoded[0].payload)).toMatchObject({
      objectType: ObjectType.SynthPreset,
      handle: 23,
      writeFlags: 0x06
    });
    expect(decodeWriteCommitPayload(decoded.at(-1)?.payload ?? [])).toMatchObject({
      commitFlags: 0x06
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
    const bundle = encodeTuningBundle(createDefaultTuningBundle());
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

  it("reads a complete geometry bundle with byte progress", async () => {
    const transport = new MockMidiTransport();
    const client = new PresetSyncClient(transport);
    const rawData = encodeTuningBundle(createDefaultTuningBundle()).bundleFile;
    const onProgress = vi.fn();
    const request = client.readGeometryBundle(0, onProgress);
    const transaction = decodePresetSyncFrame(transport.sentMessages[0]).transactionId;
    const transferId = 7;

    transport.emit(encodeDefaultPresetSyncFrame(MessageType.ReadBegin, transaction, encodeWriteBeginPayload({
      objectType: ObjectType.GeometryBundle,
      handle: 0,
      transferId,
      schemaMajor: 1,
      schemaMinor: 0,
      rawByteLength: rawData.length,
      objectCrc32: crc32(rawData),
      rawChunkSize: 64,
      writeFlags: 0
    })));
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
    expect(onProgress).toHaveBeenNthCalledWith(1, {
      direction: "download",
      objectType: ObjectType.GeometryBundle,
      transferredBytes: 0,
      totalBytes: rawData.length
    });
    expect(onProgress).toHaveBeenLastCalledWith({
      direction: "download",
      objectType: ObjectType.GeometryBundle,
      transferredBytes: rawData.length,
      totalBytes: rawData.length
    });
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

it('streams Advanced content batches with wide IDs while keeping legacy requests unchanged',async()=>{
 const t=new MockMidiTransport(),c=new PresetSyncClient(t,CapabilityFlag.AdvancedContentLibrary),pages:number[][]=[];
 const read=c.listGeometryObjects(ObjectType.UserTuning,8,undefined,rows=>pages.push(rows.map(r=>r.handle)));
 let sent=decodePresetSyncFrame(t.sentMessages[0]);expect(sent.message).toBe(MessageType.AdvancedObjectListRequest);expect(sent.payload).toEqual([3,0,0,4,0]);
 const row=(handle:number)=>[3,...encodeU21(handle),1,2,0,19,...pack8To7(new Uint8Array(16).fill(1)),0,1,65];
 t.emit(encodeDefaultPresetSyncFrame(MessageType.AdvancedObjectListResponse,sent.transactionId,[3,0,0,0,2,2,...row(0),...row(32768)]));
 await vi.waitFor(()=>expect(t.sentMessages).toHaveLength(2));expect(pages).toEqual([[0,32768]]);
 sent=decodePresetSyncFrame(t.sentMessages[1]);t.emit(encodeDefaultPresetSyncFrame(MessageType.AdvancedObjectListResponse,sent.transactionId,[3,0,1,0,2,1,...row(65280)]));
 expect((await read).map(r=>r.handle)).toEqual([0,32768,65280]);expect(pages.at(-1)).toEqual([0,32768,65280]);
 const legacyT=new MockMidiTransport(),legacy=new PresetSyncClient(legacyT),pending=legacy.listGeometryObjects(3,4);
 const old=decodePresetSyncFrame(legacyT.sentMessages[0]);expect(old.message).toBe(MessageType.ObjectListRequest);legacyT.emit(encodeDefaultPresetSyncFrame(MessageType.ObjectListResponse,old.transactionId,[3,0,0,0,1,0]));await pending;
});
it('reads and deletes a high Advanced handle without truncation',async()=>{
 const t=new MockMidiTransport(),c=new PresetSyncClient(t,CapabilityFlag.AdvancedContentLibrary),raw=new Uint8Array([1,2,3]);
 const reading=c.readGeometryBundle(65280),request=decodePresetSyncFrame(t.sentMessages[0]);expect(request.message).toBe(MessageType.AdvancedReadRequest);expect(request.payload).toEqual([12,...encodeU21(65280),0]);
 const old=encodeWriteBeginPayload({objectType:12,handle:0,transferId:7,schemaMajor:1,schemaMinor:0,rawByteLength:raw.length,objectCrc32:crc32(raw),rawChunkSize:64,writeFlags:0});
 const begin=[12,...encodeU21(65280),...old.slice(3)];expect(decodeReadBeginPayload(begin,true).handle).toBe(65280);
 t.emit(encodeDefaultPresetSyncFrame(MessageType.AdvancedReadBegin,request.transactionId,begin));expect(decodeAckPayload(decodePresetSyncFrame(t.sentMessages.at(-1)!).payload).message).toBe(MessageType.AdvancedReadBegin);
 t.emit(encodeDefaultPresetSyncFrame(MessageType.DataChunk,request.transactionId,encodeDataChunkPayload({transferId:7,chunkIndex:0,rawOffset:0,rawData:raw})));
 t.emit(encodeDefaultPresetSyncFrame(MessageType.TransferEnd,request.transactionId,encodeTransferEndPayload(7,1)));await expect(reading).resolves.toEqual(raw);
 const deleting=c.deleteGeometryObject(3,65280),remove=decodePresetSyncFrame(t.sentMessages.at(-1)!);expect(remove.message).toBe(MessageType.AdvancedDeleteRequest);expect(remove.payload).toEqual([3,...encodeU21(65280),0]);t.emit(encodeAckFrame(remove.transactionId,MessageType.AdvancedDeleteRequest));await deleting;
});
it('supports 256-entry Advanced order files while preserving the original limit',()=>{
 const ids=Array.from({length:256},(_,i)=>deterministicObjectId(`Library ${i}`));const bytes=encodeGeometryCatalogOrder(ids,true);expect(Array.from(bytes.slice(0,8))).toEqual([72,71,79,2,0,1,0,0]);expect(bytes).toHaveLength(4108);expect(()=>encodeGeometryCatalogOrder(ids)).toThrow(/64/);expect(()=>encodeGeometryCatalogOrder([...ids,deterministicObjectId('overflow')],true)).toThrow(/256/);
});
