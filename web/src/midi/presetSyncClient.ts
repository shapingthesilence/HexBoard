import {
  ErrorCode,
  HEXBOARD_MANUFACTURER_ID,
  MessageType,
  NEW_OBJECT_HANDLE,
  ObjectType,
  PRESET_SYNC_FAMILY,
  SYSEX_START,
  WriteFlag,
  crc32,
  decodeDataChunkPayload,
  decodeNackPayload,
  decodeObjectListResponsePayload,
  decodePresetSyncFrame,
  decodeReadBeginPayload,
  decodeTransferEndPayload,
  decodeAckPayload,
  encodeDataChunkPayload,
  encodeDeleteRequestPayload,
  encodeDefaultPresetSyncFrame,
  encodeHelloRequestPayload,
  encodeObjectListRequestPayload,
  encodeReadRequestPayload,
  encodeTransferEndPayload,
  encodeWriteBeginPayload,
  encodeWriteCommitPayload,
  type ObjectListRecord,
  type PresetSyncFrame
} from "../protocol/index.ts";
import type { EncodedCatalogObject } from "../catalogs/types.ts";
import type { MidiTransport } from "./types.ts";

const DEFAULT_RAW_CHUNK_SIZE = 64;
const DEFAULT_RESPONSE_TIMEOUT_MS = 5000;
const FLASH_WRITE_RESPONSE_TIMEOUT_MS = 5000;

const presetSyncErrorNames = new Map<number, string>(
  Object.entries(ErrorCode).map(([name, value]) => [value, name])
);

function decodeIncomingPresetSyncFrame(bytes: ArrayLike<number>): PresetSyncFrame | null {
  if (
    bytes.length < 3
    || bytes[0] !== SYSEX_START
    || bytes[1] !== HEXBOARD_MANUFACTURER_ID
    || bytes[2] !== PRESET_SYNC_FAMILY
  ) {
    return null;
  }
  return decodePresetSyncFrame(bytes);
}

function describeNack(frame: PresetSyncFrame): Error {
  const nack = decodeNackPayload(frame.payload);
  const errorName = presetSyncErrorNames.get(nack.errorCode) ?? `Error ${nack.errorCode}`;
  return new Error(`HexBoard rejected ${messageName(nack.message)}: ${errorName}`);
}

function messageName(message: number): string {
  return Object.entries(MessageType).find(([, value]) => value === message)?.[0] ?? `message ${message}`;
}

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

  async listSynthPresets(pageSize = 1): Promise<ObjectListRecord[]> {
    const records: ObjectListRecord[] = [];
    let pageIndex = 0;
    let pageCount = 1;

    do {
      const frame = await this.requestFrame(
        MessageType.ObjectListRequest,
        encodeObjectListRequestPayload(ObjectType.SynthPreset, pageIndex, pageSize),
        (candidate) => candidate.message === MessageType.ObjectListResponse
      );
      const page = decodeObjectListResponsePayload(frame.payload);
      records.push(...page.records);
      pageCount = page.pageCount;
      pageIndex += 1;
    } while (pageIndex < pageCount);

    return records;
  }

  async readSynthPreset(handle: number): Promise<Uint8Array> {
    return this.readObject(ObjectType.SynthPreset, handle);
  }

  async deleteSynthPreset(handle: number): Promise<void> {
    await this.requestFrame(
      MessageType.DeleteRequest,
      encodeDeleteRequestPayload(ObjectType.SynthPreset, handle),
      (candidate) => {
        if (candidate.message !== MessageType.Ack) {
          return false;
        }
        return decodeAckPayload(candidate.payload).message === MessageType.DeleteRequest;
      }
    );
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

  async sendObjectWriteConfirmed(input: {
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

    frames.push(await this.sendAndWaitForAck(
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
      frames.push(await this.sendAndWaitForAck(
        MessageType.DataChunk,
        encodeDataChunkPayload({
          transferId,
          chunkIndex,
          rawOffset: offset,
          rawData
        }),
        (ack) => ack.nextChunkIndex === chunkIndex + 1
      ));
      chunkIndex += 1;
    }

    frames.push(await this.sendAndWaitForAck(
      MessageType.TransferEnd,
      encodeTransferEndPayload(transferId, chunkIndex)
    ));
    frames.push(await this.sendAndWaitForAck(
      MessageType.WriteCommit,
      encodeWriteCommitPayload({
        transferId,
        rawByteLength: input.body.length,
        objectCrc32,
        commitFlags: writeFlags
      }),
      undefined,
      FLASH_WRITE_RESPONSE_TIMEOUT_MS
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

  async sendSynthPresetSaveConfirmed(preset: EncodedCatalogObject): Promise<number[][]> {
    return this.sendObjectWriteConfirmed({
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
      const frame = decodeIncomingPresetSyncFrame(bytes);
      if (frame) {
        listener(frame);
      }
    });
  }

  private async send(message: number, payload: number[]): Promise<number[]> {
    const transaction = this.nextTransaction();
    const frame = encodeDefaultPresetSyncFrame(message, transaction, payload);
    await this.transport.send(frame);
    return frame;
  }

  private async requestFrame(
    message: number,
    payload: number[],
    predicate: (frame: PresetSyncFrame) => boolean,
    timeoutMs = DEFAULT_RESPONSE_TIMEOUT_MS
  ): Promise<PresetSyncFrame> {
    const transaction = this.nextTransaction();

    return new Promise((resolve, reject) => {
      const timeout = globalThis.setTimeout(() => {
        unsubscribe();
        reject(new Error("Timed out waiting for HexBoard preset-sync response"));
      }, timeoutMs);

      const unsubscribe = this.transport.subscribe((bytes) => {
        try {
          const frame = decodeIncomingPresetSyncFrame(bytes);
          if (!frame) {
            return;
          }
          if (frame.transactionId !== transaction) {
            return;
          }
          if (frame.message === MessageType.Nack) {
            globalThis.clearTimeout(timeout);
            unsubscribe();
            reject(describeNack(frame));
            return;
          }
          if (predicate(frame)) {
            globalThis.clearTimeout(timeout);
            unsubscribe();
            resolve(frame);
          }
        } catch (error) {
          globalThis.clearTimeout(timeout);
          unsubscribe();
          reject(error);
        }
      });

      const frame = encodeDefaultPresetSyncFrame(message, transaction, payload);
      void this.transport.send(frame).catch((error) => {
        globalThis.clearTimeout(timeout);
        unsubscribe();
        reject(error);
      });
    });
  }

  private async sendAndWaitForAck(
    message: number,
    payload: number[],
    ackPredicate: (ack: ReturnType<typeof decodeAckPayload>) => boolean = () => true,
    timeoutMs = DEFAULT_RESPONSE_TIMEOUT_MS
  ): Promise<number[]> {
    const transaction = this.nextTransaction();
    const frame = encodeDefaultPresetSyncFrame(message, transaction, payload);

    return new Promise((resolve, reject) => {
      const timeout = globalThis.setTimeout(() => {
        unsubscribe();
        reject(new Error(`Timed out waiting for HexBoard ACK for ${messageName(message)}`));
      }, timeoutMs);

      const unsubscribe = this.transport.subscribe((bytes) => {
        try {
          const response = decodeIncomingPresetSyncFrame(bytes);
          if (!response) {
            return;
          }
          if (response.transactionId !== transaction) {
            return;
          }
          if (response.message === MessageType.Nack) {
            globalThis.clearTimeout(timeout);
            unsubscribe();
            reject(describeNack(response));
            return;
          }
          if (response.message !== MessageType.Ack) {
            return;
          }
          const ack = decodeAckPayload(response.payload);
          if (ack.message !== message || !ackPredicate(ack)) {
            return;
          }
          globalThis.clearTimeout(timeout);
          unsubscribe();
          resolve(frame);
        } catch (error) {
          globalThis.clearTimeout(timeout);
          unsubscribe();
          reject(error);
        }
      });

      void this.transport.send(frame).catch((error) => {
        globalThis.clearTimeout(timeout);
        unsubscribe();
        reject(error);
      });
    });
  }

  private async readObject(objectType: number, handle: number, timeoutMs = DEFAULT_RESPONSE_TIMEOUT_MS): Promise<Uint8Array> {
    const transaction = this.nextTransaction();

    return new Promise((resolve, reject) => {
      let expectedTransferId: number | null = null;
      let expectedLength = 0;
      let receivedBytes = 0;
      let output = new Uint8Array();

      const timeout = globalThis.setTimeout(() => {
        unsubscribe();
        reject(new Error("Timed out waiting for HexBoard object read"));
      }, timeoutMs);

      const finish = (result: Uint8Array) => {
        globalThis.clearTimeout(timeout);
        unsubscribe();
        resolve(result);
      };

      const fail = (error: unknown) => {
        globalThis.clearTimeout(timeout);
        unsubscribe();
        reject(error);
      };

      const unsubscribe = this.transport.subscribe((bytes) => {
        try {
          const frame = decodeIncomingPresetSyncFrame(bytes);
          if (!frame) {
            return;
          }
          if (frame.transactionId !== transaction) {
            return;
          }
          if (frame.message === MessageType.Nack) {
            fail(describeNack(frame));
            return;
          }
          if (frame.message === MessageType.ReadBegin) {
            const begin = decodeReadBeginPayload(frame.payload);
            if (begin.objectType !== objectType || begin.handle !== handle) {
              throw new Error("Unexpected object in HexBoard read response");
            }
            expectedTransferId = begin.transferId;
            expectedLength = begin.rawByteLength;
            receivedBytes = 0;
            output = new Uint8Array(expectedLength);
            return;
          }
          if (frame.message === MessageType.DataChunk) {
            if (expectedTransferId === null) {
              throw new Error("Received data chunk before read begin");
            }
            const chunk = decodeDataChunkPayload(frame.payload);
            if (chunk.transferId !== expectedTransferId) {
              throw new Error("Unexpected transfer id in read chunk");
            }
            output.set(chunk.rawData, chunk.rawOffset);
            receivedBytes += chunk.rawLength;
            return;
          }
          if (frame.message === MessageType.TransferEnd) {
            const end = decodeTransferEndPayload(frame.payload);
            if (expectedTransferId === null || end.transferId !== expectedTransferId) {
              throw new Error("Unexpected transfer end");
            }
            if (receivedBytes !== expectedLength) {
              throw new Error("Incomplete object read from HexBoard");
            }
            finish(output);
          }
        } catch (error) {
          fail(error);
        }
      });

      const frame = encodeDefaultPresetSyncFrame(
        MessageType.ReadRequest,
        transaction,
        encodeReadRequestPayload(objectType, handle)
      );
      void this.transport.send(frame).catch(fail);
    });
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
