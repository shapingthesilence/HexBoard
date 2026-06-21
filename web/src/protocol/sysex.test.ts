import { describe, expect, it } from "vitest";
import { DelegatedEncoderEvent, NEW_OBJECT_HANDLE, MessageType, ObjectType } from "./constants.ts";
import {
  decodeDelegatedEncoderEventFrame,
  decodeDataChunkPayload,
  decodeHelloResponsePayload,
  decodePresetSyncFrame,
  decodeWriteBeginPayload,
  decodeWriteCommitPayload,
  encodeAckFrame,
  encodeDataChunkPayload,
  encodeDelegatedEnterFrame,
  encodeDelegatedExitFrame,
  encodeDelegatedNoteMapFrame,
  encodeDelegatedNoteMapPayload,
  encodeDelegatedNoteMapResetFrame,
  encodeDefaultPresetSyncFrame,
  encodeReadRequestPayload,
  encodeWriteBeginPayload,
  encodeWriteCommitPayload
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

  it("decodes the current firmware HELLO response", () => {
    const decoded = decodeHelloResponsePayload([
      0x01, 0x00,
      0x01, 0x00,
      0x00, 0x00, 0x3e, 0x7e,
      0x00, 0x04, 0x08, 0x00,
      0x13,
      0x07,
      0x09,
      0x00, 0x40,
      0x7f,
      0x7f,
      0x7f,
      0x7f,
      0x02
    ]);

    expect(decoded).toMatchObject({
      negotiatedMajor: 1,
      negotiatedMinor: 0,
      deviceMaxPackedChunk: 128,
      capabilityFlags: 0x1f7e,
      maxRawObjectBytes: 66560,
      settingsSchemaVersion: 19,
      synthPresetSchemaVersion: 7,
      profileCount: 9,
      synthPresetCount: 64,
      userTuningSlots: 127,
      userLayoutSlots: 127,
      scaleColorMapSlots: 127,
      explicitButtonMapSlots: 127,
      hardwareVersion: 2
    });
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

  it("encodes and decodes WRITE_COMMIT", () => {
    const payload = encodeWriteCommitPayload({
      transferId: 5,
      rawByteLength: 33,
      objectCrc32: 0x6702fe2b,
      commitFlags: 0x01
    });
    expect(payload).toEqual([0x00, 0x05, 0x00, 0x00, 0x00, 0x21, 0x06, 0x38, 0x0b, 0x7c, 0x2b, 0x01]);
    expect(decodeWriteCommitPayload(payload)).toEqual({
      transferId: 5,
      rawByteLength: 33,
      objectCrc32: 0x6702fe2b,
      commitFlags: 0x01
    });
  });
});

describe("delegated-control SysEx", () => {
  it("encodes enter, exit, and note-map reset frames", () => {
    expect(encodeDelegatedEnterFrame()).toEqual([0xf0, 0x7d, 0x01, 0xf7]);
    expect(encodeDelegatedEnterFrame("Looper")).toEqual([
      0xf0, 0x7d, 0x01, 0x4c, 0x6f, 0x6f, 0x70, 0x65, 0x72, 0xf7
    ]);
    expect(encodeDelegatedExitFrame()).toEqual([0xf0, 0x7d, 0x02, 0xf7]);
    expect(encodeDelegatedNoteMapResetFrame()).toEqual([0xf0, 0x7d, 0x05, 0xf7]);
  });

  it("encodes delegated note-map records", () => {
    expect(encodeDelegatedNoteMapPayload([
      { buttonIndex: 0, channel: 1, note: 60 },
      { buttonIndex: 120, channel: 16, note: 36 },
      { buttonIndex: 139, channel: 2, note: 127 }
    ])).toEqual([
      0x00, 0x00, 0x01, 0x3c,
      0x00, 0x78, 0x10, 0x24,
      0x01, 0x0b, 0x02, 0x7f
    ]);
  });

  it("encodes complete delegated note-map frames", () => {
    expect(encodeDelegatedNoteMapFrame([
      { buttonIndex: 64, channel: 3, note: 72 }
    ])).toEqual([0xf0, 0x7d, 0x04, 0x00, 0x40, 0x03, 0x48, 0xf7]);
  });

  it("rejects invalid delegated note-map values", () => {
    expect(() => encodeDelegatedNoteMapPayload([{ buttonIndex: 140, channel: 1, note: 60 }])).toThrow(RangeError);
    expect(() => encodeDelegatedNoteMapPayload([{ buttonIndex: 1, channel: 0, note: 60 }])).toThrow(RangeError);
    expect(() => encodeDelegatedNoteMapPayload([{ buttonIndex: 1, channel: 1, note: 128 }])).toThrow(RangeError);
  });

  it("rejects invalid delegated app names", () => {
    expect(() => encodeDelegatedEnterFrame("This name is too long")).toThrow(RangeError);
    expect(() => encodeDelegatedEnterFrame("Bad\nName")).toThrow(RangeError);
  });

  it("decodes delegated encoder event frames", () => {
    expect(decodeDelegatedEncoderEventFrame([0xf0, 0x7d, 0x06, 0x01, 0xf7])).toBe(DelegatedEncoderEvent.Up);
    expect(decodeDelegatedEncoderEventFrame([0xf0, 0x7d, 0x06, 0x04, 0xf7])).toBe(DelegatedEncoderEvent.ButtonRelease);
    expect(() => decodeDelegatedEncoderEventFrame([0xf0, 0x7d, 0x06, 0x7f, 0xf7])).toThrow(Error);
  });
});
