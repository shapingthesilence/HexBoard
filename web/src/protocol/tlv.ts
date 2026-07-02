import { ObjectType, type ObjectTypeValue } from "./constants.ts";
import {
  assertByte,
  encodeInt16LE,
  encodeInt32LE,
  encodeU16LE,
  encodeU32LE
} from "./numbers.ts";

export const OBJECT_MAGIC = new Uint8Array([0x48, 0x42, 0x53, 0x31]);

export const CommonTlv = {
  Name: 0x01,
  ObjectId: 0x02,
  Source: 0x03,
  Comment: 0x04,
  Dependency: 0x05,
  FolderPath: 0x06,
  SortName: 0x07,
  Tags: 0x08
} as const;

export interface TlvRecord {
  tag: number;
  value: Uint8Array;
}

export interface ObjectBody {
  objectType: ObjectTypeValue;
  schemaMajor: number;
  schemaMinor: number;
  objectFlags: number;
  records: TlvRecord[];
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function bytesFromText(value: string): Uint8Array {
  return textEncoder.encode(value);
}

export function textFromBytes(value: Uint8Array): string {
  return textDecoder.decode(value);
}

export function bytesFromNumbers(values: number[]): Uint8Array {
  values.forEach((value, index) => assertByte(value, `byte[${index}]`));
  return new Uint8Array(values);
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

export function tlv(tag: number, value: Uint8Array): TlvRecord {
  assertByte(tag, "TLV tag");
  return { tag, value };
}

export function tlvText(tag: number, value: string): TlvRecord {
  return tlv(tag, bytesFromText(value));
}

export function tlvU8(tag: number, value: number): TlvRecord {
  assertByte(value, "u8 TLV value");
  return tlv(tag, new Uint8Array([value]));
}

export function tlvU16LE(tag: number, value: number): TlvRecord {
  return tlv(tag, bytesFromNumbers(encodeU16LE(value)));
}

export function tlvI16LE(tag: number, value: number): TlvRecord {
  return tlv(tag, bytesFromNumbers(encodeInt16LE(value)));
}

export function tlvU32LE(tag: number, value: number): TlvRecord {
  return tlv(tag, bytesFromNumbers(encodeU32LE(value)));
}

export function tlvI32LE(tag: number, value: number): TlvRecord {
  return tlv(tag, bytesFromNumbers(encodeInt32LE(value)));
}

export function encodeTlvRecord(record: TlvRecord): Uint8Array {
  if (record.value.length > 0xffff) {
    throw new RangeError("TLV value is too long");
  }
  return concatBytes([
    new Uint8Array([record.tag, record.value.length & 0xff, (record.value.length >> 8) & 0xff]),
    record.value
  ]);
}

export function decodeTlvRecords(bytes: Uint8Array, offset = 0): TlvRecord[] {
  const records: TlvRecord[] = [];
  let cursor = offset;

  while (cursor < bytes.length) {
    if (cursor + 3 > bytes.length) {
      throw new Error("truncated TLV header");
    }
    const tag = bytes[cursor];
    const length = bytes[cursor + 1] | (bytes[cursor + 2] << 8);
    cursor += 3;
    if (cursor + length > bytes.length) {
      throw new Error("truncated TLV value");
    }
    records.push({ tag, value: bytes.slice(cursor, cursor + length) });
    cursor += length;
  }

  return records;
}

export function encodeObjectBody(body: ObjectBody): Uint8Array {
  const header = new Uint8Array([
    ...OBJECT_MAGIC,
    body.objectType,
    body.schemaMajor,
    body.schemaMinor,
    body.objectFlags
  ]);
  return concatBytes([header, ...body.records.map(encodeTlvRecord)]);
}

export function decodeObjectBody(bytes: Uint8Array): ObjectBody {
  if (bytes.length < 8) {
    throw new Error("object body is too short");
  }
  for (let index = 0; index < OBJECT_MAGIC.length; index += 1) {
    if (bytes[index] !== OBJECT_MAGIC[index]) {
      throw new Error("object body magic mismatch");
    }
  }
  return {
    objectType: bytes[4] as ObjectTypeValue,
    schemaMajor: bytes[5],
    schemaMinor: bytes[6],
    objectFlags: bytes[7],
    records: decodeTlvRecords(bytes, 8)
  };
}

export interface ObjectReference {
  objectType: ObjectTypeValue;
  handle: number;
  objectId: Uint8Array;
}

export function encodeObjectReference(reference: ObjectReference): Uint8Array {
  if (reference.objectId.length !== 16) {
    throw new Error("object references require a 16-byte object id");
  }
  return concatBytes([
    new Uint8Array([reference.objectType, reference.handle & 0xff, (reference.handle >> 8) & 0xff]),
    reference.objectId
  ]);
}

export function createCommonRecords(input: {
  objectId: Uint8Array;
  name: string;
  source?: string;
  folderPath?: string;
  tags?: string[];
}): TlvRecord[] {
  const records = [
    tlvText(CommonTlv.Name, input.name),
    tlv(CommonTlv.ObjectId, input.objectId)
  ];
  if (input.source) {
    records.push(tlvText(CommonTlv.Source, input.source));
  }
  if (input.folderPath) {
    records.push(tlvText(CommonTlv.FolderPath, input.folderPath));
  }
  if (input.tags?.length) {
    records.push(tlvText(CommonTlv.Tags, input.tags.join(",")));
  }
  return records;
}

export function objectTypeName(objectType: ObjectTypeValue): string {
  const entry = Object.entries(ObjectType).find(([, value]) => value === objectType);
  return entry?.[0] ?? `Object ${objectType}`;
}

