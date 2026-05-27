import {
  MessageType,
  NEW_OBJECT_HANDLE,
  ObjectType,
  WriteFlag,
  crc32,
  decodePresetSyncFrame,
  encodeDataChunkPayload,
  encodeDefaultPresetSyncFrame,
  encodeHelloRequestPayload,
  encodeReadRequestPayload,
  encodeTransferEndPayload,
  encodeWriteBeginPayload,
  encodeWriteCommitPayload
} from "../protocol/index.ts";
import type { EncodedCatalogObject } from "../catalogs/types.ts";
import type { MidiTransport } from "./types.ts";

const DEFAULT_RAW_CHUNK_SIZE = 64;

export class PresetSyncClient {
  private transactionId = 1;
  private transferId = 1;
  private readonly transport: MidiTransport;

  constructor(transport: MidiTransport) {
    this.transport = transport;
  }

  async sendHello(hostMaxPackedChunk = 128): Promise<number[]> {
    return this.send(MessageType.HelloRequest, encodeHelloRequestPayload(hostMaxPackedChunk));
  }

  async sendReadRequest(objectType: number, handle: number, readFlags = 0): Promise<number[]> {
    return this.send(MessageType.ReadRequest, encodeReadRequestPayload(objectType, handle, readFlags));
  }

  async sendObjectWrite(input: {
    objectType: number;
    body: Uint8Array;
    handle?: number;
    schemaMajor?: number;
    schemaMinor?: number;
    writeFlags?: number;
    rawChunkSize?: number;
  }): Promise<number[][]> {
    const handle = input.handle ?? NEW_OBJECT_HANDLE;
    const schemaMajor = input.schemaMajor ?? 1;
    const schemaMinor = input.schemaMinor ?? 0;
    const writeFlags = input.writeFlags ?? WriteFlag.ApplyToRuntime;
    const rawChunkSize = input.rawChunkSize ?? DEFAULT_RAW_CHUNK_SIZE;
    const objectCrc32 = crc32(input.body);
    const transferId = this.nextTransfer();
    const frames: number[][] = [];

    frames.push(await this.send(
      MessageType.WriteBegin,
      encodeWriteBeginPayload({
        objectType: input.objectType,
        handle,
        transferId,
        schemaMajor,
        schemaMinor,
        rawByteLength: input.body.length,
        objectCrc32,
        rawChunkSize,
        writeFlags
      })
    ));

    let chunkIndex = 0;
    for (let offset = 0; offset < input.body.length; offset += rawChunkSize) {
      const rawData = input.body.slice(offset, offset + rawChunkSize);
      frames.push(await this.send(
        MessageType.DataChunk,
        encodeDataChunkPayload({
          transferId,
          chunkIndex,
          rawOffset: offset,
          rawData
        })
      ));
      chunkIndex += 1;
    }

    frames.push(await this.send(MessageType.TransferEnd, encodeTransferEndPayload(transferId, chunkIndex)));
    frames.push(await this.send(
      MessageType.WriteCommit,
      encodeWriteCommitPayload({
        transferId,
        rawByteLength: input.body.length,
        objectCrc32,
        commitFlags: writeFlags
      })
    ));

    return frames;
  }

  async sendSynthPresetPreview(preset: EncodedCatalogObject): Promise<number[][]> {
    return this.sendObjectWrite({
      objectType: ObjectType.SynthPreset,
      body: preset.body,
      handle: NEW_OBJECT_HANDLE,
      schemaMajor: preset.schemaMajor,
      schemaMinor: preset.schemaMinor,
      writeFlags: WriteFlag.ApplyToRuntime
    });
  }

  async sendSynthPresetSave(preset: EncodedCatalogObject): Promise<number[][]> {
    return this.sendObjectWrite({
      objectType: ObjectType.SynthPreset,
      body: preset.body,
      handle: NEW_OBJECT_HANDLE,
      schemaMajor: preset.schemaMajor,
      schemaMinor: preset.schemaMinor,
      writeFlags: WriteFlag.ApplyToRuntime | WriteFlag.SaveToFlash
    });
  }

  subscribeToFrames(listener: (frame: ReturnType<typeof decodePresetSyncFrame>) => void): () => void {
    return this.transport.subscribe((bytes) => {
      listener(decodePresetSyncFrame(bytes));
    });
  }

  private async send(message: number, payload: number[]): Promise<number[]> {
    const transaction = this.nextTransaction();
    const frame = encodeDefaultPresetSyncFrame(message, transaction, payload);
    await this.transport.send(frame);
    return frame;
  }

  private nextTransaction(): number {
    const current = this.transactionId;
    this.transactionId = this.transactionId >= 0x3fff ? 1 : this.transactionId + 1;
    return current;
  }

  private nextTransfer(): number {
    const current = this.transferId;
    this.transferId = this.transferId >= 0x3fff ? 1 : this.transferId + 1;
    return current;
  }
}
