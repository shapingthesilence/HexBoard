import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import {
  clampScaleDegreeColor,
  computeVectorLayoutSteps,
  createAllNotesScale,
  createDefaultDegreeColors,
  createDefaultLayout,
  createDefaultLayoutBundle,
  currentFirmwareDownLeftToUpRight,
  defaultKeyLabels,
  deterministicObjectId,
  encodeLayoutBundle,
  ExplicitButtonMapTlv,
  hexBoardGeometry,
  isHexBoardCommandIndex,
  LayoutTlv,
  normalizeScaleDegrees,
  normalizeScaleDegreeColors,
  normalizeKeyLabels,
  objectIdToHex,
  parseLayoutBundleFile,
  parseLayoutBundleLibrary,
  parseScalaScale,
  resolveLayoutBundleButtonColor,
  ScaleColorMapTlv,
  serializeLayoutBundle,
  TuningTlv,
  UserScaleTlv,
  UserTuningKind,
  type HexBoardKey,
  type LayoutBundle,
  type LayoutBundleButtonOverride,
  type LayoutBundleLayout,
  type LayoutBundleScale,
  type LayoutBundleTuning,
  type ScaleDegreeColor,
  type EncodedCatalogObject
} from "../catalogs/index.ts";
import { MockMidiTransport } from "../midi/mockTransport.ts";
import { PresetSyncClient } from "../midi/presetSyncClient.ts";
import type { MidiTransport } from "../midi/types.ts";
import { crc32 } from "../protocol/crc32.ts";
import { ObjectListFlag, ObjectType, type ObjectListRecord } from "../protocol/index.ts";
import { CommonTlv, decodeObjectBody, textFromBytes, type TlvRecord } from "../protocol/tlv.ts";
import { formatByteLength } from "./format.ts";

const layoutBundleStorageKey = "hexboard.layoutBundles.v1";
const previewHexHalfStepX = 25;
const previewHexRowStepY = 42;
const previewHexInset = 25;
const rootFolderPath = "/";
const defaultGeometryFolders = [rootFolderPath, "Tunings", "Layouts"];

type LayoutGuideFocus = "center" | "across" | "upRight";
type GeometryEditorTab = "tuning" | "layouts" | "scales";
type GeometrySidebarTab = "library" | "editor";
type GeometryLibrarySpace = "computer" | "hexboard";
type PaintTool = "brush" | "eyedropper";

const layoutAxisDirectionLabels = [
  { across: "Right", upRight: "Up-right" },
  { across: "Down", upRight: "Down-right" },
  { across: "Left", upRight: "Down-left" },
  { across: "Up", upRight: "Up-left" }
] as const;

interface PreviewKey {
  key: HexBoardKey;
  role: "note" | "unused";
  generatedStepsFromC: number;
  stepsFromC: number;
  degree: number;
  inScale: boolean;
  color: ScaleDegreeColor;
  colorSource: "button" | "degree";
  noteSource: "button" | "generated";
  override?: LayoutBundleButtonOverride;
}

interface GuideHalo {
  key: HexBoardKey;
  tone: "green" | "red";
}

interface TuningLayoutEditorProps {
  transport: MidiTransport;
}

interface HexBoardGeometryBundleEntry {
  objectIdHex: string;
  deviceHandle: number;
  name: string;
  folderPath: string;
  schemaMajor: number;
  schemaMinor: number;
  readOnly: boolean;
}

interface DeviceGeometryObject {
  record: ObjectListRecord;
  body: Uint8Array;
  records: TlvRecord[];
}

function createUntitledBundle(): LayoutBundle {
  const base = createDefaultLayoutBundle();
  const objectIdHex = objectIdToHex(deterministicObjectId(`layout-bundle:${Date.now()}`));
  const layoutIdHex = objectIdToHex(deterministicObjectId(`${objectIdHex}:layout:default`));
  const scaleIdHex = objectIdToHex(deterministicObjectId(`${objectIdHex}:scale:all-notes`));
  return {
    ...base,
    objectIdHex,
    name: "Untitled Geometry",
    folderPath: rootFolderPath,
    tuning: {
      ...base.tuning,
      name: "19 EDO"
    },
    palette: base.palette,
    layouts: base.layouts.map((layout) => ({ ...layout, objectIdHex: layoutIdHex, name: "Untitled Layout" })),
    activeLayoutIdHex: layoutIdHex,
    scales: base.scales.map((scale) => ({ ...scale, objectIdHex: scaleIdHex })),
    activeScaleIdHex: scaleIdHex
  };
}

function loadStoredBundles(): LayoutBundle[] {
  if (typeof window === "undefined") {
    return [createDefaultLayoutBundle()];
  }
  try {
    const raw = window.localStorage.getItem(layoutBundleStorageKey);
    if (!raw) {
      return [createDefaultLayoutBundle()];
    }
    const parsed = JSON.parse(raw) as unknown;
    return parseLayoutBundleLibrary(parsed).map(sanitizeEditorBundle);
  } catch {
    return [createDefaultLayoutBundle()];
  }
}

function persistBundles(bundles: LayoutBundle[]) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(layoutBundleStorageKey, JSON.stringify(bundles.map(sanitizeEditorBundle)));
  }
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}

function tuningCycleLength(tuning: LayoutBundleTuning): number {
  return Math.max(1, Math.round(tuning.cycleLength));
}

function tuningPeriodCents(tuning: LayoutBundleTuning): number {
  if (tuning.kind === "equal-step") {
    return tuning.stepCents * tuningCycleLength(tuning);
  }
  return tuning.periodCents;
}

function isAllNotesScale(scale: Pick<LayoutBundleScale, "name">): boolean {
  return scale.name.trim().toLocaleLowerCase() === "all notes";
}

function withProtectedAllNotesScale(bundle: LayoutBundle, cycleLength = tuningCycleLength(bundle.tuning)): LayoutBundle {
  const protectedScale = createAllNotesScale(cycleLength);
  const previousAllNotes = bundle.scales.find(isAllNotesScale);
  const activeWasAllNotes = previousAllNotes?.objectIdHex === bundle.activeScaleIdHex;
  const userScales = bundle.scales
    .filter((scale) => !isAllNotesScale(scale))
    .map((scale) => ({
      ...scale,
      includedDegrees: normalizeScaleDegrees(scale.includedDegrees, cycleLength)
    }));
  const scales = [protectedScale, ...userScales];
  const activeScaleIdHex = activeWasAllNotes
    ? protectedScale.objectIdHex
    : scales.find((scale) => scale.objectIdHex === bundle.activeScaleIdHex)?.objectIdHex ?? protectedScale.objectIdHex;

  return {
    ...bundle,
    scales,
    activeScaleIdHex
  };
}

function layoutAxisLabels(rotationSteps: number): typeof layoutAxisDirectionLabels[number] {
  const index = ((Math.round(rotationSteps) % 4) + 4) % 4;
  return layoutAxisDirectionLabels[index];
}

function withCycleColors(bundle: LayoutBundle, cycleLength: number): LayoutBundle {
  const safeCycleLength = Math.max(1, Math.round(cycleLength));
  return withProtectedAllNotesScale({
    ...bundle,
    palette: {
      ...bundle.palette,
      degreeColors: normalizeScaleDegreeColors(bundle.palette.degreeColors, safeCycleLength)
    },
    layouts: bundle.layouts.map((layout) => ({
      ...layout,
      rotationSteps: clampInteger(layout.rotationSteps ?? 0, 0, 3)
    })),
  }, safeCycleLength);
}

export function colorToCss(color: ScaleDegreeColor): string {
  return scaleDegreeColorToHex(color);
}

function scaleDegreeColorToHex(color: ScaleDegreeColor): string {
  const hue = (((color.hueTenthDegrees / 10) % 360) + 360) % 360;
  const saturation = color.saturation / 255;
  const value = color.value / 255;
  const chroma = value * saturation;
  const huePrime = hue / 60;
  const intermediate = chroma * (1 - Math.abs((huePrime % 2) - 1));
  const match = value - chroma;
  let red = 0;
  let green = 0;
  let blue = 0;

  if (huePrime < 1) {
    red = chroma;
    green = intermediate;
  } else if (huePrime < 2) {
    red = intermediate;
    green = chroma;
  } else if (huePrime < 3) {
    green = chroma;
    blue = intermediate;
  } else if (huePrime < 4) {
    green = intermediate;
    blue = chroma;
  } else if (huePrime < 5) {
    red = intermediate;
    blue = chroma;
  } else {
    red = chroma;
    blue = intermediate;
  }

  return [red, green, blue]
    .map((channel) => Math.round((channel + match) * 255).toString(16).padStart(2, "0"))
    .join("")
    .replace(/^/, "#");
}

function hexToScaleDegreeColor(hex: string, fallback: ScaleDegreeColor): ScaleDegreeColor {
  const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : null;
  if (!normalized) {
    return fallback;
  }
  const red = Number.parseInt(normalized.slice(0, 2), 16) / 255;
  const green = Number.parseInt(normalized.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(normalized.slice(4, 6), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;

  if (delta !== 0 && max === red) {
    hue = 60 * (((green - blue) / delta) % 6);
  } else if (delta !== 0 && max === green) {
    hue = 60 * (((blue - red) / delta) + 2);
  } else if (delta !== 0) {
    hue = 60 * (((red - green) / delta) + 4);
  }

  return clampScaleDegreeColor({
    degree: fallback.degree,
    hueTenthDegrees: Math.round((((hue + 360) % 360) * 10)),
    saturation: max === 0 ? 0 : Math.round((delta / max) * 255),
    value: Math.round(max * 255)
  });
}

function fileBaseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "") || "Imported Tuning";
}

function downloadTextFile(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function normalizeDisplayFolderPath(folderPath: string): string {
  return folderPath.trim() || rootFolderPath;
}

function folderLabel(folderPath: string): string {
  return normalizeDisplayFolderPath(folderPath) === rootFolderPath ? "Root" : folderPath;
}

function encodeDeviceFolderPath(folderPath: string): string {
  const normalized = normalizeDisplayFolderPath(folderPath);
  if (normalized === rootFolderPath) {
    return rootFolderPath;
  }
  return normalized
    .replace(/%/g, "%25")
    .replace(/\//g, "%2F")
    .replace(/\\/g, "%5C");
}

function decodeDeviceFolderPath(folderPath: string): string {
  const normalized = normalizeDisplayFolderPath(folderPath);
  if (normalized === rootFolderPath) {
    return rootFolderPath;
  }
  return normalized.replace(/%(25|2f|2F|5c|5C)/g, (match) => {
    switch (match.toUpperCase()) {
      case "%25":
        return "%";
      case "%2F":
        return "/";
      case "%5C":
        return "\\";
      default:
        return match;
    }
  });
}

function geometryBundleSortKey(item: Pick<LayoutBundle, "folderPath" | "name">): string {
  return `${normalizeDisplayFolderPath(item.folderPath).toLocaleLowerCase()}\u0000${item.name.toLocaleLowerCase()}`;
}

function compareGeometryBundles(left: LayoutBundle, right: LayoutBundle): number {
  return geometryBundleSortKey(left).localeCompare(geometryBundleSortKey(right));
}

function hexBoardGeometryEntryFromRecord(record: ObjectListRecord): HexBoardGeometryBundleEntry {
  return {
    objectIdHex: objectIdToHex(record.objectId),
    deviceHandle: record.handle,
    name: record.name || "User Tuning",
    folderPath: decodeDeviceFolderPath(record.folderPath || rootFolderPath),
    schemaMajor: record.schemaMajor,
    schemaMinor: record.schemaMinor,
    readOnly: (record.flags & ObjectListFlag.ReadOnly) !== 0
  };
}

function upsertOverride(
  overrides: LayoutBundleButtonOverride[],
  buttonIndex: number,
  patch: Partial<LayoutBundleButtonOverride>
): LayoutBundleButtonOverride[] {
  if (isHexBoardCommandIndex(buttonIndex)) {
    return overrides.filter((override) => override.buttonIndex !== buttonIndex);
  }
  const existing = overrides.find((override) => override.buttonIndex === buttonIndex);
  const next = {
    buttonIndex,
    ...existing,
    ...patch,
    role: (patch.role ?? existing?.role) === "unused" ? "unused" : "note"
  } satisfies LayoutBundleButtonOverride;
  return [...overrides.filter((override) => override.buttonIndex !== buttonIndex), next]
    .sort((left, right) => left.buttonIndex - right.buttonIndex);
}

function removeOverrideColor(override: LayoutBundleButtonOverride): LayoutBundleButtonOverride {
  const { hueTenthDegrees, saturation, value, ...rest } = override;
  void hueTenthDegrees;
  void saturation;
  void value;
  return rest;
}

function isRoleDefault(buttonIndex: number, role: LayoutBundleButtonOverride["role"]): boolean {
  return isHexBoardCommandIndex(buttonIndex) || role === "note";
}

function hexBoardKeyAtCoord(coordRow: number, coordCol: number): HexBoardKey | undefined {
  return hexBoardGeometry.find((key) => key.coordRow === coordRow && key.coordCol === coordCol);
}

function isEditableButtonIndex(buttonIndex: number): boolean {
  return Number.isInteger(buttonIndex) && buttonIndex >= 0 && buttonIndex < 140 && !isHexBoardCommandIndex(buttonIndex);
}

function noteButtonIndexOrFallback(buttonIndex: number, fallback: number): number {
  if (isEditableButtonIndex(buttonIndex)) {
    return buttonIndex;
  }
  return isEditableButtonIndex(fallback) ? fallback : 65;
}

function sanitizeEditorBundle(bundle: LayoutBundle): LayoutBundle {
  const cycleLength = tuningCycleLength(bundle.tuning);
  return withProtectedAllNotesScale({
    ...bundle,
    folderPath: normalizeDisplayFolderPath(bundle.folderPath),
    layouts: bundle.layouts.map((layout) => ({
      ...layout,
      centerButton: noteButtonIndexOrFallback(layout.centerButton, 65),
      buttonOverrides: layout.buttonOverrides
        .filter((override) => isEditableButtonIndex(override.buttonIndex))
        .map((override) => ({
          ...override,
          role: override.role === "unused" ? "unused" : "note"
        }))
    }))
  }, cycleLength);
}

function bundleWithGeneratedOverrideSteps(bundle: LayoutBundle): LayoutBundle {
  return {
    ...bundle,
    layouts: bundle.layouts.map((layout) => ({
      ...layout,
      buttonOverrides: layout.buttonOverrides.map((override) => {
        if (override.stepsFromC !== undefined) {
          return override;
        }
        const key = hexBoardGeometry.find((candidate) => candidate.index === override.buttonIndex);
        return {
          ...override,
          stepsFromC: key ? Math.round(computeVectorLayoutSteps(key, layout)) : 0
        };
      })
    }))
  };
}

function bundleForDeviceEncoding(bundle: LayoutBundle): LayoutBundle {
  const sanitized = bundleWithGeneratedOverrideSteps(sanitizeEditorBundle(bundle));
  return {
    ...sanitized,
    folderPath: encodeDeviceFolderPath(sanitized.folderPath)
  };
}

function formatIntegerList(values: number[]): string {
  return values.join(", ");
}

function formatLabelList(labels: string[]): string {
  return labels.join(", ");
}

function parseLabelList(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function validateKeyLabelsInput(text: string, cycleLength: number): { labels: string[] } | { error: string } {
  const safeCycleLength = Math.max(1, Math.round(cycleLength));
  const labels = parseLabelList(text);
  if (labels.length !== safeCycleLength) {
    return { error: `Note labels must include exactly ${safeCycleLength} labels.` };
  }
  const invalidLabel = labels.find((label) => label.length > 8 || !/^[A-Za-z0-9+#b-]+$/.test(label));
  if (invalidLabel) {
    return { error: `Invalid note label "${invalidLabel}". Use letters, numbers, +, #, b, or -.` };
  }
  return { labels };
}

function validateIncludedDegreesInput(text: string, cycleLength: number): { degrees: number[] } | { error: string } {
  const safeCycleLength = Math.max(1, Math.round(cycleLength));
  const trimmed = text.trim();
  if (!trimmed) {
    return { error: "Included degrees needs at least one degree." };
  }

  const parts = trimmed.split(/[\s,]+/).filter(Boolean);
  const degrees: number[] = [];
  for (const part of parts) {
    if (!/^-?\d+$/.test(part)) {
      return { error: `Invalid included degree "${part}". Use whole numbers separated by commas or spaces.` };
    }
    const degree = Number.parseInt(part, 10);
    if (degree < 0 || degree >= safeCycleLength) {
      return { error: `Included degrees must be between 0 and ${safeCycleLength - 1}.` };
    }
    degrees.push(degree);
  }

  return { degrees: normalizeScaleDegrees(degrees, safeCycleLength) };
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function objectReferenceIdHex(value: Uint8Array): string | null {
  if (value.length < 19) {
    return null;
  }
  return objectIdToHex(value.slice(3, 19));
}

function tlvValue(records: TlvRecord[], tag: number): Uint8Array | undefined {
  return records.find((record) => record.tag === tag)?.value;
}

function tlvText(records: TlvRecord[], tag: number, fallback: string): string {
  const value = tlvValue(records, tag);
  return value ? textFromBytes(value) || fallback : fallback;
}

function u8(value: Uint8Array | undefined, fallback = 0): number {
  return value && value.length >= 1 ? value[0] : fallback;
}

function u16LE(value: Uint8Array | undefined, fallback = 0): number {
  return value && value.length >= 2 ? value[0] | (value[1] << 8) : fallback;
}

function i16LE(value: Uint8Array | undefined, fallback = 0): number {
  const unsigned = u16LE(value, fallback);
  return unsigned & 0x8000 ? unsigned - 0x10000 : unsigned;
}

function u32LE(value: Uint8Array | undefined, fallback = 0): number {
  return value && value.length >= 4
    ? ((value[0] | (value[1] << 8) | (value[2] << 16) | (value[3] << 24)) >>> 0)
    : fallback;
}

function i32LEFromBytes(value: Uint8Array, offset: number): number {
  const unsigned = (value[offset] | (value[offset + 1] << 8) | (value[offset + 2] << 16) | (value[offset + 3] << 24)) >>> 0;
  return unsigned > 0x7fffffff ? unsigned - 0x100000000 : unsigned;
}

function decodeKeyLabels(value: Uint8Array | undefined, cycleLength: number): string[] {
  if (!value) {
    return defaultKeyLabels(cycleLength);
  }
  const labels: string[] = [];
  let cursor = 0;
  while (cursor < value.length && labels.length < cycleLength) {
    const length = value[cursor];
    cursor += 1;
    if (cursor + length > value.length) {
      return defaultKeyLabels(cycleLength);
    }
    labels.push(textFromBytes(value.slice(cursor, cursor + length)));
    cursor += length;
  }
  return normalizeKeyLabels(labels, cycleLength);
}

function objectReferences(object: DeviceGeometryObject, tag: number, objectType: number, objectIdHex: string): boolean {
  const value = tlvValue(object.records, tag);
  return Boolean(value && value.length >= 19 && value[0] === objectType && objectReferenceIdHex(value) === objectIdHex);
}

function decodeDeviceTuning(entry: HexBoardGeometryBundleEntry, object: DeviceGeometryObject): LayoutBundleTuning {
  const kind = u8(tlvValue(object.records, TuningTlv.TuningKind), UserTuningKind.Edo);
  const cycleLength = clampInteger(u16LE(tlvValue(object.records, TuningTlv.EdoDivisions), 12), 1, 255);
  const name = tlvText(object.records, CommonTlv.Name, entry.name);
  const referenceMidiNote = clampInteger(u8(tlvValue(object.records, TuningTlv.ReferenceMidiNote), 69), 0, 127);
  const referenceHz = u32LE(tlvValue(object.records, TuningTlv.ReferenceMilliHz), 440_000) / 1000;

  if (kind === UserTuningKind.EqualStep) {
    return {
      kind: "equal-step",
      name,
      stepCents: u32LE(tlvValue(object.records, TuningTlv.StepMilliCents), Math.round(1_200_000 / cycleLength)) / 1000,
      cycleLength,
      referenceMidiNote,
      referenceHz,
      keyLabels: decodeKeyLabels(tlvValue(object.records, TuningTlv.KeyLabels), cycleLength)
    };
  }

  if (kind === UserTuningKind.CentsList) {
    const centsBytes = tlvValue(object.records, TuningTlv.CentsTable);
    const cents: number[] = [];
    if (centsBytes) {
      for (let offset = 0; offset + 3 < centsBytes.length; offset += 4) {
        cents.push(i32LEFromBytes(centsBytes, offset) / 1000);
      }
    }
    const safeCents = cents.length > 0 ? cents : [u32LE(tlvValue(object.records, TuningTlv.PeriodMilliCents), 1_200_000) / 1000];
    return {
      kind: "scala",
      name,
      description: name,
      cents: safeCents,
      periodCents: safeCents[safeCents.length - 1] ?? 1200,
      cycleLength: clampInteger(safeCents.length, 1, 255),
      referenceMidiNote,
      referenceHz
    };
  }

  return {
    kind: "edo",
    name,
    edoDivisions: cycleLength,
    periodCents: u32LE(tlvValue(object.records, TuningTlv.PeriodMilliCents), 1_200_000) / 1000,
    cycleLength,
    referenceMidiNote,
    referenceHz,
    keyLabels: decodeKeyLabels(tlvValue(object.records, TuningTlv.KeyLabels), cycleLength)
  };
}

function decodeDeviceColorMap(object: DeviceGeometryObject | undefined, cycleLength: number): ScaleDegreeColor[] {
  if (!object) {
    return createDefaultDegreeColors(cycleLength);
  }
  const colors = createDefaultDegreeColors(cycleLength);
  const colorBytes = tlvValue(object.records, ScaleColorMapTlv.DegreeColors);
  if (!colorBytes) {
    return colors;
  }
  for (let offset = 0; offset + 5 < colorBytes.length; offset += 6) {
    const degree = colorBytes[offset] | (colorBytes[offset + 1] << 8);
    if (degree >= cycleLength) {
      continue;
    }
    colors[degree] = clampScaleDegreeColor({
      degree,
      hueTenthDegrees: colorBytes[offset + 2] | (colorBytes[offset + 3] << 8),
      saturation: colorBytes[offset + 4],
      value: colorBytes[offset + 5]
    });
  }
  return colors;
}

function decodeDeviceScale(object: DeviceGeometryObject, index: number, cycleLength: number): LayoutBundleScale {
  const includedBytes = tlvValue(object.records, UserScaleTlv.IncludedDegrees);
  const includedDegrees: number[] = [];
  if (includedBytes) {
    for (let offset = 0; offset + 1 < includedBytes.length; offset += 2) {
      includedDegrees.push(includedBytes[offset] | (includedBytes[offset + 1] << 8));
    }
  }
  return {
    objectIdHex: objectIdToHex(object.record.objectId),
    name: tlvText(object.records, CommonTlv.Name, `Scale ${index + 1}`),
    includedDegrees: normalizeScaleDegrees(includedDegrees.length > 0 ? includedDegrees : createAllNotesScale(cycleLength).includedDegrees, cycleLength)
  };
}

function decodeDeviceButtonOverrides(map: DeviceGeometryObject | undefined): LayoutBundleButtonOverride[] {
  const records = map ? tlvValue(map.records, ExplicitButtonMapTlv.ButtonRecords) : undefined;
  if (!records) {
    return [];
  }
  const overrides: LayoutBundleButtonOverride[] = [];
  for (let offset = 0; offset + 12 < records.length; offset += 13) {
    const buttonIndex = records[offset] | (records[offset + 1] << 8);
    if (!isEditableButtonIndex(buttonIndex)) {
      continue;
    }
    const role = records[offset + 2] === 0 ? "unused" : "note";
    const override: LayoutBundleButtonOverride = {
      buttonIndex,
      role,
      stepsFromC: i32LEFromBytes(records, offset + 3)
    };
    if (records[offset + 8] !== 0) {
      override.hueTenthDegrees = records[offset + 9] | (records[offset + 10] << 8);
      override.saturation = records[offset + 11];
      override.value = records[offset + 12];
    }
    overrides.push(override);
  }
  return overrides.sort((left, right) => left.buttonIndex - right.buttonIndex);
}

function decodeDeviceLayout(object: DeviceGeometryObject, index: number, buttonMap: DeviceGeometryObject | undefined): LayoutBundleLayout {
  const rotationSteps = u8(tlvValue(object.records, LayoutTlv.Portrait), 1) === 0 ? 1 : 0;
  const acrossSteps = i16LE(tlvValue(object.records, LayoutTlv.AcrossSteps), 3);
  const downLeftSteps = i16LE(tlvValue(object.records, LayoutTlv.DownLeftSteps), -11);
  return {
    objectIdHex: objectIdToHex(object.record.objectId),
    name: tlvText(object.records, CommonTlv.Name, `Layout ${index + 1}`),
    centerButton: noteButtonIndexOrFallback(u16LE(tlvValue(object.records, LayoutTlv.CenterButton), 65), 65),
    acrossSteps,
    upRightSteps: currentFirmwareDownLeftToUpRight(acrossSteps, downLeftSteps),
    rotationSteps,
    portrait: rotationSteps % 2 === 0,
    buttonOverrides: decodeDeviceButtonOverrides(buttonMap)
  };
}

export function TuningLayoutEditor({ transport }: TuningLayoutEditorProps) {
  const [bundles, setBundles] = useState<LayoutBundle[]>(() => loadStoredBundles());
  const [hexboardBundles, setHexboardBundles] = useState<HexBoardGeometryBundleEntry[]>([]);
  const [activeBundleId, setActiveBundleId] = useState("");
  const [customFolders, setCustomFolders] = useState(defaultGeometryFolders);
  const [newFolder, setNewFolder] = useState("");
  const [folderFilters, setFolderFilters] = useState<Record<GeometryLibrarySpace, string | null>>({
    computer: null,
    hexboard: null
  });
  const [activeSidebarTab, setActiveSidebarTab] = useState<GeometrySidebarTab>("library");
  const [selectedButton, setSelectedButton] = useState(65);
  const [layoutGuideFocus, setLayoutGuideFocus] = useState<LayoutGuideFocus | null>(null);
  const [activeEditorTab, setActiveEditorTab] = useState<GeometryEditorTab>("tuning");
  const [paintbrushMode, setPaintbrushMode] = useState(false);
  const [paintTool, setPaintTool] = useState<PaintTool>("brush");
  const [paintbrushColor, setPaintbrushColor] = useState<ScaleDegreeColor>(() => createDefaultDegreeColors(1)[0]);
  const [keyLabelsDraft, setKeyLabelsDraft] = useState("");
  const [keyLabelsError, setKeyLabelsError] = useState("");
  const [includedDegreesDraft, setIncludedDegreesDraft] = useState("");
  const [includedDegreesError, setIncludedDegreesError] = useState("");
  const [status, setStatus] = useState("Ready");
  const [syncBusy, setSyncBusy] = useState(false);
  const [liveSend, setLiveSend] = useState(false);
  const bundleInputRef = useRef<HTMLInputElement>(null);
  const scalaInputRef = useRef<HTMLInputElement>(null);
  const keyLabelsInputRef = useRef<HTMLInputElement>(null);
  const includedDegreesInputRef = useRef<HTMLInputElement>(null);
  const paintStrokeActiveRef = useRef(false);
  const lastPaintedButtonRef = useRef<number | null>(null);
  const skipNextLiveSendRef = useRef(true);

  const activeBundle = bundles.find((bundle) => bundle.objectIdHex === activeBundleId) ?? bundles[0] ?? createDefaultLayoutBundle();
  const activeLayout = activeBundle.layouts.find((layout) => layout.objectIdHex === activeBundle.activeLayoutIdHex) ??
    activeBundle.layouts[0] ??
    createDefaultLayout(tuningCycleLength(activeBundle.tuning));
  const activeScale = activeBundle.scales.find((scale) => scale.objectIdHex === activeBundle.activeScaleIdHex) ??
    activeBundle.scales[0] ??
    createAllNotesScale(tuningCycleLength(activeBundle.tuning));
  const activeScaleIsAllNotes = isAllNotesScale(activeScale);
  const client = useMemo(() => new PresetSyncClient(transport), [transport]);
  const allFolders = useMemo(() => Array.from(new Set([
    rootFolderPath,
    ...defaultGeometryFolders,
    ...customFolders,
    ...bundles.map((bundle) => normalizeDisplayFolderPath(bundle.folderPath)),
    ...hexboardBundles.map((bundle) => normalizeDisplayFolderPath(bundle.folderPath)),
    normalizeDisplayFolderPath(activeBundle.folderPath)
  ])).sort((left, right) => folderLabel(left).localeCompare(folderLabel(right))), [activeBundle.folderPath, bundles, customFolders, hexboardBundles]);

  useEffect(() => {
    const cycleLength = tuningCycleLength(activeBundle.tuning);
    setIncludedDegreesDraft(formatIntegerList(
      activeScaleIsAllNotes ? createAllNotesScale(cycleLength).includedDegrees : activeScale.includedDegrees
    ));
    setIncludedDegreesError("");
  }, [activeScale.objectIdHex, activeScale.includedDegrees, activeScaleIsAllNotes, activeBundle.tuning]);

  useEffect(() => {
    if (activeBundle.tuning.kind === "scala") {
      setKeyLabelsDraft("");
      setKeyLabelsError("");
      return;
    }
    setKeyLabelsDraft(formatLabelList(activeBundle.tuning.keyLabels));
    setKeyLabelsError("");
  }, [activeBundle.tuning]);

  function setBundlesAndPersist(nextBundles: LayoutBundle[]) {
    const sanitized = nextBundles.map(sanitizeEditorBundle).sort(compareGeometryBundles);
    setBundles(sanitized);
    persistBundles(sanitized);
  }

  function updateActiveBundle(updater: (bundle: LayoutBundle) => LayoutBundle) {
    const targetId = activeBundle.objectIdHex;
    const nextBundles = bundles.map((bundle) => bundle.objectIdHex === targetId ? updater(bundle) : bundle);
    setBundlesAndPersist(nextBundles);
    setActiveBundleId(targetId);
  }

  function addNewBundle() {
    const next = createUntitledBundle();
    const nextBundles = [...bundles, next];
    setBundlesAndPersist(nextBundles);
    setActiveBundleId(next.objectIdHex);
    setSelectedButton(next.layouts[0]?.centerButton ?? 65);
    setStatus("Created new geometry bundle");
  }

  function deleteActiveBundle() {
    if (bundles.length <= 1) {
      setStatus("Keep at least one geometry bundle in the library");
      return;
    }
    deleteBundle(activeBundle);
  }

  function deleteBundle(bundleToDelete: LayoutBundle) {
    if (bundles.length <= 1) {
      setStatus("Keep at least one geometry bundle in the library");
      return;
    }
    const nextBundles = bundles.filter((bundle) => bundle.objectIdHex !== bundleToDelete.objectIdHex);
    setBundlesAndPersist(nextBundles);
    setActiveBundleId(nextBundles[0]?.objectIdHex ?? "");
    setSelectedButton(nextBundles[0]?.layouts[0]?.centerButton ?? 65);
    setStatus(`Deleted ${bundleToDelete.name}`);
  }

  function openBundle(bundle: LayoutBundle) {
    setActiveBundleId(bundle.objectIdHex);
    setSelectedButton(noteButtonIndexOrFallback(
      bundle.layouts.find((layout) => layout.objectIdHex === bundle.activeLayoutIdHex)?.centerButton ?? bundle.layouts[0]?.centerButton ?? 65,
      65
    ));
    setStatus(`Opened ${bundle.name}`);
  }

  function downloadBundleFile(bundle: LayoutBundle) {
    const sanitized = sanitizeEditorBundle(bundle);
    downloadTextFile(`${sanitized.name}.hexboard-layout.json`, serializeLayoutBundle(sanitized));
  }

  function updateBundleName(name: string) {
    updateActiveBundle((bundle) => ({ ...bundle, name }));
  }

  function updateBundleFolder(folderPath: string) {
    const normalized = normalizeDisplayFolderPath(folderPath);
    setCustomFolders((current) => Array.from(new Set([...current, normalized])).sort());
    updateActiveBundle((bundle) => ({ ...bundle, folderPath: normalized }));
  }

  function addFolder() {
    const folder = normalizeDisplayFolderPath(newFolder);
    if (folder === rootFolderPath && newFolder.trim() === "") {
      setStatus("Enter a folder name first");
      return;
    }
    setCustomFolders((current) => Array.from(new Set([...current, folder])).sort());
    updateBundleFolder(folder);
    setNewFolder("");
    setStatus(`Added folder ${folderLabel(folder)}`);
  }

  function toggleFolderFilter(space: GeometryLibrarySpace, folderPath: string) {
    setFolderFilters((current) => ({
      ...current,
      [space]: current[space] === folderPath ? null : folderPath
    }));
  }

  function saveActiveBundleToComputer(prefix = "Saved") {
    const normalized = sanitizeEditorBundle(activeBundle);
    setBundlesAndPersist(bundles.map((bundle) => bundle.objectIdHex === normalized.objectIdHex ? normalized : bundle));
    setCustomFolders((current) => Array.from(new Set([...current, normalized.folderPath])).sort());
    setStatus(`${prefix} ${normalized.name} in Computer Library`);
  }

  function updateActiveLayout(updater: (layout: LayoutBundleLayout) => LayoutBundleLayout) {
    updateActiveBundle((bundle) => ({
      ...bundle,
      layouts: bundle.layouts.map((layout) => layout.objectIdHex === bundle.activeLayoutIdHex ? updater(layout) : layout)
    }));
  }

  function updateLayout(patch: Partial<LayoutBundleLayout>) {
    updateActiveLayout((layout) => ({
      ...layout,
      ...patch
    }));
  }

  function addNewLayout() {
    const layout = {
      ...activeLayout,
      objectIdHex: objectIdToHex(deterministicObjectId(`${activeBundle.objectIdHex}:layout:${Date.now()}`)),
      name: "New Layout",
      buttonOverrides: []
    };
    updateActiveBundle((bundle) => ({
      ...bundle,
      layouts: [...bundle.layouts, layout],
      activeLayoutIdHex: layout.objectIdHex
    }));
    setSelectedButton(layout.centerButton);
  }

  function deleteActiveLayout() {
    if (activeBundle.layouts.length <= 1) {
      setStatus("Keep at least one layout in the bundle");
      return;
    }
    updateActiveBundle((bundle) => {
      const layouts = bundle.layouts.filter((layout) => layout.objectIdHex !== activeLayout.objectIdHex);
      return {
        ...bundle,
        layouts,
        activeLayoutIdHex: layouts[0].objectIdHex
      };
    });
  }

  function setActiveLayoutId(layoutId: string) {
    const layout = activeBundle.layouts.find((candidate) => candidate.objectIdHex === layoutId);
    updateActiveBundle((bundle) => ({
      ...bundle,
      activeLayoutIdHex: layoutId
    }));
    if (layout) {
      setSelectedButton(layout.centerButton);
    }
  }

  function updateActiveScale(updater: (scale: LayoutBundleScale) => LayoutBundleScale) {
    if (activeScaleIsAllNotes) {
      setStatus("All Notes is always included and cannot be edited.");
      return;
    }
    updateActiveBundle((bundle) => ({
      ...bundle,
      scales: bundle.scales.map((scale) => scale.objectIdHex === bundle.activeScaleIdHex ? updater(scale) : scale)
    }));
  }

  function addNewScale() {
    const scale = {
      ...createAllNotesScale(tuningCycleLength(activeBundle.tuning)),
      objectIdHex: objectIdToHex(deterministicObjectId(`${activeBundle.objectIdHex}:scale:${Date.now()}`)),
      name: "New Scale"
    };
    updateActiveBundle((bundle) => ({
      ...bundle,
      scales: [...bundle.scales, scale],
      activeScaleIdHex: scale.objectIdHex
    }));
  }

  function deleteActiveScale() {
    if (activeScaleIsAllNotes) {
      setStatus("All Notes is always included and cannot be deleted.");
      return;
    }
    if (activeBundle.scales.length <= 1) {
      setStatus("Keep at least one scale in the bundle");
      return;
    }
    updateActiveBundle((bundle) => {
      const scales = bundle.scales.filter((scale) => scale.objectIdHex !== activeScale.objectIdHex);
      return {
        ...bundle,
        scales,
        activeScaleIdHex: scales[0].objectIdHex
      };
    });
  }

  function commitIncludedDegrees(text: string) {
    if (activeScaleIsAllNotes) {
      setIncludedDegreesDraft(formatIntegerList(createAllNotesScale(tuningCycleLength(activeBundle.tuning)).includedDegrees));
      setIncludedDegreesError("");
      return;
    }
    const cycleLength = tuningCycleLength(activeBundle.tuning);
    const result = validateIncludedDegreesInput(text, cycleLength);
    if ("error" in result) {
      setIncludedDegreesError(result.error);
      setStatus(result.error);
      return;
    }
    setIncludedDegreesError("");
    setIncludedDegreesDraft(formatIntegerList(result.degrees));
    updateActiveScale((scale) => ({
      ...scale,
      includedDegrees: result.degrees
    }));
  }

  function commitKeyLabels(text: string) {
    if (activeBundle.tuning.kind === "scala") {
      return;
    }
    const cycleLength = tuningCycleLength(activeBundle.tuning);
    const result = validateKeyLabelsInput(text, cycleLength);
    if ("error" in result) {
      setKeyLabelsError(result.error);
      setStatus(result.error);
      return;
    }
    setKeyLabelsError("");
    setKeyLabelsDraft(formatLabelList(result.labels));
    if (activeBundle.tuning.kind === "edo") {
      updateEdoTuning({ keyLabels: result.labels });
    } else {
      updateEqualStepTuning({ keyLabels: result.labels });
    }
  }

  function commitIncludedDegreesIfLeaving(target: EventTarget | null) {
    const labelsInput = keyLabelsInputRef.current;
    if (labelsInput && typeof document !== "undefined" && document.activeElement === labelsInput && target !== labelsInput) {
      commitKeyLabels(labelsInput.value);
    }

    const input = includedDegreesInputRef.current;
    if (!input || typeof document === "undefined" || document.activeElement !== input || target === input) {
      return;
    }
    commitIncludedDegrees(input.value);
  }

  function commitKeyLabelsOnKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === "Tab") {
      commitKeyLabels(event.currentTarget.value);
    }
  }

  function commitIncludedDegreesOnKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === "Tab") {
      commitIncludedDegrees(event.currentTarget.value);
    }
  }

  function updateEdoTuning(patch: Partial<Extract<LayoutBundleTuning, { kind: "edo" }>>) {
    updateActiveBundle((bundle) => {
      const current = bundle.tuning.kind === "edo" ? bundle.tuning : {
        kind: "edo" as const,
        name: bundle.tuning.name,
        edoDivisions: tuningCycleLength(bundle.tuning),
        periodCents: tuningPeriodCents(bundle.tuning),
        cycleLength: tuningCycleLength(bundle.tuning),
        referenceMidiNote: bundle.tuning.referenceMidiNote,
        referenceHz: bundle.tuning.referenceHz,
        keyLabels: bundle.tuning.kind === "scala" ? defaultKeyLabels(tuningCycleLength(bundle.tuning)) : bundle.tuning.keyLabels
      };
      const tuning = {
        ...current,
        ...patch
      };
      tuning.edoDivisions = clampInteger(tuning.edoDivisions, 1, 255);
      tuning.cycleLength = tuning.edoDivisions;
      tuning.keyLabels = normalizeKeyLabels(tuning.keyLabels, tuning.cycleLength);
      tuning.referenceHz = Number.isFinite(tuning.referenceHz) && tuning.referenceHz > 0 ? tuning.referenceHz : 440;
      return withCycleColors({ ...bundle, tuning }, tuning.cycleLength);
    });
  }

  function updateEqualStepTuning(patch: Partial<Extract<LayoutBundleTuning, { kind: "equal-step" }>>) {
    updateActiveBundle((bundle) => {
      const current = bundle.tuning.kind === "equal-step" ? bundle.tuning : {
        kind: "equal-step" as const,
        name: bundle.tuning.name,
        stepCents: bundle.tuning.kind === "edo"
          ? bundle.tuning.periodCents / bundle.tuning.edoDivisions
          : tuningPeriodCents(bundle.tuning) / tuningCycleLength(bundle.tuning),
        cycleLength: tuningCycleLength(bundle.tuning),
        referenceMidiNote: bundle.tuning.referenceMidiNote,
        referenceHz: bundle.tuning.referenceHz,
        keyLabels: bundle.tuning.kind === "scala" ? defaultKeyLabels(tuningCycleLength(bundle.tuning)) : bundle.tuning.keyLabels
      };
      const tuning = {
        ...current,
        ...patch
      };
      tuning.cycleLength = clampInteger(tuning.cycleLength, 1, 255);
      tuning.keyLabels = normalizeKeyLabels(tuning.keyLabels, tuning.cycleLength);
      tuning.referenceHz = Number.isFinite(tuning.referenceHz) && tuning.referenceHz > 0 ? tuning.referenceHz : 440;
      return withCycleColors({ ...bundle, tuning }, tuning.cycleLength);
    });
  }

  function updateScalaTuning(patch: Partial<Extract<LayoutBundleTuning, { kind: "scala" }>>) {
    updateActiveBundle((bundle) => {
      const current = bundle.tuning.kind === "scala" ? bundle.tuning : {
        kind: "scala" as const,
        name: bundle.tuning.name,
        description: bundle.tuning.name,
        cents: [1200],
        periodCents: 1200,
        cycleLength: 1,
        referenceMidiNote: bundle.tuning.referenceMidiNote,
        referenceHz: bundle.tuning.referenceHz
      };
      const tuning = {
        ...current,
        ...patch
      };
      tuning.periodCents = tuning.cents[tuning.cents.length - 1] ?? 1200;
      tuning.cycleLength = clampInteger(tuning.cents.length, 1, 255);
      return withCycleColors({ ...bundle, tuning }, tuning.cycleLength);
    });
  }

  function setTuningKind(kind: LayoutBundleTuning["kind"]) {
    if (kind === "edo") {
      updateEdoTuning({});
    } else if (kind === "equal-step") {
      updateEqualStepTuning({});
    } else {
      updateScalaTuning({});
    }
  }

  function updateDegreeColor(degree: number, patch: Partial<ScaleDegreeColor>) {
    updateActiveBundle((bundle) => ({
      ...bundle,
      palette: {
        ...bundle.palette,
        degreeColors: normalizeScaleDegreeColors(bundle.palette.degreeColors, tuningCycleLength(bundle.tuning)).map((color) =>
          color.degree === degree ? clampScaleDegreeColor({ ...color, ...patch }) : color
        )
      }
    }));
  }

  function updateButtonOverride(buttonIndex: number, patch: Partial<LayoutBundleButtonOverride>) {
    updateActiveLayout((layout) => ({
      ...layout,
      buttonOverrides: upsertOverride(layout.buttonOverrides, buttonIndex, patch)
    }));
  }

  function paintButtonColorOverride(buttonIndex: number) {
    if (lastPaintedButtonRef.current === buttonIndex) {
      return;
    }
    lastPaintedButtonRef.current = buttonIndex;
    updateButtonOverride(buttonIndex, {
      hueTenthDegrees: paintbrushColor.hueTenthDegrees,
      saturation: paintbrushColor.saturation,
      value: paintbrushColor.value
    });
    setStatus(`Painted button ${buttonIndex}`);
  }

  function pickBrushColor(buttonIndex: number) {
    const preview = previewKeys.find((item) => item.key.index === buttonIndex);
    if (!preview) {
      return;
    }
    setPaintbrushColor(preview.color);
    setSelectedButton(buttonIndex);
    setPaintTool("brush");
    setStatus(`Picked color from button ${buttonIndex}`);
  }

  function previewButtonIndexFromPointer(event: PointerEvent<HTMLElement>): number | undefined {
    if (typeof document === "undefined") {
      return undefined;
    }
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const button = target?.closest("[data-preview-button-index]") as HTMLElement | null;
    const buttonIndex = Number(button?.dataset.previewButtonIndex);
    return Number.isInteger(buttonIndex) ? buttonIndex : undefined;
  }

  function beginPaintStroke(event: PointerEvent<HTMLDivElement>) {
    if (!paintbrushMode) {
      return;
    }
    const buttonIndex = previewButtonIndexFromPointer(event);
    if (buttonIndex === undefined) {
      return;
    }
    event.preventDefault();
    if (paintTool === "eyedropper") {
      pickBrushColor(buttonIndex);
      return;
    }
    paintStrokeActiveRef.current = true;
    lastPaintedButtonRef.current = null;
    paintButtonColorOverride(buttonIndex);
  }

  function continuePaintStroke(event: PointerEvent<HTMLDivElement>) {
    if (!paintbrushMode || paintTool === "eyedropper" || !paintStrokeActiveRef.current) {
      return;
    }
    const buttonIndex = previewButtonIndexFromPointer(event);
    if (buttonIndex !== undefined) {
      paintButtonColorOverride(buttonIndex);
    }
  }

  function endPaintStroke() {
    paintStrokeActiveRef.current = false;
    lastPaintedButtonRef.current = null;
  }

  function resetButtonOverride(buttonIndex: number) {
    updateActiveLayout((layout) => ({
      ...layout,
      buttonOverrides: layout.buttonOverrides.filter((override) => override.buttonIndex !== buttonIndex)
    }));
  }

  function clearButtonColor(buttonIndex: number) {
    updateActiveLayout((layout) => {
      const override = layout.buttonOverrides.find((candidate) => candidate.buttonIndex === buttonIndex);
      if (!override) {
        return layout;
      }
      const withoutColor = removeOverrideColor(override);
      const shouldRemove = isRoleDefault(buttonIndex, withoutColor.role) && withoutColor.stepsFromC === undefined;
      return {
        ...layout,
        buttonOverrides: shouldRemove
          ? layout.buttonOverrides.filter((candidate) => candidate.buttonIndex !== buttonIndex)
          : layout.buttonOverrides.map((candidate) => candidate.buttonIndex === buttonIndex ? withoutColor : candidate)
      };
    });
  }

  function clearButtonNote(buttonIndex: number) {
    updateActiveLayout((layout) => {
      const override = layout.buttonOverrides.find((candidate) => candidate.buttonIndex === buttonIndex);
      if (!override) {
        return layout;
      }
      const { stepsFromC, ...withoutNote } = override;
      void stepsFromC;
      const shouldRemove = isRoleDefault(buttonIndex, withoutNote.role) && withoutNote.hueTenthDegrees === undefined;
      return {
        ...layout,
        buttonOverrides: shouldRemove
          ? layout.buttonOverrides.filter((candidate) => candidate.buttonIndex !== buttonIndex)
          : layout.buttonOverrides.map((candidate) => candidate.buttonIndex === buttonIndex ? withoutNote : candidate)
      };
    });
  }

  async function importBundleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      const imported = sanitizeEditorBundle(parseLayoutBundleFile(JSON.parse(await file.text())));
      const nextBundles = [...bundles.filter((bundle) => bundle.objectIdHex !== imported.objectIdHex), imported];
      setBundlesAndPersist(nextBundles);
      setActiveBundleId(imported.objectIdHex);
      setSelectedButton(noteButtonIndexOrFallback(imported.layouts.find((layout) => layout.objectIdHex === imported.activeLayoutIdHex)?.centerButton ?? imported.layouts[0]?.centerButton ?? 65, 65));
      setStatus(`Imported ${imported.name}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to import layout bundle");
    } finally {
      event.target.value = "";
    }
  }

  async function importScalaFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      const parsed = parseScalaScale(await file.text());
      updateActiveBundle((bundle) => withCycleColors({
        ...bundle,
        tuning: {
          kind: "scala",
          name: fileBaseName(file.name),
          description: parsed.description,
          cents: parsed.cents,
          periodCents: parsed.periodCents,
          cycleLength: parsed.count,
          referenceMidiNote: bundle.tuning.referenceMidiNote,
          referenceHz: bundle.tuning.referenceHz
        }
      }, parsed.count));
      setStatus(`Imported Scala tuning ${file.name}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to import Scala tuning");
    } finally {
      event.target.value = "";
    }
  }

  const previewKeys = useMemo<PreviewKey[]>(() => {
    const cycleLength = tuningCycleLength(activeBundle.tuning);
    const scaleDegrees = new Set(normalizeScaleDegrees(activeScale.includedDegrees, cycleLength));
    return hexBoardGeometry.filter((key) => key.role === "note").map((key) => {
      const override = activeLayout.buttonOverrides.find((candidate) => candidate.buttonIndex === key.index);
      const role = override?.role === "unused" ? "unused" : "note";
      const generatedStepsFromC = Math.round(computeVectorLayoutSteps(key, activeLayout));
      const stepsFromC = override?.stepsFromC ?? generatedStepsFromC;
      const resolvedColor = resolveLayoutBundleButtonColor({
        degreeColors: activeBundle.palette.degreeColors,
        cycleLength,
        stepsFromC,
        override
      });
      return {
        key,
        role,
        generatedStepsFromC,
        stepsFromC,
        degree: resolvedColor.degree,
        inScale: role !== "note" || scaleDegrees.has(resolvedColor.degree),
        color: resolvedColor.color,
        colorSource: resolvedColor.colorSource,
        noteSource: override?.stepsFromC === undefined ? "generated" : "button",
        override
      };
    });
  }, [activeBundle, activeLayout, activeScale]);

  const selectedPreview = previewKeys.find((item) => item.key.index === selectedButton) ?? previewKeys[0];
  const selectedDegreeColor = normalizeScaleDegreeColors(activeBundle.palette.degreeColors, tuningCycleLength(activeBundle.tuning))
    .find((color) => color.degree === selectedPreview.degree) ?? createDefaultDegreeColors(1)[0];
  const axisLabels = layoutAxisLabels(activeLayout.rotationSteps);
  const centerGuideKey = hexBoardGeometry.find((key) => key.index === activeLayout.centerButton);
  const guideTargetIndex = (() => {
    if (!layoutGuideFocus || !centerGuideKey) {
      return undefined;
    }
    if (layoutGuideFocus === "center") {
      return centerGuideKey.index;
    }
    if (layoutGuideFocus === "across") {
      return hexBoardKeyAtCoord(centerGuideKey.coordRow, centerGuideKey.coordCol + 2)?.index;
    }
    return hexBoardKeyAtCoord(centerGuideKey.coordRow - 1, centerGuideKey.coordCol + 1)?.index;
  })();
  const guideOriginIndex = layoutGuideFocus === "across" || layoutGuideFocus === "upRight"
    ? centerGuideKey?.index
    : undefined;
  const guideHalos = useMemo<GuideHalo[]>(() => {
    const halos: GuideHalo[] = [];
    if (guideTargetIndex !== undefined) {
      const target = hexBoardGeometry.find((key) => key.index === guideTargetIndex && key.role === "note");
      if (target) {
        halos.push({ key: target, tone: "green" });
      }
    }
    if (guideOriginIndex !== undefined) {
      const origin = hexBoardGeometry.find((key) => key.index === guideOriginIndex && key.role === "note");
      if (origin) {
        halos.push({ key: origin, tone: "red" });
      }
    }
    return halos;
  }, [guideOriginIndex, guideTargetIndex]);
  function layoutGuideProps(field: LayoutGuideFocus) {
    return {
      onFocus: () => setLayoutGuideFocus(field),
      onBlur: () => setLayoutGuideFocus((current) => current === field ? null : current)
    };
  }
  function setSelectedColorSource(colorSource: PreviewKey["colorSource"]) {
    if (colorSource === "degree") {
      clearButtonColor(selectedPreview.key.index);
      return;
    }
    updateButtonOverride(selectedPreview.key.index, {
      hueTenthDegrees: selectedPreview.color.hueTenthDegrees,
      saturation: selectedPreview.color.saturation,
      value: selectedPreview.color.value
    });
  }
  function setSelectedNoteSource(noteSource: PreviewKey["noteSource"]) {
    if (noteSource === "generated") {
      clearButtonNote(selectedPreview.key.index);
      return;
    }
    updateButtonOverride(selectedPreview.key.index, {
      stepsFromC: selectedPreview.stepsFromC
    });
  }
  const encodedBundle = useMemo(() => {
    return encodeLayoutBundle(bundleForDeviceEncoding(activeBundle));
  }, [activeBundle]);
  const activeApplyObjects = useMemo(() => {
    const activeLayoutObject = encodedBundle.layouts.find((object) => objectIdToHex(object.objectId) === activeLayout.objectIdHex);
    const activeScaleObject = encodedBundle.scales.find((object) => objectIdToHex(object.objectId) === activeScale.objectIdHex);
    const explicitMaps = encodedBundle.explicitButtonMaps.filter((object) =>
      object.records.some((record) =>
        record.tag === ExplicitButtonMapTlv.LayoutRef
        && objectReferenceIdHex(record.value) === activeLayout.objectIdHex
      )
    );
    return [
      encodedBundle.tuning,
      activeLayoutObject,
      activeScaleObject,
      encodedBundle.scaleColorMap,
      ...explicitMaps
    ].filter((object): object is EncodedCatalogObject => Boolean(object));
  }, [activeLayout.objectIdHex, activeScale.objectIdHex, encodedBundle]);
  const liveSendKey = useMemo(() => activeApplyObjects
    .map((object) => `${object.objectType}:${objectIdToHex(object.objectId)}:${crc32(object.body).toString(16)}`)
    .join("|"), [activeApplyObjects]);
  const encodedPreview = encodedBundle.objects
    .map((object) => `${object.name}: ${formatByteLength(object.body)} CRC ${crc32(object.body).toString(16).toUpperCase()}`)
    .join("\n");

  async function findDeviceGeometryObject(object: EncodedCatalogObject) {
    const records = await client.listGeometryObjects(object.objectType, 4);
    const objectIdHex = objectIdToHex(object.objectId);
    return records.find((record) => objectIdToHex(record.objectId) === objectIdHex);
  }

  async function readDeviceGeometryObject(record: ObjectListRecord): Promise<DeviceGeometryObject> {
    const body = await client.readGeometryObject(record.objectType, record.handle);
    const decoded = decodeObjectBody(body);
    const bodyObjectId = tlvValue(decoded.records, CommonTlv.ObjectId);
    return {
      record: {
        ...record,
        objectId: bodyObjectId?.length === 16 ? bodyObjectId : record.objectId,
        name: tlvText(decoded.records, CommonTlv.Name, record.name),
        folderPath: decodeDeviceFolderPath(tlvText(decoded.records, CommonTlv.FolderPath, record.folderPath || rootFolderPath))
      },
      body,
      records: decoded.records
    };
  }

  async function readDeviceGeometryObjects(objectType: number): Promise<DeviceGeometryObject[]> {
    const records = await client.listGeometryObjects(objectType, 8);
    const objects: DeviceGeometryObject[] = [];
    for (const record of records) {
      objects.push(await readDeviceGeometryObject(record));
    }
    return objects;
  }

  async function readHexBoardGeometryBundle(entry: HexBoardGeometryBundleEntry): Promise<{
    bundle: LayoutBundle;
    objects: DeviceGeometryObject[];
  }> {
    const tuningRecord: ObjectListRecord = {
      objectType: ObjectType.UserTuning,
      handle: entry.deviceHandle,
      flags: entry.readOnly ? ObjectListFlag.ReadOnly : 0,
      schemaMajor: entry.schemaMajor,
      schemaMinor: entry.schemaMinor,
      objectId: new Uint8Array(),
      name: entry.name,
      folderPath: entry.folderPath
    };
    const tuningObject = await readDeviceGeometryObject(tuningRecord);
    const tuningObjectIdHex = objectIdToHex(tuningObject.record.objectId);
    const layoutObjects = await readDeviceGeometryObjects(ObjectType.UserLayout);
    const scaleObjects = await readDeviceGeometryObjects(ObjectType.UserScale);
    const colorMapObjects = await readDeviceGeometryObjects(ObjectType.ScaleColorMap);
    const buttonMapObjects = await readDeviceGeometryObjects(ObjectType.ExplicitButtonMap);
    const linkedLayouts = layoutObjects.filter((object) => objectReferences(object, LayoutTlv.TuningRef, ObjectType.UserTuning, tuningObjectIdHex));
    const linkedScales = scaleObjects.filter((object) => objectReferences(object, UserScaleTlv.TuningRef, ObjectType.UserTuning, tuningObjectIdHex));
    const linkedColorMap = colorMapObjects.find((object) => objectReferences(object, ScaleColorMapTlv.TuningRef, ObjectType.UserTuning, tuningObjectIdHex));
    const linkedLayoutIds = new Set(linkedLayouts.map((object) => objectIdToHex(object.record.objectId)));
    const linkedButtonMaps = buttonMapObjects.filter((object) =>
      objectReferences(object, ExplicitButtonMapTlv.TuningRef, ObjectType.UserTuning, tuningObjectIdHex)
      || [...linkedLayoutIds].some((layoutIdHex) => objectReferences(object, ExplicitButtonMapTlv.LayoutRef, ObjectType.UserLayout, layoutIdHex))
    );
    const tuning = decodeDeviceTuning(entry, tuningObject);
    const cycleLength = tuningCycleLength(tuning);
    const layouts = linkedLayouts.length > 0
      ? linkedLayouts.map((layout, index) => {
          const layoutIdHex = objectIdToHex(layout.record.objectId);
          const buttonMap = linkedButtonMaps.find((map) => objectReferences(map, ExplicitButtonMapTlv.LayoutRef, ObjectType.UserLayout, layoutIdHex))
            ?? linkedButtonMaps.find((map) => objectReferences(map, ExplicitButtonMapTlv.TuningRef, ObjectType.UserTuning, tuningObjectIdHex));
          return decodeDeviceLayout(layout, index, buttonMap);
        })
      : [createDefaultLayout(cycleLength)];
    const scales = linkedScales.map((scale, index) => decodeDeviceScale(scale, index, cycleLength));
    const bundle = sanitizeEditorBundle({
      objectIdHex: objectIdToHex(deterministicObjectId(`device-geometry:${tuningObjectIdHex}`)),
      name: entry.name,
      folderPath: entry.folderPath,
      tuning,
      palette: {
        degreeColors: decodeDeviceColorMap(linkedColorMap, cycleLength)
      },
      layouts,
      activeLayoutIdHex: layouts[0].objectIdHex,
      scales,
      activeScaleIdHex: scales[0]?.objectIdHex ?? createAllNotesScale(cycleLength).objectIdHex
    });
    return {
      bundle,
      objects: [
        tuningObject,
        ...linkedLayouts,
        ...linkedScales,
        ...(linkedColorMap ? [linkedColorMap] : []),
        ...linkedButtonMaps
      ]
    };
  }

  function openDeviceBundleInEditor(bundle: LayoutBundle, statusText: string) {
    const nextBundles = [...bundles.filter((candidate) => candidate.objectIdHex !== bundle.objectIdHex), bundle];
    setBundlesAndPersist(nextBundles);
    setActiveBundleId(bundle.objectIdHex);
    setSelectedButton(noteButtonIndexOrFallback(bundle.layouts.find((layout) => layout.objectIdHex === bundle.activeLayoutIdHex)?.centerButton ?? bundle.layouts[0]?.centerButton ?? 65, 65));
    setCustomFolders((current) => Array.from(new Set([...current, bundle.folderPath])).sort());
    setStatus(statusText);
  }

  async function openHexBoardGeometryBundle(entry: HexBoardGeometryBundleEntry) {
    setSyncBusy(true);
    try {
      const { bundle } = await readHexBoardGeometryBundle(entry);
      openDeviceBundleInEditor(bundle, `Opened ${bundle.name} from HexBoard`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to open HexBoard geometry bundle");
    } finally {
      setSyncBusy(false);
    }
  }

  async function downloadHexBoardGeometryBundle(entry: HexBoardGeometryBundleEntry) {
    setSyncBusy(true);
    try {
      const { bundle } = await readHexBoardGeometryBundle(entry);
      openDeviceBundleInEditor(bundle, `Downloaded ${bundle.name} to Computer Library`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to download HexBoard geometry bundle");
    } finally {
      setSyncBusy(false);
    }
  }

  async function exportHexBoardGeometryBundle(entry: HexBoardGeometryBundleEntry) {
    setSyncBusy(true);
    try {
      const { bundle } = await readHexBoardGeometryBundle(entry);
      downloadBundleFile(bundle);
      setStatus(`Exported ${bundle.name} from HexBoard`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to export HexBoard geometry bundle");
    } finally {
      setSyncBusy(false);
    }
  }

  async function eraseHexBoardGeometryBundle(entry: HexBoardGeometryBundleEntry) {
    setSyncBusy(true);
    try {
      const { bundle, objects } = await readHexBoardGeometryBundle(entry);
      const uniqueObjects = [...new Map(objects.map((object) => [`${object.record.objectType}:${object.record.handle}`, object])).values()]
        .sort((left, right) => right.record.handle - left.record.handle);
      for (const object of uniqueObjects) {
        await client.deleteGeometryObject(object.record.objectType, object.record.handle);
      }
      await refreshHexBoardGeometryLibrary(`Erased ${bundle.name} from HexBoard`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to erase HexBoard geometry bundle");
    } finally {
      setSyncBusy(false);
    }
  }

  async function refreshHexBoardGeometryLibrary(successStatus = "Refreshed HexBoard Geometry Library") {
    if (transport instanceof MockMidiTransport) {
      setStatus("Connect HexBoard before refreshing geometry library.");
      return;
    }
    setSyncBusy(true);
    try {
      setStatus("Requesting HexBoard Geometry Library...");
      const records = await client.listGeometryObjects(ObjectType.UserTuning, 8);
      const entries = records
        .map(hexBoardGeometryEntryFromRecord)
        .sort((left, right) => `${left.folderPath}/${left.name}`.localeCompare(`${right.folderPath}/${right.name}`));
      setHexboardBundles(entries);
      setCustomFolders((current) => Array.from(new Set([...current, ...entries.map((entry) => entry.folderPath)])).sort());
      setStatus(successStatus);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to refresh HexBoard Geometry Library");
    } finally {
      setSyncBusy(false);
    }
  }

  async function saveBundleToHexBoard(bundle: LayoutBundle, prefix = "Saved") {
    if (transport instanceof MockMidiTransport) {
      setStatus("Connect HexBoard before saving geometry objects.");
      return;
    }
    const sanitizedBundle = sanitizeEditorBundle(bundle);
    if (sanitizedBundle.objectIdHex !== activeBundle.objectIdHex) {
      setActiveBundleId(sanitizedBundle.objectIdHex);
    }
    const encoded = sanitizedBundle.objectIdHex === activeBundle.objectIdHex
      ? encodedBundle
      : encodeLayoutBundle(bundleForDeviceEncoding(sanitizedBundle));
    setSyncBusy(true);
    try {
      for (let index = 0; index < encoded.objects.length; index += 1) {
        const object = encoded.objects[index];
        setStatus(`Saving ${object.name} (${index + 1}/${encoded.objects.length})`);
        await client.sendGeometryObjectSaveConfirmed(object);
      }
      setCustomFolders((current) => Array.from(new Set([...current, sanitizedBundle.folderPath])).sort());
      await refreshHexBoardGeometryLibrary(`${prefix} ${sanitizedBundle.name} to HexBoard in ${folderLabel(sanitizedBundle.folderPath)}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to save geometry objects");
    } finally {
      setSyncBusy(false);
    }
  }

  async function saveActiveBundleToHexBoard() {
    await saveBundleToHexBoard(activeBundle);
  }

  async function sendActiveBundlePreview(prefix = "Sent") {
    if (transport instanceof MockMidiTransport) {
      setStatus("Connect HexBoard before live-sending geometry objects.");
      return;
    }
    if (activeBundle.tuning.kind === "scala") {
      setStatus("Scala bundles can be saved and verified, but live send needs firmware cents-table tuning support.");
      return;
    }
    setSyncBusy(true);
    try {
      for (let index = 0; index < activeApplyObjects.length; index += 1) {
        const object = activeApplyObjects[index];
        setStatus(`${prefix} ${object.name} (${index + 1}/${activeApplyObjects.length})`);
        await client.sendGeometryObjectPreviewConfirmed(object);
      }
      setStatus(`${prefix} ${activeBundle.name} to HexBoard runtime`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to live-send geometry objects");
    } finally {
      setSyncBusy(false);
    }
  }

  useEffect(() => {
    if (!liveSend || syncBusy || transport instanceof MockMidiTransport || activeBundle.tuning.kind === "scala") {
      return;
    }
    if (skipNextLiveSendRef.current) {
      skipNextLiveSendRef.current = false;
      return;
    }
    const timeout = window.setTimeout(() => {
      void sendActiveBundlePreview("Auto-sent");
    }, 450);
    return () => window.clearTimeout(timeout);
  }, [activeBundle.tuning.kind, liveSend, liveSendKey, transport]);

  async function verifyActiveBundleOnHexBoard() {
    if (transport instanceof MockMidiTransport) {
      setStatus("Connect HexBoard before verifying geometry objects.");
      return;
    }
    setSyncBusy(true);
    try {
      for (let index = 0; index < encodedBundle.objects.length; index += 1) {
        const object = encodedBundle.objects[index];
        setStatus(`Verifying ${object.name} (${index + 1}/${encodedBundle.objects.length})`);
        const record = await findDeviceGeometryObject(object);
        if (!record) {
          throw new Error(`Missing ${object.name} on HexBoard`);
        }
        const body = await client.readGeometryObject(object.objectType, record.handle);
        if (!bytesEqual(body, object.body)) {
          throw new Error(`HexBoard copy of ${object.name} does not match`);
        }
      }
      setStatus(`Verified ${encodedBundle.objects.length} geometry objects on HexBoard`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to verify geometry objects");
    } finally {
      setSyncBusy(false);
    }
  }

  return (
    <section className="layoutEditorWorkspace" onPointerDownCapture={(event) => commitIncludedDegreesIfLeaving(event.target)}>
      <aside className="panel stack layoutEditorSidebar">
        <div className="row between">
          <h2>Geometry Bundles</h2>
          <span className="countBadge">{bundles.length}</span>
        </div>
        <div className="sidebarTabs bundleManagerTabs" role="tablist" aria-label="Geometry bundle tools">
          <button
            aria-selected={activeSidebarTab === "library"}
            className={activeSidebarTab === "library" ? "active" : ""}
            onClick={() => setActiveSidebarTab("library")}
            role="tab"
            type="button"
          >
            File Manager
          </button>
          <button
            aria-selected={activeSidebarTab === "editor"}
            className={activeSidebarTab === "editor" ? "active" : ""}
            onClick={() => setActiveSidebarTab("editor")}
            role="tab"
            type="button"
          >
            Editor
          </button>
        </div>
        <input ref={bundleInputRef} className="hiddenFileInput" type="file" accept="application/json,.json" onChange={(event) => void importBundleFile(event)} />
        <input ref={scalaInputRef} className="hiddenFileInput" type="file" accept=".scl,text/plain" onChange={(event) => void importScalaFile(event)} />

        {activeSidebarTab === "library" ? (
          <>
            <div className="row">
              <button type="button" onClick={addNewBundle}>New</button>
              <button type="button" onClick={() => downloadBundleFile(activeBundle)}>
                Export
              </button>
              <button type="button" onClick={() => bundleInputRef.current?.click()}>Import</button>
              <button disabled={syncBusy} type="button" onClick={() => void refreshHexBoardGeometryLibrary()}>
                Refresh HexBoard
              </button>
            </div>
            <div className="row">
              <input
                aria-label="New geometry folder"
                placeholder="New folder"
                value={newFolder}
                onChange={(event) => setNewFolder(event.target.value)}
              />
              <button type="button" onClick={addFolder}>
                Add
              </button>
            </div>
            <div className="row">
              <button disabled={syncBusy} type="button" onClick={() => void verifyActiveBundleOnHexBoard()}>
                Verify
              </button>
            </div>

            <div className="librarySpaces">
              <GeometryLibrarySpacePanel
                title="Computer Library"
                subtitle="Browser-saved geometry bundles"
                space="computer"
                bundles={bundles}
                folders={allFolders}
                selectedFolder={folderFilters.computer}
                activeBundleId={activeBundle.objectIdHex}
                onFolderSelect={toggleFolderFilter}
                onOpen={openBundle}
                onUpload={(bundle) => void saveBundleToHexBoard(bundle)}
                onExport={downloadBundleFile}
                onErase={deleteBundle}
              />
              <HexBoardGeometryLibraryPanel
                entries={hexboardBundles}
                folders={allFolders}
                selectedFolder={folderFilters.hexboard}
                onFolderSelect={toggleFolderFilter}
                onOpen={(entry) => void openHexBoardGeometryBundle(entry)}
                onDownload={(entry) => void downloadHexBoardGeometryBundle(entry)}
                onExport={(entry) => void exportHexBoardGeometryBundle(entry)}
                onErase={(entry) => void eraseHexBoardGeometryBundle(entry)}
              />
            </div>
          </>
        ) : null}

        {activeSidebarTab === "editor" ? (
          <>
            <div className="row">
              <label className="checkField">
                <input
                  checked={liveSend}
                  type="checkbox"
                  onChange={(event) => {
                    skipNextLiveSendRef.current = true;
                    setLiveSend(event.target.checked);
                  }}
                />
                <span>Live send</span>
              </label>
              <button className="primary" disabled={syncBusy} type="button" onClick={() => void sendActiveBundlePreview("Sent")}>
                Send Now
              </button>
              <button type="button" onClick={() => saveActiveBundleToComputer()}>
                Save to Computer
              </button>
              <button disabled={syncBusy} type="button" onClick={() => void saveActiveBundleToHexBoard()}>
                Save to HexBoard
              </button>
            </div>
            <label className="field">
              <span>Bundle name</span>
              <input value={activeBundle.name} onChange={(event) => updateBundleName(event.target.value)} />
            </label>
            <label className="field">
              <span>Folder</span>
              <select value={normalizeDisplayFolderPath(activeBundle.folderPath)} onChange={(event) => updateBundleFolder(event.target.value)}>
                {allFolders.map((folder) => (
                  <option key={folder} value={folder}>
                    {folderLabel(folder)}
                  </option>
                ))}
              </select>
            </label>
            <button className="warning" type="button" onClick={deleteActiveBundle}>Delete Bundle</button>

            <div className="sidebarTabs" role="tablist" aria-label="Geometry bundle sections">
              <button
                aria-selected={activeEditorTab === "tuning"}
                className={activeEditorTab === "tuning" ? "active" : ""}
                onClick={() => setActiveEditorTab("tuning")}
                role="tab"
                type="button"
              >
                Tuning
              </button>
              <button
                aria-selected={activeEditorTab === "layouts"}
                className={activeEditorTab === "layouts" ? "active" : ""}
                onClick={() => setActiveEditorTab("layouts")}
                role="tab"
                type="button"
              >
                Layouts
              </button>
              <button
                aria-selected={activeEditorTab === "scales"}
                className={activeEditorTab === "scales" ? "active" : ""}
                onClick={() => setActiveEditorTab("scales")}
                role="tab"
                type="button"
              >
                Scales
              </button>
            </div>
          </>
        ) : null}

        {activeSidebarTab === "editor" && activeEditorTab === "tuning" ? (
          <section className="editorSection">
            <h3>Tuning</h3>
            <label className="field">
              <span>Type</span>
              <select value={activeBundle.tuning.kind} onChange={(event) => setTuningKind(event.target.value as LayoutBundleTuning["kind"])}>
                <option value="edo">EDO</option>
                <option value="equal-step">Cents per step</option>
                <option value="scala">Scala .scl</option>
              </select>
            </label>
            <TuningControls
              tuning={activeBundle.tuning}
              onEdoChange={updateEdoTuning}
              onEqualStepChange={updateEqualStepTuning}
              onScalaChange={updateScalaTuning}
              onImportScala={() => scalaInputRef.current?.click()}
              keyLabelsDraft={keyLabelsDraft}
              keyLabelsError={keyLabelsError}
              keyLabelsInputRef={keyLabelsInputRef}
              onKeyLabelsBlur={commitKeyLabels}
              onKeyLabelsChange={(text) => {
                setKeyLabelsDraft(text);
                setKeyLabelsError("");
              }}
              onKeyLabelsKeyDown={commitKeyLabelsOnKey}
            />
          </section>
        ) : null}

        {activeSidebarTab === "editor" && activeEditorTab === "layouts" ? (
          <section className="editorSection">
            <h3>Layouts</h3>
            <div className="fieldGrid">
              <label className="field">
                <span>Active layout</span>
                <select value={activeLayout.objectIdHex} onChange={(event) => setActiveLayoutId(event.target.value)}>
                  {activeBundle.layouts.map((layout) => (
                    <option value={layout.objectIdHex} key={layout.objectIdHex}>{layout.name}</option>
                  ))}
                </select>
              </label>
              <div className="row">
                <button type="button" onClick={addNewLayout}>New Layout</button>
                <button className="warning" type="button" onClick={deleteActiveLayout}>Delete Layout</button>
              </div>
              <label className="field">
                <span>Layout name</span>
                <input value={activeLayout.name} onChange={(event) => updateLayout({ name: event.target.value })} />
              </label>
              <label className="field">
                <span>Center key</span>
                <div className="fieldControlRow">
                  <input
                    min={0}
                    max={139}
                    type="number"
                    value={activeLayout.centerButton}
                    onChange={(event) => updateLayout({ centerButton: noteButtonIndexOrFallback(clampInteger(Number(event.target.value), 0, 139), activeLayout.centerButton) })}
                    {...layoutGuideProps("center")}
                  />
                  <button type="button" onClick={() => updateLayout({ centerButton: selectedButton })}>Use Selected</button>
                </div>
              </label>
              <label className="field">
                <span>{axisLabels.across}</span>
                <input
                  type="number"
                  value={activeLayout.acrossSteps}
                  onChange={(event) => updateLayout({ acrossSteps: Number(event.target.value) })}
                  {...layoutGuideProps("across")}
                />
              </label>
              <label className="field">
                <span>{axisLabels.upRight}</span>
                <input
                  type="number"
                  value={activeLayout.upRightSteps}
                  onChange={(event) => updateLayout({ upRightSteps: Number(event.target.value) })}
                  {...layoutGuideProps("upRight")}
                />
              </label>
              <label className="field">
                <span>Rotation</span>
                <select value={activeLayout.rotationSteps} onChange={(event) => updateLayout({ rotationSteps: Number(event.target.value) })}>
                  <option value={0}>0°</option>
                  <option value={1}>90°</option>
                  <option value={2}>180°</option>
                  <option value={3}>270°</option>
                </select>
              </label>
            </div>
          </section>
        ) : null}

        {activeSidebarTab === "editor" && activeEditorTab === "scales" ? (
          <section className="editorSection">
            <h3>Scales</h3>
            <div className="fieldGrid">
              <label className="field">
                <span>Active scale</span>
                <select
                  value={activeScale.objectIdHex}
                  onChange={(event) => updateActiveBundle((bundle) => ({ ...bundle, activeScaleIdHex: event.target.value }))}
                >
                  {activeBundle.scales.map((scale) => (
                    <option value={scale.objectIdHex} key={scale.objectIdHex}>{scale.name}</option>
                  ))}
                </select>
              </label>
              <div className="row">
                <button type="button" onClick={addNewScale}>New Scale</button>
                <button className="warning" disabled={activeScaleIsAllNotes} type="button" onClick={deleteActiveScale}>Delete Scale</button>
              </div>
              <label className="field">
                <span>Scale name</span>
                <input
                  disabled={activeScaleIsAllNotes}
                  value={activeScale.name}
                  onChange={(event) => updateActiveScale((scale) => ({ ...scale, name: event.target.value }))}
                />
              </label>
              <label className={includedDegreesError ? "field invalidField" : "field"}>
                <span>Included degrees</span>
                <input
                  aria-invalid={includedDegreesError ? "true" : "false"}
                  disabled={activeScaleIsAllNotes}
                  onBlurCapture={(event) => commitIncludedDegrees(event.target.value)}
                  onChange={(event) => {
                    setIncludedDegreesDraft(event.target.value);
                    setIncludedDegreesError("");
                  }}
                  onKeyDown={commitIncludedDegreesOnKey}
                  ref={includedDegreesInputRef}
                  value={includedDegreesDraft}
                />
                {includedDegreesError ? <small className="fieldError">{includedDegreesError}</small> : null}
              </label>
            </div>
          </section>
        ) : null}
      </aside>

      <div className="layoutEditorMainColumn">
        <main className="panel stack boardPanel">
          <div className="row between">
            <div>
              <h2>HexBoard Preview</h2>
              <span className="muted">{status}</span>
            </div>
          </div>
          <div className="brushToolbar">
            <button
              aria-pressed={paintbrushMode}
              className={paintbrushMode ? "primary" : ""}
              type="button"
              onClick={() => {
                endPaintStroke();
                setPaintbrushMode((current) => !current);
                setPaintTool("brush");
              }}
            >
              Paintbrush
            </button>
            <button
              aria-pressed={paintbrushMode && paintTool === "eyedropper"}
              className={paintbrushMode && paintTool === "eyedropper" ? "primary" : ""}
              type="button"
              onClick={() => {
                endPaintStroke();
                setPaintbrushMode(true);
                setPaintTool((current) => current === "eyedropper" ? "brush" : "eyedropper");
              }}
            >
              Eyedropper
            </button>
            <label className="brushColorField">
              <span>Brush color</span>
              <input
                aria-label="Brush color"
                type="color"
                value={scaleDegreeColorToHex(paintbrushColor)}
                onChange={(event) => setPaintbrushColor((current) => hexToScaleDegreeColor(event.target.value, current))}
              />
            </label>
          </div>
          <div className="hexBoardScroll">
            <div
              className={[
                "hexBoardSurface",
                paintbrushMode ? "paintbrushSurface" : "",
                paintbrushMode && paintTool === "eyedropper" ? "eyedropperSurface" : ""
              ].filter(Boolean).join(" ")}
              aria-label="HexBoard key layout preview"
              onPointerCancel={endPaintStroke}
              onPointerDown={beginPaintStroke}
              onPointerLeave={endPaintStroke}
              onPointerMove={continuePaintStroke}
              onPointerUp={endPaintStroke}
              style={{ transform: `rotate(${activeLayout.rotationSteps * 90}deg)` }}
            >
              {guideHalos.map((halo) => (
                <div
                  aria-hidden="true"
                  className={`hexGuideHalo ${halo.tone === "red" ? "redGuideHalo" : "greenGuideHalo"}`}
                  key={`${halo.tone}-${halo.key.index}`}
                  style={{
                    left: `${previewHexInset + (halo.key.coordCol * previewHexHalfStepX)}px`,
                    top: `${previewHexInset + (halo.key.row * previewHexRowStepY)}px`
                  }}
                />
              ))}
              {previewKeys.map((item) => (
                <button
                  aria-label={`Button ${item.key.index}, ${item.role}, step ${item.stepsFromC}`}
                  className={[
                    "hexKey",
                    item.role === "unused" ? "unusedKey" : "",
                    !item.inScale ? "outOfScaleKey" : "",
                    item.colorSource === "button" ? "manualColorKey" : "",
                    item.noteSource === "button" ? "manualNoteKey" : "",
                    item.key.index === selectedButton ? "selectedKey" : "",
                    item.key.index === activeLayout.centerButton ? "centerKey" : "",
                    item.key.index === guideOriginIndex ? "guideOriginKey" : "",
                    item.key.index === guideTargetIndex ? "guideTargetKey" : ""
                  ].filter(Boolean).join(" ")}
                  data-preview-button-index={item.key.index}
                  key={item.key.index}
                  onClick={() => {
                    if (!paintbrushMode) {
                      setSelectedButton(item.key.index);
                    }
                  }}
                  style={{
                    left: `${previewHexInset + (item.key.coordCol * previewHexHalfStepX)}px`,
                    top: `${previewHexInset + (item.key.row * previewHexRowStepY)}px`,
                    backgroundColor: colorToCss(item.color)
                  }}
                  type="button"
                >
                  <span className="hexKeyLabel" style={{ transform: `rotate(${-activeLayout.rotationSteps * 90}deg)` }}>
                    <span>{item.key.index}</span>
                    <small>{item.role === "note" ? item.degree : "off"}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </main>

        <aside className="panel stack selectedKeyPanel">
          <div className="selectedKeyHeading">
            <h2>Selected Key:</h2>
            <span className="status">
              Button {selectedPreview.key.index} · row {selectedPreview.key.row} · col {selectedPreview.key.column}
            </span>
          </div>
          <div className="fieldGrid">
            <label className="field">
              <span>Role</span>
              <select value={selectedPreview.role} onChange={(event) => updateButtonOverride(selectedPreview.key.index, { role: event.target.value as LayoutBundleButtonOverride["role"] })}>
                <option value="note">Note</option>
                <option value="unused">Unused</option>
              </select>
            </label>
            <label className="field">
              <span>Generated step</span>
              <input readOnly value={selectedPreview.generatedStepsFromC} />
            </label>
            <label className="field">
              <span>Note source</span>
              <select value={selectedPreview.noteSource} onChange={(event) => setSelectedNoteSource(event.target.value as PreviewKey["noteSource"])}>
                <option value="generated">Generated layout</option>
                <option value="button">Button override</option>
              </select>
            </label>
            <label className="field">
              <span>Current step</span>
              <input
                readOnly={selectedPreview.noteSource === "generated"}
                type="number"
                value={selectedPreview.stepsFromC}
                onChange={(event) => updateButtonOverride(selectedPreview.key.index, { stepsFromC: Number(event.target.value) })}
              />
            </label>
            <label className="field">
              <span>Scale degree</span>
              <input readOnly value={selectedPreview.degree} />
            </label>
            <label className="field">
              <span>Scale membership</span>
              <input readOnly value={selectedPreview.inScale ? "In scale" : "Out of scale"} />
            </label>
            <label className="field">
              <span>Color source</span>
              <select value={selectedPreview.colorSource} onChange={(event) => setSelectedColorSource(event.target.value as PreviewKey["colorSource"])}>
                <option value="degree">Scale degree</option>
                <option value="button">Button override</option>
              </select>
            </label>
          </div>

          {selectedPreview.colorSource === "degree" ? (
            <section className="editorSection">
              <h3>Scale Degree Color</h3>
              <ColorFields
                color={selectedDegreeColor}
                onChange={(patch) => updateDegreeColor(selectedPreview.degree, patch)}
              />
            </section>
          ) : (
            <section className="editorSection">
              <h3>Button Override</h3>
              <ColorFields
                color={selectedPreview.color}
                onChange={(patch) => updateButtonOverride(selectedPreview.key.index, patch)}
              />
              <div className="row">
                <button type="button" onClick={() => resetButtonOverride(selectedPreview.key.index)}>
                  Reset Key
                </button>
              </div>
            </section>
          )}
        </aside>
      </div>

      <section className="panel stack protocolDebugPanel">
        <h2>Object Debug</h2>
        <pre className="dataPreview">{encodedPreview}</pre>
      </section>
    </section>
  );
}

interface GeometryLibrarySpacePanelProps {
  title: string;
  subtitle: string;
  space: GeometryLibrarySpace;
  bundles: LayoutBundle[];
  folders: string[];
  selectedFolder: string | null;
  activeBundleId: string;
  onFolderSelect: (space: GeometryLibrarySpace, folderPath: string) => void;
  onOpen: (bundle: LayoutBundle) => void;
  onUpload: (bundle: LayoutBundle) => void;
  onExport: (bundle: LayoutBundle) => void;
  onErase: (bundle: LayoutBundle) => void;
}

function GeometryLibrarySpacePanel({
  title,
  subtitle,
  space,
  bundles,
  folders,
  selectedFolder,
  activeBundleId,
  onFolderSelect,
  onOpen,
  onUpload,
  onExport,
  onErase
}: GeometryLibrarySpacePanelProps) {
  const visibleBundles = selectedFolder
    ? bundles.filter((bundle) => normalizeDisplayFolderPath(bundle.folderPath) === selectedFolder)
    : bundles;

  return (
    <section className="librarySpace">
      <div className="librarySpaceHeader">
        <div>
          <h3>{title}</h3>
          <span className="muted">{subtitle}</span>
        </div>
        <span className="countBadge">{visibleBundles.length}</span>
      </div>

      <div className="folderTargets">
        {folders.map((folder) => (
          <button
            aria-pressed={folder === selectedFolder}
            className={folder === selectedFolder ? "folderTarget active" : "folderTarget"}
            key={`${space}-${folder}`}
            onClick={() => onFolderSelect(space, folder)}
            type="button"
          >
            <span>{folderLabel(folder)}</span>
            <span>{bundles.filter((bundle) => normalizeDisplayFolderPath(bundle.folderPath) === folder).length}</span>
          </button>
        ))}
      </div>

      <ul className="list">
        {visibleBundles.length === 0 ? (
          <li className="emptyListItem">{selectedFolder ? `No bundles in ${folderLabel(selectedFolder)}` : "No bundles"}</li>
        ) : (
          visibleBundles.map((bundle) => (
            <li className={bundle.objectIdHex === activeBundleId ? "listItem presetListItem activeListItem" : "listItem presetListItem"} key={bundle.objectIdHex}>
              <div className="presetMeta">
                <strong>{bundle.name}</strong>
                <span>{folderLabel(bundle.folderPath)}</span>
                <span>{bundle.tuning.name}</span>
              </div>
              <div className="presetActions">
                <button type="button" onClick={() => onOpen(bundle)}>
                  Open
                </button>
                <button type="button" onClick={() => onUpload(bundle)}>
                  Upload
                </button>
                <button type="button" onClick={() => onExport(bundle)}>
                  Export
                </button>
                <button className="warning" type="button" onClick={() => onErase(bundle)}>
                  Erase
                </button>
              </div>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

interface HexBoardGeometryLibraryPanelProps {
  entries: HexBoardGeometryBundleEntry[];
  folders: string[];
  selectedFolder: string | null;
  onFolderSelect: (space: GeometryLibrarySpace, folderPath: string) => void;
  onOpen: (entry: HexBoardGeometryBundleEntry) => void;
  onDownload: (entry: HexBoardGeometryBundleEntry) => void;
  onExport: (entry: HexBoardGeometryBundleEntry) => void;
  onErase: (entry: HexBoardGeometryBundleEntry) => void;
}

function HexBoardGeometryLibraryPanel({
  entries,
  folders,
  selectedFolder,
  onFolderSelect,
  onOpen,
  onDownload,
  onExport,
  onErase
}: HexBoardGeometryLibraryPanelProps) {
  const visibleEntries = selectedFolder
    ? entries.filter((entry) => normalizeDisplayFolderPath(entry.folderPath) === selectedFolder)
    : entries;

  return (
    <section className="librarySpace">
      <div className="librarySpaceHeader">
        <div>
          <h3>HexBoard Library</h3>
          <span className="muted">Saved user tuning entries by folder</span>
        </div>
        <span className="countBadge">{visibleEntries.length}</span>
      </div>

      <div className="folderTargets">
        {folders.map((folder) => (
          <button
            aria-pressed={folder === selectedFolder}
            className={folder === selectedFolder ? "folderTarget active" : "folderTarget"}
            key={`hexboard-${folder}`}
            onClick={() => onFolderSelect("hexboard", folder)}
            type="button"
          >
            <span>{folderLabel(folder)}</span>
            <span>{entries.filter((entry) => normalizeDisplayFolderPath(entry.folderPath) === folder).length}</span>
          </button>
        ))}
      </div>

      <ul className="list">
        {visibleEntries.length === 0 ? (
          <li className="emptyListItem">{selectedFolder ? `No saved tunings in ${folderLabel(selectedFolder)}` : "Refresh HexBoard to list saved geometry"}</li>
        ) : (
          visibleEntries.map((entry) => (
            <li className="listItem presetListItem" key={`${entry.deviceHandle}-${entry.objectIdHex}`}>
              <div className="presetMeta">
                <strong>{entry.name}</strong>
                <span>{folderLabel(entry.folderPath)}</span>
                <span>{entry.readOnly ? "Factory" : entry.objectIdHex.slice(0, 8).toUpperCase()}</span>
              </div>
              <div className="presetActions">
                <button type="button" onClick={() => onOpen(entry)}>
                  Open
                </button>
                <button type="button" onClick={() => onDownload(entry)}>
                  Download
                </button>
                <button type="button" onClick={() => onExport(entry)}>
                  Export
                </button>
                <button className="warning" disabled={entry.readOnly} type="button" onClick={() => onErase(entry)}>
                  Erase
                </button>
              </div>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

interface TuningControlsProps {
  tuning: LayoutBundleTuning;
  onEdoChange: (patch: Partial<Extract<LayoutBundleTuning, { kind: "edo" }>>) => void;
  onEqualStepChange: (patch: Partial<Extract<LayoutBundleTuning, { kind: "equal-step" }>>) => void;
  onScalaChange: (patch: Partial<Pick<Extract<LayoutBundleTuning, { kind: "scala" }>, "name" | "description">>) => void;
  onImportScala: () => void;
  keyLabelsDraft: string;
  keyLabelsError: string;
  keyLabelsInputRef: RefObject<HTMLInputElement | null>;
  onKeyLabelsBlur: (text: string) => void;
  onKeyLabelsChange: (text: string) => void;
  onKeyLabelsKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}

function TuningControls({
  tuning,
  onEdoChange,
  onEqualStepChange,
  onScalaChange,
  onImportScala,
  keyLabelsDraft,
  keyLabelsError,
  keyLabelsInputRef,
  onKeyLabelsBlur,
  onKeyLabelsChange,
  onKeyLabelsKeyDown
}: TuningControlsProps) {
  if (tuning.kind === "edo") {
    return (
      <div className="fieldGrid">
        <label className="field">
          <span>Name</span>
          <input value={tuning.name} onChange={(event) => onEdoChange({ name: event.target.value })} />
        </label>
        <label className="field">
          <span>Divisions</span>
          <input min={1} max={255} type="number" value={tuning.edoDivisions} onChange={(event) => onEdoChange({ edoDivisions: Number(event.target.value) })} />
        </label>
        <label className="field">
          <span>Period cents</span>
          <input type="number" value={tuning.periodCents} onChange={(event) => onEdoChange({ periodCents: Number(event.target.value) })} />
        </label>
        <label className="field">
          <span>A = x Hz</span>
          <input min={0.01} step={0.01} type="number" value={tuning.referenceHz} onChange={(event) => onEdoChange({ referenceHz: Number(event.target.value) })} />
        </label>
        <label className={keyLabelsError ? "field invalidField" : "field"}>
          <span>Note labels</span>
          <input
            aria-invalid={keyLabelsError ? "true" : "false"}
            onBlurCapture={(event) => onKeyLabelsBlur(event.target.value)}
            onChange={(event) => onKeyLabelsChange(event.target.value)}
            onKeyDown={onKeyLabelsKeyDown}
            ref={keyLabelsInputRef}
            value={keyLabelsDraft}
          />
          {keyLabelsError ? <small className="fieldError">{keyLabelsError}</small> : null}
        </label>
      </div>
    );
  }

  if (tuning.kind === "equal-step") {
    return (
      <div className="fieldGrid">
        <label className="field">
          <span>Name</span>
          <input value={tuning.name} onChange={(event) => onEqualStepChange({ name: event.target.value })} />
        </label>
        <label className="field">
          <span>Step cents</span>
          <input type="number" value={tuning.stepCents} onChange={(event) => onEqualStepChange({ stepCents: Number(event.target.value) })} />
        </label>
        <label className="field">
          <span>Cycle length</span>
          <input min={1} max={255} type="number" value={tuning.cycleLength} onChange={(event) => onEqualStepChange({ cycleLength: Number(event.target.value) })} />
        </label>
        <label className="field">
          <span>A = x Hz</span>
          <input min={0.01} step={0.01} type="number" value={tuning.referenceHz} onChange={(event) => onEqualStepChange({ referenceHz: Number(event.target.value) })} />
        </label>
        <label className={keyLabelsError ? "field invalidField" : "field"}>
          <span>Note labels</span>
          <input
            aria-invalid={keyLabelsError ? "true" : "false"}
            onBlurCapture={(event) => onKeyLabelsBlur(event.target.value)}
            onChange={(event) => onKeyLabelsChange(event.target.value)}
            onKeyDown={onKeyLabelsKeyDown}
            ref={keyLabelsInputRef}
            value={keyLabelsDraft}
          />
          {keyLabelsError ? <small className="fieldError">{keyLabelsError}</small> : null}
        </label>
      </div>
    );
  }

  return (
    <div className="stack compact">
      <div className="row">
        <button type="button" onClick={onImportScala}>Import .scl</button>
        <span className="muted">{tuning.cents.length} intervals</span>
      </div>
      <label className="field">
        <span>Name</span>
        <input value={tuning.name} onChange={(event) => onScalaChange({ name: event.target.value })} />
      </label>
      <label className="field">
        <span>Description</span>
        <input value={tuning.description} onChange={(event) => onScalaChange({ description: event.target.value })} />
      </label>
    </div>
  );
}

interface ColorFieldsProps {
  color: ScaleDegreeColor;
  onChange: (patch: Partial<ScaleDegreeColor>) => void;
}

function ColorFields({ color, onChange }: ColorFieldsProps) {
  return (
    <div className="colorEditor">
      <div className="largeSwatch" style={{ backgroundColor: colorToCss(color) }} />
      <label className="field rangeField">
        <span>Hue {Math.round(color.hueTenthDegrees / 10)}°</span>
        <input min={0} max={3599} type="range" value={color.hueTenthDegrees} onChange={(event) => onChange({ hueTenthDegrees: Number(event.target.value) })} />
      </label>
      <label className="field rangeField">
        <span>Saturation {color.saturation}</span>
        <input min={0} max={255} type="range" value={color.saturation} onChange={(event) => onChange({ saturation: Number(event.target.value) })} />
      </label>
      <label className="field rangeField">
        <span>Value {color.value}</span>
        <input min={0} max={255} type="range" value={color.value} onChange={(event) => onChange({ value: Number(event.target.value) })} />
      </label>
    </div>
  );
}
