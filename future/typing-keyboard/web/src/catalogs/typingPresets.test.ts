import { describe, expect, it } from "vitest";
import { factoryTypingPresets, encodeTypingPreset, decodeTypingPreset, validateTypingPreset, typingKeyLabel } from "./typingPresets.ts";
import { decodeObjectBody, encodeObjectBody, tlv, ObjectType, MessageType, WriteFlag, decodePresetSyncFrame,
  decodeWriteBeginPayload, decodeDataChunkPayload, encodeAckFrame } from "../protocol/index.ts";
import { MockMidiTransport } from "../midi/mockTransport.ts";
import { PresetSyncClient } from "../midi/presetSyncClient.ts";

describe("typing presets", () => {
  it("fits portrait letters into consecutive physical rows, moving punctuation instead of letters", () => {
    const portraits = factoryTypingPresets.filter((p) => p.rotation === 0);
    expect(portraits).toHaveLength(3);
    expect(new Set(factoryTypingPresets.map((p) => p.objectId)).size).toBe(6);
    const expected = [
      ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM,./"],
      ["QWFPGJLUY", "ARSTDHNEIO", "ZXCVBKM,."],
      [",.PYFGCRL", "AOEUIDHTNS", "QJKXBMWVZ"]
    ];
    portraits.forEach((p, i) => {
      const firstRow = i === 0 ? 5 : 4;
      [firstRow, firstRow + 1, firstRow + 2].forEach((row, j) => {
        const start = row * 10 + (row % 2 ? 0 : 1);
        expect(p.keys.slice(start, row * 10 + 10).map((k) => typingKeyLabel(k.usage)).join("")).toBe(expected[i][j]);
      });
      for (let usage = 4; usage <= 29; usage++) expect(p.keys.filter((k) => k.usage === usage)).toHaveLength(1);
      for (const usage of [45, 46, 47, 48, 49, 51, 52, 53, 54, 55, 56]) expect(p.keys.some((k) => k.usage === usage)).toBe(true);
      for (let row = 0; row < 14; row++) expect(p.keys.slice(row * 10 + (row % 2 ? 0 : 1), row * 10 + 10).every((k) => k.usage !== 0)).toBe(true);
      expect([0, 20, 40, 60, 80, 100, 120].map((key) => p.keys[key])).toEqual([0, 20, 40, 60, 80, 100, 120].map((key) => factoryTypingPresets[i].keys[key]));
    });
  });
  it.each(factoryTypingPresets.map((preset) => [preset.name, preset] as const))("round trips %s without losing keys or colors", (_, preset) => {
    const encoded = encodeTypingPreset(preset);
    expect(encoded.length).toBeLessThan(1024);
    expect(decodeTypingPreset(encoded)).toEqual(preset);
    expect(new Set(preset.keys.filter((k) => k.usage >= 4 && k.usage <= 29).map((k) => k.usage)).size).toBe(26);
  });
  it("maps the US layouts to the expected letter and punctuation rows", () => {
    expect(factoryTypingPresets.slice(0, 3).map((p) => p.rotation)).toEqual([1, 1, 1]);
    const row = (p: number, y: number, start: number, end: number) => Array.from({ length: end - start }, (_, i) => typingKeyLabel(factoryTypingPresets[p].keys[(13 - i - start) * 10 + 1 + y].usage)).join("");
    expect(row(0, 2, 1, 11)).toBe("QWERTYUIOP");
    expect(row(1, 3, 1, 11)).toBe("ARSTDHNEIO");
    expect(row(2, 2, 1, 13)).toBe("',.PYFGCRL/=");
    expect(row(2, 1, 11, 13)).toBe("[]");
  });
  it("rejects malformed, out of range, duplicated, and unsupported fields", () => {
    const p = structuredClone(factoryTypingPresets[0]);
    for (const usage of [-1, 1, 3, 116, 223, 232, 256, 4.5]) {
      p.keys[0].usage = usage;
      expect(() => validateTypingPreset(p)).toThrow();
    }
    p.keys[0].usage = 4;
    p.keys[0].modifiers = 256;
    expect(() => validateTypingPreset(p)).toThrow();
    p.keys[0].modifiers = 1;
    p.keys[0].color = "#xyzxyz";
    expect(() => validateTypingPreset(p)).toThrow();
    const body = decodeObjectBody(encodeTypingPreset(factoryTypingPresets[0]));
    expect(() => decodeTypingPreset(encodeObjectBody({ ...body, schemaMinor: 1 }))).toThrow();
    expect(() => decodeTypingPreset(encodeObjectBody({ ...body, records: [...body.records, body.records[0]] }))).toThrow();
    expect(() => decodeTypingPreset(encodeObjectBody({ ...body, records: body.records.map((r) => r.tag === 0x20 ? tlv(0x20, new Uint8Array(279)) : r) }))).toThrow();
    const encoded = encodeTypingPreset(factoryTypingPresets[0]);
    expect(() => decodeTypingPreset(encoded.slice(0, -1))).toThrow();
    for (const animation of [4, 5, 9, -1, 11]) expect(() => validateTypingPreset({ ...factoryTypingPresets[0], animation })).toThrow();
    expect(() => validateTypingPreset({ ...factoryTypingPresets[0], objectId: "0".repeat(32) })).toThrow();
    for (const rotation of [-1, 4, 0.5, "1", null]) expect(() => validateTypingPreset({ ...factoryTypingPresets[0], rotation })).toThrow();
  });
  it("preserves intended rotation and accepts older records without rotation", () => {
    for (let rotation = 0; rotation < 4; rotation++) {
      expect(decodeTypingPreset(encodeTypingPreset({ ...factoryTypingPresets[0], rotation })).rotation).toBe(rotation);
    }
    const body = decodeObjectBody(encodeTypingPreset(factoryTypingPresets[0]));
    expect(decodeTypingPreset(encodeObjectBody({ ...body, records: body.records.filter((r) => r.tag !== 0x23) })).rotation).toBe(0);
  });
  it("preserves press modifiers and all 140 RGB values through acknowledged MIDI chunks", async () => {
    const transport = new MockMidiTransport();
    const send = transport.send.bind(transport);
    transport.send = async (bytes) => {
      await send(bytes);
      const frame = decodePresetSyncFrame(bytes);
      const next = frame.message === MessageType.DataChunk ? decodeDataChunkPayload(frame.payload).chunkIndex + 1 : 0;
      transport.emit(encodeAckFrame(frame.transactionId, frame.message, next));
    };
    const p = structuredClone(factoryTypingPresets[0]);
    p.keys[139] = { usage: 115, modifiers: 255, color: "#abcdef" };
    const body = encodeTypingPreset(p);
    const frames = await new PresetSyncClient(transport).sendObjectWriteConfirmed({ objectType: ObjectType.TypingPreset, body,
      writeFlags: WriteFlag.SaveToFlash | WriteFlag.ApplyToRuntime });
    const decoded = frames.map(decodePresetSyncFrame);
    expect(decodeWriteBeginPayload(decoded[0].payload)).toMatchObject({ objectType: 0x0e, writeFlags: 3, schemaMajor: 1, schemaMinor: 0 });
    const chunks = decoded.filter((f) => f.message === MessageType.DataChunk).map((f) => decodeDataChunkPayload(f.payload));
    expect(new Uint8Array(chunks.flatMap((c) => Array.from(c.rawData)))).toEqual(body);
    expect(decoded.at(-1)?.message).toBe(MessageType.WriteCommit);
  });
});
