import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject } from "react";
import {
  clampScaleDegreeColor,
  ButtonMapField,
  ButtonMapRecordFormat,
  ButtonOutputMode,
  ButtonMapActionKind,
  ChordPitchMode,
  computeVectorLayoutSteps,
  ColorMode,
  createAllNotesScale,
  createDefaultDegreeColors,
  createDefaultLayout,
  createDefaultLayoutBundle,
  defaultSpanCtoA,
  currentFirmwareDownLeftToUpRight,
  defaultKeyLabels,
  deterministicObjectId,
  encodeGeometryCatalogOrder,
  encodeLayoutBundle,
  ExplicitButtonMapTlv,
  GeometryMenuTextMaxLength,
  hexAxialToCoordinate,
  hexBoardGeometry,
  hexKeyAxialCoordinate,
  isHexBoardCommandIndex,
  LayoutTlv,
  MaxTuningDivisions,
  normalizeScaleDegrees,
  normalizeScaleDegreeColors,
  keyLabelIndexFromStepsFromC,
  keyLabelsFromTlvOrder,
  keyLabelsFromScalaIntervalLabels,
  midiNoteToFrequency,
  normalizeKeyLabels,
  NoteLabelTextMaxLength,
  objectIdToHex,
  objectIdFromHex,
  parseLayoutBundleFile,
  parseLayoutBundleLibrary,
  parseScalaScale,
  referenceStepsFromC,
  resolveLayoutBundleButtonColor,
  ScaleColorMapTlv,
  serializeLayoutBundle,
  TuningTlv,
  transformGeneratedLayoutAroundKey,
  transformHexCoordinate,
  UserScaleTlv,
  UserTuningKind,
  clampGeometryFolderPath,
  clampGeometryMenuText,
  clampNoteLabelText,
  type HexBoardKey,
  type HexSpatialTransform,
  type LayoutBundle,
  type LayoutBundleButtonAction,
  type LayoutBundleButtonOverride,
  type LayoutBundleChordAction,
  type LayoutBundleGridOverride,
  type LayoutBundleLayout,
  type LayoutBundleScale,
  type LayoutBundleTuning,
  type ScaleDegreeColor,
  type ColorModeValue,
  type EncodedCatalogObject
} from "../catalogs/index.ts";
import { MockMidiTransport } from "../midi/mockTransport.ts";
import { PresetSyncClient } from "../midi/presetSyncClient.ts";
import type { MidiTransport } from "../midi/types.ts";
import { crc32 } from "../protocol/crc32.ts";
import { CapabilityFlag, ObjectListFlag, ObjectType, type HelloResponsePayload, type ObjectListRecord } from "../protocol/index.ts";
import { CommonTlv, decodeObjectBody, textFromBytes, type TlvRecord } from "../protocol/tlv.ts";
import { FolderControls } from "../components/FolderControls.tsx";
import { formatByteLength } from "./format.ts";

const layoutBundleStorageKey = "hexboard.layoutBundles.v1";
const geometryOrderWriteDebounceMs = 2000;
const geometryOrderDragMime = "application/x-hexboard-geometry-order";
const geometryFoldersStorageKey = "hexboard.geometryFolders.v1";
const previewHexHalfStepX = 25;
const previewHexRowStepY = 42;
const previewHexInset = 25;
const rootFolderPath = "/";
const defaultScalaReferenceMidiNote = 60;
const defaultGeometryFolders = [rootFolderPath];

type LayoutGuideFocus = "center" | "across" | "upRight";
type GeometryWorkspaceTab = "library" | "tuning" | "layout" | "scale";
type GeometryLibrarySpace = "computer" | "hexboard";

interface LayoutHistoryEntry {
  label: string;
  bundleId: string;
  before: LayoutBundle;
  after: LayoutBundle;
  selectedBefore: number[];
  selectedAfter: number[];
  primaryBefore: number;
  primaryAfter: number;
  offGridSelectedBefore: LayoutBundleGridOverride[];
  offGridSelectedAfter: LayoutBundleGridOverride[];
}

interface PaintStrokeHistoryStart {
  label: string;
  bundleId: string;
  before: LayoutBundle;
  selectedButtons: number[];
  primaryButton: number;
  offGridSelected: LayoutBundleGridOverride[];
}

const editableHexKeyByCoordinate = new Map<string, HexBoardKey>(
  hexBoardGeometry
    .filter((key) => key.role === "note")
    .map((key) => [`${key.coordCol}:${key.coordRow}`, key] as const)
);

function coordinateOverrideKey(override: Pick<LayoutBundleGridOverride, "coordCol" | "coordRow">): string {
  return `${override.coordCol}:${override.coordRow}`;
}

function layoutCoordinateOverrides(layout: LayoutBundleLayout): LayoutBundleGridOverride[] {
  const visible = layout.buttonOverrides.flatMap((override) => {
    const key = hexBoardGeometry.find((candidate) => candidate.index === override.buttonIndex);
    if (!key || key.role !== "note") {
      return [];
    }
    const { buttonIndex, ...fields } = override;
    void buttonIndex;
    return [{ ...fields, coordCol: key.coordCol, coordRow: key.coordRow }];
  });
  return [...visible, ...layout.offGridOverrides];
}

function partitionCoordinateOverrides(overrides: LayoutBundleGridOverride[]): Pick<LayoutBundleLayout, "buttonOverrides" | "offGridOverrides"> {
  const byCoordinate = new Map(overrides.map((override) => [coordinateOverrideKey(override), override]));
  const buttonOverrides: LayoutBundleButtonOverride[] = [];
  const offGridOverrides: LayoutBundleGridOverride[] = [];
  for (const override of byCoordinate.values()) {
    const key = editableHexKeyByCoordinate.get(coordinateOverrideKey(override));
    if (key) {
      const { coordCol, coordRow, ...fields } = override;
      void coordCol;
      void coordRow;
      buttonOverrides.push({ ...fields, buttonIndex: key.index });
    } else {
      offGridOverrides.push(override);
    }
  }
  return {
    buttonOverrides: buttonOverrides.sort((left, right) => left.buttonIndex - right.buttonIndex),
    offGridOverrides: offGridOverrides.sort((left, right) => left.coordRow - right.coordRow || left.coordCol - right.coordCol)
  };
}

function transformCoordinateOverride(
  override: LayoutBundleGridOverride,
  pivot: ReturnType<typeof hexKeyAxialCoordinate>,
  transform: HexSpatialTransform
): LayoutBundleGridOverride {
  const source = { q: (override.coordCol + override.coordRow) / 2, r: override.coordRow };
  const target = hexAxialToCoordinate(transformHexCoordinate(source, pivot, transform));
  return { ...override, ...target };
}

export function deviceRelativeMirrorTransform(
  deviceRotationSteps: number,
  direction: "horizontal" | "vertical"
): HexSpatialTransform {
  const deviceAxesAreSwapped = Math.abs(Math.round(deviceRotationSteps)) % 2 === 1;
  if (direction === "horizontal") {
    return deviceAxesAreSwapped ? "mirror-up-down" : "mirror-left-right";
  }
  return deviceAxesAreSwapped ? "mirror-left-right" : "mirror-up-down";
}
type PaintTool = "brush" | "eyedropper";
type PaintTarget = "button" | "degree";
type KeyOutputMode = "tuned" | "direct-midi" | "chord";

const defaultChordShape: Omit<LayoutBundleChordAction, "id"> = {
  name: "Major triad",
  pitchMode: "midi-semitones",
  intervals: [0, 4, 7],
  midiChannel: 1
};

const geometryWorkspaceTabs: Array<{
  key: GeometryWorkspaceTab;
  label: string;
  description: string;
}> = [
  { key: "library", label: "Library", description: "Choose a bundle" },
  { key: "tuning", label: "Tuning", description: "Define the pitches" },
  { key: "layout", label: "Layout", description: "Map the key grid" },
  { key: "scale", label: "Scale & color", description: "Shape the palette" }
];

const geometryWorkspaceCopy: Record<Exclude<GeometryWorkspaceTab, "library">, { eyebrow: string; title: string }> = {
  tuning: {
    eyebrow: "Step 2 of 4",
    title: "Tuning"
  },
  layout: {
    eyebrow: "Step 3 of 4",
    title: "Layout"
  },
  scale: {
    eyebrow: "Step 4 of 4",
    title: "Scale & color"
  }
};

const colorModeOptions: Array<{ value: ColorModeValue; label: string }> = [
  { value: ColorMode.Rainbow, label: "Rainbow" },
  { value: ColorMode.Diatonic, label: "Diatonic" },
  { value: ColorMode.Alt, label: "Alt" },
  { value: ColorMode.Fifths, label: "Fifths" },
  { value: ColorMode.Piano, label: "Piano" },
  { value: ColorMode.AltPiano, label: "Alt Piano" },
  { value: ColorMode.Filament, label: "Filament" },
  { value: ColorMode.Custom, label: "Custom" }
];

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

type LayoutToolbarIconKind = "undo" | "redo" | "rotate-counterclockwise" | "rotate-clockwise" | "mirror-horizontal" | "mirror-vertical";

function LayoutToolbarIcon({ kind }: { kind: LayoutToolbarIconKind }) {
  if (kind === "mirror-horizontal") {
    return (
      <svg aria-hidden="true" className="layoutToolbarIcon" viewBox="0 0 24 24">
        <path d="M12 3v18" strokeDasharray="2 2" />
        <path d="M9 7 4 12l5 5M15 7l5 5-5 5" />
      </svg>
    );
  }
  if (kind === "mirror-vertical") {
    return (
      <svg aria-hidden="true" className="layoutToolbarIcon" viewBox="0 0 24 24">
        <path d="M3 12h18" strokeDasharray="2 2" />
        <path d="m7 9 5-5 5 5M7 15l5 5 5-5" />
      </svg>
    );
  }
  const isHistory = kind === "undo" || kind === "redo";
  return (
    <svg aria-hidden="true" className="layoutToolbarIcon" viewBox="0 0 24 24">
      {isHistory ? (
        <path d={kind === "undo" ? "M8 8h7a5 5 0 1 1 0 10h-2M8 8l3-3M8 8l3 3" : "M16 8H9a5 5 0 1 0 0 10h2M16 8l-3-3M16 8l-3 3"} />
      ) : kind === "rotate-clockwise" ? (
        <path d="M17 7a8 8 0 1 0 2 8M13.2 5.7 17 7l-.7-3.9" />
      ) : (
        <path d="M7 7a8 8 0 1 1-2 8M10.8 6.2 7 7l.7-4.2" />
      )}
    </svg>
  );
}

interface TuningLayoutEditorProps {
  transport: MidiTransport;
  deviceHello?: HelloResponsePayload | null;
}

interface HexBoardGeometryBundleEntry {
  objectIdHex: string;
  deviceHandle: number;
  name: string;
  folderPath: string;
  schemaMajor: number;
  schemaMinor: number;
  readOnly: boolean;
  catalogOrder: number;
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
    return orderedComputerBundles([createDefaultLayoutBundle()]);
  }
  try {
    const raw = window.localStorage.getItem(layoutBundleStorageKey);
    if (!raw) {
      return orderedComputerBundles([createDefaultLayoutBundle()]);
    }
    const parsed = JSON.parse(raw) as unknown;
    return orderedComputerBundles(parseLayoutBundleLibrary(parsed));
  } catch {
    return orderedComputerBundles([createDefaultLayoutBundle()]);
  }
}

function persistBundles(bundles: LayoutBundle[]) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(layoutBundleStorageKey, JSON.stringify(orderedComputerBundles(bundles)));
  }
}

function loadStoredGeometryFolders(): string[] {
  if (typeof window === "undefined") {
    return defaultGeometryFolders;
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(geometryFoldersStorageKey) ?? "[]") as unknown;
    if (Array.isArray(parsed)) {
      return Array.from(new Set([
        rootFolderPath,
        ...parsed.filter((folder): folder is string => typeof folder === "string").map(normalizeDisplayFolderPath)
      ]));
    }
  } catch {
    window.localStorage.removeItem(geometryFoldersStorageKey);
  }
  return defaultGeometryFolders;
}

function persistGeometryFolders(folders: string[]) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(geometryFoldersStorageKey, JSON.stringify(folders.filter((folder) => folder !== rootFolderPath)));
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
    return Math.fround(Math.fround(tuning.stepCents) * tuningCycleLength(tuning));
  }
  return Math.fround(tuning.periodCents);
}

function tuningStepCents(tuning: LayoutBundleTuning): number {
  if (tuning.kind === "equal-step") {
    return Math.fround(tuning.stepCents);
  }
  return Math.fround(tuningPeriodCents(tuning) / tuningCycleLength(tuning));
}

function tuningStepsToCentsFromReference(tuning: LayoutBundleTuning, stepsFromReference: number): number {
  if (tuning.kind === "edo") {
    const scaledPeriod = Math.fround(Math.fround(stepsFromReference) * Math.fround(tuning.periodCents));
    return Math.fround(scaledPeriod / tuningCycleLength(tuning));
  }
  if (tuning.kind === "equal-step") {
    return Math.fround(Math.fround(stepsFromReference) * Math.fround(tuning.stepCents));
  }
  const cycleLength = tuningCycleLength(tuning);
  const periodOffset = Math.floor(stepsFromReference / cycleLength);
  const degree = ((stepsFromReference % cycleLength) + cycleLength) % cycleLength;
  const periodCents = Math.fround(Math.fround(periodOffset) * Math.fround(tuning.periodCents));
  return degree > 0
    ? Math.fround(periodCents + Math.fround(tuning.cents[degree - 1] ?? 0))
    : periodCents;
}

function formatSignedInteger(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function formatCents(value: number): string {
  return `${value.toFixed(2)} cents`;
}

function formatHertz(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 Hz";
  }
  return `${value.toFixed(value >= 100 ? 2 : 3)} Hz`;
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
      deviceRotationSteps: clampInteger(layout.deviceRotationSteps ?? 0, 0, 3),
      layoutRotationSteps: clampInteger(layout.layoutRotationSteps ?? 0, 0, 5)
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
  return clampGeometryFolderPath(folderPath);
}

function folderLabel(folderPath: string): string {
  return normalizeDisplayFolderPath(folderPath) === rootFolderPath ? "Root" : folderPath;
}

function compareFolderPaths(left: string, right: string): number {
  if (left === rootFolderPath) {
    return -1;
  }
  if (right === rootFolderPath) {
    return 1;
  }
  return folderLabel(left).localeCompare(folderLabel(right));
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

function orderedComputerBundles(bundles: LayoutBundle[]): LayoutBundle[] {
  return bundles.map((bundle, catalogOrder) => ({
    ...sanitizeEditorBundle(bundle),
    catalogOrder
  }));
}

function reorderByObjectId<T extends { objectIdHex: string }>(items: T[], draggedId: string, targetId: string): T[] {
  if (draggedId === targetId) return items;
  const fromIndex = items.findIndex((item) => item.objectIdHex === draggedId);
  const targetIndex = items.findIndex((item) => item.objectIdHex === targetId);
  if (fromIndex < 0 || targetIndex < 0) return items;
  const next = [...items];
  const [dragged] = next.splice(fromIndex, 1);
  next.splice(targetIndex, 0, dragged);
  return next;
}

function hexBoardGeometryEntryFromRecord(record: ObjectListRecord, catalogOrder: number): HexBoardGeometryBundleEntry {
  return {
    objectIdHex: objectIdToHex(record.objectId),
    deviceHandle: record.handle,
    name: record.name || "User Tuning",
    folderPath: decodeDeviceFolderPath(record.folderPath || rootFolderPath),
    schemaMajor: record.schemaMajor,
    schemaMinor: record.schemaMinor,
    readOnly: (record.flags & ObjectListFlag.ReadOnly) !== 0,
    catalogOrder
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
  if (!overrideHasCustomBehavior(next)) {
    return overrides.filter((override) => override.buttonIndex !== buttonIndex);
  }
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

function overrideHasColor(override: Pick<LayoutBundleButtonOverride, "hueTenthDegrees" | "saturation" | "value">): boolean {
  return override.hueTenthDegrees !== undefined || override.saturation !== undefined || override.value !== undefined;
}

function overrideHasCustomBehavior(override: LayoutBundleButtonOverride): boolean {
  return !isRoleDefault(override.buttonIndex, override.role) ||
    override.stepsFromC !== undefined ||
    overrideHasColor(override) ||
    override.action !== undefined;
}

function gridOverrideHasCustomBehavior(override: LayoutBundleGridOverride): boolean {
  return override.role !== "note" ||
    override.stepsFromC !== undefined ||
    overrideHasColor(override) ||
    override.action !== undefined;
}

function sanitizeButtonAction(action: LayoutBundleButtonAction | undefined): LayoutBundleButtonAction | undefined {
  if (action?.kind === "direct-midi") {
    return {
      kind: "direct-midi",
      midiNote: clampInteger(action.midiNote, 0, 127),
      midiChannel: clampInteger(action.midiChannel, 1, 16)
    };
  }
  if (action?.kind === "chord") {
    return {
      kind: "chord",
      chordActionId: clampInteger(action.chordActionId, 1, 255),
      rootMidiNote: action.rootMidiNote === undefined ? undefined : clampInteger(action.rootMidiNote, 0, 127)
    };
  }
  return undefined;
}

export function paintScaleDegreeColor(
  degreeColors: ScaleDegreeColor[],
  cycleLength: number,
  degree: number,
  brushColor: ScaleDegreeColor
): ScaleDegreeColor[] {
  return normalizeScaleDegreeColors(degreeColors, cycleLength).map((color) =>
    color.degree === degree
      ? clampScaleDegreeColor({
          ...color,
          hueTenthDegrees: brushColor.hueTenthDegrees,
          saturation: brushColor.saturation,
          value: brushColor.value
        })
      : color
  );
}

export function clearColorOverridesForScaleDegree(
  overrides: LayoutBundleButtonOverride[],
  degreeByButtonIndex: ReadonlyMap<number, number>,
  degree: number
): LayoutBundleButtonOverride[] {
  return overrides.flatMap((override) => {
    if (!overrideHasColor(override) || degreeByButtonIndex.get(override.buttonIndex) !== degree) {
      return [override];
    }
    const withoutColor = removeOverrideColor(override);
    const shouldRemove = !overrideHasCustomBehavior(withoutColor);
    return shouldRemove ? [] : [withoutColor];
  });
}

export function resetOverridesToScaleDegreeColors(overrides: LayoutBundleButtonOverride[]): LayoutBundleButtonOverride[] {
  return overrides.flatMap((override) => {
    if (!overrideHasColor(override)) {
      return [override];
    }
    const withoutColor = removeOverrideColor(override);
    const shouldRemove = !overrideHasCustomBehavior(withoutColor);
    return shouldRemove ? [] : [withoutColor];
  });
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

function nextChordActionId(actions: LayoutBundleChordAction[]): number {
  const used = new Set(actions.map((action) => action.id));
  for (let id = 1; id <= 255; id += 1) {
    if (!used.has(id)) {
      return id;
    }
  }
  return 1;
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
    name: clampGeometryMenuText(bundle.name, "Untitled Bundle"),
    folderPath: normalizeDisplayFolderPath(bundle.folderPath),
    tuning: {
      ...bundle.tuning,
      name: clampGeometryMenuText(bundle.tuning.name, "User Tuning"),
      keyLabels: normalizeKeyLabels(bundle.tuning.keyLabels, cycleLength)
    } as LayoutBundleTuning,
    layouts: bundle.layouts.map((layout) => ({
      ...layout,
      name: clampGeometryMenuText(layout.name, "User Layout"),
      centerButton: noteButtonIndexOrFallback(layout.centerButton, 65),
      centerStepsFromC: Math.round(layout.centerStepsFromC),
      deviceRotationSteps: clampInteger(layout.deviceRotationSteps, 0, 3),
      layoutRotationSteps: clampInteger(layout.layoutRotationSteps, 0, 5),
      mirrorLeftRight: Boolean(layout.mirrorLeftRight),
      mirrorUpDown: Boolean(layout.mirrorUpDown),
      buttonOverrides: layout.buttonOverrides
        .filter((override) => isEditableButtonIndex(override.buttonIndex))
        .map((override): LayoutBundleButtonOverride => ({
          ...override,
          role: override.role === "unused" ? "unused" : "note",
          action: sanitizeButtonAction(override.action)
        }))
        .filter(overrideHasCustomBehavior),
      offGridOverrides: layout.offGridOverrides
        .filter((override) => Number.isFinite(override.coordCol) && Number.isFinite(override.coordRow))
        .map((override): LayoutBundleGridOverride => ({
          ...override,
          coordCol: Math.round(override.coordCol),
          coordRow: Math.round(override.coordRow),
          role: override.role === "unused" || override.role === "command" ? override.role : "note",
          action: sanitizeButtonAction(override.action)
        }))
        .filter(gridOverrideHasCustomBehavior),
      chordActions: layout.chordActions.slice(0, 16).map((action, index) => ({
        ...action,
        id: clampInteger(action.id, 1, 255),
        name: clampGeometryMenuText(action.name, `Chord ${index + 1}`),
        intervals: action.intervals.length > 0
          ? action.intervals.slice(0, 4).map((interval) => clampInteger(interval, -32768, 32767))
          : [0],
        midiChannel: clampInteger(action.midiChannel, action.pitchMode === "midi-semitones" ? 1 : 0, 16)
      }))
    })),
    scales: bundle.scales.map((scale, index) => ({
      ...scale,
      name: clampGeometryMenuText(scale.name, `Scale ${index + 1}`)
    }))
  }, cycleLength);
}

function bundleForDeviceEncoding(bundle: LayoutBundle): LayoutBundle {
  const sanitized = sanitizeEditorBundle(bundle);
  return {
    ...sanitized,
    folderPath: encodeDeviceFolderPath(sanitized.folderPath)
  };
}

function activeEncodedGeometryObjects(
  encoded: ReturnType<typeof encodeLayoutBundle>,
  bundle: LayoutBundle
): EncodedCatalogObject[] {
  const activeLayoutObject = encoded.layouts.find((object) =>
    objectIdToHex(object.objectId) === bundle.activeLayoutIdHex
  );
  const activeScaleObject = encoded.scales.find((object) =>
    objectIdToHex(object.objectId) === bundle.activeScaleIdHex
  );
  const explicitMaps = encoded.explicitButtonMaps.filter((object) =>
    object.records.some((record) =>
      record.tag === ExplicitButtonMapTlv.LayoutRef
      && objectReferenceIdHex(record.value) === bundle.activeLayoutIdHex
    )
  );
  return [
    encoded.tuning,
    activeLayoutObject,
    activeScaleObject,
    encoded.scaleColorMap,
    ...explicitMaps
  ].filter((object): object is EncodedCatalogObject => Boolean(object));
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
  const invalidLabel = labels.find((label) => label.length > NoteLabelTextMaxLength || !/^[A-Za-z0-9+#b/_\\.'-]+$/.test(label));
  if (invalidLabel) {
    return { error: `Invalid note label "${invalidLabel}". Use ${NoteLabelTextMaxLength} or fewer letters, numbers, +, #, b, /, _, \\, ., or -.` };
  }
  return { labels: labels.map((label, index) => clampNoteLabelText(label, String(index))) };
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

function float32LE(value: Uint8Array | undefined, fallback: number, offset = 0): number {
  if (!value || offset < 0 || offset + 4 > value.length) {
    return fallback;
  }
  const decoded = new DataView(value.buffer, value.byteOffset + offset, 4).getFloat32(0, true);
  return Number.isFinite(decoded) ? decoded : fallback;
}

function i16LEFromBytes(value: Uint8Array, offset: number): number {
  const unsigned = value[offset] | (value[offset + 1] << 8);
  return unsigned > 0x7fff ? unsigned - 0x10000 : unsigned;
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
  return normalizeKeyLabels(keyLabelsFromTlvOrder(labels, cycleLength), cycleLength);
}

function objectReferences(object: DeviceGeometryObject, tag: number, objectType: number, objectIdHex: string): boolean {
  const value = tlvValue(object.records, tag);
  return Boolean(value && value.length >= 19 && value[0] === objectType && objectReferenceIdHex(value) === objectIdHex);
}

function decodeDeviceTuning(entry: HexBoardGeometryBundleEntry, object: DeviceGeometryObject): LayoutBundleTuning {
  const kind = u8(tlvValue(object.records, TuningTlv.TuningKind), UserTuningKind.Edo);
  const cycleLength = clampInteger(u16LE(tlvValue(object.records, TuningTlv.EdoDivisions), 12), 1, MaxTuningDivisions);
  const name = tlvText(object.records, CommonTlv.Name, entry.name);
  const referenceMidiNote = clampInteger(u8(tlvValue(object.records, TuningTlv.ReferenceMidiNote), 69), 0, 127);
  const referenceHz = float32LE(
    tlvValue(object.records, TuningTlv.ReferenceHzFloat32),
    u32LE(tlvValue(object.records, TuningTlv.ReferenceMilliHz), 440_000) / 1000
  );

  if (kind === UserTuningKind.EqualStep) {
    return {
      kind: "equal-step",
      name,
      stepCents: float32LE(
        tlvValue(object.records, TuningTlv.StepCentsFloat32),
        u32LE(tlvValue(object.records, TuningTlv.StepMilliCents), Math.round(1_200_000 / cycleLength)) / 1000
      ),
      cycleLength,
      referenceMidiNote,
      referenceHz,
      keyLabels: decodeKeyLabels(tlvValue(object.records, TuningTlv.KeyLabels), cycleLength)
    };
  }

  if (kind === UserTuningKind.CentsList) {
    const floatCentsBytes = tlvValue(object.records, TuningTlv.CentsTableFloat32);
    const centsBytes = floatCentsBytes ?? tlvValue(object.records, TuningTlv.CentsTable);
    const cents: number[] = [];
    if (centsBytes) {
      for (let offset = 0; offset + 3 < centsBytes.length; offset += 4) {
        cents.push(floatCentsBytes
          ? float32LE(centsBytes, 0, offset)
          : i32LEFromBytes(centsBytes, offset) / 1000);
      }
    }
    const fallbackPeriod = u32LE(tlvValue(object.records, TuningTlv.PeriodMilliCents), 1_200_000) / 1000;
    const periodCents = float32LE(tlvValue(object.records, TuningTlv.PeriodCentsFloat32), fallbackPeriod);
    const safeCents = (cents.length > 0 ? cents : [periodCents]).slice(0, MaxTuningDivisions);
    return {
      kind: "scala",
      name,
      description: name,
      cents: safeCents,
      periodCents,
      cycleLength: clampInteger(safeCents.length, 1, MaxTuningDivisions),
      referenceMidiNote,
      referenceHz,
      keyLabels: decodeKeyLabels(tlvValue(object.records, TuningTlv.KeyLabels), safeCents.length)
    };
  }

  return {
    kind: "edo",
    name,
    edoDivisions: cycleLength,
    periodCents: float32LE(
      tlvValue(object.records, TuningTlv.PeriodCentsFloat32),
      u32LE(tlvValue(object.records, TuningTlv.PeriodMilliCents), 1_200_000) / 1000
    ),
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

function decodeDeviceDefaultColorMode(object: DeviceGeometryObject | undefined): ColorModeValue {
  const value = u8(tlvValue(object?.records ?? [], ScaleColorMapTlv.DefaultColorMode), ColorMode.Custom);
  return colorModeOptions.some((option) => option.value === value) ? value as ColorModeValue : ColorMode.Custom;
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

function decodeDeviceButtonMap(map: DeviceGeometryObject | undefined): {
  overrides: LayoutBundleButtonOverride[];
  offGridOverrides: LayoutBundleGridOverride[];
  chordActions: LayoutBundleChordAction[];
} {
  const records = map ? tlvValue(map.records, ExplicitButtonMapTlv.ButtonRecords) : undefined;
  if (!records) {
    return { overrides: [], offGridOverrides: [], chordActions: [] };
  }
  const recordFormat = u8(tlvValue(map?.records ?? [], ExplicitButtonMapTlv.MapRecordFormat), ButtonMapRecordFormat.Legacy);
  const overrides: LayoutBundleButtonOverride[] = [];
  if (recordFormat === ButtonMapRecordFormat.FieldMasked) {
    for (let cursor = 0; cursor + 2 <= records.length;) {
      const recordLength = records[cursor] | (records[cursor + 1] << 8);
      cursor += 2;
      if (recordLength < 17 || cursor + recordLength > records.length) {
        break;
      }
      const buttonIndex = records[cursor] | (records[cursor + 1] << 8);
      const fieldMask = records[cursor + 2] | (records[cursor + 3] << 8);
      if (isEditableButtonIndex(buttonIndex)) {
        const override: LayoutBundleButtonOverride = {
          buttonIndex,
          role: (fieldMask & ButtonMapField.Role) !== 0 && records[cursor + 4] === 0 ? "unused" : "note"
        };
        if ((fieldMask & ButtonMapField.Pitch) !== 0) {
          override.stepsFromC = i32LEFromBytes(records, cursor + 5);
        }
        if ((fieldMask & ButtonMapField.Color) !== 0) {
          override.hueTenthDegrees = records[cursor + 13] | (records[cursor + 14] << 8);
          override.saturation = records[cursor + 15];
          override.value = records[cursor + 16];
        }
        if ((fieldMask & ButtonMapField.Action) !== 0) {
          const outputMode = records[cursor + 9];
          if (outputMode === ButtonOutputMode.DirectMidi) {
            override.action = {
              kind: "direct-midi",
              midiNote: records[cursor + 10],
              midiChannel: records[cursor + 11]
            };
          } else if (outputMode === ButtonOutputMode.Chord) {
            override.action = {
              kind: "chord",
              chordActionId: records[cursor + 12],
              rootMidiNote: records[cursor + 10]
            };
          }
        }
        overrides.push(override);
      }
      cursor += recordLength;
    }
  } else {
    for (let offset = 0; offset + 12 < records.length; offset += 13) {
      const buttonIndex = records[offset] | (records[offset + 1] << 8);
      if (!isEditableButtonIndex(buttonIndex)) {
        continue;
      }
      const override: LayoutBundleButtonOverride = {
        buttonIndex,
        role: records[offset + 2] === 0 ? "unused" : "note",
        stepsFromC: i32LEFromBytes(records, offset + 3)
      };
      if (records[offset + 8] !== 0) {
        override.hueTenthDegrees = records[offset + 9] | (records[offset + 10] << 8);
        override.saturation = records[offset + 11];
        override.value = records[offset + 12];
      }
      overrides.push(override);
    }
  }
  const actionBytes = map ? tlvValue(map.records, ExplicitButtonMapTlv.Actions) : undefined;
  const chordActions: LayoutBundleChordAction[] = [];
  if (actionBytes) {
    for (let cursor = 0; cursor + 2 <= actionBytes.length;) {
      const actionLength = actionBytes[cursor] | (actionBytes[cursor + 1] << 8);
      cursor += 2;
      if (actionLength < 6 || cursor + actionLength > actionBytes.length) {
        break;
      }
      if (actionBytes[cursor + 1] === ButtonMapActionKind.Chord) {
        const toneCount = Math.min(4, actionBytes[cursor + 4]);
        const nameLength = actionBytes[cursor + 5];
        const intervalStart = cursor + 6;
        const nameStart = intervalStart + (toneCount * 2);
        if (nameStart + nameLength <= cursor + actionLength) {
          chordActions.push({
            id: actionBytes[cursor],
            name: textFromBytes(actionBytes.slice(nameStart, nameStart + nameLength)) || `Chord ${actionBytes[cursor]}`,
            pitchMode: actionBytes[cursor + 2] === ChordPitchMode.MidiSemitones ? "midi-semitones" : "tuning-steps",
            midiChannel: actionBytes[cursor + 3],
            intervals: Array.from({ length: toneCount }, (_, index) => i16LEFromBytes(actionBytes, intervalStart + (index * 2)))
          });
        }
      }
      cursor += actionLength;
    }
  }
  return {
    overrides: overrides.sort((left, right) => left.buttonIndex - right.buttonIndex),
    offGridOverrides: [],
    chordActions
  };
}

function decodeDeviceLayout(object: DeviceGeometryObject, index: number, buttonMap: DeviceGeometryObject | undefined): LayoutBundleLayout {
  const legacyDeviceRotation = u8(tlvValue(object.records, LayoutTlv.Portrait), 1) === 0 ? 1 : 0;
  const deviceRotationSteps = clampInteger(u8(tlvValue(object.records, LayoutTlv.DeviceRotation), legacyDeviceRotation), 0, 3);
  const mirrorFlags = u8(tlvValue(object.records, LayoutTlv.MirrorFlags), 0);
  const acrossSteps = i16LE(tlvValue(object.records, LayoutTlv.AcrossSteps), 3);
  const downLeftSteps = i16LE(tlvValue(object.records, LayoutTlv.DownLeftSteps), -11);
  const buttonMapData = decodeDeviceButtonMap(buttonMap);
  return {
    objectIdHex: objectIdToHex(object.record.objectId),
    name: tlvText(object.records, CommonTlv.Name, `Layout ${index + 1}`),
    centerButton: noteButtonIndexOrFallback(u16LE(tlvValue(object.records, LayoutTlv.CenterButton), 65), 65),
    centerStepsFromC: i32LEFromBytes(tlvValue(object.records, LayoutTlv.CenterStepsFromC) ?? new Uint8Array(4), 0),
    acrossSteps,
    upRightSteps: currentFirmwareDownLeftToUpRight(acrossSteps, downLeftSteps),
    deviceRotationSteps,
    layoutRotationSteps: clampInteger(u8(tlvValue(object.records, LayoutTlv.LayoutRotation), 0), 0, 5),
    mirrorLeftRight: (mirrorFlags & 1) !== 0,
    mirrorUpDown: (mirrorFlags & 2) !== 0,
    portrait: deviceRotationSteps % 2 === 0,
    buttonOverrides: buttonMapData.overrides,
    offGridOverrides: buttonMapData.offGridOverrides,
    chordActions: buttonMapData.chordActions
  };
}

export function TuningLayoutEditor({ transport, deviceHello = null }: TuningLayoutEditorProps) {
  const [bundles, setBundles] = useState<LayoutBundle[]>(() => loadStoredBundles());
  const [hexboardBundles, setHexboardBundles] = useState<HexBoardGeometryBundleEntry[]>([]);
  const [activeBundleId, setActiveBundleId] = useState("");
  const [customFolders, setCustomFolders] = useState(loadStoredGeometryFolders);
  const [newFolder, setNewFolder] = useState("");
  const [folderFilters, setFolderFilters] = useState<Record<GeometryLibrarySpace, string | null>>({
    computer: null,
    hexboard: null
  });
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<GeometryWorkspaceTab>("library");
  const [selectedButton, setSelectedButton] = useState(65);
  const [selectedButtons, setSelectedButtons] = useState<number[]>([65]);
  const [selectedOffGridCoordinates, setSelectedOffGridCoordinates] = useState<LayoutBundleGridOverride[]>([]);
  const [layoutGuideFocus, setLayoutGuideFocus] = useState<LayoutGuideFocus | null>(null);
  const [paintbrushMode, setPaintbrushMode] = useState(false);
  const [paintTool, setPaintTool] = useState<PaintTool>("brush");
  const [paintTarget, setPaintTarget] = useState<PaintTarget>("button");
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
  const paintStrokeHistoryRef = useRef<PaintStrokeHistoryStart | null>(null);
  const lastPaintedTargetRef = useRef<string | null>(null);
  const skipNextLiveSendRef = useRef(true);
  const lastAutoSentGeometryKeyRef = useRef("");
  const undoLayoutHistoryRef = useRef<LayoutHistoryEntry[]>([]);
  const redoLayoutHistoryRef = useRef<LayoutHistoryEntry[]>([]);
  const geometryOrderWriteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, setLayoutHistoryRevision] = useState(0);

  const activeBundle = bundles.find((bundle) => bundle.objectIdHex === activeBundleId) ?? bundles[0] ?? createDefaultLayoutBundle();
  const activeBundleRef = useRef(activeBundle);
  activeBundleRef.current = activeBundle;
  const activeLayout = activeBundle.layouts.find((layout) => layout.objectIdHex === activeBundle.activeLayoutIdHex) ??
    activeBundle.layouts[0] ??
    createDefaultLayout(tuningCycleLength(activeBundle.tuning));
  const activeScale = activeBundle.scales.find((scale) => scale.objectIdHex === activeBundle.activeScaleIdHex) ??
    activeBundle.scales[0] ??
    createAllNotesScale(tuningCycleLength(activeBundle.tuning));
  const activeScaleIsAllNotes = isAllNotesScale(activeScale);
  const customColorModeActive = activeBundle.palette.defaultColorMode === ColorMode.Custom;
  const centsTableRuntimeSupported = Boolean(
    deviceHello?.capabilityFlags && (deviceHello.capabilityFlags & CapabilityFlag.CentsTableRuntimeTuning)
  );
  const geometryBundleFilesSupported = Boolean(
    deviceHello?.capabilityFlags && (deviceHello.capabilityFlags & CapabilityFlag.GeometryBundleFiles)
  );
  const runtimeSendSupported = activeBundle.tuning.kind !== "scala" || centsTableRuntimeSupported;
  const client = useMemo(() => new PresetSyncClient(transport), [transport]);

  useEffect(() => () => {
    if (geometryOrderWriteTimerRef.current !== null) {
      clearTimeout(geometryOrderWriteTimerRef.current);
    }
  }, [client]);

  function selectOnlyButton(buttonIndex: number) {
    setSelectedButton(buttonIndex);
    setSelectedButtons([buttonIndex]);
    setSelectedOffGridCoordinates([]);
  }

  useEffect(() => {
    if (!runtimeSendSupported && liveSend) {
      setLiveSend(false);
    }
  }, [liveSend, runtimeSendSupported]);

  const allFolders = useMemo(() => Array.from(new Set([
    rootFolderPath,
    ...defaultGeometryFolders,
    ...customFolders,
    ...bundles.map((bundle) => normalizeDisplayFolderPath(bundle.folderPath)),
    ...hexboardBundles.map((bundle) => normalizeDisplayFolderPath(bundle.folderPath)),
    normalizeDisplayFolderPath(activeBundle.folderPath)
  ])).sort(compareFolderPaths), [activeBundle.folderPath, bundles, customFolders, hexboardBundles]);
  const computerFolders = useMemo(() => Array.from(new Set([
    rootFolderPath,
    ...customFolders,
    ...bundles.map((bundle) => normalizeDisplayFolderPath(bundle.folderPath))
  ])).sort(compareFolderPaths), [bundles, customFolders]);
  const hexboardFolders = useMemo(() => Array.from(new Set([
    rootFolderPath,
    ...hexboardBundles.map((bundle) => normalizeDisplayFolderPath(bundle.folderPath))
  ])).sort(compareFolderPaths), [hexboardBundles]);

  useEffect(() => {
    persistGeometryFolders(customFolders);
  }, [customFolders]);

  useEffect(() => {
    const cycleLength = tuningCycleLength(activeBundle.tuning);
    setIncludedDegreesDraft(formatIntegerList(
      activeScaleIsAllNotes ? createAllNotesScale(cycleLength).includedDegrees : activeScale.includedDegrees
    ));
    setIncludedDegreesError("");
  }, [activeScale.objectIdHex, activeScale.includedDegrees, activeScaleIsAllNotes, activeBundle.tuning]);

  useEffect(() => {
    setKeyLabelsDraft(formatLabelList(activeBundle.tuning.keyLabels));
    setKeyLabelsError("");
  }, [activeBundle.tuning]);

  useEffect(() => {
    if (!customColorModeActive && paintbrushMode) {
      endPaintStroke();
      setPaintbrushMode(false);
      setPaintTool("brush");
    }
  }, [customColorModeActive, paintbrushMode]);

  function clearLayoutHistory() {
    setSelectedOffGridCoordinates([]);
    if (undoLayoutHistoryRef.current.length === 0 && redoLayoutHistoryRef.current.length === 0) {
      return;
    }
    undoLayoutHistoryRef.current = [];
    redoLayoutHistoryRef.current = [];
    setLayoutHistoryRevision((current) => current + 1);
  }

  function setBundlesAndPersist(nextBundles: LayoutBundle[]) {
    clearLayoutHistory();
    const ordered = orderedComputerBundles(nextBundles);
    setBundles(ordered);
    persistBundles(ordered);
  }

  function updateActiveBundle(updater: (bundle: LayoutBundle) => LayoutBundle, preserveLayoutHistory = false) {
    if (!preserveLayoutHistory) {
      clearLayoutHistory();
    }
    const targetId = activeBundle.objectIdHex;
    setBundles((currentBundles) => {
      const nextBundles = orderedComputerBundles(
        currentBundles.map((bundle) => bundle.objectIdHex === targetId ? updater(bundle) : bundle)
      );
      persistBundles(nextBundles);
      return nextBundles;
    });
    setActiveBundleId(targetId);
  }

  function pushLayoutHistoryEntry(entry: LayoutHistoryEntry) {
    undoLayoutHistoryRef.current = [...undoLayoutHistoryRef.current.slice(-99), entry];
    redoLayoutHistoryRef.current = [];
    setLayoutHistoryRevision((current) => current + 1);
  }

  function commitLayoutHistory(
    label: string,
    after: LayoutBundle,
    selectedAfter = selectedButtons,
    primaryAfter = selectedButton,
    offGridSelectedAfter = selectedOffGridCoordinates
  ) {
    const entry: LayoutHistoryEntry = {
      label,
      bundleId: activeBundle.objectIdHex,
      before: activeBundle,
      after: sanitizeEditorBundle(after),
      selectedBefore: selectedButtons,
      selectedAfter,
      primaryBefore: selectedButton,
      primaryAfter,
      offGridSelectedBefore: selectedOffGridCoordinates,
      offGridSelectedAfter
    };
    pushLayoutHistoryEntry(entry);
    updateActiveBundle(() => entry.after, true);
    setSelectedButtons(selectedAfter);
    setSelectedButton(primaryAfter);
    setSelectedOffGridCoordinates(offGridSelectedAfter);
  }

  function undoLayoutEdit() {
    const entry = undoLayoutHistoryRef.current.at(-1);
    if (!entry || entry.bundleId !== activeBundle.objectIdHex) {
      return;
    }
    undoLayoutHistoryRef.current = undoLayoutHistoryRef.current.slice(0, -1);
    redoLayoutHistoryRef.current = [...redoLayoutHistoryRef.current, entry];
    setLayoutHistoryRevision((current) => current + 1);
    updateActiveBundle(() => entry.before, true);
    setSelectedButtons(entry.selectedBefore);
    setSelectedButton(entry.primaryBefore);
    setSelectedOffGridCoordinates(entry.offGridSelectedBefore);
    setStatus(`Undid ${entry.label}`);
  }

  function redoLayoutEdit() {
    const entry = redoLayoutHistoryRef.current.at(-1);
    if (!entry || entry.bundleId !== activeBundle.objectIdHex) {
      return;
    }
    redoLayoutHistoryRef.current = redoLayoutHistoryRef.current.slice(0, -1);
    undoLayoutHistoryRef.current = [...undoLayoutHistoryRef.current, entry];
    setLayoutHistoryRevision((current) => current + 1);
    updateActiveBundle(() => entry.after, true);
    setSelectedButtons(entry.selectedAfter);
    setSelectedButton(entry.primaryAfter);
    setSelectedOffGridCoordinates(entry.offGridSelectedAfter);
    setStatus(`Redid ${entry.label}`);
  }

  function addNewBundle() {
    const next = createUntitledBundle();
    const nextBundles = [...bundles, next];
    setBundlesAndPersist(nextBundles);
    setActiveBundleId(next.objectIdHex);
    selectOnlyButton(next.layouts[0]?.centerButton ?? 65);
    setActiveWorkspaceTab("tuning");
    setStatus("Created new geometry bundle");
  }

  function reorderComputerLibrary(draggedId: string, targetId: string) {
    const next = reorderByObjectId(bundles, draggedId, targetId);
    if (next === bundles) return;
    setBundlesAndPersist(next);
    setStatus("Reordered Computer Library");
  }

  function scheduleHexBoardOrderWrite(entries: HexBoardGeometryBundleEntry[]) {
    if (geometryOrderWriteTimerRef.current !== null) {
      clearTimeout(geometryOrderWriteTimerRef.current);
    }
    setStatus(`HexBoard order queued; saving in ${geometryOrderWriteDebounceMs} ms`);
    geometryOrderWriteTimerRef.current = setTimeout(() => {
      geometryOrderWriteTimerRef.current = null;
      void saveHexBoardGeometryOrder(entries);
    }, geometryOrderWriteDebounceMs);
  }

  async function saveHexBoardGeometryOrder(entries: HexBoardGeometryBundleEntry[]) {
    if (transport instanceof MockMidiTransport || !geometryBundleFilesSupported) return;
    setSyncBusy(true);
    try {
      const orderFile = encodeGeometryCatalogOrder(
        entries.map((entry) => objectIdFromHex(entry.objectIdHex))
      );
      setStatus("Saving HexBoard geometry order");
      await client.sendGeometryOrderSaveConfirmed(orderFile);
      await refreshHexBoardGeometryLibrary("Saved HexBoard geometry order");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to save HexBoard geometry order");
    } finally {
      setSyncBusy(false);
    }
  }

  function reorderHexBoardLibrary(draggedId: string, targetId: string) {
    if (syncBusy) return;
    const reordered = reorderByObjectId(hexboardBundles, draggedId, targetId);
    if (reordered === hexboardBundles) return;
    const next = reordered.map((entry, catalogOrder) => ({ ...entry, catalogOrder }));
    setHexboardBundles(next);
    scheduleHexBoardOrderWrite(next);
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
    selectOnlyButton(nextBundles[0]?.layouts[0]?.centerButton ?? 65);
    setStatus(`Deleted ${bundleToDelete.name}`);
  }

  function openBundle(bundle: LayoutBundle) {
    setActiveBundleId(bundle.objectIdHex);
    selectOnlyButton(noteButtonIndexOrFallback(
      bundle.layouts.find((layout) => layout.objectIdHex === bundle.activeLayoutIdHex)?.centerButton ?? bundle.layouts[0]?.centerButton ?? 65,
      65
    ));
    setActiveWorkspaceTab("tuning");
    setStatus(`Opened ${bundle.name}`);
  }

  function downloadBundleFile(bundle: LayoutBundle) {
    const sanitized = sanitizeEditorBundle(bundle);
    downloadTextFile(`${sanitized.name}.hexboard-layout.json`, serializeLayoutBundle(sanitized));
  }

  function updateBundleName(name: string) {
    updateActiveBundle((bundle) => ({ ...bundle, name: clampGeometryMenuText(name, "Untitled Bundle") }));
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
    setNewFolder("");
    setStatus(`Created ${folderLabel(folder)} in Computer Library`);
  }

  function deleteFolder(folderPath: string) {
    const folder = normalizeDisplayFolderPath(folderPath);
    const bundleCount = bundles.filter((bundle) => normalizeDisplayFolderPath(bundle.folderPath) === folder).length;
    if (folder === rootFolderPath || bundleCount > 0) {
      setStatus(bundleCount > 0 ? `Move or erase the ${bundleCount} bundle${bundleCount === 1 ? "" : "s"} in ${folderLabel(folder)} first` : "Root cannot be deleted");
      return;
    }
    setCustomFolders((current) => current.filter((candidate) => candidate !== folder));
    setFolderFilters((current) => ({ ...current, computer: current.computer === folder ? null : current.computer }));
    setStatus(`Deleted ${folderLabel(folder)} from Computer Library`);
  }

  function selectFolderFilter(space: GeometryLibrarySpace, folderPath: string | null) {
    setFolderFilters((current) => ({
      ...current,
      [space]: folderPath
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
      ...patch,
      name: patch.name !== undefined ? clampGeometryMenuText(patch.name, "User Layout") : layout.name
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
    selectOnlyButton(layout.centerButton);
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
      selectOnlyButton(layout.centerButton);
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
    } else if (activeBundle.tuning.kind === "equal-step") {
      updateEqualStepTuning({ keyLabels: result.labels });
    } else {
      updateScalaTuning({ keyLabels: result.labels });
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
        keyLabels: bundle.tuning.keyLabels
      };
      const tuning = {
        ...current,
        ...patch
      };
      tuning.name = clampGeometryMenuText(tuning.name, "User Tuning");
      tuning.edoDivisions = clampInteger(tuning.edoDivisions, 1, MaxTuningDivisions);
      tuning.cycleLength = tuning.edoDivisions;
      tuning.keyLabels = normalizeKeyLabels(tuning.keyLabels, tuning.cycleLength);
      tuning.referenceMidiNote = clampInteger(tuning.referenceMidiNote, 0, 127);
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
        keyLabels: bundle.tuning.keyLabels
      };
      const tuning = {
        ...current,
        ...patch
      };
      tuning.name = clampGeometryMenuText(tuning.name, "User Tuning");
      tuning.cycleLength = clampInteger(tuning.cycleLength, 1, MaxTuningDivisions);
      tuning.keyLabels = normalizeKeyLabels(tuning.keyLabels, tuning.cycleLength);
      tuning.referenceMidiNote = clampInteger(tuning.referenceMidiNote, 0, 127);
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
        referenceHz: bundle.tuning.referenceHz,
        keyLabels: defaultKeyLabels(1)
      };
      const tuning = {
        ...current,
        ...patch
      };
      tuning.name = clampGeometryMenuText(tuning.name, "User Tuning");
      tuning.description = clampGeometryMenuText(tuning.description, tuning.name);
      tuning.periodCents = tuning.cents[tuning.cents.length - 1] ?? 1200;
      tuning.cycleLength = clampInteger(tuning.cents.length, 1, MaxTuningDivisions);
      tuning.referenceMidiNote = clampInteger(tuning.referenceMidiNote, 0, 127);
      tuning.referenceHz = Number.isFinite(tuning.referenceHz) && tuning.referenceHz > 0 ? tuning.referenceHz : midiNoteToFrequency(tuning.referenceMidiNote);
      tuning.keyLabels = normalizeKeyLabels(tuning.keyLabels, tuning.cycleLength);
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

  function paintDegreeColor(degree: number, color: ScaleDegreeColor) {
    const degreeByButtonIndex = new Map(previewKeys.map((item) => [item.key.index, item.degree] as const));
    updateActiveBundle((bundle) => ({
      ...bundle,
      palette: {
        ...bundle.palette,
        degreeColors: paintScaleDegreeColor(
          bundle.palette.degreeColors,
          tuningCycleLength(bundle.tuning),
          degree,
          color
        )
      },
      layouts: bundle.layouts.map((layout) => layout.objectIdHex === bundle.activeLayoutIdHex
        ? {
            ...layout,
            buttonOverrides: clearColorOverridesForScaleDegree(layout.buttonOverrides, degreeByButtonIndex, degree)
          }
        : layout)
    }), true);
  }

  function updateDefaultColorMode(defaultColorMode: ColorModeValue) {
    updateActiveBundle((bundle) => ({
      ...bundle,
      palette: {
        ...bundle.palette,
        defaultColorMode
      }
    }));
  }

  function updateButtonOverride(
    buttonIndex: number,
    patch: Partial<LayoutBundleButtonOverride>,
    preserveLayoutHistory = false
  ) {
    updateActiveBundle((bundle) => ({
      ...bundle,
      layouts: bundle.layouts.map((layout) => layout.objectIdHex === bundle.activeLayoutIdHex
        ? {
            ...layout,
            buttonOverrides: upsertOverride(layout.buttonOverrides, buttonIndex, patch)
          }
        : layout)
    }), preserveLayoutHistory);
  }

  function paintPreviewKey(buttonIndex: number) {
    if (!customColorModeActive) {
      return;
    }
    const preview = previewKeys.find((item) => item.key.index === buttonIndex);
    if (!preview) {
      return;
    }
    const paintKey = paintTarget === "degree" ? `degree:${preview.degree}` : `button:${buttonIndex}`;
    if (lastPaintedTargetRef.current === paintKey) {
      return;
    }
    lastPaintedTargetRef.current = paintKey;
    if (paintTarget === "degree") {
      paintDegreeColor(preview.degree, paintbrushColor);
      setStatus(`Painted scale degree ${preview.degree}`);
    } else {
      updateButtonOverride(buttonIndex, {
        hueTenthDegrees: paintbrushColor.hueTenthDegrees,
        saturation: paintbrushColor.saturation,
        value: paintbrushColor.value
      }, true);
      setStatus(`Painted button ${buttonIndex}`);
    }
  }

  function pickBrushColor(buttonIndex: number) {
    if (!customColorModeActive) {
      return;
    }
    const preview = previewKeys.find((item) => item.key.index === buttonIndex);
    if (!preview) {
      return;
    }
    if (paintTarget === "degree") {
      const degreeColor = normalizeScaleDegreeColors(activeBundle.palette.degreeColors, tuningCycleLength(activeBundle.tuning))
        .find((color) => color.degree === preview.degree) ?? preview.color;
      setPaintbrushColor(degreeColor);
      setStatus(`Picked scale degree ${preview.degree} color`);
    } else {
      setPaintbrushColor(preview.color);
      setStatus(`Picked color from button ${buttonIndex}`);
    }
    selectOnlyButton(buttonIndex);
    setPaintTool("brush");
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
    if (!paintbrushMode || !customColorModeActive) {
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
    paintStrokeHistoryRef.current = {
      label: paintTarget === "degree" ? "scale-degree color painting" : "button color painting",
      bundleId: activeBundle.objectIdHex,
      before: activeBundle,
      selectedButtons: [...selectedButtons],
      primaryButton: selectedButton,
      offGridSelected: [...selectedOffGridCoordinates]
    };
    paintStrokeActiveRef.current = true;
    lastPaintedTargetRef.current = null;
    paintPreviewKey(buttonIndex);
  }

  function continuePaintStroke(event: PointerEvent<HTMLDivElement>) {
    if (!paintbrushMode || paintTool === "eyedropper" || !paintStrokeActiveRef.current) {
      return;
    }
    const buttonIndex = previewButtonIndexFromPointer(event);
    if (buttonIndex !== undefined) {
      paintPreviewKey(buttonIndex);
    }
  }

  function endPaintStroke() {
    const historyStart = paintStrokeHistoryRef.current;
    paintStrokeHistoryRef.current = null;
    paintStrokeActiveRef.current = false;
    lastPaintedTargetRef.current = null;
    if (!historyStart) {
      return;
    }
    const after = activeBundleRef.current;
    if (after.objectIdHex !== historyStart.bundleId || JSON.stringify(after) === JSON.stringify(historyStart.before)) {
      return;
    }
    pushLayoutHistoryEntry({
      label: historyStart.label,
      bundleId: historyStart.bundleId,
      before: historyStart.before,
      after,
      selectedBefore: historyStart.selectedButtons,
      selectedAfter: historyStart.selectedButtons,
      primaryBefore: historyStart.primaryButton,
      primaryAfter: historyStart.primaryButton,
      offGridSelectedBefore: historyStart.offGridSelected,
      offGridSelectedAfter: historyStart.offGridSelected
    });
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
      const shouldRemove = !overrideHasCustomBehavior(withoutColor);
      return {
        ...layout,
        buttonOverrides: shouldRemove
          ? layout.buttonOverrides.filter((candidate) => candidate.buttonIndex !== buttonIndex)
          : layout.buttonOverrides.map((candidate) => candidate.buttonIndex === buttonIndex ? withoutColor : candidate)
      };
    });
  }

  function resetAllButtonColors() {
    const colorOverrideCount = activeLayout.buttonOverrides.filter(overrideHasColor).length;
    if (colorOverrideCount === 0) {
      setStatus("No button color overrides to reset");
      return;
    }
    if (typeof window !== "undefined" && !window.confirm("Reset all keys to scale degree colors? This clears per-button color overrides for the active layout.")) {
      return;
    }
    const nextLayout = {
      ...activeLayout,
      buttonOverrides: resetOverridesToScaleDegreeColors(activeLayout.buttonOverrides)
    };
    commitLayoutHistory("button color reset", bundleWithActiveLayout(nextLayout));
    setPaintTool("brush");
    setStatus(`Reset ${colorOverrideCount} button color ${colorOverrideCount === 1 ? "override" : "overrides"}`);
  }

  function clearButtonNote(buttonIndex: number) {
    updateActiveLayout((layout) => {
      const override = layout.buttonOverrides.find((candidate) => candidate.buttonIndex === buttonIndex);
      if (!override) {
        return layout;
      }
      const { stepsFromC, ...withoutNote } = override;
      void stepsFromC;
      const shouldRemove = !overrideHasCustomBehavior(withoutNote);
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
      selectOnlyButton(noteButtonIndexOrFallback(imported.layouts.find((layout) => layout.objectIdHex === imported.activeLayoutIdHex)?.centerButton ?? imported.layouts[0]?.centerButton ?? 65, 65));
      setActiveWorkspaceTab("tuning");
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
      const currentScalaReference = activeBundle.tuning.kind === "scala";
      const referenceMidiNote = currentScalaReference ? activeBundle.tuning.referenceMidiNote : defaultScalaReferenceMidiNote;
      const referenceHz = currentScalaReference ? activeBundle.tuning.referenceHz : midiNoteToFrequency(referenceMidiNote);
      const importedLabels = keyLabelsFromScalaIntervalLabels(parsed.count, parsed.intervalLabels, referenceMidiNote);
      updateActiveBundle((bundle) => withCycleColors({
        ...bundle,
        tuning: {
          kind: "scala",
          name: fileBaseName(file.name),
          description: parsed.description,
          cents: parsed.cents,
          periodCents: parsed.periodCents,
          cycleLength: parsed.count,
          referenceMidiNote,
          referenceHz,
          keyLabels: importedLabels
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
        defaultColorMode: activeBundle.palette.defaultColorMode,
        cycleLength,
        periodCents: tuningPeriodCents(activeBundle.tuning),
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

  const selectedButtonSet = useMemo(() => new Set(selectedButtons), [selectedButtons]);
  const selectedTransformCount = selectedButtons.length + selectedOffGridCoordinates.length;
  const canTransformSelection = selectedTransformCount > 0;
  const wholeLayoutSelection = selectedOffGridCoordinates.length === 0 &&
    (selectedButtons.length === 1 || selectedButtons.length === previewKeys.length);
  const canUndoLayoutEdit = undoLayoutHistoryRef.current.length > 0 &&
    undoLayoutHistoryRef.current.at(-1)?.bundleId === activeBundle.objectIdHex;
  const canRedoLayoutEdit = redoLayoutHistoryRef.current.length > 0 &&
    redoLayoutHistoryRef.current.at(-1)?.bundleId === activeBundle.objectIdHex;

  function selectPreviewButton(buttonIndex: number, event: MouseEvent<HTMLButtonElement>) {
    if (event.shiftKey) {
      const playableIndices = previewKeys.map((item) => item.key.index);
      const start = playableIndices.indexOf(selectedButton);
      const end = playableIndices.indexOf(buttonIndex);
      if (start >= 0 && end >= 0) {
        const [low, high] = start <= end ? [start, end] : [end, start];
        setSelectedButtons(playableIndices.slice(low, high + 1));
        setSelectedOffGridCoordinates([]);
        setSelectedButton(buttonIndex);
        return;
      }
    }
    if (event.metaKey || event.ctrlKey) {
      setSelectedButtons((current) => {
        const next = new Set(current);
        if (next.has(buttonIndex) && next.size > 1) {
          next.delete(buttonIndex);
        } else {
          next.add(buttonIndex);
        }
        return [...next].sort((left, right) => left - right);
      });
      setSelectedButton(buttonIndex);
      return;
    }
    selectOnlyButton(buttonIndex);
  }

  function transposeSelectedButtons(delta: number) {
    if (!Number.isFinite(delta) || delta === 0) {
      return;
    }
    const stepDelta = Math.round(delta);
    const effectiveSteps = new Map(previewKeys.map((item) => [item.key.index, item.stepsFromC] as const));
    updateActiveLayout((layout) => ({
      ...layout,
      buttonOverrides: selectedButtons.reduce((overrides, buttonIndex) => upsertOverride(overrides, buttonIndex, {
        stepsFromC: (effectiveSteps.get(buttonIndex) ?? 0) + stepDelta
      }), layout.buttonOverrides)
    }));
    setStatus(`Transposed ${selectedButtons.length} selected ${selectedButtons.length === 1 ? "key" : "keys"} by ${formatSignedInteger(stepDelta)} steps`);
  }

  function resetSelectedButtonOverrides() {
    const selected = new Set(selectedButtons);
    updateActiveLayout((layout) => ({
      ...layout,
      buttonOverrides: layout.buttonOverrides.filter((override) => !selected.has(override.buttonIndex))
    }));
    setStatus(`Reset overrides on ${selectedButtons.length} selected ${selectedButtons.length === 1 ? "key" : "keys"}`);
  }

  function bundleWithActiveLayout(nextLayout: LayoutBundleLayout): LayoutBundle {
    return {
      ...activeBundle,
      layouts: activeBundle.layouts.map((layout) => layout.objectIdHex === activeLayout.objectIdHex ? nextLayout : layout)
    };
  }

  function transposeFromLayoutToolbar(delta: number) {
    if (!canTransformSelection || !Number.isFinite(delta) || delta === 0) {
      return;
    }
    const stepDelta = Math.round(delta);
    const label = `${Math.abs(stepDelta)}-step transpose ${stepDelta < 0 ? "down" : "up"}`;
    if (wholeLayoutSelection) {
      const shiftPitch = <T extends LayoutBundleButtonOverride | LayoutBundleGridOverride>(override: T): T => ({
        ...override,
        stepsFromC: override.stepsFromC === undefined ? undefined : override.stepsFromC + stepDelta
      });
      const nextLayout = {
        ...activeLayout,
        centerStepsFromC: activeLayout.centerStepsFromC + stepDelta,
        buttonOverrides: activeLayout.buttonOverrides.map(shiftPitch),
        offGridOverrides: activeLayout.offGridOverrides.map(shiftPitch)
      };
      commitLayoutHistory(label, bundleWithActiveLayout(nextLayout));
      setStatus(`Transposed the full layout by ${formatSignedInteger(stepDelta)} steps around button ${selectedButton}`);
      return;
    }
    const effectiveSteps = new Map(previewKeys.map((item) => [item.key.index, item.stepsFromC] as const));
    const selectedOffGridKeys = new Set(selectedOffGridCoordinates.map(coordinateOverrideKey));
    const nextOffGridOverrides = activeLayout.offGridOverrides.map((override) => selectedOffGridKeys.has(coordinateOverrideKey(override))
      ? { ...override, stepsFromC: (override.stepsFromC ?? 0) + stepDelta }
      : override);
    const nextLayout = {
      ...activeLayout,
      buttonOverrides: selectedButtons.reduce((overrides, buttonIndex) => upsertOverride(overrides, buttonIndex, {
        stepsFromC: (effectiveSteps.get(buttonIndex) ?? 0) + stepDelta
      }), activeLayout.buttonOverrides),
      offGridOverrides: nextOffGridOverrides
    };
    const offGridSelectedAfter = nextOffGridOverrides.filter((override) => selectedOffGridKeys.has(coordinateOverrideKey(override)));
    commitLayoutHistory(label, bundleWithActiveLayout(nextLayout), selectedButtons, selectedButton, offGridSelectedAfter);
    setStatus(`Transposed ${selectedTransformCount} selected keys by ${formatSignedInteger(stepDelta)} steps as overrides`);
  }

  function applyLayoutSpatialTransform(transform: HexSpatialTransform, label: string) {
    if (!canTransformSelection) {
      return;
    }
    const pivotItem = previewKeys.find((item) => item.key.index === selectedButton) ?? previewKeys[0];
    if (!pivotItem) {
      return;
    }
    const pivot = hexKeyAxialCoordinate(pivotItem.key);
    if (wholeLayoutSelection) {
      const generatedLayout = transformGeneratedLayoutAroundKey(activeLayout, pivotItem.key, transform);
      const transformedOverrides = layoutCoordinateOverrides(activeLayout)
        .map((override) => transformCoordinateOverride(override, pivot, transform));
      const nextLayout = {
        ...generatedLayout,
        ...partitionCoordinateOverrides(transformedOverrides)
      };
      commitLayoutHistory(label, bundleWithActiveLayout(nextLayout));
      setStatus(`Applied ${label} to the full layout around button ${selectedButton}`);
      return;
    }

    const selectedItems = previewKeys.filter((item) => selectedButtonSet.has(item.key.index));
    const visibleMovingOverrides = selectedItems.map((item): LayoutBundleGridOverride => ({
      coordCol: item.key.coordCol,
      coordRow: item.key.coordRow,
      role: item.role,
      stepsFromC: item.stepsFromC,
      hueTenthDegrees: item.override?.hueTenthDegrees,
      saturation: item.override?.saturation,
      value: item.override?.value,
      action: item.override?.action
    }));
    const selectedOffGridKeys = new Set(selectedOffGridCoordinates.map(coordinateOverrideKey));
    const offGridMovingOverrides = activeLayout.offGridOverrides
      .filter((override) => selectedOffGridKeys.has(coordinateOverrideKey(override)));
    const movingOverrides = [...visibleMovingOverrides, ...offGridMovingOverrides];
    const transformedOverrides = movingOverrides.map((override) => transformCoordinateOverride(override, pivot, transform));
    const replacedCoordinates = new Set([
      ...movingOverrides.map(coordinateOverrideKey),
      ...transformedOverrides.map(coordinateOverrideKey)
    ]);
    const retainedOverrides = layoutCoordinateOverrides(activeLayout)
      .filter((override) => !replacedCoordinates.has(coordinateOverrideKey(override)));
    const nextLayout = {
      ...activeLayout,
      ...partitionCoordinateOverrides([...retainedOverrides, ...transformedOverrides])
    };
    const selectedAfter = transformedOverrides.flatMap((override) => {
      const key = editableHexKeyByCoordinate.get(coordinateOverrideKey(override));
      return key ? [key.index] : [];
    });
    const uniqueSelectedAfter = [...new Set(selectedAfter)].sort((left, right) => left - right);
    const offGridSelectedAfter = transformedOverrides.filter((override) => !editableHexKeyByCoordinate.has(coordinateOverrideKey(override)));
    commitLayoutHistory(
      label,
      bundleWithActiveLayout(nextLayout),
      uniqueSelectedAfter,
      pivotItem.key.index,
      offGridSelectedAfter
    );
    const outsideCount = offGridSelectedAfter.length;
    setStatus(
      `Applied ${label} to ${movingOverrides.length} keys as overrides` +
      (outsideCount > 0 ? `; retained ${outsideCount} outside the visible board` : "")
    );
  }

  const selectedPreview = previewKeys.find((item) => item.key.index === selectedButton) ?? previewKeys[0];
  const activeCycleLength = tuningCycleLength(activeBundle.tuning);
  const selectedStepsFromReference = selectedPreview.stepsFromC - referenceStepsFromC(activeCycleLength, activeBundle.tuning.referenceMidiNote);
  const selectedPitchCents = tuningStepsToCentsFromReference(activeBundle.tuning, selectedStepsFromReference);
  const selectedFrequencyHz = Math.fround(
    Math.fround(activeBundle.tuning.referenceHz)
      * (2 ** Math.fround(selectedPitchCents / 1200))
  );
  const selectedKeyLabels = normalizeKeyLabels(activeBundle.tuning.keyLabels, activeCycleLength);
  const selectedPitchLabel = selectedKeyLabels[keyLabelIndexFromStepsFromC(selectedPreview.stepsFromC, activeCycleLength)] ?? selectedKeyLabels[0] ?? "A";
  const selectedDegreeColor = normalizeScaleDegreeColors(activeBundle.palette.degreeColors, tuningCycleLength(activeBundle.tuning))
    .find((color) => color.degree === selectedPreview.degree) ?? createDefaultDegreeColors(1)[0];
  const selectedEditableColor = selectedPreview.colorSource === "button" ? selectedPreview.color : selectedDegreeColor;
  const selectedAction = selectedPreview.override?.action;
  const selectedOutputMode: KeyOutputMode = selectedAction?.kind ?? "tuned";
  const selectedChordAction = selectedAction?.kind === "chord"
    ? activeLayout.chordActions.find((action) => action.id === selectedAction.chordActionId)
    : undefined;
  const selectedNearestMidiNote = clampInteger(Math.round(69 + (12 * Math.log2(selectedFrequencyHz / 440))), 0, 127);
  const activeColorModeLabel = colorModeOptions.find((option) => option.value === activeBundle.palette.defaultColorMode)?.label ?? "Default";
  const axisLabels = layoutAxisLabels(activeLayout.deviceRotationSteps);
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
    if (!customColorModeActive) {
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
  function setSelectedAction(action: LayoutBundleButtonAction | undefined) {
    if (action) {
      updateButtonOverride(selectedPreview.key.index, { action });
      return;
    }
    updateActiveLayout((layout) => {
      const override = layout.buttonOverrides.find((candidate) => candidate.buttonIndex === selectedPreview.key.index);
      if (!override) {
        return layout;
      }
      const { action: _removedAction, ...withoutAction } = override;
      void _removedAction;
      return {
        ...layout,
        buttonOverrides: overrideHasCustomBehavior(withoutAction)
          ? layout.buttonOverrides.map((candidate) => candidate.buttonIndex === selectedPreview.key.index ? withoutAction : candidate)
          : layout.buttonOverrides.filter((candidate) => candidate.buttonIndex !== selectedPreview.key.index)
      };
    });
  }
  function setSelectedOutputMode(outputMode: KeyOutputMode) {
    if (outputMode === "tuned") {
      setSelectedAction(undefined);
      return;
    }
    if (outputMode === "direct-midi") {
      setSelectedAction({
        kind: "direct-midi",
        midiNote: selectedAction?.kind === "direct-midi" ? selectedAction.midiNote : selectedNearestMidiNote,
        midiChannel: selectedAction?.kind === "direct-midi" ? selectedAction.midiChannel : 1
      });
      return;
    }
    updateActiveLayout((layout) => {
      const existingAction = layout.chordActions[0];
      const chordAction = existingAction ?? { ...defaultChordShape, id: nextChordActionId(layout.chordActions) };
      return {
        ...layout,
        chordActions: existingAction ? layout.chordActions : [...layout.chordActions, chordAction],
        buttonOverrides: upsertOverride(layout.buttonOverrides, selectedPreview.key.index, {
          action: {
            kind: "chord",
            chordActionId: chordAction.id,
            rootMidiNote: chordAction.pitchMode === "midi-semitones" ? selectedNearestMidiNote : undefined
          }
        })
      };
    });
  }
  function assignSelectedChordAction(chordActionId: number) {
    const chordAction = activeLayout.chordActions.find((action) => action.id === chordActionId);
    if (!chordAction) {
      return;
    }
    setSelectedAction({
      kind: "chord",
      chordActionId,
      rootMidiNote: chordAction.pitchMode === "midi-semitones"
        ? selectedAction?.kind === "chord" && selectedAction.rootMidiNote !== undefined
          ? selectedAction.rootMidiNote
          : selectedNearestMidiNote
        : undefined
    });
  }
  function createAndAssignChordAction() {
    if (activeLayout.chordActions.length >= 16) {
      setStatus("A layout can contain up to 16 chord shapes");
      return;
    }
    updateActiveLayout((layout) => {
      const id = nextChordActionId(layout.chordActions);
      const chordAction = { ...defaultChordShape, id, name: `Chord ${layout.chordActions.length + 1}` };
      return {
        ...layout,
        chordActions: [...layout.chordActions, chordAction],
        buttonOverrides: upsertOverride(layout.buttonOverrides, selectedPreview.key.index, {
          action: { kind: "chord", chordActionId: id, rootMidiNote: selectedNearestMidiNote }
        })
      };
    });
  }
  function updateSelectedChordAction(patch: Partial<LayoutBundleChordAction>) {
    if (!selectedChordAction) {
      return;
    }
    updateActiveLayout((layout) => ({
      ...layout,
      chordActions: layout.chordActions.map((action) => action.id === selectedChordAction.id ? { ...action, ...patch } : action)
    }));
  }
  function updateSelectedColorFromHex(value: string) {
    const nextColor = hexToScaleDegreeColor(value, selectedEditableColor);
    if (selectedPreview.colorSource === "button") {
      updateButtonOverride(selectedPreview.key.index, {
        hueTenthDegrees: nextColor.hueTenthDegrees,
        saturation: nextColor.saturation,
        value: nextColor.value
      });
      return;
    }
    updateDegreeColor(selectedPreview.degree, nextColor);
  }
  const encodedBundle = useMemo(() => {
    return encodeLayoutBundle(bundleForDeviceEncoding(activeBundle));
  }, [activeBundle]);
  const activeApplyObjects = useMemo(() => {
    return activeEncodedGeometryObjects(encodedBundle, activeBundle);
  }, [activeBundle, encodedBundle]);
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
          const buttonMap = linkedButtonMaps.find((map) =>
            objectReferences(map, ExplicitButtonMapTlv.LayoutRef, ObjectType.UserLayout, layoutIdHex)
          );
          return decodeDeviceLayout(layout, index, buttonMap);
        })
      : [createDefaultLayout(cycleLength)];
    const scales = linkedScales.map((scale, index) => decodeDeviceScale(scale, index, cycleLength));
    const bundle = sanitizeEditorBundle({
      objectIdHex: objectIdToHex(deterministicObjectId(`device-geometry:${tuningObjectIdHex}`)),
      tuningObjectIdHex,
      catalogOrder: entry.catalogOrder,
      ...(linkedColorMap ? { colorObjectIdHex: objectIdToHex(linkedColorMap.record.objectId) } : {}),
      name: entry.name,
      folderPath: entry.folderPath,
      tuning,
      palette: {
        defaultColorMode: decodeDeviceDefaultColorMode(linkedColorMap),
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
    selectOnlyButton(noteButtonIndexOrFallback(bundle.layouts.find((layout) => layout.objectIdHex === bundle.activeLayoutIdHex)?.centerButton ?? bundle.layouts[0]?.centerButton ?? 65, 65));
    setCustomFolders((current) => Array.from(new Set([...current, bundle.folderPath])).sort());
    setStatus(statusText);
  }

  async function openHexBoardGeometryBundle(entry: HexBoardGeometryBundleEntry) {
    setSyncBusy(true);
    try {
      const { bundle } = await readHexBoardGeometryBundle(entry);
      openDeviceBundleInEditor(bundle, `Opened ${bundle.name} from HexBoard`);
      setActiveWorkspaceTab("tuning");
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
      const { bundle } = await readHexBoardGeometryBundle(entry);
      await client.deleteGeometryObject(ObjectType.UserTuning, entry.deviceHandle);
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
      const entries = records.map((record, index) => hexBoardGeometryEntryFromRecord(record, index));
      setHexboardBundles(entries);
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
    if (!geometryBundleFilesSupported) {
      setStatus("Update HexBoard firmware before saving geometry bundles.");
      return;
    }
    const sanitizedBundle = sanitizeEditorBundle(bundle);
    if (sanitizedBundle.objectIdHex !== activeBundle.objectIdHex) {
      setActiveBundleId(sanitizedBundle.objectIdHex);
    }
    const encoded = sanitizedBundle.objectIdHex === activeBundle.objectIdHex
      ? encodedBundle
      : encodeLayoutBundle(bundleForDeviceEncoding(sanitizedBundle));
    const applyObjects = activeEncodedGeometryObjects(encoded, sanitizedBundle);
    const applySupported = sanitizedBundle.tuning.kind !== "scala" || centsTableRuntimeSupported;
    setSyncBusy(true);
    try {
      setStatus(`Saving ${sanitizedBundle.name}`);
      await client.sendGeometryBundleSaveConfirmed(encoded.bundleFile);
      if (applySupported) {
        for (let index = 0; index < applyObjects.length; index += 1) {
          const object = applyObjects[index];
          setStatus(`Applying ${object.name} (${index + 1}/${applyObjects.length})`);
          await client.sendGeometryObjectPreviewConfirmed(object);
        }
        if (sanitizedBundle.objectIdHex === activeBundle.objectIdHex) {
          lastAutoSentGeometryKeyRef.current = liveSendKey;
        }
      }
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
    if (!runtimeSendSupported) {
      setStatus("Connected firmware does not advertise cents-table runtime tuning.");
      return;
    }
    lastAutoSentGeometryKeyRef.current = liveSendKey;
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
    if (!liveSend || syncBusy || transport instanceof MockMidiTransport || !runtimeSendSupported) {
      return;
    }
    if (lastAutoSentGeometryKeyRef.current === liveSendKey) {
      return;
    }
    if (skipNextLiveSendRef.current) {
      skipNextLiveSendRef.current = false;
      lastAutoSentGeometryKeyRef.current = liveSendKey;
      return;
    }
    const timeout = window.setTimeout(() => {
      lastAutoSentGeometryKeyRef.current = liveSendKey;
      void sendActiveBundlePreview("Auto-sent");
    }, 450);
    return () => window.clearTimeout(timeout);
  }, [liveSend, liveSendKey, runtimeSendSupported, syncBusy, transport]);

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
    <section
      className={`geometryStudio layoutEditorWorkspace ${activeWorkspaceTab === "library" ? "libraryMode" : "editorMode"}`}
      onPointerDownCapture={(event) => commitIncludedDegreesIfLeaving(event.target)}
    >
      <header className="geometryStudioHeader">
        <div className="geometryTitleBlock">
          <span className="eyebrow">Geometry studio</span>
          <div className="row">
            <h2>{activeBundle.name}</h2>
            <span className="metaBadge">{activeBundle.tuning.name}</span>
          </div>
        </div>
        {activeWorkspaceTab === "library" ? (
          <div className="geometryHeaderActions">
            <button className="primary" type="button" onClick={() => setActiveWorkspaceTab("tuning")}>Edit this bundle</button>
          </div>
        ) : (
          <div className="geometryHeaderActions">
            <label className="checkField liveSendControl">
              <input
                checked={liveSend}
                disabled={!runtimeSendSupported}
                type="checkbox"
                onChange={(event) => {
                  skipNextLiveSendRef.current = true;
                  setLiveSend(event.target.checked);
                }}
              />
              <span>Live send</span>
            </label>
            <button disabled={syncBusy || !runtimeSendSupported} type="button" onClick={() => void sendActiveBundlePreview("Sent")}>Send preview</button>
            <button type="button" onClick={() => saveActiveBundleToComputer()}>Save to computer</button>
            <button className="primary" disabled={syncBusy} type="button" onClick={() => void saveActiveBundleToHexBoard()}>Save to HexBoard</button>
          </div>
        )}
        <div className="geometryStatus" role="status">
          <span aria-hidden="true" />
          {status}
        </div>
      </header>

      <nav className="workflowTabs" aria-label="Geometry editing workflow">
        {geometryWorkspaceTabs.map((tab, index) => (
          <button
            aria-current={activeWorkspaceTab === tab.key ? "step" : undefined}
            className={activeWorkspaceTab === tab.key ? "workflowTab active" : "workflowTab"}
            key={tab.key}
            onClick={() => setActiveWorkspaceTab(tab.key)}
            type="button"
          >
            <span className="workflowStepNumber">{index + 1}</span>
            <span>
              <strong>{tab.label}</strong>
              <small>{tab.description}</small>
            </span>
          </button>
        ))}
      </nav>

      <aside className="panel stack layoutEditorSidebar">
        <input ref={bundleInputRef} className="hiddenFileInput" type="file" accept="application/json,.json" onChange={(event) => void importBundleFile(event)} />
        <input ref={scalaInputRef} className="hiddenFileInput" type="file" accept=".scl,text/plain" onChange={(event) => void importScalaFile(event)} />

        {activeWorkspaceTab === "library" ? (
          <>
            <div className="libraryToolbar">
              <div>
                <span className="eyebrow">Step 1 of 4</span>
                <h2>Geometry library</h2>
              </div>
              <div className="row">
                <button className="primary" type="button" onClick={addNewBundle}>New bundle</button>
                <button type="button" onClick={() => bundleInputRef.current?.click()}>Import file</button>
                <button type="button" onClick={() => downloadBundleFile(activeBundle)}>Export active</button>
                <button disabled={syncBusy} type="button" onClick={() => void refreshHexBoardGeometryLibrary()}>Refresh HexBoard</button>
              </div>
            </div>
            <div className="libraryUtilityBar">
              <FolderControls
                folderLabel={folderLabel}
                folders={customFolders.filter((folder) => folder !== rootFolderPath)}
                itemCount={(folder) => bundles.filter((bundle) => normalizeDisplayFolderPath(bundle.folderPath) === folder).length}
                itemLabel="bundle"
                maxLength={GeometryMenuTextMaxLength}
                newFolder={newFolder}
                onCreate={addFolder}
                onDelete={deleteFolder}
                onNewFolderChange={(value) => setNewFolder(value.slice(0, GeometryMenuTextMaxLength))}
              />
              <button disabled={syncBusy} type="button" onClick={() => void verifyActiveBundleOnHexBoard()}>Verify active bundle</button>
              <span className="muted">{bundles.length} on this computer</span>
            </div>

            <div className="librarySpaces geometryLibrarySpaces">
              <GeometryLibrarySpacePanel
                title="Computer Library"
                subtitle="Browser-saved bundles; drag to reorder"
                space="computer"
                bundles={bundles}
                folders={computerFolders}
                selectedFolder={folderFilters.computer}
                activeBundleId={activeBundle.objectIdHex}
                onFolderSelect={selectFolderFilter}
                onOpen={openBundle}
                onUpload={(bundle) => void saveBundleToHexBoard(bundle)}
                onExport={downloadBundleFile}
                onErase={deleteBundle}
                onReorder={reorderComputerLibrary}
              />
              <HexBoardGeometryLibraryPanel
                entries={hexboardBundles}
                folders={hexboardFolders}
                selectedFolder={folderFilters.hexboard}
                onFolderSelect={selectFolderFilter}
                onOpen={(entry) => void openHexBoardGeometryBundle(entry)}
                onDownload={(entry) => void downloadHexBoardGeometryBundle(entry)}
                onExport={(entry) => void exportHexBoardGeometryBundle(entry)}
                onErase={(entry) => void eraseHexBoardGeometryBundle(entry)}
                onReorder={reorderHexBoardLibrary}
                reorderDisabled={syncBusy}
              />
            </div>
          </>
        ) : null}

        {activeWorkspaceTab !== "library" ? (
          <>
            <div className="inspectorHeading">
              <span className="eyebrow">{geometryWorkspaceCopy[activeWorkspaceTab].eyebrow}</span>
              <h2>{geometryWorkspaceCopy[activeWorkspaceTab].title}</h2>
            </div>
            <div className="bundleIdentityFields">
              <label className="field">
                <span>Bundle name</span>
                <NameInput value={activeBundle.name} onCommit={updateBundleName} />
              </label>
              <label className="field">
                <span>Folder</span>
                <select value={normalizeDisplayFolderPath(activeBundle.folderPath)} onChange={(event) => updateBundleFolder(event.target.value)}>
                  {allFolders.map((folder) => (
                    <option key={folder} value={folder}>{folderLabel(folder)}</option>
                  ))}
                </select>
              </label>
            </div>
          </>
        ) : null}

        {activeWorkspaceTab === "tuning" ? (
          <section className="editorSection">
            <h3>Pitch system</h3>
            <label className="field">
              <span>Type</span>
              <select value={activeBundle.tuning.kind} onChange={(event) => setTuningKind(event.target.value as LayoutBundleTuning["kind"])}>
                <option value="edo">Equal divisions of a period (EDO)</option>
                <option value="equal-step">Fixed cents per step</option>
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

        {activeWorkspaceTab === "layout" ? (
          <section className="editorSection">
            <h3>Key mapping</h3>
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
                <button type="button" onClick={addNewLayout}>New layout</button>
                <button className="warning" type="button" onClick={deleteActiveLayout}>Delete layout</button>
              </div>
              <label className="field">
                <span>Layout name</span>
                <NameInput value={activeLayout.name} onCommit={(name) => updateLayout({ name })} />
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
                  <button type="button" onClick={() => updateLayout({ centerButton: selectedButton })}>Use selected</button>
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
                <span>Device rotation</span>
                <select value={activeLayout.deviceRotationSteps} onChange={(event) => updateLayout({ deviceRotationSteps: Number(event.target.value) })}>
                  <option value={0}>0°</option>
                  <option value={1}>90°</option>
                  <option value={2}>180°</option>
                  <option value={3}>270°</option>
                </select>
                <small className="muted">Changes the physical/display orientation, not the musical axes.</small>
              </label>
            </div>
          </section>
        ) : null}

        {activeWorkspaceTab === "scale" ? (
          <section className="editorSection">
            <h3>Scale degrees</h3>
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
                <button type="button" onClick={addNewScale}>New scale</button>
                <button className="warning" disabled={activeScaleIsAllNotes} type="button" onClick={deleteActiveScale}>Delete scale</button>
              </div>
              <label className="field">
                <span>Scale name</span>
                <NameInput
                  disabled={activeScaleIsAllNotes}
                  value={activeScale.name}
                  onCommit={(name) => updateActiveScale((scale) => ({ ...scale, name: clampGeometryMenuText(name, "User Scale") }))}
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

        {activeWorkspaceTab !== "library" ? (
          <div className="dangerZone">
            <div>
              <strong>Remove bundle</strong>
              <span>Deletes the browser-saved copy from this computer.</span>
            </div>
            <button className="warning" type="button" onClick={deleteActiveBundle}>Delete</button>
          </div>
        ) : null}
      </aside>

      {activeWorkspaceTab !== "library" ? (
        <div className="layoutEditorMainColumn">
        <section className="panel stack boardPanel">
          <div className="boardPanelHeading">
            <div>
              <span className="eyebrow">Live preview</span>
              <h2>HexBoard key map</h2>
            </div>
            <div className="previewContext">
              <span>{activeLayout.name}</span>
              <span>{activeScale.name}</span>
            </div>
          </div>
          <div className="brushToolbar">
            <label className="toolbarSelectField">
              <span>Default color mode</span>
              <select
                value={activeBundle.palette.defaultColorMode}
                onChange={(event) => updateDefaultColorMode(Number(event.target.value) as ColorModeValue)}
              >
                {colorModeOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <button
              aria-pressed={customColorModeActive && paintbrushMode}
              className={customColorModeActive && paintbrushMode ? "primary" : ""}
              disabled={!customColorModeActive}
              type="button"
              onClick={() => {
                endPaintStroke();
                setPaintbrushMode((current) => !current);
                setPaintTool("brush");
              }}
            >
              Paint keys
            </button>
            <label className="toolbarSelectField">
              <span>Paint target</span>
              <select
                disabled={!customColorModeActive}
                value={paintTarget}
                onChange={(event) => {
                  endPaintStroke();
                  setPaintTarget(event.target.value as PaintTarget);
                }}
              >
                <option value="button">Button overrides</option>
                <option value="degree">Scale degrees</option>
              </select>
            </label>
            <button
              aria-pressed={customColorModeActive && paintbrushMode && paintTool === "eyedropper"}
              className={customColorModeActive && paintbrushMode && paintTool === "eyedropper" ? "primary" : ""}
              disabled={!customColorModeActive}
              type="button"
              onClick={() => {
                endPaintStroke();
                setPaintbrushMode(true);
                setPaintTool((current) => current === "eyedropper" ? "brush" : "eyedropper");
              }}
            >
              Pick color
            </button>
            <label className="brushColorField">
              <span>Brush color</span>
              <input
                aria-label="Brush color"
                disabled={!customColorModeActive}
                type="color"
                value={scaleDegreeColorToHex(paintbrushColor)}
                onChange={(event) => setPaintbrushColor((current) => hexToScaleDegreeColor(event.target.value, current))}
              />
            </label>
            <button
              disabled={!customColorModeActive}
              type="button"
              onClick={() => {
                endPaintStroke();
                resetAllButtonColors();
              }}
            >
              Reset colors
            </button>
          </div>
          <div className="layoutTransformToolbar" role="toolbar" aria-label="Layout editing">
            <div className="layoutToolbarGroup" aria-label="History">
              <button
                aria-label="Undo edit"
                disabled={!canUndoLayoutEdit}
                title={canUndoLayoutEdit ? `Undo ${undoLayoutHistoryRef.current.at(-1)?.label}` : "Nothing to undo"}
                type="button"
                onClick={undoLayoutEdit}
              >
                <LayoutToolbarIcon kind="undo" />
              </button>
              <button
                aria-label="Redo edit"
                disabled={!canRedoLayoutEdit}
                title={canRedoLayoutEdit ? `Redo ${redoLayoutHistoryRef.current.at(-1)?.label}` : "Nothing to redo"}
                type="button"
                onClick={redoLayoutEdit}
              >
                <LayoutToolbarIcon kind="redo" />
              </button>
            </div>
            <span aria-hidden="true" className="layoutToolbarDivider" />
            <div className="layoutToolbarGroup" aria-label="Transpose">
              <button aria-label="Transpose down one step" disabled={!canTransformSelection} title="Transpose down one tuning step" type="button" onClick={() => transposeFromLayoutToolbar(-1)}>
                <span aria-hidden="true" className="layoutToolbarTextIcon">−1</span>
              </button>
              <button aria-label="Transpose up one step" disabled={!canTransformSelection} title="Transpose up one tuning step" type="button" onClick={() => transposeFromLayoutToolbar(1)}>
                <span aria-hidden="true" className="layoutToolbarTextIcon">+1</span>
              </button>
            </div>
            <span aria-hidden="true" className="layoutToolbarDivider" />
            <div className="layoutToolbarGroup" aria-label="Rotate">
              <button aria-label="Rotate counterclockwise" disabled={!canTransformSelection} title="Rotate 60° counterclockwise around the primary key" type="button" onClick={() => applyLayoutSpatialTransform("rotate-counterclockwise", "counterclockwise rotation")}>
                <LayoutToolbarIcon kind="rotate-counterclockwise" />
              </button>
              <button aria-label="Rotate clockwise" disabled={!canTransformSelection} title="Rotate 60° clockwise around the primary key" type="button" onClick={() => applyLayoutSpatialTransform("rotate-clockwise", "clockwise rotation")}>
                <LayoutToolbarIcon kind="rotate-clockwise" />
              </button>
            </div>
            <span aria-hidden="true" className="layoutToolbarDivider" />
            <div className="layoutToolbarGroup" aria-label="Mirror">
              <button aria-label="Mirror horizontally" disabled={!canTransformSelection} title="Mirror left/right for the current device rotation" type="button" onClick={() => applyLayoutSpatialTransform(deviceRelativeMirrorTransform(activeLayout.deviceRotationSteps, "horizontal"), "horizontal mirror")}>
                <LayoutToolbarIcon kind="mirror-horizontal" />
              </button>
              <button aria-label="Mirror vertically" disabled={!canTransformSelection} title="Mirror up/down for the current device rotation" type="button" onClick={() => applyLayoutSpatialTransform(deviceRelativeMirrorTransform(activeLayout.deviceRotationSteps, "vertical"), "vertical mirror")}>
                <LayoutToolbarIcon kind="mirror-vertical" />
              </button>
            </div>
            <span className="selectionStatus layoutSelectionStatus" aria-live="polite">
              <span className="selectionStatusItem">
                {selectedTransformCount > 0 ? <span aria-hidden="true" className="selectionStatusSwatch" /> : null}
                {selectedTransformCount} selected
                {selectedOffGridCoordinates.length > 0 ? ` · ${selectedOffGridCoordinates.length} outside board` : ""}
              </span>
              {selectedTransformCount > 0 ? (
                <span className="selectionStatusItem">
                  <span aria-hidden="true" className="selectionStatusSwatch primary" />
                  Button {selectedButton} primary
                </span>
              ) : null}
              {selectedTransformCount > 0 ? (
                <span className="layoutTransformMode">
                  {wholeLayoutSelection ? "Full layout" : "Overrides"}
                </span>
              ) : null}
            </span>
            {selectedTransformCount > 0 ? (
              <button
                className="layoutDeselectButton"
                type="button"
                onClick={() => {
                  setSelectedButtons([]);
                  setSelectedOffGridCoordinates([]);
                }}
              >
                Deselect All
              </button>
            ) : null}
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
              style={{ transform: `rotate(${activeLayout.deviceRotationSteps * 90}deg)` }}
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
              {previewKeys.filter((item) => selectedButtonSet.has(item.key.index)).map((item) => (
                <div
                  aria-hidden="true"
                  className={`hexSelectionHalo ${item.key.index === selectedButton ? "primarySelectionHalo" : ""}`}
                  key={`selection-${item.key.index}`}
                  style={{
                    left: `${previewHexInset + (item.key.coordCol * previewHexHalfStepX)}px`,
                    top: `${previewHexInset + (item.key.row * previewHexRowStepY)}px`
                  }}
                />
              ))}
              {previewKeys.map((item) => (
                <button
                  aria-label={`Button ${item.key.index}, ${item.role}, step ${item.stepsFromC}`}
                  aria-pressed={selectedButtonSet.has(item.key.index)}
                  className={[
                    "hexKey",
                    item.role === "unused" ? "unusedKey" : "",
                    !item.inScale ? "outOfScaleKey" : "",
                    item.colorSource === "button" ? "manualColorKey" : "",
                    item.noteSource === "button" ? "manualNoteKey" : "",
                    selectedButtonSet.has(item.key.index) ? "selectedKey" : "",
                    item.key.index === activeLayout.centerButton ? "centerKey" : "",
                    item.key.index === guideOriginIndex ? "guideOriginKey" : "",
                    item.key.index === guideTargetIndex ? "guideTargetKey" : ""
                  ].filter(Boolean).join(" ")}
                  data-preview-button-index={item.key.index}
                  key={item.key.index}
                  onClick={(event) => {
                    if (!paintbrushMode) {
                      selectPreviewButton(item.key.index, event);
                    }
                  }}
                  style={{
                    left: `${previewHexInset + 2 + (item.key.coordCol * previewHexHalfStepX)}px`,
                    top: `${previewHexInset + 2 + (item.key.row * previewHexRowStepY)}px`,
                    backgroundColor: colorToCss(item.color)
                  }}
                  type="button"
                >
                  <span className="hexKeyLabel" style={{ transform: `rotate(${-activeLayout.deviceRotationSteps * 90}deg)` }}>
                    <span>{item.key.index}</span>
                    <small>{item.role !== "note" ? "off" : item.override?.action?.kind === "direct-midi" ? `M${item.override.action.midiNote}` : item.override?.action?.kind === "chord" ? "chord" : item.degree}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <details className="panel selectedKeyPanel">
          <summary className="selectedKeyHeading">
            <div>
              <span className="eyebrow">Key inspector</span>
              <strong>{selectedButtons.length > 1 ? `${selectedButtons.length} keys selected` : `Button ${selectedPreview.key.index}`}</strong>
              <span>{selectedButtons.length > 1 ? `Primary button ${selectedPreview.key.index}` : `row ${selectedPreview.key.row} · column ${selectedPreview.key.column}`}</span>
            </div>
            <div className="keySummaryBadges">
              {selectedPreview.role === "note" ? (
                <>
                  <span className="metaBadge">{selectedPitchLabel} · {formatHertz(selectedFrequencyHz)}</span>
                  <span className={selectedPreview.inScale ? "keyStateBadge inScale" : "keyStateBadge outOfScale"}>
                    {selectedPreview.inScale ? "In scale" : "Out of scale"}
                  </span>
                </>
              ) : (
                <span className="keyStateBadge off">Off</span>
              )}
            </div>
          </summary>
          <div className="selectedKeyContent stack">
            {selectedButtons.length > 1 ? (
              <section className="keyInspectorSection bulkKeySection">
                <h3>Bulk pitch</h3>
                <p className="muted">Shift-click selects a range. Ctrl-click or Command-click toggles individual keys.</p>
                <div className="row">
                  <button type="button" onClick={() => transposeSelectedButtons(-1)}>−1 step</button>
                  <button type="button" onClick={() => transposeSelectedButtons(1)}>+1 step</button>
                  <button type="button" onClick={() => transposeSelectedButtons(-activeCycleLength)}>−1 period</button>
                  <button type="button" onClick={() => transposeSelectedButtons(activeCycleLength)}>+1 period</button>
                  <button className="warning" type="button" onClick={resetSelectedButtonOverrides}>Reset selected</button>
                </div>
              </section>
            ) : null}
            <section className="keyInspectorSection">
              <h3>State</h3>
              <div className="segmentedControl" role="group" aria-label="Key state">
                <button
                  aria-pressed={selectedPreview.role === "note"}
                  className={selectedPreview.role === "note" ? "active" : ""}
                  type="button"
                  onClick={() => updateButtonOverride(selectedPreview.key.index, { role: "note" })}
                >
                  Note
                </button>
                <button
                  aria-pressed={selectedPreview.role === "unused"}
                  className={selectedPreview.role === "unused" ? "active" : ""}
                  type="button"
                  onClick={() => updateButtonOverride(selectedPreview.key.index, { role: "unused" })}
                >
                  Off
                </button>
              </div>
            </section>

            {selectedPreview.role === "note" ? (
              <section className="keyInspectorSection">
                <h3>Pitch</h3>
                <div className="keyFacts">
                  <div>
                    <span>Layout step</span>
                    <strong>{selectedPreview.generatedStepsFromC}</strong>
                  </div>
                  <div>
                    <span>Scale degree</span>
                    <strong>{selectedPreview.degree}</strong>
                  </div>
                </div>
                <label className="checkField keyOverrideToggle">
                  <input
                    checked={selectedPreview.noteSource === "button"}
                    type="checkbox"
                    onChange={(event) => setSelectedNoteSource(event.target.checked ? "button" : "generated")}
                  />
                  <span>Override pitch</span>
                </label>
                {selectedPreview.noteSource === "button" ? (
                  <label className="field">
                    <span>Step from C</span>
                    <div className="fieldControlRow">
                      <input
                        type="number"
                        value={selectedPreview.stepsFromC}
                        onChange={(event) => updateButtonOverride(selectedPreview.key.index, { stepsFromC: Number(event.target.value) })}
                      />
                      <button type="button" onClick={() => setSelectedNoteSource("generated")}>Use layout</button>
                    </div>
                  </label>
                ) : null}
                <details className="keyAdvancedDetails">
                  <summary>Advanced pitch details</summary>
                  <div>
                    <span>From reference</span>
                    <strong>{formatSignedInteger(selectedStepsFromReference)} steps · {formatCents(selectedPitchCents)}</strong>
                  </div>
                </details>
              </section>
            ) : null}

            {selectedPreview.role === "note" ? (
              <details className="keyInspectorSection keyOutputDetails">
                <summary>
                  <span>Advanced output</span>
                  <strong>{selectedOutputMode === "tuned" ? "Tuned note" : selectedOutputMode === "direct-midi" ? "Direct MIDI" : "Chord"}</strong>
                </summary>
                <div className="stack compactStack">
                  <p className="muted">Most layouts should keep Tuned note. Direct MIDI and chords bypass the normal one-note tuning output for this key.</p>
                  {selectedButtons.length > 1 ? <small className="muted">These settings apply to primary button {selectedPreview.key.index} only.</small> : null}
                  <label className="field">
                    <span>Key output</span>
                    <select value={selectedOutputMode} onChange={(event) => setSelectedOutputMode(event.target.value as KeyOutputMode)}>
                      <option value="tuned">Tuned note</option>
                      <option value="direct-midi">Direct MIDI note</option>
                      <option value="chord">Chord</option>
                    </select>
                  </label>

                  {selectedAction?.kind === "direct-midi" ? (
                    <div className="keyOutputGrid">
                      <label className="field">
                        <span>MIDI note</span>
                        <input
                          max={127}
                          min={0}
                          type="number"
                          value={selectedAction.midiNote}
                          onChange={(event) => setSelectedAction({ ...selectedAction, midiNote: clampInteger(Number(event.target.value), 0, 127) })}
                        />
                      </label>
                      <label className="field">
                        <span>MIDI channel</span>
                        <input
                          max={16}
                          min={1}
                          type="number"
                          value={selectedAction.midiChannel}
                          onChange={(event) => setSelectedAction({ ...selectedAction, midiChannel: clampInteger(Number(event.target.value), 1, 16) })}
                        />
                      </label>
                    </div>
                  ) : null}

                  {selectedAction?.kind === "chord" && selectedChordAction ? (
                    <>
                      <div className="fieldControlRow">
                        <label className="field growField">
                          <span>Chord shape</span>
                          <select value={selectedChordAction.id} onChange={(event) => assignSelectedChordAction(Number(event.target.value))}>
                            {activeLayout.chordActions.map((action) => <option key={action.id} value={action.id}>{action.name}</option>)}
                          </select>
                        </label>
                        <button type="button" onClick={createAndAssignChordAction}>New shape</button>
                      </div>
                      <label className="field">
                        <span>Shape name</span>
                        <NameInput value={selectedChordAction.name} onCommit={(name) => updateSelectedChordAction({ name })} />
                      </label>
                      <label className="field">
                        <span>Interval units</span>
                        <select
                          value={selectedChordAction.pitchMode}
                          onChange={(event) => {
                            const pitchMode = event.target.value as LayoutBundleChordAction["pitchMode"];
                            updateSelectedChordAction({ pitchMode });
                            setSelectedAction({
                              ...selectedAction,
                              rootMidiNote: pitchMode === "midi-semitones" ? selectedAction.rootMidiNote ?? selectedNearestMidiNote : undefined
                            });
                          }}
                        >
                          <option value="tuning-steps">Current tuning steps</option>
                          <option value="midi-semitones">MIDI semitones</option>
                        </select>
                      </label>
                      <label className="field">
                        <span>{selectedChordAction.pitchMode === "tuning-steps" ? "Tuning-step intervals" : "Semitone intervals"}</span>
                        <ChordIntervalsInput value={selectedChordAction.intervals} onCommit={(intervals) => updateSelectedChordAction({ intervals })} />
                        <small>Up to four tones, relative to the key. Example: 0, 4, 7.</small>
                      </label>
                      {selectedChordAction.pitchMode === "midi-semitones" ? (
                        <div className="keyOutputGrid">
                          <label className="field">
                            <span>Root MIDI note</span>
                            <input
                              max={127}
                              min={0}
                              type="number"
                              value={selectedAction.rootMidiNote ?? selectedNearestMidiNote}
                              onChange={(event) => setSelectedAction({ ...selectedAction, rootMidiNote: clampInteger(Number(event.target.value), 0, 127) })}
                            />
                          </label>
                          <label className="field">
                            <span>MIDI channel</span>
                            <input
                              max={16}
                              min={1}
                              type="number"
                              value={selectedChordAction.midiChannel}
                              onChange={(event) => updateSelectedChordAction({ midiChannel: clampInteger(Number(event.target.value), 1, 16) })}
                            />
                          </label>
                        </div>
                      ) : (
                        <small className="muted">Tuning-step chords follow the active tuning and MIDI/MPE routing settings.</small>
                      )}
                    </>
                  ) : null}
                </div>
              </details>
            ) : null}

            <section className="keyInspectorSection">
              <h3>Color</h3>
              <div className="keyColorSummary">
                <span
                  aria-hidden="true"
                  className="keyColorSwatch"
                  style={{ backgroundColor: colorToCss(customColorModeActive ? selectedEditableColor : selectedPreview.color) }}
                />
                <div>
                  <strong>{selectedPreview.colorSource === "button" ? "This key" : `Degree ${selectedPreview.degree}`}</strong>
                  <span>{selectedPreview.colorSource === "button" ? "Key override" : `${activeColorModeLabel} color`}</span>
                </div>
              </div>
              {customColorModeActive ? (
                <>
                  <div className="keyColorControls">
                    <label className="keyColorPicker">
                      <span>Color</span>
                      <input
                        aria-label="Selected key color"
                        type="color"
                        value={scaleDegreeColorToHex(selectedEditableColor)}
                        onChange={(event) => updateSelectedColorFromHex(event.target.value)}
                      />
                    </label>
                    {selectedPreview.colorSource === "button" ? (
                      <button type="button" onClick={() => setSelectedColorSource("degree")}>Use degree color</button>
                    ) : (
                      <button type="button" onClick={() => setSelectedColorSource("button")}>Override this key</button>
                    )}
                  </div>
                  <small className="muted">
                    {selectedPreview.colorSource === "button"
                      ? "This color applies only to the selected key."
                      : `Changing this color updates every key using degree ${selectedPreview.degree}.`}
                  </small>
                </>
              ) : (
                <div className="keyColorInactive">
                  <span>Colors currently follow {activeColorModeLabel} mode.</span>
                  <button type="button" onClick={() => updateDefaultColorMode(ColorMode.Custom)}>Switch to Custom</button>
                </div>
              )}
            </section>

            <div className="keyResetRow">
              <span>{selectedPreview.override ? "This key has custom settings." : "This key follows the layout defaults."}</span>
              <button
                className="warning"
                disabled={!selectedPreview.override}
                type="button"
                onClick={() => resetButtonOverride(selectedPreview.key.index)}
              >
                Reset all key overrides
              </button>
            </div>
          </div>
        </details>
      </div>
      ) : null}

      <details className="panel protocolDebugPanel">
        <summary>
          <span>Developer details</span>
          <small>Encoded object preview</small>
        </summary>
        <pre className="dataPreview">{encodedPreview}</pre>
      </details>
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
  onFolderSelect: (space: GeometryLibrarySpace, folderPath: string | null) => void;
  onOpen: (bundle: LayoutBundle) => void;
  onUpload: (bundle: LayoutBundle) => void;
  onExport: (bundle: LayoutBundle) => void;
  onErase: (bundle: LayoutBundle) => void;
  onReorder: (draggedId: string, targetId: string) => void;
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
  onErase,
  onReorder
}: GeometryLibrarySpacePanelProps) {
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
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
        <button
          aria-pressed={selectedFolder === null}
          className={selectedFolder === null ? "folderTarget systemFolderTarget active" : "folderTarget systemFolderTarget"}
          onClick={() => onFolderSelect(space, null)}
          type="button"
        >
          <span>All</span>
          <span>{bundles.length}</span>
        </button>
        {folders.map((folder) => (
          <button
            aria-pressed={folder === selectedFolder}
            className={`folderTarget${folder === rootFolderPath ? " systemFolderTarget" : ""}${folder === selectedFolder ? " active" : ""}`}
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
            <li
              className={`${bundle.objectIdHex === activeBundleId ? "listItem presetListItem activeListItem" : "listItem presetListItem"}${dropTargetId === bundle.objectIdHex ? " reorderDropTarget" : ""}`}
              draggable
              key={bundle.objectIdHex}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData(geometryOrderDragMime, `${space}:${bundle.objectIdHex}`);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropTargetId(bundle.objectIdHex);
              }}
              onDragLeave={() => setDropTargetId(null)}
              onDrop={(event) => {
                event.preventDefault();
                setDropTargetId(null);
                const [sourceSpace, draggedId] = event.dataTransfer.getData(geometryOrderDragMime).split(":");
                if (sourceSpace === space && draggedId) onReorder(draggedId, bundle.objectIdHex);
              }}
            >
              <div className="presetMeta">
                <strong>{bundle.name}</strong>
                <span>{folderLabel(bundle.folderPath)}</span>
                <span>{bundle.tuning.name}</span>
                <span>{colorModeOptions.find((option) => option.value === bundle.palette.defaultColorMode)?.label ?? "Custom"} default</span>
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
  onFolderSelect: (space: GeometryLibrarySpace, folderPath: string | null) => void;
  onOpen: (entry: HexBoardGeometryBundleEntry) => void;
  onDownload: (entry: HexBoardGeometryBundleEntry) => void;
  onExport: (entry: HexBoardGeometryBundleEntry) => void;
  onErase: (entry: HexBoardGeometryBundleEntry) => void;
  onReorder: (draggedId: string, targetId: string) => void;
  reorderDisabled: boolean;
}

function HexBoardGeometryLibraryPanel({
  entries,
  folders,
  selectedFolder,
  onFolderSelect,
  onOpen,
  onDownload,
  onExport,
  onErase,
  onReorder,
  reorderDisabled
}: HexBoardGeometryLibraryPanelProps) {
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const visibleEntries = selectedFolder
    ? entries.filter((entry) => normalizeDisplayFolderPath(entry.folderPath) === selectedFolder)
    : entries;

  return (
    <section className="librarySpace">
      <div className="librarySpaceHeader">
        <div>
          <h3>HexBoard Library</h3>
          <span className="muted">Saved tuning entries; drag to reorder on HexBoard</span>
        </div>
        <span className="countBadge">{visibleEntries.length}</span>
      </div>

      <div className="folderTargets">
        <button
          aria-pressed={selectedFolder === null}
          className={selectedFolder === null ? "folderTarget systemFolderTarget active" : "folderTarget systemFolderTarget"}
          onClick={() => onFolderSelect("hexboard", null)}
          type="button"
        >
          <span>All</span>
          <span>{entries.length}</span>
        </button>
        {folders.map((folder) => (
          <button
            aria-pressed={folder === selectedFolder}
            className={`folderTarget${folder === rootFolderPath ? " systemFolderTarget" : ""}${folder === selectedFolder ? " active" : ""}`}
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
            <li
              className={`listItem presetListItem${dropTargetId === entry.objectIdHex ? " reorderDropTarget" : ""}`}
              draggable={!reorderDisabled}
              key={`${entry.deviceHandle}-${entry.objectIdHex}`}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData(geometryOrderDragMime, `hexboard:${entry.objectIdHex}`);
              }}
              onDragOver={(event) => {
                if (reorderDisabled) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropTargetId(entry.objectIdHex);
              }}
              onDragLeave={() => setDropTargetId(null)}
              onDrop={(event) => {
                event.preventDefault();
                setDropTargetId(null);
                if (reorderDisabled) return;
                const [sourceSpace, draggedId] = event.dataTransfer.getData(geometryOrderDragMime).split(":");
                if (sourceSpace === "hexboard" && draggedId) onReorder(draggedId, entry.objectIdHex);
              }}
            >
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

interface NameInputProps {
  value: string;
  onCommit: (value: string) => void;
  disabled?: boolean;
}

function NameInput({ value, onCommit, disabled = false }: NameInputProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  function commit() {
    onCommit(draft);
  }
  return (
    <input
      disabled={disabled}
      maxLength={GeometryMenuTextMaxLength}
      value={draft}
      onBlur={commit}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          commit();
          event.currentTarget.blur();
        }
      }}
    />
  );
}

interface ChordIntervalsInputProps {
  value: number[];
  onCommit: (value: number[]) => void;
}

function ChordIntervalsInput({ value, onCommit }: ChordIntervalsInputProps) {
  const formattedValue = value.join(", ");
  const [draft, setDraft] = useState(formattedValue);
  useEffect(() => setDraft(formattedValue), [formattedValue]);
  function commit() {
    const parts = draft.split(/[\s,]+/).filter(Boolean);
    if (parts.length < 1 || parts.length > 4 || parts.some((part) => !/^-?\d+$/.test(part))) {
      setDraft(formattedValue);
      return;
    }
    onCommit(parts.map((part) => clampInteger(Number(part), -32768, 32767)));
  }
  return (
    <input
      aria-label="Chord intervals"
      inputMode="numeric"
      title="Enter one to four whole-number intervals separated by commas or spaces"
      value={draft}
      onBlur={commit}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          commit();
          event.currentTarget.blur();
        }
      }}
    />
  );
}

interface TuningControlsProps {
  tuning: LayoutBundleTuning;
  onEdoChange: (patch: Partial<Extract<LayoutBundleTuning, { kind: "edo" }>>) => void;
  onEqualStepChange: (patch: Partial<Extract<LayoutBundleTuning, { kind: "equal-step" }>>) => void;
  onScalaChange: (patch: Partial<Extract<LayoutBundleTuning, { kind: "scala" }>>) => void;
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
    const stepCents = Math.fround(Math.fround(tuning.periodCents) / Math.max(1, tuning.edoDivisions));
    return (
      <div className="fieldGrid">
        <label className="field">
          <span>Name</span>
          <NameInput value={tuning.name} onCommit={(name) => onEdoChange({ name })} />
        </label>
        <label className="field">
          <span>Divisions</span>
          <input min={1} max={MaxTuningDivisions} type="number" value={tuning.edoDivisions} onChange={(event) => onEdoChange({ edoDivisions: Number(event.target.value) })} />
        </label>
        <label className="field">
          <span>Period cents</span>
          <input step="any" type="number" value={tuning.periodCents} onChange={(event) => onEdoChange({ periodCents: Number(event.target.value) })} />
          <small className="muted">Exact division: {tuning.periodCents} ÷ {tuning.edoDivisions} = {stepCents.toFixed(6)}… cents per step</small>
          <small className="muted">Saved at firmware-native 32-bit precision.</small>
        </label>
        <label className="field">
          <span>A = x Hz</span>
          <input min={0.01} step="any" type="number" value={tuning.referenceHz} onChange={(event) => onEdoChange({ referenceHz: Number(event.target.value) })} />
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
    const computedPeriod = Math.fround(Math.fround(tuning.stepCents) * tuning.cycleLength);
    const octaveDelta = computedPeriod - 1200;
    return (
      <div className="fieldGrid">
        <label className="field">
          <span>Name</span>
          <NameInput value={tuning.name} onCommit={(name) => onEqualStepChange({ name })} />
        </label>
        <label className="field">
          <span>Step cents</span>
          <input step="any" type="number" value={tuning.stepCents} onChange={(event) => onEqualStepChange({ stepCents: Number(event.target.value) })} />
          <small className="muted">Saved at firmware-native 32-bit precision.</small>
        </label>
        <label className="field">
          <span>Cycle length</span>
          <input min={1} max={MaxTuningDivisions} type="number" value={tuning.cycleLength} onChange={(event) => onEqualStepChange({ cycleLength: Number(event.target.value) })} />
          <small className={Math.abs(octaveDelta) > 0.0005 ? "fieldError" : "muted"}>
            Cycle period: {computedPeriod.toFixed(3)} cents{Math.abs(octaveDelta) > 0.0005 ? ` (${octaveDelta > 0 ? "+" : ""}${octaveDelta.toFixed(3)} from an octave)` : ""}
          </small>
        </label>
        <label className="field">
          <span>A = x Hz</span>
          <input min={0.01} step="any" type="number" value={tuning.referenceHz} onChange={(event) => onEqualStepChange({ referenceHz: Number(event.target.value) })} />
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
    <div className="fieldGrid">
      <div className="row">
        <button type="button" onClick={onImportScala}>Import .scl</button>
        <span className="muted">{tuning.cents.length} intervals</span>
      </div>
      <label className="field">
        <span>Name</span>
        <NameInput value={tuning.name} onCommit={(name) => onScalaChange({ name })} />
      </label>
      <label className="field">
        <span>Description</span>
        <input value={tuning.description} onChange={(event) => onScalaChange({ description: event.target.value })} />
      </label>
      <label className="field">
        <span>1/1 MIDI note</span>
        <input min={0} max={127} type="number" value={tuning.referenceMidiNote} onChange={(event) => onScalaChange({ referenceMidiNote: Number(event.target.value) })} />
      </label>
      <label className="field">
        <span>1/1 Hz</span>
        <input min={0.01} step="any" type="number" value={tuning.referenceHz} onChange={(event) => onScalaChange({ referenceHz: Number(event.target.value) })} />
        <small className="muted">Intervals and reference frequency are saved at firmware-native 32-bit precision.</small>
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
