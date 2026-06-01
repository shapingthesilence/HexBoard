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

export const LayoutBundleFileFormat = "hexboard.layoutBundle.v1";

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

export interface EqualStepTuningInput {
  objectId: Uint8Array;
  name: string;
  stepMilliCents: number;
  periodMilliCents?: number;
  cycleLength: number;
  referenceMidiNote?: number;
  referenceMilliHz?: number;
}

export interface CentsTableTuningInput {
  objectId: Uint8Array;
  name: string;
  cents: number[];
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

export interface LayoutBundleButtonOverride {
  buttonIndex: number;
  role: ButtonMapRoleName;
  hueTenthDegrees?: number;
  saturation?: number;
  value?: number;
  stepsFromC?: number;
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
    }
  | {
      kind: "equal-step";
      name: string;
      stepCents: number;
      periodCents: number;
      cycleLength: number;
      referenceMidiNote: number;
      referenceHz: number;
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
  tuning: LayoutBundleTuning;
  layout: {
    centerButton: number;
    acrossSteps: number;
    upRightSteps: number;
    rotationSteps: number;
    portrait: boolean;
  };
  degreeColors: ScaleDegreeColor[];
  buttonOverrides: LayoutBundleButtonOverride[];
}

export interface EncodedLayoutBundle {
  tuning: EncodedCatalogObject;
  layout: EncodedCatalogObject;
  scaleColorMap: EncodedCatalogObject;
  explicitButtonMap?: EncodedCatalogObject;
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
      tlvU8(TuningTlv.TuningKind, UserTuningKind.Edo),
      tlvU16LE(TuningTlv.EdoDivisions, input.edoDivisions),
      tlvU32LE(TuningTlv.PeriodMilliCents, periodMilliCents),
      tlvU32LE(TuningTlv.StepMilliCents, stepMilliCents),
      tlvU8(TuningTlv.ReferenceMidiNote, input.referenceMidiNote ?? 69),
      tlvU32LE(TuningTlv.ReferenceMilliHz, input.referenceMilliHz ?? 440_000)
    ]
  });
}

export function createEqualStepTuning(input: EqualStepTuningInput): EncodedCatalogObject {
  return buildCatalogObject({
    objectType: ObjectType.UserTuning,
    objectId: input.objectId,
    name: input.name,
    records: [
      tlvU8(TuningTlv.TuningKind, UserTuningKind.EqualStep),
      tlvU16LE(TuningTlv.EdoDivisions, input.cycleLength),
      tlvU32LE(TuningTlv.PeriodMilliCents, input.periodMilliCents ?? 1_200_000),
      tlvU32LE(TuningTlv.StepMilliCents, input.stepMilliCents),
      tlvU8(TuningTlv.ReferenceMidiNote, input.referenceMidiNote ?? 69),
      tlvU32LE(TuningTlv.ReferenceMilliHz, input.referenceMilliHz ?? 440_000)
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
  return {
    objectIdHex: objectIdToHex(objectId),
    name: "19 EDO Wicki",
    tuning: {
      kind: "edo",
      name: "19 EDO",
      edoDivisions: 19,
      periodCents: 1200,
      cycleLength: 19,
      referenceMidiNote: 69,
      referenceHz: 440
    },
    layout: {
      centerButton: 65,
      acrossSteps: 3,
      upRightSteps: currentFirmwareDownLeftToUpRight(3, -11),
      rotationSteps: 0,
      portrait: true
    },
    degreeColors: createDefaultDegreeColors(19),
    buttonOverrides: []
  };
}

export function encodeLayoutBundle(bundle: LayoutBundle): EncodedLayoutBundle {
  const tuningId = bundleObjectId(bundle, "tuning");
  const layoutId = bundleObjectId(bundle, "layout");
  const colorId = bundleObjectId(bundle, "colors");
  const mapId = bundleObjectId(bundle, "button-map");
  const tuningName = bundle.tuning.name || bundle.name;
  const tuning = (() => {
    switch (bundle.tuning.kind) {
      case "edo":
        return createGeneratedEdoTuning({
          objectId: tuningId,
          name: tuningName,
          edoDivisions: bundle.tuning.edoDivisions,
          periodMilliCents: centsToMilliCents(bundle.tuning.periodCents),
          referenceMidiNote: bundle.tuning.referenceMidiNote,
          referenceMilliHz: hertzToMilliHertz(bundle.tuning.referenceHz)
        });
      case "equal-step":
        return createEqualStepTuning({
          objectId: tuningId,
          name: tuningName,
          stepMilliCents: centsToMilliCents(bundle.tuning.stepCents),
          periodMilliCents: centsToMilliCents(bundle.tuning.periodCents),
          cycleLength: bundle.tuning.cycleLength,
          referenceMidiNote: bundle.tuning.referenceMidiNote,
          referenceMilliHz: hertzToMilliHertz(bundle.tuning.referenceHz)
        });
      case "scala":
        return createCentsTableTuning({
          objectId: tuningId,
          name: tuningName,
          cents: bundle.tuning.cents,
          periodMilliCents: centsToMilliCents(bundle.tuning.periodCents),
          referenceMidiNote: bundle.tuning.referenceMidiNote,
          referenceMilliHz: hertzToMilliHertz(bundle.tuning.referenceHz)
        });
    }
  })();

  const layout = createVectorLayout({
    objectId: layoutId,
    name: `${bundle.name} Layout`,
    tuningRef: tuningReference(tuning),
    centerButton: bundle.layout.centerButton,
    acrossSteps: bundle.layout.acrossSteps,
    upRightSteps: bundle.layout.upRightSteps,
    portrait: (bundle.layout.rotationSteps % 2) === 0
  });
  const scaleColorMap = createScaleColorMap({
    objectId: colorId,
    name: `${bundle.name} Colors`,
    tuningRef: tuningReference(tuning),
    cycleLength: bundle.tuning.cycleLength,
    defaultColorMode: 0,
    degreeColors: bundle.degreeColors
  });
  const explicitRecords = bundle.buttonOverrides.map((override) => ({
    buttonIndex: override.buttonIndex,
    role: roleNameToByte(override.role),
    stepsFromC: override.stepsFromC ?? 0,
    midiNote: 60,
    colorMode: override.hueTenthDegrees === undefined ? 0 : 1,
    hueTenthDegrees: override.hueTenthDegrees ?? 0,
    saturation: override.saturation ?? 0,
    value: override.value ?? 0
  }));
  const explicitButtonMap = explicitRecords.length > 0
    ? createExplicitButtonMap({
        objectId: mapId,
        name: `${bundle.name} Button Map`,
        tuningRef: tuningReference(tuning),
        layoutRef: layoutReference(layout),
        records: explicitRecords
      })
    : undefined;
  const objects = explicitButtonMap
    ? [tuning, layout, scaleColorMap, explicitButtonMap]
    : [tuning, layout, scaleColorMap];

  return {
    tuning,
    layout,
    scaleColorMap,
    explicitButtonMap,
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
  if (record.format !== LayoutBundleFileFormat || typeof record.bundle !== "object" || record.bundle === null) {
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

function normalizeLayoutBundle(value: unknown): LayoutBundle {
  const source = value as Partial<LayoutBundle>;
  if (typeof source.name !== "string" || typeof source.objectIdHex !== "string") {
    throw new Error("Layout bundle is missing a name or object id");
  }
  objectIdFromHex(source.objectIdHex);
  if (!source.tuning || !source.layout) {
    throw new Error("Layout bundle is missing tuning or layout data");
  }
  const rotationSteps = Math.max(0, Math.min(3, Math.round(source.layout.rotationSteps ?? 0)));
  return {
    objectIdHex: source.objectIdHex,
    name: source.name,
    tuning: source.tuning,
    layout: {
      centerButton: source.layout.centerButton,
      acrossSteps: source.layout.acrossSteps,
      upRightSteps: source.layout.upRightSteps,
      rotationSteps,
      portrait: typeof source.layout.portrait === "boolean" ? source.layout.portrait : (rotationSteps % 2) === 0
    },
    degreeColors: Array.isArray(source.degreeColors) ? source.degreeColors : createDefaultDegreeColors(source.tuning.cycleLength),
    buttonOverrides: Array.isArray(source.buttonOverrides) ? source.buttonOverrides : []
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
