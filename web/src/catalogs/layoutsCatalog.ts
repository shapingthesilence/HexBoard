import { ObjectType, type ObjectTypeValue } from "../protocol/constants.ts";
import { encodeFloat32LE, encodeInt16LE, encodeInt32LE } from "../protocol/numbers.ts";
import {
  bytesFromNumbers,
  concatBytes,
  createCommonRecords,
  encodeObjectBody,
  encodeObjectReference,
  tlv,
  tlvFloat32LE,
  tlvI16LE,
  tlvI32LE,
  tlvU8,
  tlvU16LE,
  type TlvRecord
} from "../protocol/tlv.ts";
import type { EncodedCatalogObject, LayoutsDatCatalog, ObjectReferenceInput } from "./types.ts";
import { deterministicObjectId, objectIdFromHex, objectIdToHex } from "./objectId.ts";
import { crc32 } from "../protocol/crc32.ts";

export const TuningBundleFileFormat = "hexboard.tuningBundle.v2";
export const LegacyTuningBundleFileFormat = "hexboard.tuningBundle.v1";
export const LegacyLayoutBundleFileFormat = "hexboard.layoutBundle.v5";
export const GeometryBundleFileVersion = 3;
export const GeometryObjectSchemaVersion = 2;
export const GenericScaleColorMapName = "Custom Palette";
export const GeometryMenuTextMaxLength = 19;
export const NoteLabelTextMaxLength = 7;
export const MaxTuningDivisions = 1024;
export const GeometryObjectMaxRawBytes = 16_384;
export const GeometryBundleMaxRawBytes = 262_144;
export const GeometryBundleMaxRecords = 255;
export const GeometryBundleMaxCount = 64;
export const GeometryLayoutScaleMaxCount = 32;

function requireTuningDivisionCount(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1 || value > MaxTuningDivisions) {
    throw new RangeError(`${label} must be from 1 through ${MaxTuningDivisions}`);
  }
}

export const ColorMode = {
  Rainbow: 0,
  Custom: 1,
  Alt: 2,
  Fifths: 3,
  Piano: 5,
  AltPiano: 4,
  Filament: 6,
  Diatonic: 7
} as const;

export type ColorModeValue = typeof ColorMode[keyof typeof ColorMode];

const VALUE_BLACK = 0;
const VALUE_SHADE = 164;
const VALUE_NORMAL = 180;
const SAT_BW = 0;
const SAT_TINT = 32;
const SAT_DULL = 85;
const SAT_VIVID = 255;
const HUE_ORANGE = 36;
const HUE_BLUE = 216;
const HUE_PURPLE = 288;
const FIFTH_CENTS = 1200 * Math.log2(3 / 2);

export const UserTuningKind = {
  Edo: 1,
  CentsList: 2,
  RatioList: 3,
  EqualStep: 4
} as const;

export const ButtonMapRole = {
  Unused: 0,
  Note: 1,
  Command: 2,
  Reserved: 3
} as const;

export type ButtonMapRoleName = "unused" | "note" | "command";

export const TuningTlv = {
  TuningKind: 0x20,
  EdoDivisions: 0x21,
  ReferenceDegree: 0x22,
  DefaultKeyDegree: 0x23,
  ReferenceMidiNote: 0x24,
  RatioTable: 0x27,
  KeyLabels: 0x28,
  PeriodCentsFloat32: 0x29,
  StepCentsFloat32: 0x2a,
  ReferenceHzFloat32: 0x2b,
  CentsTableFloat32: 0x2c
} as const;

export const LayoutTlv = {
  LayoutKind: 0x20,
  TuningRef: 0x21,
  CenterButton: 0x22,
  AcrossSteps: 0x23,
  DownLeftSteps: 0x24,
  ExplicitButtonMapRef: 0x26,
  DeviceRotation: 0x27,
  LayoutRotation: 0x28,
  MirrorFlags: 0x29,
  CenterStepsFromC: 0x2a
} as const;

export const ScaleColorMapTlv = {
  TuningRef: 0x20,
  CycleLength: 0x21,
  DefaultColorMode: 0x22,
  DegreeColors: 0x23
} as const;

export const UserScaleTlv = {
  TuningRef: 0x20,
  CycleLength: 0x21,
  RootDegree: 0x22,
  PatternSteps: 0x23,
  IncludedDegrees: 0x24
} as const;

export const ExplicitButtonMapTlv = {
  TuningRef: 0x20,
  LayoutRef: 0x21,
  MapRecordFormat: 0x22,
  ButtonRecords: 0x23,
  Actions: 0x24
} as const;

export const ButtonMapRecordFormat = {
  Fixed: 1,
  FieldMasked: 2
} as const;

export const ButtonMapField = {
  Role: 1 << 0,
  Pitch: 1 << 1,
  Color: 1 << 2,
  Action: 1 << 3
} as const;

export const ButtonOutputMode = {
  Tuned: 0,
  DirectMidi: 1,
  Chord: 2
} as const;

export const ButtonMapActionKind = {
  Chord: 1
} as const;

export const ChordPitchMode = {
  TuningSteps: 0,
  MidiSemitones: 1
} as const;

export interface GeneratedEdoTuningInput {
  objectId: Uint8Array;
  name: string;
  folderPath?: string;
  edoDivisions: number;
  periodCents?: number;
  referenceDegree?: number;
  defaultKeyDegree?: number;
  referenceMidiNote?: number;
  referenceHz?: number;
  keyLabels?: string[];
}

export interface EqualStepTuningInput {
  objectId: Uint8Array;
  name: string;
  folderPath?: string;
  stepCents?: number;
  cycleLength: number;
  referenceDegree?: number;
  defaultKeyDegree?: number;
  referenceMidiNote?: number;
  referenceHz?: number;
  keyLabels?: string[];
}

export interface CentsTableTuningInput {
  objectId: Uint8Array;
  name: string;
  folderPath?: string;
  cents: number[];
  referenceDegree?: number;
  defaultKeyDegree?: number;
  referenceMidiNote?: number;
  referenceHz?: number;
  keyLabels?: string[];
}

export interface VectorLayoutInput {
  objectId: Uint8Array;
  name: string;
  folderPath?: string;
  tuningRef: ObjectReferenceInput;
  centerButton: number;
  centerStepsFromC?: number;
  acrossSteps: number;
  upRightSteps: number;
  deviceRotationSteps: number;
  layoutRotationSteps?: number;
  mirrorLeftRight?: boolean;
  mirrorUpDown?: boolean;
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
  folderPath?: string;
  tuningRef?: ObjectReferenceInput;
  cycleLength: number;
  defaultColorMode: number;
  degreeColors: ScaleDegreeColor[];
}

export interface UserScaleInput {
  objectId: Uint8Array;
  name: string;
  folderPath?: string;
  tuningRef?: ObjectReferenceInput;
  cycleLength: number;
  rootDegree?: number;
  patternSteps?: number[];
  includedDegrees: number[];
}

export type TuningBundleButtonAction =
  | {
      kind: "direct-midi";
      midiNote: number;
      midiChannel: number;
    }
  | {
      kind: "chord";
      chordActionId: number;
      rootMidiNote?: number;
    };

export interface TuningBundleChordAction {
  id: number;
  name: string;
  pitchMode: "tuning-steps" | "midi-semitones";
  intervals: number[];
  midiChannel: number;
}

export interface ExplicitButtonRecord {
  buttonIndex: number;
  role: number;
  stepsFromC?: number;
  /** Format-1 field. Use `action` for direct MIDI output in new maps. */
  midiNote?: number;
  /** Format-1 field. Use `action` for direct MIDI output in new maps. */
  midiChannel?: number;
  /** Format-1 field. Presence of HSV fields controls color in format 2. */
  colorMode?: number;
  hueTenthDegrees?: number;
  saturation?: number;
  value?: number;
  action?: TuningBundleButtonAction;
}

export interface TuningBundleButtonOverride {
  buttonIndex: number;
  role: ButtonMapRoleName;
  hueTenthDegrees?: number;
  saturation?: number;
  value?: number;
  stepsFromC?: number;
  action?: TuningBundleButtonAction;
}

export interface TuningBundleGridOverride extends Omit<TuningBundleButtonOverride, "buttonIndex"> {
  coordCol: number;
  coordRow: number;
}

export interface TuningBundleLayout {
  objectIdHex: string;
  name: string;
  centerButton: number;
  centerStepsFromC: number;
  acrossSteps: number;
  upRightSteps: number;
  deviceRotationSteps: number;
  layoutRotationSteps: number;
  mirrorLeftRight: boolean;
  mirrorUpDown: boolean;
  buttonOverrides: TuningBundleButtonOverride[];
  offGridOverrides: TuningBundleGridOverride[];
  chordActions: TuningBundleChordAction[];
}

export interface TuningBundleScale {
  objectIdHex: string;
  name: string;
  includedDegrees: number[];
}

export interface TuningBundlePalette {
  defaultColorMode: ColorModeValue;
  degreeColors: ScaleDegreeColor[];
}

export type TuningBundleTuning =
  | {
      kind: "edo";
      name: string;
      edoDivisions: number;
      periodCents: number;
      cycleLength: number;
      referenceDegree: number;
      defaultKeyDegree: number;
      referenceMidiNote: number;
      referenceHz: number;
      keyLabels: string[];
    }
  | {
      kind: "equal-step";
      name: string;
      stepCents: number;
      cycleLength: number;
      referenceDegree: number;
      defaultKeyDegree: number;
      referenceMidiNote: number;
      referenceHz: number;
      keyLabels: string[];
    }
  | {
      kind: "scala";
      name: string;
      description: string;
      cents: number[];
      periodCents: number;
      cycleLength: number;
      referenceDegree: number;
      defaultKeyDegree: number;
      referenceMidiNote: number;
      referenceHz: number;
      keyLabels: string[];
    };

export interface TuningBundle {
  objectIdHex: string;
  tuningObjectIdHex?: string;
  colorObjectIdHex?: string;
  catalogOrder?: number;
  folderPath: string;
  tuning: TuningBundleTuning;
  palette: TuningBundlePalette;
  layouts: TuningBundleLayout[];
  activeLayoutIdHex: string;
  scales: TuningBundleScale[];
  activeScaleIdHex: string;
}

export interface EncodedTuningBundle {
  tuning: EncodedCatalogObject;
  layouts: EncodedCatalogObject[];
  scales: EncodedCatalogObject[];
  scaleColorMap: EncodedCatalogObject;
  explicitButtonMaps: EncodedCatalogObject[];
  objects: EncodedCatalogObject[];
  bundleFile: Uint8Array;
}

function u32LE(value: number): Uint8Array {
  return bytesFromNumbers([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]);
}

export function encodeGeometryBundleFile(objects: EncodedCatalogObject[], catalogOrder = 0xffff): Uint8Array {
  if (objects.length === 0
      || objects.length > GeometryBundleMaxRecords
      || objects[0].objectType !== ObjectType.UserTuning
      || objects.filter((object) => object.objectType === ObjectType.UserTuning).length !== 1) {
    throw new RangeError(`geometry bundle must contain one tuning root and at most ${GeometryBundleMaxRecords - 1} linked objects`);
  }
  const objectIds = new Set<string>();
  const encoder = new TextEncoder();
  const records = objects.map((object) => {
    const objectIdHex = objectIdToHex(object.objectId);
    if (objectIds.has(objectIdHex)) {
      throw new RangeError(`geometry bundle contains duplicate object id ${objectIdHex}`);
    }
    objectIds.add(objectIdHex);
    if (object.body.length > GeometryObjectMaxRawBytes) {
      throw new RangeError(`${object.name} exceeds the ${GeometryObjectMaxRawBytes}-byte geometry object limit`);
    }
    const name = encoder.encode(clampGeometryMenuText(object.name, "Geometry"));
    const folder = encoder.encode(clampGeometryFolderPath(object.folderPath ?? "/"));
    return concatBytes([
      bytesFromNumbers([object.objectType, object.schemaMajor, object.schemaMinor, 0]),
      object.objectId,
      bytesFromNumbers([name.length]), name,
      bytesFromNumbers([folder.length]), folder,
      u32LE(object.body.length), object.body
    ]);
  });
  const body = concatBytes(records);
  const normalizedCatalogOrder = Number.isInteger(catalogOrder) && catalogOrder >= 0 && catalogOrder <= 0xffff
    ? catalogOrder
    : 0xffff;
  const file = concatBytes([
    bytesFromNumbers([
      "H".charCodeAt(0),
      "G".charCodeAt(0),
      "B".charCodeAt(0),
      GeometryBundleFileVersion
    ]),
    bytesFromNumbers([
      objects.length & 0xff,
      (objects.length >> 8) & 0xff,
      normalizedCatalogOrder & 0xff,
      (normalizedCatalogOrder >> 8) & 0xff
    ]),
    u32LE(crc32(body)),
    body
  ]);
  if (file.length > GeometryBundleMaxRawBytes) {
    throw new RangeError(`geometry bundle exceeds the ${GeometryBundleMaxRawBytes}-byte file limit`);
  }
  return file;
}

export function encodeGeometryCatalogOrder(objectIds: Uint8Array[]): Uint8Array {
  if (objectIds.length > GeometryBundleMaxCount
      || objectIds.some((objectId) => objectId.length !== 16)) {
    throw new RangeError(`geometry order must contain at most ${GeometryBundleMaxCount} 16-byte object ids`);
  }
  const seen = new Set(objectIds.map(objectIdToHex));
  if (seen.size !== objectIds.length) {
    throw new RangeError("geometry order contains duplicate object ids");
  }
  const body = concatBytes(objectIds);
  return concatBytes([
    bytesFromNumbers(["H".charCodeAt(0), "G".charCodeAt(0), "O".charCodeAt(0), 1, objectIds.length, 0, 0, 0]),
    u32LE(crc32(body)),
    body
  ]);
}

export interface ResolvedTuningBundleColor {
  degree: number;
  color: ScaleDegreeColor;
  colorSource: "button" | "degree";
}

export interface ExplicitButtonMapInput {
  objectId: Uint8Array;
  name: string;
  folderPath?: string;
  tuningRef: ObjectReferenceInput;
  layoutRef?: ObjectReferenceInput;
  records: ExplicitButtonRecord[];
  actions?: TuningBundleChordAction[];
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
    schemaMajor: GeometryObjectSchemaVersion,
    schemaMinor: 0,
    objectFlags: 0,
    records: allRecords
  });
  return {
    objectType: input.objectType,
    schemaMajor: GeometryObjectSchemaVersion,
    schemaMinor: 0,
    objectId: input.objectId,
    name: input.name,
    folderPath: input.folderPath,
    records: allRecords,
    body
  };
}

export function createGeneratedEdoTuning(input: GeneratedEdoTuningInput): EncodedCatalogObject {
  requireTuningDivisionCount(input.edoDivisions, "EDO divisions");
  const periodCents = Math.fround(input.periodCents ?? 1200);
  const referenceHz = Math.fround(input.referenceHz ?? 440);

  return buildCatalogObject({
    objectType: ObjectType.UserTuning,
    objectId: input.objectId,
    name: input.name,
    folderPath: input.folderPath,
    records: [
      tlvU8(TuningTlv.TuningKind, UserTuningKind.Edo),
      tlvU16LE(TuningTlv.EdoDivisions, input.edoDivisions),
      tlvU16LE(TuningTlv.ReferenceDegree, clampInteger(input.referenceDegree ?? 0, 0, input.edoDivisions - 1)),
      tlvU16LE(TuningTlv.DefaultKeyDegree, clampInteger(input.defaultKeyDegree ?? 0, 0, input.edoDivisions - 1)),
      tlvU8(TuningTlv.ReferenceMidiNote, input.referenceMidiNote ?? 69),
      tlvFloat32LE(TuningTlv.PeriodCentsFloat32, periodCents),
      tlvFloat32LE(TuningTlv.ReferenceHzFloat32, referenceHz),
      ...optionalKeyLabelRecord(input.keyLabels, input.edoDivisions)
    ]
  });
}

export function createEqualStepTuning(input: EqualStepTuningInput): EncodedCatalogObject {
  requireTuningDivisionCount(input.cycleLength, "Equal-step cycle length");
  const stepCents = Math.fround(input.stepCents ?? 100);
  const referenceHz = Math.fround(input.referenceHz ?? 440);
  return buildCatalogObject({
    objectType: ObjectType.UserTuning,
    objectId: input.objectId,
    name: input.name,
    folderPath: input.folderPath,
    records: [
      tlvU8(TuningTlv.TuningKind, UserTuningKind.EqualStep),
      tlvU16LE(TuningTlv.EdoDivisions, input.cycleLength),
      tlvU16LE(TuningTlv.ReferenceDegree, clampInteger(input.referenceDegree ?? 0, 0, input.cycleLength - 1)),
      tlvU16LE(TuningTlv.DefaultKeyDegree, clampInteger(input.defaultKeyDegree ?? 0, 0, input.cycleLength - 1)),
      tlvU8(TuningTlv.ReferenceMidiNote, input.referenceMidiNote ?? 69),
      tlvFloat32LE(TuningTlv.StepCentsFloat32, stepCents),
      tlvFloat32LE(TuningTlv.ReferenceHzFloat32, referenceHz),
      ...optionalKeyLabelRecord(input.keyLabels, input.cycleLength)
    ]
  });
}

export function createCentsTableTuning(input: CentsTableTuningInput): EncodedCatalogObject {
  requireTuningDivisionCount(input.cents.length, "Cents-table cycle length");
  const floatTableBytes = input.cents.map((cents) => bytesFromNumbers(encodeFloat32LE(cents)));
  const referenceHz = Math.fround(input.referenceHz ?? 440);
  const cycleLength = Math.max(1, input.cents.length);

  return buildCatalogObject({
    objectType: ObjectType.UserTuning,
    objectId: input.objectId,
    name: input.name,
    folderPath: input.folderPath,
    records: [
      tlvU8(TuningTlv.TuningKind, UserTuningKind.CentsList),
      tlvU16LE(TuningTlv.EdoDivisions, input.cents.length),
      tlvU16LE(TuningTlv.ReferenceDegree, clampInteger(input.referenceDegree ?? 0, 0, cycleLength - 1)),
      tlvU16LE(TuningTlv.DefaultKeyDegree, clampInteger(input.defaultKeyDegree ?? 0, 0, cycleLength - 1)),
      tlvU8(TuningTlv.ReferenceMidiNote, input.referenceMidiNote ?? 69),
      tlvFloat32LE(TuningTlv.ReferenceHzFloat32, referenceHz),
      ...optionalKeyLabelRecord(input.keyLabels, cycleLength),
      tlv(TuningTlv.CentsTableFloat32, concatBytes(floatTableBytes))
    ]
  });
}

export function currentFirmwareDownLeftToUpRight(_acrossSteps: number, downLeftSteps: number): number {
  return -downLeftSteps;
}

export function upRightToCurrentFirmwareDownLeft(_acrossSteps: number, upRightSteps: number): number {
  return -upRightSteps;
}

export function createVectorLayout(input: VectorLayoutInput): EncodedCatalogObject {
  const downLeftSteps = upRightToCurrentFirmwareDownLeft(input.acrossSteps, input.upRightSteps);
  const deviceRotationSteps = clampInteger(input.deviceRotationSteps, 0, 3);
  const layoutRotationSteps = clampInteger(input.layoutRotationSteps ?? 0, 0, 5);
  const mirrorFlags = (input.mirrorLeftRight ? 1 : 0) | (input.mirrorUpDown ? 2 : 0);
  return buildCatalogObject({
    objectType: ObjectType.UserLayout,
    objectId: input.objectId,
    name: input.name,
    folderPath: input.folderPath,
    records: [
      tlvU8(LayoutTlv.LayoutKind, 1),
      tlv(LayoutTlv.TuningRef, encodeObjectReference(input.tuningRef)),
      tlvU16LE(LayoutTlv.CenterButton, input.centerButton),
      tlvI16LE(LayoutTlv.AcrossSteps, input.acrossSteps),
      tlvI16LE(LayoutTlv.DownLeftSteps, downLeftSteps),
      tlvU8(LayoutTlv.DeviceRotation, deviceRotationSteps),
      tlvU8(LayoutTlv.LayoutRotation, layoutRotationSteps),
      tlvU8(LayoutTlv.MirrorFlags, mirrorFlags),
      tlvI32LE(LayoutTlv.CenterStepsFromC, Math.round(input.centerStepsFromC ?? 0))
    ]
  });
}

export function createScaleColorMap(input: ScaleColorMapInput): EncodedCatalogObject {
  const defaults = createDefaultDegreeColors(input.cycleLength);
  const degreeColorBytes = input.degreeColors.filter((color) => {
    const fallback = defaults[color.degree];
    return !fallback
      || color.hueTenthDegrees !== fallback.hueTenthDegrees
      || color.saturation !== fallback.saturation
      || color.value !== fallback.value;
  }).map((color) =>
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
    folderPath: input.folderPath,
    records
  });
}

export function createUserScale(input: UserScaleInput): EncodedCatalogObject {
  const patternBytes = (input.patternSteps ?? []).map((step) => bytesFromNumbers([clampInteger(step, 0, 255)]));
  const includedDegreeBytes = input.includedDegrees.map((degree) =>
    bytesFromNumbers([
      degree & 0xff,
      (degree >> 8) & 0xff
    ])
  );
  const records: TlvRecord[] = [
    tlvU16LE(UserScaleTlv.CycleLength, input.cycleLength),
    tlvU16LE(UserScaleTlv.RootDegree, input.rootDegree ?? 0),
    tlv(UserScaleTlv.PatternSteps, concatBytes(patternBytes)),
    tlv(UserScaleTlv.IncludedDegrees, concatBytes(includedDegreeBytes))
  ];
  if (input.tuningRef) {
    records.unshift(tlv(UserScaleTlv.TuningRef, encodeObjectReference(input.tuningRef)));
  }

  return buildCatalogObject({
    objectType: ObjectType.UserScale,
    objectId: input.objectId,
    name: input.name,
    folderPath: input.folderPath,
    records
  });
}

function encodeFieldMaskedOverrideRecord(record: ExplicitButtonRecord, coordinatePrefix: number[]): Uint8Array {
  const hasColor = record.hueTenthDegrees !== undefined
    && record.saturation !== undefined
    && record.value !== undefined;
  const fieldMask = (record.role !== ButtonMapRole.Note ? ButtonMapField.Role : 0)
    | (record.stepsFromC !== undefined ? ButtonMapField.Pitch : 0)
    | (hasColor ? ButtonMapField.Color : 0)
    | (record.action ? ButtonMapField.Action : 0);
  const outputMode = record.action?.kind === "direct-midi"
    ? ButtonOutputMode.DirectMidi
    : record.action?.kind === "chord"
      ? ButtonOutputMode.Chord
      : ButtonOutputMode.Tuned;
  const midiNote = record.action?.kind === "direct-midi"
    ? record.action.midiNote
    : record.action?.kind === "chord"
      ? record.action.rootMidiNote ?? 60
      : 60;
  const midiChannel = record.action?.kind === "direct-midi" ? record.action.midiChannel : 0;
  const actionId = record.action?.kind === "chord" ? record.action.chordActionId : 0;
  const payload = [
    ...coordinatePrefix,
    fieldMask & 0xff,
    (fieldMask >> 8) & 0xff,
    record.role,
    ...encodeInt32LE(record.stepsFromC ?? 0),
    outputMode,
    clampInteger(midiNote, 0, 127),
    clampInteger(midiChannel, 0, 16),
    clampInteger(actionId, 0, 255),
    (record.hueTenthDegrees ?? 0) & 0xff,
    ((record.hueTenthDegrees ?? 0) >> 8) & 0xff,
    record.saturation ?? 0,
    record.value ?? 0
  ];
  return bytesFromNumbers([payload.length & 0xff, (payload.length >> 8) & 0xff, ...payload]);
}

export function createExplicitButtonMap(input: ExplicitButtonMapInput): EncodedCatalogObject {
  const mapRecords = input.records.map((record) => encodeFieldMaskedOverrideRecord(record, [
    record.buttonIndex & 0xff,
    (record.buttonIndex >> 8) & 0xff
  ]));
  const encoder = new TextEncoder();
  const actionRecords = (input.actions ?? []).map((action) => {
    const intervals = action.intervals.slice(0, 4).map((interval) => clampInteger(interval, -32768, 32767));
    const nameBytes = [...encoder.encode(clampGeometryMenuText(action.name, `Chord ${action.id}`))].slice(0, GeometryMenuTextMaxLength);
    const payload = [
      clampInteger(action.id, 1, 255),
      ButtonMapActionKind.Chord,
      action.pitchMode === "midi-semitones" ? ChordPitchMode.MidiSemitones : ChordPitchMode.TuningSteps,
      clampInteger(action.midiChannel, 0, 16),
      intervals.length,
      nameBytes.length,
      ...intervals.flatMap((interval) => encodeInt16LE(interval)),
      ...nameBytes
    ];
    return bytesFromNumbers([payload.length & 0xff, (payload.length >> 8) & 0xff, ...payload]);
  });
  const records: TlvRecord[] = [
    tlv(ExplicitButtonMapTlv.TuningRef, encodeObjectReference(input.tuningRef)),
    tlvU8(ExplicitButtonMapTlv.MapRecordFormat, ButtonMapRecordFormat.FieldMasked),
    tlv(ExplicitButtonMapTlv.ButtonRecords, concatBytes(mapRecords))
  ];
  if (actionRecords.length > 0) {
    records.push(tlv(ExplicitButtonMapTlv.Actions, concatBytes(actionRecords)));
  }
  if (input.layoutRef) {
    records.splice(1, 0, tlv(ExplicitButtonMapTlv.LayoutRef, encodeObjectReference(input.layoutRef)));
  }

  return buildCatalogObject({
    objectType: ObjectType.ExplicitButtonMap,
    objectId: input.objectId,
    name: input.name,
    folderPath: input.folderPath,
    records
  });
}

export function createEmptyLayoutsDatCatalog(): LayoutsDatCatalog {
  return {
    tunings: [],
    layouts: [],
    scales: [],
    scaleColorMaps: [],
    explicitButtonMaps: []
  };
}

function roleNameToByte(role: ButtonMapRoleName): number {
  switch (role) {
    case "note":
      return ButtonMapRole.Note;
    case "command":
      return ButtonMapRole.Command;
    case "unused":
      return ButtonMapRole.Unused;
  }
}

export function midiNoteToFrequency(midiNote: number): number {
  const safeMidiNote = clampInteger(midiNote, 0, 127);
  return 440 * (2 ** ((safeMidiNote - 69) / 12));
}

export function defaultKeyLabels(cycleLength: number): string[] {
  const safeCycleLength = Math.max(1, Math.round(cycleLength));
  return Array.from({ length: safeCycleLength }, (_, degree) => String(degree));
}

export function normalizeKeyLabels(labels: string[] | undefined, cycleLength: number): string[] {
  const defaults = defaultKeyLabels(cycleLength);
  return defaults.map((fallback, index) => {
    const label = labels?.[index]?.trim();
    return clampNoteLabelText(label || fallback, fallback);
  });
}

export function keyLabelsFromScalaIntervalLabels(cycleLength: number, intervalLabels: Array<string | undefined>, referenceDegree = 0): string[] {
  const safeCycleLength = Math.max(1, Math.round(cycleLength));
  const defaults = defaultKeyLabels(safeCycleLength);
  if (!intervalLabels.some((label) => label?.trim())) {
    return defaults;
  }

  const labels = [...defaults];
  const safeReferenceDegree = clampInteger(referenceDegree, 0, safeCycleLength - 1);
  const rootLabel = intervalLabels[safeCycleLength - 1]?.trim() || "1/1";
  for (let degree = 0; degree < safeCycleLength; degree += 1) {
    const sourceLabel = degree === 0 ? rootLabel : intervalLabels[degree - 1]?.trim();
    if (!sourceLabel) {
      continue;
    }
    const labelIndex = positiveModulo(safeReferenceDegree + degree, safeCycleLength);
    labels[labelIndex] = clampNoteLabelText(sourceLabel, defaults[labelIndex]);
  }
  return normalizeKeyLabels(labels, safeCycleLength);
}

function encodeKeyLabels(labels: string[]): Uint8Array {
  const encoder = new TextEncoder();
  const labelBytes = labels.map((label) => {
    const bytes = encoder.encode(clampNoteLabelText(label, "0"));
    return bytesFromNumbers([Math.min(bytes.length, 255), ...bytes.slice(0, 255)]);
  });
  return concatBytes(labelBytes);
}

function optionalKeyLabelRecord(labels: string[] | undefined, cycleLength: number): TlvRecord[] {
  const defaults = defaultKeyLabels(cycleLength);
  const normalized = normalizeKeyLabels(labels, cycleLength);
  if (normalized.every((label, index) => label === defaults[index])) {
    return [];
  }
  return [tlv(TuningTlv.KeyLabels, encodeKeyLabels(normalized))];
}

function equalStepPeriodCents(tuning: Extract<TuningBundleTuning, { kind: "equal-step" }>): number {
  return tuning.stepCents * tuning.cycleLength;
}

function bundleObjectId(bundle: TuningBundle, suffix: string): Uint8Array {
  return deterministicObjectId(`${bundle.objectIdHex}:${suffix}`);
}

function tuningReference(tuning: EncodedCatalogObject): ObjectReferenceInput {
  return {
    objectType: ObjectType.UserTuning,
    handle: 0,
    objectId: tuning.objectId
  };
}

function layoutReference(layout: EncodedCatalogObject): ObjectReferenceInput {
  return {
    objectType: ObjectType.UserLayout,
    handle: 0,
    objectId: layout.objectId
  };
}

export function createDefaultDegreeColors(cycleLength: number): ScaleDegreeColor[] {
  return Array.from({ length: Math.max(1, Math.round(cycleLength)) }, (_, degree) => ({
    degree,
    hueTenthDegrees: Math.round((degree * 3600) / Math.max(1, Math.round(cycleLength))) % 3600,
    saturation: degree === 0 ? 0 : 210,
    value: degree === 0 ? 210 : 190
  }));
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}

function positiveModulo(value: number, modulus: number): number {
  const safeModulus = Math.max(1, Math.round(modulus));
  return ((Math.round(value) % safeModulus) + safeModulus) % safeModulus;
}

export function clampScaleDegreeColor(color: ScaleDegreeColor): ScaleDegreeColor {
  return {
    degree: Math.max(0, Math.round(color.degree)),
    hueTenthDegrees: positiveModulo(color.hueTenthDegrees, 3600),
    saturation: clampInteger(color.saturation, 0, 255),
    value: clampInteger(color.value, 0, 255)
  };
}

export function normalizeScaleDegreeColors(colors: ScaleDegreeColor[], cycleLength: number): ScaleDegreeColor[] {
  const defaults = createDefaultDegreeColors(cycleLength);
  return defaults.map((fallback) => clampScaleDegreeColor(colors.find((color) => color.degree === fallback.degree) ?? fallback));
}

export function normalizeScaleDegrees(degrees: number[], cycleLength: number): number[] {
  const normalized = new Set<number>();
  degrees.forEach((degree) => normalized.add(positiveModulo(degree, cycleLength)));
  return [...normalized].sort((left, right) => left - right);
}

export function createAllNotesScale(cycleLength: number): TuningBundleScale {
  const safeCycleLength = Math.max(1, Math.round(cycleLength));
  return {
    objectIdHex: objectIdToHex(deterministicObjectId(`scale:all-notes:${safeCycleLength}`)),
    name: "All Notes",
    includedDegrees: Array.from({ length: safeCycleLength }, (_, degree) => degree)
  };
}

export function createDefaultLayout(cycleLength: number): TuningBundleLayout {
  return {
    objectIdHex: objectIdToHex(deterministicObjectId(`layout:default:${cycleLength}`)),
    name: `${cycleLength} EDO Wicki`,
    centerButton: 65,
    centerStepsFromC: 0,
    acrossSteps: 3,
    upRightSteps: currentFirmwareDownLeftToUpRight(3, -11),
    deviceRotationSteps: 0,
    layoutRotationSteps: 0,
    mirrorLeftRight: false,
    mirrorUpDown: false,
    buttonOverrides: [],
    offGridOverrides: [],
    chordActions: []
  };
}

function colorFromHsv(degree: number, hueDegrees: number, saturation: number, value: number): ScaleDegreeColor {
  return clampScaleDegreeColor({
    degree,
    hueTenthDegrees: Math.round(hueDegrees * 10),
    saturation,
    value
  });
}

function fullBrightnessPreviewColor(color: ScaleDegreeColor): ScaleDegreeColor {
  return color.value === VALUE_BLACK ? color : { ...color, value: 255 };
}

function stepCentsForPreview(cycleLength: number, periodCents: number | undefined): number {
  return numberOr(periodCents, 1200) / Math.max(1, Math.round(cycleLength));
}

function roundedKeyDegree(stepsFromC: number, cycleLength: number, periodCents: number | undefined): number {
  const stepCents = stepCentsForPreview(cycleLength, periodCents);
  const octaveSteps = 1200 / stepCents;
  const semipaletteIndex = positiveModulo(stepsFromC, octaveSteps);
  return (12 / octaveSteps) * semipaletteIndex;
}

function isPianoBlackKey(keyDegree: number): boolean {
  switch (positiveModulo(Math.round(keyDegree), 12)) {
    case 1:
    case 3:
    case 6:
    case 8:
    case 10:
      return true;
    default:
      return false;
  }
}

function alternateColor(degree: number, stepCents: number): ScaleDegreeColor {
  const cents = stepCents * degree;
  let perfect = false;
  let center = 0;
  if (cents < 50) { perfect = true; center = 0; }
  else if (cents < 250) { center = 147.1; }
  else if (cents < 450) { center = 351; }
  else if (cents < 600) { perfect = true; center = 498; }
  else if (cents <= 750) { perfect = true; center = 702; }
  else if (cents <= 950) { center = 849; }
  else if (cents <= 1150) { center = 1053; }
  else if (cents < 1250) { perfect = true; center = 1200; }
  else if (cents < 1450) { center = 1347.1; }
  else if (cents < 1650) { center = 1551; }
  else if (cents < 1850) { perfect = true; center = 1698; }
  else if (cents <= 1950) { perfect = true; center = 1902; }
  const offCenter = cents - center;
  const hue = positiveModulo(150 + (perfect ? (offCenter > 0 ? -72 : 72) : 0) - Math.round(1.44 * offCenter), 360);
  const deSaturate = perfect && Math.abs(offCenter) < 20 ? 1 - (0.02 * Math.abs(offCenter)) : 0;
  return colorFromHsv(degree, hue, 255 - Math.round(255 * deSaturate), cents ? VALUE_SHADE : VALUE_NORMAL);
}

function diatonicColor(degree: number, cycleLength: number, stepCents: number): ScaleDegreeColor | undefined {
  const fifthSteps = Math.round(FIFTH_CENTS / stepCents);
  const largeStep = positiveModulo(2 * fifthSteps, cycleLength);
  const smallRemainder = cycleLength - 5 * largeStep;
  if (smallRemainder < 0 || smallRemainder % 2 !== 0) {
    return undefined;
  }
  const smallStep = smallRemainder / 2;
  if (largeStep <= 0 || smallStep <= 0 || largeStep === smallStep) {
    return undefined;
  }

  const intervals = [largeStep, largeStep, smallStep, largeStep, largeStep, largeStep, smallStep];
  const diatonic = [0];
  for (let index = 1; index < 7; index += 1) {
    diatonic[index] = diatonic[index - 1] + intervals[index - 1];
  }

  let lowerIndex = 0;
  for (let index = 6; index >= 0; index -= 1) {
    if (diatonic[index] <= degree) {
      lowerIndex = index;
      break;
    }
  }
  const upperIndex = (lowerIndex + 1) % 7;
  const lowerPosition = diatonic[lowerIndex];
  const upperPosition = upperIndex === 0 ? cycleLength : diatonic[upperIndex];
  const offsetFromLower = degree - lowerPosition;
  const offsetFromUpper = upperPosition - degree;
  if (offsetFromLower === 0) {
    return colorFromHsv(degree, 0, SAT_BW, VALUE_NORMAL);
  }
  if (offsetFromLower === offsetFromUpper) {
    return colorFromHsv(degree, HUE_PURPLE, SAT_DULL, VALUE_NORMAL);
  }
  if (offsetFromLower < offsetFromUpper) {
    const layer = offsetFromLower;
    return colorFromHsv(degree, HUE_ORANGE - ((layer - 1) * 36), SAT_VIVID, Math.max(VALUE_SHADE, VALUE_NORMAL - ((layer - 1) * 16)));
  }
  const layer = offsetFromUpper;
  return colorFromHsv(degree, HUE_BLUE + ((layer - 1) * 36), SAT_VIVID, Math.max(VALUE_SHADE, VALUE_NORMAL - ((layer - 1) * 16)));
}

function colorForDefaultMode(input: {
  colorMode: number | undefined;
  customColor: ScaleDegreeColor;
  cycleLength: number;
  degree: number;
  periodCents: number | undefined;
  stepsFromC: number;
}): ScaleDegreeColor {
  const mode = input.colorMode ?? ColorMode.Custom;
  const stepCents = stepCentsForPreview(input.cycleLength, input.periodCents);
  switch (mode) {
    case ColorMode.Custom:
      return input.customColor;
    case ColorMode.Alt:
      return fullBrightnessPreviewColor(alternateColor(input.degree, stepCents));
    case ColorMode.Fifths: {
      const fifthSteps = Math.max(1, Math.round(FIFTH_CENTS / stepCents));
      return fullBrightnessPreviewColor(colorFromHsv(
        input.degree,
        360 * (positiveModulo(input.degree * fifthSteps, input.cycleLength) / input.cycleLength),
        SAT_VIVID,
        VALUE_NORMAL
      ));
    }
    case ColorMode.Piano: {
      const keyDegree = roundedKeyDegree(input.stepsFromC, input.cycleLength, input.periodCents);
      return fullBrightnessPreviewColor(colorFromHsv(
        input.degree,
        360 * (positiveModulo(Math.round(keyDegree), 12) / 12),
        SAT_TINT,
        isPianoBlackKey(keyDegree) ? VALUE_BLACK : VALUE_NORMAL
      ));
    }
    case ColorMode.AltPiano: {
      const keyDegree = roundedKeyDegree(input.stepsFromC, input.cycleLength, input.periodCents);
      const rounded = Math.round(keyDegree);
      const deviation = (rounded - keyDegree) * 180;
      return fullBrightnessPreviewColor(colorFromHsv(
        input.degree,
        (isPianoBlackKey(keyDegree) ? 210 : 30) + deviation,
        SAT_VIVID,
        VALUE_NORMAL
      ));
    }
    case ColorMode.Filament: {
      const keyDegree = roundedKeyDegree(input.stepsFromC, input.cycleLength, input.periodCents);
      const deviation = Math.abs(Math.round(keyDegree) - keyDegree);
      const heat = isPianoBlackKey(keyDegree) ? deviation : 1 - deviation;
      return fullBrightnessPreviewColor(colorFromHsv(
        input.degree,
        24 + (heat * 18),
        210 - Math.round(heat * 80),
        105 + Math.round(heat * 75)
      ));
    }
    case ColorMode.Diatonic:
      return fullBrightnessPreviewColor(diatonicColor(input.degree, input.cycleLength, stepCents)
        ?? colorFromHsv(input.degree, 360 * (input.degree / input.cycleLength), SAT_VIVID, VALUE_NORMAL));
    case ColorMode.Rainbow:
    default:
      return fullBrightnessPreviewColor(colorFromHsv(input.degree, 360 * (input.degree / input.cycleLength), SAT_VIVID, VALUE_NORMAL));
  }
}

export function resolveTuningBundleButtonColor(input: {
  degreeColors: ScaleDegreeColor[];
  cycleLength: number;
  stepsFromC: number;
  keyDegree?: number;
  defaultColorMode?: number;
  periodCents?: number;
  override?: TuningBundleButtonOverride;
}): ResolvedTuningBundleColor {
  const colorStepsFromKey = input.stepsFromC - (input.keyDegree ?? 0);
  const degree = positiveModulo(colorStepsFromKey, input.cycleLength);
  const mode = input.defaultColorMode ?? ColorMode.Custom;
  if (
    mode === ColorMode.Custom &&
    input.override?.hueTenthDegrees !== undefined &&
    input.override.saturation !== undefined &&
    input.override.value !== undefined
  ) {
    return {
      degree,
      color: clampScaleDegreeColor({
        degree,
        hueTenthDegrees: input.override.hueTenthDegrees,
        saturation: input.override.saturation,
        value: input.override.value
      }),
      colorSource: "button"
    };
  }
  const degreeColors = normalizeScaleDegreeColors(input.degreeColors, input.cycleLength);
  const degreeColor = degreeColors.find((color) => color.degree === degree) ?? degreeColors[0];
  return {
    degree,
    color: colorForDefaultMode({
      colorMode: mode,
      customColor: degreeColor,
      cycleLength: input.cycleLength,
      degree,
      periodCents: input.periodCents,
      stepsFromC: colorStepsFromKey
    }),
    colorSource: "degree"
  };
}

export function createDefaultTuningBundle(): TuningBundle {
  const objectId = deterministicObjectId("layout-bundle:19 EDO Wicki");
  const layout = createDefaultLayout(19);
  const scale = createAllNotesScale(19);
  return {
    objectIdHex: objectIdToHex(objectId),
    folderPath: "/",
    tuning: {
      kind: "edo",
      name: "19 EDO Wicki",
      edoDivisions: 19,
      periodCents: 1200,
      cycleLength: 19,
      referenceDegree: 14,
      defaultKeyDegree: 0,
      referenceMidiNote: 69,
      referenceHz: 440,
      keyLabels: defaultKeyLabels(19)
    },
    palette: {
      defaultColorMode: ColorMode.Custom,
      degreeColors: createDefaultDegreeColors(19)
    },
    layouts: [layout],
    activeLayoutIdHex: layout.objectIdHex,
    scales: [scale],
    activeScaleIdHex: scale.objectIdHex
  };
}

export function encodeTuningBundle(bundle: TuningBundle): EncodedTuningBundle {
  if (bundle.layouts.length < 1 || bundle.layouts.length > GeometryLayoutScaleMaxCount) {
    throw new RangeError(`tuning bundle must contain 1 through ${GeometryLayoutScaleMaxCount} layouts`);
  }
  if (bundle.scales.length < 1 || bundle.scales.length > GeometryLayoutScaleMaxCount) {
    throw new RangeError(`tuning bundle must contain 1 through ${GeometryLayoutScaleMaxCount} scales`);
  }
  const tuningId = bundle.tuningObjectIdHex
    ? objectIdFromHex(bundle.tuningObjectIdHex)
    : bundleObjectId(bundle, "tuning");
  const colorId = bundle.colorObjectIdHex
    ? objectIdFromHex(bundle.colorObjectIdHex)
    : bundleObjectId(bundle, "colors");
  const tuningName = clampGeometryMenuText(bundle.tuning.name, "User Tuning");
  const folderPath = clampGeometryFolderPath(bundle.folderPath);
  const tuning = (() => {
    switch (bundle.tuning.kind) {
      case "edo":
        return createGeneratedEdoTuning({
          objectId: tuningId,
          name: tuningName,
          folderPath,
          edoDivisions: bundle.tuning.edoDivisions,
          periodCents: bundle.tuning.periodCents,
          referenceDegree: bundle.tuning.referenceDegree,
          defaultKeyDegree: bundle.tuning.defaultKeyDegree,
          referenceMidiNote: bundle.tuning.referenceMidiNote,
          referenceHz: bundle.tuning.referenceHz,
          keyLabels: bundle.tuning.keyLabels
        });
      case "equal-step":
        return createEqualStepTuning({
          objectId: tuningId,
          name: tuningName,
          folderPath,
          stepCents: bundle.tuning.stepCents,
          cycleLength: bundle.tuning.cycleLength,
          referenceDegree: bundle.tuning.referenceDegree,
          defaultKeyDegree: bundle.tuning.defaultKeyDegree,
          referenceMidiNote: bundle.tuning.referenceMidiNote,
          referenceHz: bundle.tuning.referenceHz,
          keyLabels: bundle.tuning.keyLabels
        });
      case "scala":
        return createCentsTableTuning({
          objectId: tuningId,
          name: tuningName,
          folderPath,
          cents: bundle.tuning.cents,
          referenceDegree: bundle.tuning.referenceDegree,
          defaultKeyDegree: bundle.tuning.defaultKeyDegree,
          referenceMidiNote: bundle.tuning.referenceMidiNote,
          referenceHz: bundle.tuning.referenceHz,
          keyLabels: bundle.tuning.keyLabels
        });
    }
  })();

  const orderedLayouts = bundle.layouts;
  const layouts = orderedLayouts.map((layout) => createVectorLayout({
    objectId: objectIdFromHex(layout.objectIdHex),
    name: clampGeometryMenuText(layout.name || `${tuningName} Layout`, "User Layout"),
    folderPath,
    tuningRef: tuningReference(tuning),
    centerButton: layout.centerButton,
    centerStepsFromC: layout.centerStepsFromC,
    acrossSteps: layout.acrossSteps,
    upRightSteps: layout.upRightSteps,
    deviceRotationSteps: layout.deviceRotationSteps,
    layoutRotationSteps: layout.layoutRotationSteps,
    mirrorLeftRight: layout.mirrorLeftRight,
    mirrorUpDown: layout.mirrorUpDown
  }));
  const scaleColorMap = createScaleColorMap({
    objectId: colorId,
    name: clampGeometryMenuText(GenericScaleColorMapName, "Palette"),
    folderPath,
    tuningRef: tuningReference(tuning),
    cycleLength: bundle.tuning.cycleLength,
    defaultColorMode: bundle.palette.defaultColorMode,
    degreeColors: bundle.palette.degreeColors
  });
  const orderedScales = bundle.scales;
  const scales = orderedScales.map((scale) => createUserScale({
    objectId: objectIdFromHex(scale.objectIdHex),
    name: clampGeometryMenuText(scale.name || `${tuningName} Scale`, "User Scale"),
    folderPath,
    tuningRef: tuningReference(tuning),
    cycleLength: bundle.tuning.cycleLength,
    includedDegrees: normalizeScaleDegrees(scale.includedDegrees, bundle.tuning.cycleLength)
  }));
  const explicitButtonMaps = orderedLayouts.flatMap((layout, layoutIndex) => {
    const explicitRecords = layout.buttonOverrides.map((override) => ({
      buttonIndex: override.buttonIndex,
      role: roleNameToByte(override.role),
      stepsFromC: override.stepsFromC,
      hueTenthDegrees: override.hueTenthDegrees,
      saturation: override.saturation,
      value: override.value,
      action: override.action
    }));
    if (explicitRecords.length === 0) {
      return [];
    }
    return [createExplicitButtonMap({
      objectId: deterministicObjectId(`${bundle.objectIdHex}:button-map:${layout.objectIdHex}`),
      name: clampGeometryMenuText(`${layout.name || tuningName} Button Map`, "Button Map"),
      folderPath,
      tuningRef: tuningReference(tuning),
      layoutRef: layoutReference(layouts[layoutIndex]),
      records: explicitRecords,
      actions: layout.chordActions
    })];
  });
  const objects = [
    tuning,
    ...layouts,
    ...scales,
    scaleColorMap,
    ...explicitButtonMaps
  ];

  return {
    tuning,
    layouts,
    scales,
    scaleColorMap,
    explicitButtonMaps,
    objects,
    bundleFile: encodeGeometryBundleFile(objects, bundle.catalogOrder)
  };
}

export function serializeTuningBundle(bundle: TuningBundle): string {
  return JSON.stringify({ format: TuningBundleFileFormat, tuningBundle: bundle }, null, 2);
}

export function parseTuningBundleFile(value: unknown): TuningBundle {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Tuning bundle file must contain an object");
  }
  const record = value as Record<string, unknown>;
  if (record.format === TuningBundleFileFormat && typeof record.tuningBundle === "object" && record.tuningBundle !== null) {
    return normalizeTuningBundle(record.tuningBundle);
  }
  if (record.format === LegacyTuningBundleFileFormat && typeof record.tuningBundle === "object" && record.tuningBundle !== null) {
    return normalizeTuningBundle(record.tuningBundle, true);
  }
  if (record.format === LegacyLayoutBundleFileFormat && typeof record.bundle === "object" && record.bundle !== null) {
    return normalizeTuningBundle(record.bundle, true);
  }
  throw new Error("Unsupported tuning bundle file");
}

export function parseTuningBundleLibrary(value: unknown): TuningBundle[] {
  if (!Array.isArray(value)) {
    return [createDefaultTuningBundle()];
  }
  const bundles = value.map((bundle) => {
    const tuning = typeof bundle === "object" && bundle !== null
      ? (bundle as { tuning?: { referenceDegree?: unknown } }).tuning
      : undefined;
    return normalizeTuningBundle(bundle, typeof tuning?.referenceDegree !== "number");
  });
  return bundles.length > 0 ? bundles : [createDefaultTuningBundle()];
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value ? value : fallback;
}

export function clampGeometryMenuText(value: string, fallback: string): string {
  const trimmed = value.trim();
  return (trimmed || fallback).slice(0, GeometryMenuTextMaxLength);
}

export function clampNoteLabelText(value: string, fallback: string): string {
  const trimmed = value.trim();
  return (trimmed || fallback).slice(0, NoteLabelTextMaxLength);
}

export function clampGeometryFolderPath(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed || trimmed === "/") {
    return "/";
  }
  const firstComponent = trimmed.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean)[0] ?? "";
  return firstComponent ? clampGeometryMenuText(firstComponent, "Geometry") : "/";
}

function legacyAFirstLabelsToDegreeOrder(labels: string[] | undefined, cycleLength: number): string[] | undefined {
  if (!labels) return undefined;
  const spanCtoA = -Math.floor(((cycleLength * 9) + 6) / 12);
  return Array.from({ length: cycleLength }, (_, degree) => labels[positiveModulo(spanCtoA + degree, cycleLength)]);
}

function legacyReferenceDegree(cycleLength: number, referenceMidiNote: number): number {
  return positiveModulo(Math.round((cycleLength * (referenceMidiNote - 60)) / 12), cycleLength);
}

function normalizeTuningBundleTuning(value: unknown, legacyBundleName?: string, legacyAFirst = false): TuningBundleTuning {
  const tuning = value as Partial<TuningBundleTuning> & {
    edoDivisions?: unknown;
    stepCents?: unknown;
    periodCents?: unknown;
    cents?: unknown;
    description?: unknown;
    referenceDegree?: unknown;
    defaultKeyDegree?: unknown;
    referenceMidiNote?: unknown;
    referenceHz?: unknown;
    keyLabels?: unknown;
  };
  const name = clampGeometryMenuText(legacyBundleName ?? stringOr(tuning.name, "User Tuning"), "User Tuning");
  const referenceMidiNote = clampInteger(numberOr(tuning.referenceMidiNote, 69), 0, 127);
  const referenceHz = numberOr(tuning.referenceHz, 440);

  if (tuning.kind === "edo") {
    const edoDivisions = clampInteger(numberOr(tuning.edoDivisions, numberOr(tuning.cycleLength, 12)), 1, MaxTuningDivisions);
    const sourceLabels = Array.isArray(tuning.keyLabels) ? tuning.keyLabels.map(String) : undefined;
    return {
      kind: "edo",
      name,
      edoDivisions,
      periodCents: numberOr(tuning.periodCents, 1200),
      cycleLength: edoDivisions,
      referenceDegree: clampInteger(numberOr(tuning.referenceDegree, legacyAFirst ? legacyReferenceDegree(edoDivisions, referenceMidiNote) : 0), 0, edoDivisions - 1),
      defaultKeyDegree: clampInteger(numberOr(tuning.defaultKeyDegree, 0), 0, edoDivisions - 1),
      referenceMidiNote,
      referenceHz,
      keyLabels: normalizeKeyLabels(legacyAFirst ? legacyAFirstLabelsToDegreeOrder(sourceLabels, edoDivisions) : sourceLabels, edoDivisions)
    };
  }

  if (tuning.kind === "equal-step") {
    const cycleLength = clampInteger(numberOr(tuning.cycleLength, numberOr(tuning.edoDivisions, 12)), 1, MaxTuningDivisions);
    const sourceLabels = Array.isArray(tuning.keyLabels) ? tuning.keyLabels.map(String) : undefined;
    return {
      kind: "equal-step",
      name,
      stepCents: numberOr(tuning.stepCents, numberOr(tuning.periodCents, 1200) / cycleLength),
      cycleLength,
      referenceDegree: clampInteger(numberOr(tuning.referenceDegree, legacyAFirst ? legacyReferenceDegree(cycleLength, referenceMidiNote) : 0), 0, cycleLength - 1),
      defaultKeyDegree: clampInteger(numberOr(tuning.defaultKeyDegree, 0), 0, cycleLength - 1),
      referenceMidiNote,
      referenceHz,
      keyLabels: normalizeKeyLabels(legacyAFirst ? legacyAFirstLabelsToDegreeOrder(sourceLabels, cycleLength) : sourceLabels, cycleLength)
    };
  }

  if (tuning.kind === "scala") {
    const cents = Array.isArray(tuning.cents)
      ? tuning.cents.map((cents) => Number(cents)).filter((cents) => Number.isFinite(cents))
      : [1200];
    const safeCents = (cents.length > 0 ? cents : [1200]).slice(0, MaxTuningDivisions);
    const sourceLabels = Array.isArray(tuning.keyLabels) ? tuning.keyLabels.map(String) : undefined;
    return {
      kind: "scala",
      name,
      description: stringOr(tuning.description, name),
      cents: safeCents,
      periodCents: safeCents[safeCents.length - 1] ?? 1200,
      cycleLength: clampInteger(safeCents.length, 1, MaxTuningDivisions),
      referenceDegree: clampInteger(numberOr(tuning.referenceDegree, legacyAFirst ? legacyReferenceDegree(safeCents.length, referenceMidiNote) : 0), 0, safeCents.length - 1),
      defaultKeyDegree: clampInteger(numberOr(tuning.defaultKeyDegree, 0), 0, safeCents.length - 1),
      referenceMidiNote,
      referenceHz,
      keyLabels: normalizeKeyLabels(legacyAFirst ? legacyAFirstLabelsToDegreeOrder(sourceLabels, safeCents.length) : sourceLabels, safeCents.length)
    };
  }

  throw new Error("Tuning bundle has an unsupported tuning type");
}

function normalizeTuningBundle(value: unknown, legacyAFirst = false): TuningBundle {
  const source = value as Partial<TuningBundle> & {
    name?: unknown;
    layouts?: Array<Partial<TuningBundleLayout>>;
    degreeColors?: ScaleDegreeColor[];
    buttonOverrides?: TuningBundleButtonOverride[];
  };
  if (typeof source.objectIdHex !== "string") {
    throw new Error("Tuning bundle is missing an object id");
  }
  objectIdFromHex(source.objectIdHex);
  const tuningObjectIdHex = typeof source.tuningObjectIdHex === "string"
    ? objectIdToHex(objectIdFromHex(source.tuningObjectIdHex))
    : undefined;
  const colorObjectIdHex = typeof source.colorObjectIdHex === "string"
    ? objectIdToHex(objectIdFromHex(source.colorObjectIdHex))
    : undefined;
  const catalogOrder = Number.isInteger(source.catalogOrder)
    && Number(source.catalogOrder) >= 0
    && Number(source.catalogOrder) <= 0xffff
    ? Number(source.catalogOrder)
    : undefined;
  if (!source.tuning || !Array.isArray(source.layouts) || source.layouts.length === 0) {
    throw new Error("Tuning bundle is missing tuning or layout data");
  }
  const tuning = normalizeTuningBundleTuning(
    source.tuning,
    typeof source.name === "string" ? clampGeometryMenuText(source.name, "User Tuning") : undefined,
    legacyAFirst
  );
  const cycleLength = Math.max(1, Math.round(tuning.cycleLength));
  const layouts = source.layouts;
  if (layouts.length > GeometryLayoutScaleMaxCount) {
    throw new RangeError(`Tuning bundle contains more than ${GeometryLayoutScaleMaxCount} layouts`);
  }
  const normalizedLayouts = layouts.map((layout, index) => {
    const objectIdHex = typeof layout.objectIdHex === "string"
      ? layout.objectIdHex
      : objectIdToHex(deterministicObjectId(`${source.objectIdHex}:layout:${index}`));
    objectIdFromHex(objectIdHex);
    const deviceRotationSteps = clampInteger(layout.deviceRotationSteps ?? 0, 0, 3);
    const chordActions = Array.isArray(layout.chordActions)
      ? layout.chordActions.slice(0, 16).map((action, actionIndex) => {
          const pitchMode = action.pitchMode === "midi-semitones" ? "midi-semitones" as const : "tuning-steps" as const;
          const parsedIntervals = Array.isArray(action.intervals)
            ? action.intervals.slice(0, 4).map((interval) => clampInteger(Number(interval), -32768, 32767))
            : [0, 4, 7];
          return {
            id: clampInteger(action.id ?? actionIndex + 1, 1, 255),
            name: clampGeometryMenuText(typeof action.name === "string" ? action.name : "", `Chord ${actionIndex + 1}`),
            pitchMode,
            intervals: parsedIntervals.length > 0 ? parsedIntervals : [0],
            midiChannel: clampInteger(action.midiChannel ?? 1, pitchMode === "midi-semitones" ? 1 : 0, 16)
          };
        })
      : [];
    if (new Set(chordActions.map((action) => action.id)).size !== chordActions.length) {
      throw new Error(`Layout ${index + 1} has duplicate chord action ids`);
    }
    return {
      objectIdHex,
      name: clampGeometryMenuText(typeof layout.name === "string" ? layout.name : "", `Layout ${index + 1}`),
      centerButton: clampInteger(layout.centerButton ?? 65, 0, 139),
      centerStepsFromC: Math.round(numberOr(layout.centerStepsFromC, 0)),
      acrossSteps: Math.round(layout.acrossSteps ?? 3),
      upRightSteps: Math.round(layout.upRightSteps ?? 11),
      deviceRotationSteps,
      layoutRotationSteps: clampInteger(layout.layoutRotationSteps ?? 0, 0, 5),
      mirrorLeftRight: Boolean(layout.mirrorLeftRight),
      mirrorUpDown: Boolean(layout.mirrorUpDown),
      buttonOverrides: Array.isArray(layout.buttonOverrides) ? layout.buttonOverrides : [],
      offGridOverrides: Array.isArray(layout.offGridOverrides)
        ? layout.offGridOverrides
          .filter((override) => Number.isFinite(override.coordCol) && Number.isFinite(override.coordRow))
          .map((override): TuningBundleGridOverride => ({
            ...override,
            coordCol: Math.round(override.coordCol),
            coordRow: Math.round(override.coordRow),
            role: override.role === "unused" || override.role === "command" ? override.role : "note"
          }))
        : [],
      chordActions
    };
  });
  const scales = Array.isArray(source.scales) && source.scales.length > 0
    ? source.scales
    : [createAllNotesScale(cycleLength)];
  if (scales.length > GeometryLayoutScaleMaxCount) {
    throw new RangeError(`Tuning bundle contains more than ${GeometryLayoutScaleMaxCount} scales`);
  }
  const normalizedScales = scales.map((scale, index) => {
    const objectIdHex = typeof scale.objectIdHex === "string"
      ? scale.objectIdHex
      : objectIdToHex(deterministicObjectId(`${source.objectIdHex}:scale:${index}`));
    objectIdFromHex(objectIdHex);
    const includedDegrees = Array.isArray(scale.includedDegrees)
      ? normalizeScaleDegrees(scale.includedDegrees, cycleLength)
      : createAllNotesScale(cycleLength).includedDegrees;
    return {
      objectIdHex,
      name: clampGeometryMenuText(typeof scale.name === "string" ? scale.name : "", `Scale ${index + 1}`),
      includedDegrees
    };
  });
  const palette = source.palette ?? {
    defaultColorMode: ColorMode.Custom,
    degreeColors: source.degreeColors
  };
  const defaultColorMode = numberOr(palette.defaultColorMode, ColorMode.Custom);
  return {
    objectIdHex: source.objectIdHex,
    ...(tuningObjectIdHex ? { tuningObjectIdHex } : {}),
    ...(colorObjectIdHex ? { colorObjectIdHex } : {}),
    ...(catalogOrder !== undefined ? { catalogOrder } : {}),
    folderPath: clampGeometryFolderPath(stringOr(source.folderPath, "/")),
    tuning,
    palette: {
      defaultColorMode: Object.values(ColorMode).includes(defaultColorMode as ColorModeValue)
        ? defaultColorMode as ColorModeValue
        : ColorMode.Custom,
      degreeColors: normalizeScaleDegreeColors(
        Array.isArray(palette.degreeColors) ? palette.degreeColors : createDefaultDegreeColors(cycleLength),
        cycleLength
      )
    },
    layouts: normalizedLayouts,
    activeLayoutIdHex: normalizedLayouts.find((layout) => layout.objectIdHex === source.activeLayoutIdHex)?.objectIdHex ?? normalizedLayouts[0].objectIdHex,
    scales: normalizedScales,
    activeScaleIdHex: normalizedScales.find((scale) => scale.objectIdHex === source.activeScaleIdHex)?.objectIdHex ?? normalizedScales[0].objectIdHex
  };
}

function parseScalaIntervalTokenToCents(token: string): number {
  if (!token) {
    throw new Error("Scala interval is empty");
  }
  if (token.includes("/")) {
    const [numeratorText, denominatorText] = token.split("/");
    const numerator = Number(numeratorText);
    const denominator = Number(denominatorText);
    if (numerator <= 0 || denominator <= 0) {
      throw new Error(`Invalid Scala ratio: ${token}`);
    }
    return 1200 * Math.log2(numerator / denominator);
  }
  if (!token.includes(".")) {
    const ratio = Number(token);
    if (ratio > 0) {
      return 1200 * Math.log2(ratio);
    }
  }
  const cents = Number(token);
  if (!Number.isFinite(cents)) {
    throw new Error(`Invalid Scala interval: ${token}`);
  }
  return cents;
}

export interface ParsedScalaScale {
  description: string;
  count: number;
  cents: number[];
  intervalLabels: Array<string | undefined>;
  periodCents: number;
}

function parseScalaIntervalLine(line: string): { cents: number; label: string | undefined } {
  const trimmed = line.trim();
  const match = /^(\S+)(?:\s+(.*))?$/.exec(trimmed);
  if (!match) {
    throw new Error("Scala interval is empty");
  }
  const trailingText = match[2]?.trim();
  const labelToken = trailingText && !trailingText.startsWith("!")
    ? trailingText.split(/\s+/)[0]
    : undefined;
  return {
    cents: parseScalaIntervalTokenToCents(match[1]),
    label: labelToken ? clampNoteLabelText(labelToken, labelToken) : undefined
  };
}

export function parseScalaScale(text: string): ParsedScalaScale {
  const dataLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("!"));
  if (dataLines.length < 2) {
    throw new Error("Scala .scl file is missing description or note count");
  }
  const description = dataLines[0];
  const count = Number.parseInt(dataLines[1], 10);
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error("Scala .scl note count must be a positive integer");
  }
  if (count > MaxTuningDivisions) {
    throw new Error(`Scala .scl note count exceeds HexBoard's ${MaxTuningDivisions}-division limit`);
  }
  const intervalLines = dataLines.slice(2, 2 + count);
  if (intervalLines.length !== count) {
    throw new Error(`Scala .scl expected ${count} interval lines`);
  }
  const intervals = intervalLines.map(parseScalaIntervalLine);
  const cents = intervals.map((interval) => interval.cents);
  return {
    description,
    count,
    cents,
    intervalLabels: intervals.map((interval) => interval.label),
    periodCents: cents[cents.length - 1] ?? 1200
  };
}
