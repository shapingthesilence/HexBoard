import {
  HEXBOARD_MANUFACTURER_ID,
  MessageType,
  PRESET_SYNC_FAMILY,
  PROTOCOL_MAJOR,
  PROTOCOL_MINOR,
  SYSEX_END,
  SYSEX_START
} from "./constants.ts";
import {
  assertSevenBitByte,
  assertSevenBitBytes,
  decodeU14,
  decodeU21,
  decodeU28,
  decodeU35ToU32,
  encodeU14,
  encodeU21,
  encodeU28,
  encodeU35FromU32
} from "./numbers.ts";
import { chunkChecksum, pack8To7, unpack8To7 } from "./packing.ts";

export interface PresetSyncFrame {
  major: number;
  minor: number;
  message: number;
  transactionId: number;
  payload: number[];
}

export interface AckPayload {
  message: number;
  status: number;
  nextChunkIndex: number;
  detail: number;
}

export interface NackPayload {
  message: number;
  errorCode: number;
  expectedChunkIndex: number;
  detail: number;
}

export interface WriteBeginPayload {
  objectType: number;
  handle: number;
  transferId: number;
  schemaMajor: number;
  schemaMinor: number;
  rawByteLength: number;
  objectCrc32: number;
  rawChunkSize: number;
  writeFlags: number;
}

export type ReadBeginPayload = Omit<WriteBeginPayload, "writeFlags"> & {
  transferFlags: number;
};

export interface ObjectListRecord {
  objectType: number;
  handle: number;
  flags: number;
  schemaMajor: number;
  schemaMinor: number;
  objectId: Uint8Array;
  folderPath: string;
  name: string;
}

export interface ObjectListResponsePayload {
  objectType: number;
  pageIndex: number;
  pageCount: number;
  records: ObjectListRecord[];
}

export interface DataChunkPayload {
  transferId: number;
  chunkIndex: number;
  rawOffset: number;
  rawLength: number;
  checksum: number;
  rawData: Uint8Array;
}

export interface WriteCommitPayload {
  transferId: number;
  rawByteLength: number;
  objectCrc32: number;
  commitFlags: number;
}

export interface TransferEndPayload {
  transferId: number;
  finalChunkCount: number;
}

export function encodePresetSyncFrame(frame: PresetSyncFrame): number[] {
  assertSevenBitByte(frame.major, "major");
  assertSevenBitByte(frame.minor, "minor");
  assertSevenBitByte(frame.message, "message");
  assertSevenBitBytes(frame.payload, "payload");

  return [
    SYSEX_START,
    HEXBOARD_MANUFACTURER_ID,
    PRESET_SYNC_FAMILY,
    frame.major,
    frame.minor,
    frame.message,
    ...encodeU14(frame.transactionId),
    ...frame.payload,
    SYSEX_END
  ];
}

export function encodeDefaultPresetSyncFrame(message: number, transactionId: number, payload: number[]): number[] {
  return encodePresetSyncFrame({
    major: PROTOCOL_MAJOR,
    minor: PROTOCOL_MINOR,
    message,
    transactionId,
    payload
  });
}

export function decodePresetSyncFrame(bytes: ArrayLike<number>): PresetSyncFrame {
  if (bytes.length < 9) {
    throw new Error("preset-sync SysEx frame is too short");
  }
  if (bytes[0] !== SYSEX_START || bytes[bytes.length - 1] !== SYSEX_END) {
    throw new Error("preset-sync SysEx frame must start with F0 and end with F7");
  }
  if (bytes[1] !== HEXBOARD_MANUFACTURER_ID || bytes[2] !== PRESET_SYNC_FAMILY) {
    throw new Error("not a HexBoard preset-sync SysEx frame");
  }

  const payload = Array.from(bytes).slice(8, -1);
  assertSevenBitBytes(payload, "payload");

  return {
    major: bytes[3],
    minor: bytes[4],
    message: bytes[5],
    transactionId: decodeU14(bytes, 6),
    payload
  };
}

export function encodeAckPayload(payload: AckPayload): number[] {
  assertSevenBitByte(payload.message, "ack message");
  assertSevenBitByte(payload.status, "ack status");
  assertSevenBitByte(payload.detail, "ack detail");
  return [payload.message, payload.status, ...encodeU21(payload.nextChunkIndex), payload.detail];
}

export function decodeAckPayload(payload: ArrayLike<number>): AckPayload {
  if (payload.length !== 6) {
    throw new Error("ACK payload must be 6 bytes");
  }
  return {
    message: payload[0],
    status: payload[1],
    nextChunkIndex: decodeU21(payload, 2),
    detail: payload[5]
  };
}

export function encodeNackPayload(payload: NackPayload): number[] {
  assertSevenBitByte(payload.message, "nack message");
  assertSevenBitByte(payload.errorCode, "nack errorCode");
  assertSevenBitByte(payload.detail, "nack detail");
  return [payload.message, payload.errorCode, ...encodeU21(payload.expectedChunkIndex), payload.detail];
}

export function decodeNackPayload(payload: ArrayLike<number>): NackPayload {
  if (payload.length !== 6) {
    throw new Error("NACK payload must be 6 bytes");
  }
  return {
    message: payload[0],
    errorCode: payload[1],
    expectedChunkIndex: decodeU21(payload, 2),
    detail: payload[5]
  };
}

export function encodeHelloRequestPayload(hostMaxPackedChunk: number, requiredCapabilityFlags = 0): number[] {
  return [...encodeU14(hostMaxPackedChunk), ...encodeU28(requiredCapabilityFlags)];
}

export function encodeReadRequestPayload(objectType: number, handle: number, readFlags = 0): number[] {
  assertSevenBitByte(objectType, "objectType");
  assertSevenBitByte(readFlags, "readFlags");
  return [objectType, ...encodeU14(handle), readFlags];
}

export function encodeObjectListRequestPayload(
  objectType: number,
  pageIndex: number,
  pageSize: number,
  folderFilter = ""
): number[] {
  assertSevenBitByte(objectType, "objectType");
  assertSevenBitByte(pageSize, "pageSize");
  const folderBytes = Array.from(new TextEncoder().encode(folderFilter));
  if (folderBytes.length > 127) {
    throw new RangeError("folder filter is too long");
  }
  assertSevenBitBytes(folderBytes, "folderFilter");
  return [objectType, ...encodeU14(pageIndex), pageSize, folderBytes.length, ...folderBytes];
}

export function encodeWriteBeginPayload(payload: WriteBeginPayload): number[] {
  assertSevenBitByte(payload.objectType, "objectType");
  assertSevenBitByte(payload.schemaMajor, "schemaMajor");
  assertSevenBitByte(payload.schemaMinor, "schemaMinor");
  assertSevenBitByte(payload.writeFlags, "writeFlags");
  return [
    payload.objectType,
    ...encodeU14(payload.handle),
    ...encodeU14(payload.transferId),
    payload.schemaMajor,
    payload.schemaMinor,
    ...encodeU28(payload.rawByteLength),
    ...encodeU35FromU32(payload.objectCrc32),
    ...encodeU14(payload.rawChunkSize),
    payload.writeFlags
  ];
}

export function decodeWriteBeginPayload(payload: ArrayLike<number>): WriteBeginPayload {
  if (payload.length !== 19) {
    throw new Error("WRITE_BEGIN payload must be 19 bytes");
  }
  return {
    objectType: payload[0],
    handle: decodeU14(payload, 1),
    transferId: decodeU14(payload, 3),
    schemaMajor: payload[5],
    schemaMinor: payload[6],
    rawByteLength: decodeU28(payload, 7),
    objectCrc32: decodeU35ToU32(payload, 11),
    rawChunkSize: decodeU14(payload, 16),
    writeFlags: payload[18]
  };
}

export function decodeReadBeginPayload(payload: ArrayLike<number>): ReadBeginPayload {
  const decoded = decodeWriteBeginPayload(payload);
  return {
    ...decoded,
    transferFlags: decoded.writeFlags
  };
}

function decodeAscii(bytes: ArrayLike<number>, offset: number, length: number): string {
  const value = Array.from({ length }, (_, index) => bytes[offset + index]);
  assertSevenBitBytes(value, "ascii");
  return new TextDecoder().decode(new Uint8Array(value));
}

export function decodeObjectListResponsePayload(payload: ArrayLike<number>): ObjectListResponsePayload {
  if (payload.length < 6) {
    throw new Error("OBJECT_LIST_RESP payload is too short");
  }
  const objectType = payload[0];
  const pageIndex = decodeU14(payload, 1);
  const pageCount = decodeU14(payload, 3);
  const recordCount = payload[5];
  const records: ObjectListRecord[] = [];
  let cursor = 6;

  for (let recordIndex = 0; recordIndex < recordCount; recordIndex += 1) {
    if (cursor + 7 > payload.length) {
      throw new Error("truncated OBJECT_LIST_RESP record");
    }
    const recordObjectType = payload[cursor++];
    const handle = decodeU14(payload, cursor);
    cursor += 2;
    const flags = payload[cursor++];
    const schemaMajor = payload[cursor++];
    const schemaMinor = payload[cursor++];
    const objectIdPackedLength = payload[cursor++];
    if (cursor + objectIdPackedLength > payload.length) {
      throw new Error("truncated OBJECT_LIST_RESP object id");
    }
    const objectId = unpack8To7(Array.from(payload).slice(cursor, cursor + objectIdPackedLength), 16);
    cursor += objectIdPackedLength;

    if (cursor >= payload.length) {
      throw new Error("truncated OBJECT_LIST_RESP folder length");
    }
    const folderLength = payload[cursor++];
    if (cursor + folderLength > payload.length) {
      throw new Error("truncated OBJECT_LIST_RESP folder");
    }
    const folderPath = decodeAscii(payload, cursor, folderLength);
    cursor += folderLength;

    if (cursor >= payload.length) {
      throw new Error("truncated OBJECT_LIST_RESP name length");
    }
    const nameLength = payload[cursor++];
    if (cursor + nameLength > payload.length) {
      throw new Error("truncated OBJECT_LIST_RESP name");
    }
    const name = decodeAscii(payload, cursor, nameLength);
    cursor += nameLength;

    records.push({
      objectType: recordObjectType,
      handle,
      flags,
      schemaMajor,
      schemaMinor,
      objectId,
      folderPath,
      name
    });
  }

  return { objectType, pageIndex, pageCount, records };
}

export function encodeDataChunkPayload(payload: Omit<DataChunkPayload, "rawLength" | "checksum">): number[] {
  const checksum = chunkChecksum(payload.rawData);
  return [
    ...encodeU14(payload.transferId),
    ...encodeU21(payload.chunkIndex),
    ...encodeU28(payload.rawOffset),
    ...encodeU14(payload.rawData.length),
    checksum,
    ...pack8To7(payload.rawData)
  ];
}

export function decodeDataChunkPayload(payload: ArrayLike<number>): DataChunkPayload {
  if (payload.length < 12) {
    throw new Error("DATA_CHUNK payload is too short");
  }
  const rawLength = decodeU14(payload, 9);
  const rawData = unpack8To7(Array.from(payload).slice(12), rawLength);
  const checksum = payload[11];
  const computed = chunkChecksum(rawData);
  if (checksum !== computed) {
    throw new Error(`DATA_CHUNK checksum mismatch: ${checksum} != ${computed}`);
  }
  return {
    transferId: decodeU14(payload, 0),
    chunkIndex: decodeU21(payload, 2),
    rawOffset: decodeU28(payload, 5),
    rawLength,
    checksum,
    rawData
  };
}

export function encodeTransferEndPayload(transferId: number, finalChunkCount: number): number[] {
  return [...encodeU14(transferId), ...encodeU21(finalChunkCount)];
}

export function decodeTransferEndPayload(payload: ArrayLike<number>): TransferEndPayload {
  if (payload.length !== 5) {
    throw new Error("TRANSFER_END payload must be 5 bytes");
  }
  return {
    transferId: decodeU14(payload, 0),
    finalChunkCount: decodeU21(payload, 2)
  };
}

export function encodeWriteCommitPayload(payload: WriteCommitPayload): number[] {
  assertSevenBitByte(payload.commitFlags, "commitFlags");
  return [
    ...encodeU14(payload.transferId),
    ...encodeU28(payload.rawByteLength),
    ...encodeU35FromU32(payload.objectCrc32),
    payload.commitFlags
  ];
}

export function decodeWriteCommitPayload(payload: ArrayLike<number>): WriteCommitPayload {
  if (payload.length !== 12) {
    throw new Error("WRITE_COMMIT payload must be 12 bytes");
  }
  return {
    transferId: decodeU14(payload, 0),
    rawByteLength: decodeU28(payload, 2),
    objectCrc32: decodeU35ToU32(payload, 6),
    commitFlags: payload[11]
  };
}

export function encodeDeleteRequestPayload(objectType: number, handle: number, deleteFlags = 0): number[] {
  assertSevenBitByte(objectType, "objectType");
  assertSevenBitByte(deleteFlags, "deleteFlags");
  return [objectType, ...encodeU14(handle), deleteFlags];
}

export function encodeAckFrame(transactionId: number, ackedMessage: number, nextChunkIndex = 0): number[] {
  return encodeDefaultPresetSyncFrame(
    MessageType.Ack,
    transactionId,
    encodeAckPayload({ message: ackedMessage, status: 0, nextChunkIndex, detail: 0 })
  );
}
