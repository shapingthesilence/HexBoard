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
import { deterministicObjectId, objectIdFromHex, objectIdToHex } from "./objectId.ts";

export const LegacyLayoutBundleFileFormat = "hexboard.layoutBundle.v1";
export const LayoutBundleFileFormat = "hexboard.layoutBundle.v2";
export const GenericScaleColorMapName = "Custom Palette";

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
  ButtonRecords: 0x23
} as const;

export interface GeneratedEdoTuningInput {
  objectId: Uint8Array;
  name: string;
  folderPath?: string;
  edoDivisions: number;
  periodMilliCents?: number;
  referenceMidiNote?: number;
  referenceMilliHz?: number;
  keyLabels?: string[];
}

export interface EqualStepTuningInput {
  objectId: Uint8Array;
  name: string;
  folderPath?: string;
  stepMilliCents: number;
  periodMilliCents?: number;
  cycleLength: number;
  referenceMidiNote?: number;
  referenceMilliHz?: number;
  keyLabels?: string[];
}

export interface CentsTableTuningInput {
  objectId: Uint8Array;
  name: string;
  folderPath?: string;
  cents: number[];
  periodMilliCents?: number;
  referenceMidiNote?: number;
  referenceMilliHz?: number;
}

export interface VectorLayoutInput {
  objectId: Uint8Array;
  name: string;
  folderPath?: string;
  tuningRef: ObjectReferenceInput;
  centerButton: number;
  acrossSteps: number;
  upRightSteps: number;
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

export interface LayoutBundleButtonOverride {
  buttonIndex: number;
  role: ButtonMapRoleName;
  hueTenthDegrees?: number;
  saturation?: number;
  value?: number;
  stepsFromC?: number;
}

export interface LayoutBundleLayout {
  objectIdHex: string;
  name: string;
  centerButton: number;
  acrossSteps: number;
  upRightSteps: number;
  rotationSteps: number;
  portrait: boolean;
  buttonOverrides: LayoutBundleButtonOverride[];
}

export interface LayoutBundleScale {
  objectIdHex: string;
  name: string;
  includedDegrees: number[];
}

export interface LayoutBundlePalette {
  degreeColors: ScaleDegreeColor[];
}

export type LayoutBundleTuning =
  | {
      kind: "edo";
      name: string;
      edoDivisions: number;
      periodCents: number;
      cycleLength: number;
      referenceMidiNote: number;
      referenceHz: number;
      keyLabels: string[];
    }
  | {
      kind: "equal-step";
      name: string;
      stepCents: number;
      cycleLength: number;
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
      referenceMidiNote: number;
      referenceHz: number;
    };

export interface LayoutBundle {
  objectIdHex: string;
  name: string;
  folderPath: string;
  tuning: LayoutBundleTuning;
  palette: LayoutBundlePalette;
  layouts: LayoutBundleLayout[];
  activeLayoutIdHex: string;
  scales: LayoutBundleScale[];
  activeScaleIdHex: string;
}

export interface EncodedLayoutBundle {
  tuning: EncodedCatalogObject;
  layouts: EncodedCatalogObject[];
  scales: EncodedCatalogObject[];
  scaleColorMap: EncodedCatalogObject;
  explicitButtonMaps: EncodedCatalogObject[];
  objects: EncodedCatalogObject[];
}

export interface ResolvedLayoutBundleColor {
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
    folderPath: input.folderPath,
    records: [
      tlvU8(TuningTlv.TuningKind, UserTuningKind.Edo),
      tlvU16LE(TuningTlv.EdoDivisions, input.edoDivisions),
      tlvU32LE(TuningTlv.PeriodMilliCents, periodMilliCents),
      tlvU32LE(TuningTlv.StepMilliCents, stepMilliCents),
      tlvU8(TuningTlv.ReferenceMidiNote, input.referenceMidiNote ?? 69),
      tlvU32LE(TuningTlv.ReferenceMilliHz, input.referenceMilliHz ?? 440_000),
      tlv(TuningTlv.KeyLabels, encodeKeyLabels(input.keyLabels ?? defaultKeyLabels(input.edoDivisions)))
    ]
  });
}

export function createEqualStepTuning(input: EqualStepTuningInput): EncodedCatalogObject {
  return buildCatalogObject({
    objectType: ObjectType.UserTuning,
    objectId: input.objectId,
    name: input.name,
    folderPath: input.folderPath,
    records: [
      tlvU8(TuningTlv.TuningKind, UserTuningKind.EqualStep),
      tlvU16LE(TuningTlv.EdoDivisions, input.cycleLength),
      tlvU32LE(TuningTlv.PeriodMilliCents, input.periodMilliCents ?? 1_200_000),
      tlvU32LE(TuningTlv.StepMilliCents, input.stepMilliCents),
      tlvU8(TuningTlv.ReferenceMidiNote, input.referenceMidiNote ?? 69),
      tlvU32LE(TuningTlv.ReferenceMilliHz, input.referenceMilliHz ?? 440_000),
      tlv(TuningTlv.KeyLabels, encodeKeyLabels(input.keyLabels ?? defaultKeyLabels(input.cycleLength)))
    ]
  });
}

export function createCentsTableTuning(input: CentsTableTuningInput): EncodedCatalogObject {
  const tableBytes = input.cents.map((cents) => bytesFromNumbers(encodeInt32LE(Math.round(cents * 1000))));
  const periodMilliCents = input.periodMilliCents ?? Math.round((input.cents[input.cents.length - 1] ?? 1200) * 1000);

  return buildCatalogObject({
    objectType: ObjectType.UserTuning,
    objectId: input.objectId,
    name: input.name,
    folderPath: input.folderPath,
    records: [
      tlvU8(TuningTlv.TuningKind, UserTuningKind.CentsList),
      tlvU16LE(TuningTlv.EdoDivisions, input.cents.length),
      tlvU32LE(TuningTlv.PeriodMilliCents, periodMilliCents),
      tlvU8(TuningTlv.ReferenceMidiNote, input.referenceMidiNote ?? 69),
      tlvU32LE(TuningTlv.ReferenceMilliHz, input.referenceMilliHz ?? 440_000),
      tlv(TuningTlv.CentsTable, concatBytes(tableBytes))
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

function centsToMilliCents(cents: number): number {
  return Math.round(cents * 1000);
}

export function defaultKeyLabels(cycleLength: number): string[] {
  const safeCycleLength = Math.max(1, Math.round(cycleLength));
  return Array.from({ length: safeCycleLength }, (_, degree) => String(degree));
}

export function normalizeKeyLabels(labels: string[] | undefined, cycleLength: number): string[] {
  const defaults = defaultKeyLabels(cycleLength);
  return defaults.map((fallback, index) => {
    const label = labels?.[index]?.trim();
    return label || fallback;
  });
}

function encodeKeyLabels(labels: string[]): Uint8Array {
  const encoder = new TextEncoder();
  const labelBytes = labels.map((label) => {
    const bytes = encoder.encode(label);
    return bytesFromNumbers([Math.min(bytes.length, 255), ...bytes.slice(0, 255)]);
  });
  return concatBytes(labelBytes);
}

function equalStepPeriodCents(tuning: Extract<LayoutBundleTuning, { kind: "equal-step" }>): number {
  return tuning.stepCents * tuning.cycleLength;
}

function hertzToMilliHertz(hertz: number): number {
  return Math.round(hertz * 1000);
}

function bundleObjectId(bundle: LayoutBundle, suffix: string): Uint8Array {
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

export function createAllNotesScale(cycleLength: number): LayoutBundleScale {
  const safeCycleLength = Math.max(1, Math.round(cycleLength));
  return {
    objectIdHex: objectIdToHex(deterministicObjectId(`scale:all-notes:${safeCycleLength}`)),
    name: "All Notes",
    includedDegrees: Array.from({ length: safeCycleLength }, (_, degree) => degree)
  };
}

export function createDefaultLayout(cycleLength: number): LayoutBundleLayout {
  return {
    objectIdHex: objectIdToHex(deterministicObjectId(`layout:default:${cycleLength}`)),
    name: `${cycleLength} EDO Wicki`,
    centerButton: 65,
    acrossSteps: 3,
    upRightSteps: currentFirmwareDownLeftToUpRight(3, -11),
    rotationSteps: 0,
    portrait: true,
    buttonOverrides: []
  };
}

export function resolveLayoutBundleButtonColor(input: {
  degreeColors: ScaleDegreeColor[];
  cycleLength: number;
  stepsFromC: number;
  override?: LayoutBundleButtonOverride;
}): ResolvedLayoutBundleColor {
  const degree = positiveModulo(input.stepsFromC, input.cycleLength);
  const degreeColors = normalizeScaleDegreeColors(input.degreeColors, input.cycleLength);
  const degreeColor = degreeColors.find((color) => color.degree === degree) ?? degreeColors[0];
  if (
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
  return {
    degree,
    color: degreeColor,
    colorSource: "degree"
  };
}

export function createDefaultLayoutBundle(): LayoutBundle {
  const objectId = deterministicObjectId("layout-bundle:19 EDO Wicki");
  const layout = createDefaultLayout(19);
  const scale = createAllNotesScale(19);
  return {
    objectIdHex: objectIdToHex(objectId),
    name: "19 EDO Wicki",
    folderPath: "/",
    tuning: {
      kind: "edo",
      name: "19 EDO",
      edoDivisions: 19,
      periodCents: 1200,
      cycleLength: 19,
      referenceMidiNote: 69,
      referenceHz: 440,
      keyLabels: defaultKeyLabels(19)
    },
    palette: {
      degreeColors: createDefaultDegreeColors(19)
    },
    layouts: [layout],
    activeLayoutIdHex: layout.objectIdHex,
    scales: [scale],
    activeScaleIdHex: scale.objectIdHex
  };
}

export function encodeLayoutBundle(bundle: LayoutBundle): EncodedLayoutBundle {
  const tuningId = bundleObjectId(bundle, "tuning");
  const colorId = bundleObjectId(bundle, "colors");
  const tuningName = bundle.name || bundle.tuning.name;
  const folderPath = bundle.folderPath;
  const tuning = (() => {
    switch (bundle.tuning.kind) {
      case "edo":
        return createGeneratedEdoTuning({
          objectId: tuningId,
          name: tuningName,
          folderPath,
          edoDivisions: bundle.tuning.edoDivisions,
          periodMilliCents: centsToMilliCents(bundle.tuning.periodCents),
          referenceMidiNote: bundle.tuning.referenceMidiNote,
          referenceMilliHz: hertzToMilliHertz(bundle.tuning.referenceHz),
          keyLabels: bundle.tuning.keyLabels
        });
      case "equal-step":
        return createEqualStepTuning({
          objectId: tuningId,
          name: tuningName,
          folderPath,
          stepMilliCents: centsToMilliCents(bundle.tuning.stepCents),
          periodMilliCents: centsToMilliCents(equalStepPeriodCents(bundle.tuning)),
          cycleLength: bundle.tuning.cycleLength,
          referenceMidiNote: bundle.tuning.referenceMidiNote,
          referenceMilliHz: hertzToMilliHertz(bundle.tuning.referenceHz),
          keyLabels: bundle.tuning.keyLabels
        });
      case "scala":
        return createCentsTableTuning({
          objectId: tuningId,
          name: tuningName,
          folderPath,
          cents: bundle.tuning.cents,
          periodMilliCents: centsToMilliCents(bundle.tuning.periodCents),
          referenceMidiNote: bundle.tuning.referenceMidiNote,
          referenceMilliHz: hertzToMilliHertz(bundle.tuning.referenceHz)
        });
    }
  })();

  const orderedLayouts = [...bundle.layouts].sort((left, right) => {
    if (left.objectIdHex === bundle.activeLayoutIdHex) return -1;
    if (right.objectIdHex === bundle.activeLayoutIdHex) return 1;
    return 0;
  });
  const layouts = orderedLayouts.map((layout) => createVectorLayout({
    objectId: objectIdFromHex(layout.objectIdHex),
    name: layout.name || `${bundle.name} Layout`,
    folderPath,
    tuningRef: tuningReference(tuning),
    centerButton: layout.centerButton,
    acrossSteps: layout.acrossSteps,
    upRightSteps: layout.upRightSteps,
    portrait: (layout.rotationSteps % 2) === 0
  }));
  const scaleColorMap = createScaleColorMap({
    objectId: colorId,
    name: GenericScaleColorMapName,
    folderPath,
    tuningRef: tuningReference(tuning),
    cycleLength: bundle.tuning.cycleLength,
    defaultColorMode: 0,
    degreeColors: bundle.palette.degreeColors
  });
  const orderedScales = [...bundle.scales].sort((left, right) => {
    if (left.objectIdHex === bundle.activeScaleIdHex) return -1;
    if (right.objectIdHex === bundle.activeScaleIdHex) return 1;
    return 0;
  });
  const scales = orderedScales.map((scale) => createUserScale({
    objectId: objectIdFromHex(scale.objectIdHex),
    name: scale.name || `${bundle.name} Scale`,
    folderPath,
    tuningRef: tuningReference(tuning),
    cycleLength: bundle.tuning.cycleLength,
    includedDegrees: normalizeScaleDegrees(scale.includedDegrees, bundle.tuning.cycleLength)
  }));
  const explicitButtonMaps = orderedLayouts.flatMap((layout, layoutIndex) => {
    const explicitRecords = layout.buttonOverrides.map((override) => ({
      buttonIndex: override.buttonIndex,
      role: roleNameToByte(override.role),
      stepsFromC: override.stepsFromC ?? 0,
      midiNote: 60,
      colorMode: override.hueTenthDegrees === undefined ? 0 : 1,
      hueTenthDegrees: override.hueTenthDegrees ?? 0,
      saturation: override.saturation ?? 0,
      value: override.value ?? 0
    }));
    if (explicitRecords.length === 0) {
      return [];
    }
    return [createExplicitButtonMap({
      objectId: deterministicObjectId(`${bundle.objectIdHex}:button-map:${layout.objectIdHex}`),
      name: `${layout.name || bundle.name} Button Map`,
      folderPath,
      tuningRef: tuningReference(tuning),
      layoutRef: layoutReference(layouts[layoutIndex]),
      records: explicitRecords
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
    objects
  };
}

export function serializeLayoutBundle(bundle: LayoutBundle): string {
  return JSON.stringify({ format: LayoutBundleFileFormat, bundle }, null, 2);
}

export function parseLayoutBundleFile(value: unknown): LayoutBundle {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Layout bundle file must contain an object");
  }
  const record = value as Record<string, unknown>;
  if (
    (record.format !== LayoutBundleFileFormat && record.format !== LegacyLayoutBundleFileFormat) ||
    typeof record.bundle !== "object" ||
    record.bundle === null
  ) {
    throw new Error("Unsupported layout bundle file");
  }
  return normalizeLayoutBundle(record.bundle);
}

export function parseLayoutBundleLibrary(value: unknown): LayoutBundle[] {
  if (!Array.isArray(value)) {
    return [createDefaultLayoutBundle()];
  }
  const bundles = value.map((bundle) => normalizeLayoutBundle(bundle));
  return bundles.length > 0 ? bundles : [createDefaultLayoutBundle()];
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value ? value : fallback;
}

function normalizeLayoutBundleTuning(value: unknown): LayoutBundleTuning {
  const tuning = value as Partial<LayoutBundleTuning> & {
    edoDivisions?: unknown;
    stepCents?: unknown;
    periodCents?: unknown;
    cents?: unknown;
    description?: unknown;
    referenceMidiNote?: unknown;
    referenceHz?: unknown;
    keyLabels?: unknown;
  };
  const name = stringOr(tuning.name, "User Tuning");
  const referenceMidiNote = clampInteger(numberOr(tuning.referenceMidiNote, 69), 0, 127);
  const referenceHz = numberOr(tuning.referenceHz, 440);

  if (tuning.kind === "edo") {
    const edoDivisions = clampInteger(numberOr(tuning.edoDivisions, numberOr(tuning.cycleLength, 12)), 1, 255);
    return {
      kind: "edo",
      name,
      edoDivisions,
      periodCents: numberOr(tuning.periodCents, 1200),
      cycleLength: edoDivisions,
      referenceMidiNote,
      referenceHz,
      keyLabels: normalizeKeyLabels(Array.isArray(tuning.keyLabels) ? tuning.keyLabels.map(String) : undefined, edoDivisions)
    };
  }

  if (tuning.kind === "equal-step") {
    const cycleLength = clampInteger(numberOr(tuning.cycleLength, numberOr(tuning.edoDivisions, 12)), 1, 255);
    return {
      kind: "equal-step",
      name,
      stepCents: numberOr(tuning.stepCents, numberOr(tuning.periodCents, 1200) / cycleLength),
      cycleLength,
      referenceMidiNote,
      referenceHz,
      keyLabels: normalizeKeyLabels(Array.isArray(tuning.keyLabels) ? tuning.keyLabels.map(String) : undefined, cycleLength)
    };
  }

  if (tuning.kind === "scala") {
    const cents = Array.isArray(tuning.cents)
      ? tuning.cents.map((cents) => Number(cents)).filter((cents) => Number.isFinite(cents))
      : [1200];
    const safeCents = cents.length > 0 ? cents : [1200];
    return {
      kind: "scala",
      name,
      description: stringOr(tuning.description, name),
      cents: safeCents,
      periodCents: safeCents[safeCents.length - 1] ?? 1200,
      cycleLength: clampInteger(safeCents.length, 1, 255),
      referenceMidiNote,
      referenceHz
    };
  }

  throw new Error("Layout bundle has an unsupported tuning type");
}

function normalizeLayoutBundle(value: unknown): LayoutBundle {
  const source = value as Partial<LayoutBundle> & {
    layout?: Partial<LayoutBundleLayout>;
    degreeColors?: ScaleDegreeColor[];
    buttonOverrides?: LayoutBundleButtonOverride[];
  };
  if (typeof source.name !== "string" || typeof source.objectIdHex !== "string") {
    throw new Error("Layout bundle is missing a name or object id");
  }
  objectIdFromHex(source.objectIdHex);
  if (!source.tuning || !source.layout) {
    if (!source.tuning || !Array.isArray(source.layouts)) {
      throw new Error("Layout bundle is missing tuning or layout data");
    }
  }
  const tuning = normalizeLayoutBundleTuning(source.tuning);
  const cycleLength = Math.max(1, Math.round(tuning.cycleLength));
  const legacyLayout = source.layout;
  const layouts = Array.isArray(source.layouts) && source.layouts.length > 0
    ? source.layouts
    : legacyLayout
      ? [{
          objectIdHex: objectIdToHex(deterministicObjectId(`${source.objectIdHex}:legacy-layout`)),
          name: `${source.name} Layout`,
          centerButton: legacyLayout.centerButton ?? 65,
          acrossSteps: legacyLayout.acrossSteps ?? 3,
          upRightSteps: legacyLayout.upRightSteps ?? 11,
          rotationSteps: legacyLayout.rotationSteps ?? 0,
          portrait: typeof legacyLayout.portrait === "boolean" ? legacyLayout.portrait : ((legacyLayout.rotationSteps ?? 0) % 2) === 0,
          buttonOverrides: Array.isArray(source.buttonOverrides) ? source.buttonOverrides : []
        }]
      : [createDefaultLayout(cycleLength)];
  const normalizedLayouts = layouts.map((layout, index) => {
    const objectIdHex = typeof layout.objectIdHex === "string"
      ? layout.objectIdHex
      : objectIdToHex(deterministicObjectId(`${source.objectIdHex}:layout:${index}`));
    objectIdFromHex(objectIdHex);
    const rotationSteps = Math.max(0, Math.min(3, Math.round(layout.rotationSteps ?? 0)));
    return {
      objectIdHex,
      name: typeof layout.name === "string" && layout.name ? layout.name : `${source.name} Layout ${index + 1}`,
      centerButton: clampInteger(layout.centerButton ?? 65, 0, 139),
      acrossSteps: Math.round(layout.acrossSteps ?? 3),
      upRightSteps: Math.round(layout.upRightSteps ?? 11),
      rotationSteps,
      portrait: typeof layout.portrait === "boolean" ? layout.portrait : (rotationSteps % 2) === 0,
      buttonOverrides: Array.isArray(layout.buttonOverrides) ? layout.buttonOverrides : []
    };
  });
  const scales = Array.isArray(source.scales) && source.scales.length > 0
    ? source.scales
    : [createAllNotesScale(cycleLength)];
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
      name: typeof scale.name === "string" && scale.name ? scale.name : `Scale ${index + 1}`,
      includedDegrees
    };
  });
  const palette = source.palette ?? {
    degreeColors: source.degreeColors
  };
  return {
    objectIdHex: source.objectIdHex,
    name: source.name,
    folderPath: stringOr(source.folderPath, "/"),
    tuning,
    palette: {
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

function parseScalaIntervalToCents(line: string): number {
  const token = line.trim().split(/\s+/)[0];
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
  periodCents: number;
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
  const intervalLines = dataLines.slice(2, 2 + count);
  if (intervalLines.length !== count) {
    throw new Error(`Scala .scl expected ${count} interval lines`);
  }
  const cents = intervalLines.map(parseScalaIntervalToCents);
  return {
    description,
    count,
    cents,
    periodCents: cents[cents.length - 1] ?? 1200
  };
}
