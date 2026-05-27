import { describe, expect, it } from "vitest";
import { NEW_OBJECT_HANDLE, MessageType, ObjectType } from "./constants.ts";
import {
  decodeDataChunkPayload,
  decodePresetSyncFrame,
  decodeWriteBeginPayload,
  encodeAckFrame,
  encodeDataChunkPayload,
  encodeDefaultPresetSyncFrame,
  encodeReadRequestPayload,
  encodeWriteBeginPayload
} from "./sysex.ts";

describe("preset-sync SysEx", () => {
  it("encodes and decodes the spec read-profile example", () => {
    const frame = encodeDefaultPresetSyncFrame(
      MessageType.ReadRequest,
      2,
      encodeReadRequestPayload(ObjectType.DeviceProfile, 0)
    );
    expect(frame).toEqual([0xf0, 0x7d, 0x10, 0x01, 0x00, 0x22, 0x00, 0x02, 0x01, 0x00, 0x00, 0x00, 0xf7]);

    const decoded = decodePresetSyncFrame(frame);
    expect(decoded.message).toBe(MessageType.ReadRequest);
    expect(decoded.transactionId).toBe(2);
    expect(decoded.payload).toEqual([0x01, 0x00, 0x00, 0x00]);
  });

  it("encodes the spec ACK example", () => {
    expect(encodeAckFrame(2, MessageType.ReadRequest)).toEqual([
      0xf0, 0x7d, 0x10, 0x01, 0x00, 0x06, 0x00, 0x02,
      0x22, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf7
    ]);
  });

  it("encodes and decodes WRITE_BEGIN for a new user tuning", () => {
    const payload = encodeWriteBeginPayload({
      objectType: ObjectType.UserTuning,
      handle: NEW_OBJECT_HANDLE,
      transferId: 5,
      schemaMajor: 1,
      schemaMinor: 0,
      rawByteLength: 33,
      objectCrc32: 0x6702fe2b,
      rawChunkSize: 64,
      writeFlags: 0x02
    });
    expect(encodeDefaultPresetSyncFrame(MessageType.WriteBegin, 20, payload)).toEqual([
      0xf0, 0x7d, 0x10, 0x01, 0x00, 0x24, 0x00, 0x14,
      0x03, 0x7f, 0x7f, 0x00, 0x05, 0x01, 0x00, 0x00,
      0x00, 0x00, 0x21, 0x06, 0x38, 0x0b, 0x7c, 0x2b,
      0x00, 0x40, 0x02, 0xf7
    ]);
    expect(decodeWriteBeginPayload(payload)).toMatchObject({
      objectType: ObjectType.UserTuning,
      handle: NEW_OBJECT_HANDLE,
      transferId: 5,
      objectCrc32: 0x6702fe2b
    });
  });

  it("encodes and decodes a DATA_CHUNK frame", () => {
    const rawData = Uint8Array.from([0x48, 0x42, 0x53, 0x31]);
    const payload = encodeDataChunkPayload({
      transferId: 5,
      chunkIndex: 0,
      rawOffset: 0,
      rawData
    });
    expect(encodeDefaultPresetSyncFrame(MessageType.DataChunk, 0x13, payload)).toEqual([
      0xf0, 0x7d, 0x10, 0x01, 0x00, 0x25, 0x00, 0x13,
      0x00, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x04, 0x0e, 0x00, 0x48, 0x42, 0x53,
      0x31, 0xf7
    ]);
    expect(Array.from(decodeDataChunkPayload(payload).rawData)).toEqual(Array.from(rawData));
  });
});

