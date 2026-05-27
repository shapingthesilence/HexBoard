import { ObjectType, type ObjectTypeValue } from "../protocol/constants.ts";
import { encodeInt32LE } from "../protocol/numbers.ts";
import {
  bytesFromNumbers,
  concatBytes,
  createCommonRecords,
  encodeObjectBody,
  encodeObjectReference,
  tlv,
  tlvI16LE,
  tlvU8,
  tlvU16LE,
  tlvU32LE,
  type TlvRecord
} from "../protocol/tlv.ts";
import type { EncodedCatalogObject, LayoutsDatCatalog, ObjectReferenceInput } from "./types.ts";

export const TuningTlv = {
  TuningKind: 0x20,
  EdoDivisions: 0x21,
  PeriodMilliCents: 0x22,
  StepMilliCents: 0x23,
  ReferenceMidiNote: 0x24,
  ReferenceMilliHz: 0x25,
  CentsTable: 0x26,
  RatioTable: 0x27,
  KeyLabels: 0x28
} as const;

export const LayoutTlv = {
  LayoutKind: 0x20,
  TuningRef: 0x21,
  CenterButton: 0x22,
  AcrossSteps: 0x23,
  DownLeftSteps: 0x24,
  Portrait: 0x25,
  ExplicitButtonMapRef: 0x26
} as const;

export const ScaleColorMapTlv = {
  TuningRef: 0x20,
  CycleLength: 0x21,
  DefaultColorMode: 0x22,
  DegreeColors: 0x23
} as const;

export const ExplicitButtonMapTlv = {
  TuningRef: 0x20,
  LayoutRef: 0x21,
  MapRecordFormat: 0x22,
  ButtonRecords: 0x23
} as const;

export interface GeneratedEdoTuningInput {
  objectId: Uint8Array;
  name: string;
  edoDivisions: number;
  periodMilliCents?: number;
  referenceMidiNote?: number;
  referenceMilliHz?: number;
}

export interface VectorLayoutInput {
  objectId: Uint8Array;
  name: string;
  tuningRef: ObjectReferenceInput;
  centerButton: number;
  acrossSteps: number;
  downLeftSteps: number;
  portrait: boolean;
}

export interface ScaleDegreeColor {
  degree: number;
  hueTenthDegrees: number;
  saturation: number;
  value: number;
}

export interface ScaleColorMapInput {
  objectId: Uint8Array;
  name: string;
  tuningRef?: ObjectReferenceInput;
  cycleLength: number;
  defaultColorMode: number;
  degreeColors: ScaleDegreeColor[];
}

export interface ExplicitButtonRecord {
  buttonIndex: number;
  role: number;
  stepsFromC: number;
  midiNote: number;
  colorMode: number;
  hueTenthDegrees: number;
  saturation: number;
  value: number;
}

export interface ExplicitButtonMapInput {
  objectId: Uint8Array;
  name: string;
  tuningRef: ObjectReferenceInput;
  layoutRef?: ObjectReferenceInput;
  records: ExplicitButtonRecord[];
}

function buildCatalogObject(input: {
  objectType: ObjectTypeValue;
  objectId: Uint8Array;
  name: string;
  records: TlvRecord[];
  folderPath?: string;
}): EncodedCatalogObject {
  const allRecords = [
    ...createCommonRecords({
      objectId: input.objectId,
      name: input.name,
      source: "web-app",
      folderPath: input.folderPath
    }),
    ...input.records
  ];
  const body = encodeObjectBody({
    objectType: input.objectType,
    schemaMajor: 1,
    schemaMinor: 0,
    objectFlags: 0,
    records: allRecords
  });
  return {
    objectType: input.objectType,
    schemaMajor: 1,
    schemaMinor: 0,
    objectId: input.objectId,
    name: input.name,
    folderPath: input.folderPath,
    records: allRecords,
    body
  };
}

export function createGeneratedEdoTuning(input: GeneratedEdoTuningInput): EncodedCatalogObject {
  const periodMilliCents = input.periodMilliCents ?? 1_200_000;
  const stepMilliCents = Math.round(periodMilliCents / input.edoDivisions);

  return buildCatalogObject({
    objectType: ObjectType.UserTuning,
    objectId: input.objectId,
    name: input.name,
    records: [
      tlvU8(TuningTlv.TuningKind, 1),
      tlvU16LE(TuningTlv.EdoDivisions, input.edoDivisions),
      tlvU32LE(TuningTlv.PeriodMilliCents, periodMilliCents),
      tlvU32LE(TuningTlv.StepMilliCents, stepMilliCents),
      tlvU8(TuningTlv.ReferenceMidiNote, input.referenceMidiNote ?? 69),
      tlvU32LE(TuningTlv.ReferenceMilliHz, input.referenceMilliHz ?? 440_000)
    ]
  });
}

export function createVectorLayout(input: VectorLayoutInput): EncodedCatalogObject {
  return buildCatalogObject({
    objectType: ObjectType.UserLayout,
    objectId: input.objectId,
    name: input.name,
    records: [
      tlvU8(LayoutTlv.LayoutKind, 1),
      tlv(LayoutTlv.TuningRef, encodeObjectReference(input.tuningRef)),
      tlvU16LE(LayoutTlv.CenterButton, input.centerButton),
      tlvI16LE(LayoutTlv.AcrossSteps, input.acrossSteps),
      tlvI16LE(LayoutTlv.DownLeftSteps, input.downLeftSteps),
      tlvU8(LayoutTlv.Portrait, input.portrait ? 1 : 0)
    ]
  });
}

export function createScaleColorMap(input: ScaleColorMapInput): EncodedCatalogObject {
  const degreeColorBytes = input.degreeColors.map((color) =>
    bytesFromNumbers([
      color.degree & 0xff,
      (color.degree >> 8) & 0xff,
      color.hueTenthDegrees & 0xff,
      (color.hueTenthDegrees >> 8) & 0xff,
      color.saturation,
      color.value
    ])
  );
  const records: TlvRecord[] = [
    tlvU16LE(ScaleColorMapTlv.CycleLength, input.cycleLength),
    tlvU8(ScaleColorMapTlv.DefaultColorMode, input.defaultColorMode),
    tlv(ScaleColorMapTlv.DegreeColors, concatBytes(degreeColorBytes))
  ];
  if (input.tuningRef) {
    records.unshift(tlv(ScaleColorMapTlv.TuningRef, encodeObjectReference(input.tuningRef)));
  }

  return buildCatalogObject({
    objectType: ObjectType.ScaleColorMap,
    objectId: input.objectId,
    name: input.name,
    records
  });
}

export function createExplicitButtonMap(input: ExplicitButtonMapInput): EncodedCatalogObject {
  const mapRecords = input.records.map((record) =>
    bytesFromNumbers([
      record.buttonIndex & 0xff,
      (record.buttonIndex >> 8) & 0xff,
      record.role,
      ...encodeInt32LE(record.stepsFromC),
      record.midiNote,
      record.colorMode,
      record.hueTenthDegrees & 0xff,
      (record.hueTenthDegrees >> 8) & 0xff,
      record.saturation,
      record.value
    ])
  );
  const records: TlvRecord[] = [
    tlv(ExplicitButtonMapTlv.TuningRef, encodeObjectReference(input.tuningRef)),
    tlvU8(ExplicitButtonMapTlv.MapRecordFormat, 1),
    tlv(ExplicitButtonMapTlv.ButtonRecords, concatBytes(mapRecords))
  ];
  if (input.layoutRef) {
    records.splice(1, 0, tlv(ExplicitButtonMapTlv.LayoutRef, encodeObjectReference(input.layoutRef)));
  }

  return buildCatalogObject({
    objectType: ObjectType.ExplicitButtonMap,
    objectId: input.objectId,
    name: input.name,
    records
  });
}

export function createEmptyLayoutsDatCatalog(): LayoutsDatCatalog {
  return {
    tunings: [],
    layouts: [],
    scaleColorMaps: [],
    explicitButtonMaps: []
  };
}
