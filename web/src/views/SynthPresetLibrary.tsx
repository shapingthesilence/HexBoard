import {writeStoredText} from "../editor/autosave.ts";
import { sameContent, useEditorDrafts } from "../editor/drafts.ts";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import {
  createSynthPresetObject,
  createSynthWavetableObject,
  createSynthWavetableMetadataObject,
  createFactorySynthWavetables,
  crunchSerumWavetable,
  deterministicObjectId,
  encodeHexBoardWavetableWav,
  objectIdFromHex,
  objectIdToHex,
  parseHexBoardWavetable,
  synthWavetableBaseSamples,
  SYNTH_WAVETABLE_FRAME_COUNT,
  SYNTH_WAVETABLE_MIP_SAMPLE_BYTES,
  synthWavetableMipLevelCount,
  synthWavetableMipLevelHarmonicLimit,
  synthWavetableMipLevelSampleCount,
  synthWavetableMipLevelSamples,
  SYNTH_WAVETABLE_SAMPLE_BYTES,
  SynthPresetTlv,
  SAMPLER_ENVELOPE_OVERRIDE_ALL,
  type SynthPresetSampler,
  SynthSettingKey,
  SynthWavetableTlv,
  type SerumWavetableCrunchOptions,
  type SynthPresetValues,
  type SynthSettingName,
  type WavetableFrameReduction,
  type WavetableNormalization
} from "../catalogs/index.ts";
import { createBasicShapesSamples } from "../catalogs/factoryWavetables.ts";
import { SynthPreviewController, type SynthPreviewPatch, type SynthVoiceShapeListener } from "../audio/synthPreview.ts";
import { SynthMidiPreview } from "../components/SynthMidiPreview.tsx";
import { MockMidiTransport } from "../midi/mockTransport.ts";
import { PresetSyncClient } from "../midi/presetSyncClient.ts";
import type { MidiTransport } from "../midi/types.ts";
import { WebMidiTransport } from "../midi/webMidi.ts";
import { crc32 } from "../protocol/crc32.ts";
import { HEXBOARD_PRESET_NAME_MAX_BYTES, hexboardPresetCapacityProblem } from "../catalogs/hexboardPresetCapacity.ts";
import { SynthWavetableSelector, type ObjectListRecord } from "../protocol/index.ts";
import { CommonTlv, decodeObjectBody, textFromBytes } from "../protocol/tlv.ts";
import { FolderControls } from "../components/FolderControls.tsx";
import { LibraryBulkActions } from "../components/LibraryBulkActions.tsx";
import { OrganizeLibraryItemDialog, type LibraryOrganizationConflict } from "../components/OrganizeLibraryItemDialog.tsx";
import { formatByteLength, formatHex } from "./format.ts";
import {
  synthValueKeys,
  synthVibratoSpeedNoise,
  type EditableSynthValueKey,
  type EditableSynthValues
} from "./classicSynth/classicSynthModel.ts";
export { wheelAmountByteToPercent, wheelAmountPercentToByte } from "./classicSynth/classicSynthModel.ts";
import { ClassicKnob, ClassicSoundEditor } from "./classicSynth/ClassicSoundEditor.tsx";
import { ClassicSamplerSoundEditor, type SamplerInstrumentStatus } from "./classicSynth/ClassicSamplerSoundEditor.tsx";
import { ClassicSamplerClient } from "../advanced/synth/sampler/classicClient.ts";

interface SynthPresetLibraryProps {
  transport: MidiTransport;
}

type LibrarySpace = "computer" | "hexboard";
type SynthLibraryKind = "presets" | "wavetables";
type WavetableImportFormat = "serum-vital" | "hexboard";

interface WavetableImportSource {
  fileName: string;
  format: WavetableImportFormat;
  bytes: Uint8Array;
}

interface RenderedWavetableImport {
  source: WavetableImportSource;
  samples?: Uint8Array;
  sampleCrc?: number;
  error?: string;
}


interface EditableSynthPreset {
  objectIdHex: string;
  deviceHandle?: number;
  name: string;
  folderPath: string;
  wavetableName: string;
  wavetableFolderPath: string;
  favorite: boolean;
  values: EditableSynthValues;
  /** Classic sampler sounds play this instrument; Sync sets it when the sound is made. */
  sampler?: SynthPresetSampler;
}

interface EditableSynthWavetable {
  objectIdHex: string;
  deviceHandle?: number;
  name: string;
  folderPath: string;
  samples?: Uint8Array;
  sampleCrc?: number;
}

interface DraggedPreset {
  space: LibrarySpace;
  objectIdHex: string;
}

interface PresetOrganizationRequest {
  space: LibrarySpace;
  preset: EditableSynthPreset;
  initialFolderPath?: string;
}

type WavetableResolutionChoice =
  | { kind: "upload" }
  | { kind: "alternate"; wavetable: { name: string; folderPath: string } }
  | null;

interface WavetableResolutionRequest {
  presetName: string;
  requiredName: string;
  matchingComputerWavetable?: EditableSynthWavetable;
  resolve: (choice: WavetableResolutionChoice) => void;
}

const computerLibraryStorageKey = "hexboard.synthPresetComputerLibrary.v1";
const computerWavetableStorageKey = "hexboard.synthWavetableComputerLibrary.v1";
const computerWavetableFactorySeedStorageKey = "hexboard.synthWavetableFactorySeed.v1";
const synthPresetFoldersStorageKey = "hexboard.synthPresetFolders.v1";
const synthWavetableFoldersStorageKey = "hexboard.synthWavetableFolders.v1";
const presetFileFormat = "hexboard.synthPreset.v1";
const presetLibraryFileFormat = "hexboard.synthPresetLibrary.v1";
const wavetableFileFormat = "hexboard.synthWavetable.v1";
const builtInWavetableFolder = "/Built In";
const factoryWavetableFolder = "/";
const basicWavetableName = "Basic Shapes";
const deviceNameMaxBytes = 31;
const deviceFolderMaxBytes = 47;
/** Where the board and Sync put sounds made for instruments. */
const samplerSoundFolder = "Instruments";

const defaultPreset: EditableSynthPreset = {
  objectIdHex: objectIdToHex(deterministicObjectId("Soft String Pad")),
  name: "Soft String Pad",
  folderPath: "Pads",
  wavetableName: "Classic",
  wavetableFolderPath: factoryWavetableFolder,
  favorite: true,
  values: {
    PlaybackMode: 3,
    Waveform: 27,
    SynthDrive: 0,
    SynthModTarget: 0,
    SynthModAmount: 127,
    SynthVibratoSpeed: 5,
    ArpeggiatorDivision: 32,
    SynthBPM: 120,
    EnvelopeAttackIndex: 12,
    EnvelopeHoldIndex: 0,
    EnvelopeDecayIndex: 14,
    EnvelopeSustainLevel: 100,
    EnvelopeReleaseIndex: 14,
    EffectEnvelopeTarget: 1,
    EffectEnvelopeAmount: 254,
    EffectEnvelopeAttackIndex: 0,
    EffectEnvelopeHoldIndex: 0,
    EffectEnvelopeDecayIndex: 0,
    EffectEnvelopeSustainLevel: 0,
    EffectEnvelopeReleaseIndex: 0,
    EffectEnvelope2Target: 2,
    EffectEnvelope2Amount: 254,
    EffectEnvelope2AttackIndex: 0,
    EffectEnvelope2HoldIndex: 0,
    EffectEnvelope2DecayIndex: 0,
    EffectEnvelope2SustainLevel: 0,
    EffectEnvelope2ReleaseIndex: 0,
    SynthPortamentoTimeIndex: 0,
    ArpeggiatorDirection: 0,
    ArpeggiatorNoteLength: 100,
    SynthWavetablePosition: 0,
    SynthLfoTarget: 0,
    SynthLfoAmount: 127,
    SynthLfoWave: 0,
    SynthLfoSpeed: 6
  }
};

const initialComputerPresets: EditableSynthPreset[] = [
  defaultPreset,
  {
    objectIdHex: objectIdToHex(deterministicObjectId("Bright Mono Lead")),
    name: "Bright Mono Lead",
    folderPath: "Leads",
    wavetableName: basicWavetableName,
    wavetableFolderPath: builtInWavetableFolder,
    favorite: false,
    values: {
      ...defaultPreset.values,
      PlaybackMode: 1,
      Waveform: 27,
      SynthDrive: 2,
      SynthModTarget: 2,
      SynthModAmount: 100,
      SynthVibratoSpeed: 4,
      SynthPortamentoTimeIndex: 6,
      SynthWavetablePosition: 85,
      EnvelopeAttackIndex: 0,
      EnvelopeHoldIndex: 0,
      EnvelopeDecayIndex: 4,
      EnvelopeSustainLevel: 110,
      EnvelopeReleaseIndex: 5,
      EffectEnvelopeTarget: 0,
      EffectEnvelopeAmount: 127,
      EffectEnvelope2Target: 0,
      EffectEnvelope2Amount: 127
    }
  }
];

const rootFolderPath = "/";
const defaultFolders = [rootFolderPath];
const defaultUserWavetableFolder = rootFolderPath;

const builtInWavetables = [
  { name: "Basic Shapes", folderPath: builtInWavetableFolder }
] as const;

const synthValueBounds: Record<EditableSynthValueKey, readonly [number, number]> = {
  PlaybackMode: [0, 6],
  Waveform: [0, 28],
  SynthDrive: [0, 3],
  SynthModTarget: [0, 11],
  SynthModAmount: [0, 254],
  SynthVibratoSpeed: [0, synthVibratoSpeedNoise],
  ArpeggiatorDivision: [1, 32],
  SynthBPM: [1, 255],
  EnvelopeAttackIndex: [0, 20],
  EnvelopeHoldIndex: [0, 20],
  EnvelopeDecayIndex: [0, 20],
  EnvelopeSustainLevel: [0, 127],
  EnvelopeReleaseIndex: [0, 20],
  EffectEnvelopeTarget: [0, 6],
  EffectEnvelopeAmount: [0, 254],
  EffectEnvelopeAttackIndex: [0, 20],
  EffectEnvelopeHoldIndex: [0, 20],
  EffectEnvelopeDecayIndex: [0, 20],
  EffectEnvelopeSustainLevel: [0, 127],
  EffectEnvelopeReleaseIndex: [0, 20],
  EffectEnvelope2Target: [0, 6],
  EffectEnvelope2Amount: [0, 254],
  EffectEnvelope2AttackIndex: [0, 20],
  EffectEnvelope2HoldIndex: [0, 20],
  EffectEnvelope2DecayIndex: [0, 20],
  EffectEnvelope2SustainLevel: [0, 127],
  EffectEnvelope2ReleaseIndex: [0, 20],
  SynthPortamentoTimeIndex: [0, 19],
  ArpeggiatorDirection: [0, 6],
  ArpeggiatorNoteLength: [1, 100],
  SynthWavetablePosition: [0, 127],
  SynthLfoTarget: [0, 6],
  SynthLfoAmount: [0, 254],
  SynthLfoWave: [0, 5],
  SynthLfoSpeed: [0, 19]
};

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}

function clampSynthValue(key: EditableSynthValueKey, value: number): number {
  if (key === "PlaybackMode" && value === 5) {
    return 3;
  }
  const [min, max] = synthValueBounds[key];
  return clampNumber(value, min, max);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeObjectIdHex(value: unknown, seed: string): string {
  if (typeof value === "string") {
    const normalized = value.replace(/[^0-9a-f]/gi, "").toLowerCase();
    if (normalized.length === 32) {
      return normalized;
    }
  }
  return objectIdToHex(deterministicObjectId(seed));
}

function clonePreset(preset: EditableSynthPreset): EditableSynthPreset {
  return {
    ...preset,
    values: { ...preset.values },
    ...(preset.sampler ? { sampler: { ...preset.sampler } } : {})
  };
}

function samplerFromUnknown(value: unknown): SynthPresetSampler | undefined {
  if (!isRecord(value) || typeof value.name !== "string" || !value.name.trim()) return undefined;
  const mask = typeof value.envelopeOverride === "number" && Number.isInteger(value.envelopeOverride)
    ? value.envelopeOverride & SAMPLER_ENVELOPE_OVERRIDE_ALL
    : 0;
  return { name: clampUtf8Bytes(value.name.trim(), deviceNameMaxBytes), envelopeOverride: mask };
}

function cloneWavetable(wavetable: EditableSynthWavetable): EditableSynthWavetable {
  return {
    ...wavetable,
    samples: wavetable.samples ? new Uint8Array(wavetable.samples) : undefined
  };
}

function folderLabel(folderPath: string): string {
  if (folderPath === rootFolderPath || folderPath === builtInWavetableFolder) {
    return "Root";
  }
  return folderPath.startsWith("/") ? folderPath.slice(1) : folderPath;
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

function wavetableOptionValue(folderPath: string, name: string): string {
  const ref = normalizeWavetableReference(folderPath, name);
  return `${ref.folderPath}\u0000${ref.name}`;
}

function wavetableReferenceFromOptionValue(value: string): { folderPath: string; name: string } {
  const [folderPath, name] = value.split("\u0000");
  return normalizeWavetableReference(folderPath, name);
}

function normalizeDisplayFolderPath(folderPath: string): string {
  const trimmed = folderPath.trim();
  if (!trimmed || trimmed === rootFolderPath) {
    return rootFolderPath;
  }
  if (trimmed === builtInWavetableFolder) {
    return builtInWavetableFolder;
  }
  return clampUtf8Bytes(trimmed.replace(/^\/+/, ""), deviceFolderMaxBytes);
}

function normalizeWavetableReference(folderPath: string | undefined, name: string | undefined) {
  return {
    folderPath: normalizeDisplayFolderPath(folderPath ?? builtInWavetableFolder),
    name: normalizedWavetableName(name?.trim() ? name : basicWavetableName)
  };
}

function normalizedPresetName(name: string): string {
  return clampUtf8Bytes(name.trim() || "Untitled", HEXBOARD_PRESET_NAME_MAX_BYTES);
}

function normalizedWavetableName(name: string): string {
  return clampUtf8Bytes(name.trim() || "Wavetable", deviceNameMaxBytes);
}

function clampUtf8Bytes(value: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(value).length <= maxBytes) {
    return value;
  }
  let output = "";
  let used = 0;
  for (const char of value) {
    const bytes = encoder.encode(char).length;
    if (used + bytes > maxBytes) {
      break;
    }
    output += char;
    used += bytes;
  }
  return output.trim() || value.slice(0, 1);
}

function presetSaveKey(preset: EditableSynthPreset): string {
  return `${normalizeDisplayFolderPath(preset.folderPath).toLocaleLowerCase()}\u0000${normalizedPresetName(preset.name).toLocaleLowerCase()}`;
}

function wavetableSaveKey(wavetable: Pick<EditableSynthWavetable, "folderPath" | "name">): string {
  return normalizedWavetableName(wavetable.name);
}

function findWavetableByFolderAndName(wavetables: EditableSynthWavetable[], wavetable: EditableSynthWavetable): EditableSynthWavetable | undefined {
  const saveKey = wavetableSaveKey(wavetable);
  return wavetables.find((candidate) => wavetableSaveKey(candidate) === saveKey);
}

function freshPresetObjectIdHex(preset: EditableSynthPreset): string {
  const nonce = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}:${Math.random()}`;
  return objectIdToHex(deterministicObjectId(`synth:${preset.folderPath}:${preset.name}:${nonce}`));
}

function normalizedPresetForSave(preset: EditableSynthPreset): EditableSynthPreset {
  const wavetable = normalizeWavetableReference(preset.wavetableFolderPath, preset.wavetableName);
  return {
    ...clonePreset(preset),
    name: normalizedPresetName(preset.name),
    folderPath: normalizeDisplayFolderPath(preset.folderPath),
    wavetableName: wavetable.name,
    wavetableFolderPath: wavetable.folderPath
  };
}

function encodeDeviceFolderPath(folderPath: string): string {
  const normalized = normalizeDisplayFolderPath(folderPath);
  if (normalized === rootFolderPath) {
    return rootFolderPath;
  }
  const encoded = normalized
    .replace(/%/g, "%25")
    .replace(/\//g, "%2F")
    .replace(/\\/g, "%5C");
  return trimPartialPercentEscape(clampUtf8Bytes(encoded, deviceFolderMaxBytes));
}

function trimPartialPercentEscape(value: string): string {
  const lastPercentIndex = value.lastIndexOf("%");
  if (lastPercentIndex >= 0 && value.length - lastPercentIndex < 3) {
    return value.slice(0, lastPercentIndex).trim() || rootFolderPath;
  }
  return value;
}

function encodeDeviceWavetableFolderPath(folderPath: string): string {
  const normalized = normalizeDisplayFolderPath(folderPath);
  return normalized === builtInWavetableFolder ? normalized : encodeDeviceFolderPath(normalized);
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

function comparePresets(left: EditableSynthPreset, right: EditableSynthPreset): number {
  return `${left.folderPath}/${left.name}`.localeCompare(`${right.folderPath}/${right.name}`);
}

function compareWavetables(left: EditableSynthWavetable, right: EditableSynthWavetable): number {
  return `${left.folderPath}/${left.name}`.localeCompare(`${right.folderPath}/${right.name}`);
}

let factoryWavetableCache: EditableSynthWavetable[] | null = null;

function factoryWavetableSources(): EditableSynthWavetable[] {
  if (!factoryWavetableCache) {
    factoryWavetableCache = createFactorySynthWavetables()
      .map((wavetable) => ({
        ...wavetable,
        sampleCrc: crc32(wavetable.samples)
      }))
      .sort(compareWavetables);
  }
  return factoryWavetableCache;
}

function factoryComputerWavetables(): EditableSynthWavetable[] {
  return factoryWavetableSources().map(cloneWavetable);
}

function uniqueWavetablesByName(wavetables: EditableSynthWavetable[]): EditableSynthWavetable[] {
  const unique = new Map<string, EditableSynthWavetable>();
  for (const wavetable of wavetables) {
    const key = wavetableSaveKey(wavetable);
    if (!unique.has(key)) {
      unique.set(key, cloneWavetable(wavetable));
    }
  }
  return Array.from(unique.values()).sort(compareWavetables);
}

function mergeMissingFactoryWavetables(wavetables: EditableSynthWavetable[]): EditableSynthWavetable[] {
  const existingKeys = new Set(wavetables.map((wavetable) => wavetableSaveKey(wavetable)));
  const additions = factoryComputerWavetables().filter((wavetable) => !existingKeys.has(wavetableSaveKey(wavetable)));
  return uniqueWavetablesByName([...wavetables, ...additions]);
}

function upsertPreset(presets: EditableSynthPreset[], preset: EditableSynthPreset): EditableSynthPreset[] {
  const nextPreset = clonePreset(preset);
  const index = presets.findIndex((candidate) => candidate.objectIdHex === nextPreset.objectIdHex);
  if (index === -1) {
    return [...presets, nextPreset].sort(comparePresets);
  }
  const next = [...presets];
  next[index] = nextPreset;
  return next.sort(comparePresets);
}

function removePreset(presets: EditableSynthPreset[], objectIdHex: string): EditableSynthPreset[] {
  return presets.filter((preset) => preset.objectIdHex !== objectIdHex);
}

function upsertWavetable(wavetables: EditableSynthWavetable[], wavetable: EditableSynthWavetable): EditableSynthWavetable[] {
  const nextWavetable = cloneWavetable(wavetable);
  const index = wavetables.findIndex((candidate) => candidate.objectIdHex === nextWavetable.objectIdHex);
  if (index === -1) {
    return [...wavetables, nextWavetable].sort(compareWavetables);
  }
  const next = [...wavetables];
  next[index] = nextWavetable;
  return next.sort(compareWavetables);
}

function removeWavetable(wavetables: EditableSynthWavetable[], objectIdHex: string): EditableSynthWavetable[] {
  return wavetables.filter((wavetable) => wavetable.objectIdHex !== objectIdHex);
}

function encodeEditablePreset(preset: EditableSynthPreset) {
  const wavetable = normalizeWavetableReference(preset.wavetableFolderPath, preset.wavetableName);
  return createSynthPresetObject({
    objectId: objectIdFromHex(preset.objectIdHex),
    name: normalizedPresetName(preset.name),
    folderPath: encodeDeviceFolderPath(preset.folderPath),
    favorite: preset.favorite,
    wavetable: {
      folderPath: encodeDeviceWavetableFolderPath(wavetable.folderPath),
      name: wavetable.name
    },
    values: {
      ...preset.values,
      Waveform: 27
    },
    ...(preset.sampler ? { sampler: preset.sampler } : {})
  });
}

function exportPreset(preset: EditableSynthPreset) {
  return {
    objectId: preset.objectIdHex,
    name: preset.name,
    folderPath: preset.folderPath,
    wavetable: {
      name: preset.wavetableName,
      folderPath: preset.wavetableFolderPath
    },
    favorite: preset.favorite,
    values: preset.values satisfies SynthPresetValues,
    ...(preset.sampler ? { sampler: { ...preset.sampler } } : {})
  };
}

function wavetableReferenceFromUnknown(source: Record<string, unknown>): { name: string; folderPath: string } | null {
  if (isRecord(source.wavetable)) {
    const name = typeof source.wavetable.name === "string" ? source.wavetable.name : "";
    const folderPath = typeof source.wavetable.folderPath === "string" ? source.wavetable.folderPath : "";
    if (name.trim()) {
      return normalizeWavetableReference(folderPath, name);
    }
  }
  return null;
}

function presetFromUnknown(value: unknown): EditableSynthPreset {
  const source = isRecord(value) && value.format === presetFileFormat ? value.preset : value;
  if (!isRecord(source)) {
    throw new Error("Preset file does not contain a synth preset object");
  }

  const name = normalizedPresetName(typeof source.name === "string" && source.name.trim() ? source.name : "Imported Preset");
  const folderPath = typeof source.folderPath === "string" && source.folderPath.trim() ? normalizeDisplayFolderPath(source.folderPath) : rootFolderPath;
  const importedValues = isRecord(source.values) ? source.values : {};
  const values = { ...defaultPreset.values };

  for (const key of synthValueKeys) {
    const rawValue = importedValues[key];
    if (typeof rawValue === "number") {
      values[key] = clampSynthValue(key, rawValue);
    }
  }
  const wavetable = wavetableReferenceFromUnknown(source)
    ?? { name: basicWavetableName, folderPath: builtInWavetableFolder };
  values.Waveform = 27;

  return {
    objectIdHex: normalizeObjectIdHex(source.objectId, `synth:${folderPath}:${name}:${Date.now()}`),
    name,
    folderPath,
    wavetableName: wavetable.name,
    wavetableFolderPath: wavetable.folderPath,
    favorite: source.favorite === true,
    values,
    ...(samplerFromUnknown(source.sampler) ? { sampler: samplerFromUnknown(source.sampler) } : {})
  };
}

export function presetsFromUnknown(value: unknown): EditableSynthPreset[] {
  if (isRecord(value) && value.format === presetLibraryFileFormat && Array.isArray(value.presets)) {
    if (value.presets.length === 0) {
      throw new Error("Preset library file does not contain any presets");
    }
    return value.presets.map(presetFromUnknown);
  }
  return [presetFromUnknown(value)];
}

export function mergePresetBatch(
  target: EditableSynthPreset[],
  incoming: EditableSynthPreset[]
): { presets: EditableSynthPreset[]; conflicts: EditableSynthPreset[] } {
  let presets = target.map(clonePreset);
  const conflicts: EditableSynthPreset[] = [];
  for (const source of incoming) {
    const normalized = normalizedPresetForSave(source);
    const sameObject = presets.find((candidate) => candidate.objectIdHex === normalized.objectIdHex);
    const sameDestination = presets.find((candidate) =>
      candidate.objectIdHex !== normalized.objectIdHex && presetSaveKey(candidate) === presetSaveKey(normalized)
    );
    if (sameDestination) conflicts.push(sameDestination);
    const merged = {
      ...normalized,
      objectIdHex: sameObject?.objectIdHex ?? sameDestination?.objectIdHex ?? normalized.objectIdHex,
      deviceHandle: undefined
    };
    presets = upsertPreset(
      sameDestination ? removePreset(presets, sameDestination.objectIdHex) : presets,
      merged
    );
  }
  return {
    presets,
    conflicts: Array.from(new Map(conflicts.map((preset) => [preset.objectIdHex, preset])).values())
  };
}

/** Folder filter that shows starred sounds from every folder. */
export const favoritesFilter = "\u0000favorites";

export function filterLibraryPresets(
  presets: EditableSynthPreset[],
  selectedFolder: string | null,
  searchQuery: string
): EditableSynthPreset[] {
  const query = searchQuery.trim().toLocaleLowerCase();
  return presets.filter((preset) => {
    if (selectedFolder === favoritesFilter ? !preset.favorite : selectedFolder !== null && preset.folderPath !== selectedFolder) {
      return false;
    }
    return query.length === 0
      || preset.name.toLocaleLowerCase().includes(query)
      || folderLabel(preset.folderPath).toLocaleLowerCase().includes(query);
  });
}

function presetFromObjectBody(body: Uint8Array, deviceHandle?: number): EditableSynthPreset {
  const decoded = decodeObjectBody(body);
  const values = { ...defaultPreset.values };
  let objectIdHex = objectIdToHex(deterministicObjectId(`device:${deviceHandle ?? Date.now()}`));
  let name = "Device Preset";
  let folderPath = rootFolderPath;
  let wavetableName = "";
  let wavetableFolderPath = "";
  let favorite = false;
  let samplerName = "";
  let samplerEnvelopeOverride = 0;

  for (const record of decoded.records) {
    if (record.tag === CommonTlv.Name) {
      name = textFromBytes(record.value) || name;
    } else if (record.tag === CommonTlv.ObjectId && record.value.length === 16) {
      objectIdHex = objectIdToHex(record.value);
    } else if (record.tag === CommonTlv.FolderPath) {
      folderPath = decodeDeviceFolderPath(textFromBytes(record.value) || rootFolderPath);
    } else if (record.tag === SynthPresetTlv.Favorite && record.value.length > 0) {
      favorite = record.value[0] !== 0;
    } else if (record.tag === SynthPresetTlv.WavetableName) {
      wavetableName = textFromBytes(record.value);
    } else if (record.tag === SynthPresetTlv.WavetableFolderPath) {
      wavetableFolderPath = decodeDeviceFolderPath(textFromBytes(record.value) || builtInWavetableFolder);
    } else if (record.tag === SynthPresetTlv.SamplerName) {
      samplerName = textFromBytes(record.value);
    } else if (record.tag === SynthPresetTlv.SamplerEnvelopeOverride && record.value.length > 0) {
      samplerEnvelopeOverride = record.value[0] & SAMPLER_ENVELOPE_OVERRIDE_ALL;
    } else if (record.tag === SynthPresetTlv.SynthValues) {
      for (let index = 0; index + 1 < record.value.length; index += 2) {
        const setting = Object.entries(SynthSettingKey).find(([, value]) => value === record.value[index])?.[0] as EditableSynthValueKey | undefined;
        if (setting && synthValueKeys.includes(setting)) {
          values[setting] = clampSynthValue(setting, record.value[index + 1]);
        }
      }
    }
  }
  const wavetable = normalizeWavetableReference(wavetableFolderPath, wavetableName);
  values.Waveform = 27;

  return {
    objectIdHex,
    deviceHandle,
    name,
    folderPath,
    wavetableName: wavetable.name,
    wavetableFolderPath: wavetable.folderPath,
    favorite,
    values,
    ...(samplerName ? { sampler: { name: samplerName, envelopeOverride: samplerEnvelopeOverride } } : {})
  };
}

function presetFromObjectListRecord(record: ObjectListRecord): EditableSynthPreset {
  return {
    objectIdHex: objectIdToHex(record.objectId),
    deviceHandle: record.handle,
    name: record.name || `Preset ${record.handle + 1}`,
    folderPath: decodeDeviceFolderPath(record.folderPath || rootFolderPath),
    wavetableName: basicWavetableName,
    wavetableFolderPath: builtInWavetableFolder,
    favorite: (record.flags & 0x02) !== 0,
    values: { ...defaultPreset.values }
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    output[index] = binary.charCodeAt(index);
  }
  return output;
}

function encodeEditableWavetable(wavetable: EditableSynthWavetable) {
  if (!wavetable.samples || (wavetable.samples.length !== SYNTH_WAVETABLE_SAMPLE_BYTES && wavetable.samples.length !== SYNTH_WAVETABLE_MIP_SAMPLE_BYTES)) {
    throw new Error(`${wavetable.name} does not have local sample data`);
  }
  return createSynthWavetableObject({
    objectId: objectIdFromHex(wavetable.objectIdHex),
    name: normalizedWavetableName(wavetable.name),
    folderPath: encodeDeviceFolderPath(wavetable.folderPath),
    samples: wavetable.samples,
    tags: ["wavetable"]
  });
}

function encodeEditableWavetableMetadata(wavetable: EditableSynthWavetable) {
  return createSynthWavetableMetadataObject({
    objectId: objectIdFromHex(wavetable.objectIdHex),
    name: normalizedWavetableName(wavetable.name),
    folderPath: encodeDeviceFolderPath(wavetable.folderPath),
    tags: ["wavetable"]
  });
}

function exportWavetable(wavetable: EditableSynthWavetable) {
  return {
    objectId: wavetable.objectIdHex,
    name: wavetable.name,
    folderPath: wavetable.folderPath,
    sampleCrc: wavetable.sampleCrc,
    samplesBase64: wavetable.samples ? bytesToBase64(wavetable.samples) : undefined
  };
}

function wavetableFromUnknown(value: unknown): EditableSynthWavetable {
  const source = isRecord(value) && value.format === wavetableFileFormat ? value.wavetable : value;
  if (!isRecord(source)) {
    throw new Error("Wavetable file does not contain a synth wavetable object");
  }
  const name = normalizedWavetableName(typeof source.name === "string" && source.name.trim() ? source.name : "Imported Wavetable");
  const folderPath = typeof source.folderPath === "string" && source.folderPath.trim() ? normalizeDisplayFolderPath(source.folderPath) : defaultUserWavetableFolder;
  let samples: Uint8Array | undefined;
  if (typeof source.samplesBase64 === "string" && source.samplesBase64) {
    samples = base64ToBytes(source.samplesBase64);
    if (samples.length !== SYNTH_WAVETABLE_SAMPLE_BYTES && samples.length !== SYNTH_WAVETABLE_MIP_SAMPLE_BYTES) {
      throw new Error("Wavetable file has the wrong sample length");
    }
  }
  return {
    objectIdHex: normalizeObjectIdHex(source.objectId, `wavetable:${folderPath}:${name}:${source.sampleCrc ?? Date.now()}`),
    name,
    folderPath,
    samples,
    sampleCrc: typeof source.sampleCrc === "number" ? source.sampleCrc : samples ? crc32(samples) : undefined
  };
}

function wavetableFromObjectBody(body: Uint8Array, deviceHandle?: number): EditableSynthWavetable {
  const decoded = decodeObjectBody(body);
  let objectIdHex = objectIdToHex(deterministicObjectId(`device-wavetable:${deviceHandle ?? Date.now()}`));
  let name = "Device Wavetable";
  let folderPath = rootFolderPath;
  let samples: Uint8Array | undefined;
  const sampleChunks: Uint8Array[] = [];
  let sampleLength = 0;

  for (const record of decoded.records) {
    if (record.tag === CommonTlv.Name) {
      name = textFromBytes(record.value) || name;
    } else if (record.tag === CommonTlv.ObjectId && record.value.length === 16) {
      objectIdHex = objectIdToHex(record.value);
    } else if (record.tag === CommonTlv.FolderPath) {
      folderPath = decodeDeviceFolderPath(textFromBytes(record.value) || rootFolderPath);
    } else if (record.tag === SynthWavetableTlv.Samples) {
      sampleChunks.push(record.value);
      sampleLength += record.value.length;
    }
  }
  if (sampleLength === SYNTH_WAVETABLE_SAMPLE_BYTES || sampleLength === SYNTH_WAVETABLE_MIP_SAMPLE_BYTES) {
    samples = new Uint8Array(sampleLength);
    let offset = 0;
    for (const chunk of sampleChunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
  }

  return {
    objectIdHex,
    deviceHandle,
    name,
    folderPath,
    samples,
    sampleCrc: samples ? crc32(samples) : undefined
  };
}

function wavetableFromObjectListRecord(record: ObjectListRecord): EditableSynthWavetable {
  return {
    objectIdHex: objectIdToHex(record.objectId),
    deviceHandle: record.handle,
    name: record.name || `Wavetable ${record.handle + 1}`,
    folderPath: decodeDeviceFolderPath(record.folderPath || rootFolderPath)
  };
}

function loadComputerPresets(): EditableSynthPreset[] {
  if (typeof window === "undefined") {
    return initialComputerPresets.map(clonePreset);
  }

  try {
    const stored = window.localStorage.getItem(computerLibraryStorageKey);
    const parsed = stored ? JSON.parse(stored) : null;
    if (Array.isArray(parsed)) {
      const presets = parsed.map(presetFromUnknown);
      if (presets.length > 0) {
        return presets.sort(comparePresets);
      }
    }
  } catch {
    window.localStorage.removeItem(computerLibraryStorageKey);
  }

  return initialComputerPresets.map(clonePreset);
}

function saveComputerPresets(presets: EditableSynthPreset[]) {
  if (typeof window === "undefined") {
    return;
  }
  writeStoredText(window.localStorage, computerLibraryStorageKey, JSON.stringify(presets.map(exportPreset)));
}

export function loadComputerWavetables(): EditableSynthWavetable[] {
  if (typeof window === "undefined") {
    return factoryComputerWavetables();
  }

  try {
    const factorySeeded = window.localStorage.getItem(computerWavetableFactorySeedStorageKey) === "2";
    const stored = window.localStorage.getItem(computerWavetableStorageKey);
    const parsed = stored ? JSON.parse(stored) : null;
    if (Array.isArray(parsed)) {
      const wavetables = parsed.map(wavetableFromUnknown);
      if (!factorySeeded) {
        writeStoredText(window.localStorage, computerWavetableFactorySeedStorageKey, "2");
        return mergeMissingFactoryWavetables(wavetables);
      }
      return uniqueWavetablesByName(wavetables);
    }
  } catch {
    window.localStorage.removeItem(computerWavetableStorageKey);
  }

  writeStoredText(window.localStorage, computerWavetableFactorySeedStorageKey, "2");
  return factoryComputerWavetables();
}

function saveComputerWavetables(wavetables: EditableSynthWavetable[]) {
  if (typeof window === "undefined") {
    return;
  }
  writeStoredText(window.localStorage, computerWavetableStorageKey, JSON.stringify(wavetables.map(exportWavetable)));
}

function loadStoredFolders(storageKey: string): string[] {
  if (typeof window === "undefined") {
    return [rootFolderPath];
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]") as unknown;
    if (Array.isArray(parsed)) {
      return Array.from(new Set([
        rootFolderPath,
        ...parsed.filter((folder): folder is string => typeof folder === "string").map(normalizeDisplayFolderPath)
      ]));
    }
  } catch {
    window.localStorage.removeItem(storageKey);
  }
  return [rootFolderPath];
}

function saveStoredFolders(storageKey: string, folders: string[]) {
  if (typeof window !== "undefined") {
    writeStoredText(window.localStorage, storageKey, JSON.stringify(folders.filter((folder) => folder !== rootFolderPath && folder !== builtInWavetableFolder)));
  }
}

function safeFileName(value: string): string {
  const sanitized = value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "");
  return sanitized || "hexboard-synth-preset";
}

function librarySpaceLabel(space: LibrarySpace): string {
  return space === "computer" ? "Browser Library" : "HexBoard Library";
}

function renderWavetableImportSource(source: WavetableImportSource, options: SerumWavetableCrunchOptions): Uint8Array {
  return source.format === "hexboard"
    ? parseHexBoardWavetable(source.bytes)
    : crunchSerumWavetable(source.bytes, options);
}

function wavetableFramePreviewPath(samples: Uint8Array, frame: number, mipLevel: number): string {
  const clampedFrame = Math.max(0, Math.min(SYNTH_WAVETABLE_FRAME_COUNT - 1, frame));
  const levelSamples = synthWavetableMipLevelSamples(samples, mipLevel);
  const sampleCount = synthWavetableMipLevelSampleCount(mipLevel);
  const start = clampedFrame * sampleCount;
  const points: string[] = [];
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const x = (sample / (sampleCount - 1)) * 100;
    const normalized = ((levelSamples[start + sample] ?? 128) - 128) / 128;
    const y = 50 - normalized * 44;
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return `M ${points.join(" L ")}`;
}

const auditionKeyMap = [
  { key: "a", offset: 0 },
  { key: "w", offset: 1 },
  { key: "s", offset: 2 },
  { key: "e", offset: 3 },
  { key: "d", offset: 4 },
  { key: "f", offset: 5 },
  { key: "t", offset: 6 },
  { key: "g", offset: 7 },
  { key: "y", offset: 8 },
  { key: "h", offset: 9 },
  { key: "u", offset: 10 },
  { key: "j", offset: 11 },
  { key: "k", offset: 12 },
  { key: "o", offset: 13 },
  { key: "l", offset: 14 },
  { key: "p", offset: 15 },
  { key: ";", offset: 16 },
  { key: "'", offset: 17 }
] as const;

const auditionKeyRows = [auditionKeyMap.slice(0, 13)] as const;
const basicShapesSamples = createBasicShapesSamples();

function midiNoteLabel(note: number): string {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const octave = Math.floor(note / 12) - 1;
  return `${names[note % 12]}${octave}`;
}

function auditionNoteFromKey(key: string, octave: number): number | null {
  const mapping = auditionKeyMap.find((entry) => entry.key === key.toLowerCase());
  if (!mapping) {
    return null;
  }
  return (octave + 1) * 12 + mapping.offset;
}

function eventTargetAcceptsText(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return target.isContentEditable
    || target.tagName === "INPUT"
    || target.tagName === "TEXTAREA"
    || target.tagName === "SELECT";
}

export function SynthPresetLibrary({ transport }: SynthPresetLibraryProps) {
  const connected = !(transport instanceof MockMidiTransport);
  const drafts = useEditorDrafts<EditableSynthPreset>("hexboard-synth-drafts-v1", (value): value is EditableSynthPreset => {
    if (!isRecord(value) || typeof value.objectIdHex !== "string" || !/^[a-f0-9]{32}$/i.test(value.objectIdHex) || typeof value.name !== "string" || typeof value.folderPath !== "string" || typeof value.wavetableName !== "string" || typeof value.wavetableFolderPath !== "string" || !isRecord(value.values)) return false;
    return synthValueKeys.every(key => typeof (value.values as Record<string, unknown>)[key] === "number" && Number.isFinite((value.values as Record<string, unknown>)[key]));
  });
  const restoredDraft = drafts.entries[drafts.active];
  const [draftBase, setDraftBase] = useState(() => restoredDraft?.base ?? clonePreset(defaultPreset));
  const [savedDeviceContent, setSavedDeviceContent] = useState<Record<string, string>>({});
  const [libraryKind, setLibraryKind] = useState<SynthLibraryKind>("presets");
  const [computerPresets, setComputerPresets] = useState(loadComputerPresets);
  const [hexboardPresets, setHexboardPresets] = useState<EditableSynthPreset[]>([]);
  /** Instrument names on the board; null until read. */
  const [hexboardInstruments, setHexboardInstruments] = useState<string[] | null>(null);
  const [newSamplerSound, setNewSamplerSound] = useState<{ instruments: string[]; choice: string } | null>(null);
  const [computerWavetables, setComputerWavetables] = useState(loadComputerWavetables);
  const [hexboardWavetables, setHexboardWavetables] = useState<EditableSynthWavetable[]>([]);
  const [preset, setPreset] = useState<EditableSynthPreset>(() => restoredDraft?.value ?? clonePreset(defaultPreset));
  const [openedSource, setOpenedSource] = useState<LibrarySpace>(drafts.active.startsWith("hexboard:") ? "hexboard" : "computer");
  const [customFolders, setCustomFolders] = useState(() => loadStoredFolders(synthPresetFoldersStorageKey));
  const [customWavetableFolders, setCustomWavetableFolders] = useState(() => loadStoredFolders(synthWavetableFoldersStorageKey));
  const [newFolder, setNewFolder] = useState("");
  const [creatingPresetFolder, setCreatingPresetFolder] = useState(false);
  const [presetFolderName, setPresetFolderName] = useState("");
  const presetFolderSelectRef = useRef<HTMLSelectElement>(null);
  const [newWavetableFolder, setNewWavetableFolder] = useState("");
  const [wavetableImportName, setWavetableImportName] = useState("");
  const [wavetableImportFolder, setWavetableImportFolder] = useState(defaultUserWavetableFolder);
  const [wavetableImportDialogOpen, setWavetableImportDialogOpen] = useState(false);
  const [wavetableImportFormat, setWavetableImportFormat] = useState<WavetableImportFormat>("serum-vital");
  const [wavetablePreviewFrame, setWavetablePreviewFrame] = useState(0);
  const [wavetablePreviewMipLevel, setWavetablePreviewMipLevel] = useState(0);
  const [wavetableFrameReduction, setWavetableFrameReduction] = useState<WavetableFrameReduction>("interpolated");
  const [wavetableNormalization, setWavetableNormalization] = useState<WavetableNormalization>("whole-table");
  const [wavetableSmooth, setWavetableSmooth] = useState(false);
  const [wavetableDither, setWavetableDither] = useState(false);
  const [wavetableImportSource, setWavetableImportSource] = useState<WavetableImportSource | null>(null);
  const [autoSend, setAutoSend] = useState(false);
  const [editorHydrated, setEditorHydrated] = useState(() => transport instanceof MockMidiTransport);
  const [libraryStorageError, setLibraryStorageError] = useState("");
  const [syncStatus, setSyncStatus] = useState("Ready");
  const [copyingPreviewWavetable, setCopyingPreviewWavetable] = useState(false);
  const [auditionOpen, setAuditionOpen] = useState(false);
  const [previewOctave, setPreviewOctave] = useState(4);
  const [previewStatus, setPreviewStatus] = useState("Ready");
  const [previewVolume, setPreviewVolume] = useState(0.8);
  const [previewMod, setPreviewMod] = useState(0);
  const [previewResetToken, setPreviewResetToken] = useState(0);
  const [heldPreviewNotes, setHeldPreviewNotes] = useState<number[]>([]);
  const [lastFrameCount, setLastFrameCount] = useState(0);
  const [draggedPreset, setDraggedPreset] = useState<DraggedPreset | null>(null);
  const [presetOrganizationRequest, setPresetOrganizationRequest] = useState<PresetOrganizationRequest | null>(null);
  const [selectedPresetIds, setSelectedPresetIds] = useState<Record<LibrarySpace, string[]>>({
    computer: [],
    hexboard: []
  });
  const [bulkPresetBusy, setBulkPresetBusy] = useState(false);
  const [wavetableResolutionRequest, setWavetableResolutionRequest] =
    useState<WavetableResolutionRequest | null>(null);
  const [wavetableResolutionAlternate, setWavetableResolutionAlternate] =
    useState(basicWavetableName);
  const [folderFilters, setFolderFilters] = useState<Record<LibrarySpace, string | null>>({
    computer: null,
    hexboard: null
  });
  const [wavetableFolderFilters, setWavetableFolderFilters] = useState<Record<LibrarySpace, string | null>>({
    computer: null,
    hexboard: null
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wavetableFileInputRef = useRef<HTMLInputElement>(null);
  const previewControllerRef = useRef<SynthPreviewController | null>(null);
  const previewChordTimerRef = useRef<number | null>(null);
  const previewStopGeneration = useRef(0);
  const pressedPreviewKeys = useRef(new Map<string, number>());
  const latestPreviewPatch = useRef<SynthPreviewPatch | null>(null);
  const latestPreviewVolume = useRef(previewVolume);
  const latestPreviewMod = useRef(previewMod);
  const skipNextAutoSend = useRef(true);
  const lastPreviewIdentity = useRef("");
  const pendingLiveSynthParam = useRef<{ key: EditableSynthValueKey; value: number } | null>(null);

  const draftKey = `${openedSource}:${preset.objectIdHex}`;
  const hasDraft = !sameContent(preset, draftBase);
  const browserSaved = computerPresets.some(item => sameContent(exportPreset(item), exportPreset(preset)));
  const deviceSaved = connected && savedDeviceContent[preset.objectIdHex] === JSON.stringify(exportPreset(preset));
  const latestPreset = useRef(preset);
  latestPreset.current = preset;
  useEffect(() => { drafts.remember(draftKey, preset, draftBase); }, [draftKey, preset, draftBase]);
  useEffect(() => { setSavedDeviceContent({}); lastPreviewIdentity.current = ""; setAutoSend(false); }, [transport]);
  function discardPresetDraft() {
    skipNextAutoSend.current = true;
    setPreset(clonePreset(draftBase));
    setSyncStatus("Draft discarded");
  }
  function newPreset() {
    const next = { ...clonePreset(defaultPreset), objectIdHex: objectIdToHex(deterministicObjectId(`draft:${Date.now()}`)), name: "Untitled sound" };
    setDraftBase(next);
    setPreset(next);
    setOpenedSource("computer");
    skipNextAutoSend.current = true;
    setSyncStatus("New sound");
  }
  const client = useMemo(() => new PresetSyncClient(transport), [transport]);
  const samplerClient = useMemo(() => new ClassicSamplerClient(transport, client), [client, transport]);
  useEffect(() => setHexboardInstruments(null), [samplerClient]);

  async function loadHexBoardInstruments(): Promise<string[]> {
    const names = (await samplerClient.library()).map((instrument) => instrument.name);
    setHexboardInstruments(names);
    return names;
  }

  async function openNewSamplerSound() {
    if (!connected) { setSyncStatus("Connect HexBoard to make a sampler sound"); return; }
    try {
      setSyncStatus("Reading HexBoard instruments...");
      const instruments = await loadHexBoardInstruments();
      if (instruments.length === 0) { setSyncStatus("No instruments on HexBoard. Send one from the Instruments tab first."); return; }
      setNewSamplerSound({ instruments, choice: instruments[0] });
      setSyncStatus("Ready");
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : "Failed to read HexBoard instruments");
    }
  }

  function createSamplerSound(instrumentName: string) {
    const values = { ...defaultPreset.values, SynthModTarget: 0, EffectEnvelopeTarget: 0, EffectEnvelope2Target: 0, SynthLfoTarget: 0 };
    const next: EditableSynthPreset = {
      ...clonePreset(defaultPreset),
      objectIdHex: objectIdToHex(deterministicObjectId(`draft:${Date.now()}`)),
      name: clampUtf8Bytes(instrumentName, HEXBOARD_PRESET_NAME_MAX_BYTES),
      folderPath: samplerSoundFolder,
      favorite: false,
      values,
      sampler: { name: instrumentName, envelopeOverride: 0 }
    };
    setNewSamplerSound(null);
    setDraftBase(next);
    setPreset(next);
    setOpenedSource("computer");
    skipNextAutoSend.current = true;
    setSyncStatus(`New sampler sound for ${instrumentName}`);
  }
  const allFolders = useMemo(
    () =>
      Array.from(
        new Set([
          ...defaultFolders,
          ...customFolders,
          ...computerPresets.map((candidate) => candidate.folderPath),
          ...hexboardPresets.map((candidate) => candidate.folderPath),
          preset.folderPath
        ].filter(Boolean))
      ).sort(compareFolderPaths),
    [computerPresets, customFolders, hexboardPresets, preset.folderPath]
  );
  const allWavetableFolders = useMemo(
    () =>
      Array.from(
        new Set([
          rootFolderPath,
          defaultUserWavetableFolder,
          ...builtInWavetables.map((wavetable) => wavetable.folderPath),
          ...customWavetableFolders,
          ...computerWavetables.map((candidate) => candidate.folderPath),
          ...hexboardWavetables.map((candidate) => candidate.folderPath),
          preset.wavetableFolderPath,
          wavetableImportFolder
        ].filter(Boolean))
      ).sort(compareFolderPaths),
    [computerWavetables, customWavetableFolders, hexboardWavetables, preset.wavetableFolderPath, wavetableImportFolder]
  );
  const computerPresetFolders = useMemo(() => Array.from(new Set([
    rootFolderPath,
    ...customFolders,
    ...computerPresets.map((candidate) => candidate.folderPath)
  ])).sort(compareFolderPaths), [computerPresets, customFolders]);
  const hexboardPresetFolders = useMemo(() => Array.from(new Set([
    rootFolderPath,
    ...hexboardPresets.map((candidate) => candidate.folderPath)
  ])).sort(compareFolderPaths), [hexboardPresets]);
  const computerWavetableFolders = useMemo(() => Array.from(new Set([
    rootFolderPath,
    ...customWavetableFolders,
    ...computerWavetables.map((candidate) => candidate.folderPath)
  ])).filter((folder) => folder !== builtInWavetableFolder)
    .sort(compareFolderPaths), [computerWavetables, customWavetableFolders]);
  const hexboardWavetableFolders = useMemo(() => Array.from(new Set([
    rootFolderPath,
    ...hexboardWavetables.map((candidate) => candidate.folderPath)
  ])).filter((folder) => folder !== builtInWavetableFolder)
    .sort(compareFolderPaths), [hexboardWavetables]);
  const wavetableOptions = useMemo(() => {
    const optionFromReference = (ref: { name: string; folderPath: string }) => ({
      value: wavetableOptionValue(ref.folderPath, ref.name),
      label: `${folderLabel(ref.folderPath)} / ${ref.name}`
    });
    const sortReferences = (refs: Array<{ name: string; folderPath: string }>) =>
      refs.sort((left, right) => `${folderLabel(left.folderPath)}/${left.name}`.localeCompare(`${folderLabel(right.folderPath)}/${right.name}`));
    const uniqueDevice = new Map<string, { name: string; folderPath: string }>();
    for (const ref of [...builtInWavetables, ...hexboardWavetables]) {
      const normalized = normalizeWavetableReference(ref.folderPath, ref.name);
      uniqueDevice.set(wavetableSaveKey(normalized), normalized);
    }
    const uniqueComputer = new Map<string, { name: string; folderPath: string }>();
    for (const ref of computerWavetables) {
      const normalized = normalizeWavetableReference(ref.folderPath, ref.name);
      const key = wavetableSaveKey(normalized);
      if (!uniqueDevice.has(key)) {
        uniqueComputer.set(key, normalized);
      }
    }
    const selected = normalizeWavetableReference(preset.wavetableFolderPath, preset.wavetableName);
    const selectedKey = wavetableSaveKey(selected);
    const unavailable = !uniqueDevice.has(selectedKey) && !uniqueComputer.has(selectedKey)
      ? [optionFromReference(selected)]
      : [];
    return {
      device: sortReferences(Array.from(uniqueDevice.values())).map(optionFromReference),
      computer: sortReferences(Array.from(uniqueComputer.values())).map(optionFromReference),
      unavailable
    };
  }, [computerWavetables, hexboardWavetables, preset.wavetableFolderPath, preset.wavetableName]);
  const selectedPreviewWavetable = useMemo(() => {
    if (preset.wavetableName === basicWavetableName) return { samples: basicShapesSamples };
    const selectedKey = wavetableSaveKey(normalizeWavetableReference(preset.wavetableFolderPath, preset.wavetableName));
    return [...computerWavetables, ...hexboardWavetables, ...factoryWavetableSources()].find((wavetable) =>
      wavetable.samples && wavetableSaveKey(wavetable) === selectedKey
    );
  }, [computerWavetables, hexboardWavetables, preset.wavetableFolderPath, preset.wavetableName]);
  const requiredHexBoardWavetable = connected ? hexboardWavetables.find((wavetable) =>
    wavetable.deviceHandle !== undefined && wavetableSaveKey(wavetable) ===
      wavetableSaveKey(normalizeWavetableReference(preset.wavetableFolderPath, preset.wavetableName))
  ) : undefined;
  const previewPatch = useMemo<SynthPreviewPatch>(() => ({
    wavetableName: preset.wavetableName,
    wavetableFolderPath: preset.wavetableFolderPath,
    wavetableSamples: selectedPreviewWavetable?.samples,
    values: preset.values
  }), [preset.values, preset.wavetableFolderPath, preset.wavetableName, selectedPreviewWavetable?.samples]);
  const liveSendPatch = useMemo(() => ({
    values: preset.values,
    wavetableName: preset.wavetableName,
    wavetableFolderPath: preset.wavetableFolderPath,
    sampler: preset.sampler
  }), [preset.values, preset.wavetableFolderPath, preset.wavetableName, preset.sampler]);
  const samplerInstrumentStatus: SamplerInstrumentStatus = !preset.sampler || !connected || hexboardInstruments === null
    ? "unknown" : hexboardInstruments.includes(preset.sampler.name) ? "installed" : "missing";
  const draftPreset = useMemo(() => encodeEditablePreset(preset), [preset]);
  const monoModeSelected = preset.values.PlaybackMode === 1 || preset.values.PlaybackMode === 4;
  const arpModeSelected = preset.values.PlaybackMode === 2 || preset.values.PlaybackMode === 6;
  const wavetableImportOptions = useMemo<Required<SerumWavetableCrunchOptions>>(() => ({
    frameReduction: wavetableFrameReduction,
    normalization: wavetableNormalization,
    smooth: wavetableSmooth,
    dither: wavetableDither
  }), [wavetableDither, wavetableFrameReduction, wavetableNormalization, wavetableSmooth]);
  const renderedWavetableImport = useMemo<RenderedWavetableImport | null>(() => {
    if (!wavetableImportSource) {
      return null;
    }
    try {
      const samples = renderWavetableImportSource(wavetableImportSource, wavetableImportOptions);
      return {
        source: wavetableImportSource,
        samples,
        sampleCrc: crc32(samples)
      };
    } catch (error) {
      return {
        source: wavetableImportSource,
        error: error instanceof Error ? error.message : "Failed to render wavetable preview"
      };
    }
  }, [wavetableImportOptions, wavetableImportSource]);
  const renderedWavetableMipLevelCount = renderedWavetableImport?.samples
    ? synthWavetableMipLevelCount(renderedWavetableImport.samples)
    : 1;
  const renderedWavetableMipSampleCount = synthWavetableMipLevelSampleCount(
    Math.min(wavetablePreviewMipLevel, renderedWavetableMipLevelCount - 1)
  );
  const renderedWavetableMipHarmonicLimit = synthWavetableMipLevelHarmonicLimit(
    Math.min(wavetablePreviewMipLevel, renderedWavetableMipLevelCount - 1)
  );
  const wavetablePreviewPath = useMemo(
    () => renderedWavetableImport?.samples
      ? wavetableFramePreviewPath(renderedWavetableImport.samples, wavetablePreviewFrame, Math.min(wavetablePreviewMipLevel, renderedWavetableMipLevelCount - 1))
      : "",
    [renderedWavetableImport?.samples, renderedWavetableMipLevelCount, wavetablePreviewFrame, wavetablePreviewMipLevel]
  );
  const wavetableImportControlsDisabled = wavetableImportFormat === "hexboard" || renderedWavetableImport?.source.format === "hexboard";

  useEffect(() => {
    try { saveComputerPresets(computerPresets); setLibraryStorageError(""); }
    catch { setLibraryStorageError("Browser save failed. Export a file to keep your work."); }
  }, [computerPresets]);

  useEffect(() => {
    try { saveComputerWavetables(computerWavetables); }
    catch { setSyncStatus("Wavetable could not be saved in this browser. Export a file to keep it."); }
  }, [computerWavetables]);

  useEffect(() => {
    saveStoredFolders(synthPresetFoldersStorageKey, customFolders);
  }, [customFolders]);

  useEffect(() => {
    saveStoredFolders(synthWavetableFoldersStorageKey, customWavetableFolders);
  }, [customWavetableFolders]);

  useEffect(() => {
    latestPreviewPatch.current = previewPatch;
    previewControllerRef.current?.setPatch(previewPatch);
  }, [previewPatch]);

  useEffect(() => {
    latestPreviewVolume.current = previewVolume;
    previewControllerRef.current?.setVolume(previewVolume);
  }, [previewVolume]);

  useEffect(() => {
    latestPreviewMod.current = previewMod;
    previewControllerRef.current?.setMod(previewMod);
  }, [previewMod]);

  useEffect(() => {
    if (!auditionOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || eventTargetAcceptsText(event)) {
        return;
      }
      const note = auditionNoteFromKey(event.key, previewOctave);
      if (note === null || pressedPreviewKeys.current.has(event.key.toLowerCase())) {
        return;
      }
      event.preventDefault();
      pressedPreviewKeys.current.set(event.key.toLowerCase(), note);
      void startPreviewNote(note);
    }

    function handleKeyUp(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      const note = pressedPreviewKeys.current.get(key);
      if (note === undefined) {
        return;
      }
      event.preventDefault();
      pressedPreviewKeys.current.delete(key);
      stopPreviewNote(note);
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      pressedPreviewKeys.current.clear();
    };
  }, [auditionOpen, previewOctave]);

  // MIDI preview remains active when the test keyboard is collapsed.
  useEffect(() => {
    const releaseOnBlur = () => stopAllPreviewNotes();
    const releaseWhenHidden = () => { if (document.hidden) stopAllPreviewNotes(); };
    window.addEventListener("blur", releaseOnBlur);
    document.addEventListener("visibilitychange", releaseWhenHidden);
    return () => {
      window.removeEventListener("blur", releaseOnBlur);
      document.removeEventListener("visibilitychange", releaseWhenHidden);
    };
  }, []);

  useEffect(() => () => {
    if (previewChordTimerRef.current !== null) {
      window.clearTimeout(previewChordTimerRef.current);
    }
    void previewControllerRef.current?.close();
  }, []);

  useEffect(() => {
    if (transport instanceof MockMidiTransport) {
      setHexboardPresets([]);
      setHexboardWavetables([]);
      setEditorHydrated(true);
      return;
    }

    let cancelled = false;
    setEditorHydrated(false);
    skipNextAutoSend.current = true;

    const hydrateTimer = window.setTimeout(() => void (async () => {
      setEditorHydrated(true);
      if (!cancelled) {
        await refreshHexBoardLibrary("Loaded HexBoard Library");
        await refreshHexBoardWavetables("Loaded HexBoard Wavetables");
      }
    })(), 0);

    return () => {
      cancelled = true;
      window.clearTimeout(hydrateTimer);
    };
  }, [client, transport]);

  useEffect(() => {
    if (!connected || !autoSend || !editorHydrated) {
      return;
    }
    if (skipNextAutoSend.current) {
      skipNextAutoSend.current = false;
      return;
    }

    const timeout = window.setTimeout(() => {
      const liveParam = pendingLiveSynthParam.current;
      pendingLiveSynthParam.current = null;
      if (liveParam && lastPreviewIdentity.current === preset.objectIdHex) {
        void sendLiveParameterPreview(liveParam, "Auto-sent");
      } else {
        void sendPreview("Auto-sent");
      }
    }, 120);

    return () => window.clearTimeout(timeout);
  }, [connected, autoSend, editorHydrated, liveSendPatch]);

  function updateValue(key: EditableSynthValueKey, value: number) {
    setSyncStatus("Ready");
    const clampedValue = clampSynthValue(key, value);
    skipNextAutoSend.current = false;
    pendingLiveSynthParam.current = { key, value: clampedValue };
    setEditorHydrated(true);
    setPreset((current) => ({
      ...current,
      values: {
        ...current.values,
        [key]: clampedValue
      }
    }));
  }

  function updatePresetMetadata(update: (current: EditableSynthPreset) => EditableSynthPreset) {
    skipNextAutoSend.current = false;
    pendingLiveSynthParam.current = null;
    setEditorHydrated(true);
    setPreset(update);
  }

  function updatePresetName(name: string) {
    setSyncStatus("Ready");
    setPreset((current) => ({ ...current, name }));
  }

  function previewController(): SynthPreviewController {
    if (!previewControllerRef.current) {
      previewControllerRef.current = new SynthPreviewController();
      previewControllerRef.current.setPatch(latestPreviewPatch.current ?? previewPatch);
      previewControllerRef.current.setVolume(latestPreviewVolume.current);
      previewControllerRef.current.setMod(latestPreviewMod.current);
    }
    return previewControllerRef.current;
  }

  // Stable for the editor's live pictures; the controller is created lazily and lives as long as this view.
  const subscribeVoiceShape = useCallback((listener: SynthVoiceShapeListener) => previewController().onVoiceShape(listener), []);

  async function startPreviewNote(note: number) {
    try {
      setHeldPreviewNotes((current) => current.includes(note) ? current : [...current, note]);
      setPreviewStatus(`Playing ${midiNoteLabel(note)}`);
      await previewController().noteOn(note);
    } catch (error) {
      stopPreviewNote(note);
      setPreviewStatus(error instanceof Error ? error.message : "Failed to start browser audio");
    }
  }

  function stopPreviewNote(note: number) {
    previewControllerRef.current?.noteOff(note);
    setHeldPreviewNotes((current) => current.filter((heldNote) => heldNote !== note));
  }

  function stopAllPreviewNotes(status = "Stopped") {
    setPreviewResetToken(current => current + 1);
    previewStopGeneration.current++;
    if (previewChordTimerRef.current !== null) {
      window.clearTimeout(previewChordTimerRef.current);
      previewChordTimerRef.current = null;
    }
    pressedPreviewKeys.current.clear();
    previewControllerRef.current?.allNotesOff();
    setHeldPreviewNotes([]);
    setPreviewStatus(status);
  }

  function setAuditionExpanded(open: boolean) {
    if (!open) {
      // Release only typing/onscreen/chord notes; keep the MIDI router running.
      previewStopGeneration.current++;
      if (previewChordTimerRef.current !== null) {
        window.clearTimeout(previewChordTimerRef.current);
        previewChordTimerRef.current = null;
      }
      pressedPreviewKeys.current.clear();
      heldPreviewNotes.forEach(stopPreviewNote);
    }
    setAuditionOpen(open);
  }

  function changePreviewOctave(octave: number) {
    stopAllPreviewNotes("Octave changed");
    setPreviewOctave(clampNumber(octave, 1, 7));
  }

  async function playPreviewChord() {
    stopAllPreviewNotes("Starting chord");
    const generation = previewStopGeneration.current;
    const root = (previewOctave + 1) * 12;
    const notes = [root, root + 7, root + 12, root + 16, root + 19];
    await Promise.all(notes.map((note) => startPreviewNote(note)));
    if (generation !== previewStopGeneration.current) return;
    previewChordTimerRef.current = window.setTimeout(() => {
      stopAllPreviewNotes("Chord played");
    }, 1400);
  }

  function createPresetFolder(name: string): string | null {
    const folder = normalizeDisplayFolderPath(name);
    if (!folder || folder === rootFolderPath) {
      setSyncStatus("Enter a folder name first");
      return null;
    }
    setCustomFolders((current) => Array.from(new Set([...current, folder])).sort(compareFolderPaths));
    setSyncStatus(`Folder ${folderLabel(folder)} ready in Browser Library`);
    return folder;
  }

  function addFolder() {
    if (createPresetFolder(newFolder) !== null) setNewFolder("");
  }

  function selectPresetFolder(value: string) {
    if (value === "new") {
      setPresetFolderName("");
      setCreatingPresetFolder(true);
      return;
    }
    setCreatingPresetFolder(false);
    updatePresetMetadata((current) => ({ ...current, folderPath: value.slice("folder:".length) }));
  }

  function addWavetableFolder() {
    const folder = normalizeDisplayFolderPath(newWavetableFolder);
    if (folder === rootFolderPath && !newWavetableFolder.trim()) {
      setSyncStatus("Enter a folder name first");
      return;
    }
    setCustomWavetableFolders((current) => Array.from(new Set([...current, folder])).sort());
    setNewWavetableFolder("");
    setSyncStatus(`Created ${folderLabel(folder)} in Browser Wavetables`);
  }

  function deletePresetFolder(folderPath: string) {
    const count = computerPresets.filter((candidate) => candidate.folderPath === folderPath).length;
    if (count > 0) {
      setSyncStatus(`Move or erase the ${count} preset${count === 1 ? "" : "s"} in ${folderLabel(folderPath)} first`);
      return;
    }
    setCustomFolders((current) => current.filter((folder) => folder !== folderPath));
    setFolderFilters((current) => ({ ...current, computer: current.computer === folderPath ? null : current.computer }));
    setPreset((current) => current.folderPath === folderPath ? { ...current, folderPath: rootFolderPath } : current);
    setSyncStatus(`Deleted ${folderLabel(folderPath)} from Browser Library`);
  }

  function deleteWavetableFolder(folderPath: string) {
    const count = computerWavetables.filter((candidate) => candidate.folderPath === folderPath).length;
    if (count > 0) {
      setSyncStatus(`Move or erase the ${count} wavetable${count === 1 ? "" : "s"} in ${folderLabel(folderPath)} first`);
      return;
    }
    setCustomWavetableFolders((current) => current.filter((folder) => folder !== folderPath));
    setWavetableFolderFilters((current) => ({ ...current, computer: current.computer === folderPath ? null : current.computer }));
    setWavetableImportFolder((current) => current === folderPath ? rootFolderPath : current);
    setSyncStatus(`Deleted ${folderLabel(folderPath)} from Browser Wavetables`);
  }

  function applyPresetWavetable(wavetable: { name: string; folderPath: string }) {
    skipNextAutoSend.current = true;
    pendingLiveSynthParam.current = null;
    setEditorHydrated(true);
    setPreset((current) => ({
      ...current,
      wavetableName: wavetable.name,
      wavetableFolderPath: wavetable.folderPath,
      values: {
        ...current.values,
        Waveform: 27
      }
    }));
  }

  async function sendLiveWavetableSelection(wavetable: { name: string; folderPath: string }) {
    if (!connected || !autoSend) {
      return;
    }
    const referenceKey = wavetableSaveKey(wavetable);
    const builtInIndex = builtInWavetables.findIndex((candidate) => wavetableSaveKey(candidate) === referenceKey);
    const deviceWavetable = hexboardWavetables.find((candidate) => wavetableSaveKey(candidate) === referenceKey);
    const selector = builtInIndex >= 0 ? SynthWavetableSelector.BuiltIn : SynthWavetableSelector.Catalog;
    const index = builtInIndex >= 0 ? builtInIndex : deviceWavetable?.deviceHandle;
    if (index === undefined) {
      setSyncStatus(`Cannot live-select ${wavetable.name}: its HexBoard handle is unavailable`);
      return;
    }
    try {
      await client.sendSynthWavetableSelect(selector, index);
      setLastFrameCount(1);
      setSyncStatus(`Previewing ${wavetable.name} on HexBoard`);
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : "Failed to select synth wavetable");
    }
  }

  async function selectPresetWavetable(value: string) {
    if (value === "import-wavetable") {
      setWavetableImportDialogOpen(true);
      return;
    }
    const wavetable = wavetableReferenceFromOptionValue(value);
    if (!connected || !autoSend) { applyPresetWavetable(wavetable); return; }
    const referenceKey = wavetableSaveKey(wavetable);
    const isOnDevice = builtInWavetables.some((candidate) => wavetableSaveKey(candidate) === referenceKey)
      || hexboardWavetables.some((candidate) => wavetableSaveKey(candidate) === referenceKey);
    if (isOnDevice) {
      applyPresetWavetable(wavetable);
      await sendLiveWavetableSelection(wavetable);
      return;
    }

    const computerWavetable = computerWavetables.find((candidate) => wavetableSaveKey(candidate) === referenceKey);
    if (!computerWavetable) {
      setSyncStatus(`${wavetable.name} is not available on HexBoard`);
      return;
    }
    if (!computerWavetable.samples) {
      setSyncStatus(`Cannot copy ${computerWavetable.name} to HexBoard: sample data is not loaded`);
      return;
    }
    if (!window.confirm(
      `"${computerWavetable.name}" is only in Browser Wavetables. Copy it to HexBoard and use it for this preset?`
    )) {
      setSyncStatus("Wavetable selection canceled");
      return;
    }

    const uploaded = await uploadWavetableToHexBoard(computerWavetable, "Copied");
    if (uploaded) {
      applyPresetWavetable(uploaded);
    }
  }

  function openPreset(source: LibrarySpace, nextPreset: EditableSynthPreset) {
    if (source === "hexboard") setSavedDeviceContent(current => ({ ...current, [nextPreset.objectIdHex]: JSON.stringify(exportPreset(nextPreset)) }));
    const entry = drafts.entries[`${source}:${nextPreset.objectIdHex}`];
    const selectedPreset = clonePreset(entry?.value ?? nextPreset);
    setDraftBase(entry?.base ?? clonePreset(nextPreset));
    stopAllPreviewNotes("Loaded preset");
    skipNextAutoSend.current = true;
    lastPreviewIdentity.current = "";
    setEditorHydrated(true);
    setPreset(selectedPreset);
    setOpenedSource(source);
    setSyncStatus(entry && !sameContent(entry.value, entry.base) ? "Resumed draft" : "Opened sound");
    if (connected && autoSend) void sendPresetPreview(selectedPreset, "Previewing");
  }

  function findPreset(dragged: DraggedPreset): EditableSynthPreset | undefined {
    const presets = dragged.space === "computer" ? computerPresets : hexboardPresets;
    return presets.find((candidate) => candidate.objectIdHex === dragged.objectIdHex);
  }

  function selectFolderFilter(space: LibrarySpace, folderPath: string | null) {
    setFolderFilters((current) => ({
      ...current,
      [space]: folderPath
    }));
  }

  function selectWavetableFolderFilter(space: LibrarySpace, folderPath: string | null) {
    setWavetableFolderFilters((current) => ({
      ...current,
      [space]: folderPath
    }));
  }

  function confirmPresetOverwrite(targetLabel: string, existing: EditableSynthPreset, deletesExisting: boolean): boolean {
    const deletionWarning = deletesExisting
      ? " The existing preset will be permanently deleted after the replacement is saved."
      : " This permanently replaces the existing destination preset.";
    return window.confirm(
      `Overwrite “${existing.name}” in ${folderLabel(existing.folderPath)} on ${targetLabel}?${deletionWarning}`
    );
  }

  function preparePresetForLibrarySave(
    nextPreset: EditableSynthPreset,
    targetPresets: EditableSynthPreset[],
    targetLabel: string,
    keepDeviceHandle: boolean,
    confirmOverwrite = true
  ): { preset: EditableSynthPreset; overwritten: boolean; replacedPreset?: EditableSynthPreset } | null {
    const normalized = normalizedPresetForSave(nextPreset);
    const current = targetPresets.find((candidate) => candidate.objectIdHex === normalized.objectIdHex);
    const existing = targetPresets.find((candidate) =>
      candidate.objectIdHex !== normalized.objectIdHex && presetSaveKey(candidate) === presetSaveKey(normalized)
    );
    if (existing && confirmOverwrite && !confirmPresetOverwrite(targetLabel, existing, current !== undefined)) {
      return null;
    }
    if (current) {
      return {
        preset: {
          ...normalized,
          objectIdHex: current.objectIdHex,
          deviceHandle: keepDeviceHandle ? current.deviceHandle : undefined
        },
        overwritten: existing !== undefined,
        ...(existing ? { replacedPreset: existing } : {})
      };
    }
    if (existing) {
      return {
        preset: {
          ...normalized,
          objectIdHex: existing.objectIdHex,
          deviceHandle: keepDeviceHandle ? existing.deviceHandle : undefined
        },
        overwritten: true
      };
    }

    return {
      preset: {
        ...normalized,
        objectIdHex: freshPresetObjectIdHex(normalized),
        deviceHandle: undefined
      },
      overwritten: false
    };
  }

  function organizationConflict(
    space: LibrarySpace,
    source: EditableSynthPreset,
    name: string,
    folderPath: string
  ): EditableSynthPreset | undefined {
    const candidates = space === "computer" ? computerPresets : hexboardPresets;
    const destinationKey = presetSaveKey({ ...source, name, folderPath });
    return candidates.find((candidate) =>
      candidate.objectIdHex !== source.objectIdHex && presetSaveKey(candidate) === destinationKey
    );
  }

  function organizationConflictSummary(
    space: LibrarySpace,
    source: EditableSynthPreset,
    name: string,
    folderPath: string
  ): LibraryOrganizationConflict | null {
    const conflict = organizationConflict(space, source, name, folderPath);
    return conflict ? { name: conflict.name, folderPath: conflict.folderPath } : null;
  }

  async function organizePresetInPlace(
    request: PresetOrganizationRequest,
    name: string,
    folderPath: string,
    favorite = request.preset.favorite,
    favoriteOnly = false
  ): Promise<boolean> {
    const nextPreset = normalizedPresetForSave({ ...clonePreset(request.preset), name, folderPath, favorite });
    // A star toggled on the open sound keeps its unsaved edits.
    const updateOpenPreset = (stored: EditableSynthPreset) => {
      skipNextAutoSend.current = true;
      if (!favoriteOnly) { setPreset(clonePreset(stored)); return; }
      setPreset((current) => ({ ...current, favorite: stored.favorite }));
      setDraftBase((base) => ({ ...base, favorite: stored.favorite }));
    };
    const conflict = organizationConflict(request.space, request.preset, nextPreset.name, nextPreset.folderPath);
    if (request.space === "computer") {
      setComputerPresets((current) => {
        const withoutConflict = conflict ? removePreset(current, conflict.objectIdHex) : current;
        return upsertPreset(withoutConflict, { ...nextPreset, deviceHandle: undefined });
      });
      setCustomFolders((current) => Array.from(new Set([...current, nextPreset.folderPath])).sort(compareFolderPaths));
      if (openedSource === "computer" && preset.objectIdHex === request.preset.objectIdHex) {
        updateOpenPreset({ ...nextPreset, deviceHandle: undefined });
      }
      setSyncStatus(
        `${conflict ? "Replaced existing preset and updated" : "Updated"} ${nextPreset.name} in Browser Library`
      );
      return true;
    }

    const capacityProblem = hexboardPresetCapacityProblem(hexboardPresets, [nextPreset]);
    if (capacityProblem) {
      setSyncStatus(capacityProblem);
      return false;
    }

    if (transport instanceof MockMidiTransport || request.preset.deviceHandle === undefined) {
      setHexboardPresets((current) => {
        const withoutConflict = conflict ? removePreset(current, conflict.objectIdHex) : current;
        return upsertPreset(withoutConflict, { ...nextPreset, deviceHandle: request.preset.deviceHandle });
      });
      if (openedSource === "hexboard" && preset.objectIdHex === request.preset.objectIdHex) {
        updateOpenPreset(nextPreset);
      }
      setSyncStatus(
        `${conflict ? "Replaced existing preset and updated" : "Updated"} ${nextPreset.name} in HexBoard Library`
      );
      return true;
    }

    try {
      setSyncStatus(`Updating ${request.preset.name} in HexBoard Library...`);
      const frames = await client.sendSynthPresetUpdateConfirmed(
        encodeEditablePreset(nextPreset),
        request.preset.deviceHandle
      );
      if (conflict) {
        if (conflict.deviceHandle === undefined) {
          throw new Error(`Cannot replace ${conflict.name}: its HexBoard handle is unavailable`);
        }
        await client.deleteSynthPreset(conflict.deviceHandle);
      }
      setLastFrameCount(frames.length);
      await refreshHexBoardLibrary(
        `${conflict ? "Replaced existing preset and updated" : "Updated"} ${nextPreset.name} in HexBoard Library`
      );
      if (openedSource === "hexboard" && preset.objectIdHex === request.preset.objectIdHex) {
        updateOpenPreset(nextPreset);
      }
      return true;
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : "Failed to update HexBoard preset");
      return false;
    }
  }

  function togglePresetFavorite(space: LibrarySpace, item: EditableSynthPreset) {
    void organizePresetInPlace({ space, preset: clonePreset(item) }, item.name, item.folderPath, !item.favorite, true);
  }

  function saveToComputer(nextPreset = preset, prefix = "Saved") {
    const decision = preparePresetForLibrarySave(nextPreset, computerPresets, "Browser Library", false);
    if (!decision) {
      setSyncStatus("Save canceled");
      return;
    }
    const normalized = {
      ...decision.preset,
      deviceHandle: undefined
    };
    setComputerPresets((current) => {
      const withoutReplaced = decision.replacedPreset
        ? removePreset(current, decision.replacedPreset.objectIdHex)
        : current;
      return upsertPreset(withoutReplaced, normalized);
    });
    setCustomFolders((current) => Array.from(new Set([...current, normalized.folderPath])).sort(compareFolderPaths));
    skipNextAutoSend.current = true;
    drafts.forget(draftKey);
    setDraftBase(clonePreset(normalized));
    setPreset(clonePreset(normalized));
    setOpenedSource("computer");
    setSyncStatus(`${decision.overwritten ? "Overwrote" : prefix} ${normalized.name} in Browser Library`);
  }

  async function sendPresetPreview(nextPreset: EditableSynthPreset, prefix = "Sent") {
    if (!connected) return;
    pendingLiveSynthParam.current = null;
    try {
      const resolved = await ensurePresetWavetableOnHexBoard(nextPreset);
      if (!resolved) return;
      const frames = await client.sendSynthPresetPreview(encodeEditablePreset(resolved));
      lastPreviewIdentity.current = nextPreset.objectIdHex;
      setLastFrameCount(frames.length);
      setSyncStatus("Previewing on HexBoard · not saved");
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : "Failed to send synth preset");
    }
  }

  async function sendPreview(prefix = "Sent") {
    await sendPresetPreview(preset, prefix);
  }

  async function sendLiveParameterPreview(param: { key: EditableSynthValueKey; value: number }, prefix = "Sent") {
    if (!connected) return;
    try {
      await client.sendSynthParameterPreview(SynthSettingKey[param.key], param.value);
      setLastFrameCount(1);
      setSyncStatus("Previewing on HexBoard · not saved");
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : "Failed to send synth parameter");
    }
  }

  function requestWavetableResolution(
    nextPreset: EditableSynthPreset,
    matchingComputerWavetable?: EditableSynthWavetable
  ): Promise<WavetableResolutionChoice> {
    setWavetableResolutionAlternate(basicWavetableName);
    return new Promise((resolve) => {
      setWavetableResolutionRequest({
        presetName: nextPreset.name,
        requiredName: nextPreset.wavetableName,
        matchingComputerWavetable,
        resolve
      });
    });
  }

  function closeWavetableResolution(choice: WavetableResolutionChoice) {
    wavetableResolutionRequest?.resolve(choice);
    setWavetableResolutionRequest(null);
  }

  async function ensurePresetWavetableOnHexBoard(nextPreset: EditableSynthPreset): Promise<EditableSynthPreset | null> {
    if (nextPreset.sampler) {
      const instruments = hexboardInstruments ?? await loadHexBoardInstruments();
      if (!instruments.includes(nextPreset.sampler.name)) {
        setSyncStatus(`“${nextPreset.sampler.name}” is not on HexBoard. Send it from the Instruments tab first.`);
        return null;
      }
      return clonePreset(nextPreset);
    }
    const reference = normalizeWavetableReference(nextPreset.wavetableFolderPath, nextPreset.wavetableName);
    const referenceKey = wavetableSaveKey(reference);
    const deviceWavetable = [...builtInWavetables, ...hexboardWavetables]
      .find((wavetable) => wavetableSaveKey(wavetable) === referenceKey);
    if (deviceWavetable) {
      return {
        ...clonePreset(nextPreset),
        wavetableName: deviceWavetable.name,
        wavetableFolderPath: deviceWavetable.folderPath
      };
    }

    const computerWavetable = computerWavetables.find((wavetable) => wavetableSaveKey(wavetable) === referenceKey);
    const choice = await requestWavetableResolution(nextPreset, computerWavetable);
    if (!choice) {
      setSyncStatus("Save canceled");
      return null;
    }
    if (choice.kind === "alternate") {
      return {
        ...clonePreset(nextPreset),
        wavetableName: choice.wavetable.name,
        wavetableFolderPath: choice.wavetable.folderPath
      };
    }
    if (!computerWavetable?.samples) {
      setSyncStatus(`Cannot copy ${reference.name} to HexBoard: matching sample data is not loaded`);
      return null;
    }
    const uploaded = await uploadWavetableToHexBoard(computerWavetable, "Copied");
    return uploaded
      ? {
          ...clonePreset(nextPreset),
          wavetableName: uploaded.name,
          wavetableFolderPath: uploaded.folderPath
        }
      : null;
  }

  async function uploadToHexBoard(
    nextPreset = preset,
    prefix = "Saved",
    options: { confirmOverwrite?: boolean; refresh?: boolean; updateEditor?: boolean } = {}
  ): Promise<boolean> {
    if (!connected) { setSyncStatus("Connect HexBoard to save this sound"); return false; }
    const resolvedPreset = await ensurePresetWavetableOnHexBoard(nextPreset);
    if (!resolvedPreset) {
      return false;
    }
    const decision = preparePresetForLibrarySave(
      resolvedPreset,
      hexboardPresets,
      "HexBoard Library",
      true,
      options.confirmOverwrite ?? true
    );
    if (!decision) {
      setSyncStatus("Save canceled");
      return false;
    }
    const normalized = decision.preset;
    const capacityProblem = hexboardPresetCapacityProblem(hexboardPresets, [normalized]);
    if (capacityProblem) {
      setSyncStatus(capacityProblem);
      return false;
    }
    try {
      const encodedPreset = encodeEditablePreset(normalized);
      const frames = transport instanceof MockMidiTransport
        ? await client.sendSynthPresetSave(encodedPreset)
        : await client.sendSynthPresetSaveConfirmed(encodedPreset);
      if (decision.replacedPreset && !(transport instanceof MockMidiTransport)) {
        if (decision.replacedPreset.deviceHandle === undefined) {
          throw new Error(`Cannot replace ${decision.replacedPreset.name}: its HexBoard handle is unavailable`);
        }
        await client.deleteSynthPreset(decision.replacedPreset.deviceHandle);
      }
      setLastFrameCount(frames.length);
      setSavedDeviceContent(current => ({ ...current, [normalized.objectIdHex]: JSON.stringify(exportPreset(normalized)) }));
      if ((options.updateEditor ?? true) && sameContent(latestPreset.current, nextPreset)) {
        skipNextAutoSend.current = true;
        setPreset(clonePreset(normalized));
      }
      if (transport instanceof MockMidiTransport) {
        setHexboardPresets((current) => {
          const withoutReplaced = decision.replacedPreset
            ? removePreset(current, decision.replacedPreset.objectIdHex)
            : current;
          return upsertPreset(withoutReplaced, normalized);
        });
        setSyncStatus(`${decision.overwritten ? "Overwrote" : prefix} ${normalized.name} on HexBoard`);
      } else if (options.refresh ?? true) {
        await refreshHexBoardLibrary(`${decision.overwritten ? "Overwrote" : prefix} ${normalized.name} on HexBoard`);
      }
      return true;
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : "Failed to save synth preset");
      return false;
    }
  }

  function confirmWavetableOverwrite(targetLabel: string, existing: EditableSynthWavetable): boolean {
    return window.confirm(`Overwrite "${existing.name}" in ${folderLabel(existing.folderPath)} on ${targetLabel}?`);
  }

  function prepareWavetableForLibrarySave(
    nextWavetable: EditableSynthWavetable,
    targetWavetables: EditableSynthWavetable[],
    targetLabel: string,
    keepDeviceHandle: boolean
  ): { wavetable: EditableSynthWavetable; overwritten: boolean } | null {
    const normalized = {
      ...cloneWavetable(nextWavetable),
      name: normalizedWavetableName(nextWavetable.name),
      folderPath: normalizeDisplayFolderPath(nextWavetable.folderPath)
    };
    const existing = findWavetableByFolderAndName(targetWavetables, normalized);
    if (existing) {
      if (!confirmWavetableOverwrite(targetLabel, existing)) {
        return null;
      }
      return {
        wavetable: {
          ...normalized,
          objectIdHex: existing.objectIdHex,
          deviceHandle: keepDeviceHandle ? existing.deviceHandle : undefined
        },
        overwritten: true
      };
    }

    return {
      wavetable: {
        ...normalized,
        deviceHandle: undefined
      },
      overwritten: false
    };
  }

  function saveWavetableToComputer(nextWavetable: EditableSynthWavetable, prefix = "Saved") {
    const decision = prepareWavetableForLibrarySave(nextWavetable, computerWavetables, "Browser Wavetables", false);
    if (!decision) {
      setSyncStatus("Save canceled");
      return;
    }
    const normalized = {
      ...decision.wavetable,
      deviceHandle: undefined
    };
    setComputerWavetables((current) => upsertWavetable(current, normalized));
    setCustomWavetableFolders((current) => Array.from(new Set([...current, normalized.folderPath])).sort());
    setSyncStatus(`${decision.overwritten ? "Overwrote" : prefix} ${normalized.name} in Browser Wavetables`);
  }

  async function uploadWavetableToHexBoard(nextWavetable: EditableSynthWavetable, prefix = "Saved"): Promise<EditableSynthWavetable | null> {
    if (!connected) { setSyncStatus("Wavetable saved in browser"); return null; }
    if (builtInWavetables.some((wavetable) => wavetableSaveKey(wavetable) === wavetableSaveKey(nextWavetable))) {
      setSyncStatus(`Cannot copy ${nextWavetable.name} to HexBoard: that name is reserved by a built-in wavetable`);
      return null;
    }
    const decision = prepareWavetableForLibrarySave(nextWavetable, hexboardWavetables, "HexBoard Wavetables", true);
    if (!decision) {
      setSyncStatus("Save canceled");
      return null;
    }
    const normalized = decision.wavetable;
    try {
      const encodedWavetable = encodeEditableWavetable(normalized);
      const frames = transport instanceof MockMidiTransport
        ? await client.sendSynthWavetableImport(encodedWavetable)
        : await client.sendSynthWavetableImportConfirmed(encodedWavetable);
      setLastFrameCount(frames.length);
      if (transport instanceof MockMidiTransport) {
        setHexboardWavetables((current) => upsertWavetable(current, normalized));
        setSyncStatus(`${decision.overwritten ? "Overwrote" : prefix} ${normalized.name} in HexBoard Wavetables with ${frames.length} frame${frames.length === 1 ? "" : "s"}`);
      } else {
        await refreshHexBoardWavetables(`${decision.overwritten ? "Overwrote" : prefix} ${normalized.name} in HexBoard Wavetables with ${frames.length} frame${frames.length === 1 ? "" : "s"}`);
      }
      return normalized;
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : "Failed to save synth wavetable");
      return null;
    }
  }

  async function loadHexBoardWavetableSamples(nextWavetable: EditableSynthWavetable): Promise<EditableSynthWavetable> {
    if (nextWavetable.samples) {
      return nextWavetable;
    }
    if (transport instanceof MockMidiTransport || nextWavetable.deviceHandle === undefined) {
      return nextWavetable;
    }
    setSyncStatus(`Reading ${nextWavetable.name} sample data from HexBoard...`);
    const loaded = wavetableFromObjectBody(await client.readSynthWavetable(nextWavetable.deviceHandle), nextWavetable.deviceHandle);
    setHexboardWavetables((current) => upsertWavetable(current, loaded));
    return loaded;
  }

  async function downloadWavetableFromHexBoard(nextWavetable: EditableSynthWavetable) {
    try {
      const loaded = await loadHexBoardWavetableSamples(nextWavetable);
      if (!loaded.samples) {
        setSyncStatus(`${loaded.name} does not have sample data loaded to copy`);
        return;
      }
      saveWavetableToComputer(loaded, "Copied");
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : "Failed to copy HexBoard wavetable to Browser Library");
    }
  }

  async function copyPreviewWavetableFromHexBoard() {
    if (!requiredHexBoardWavetable || copyingPreviewWavetable) return;
    setCopyingPreviewWavetable(true);
    try {
      await downloadWavetableFromHexBoard(requiredHexBoardWavetable);
    } finally {
      setCopyingPreviewWavetable(false);
    }
  }

  function useWavetableAsPresetSource(nextWavetable: EditableSynthWavetable) {
    void selectPresetWavetable(wavetableOptionValue(nextWavetable.folderPath, nextWavetable.name));
  }

  function eraseWavetable(space: LibrarySpace, erasedWavetable: EditableSynthWavetable) {
    if (space === "computer") {
      setComputerWavetables((current) => removeWavetable(current, erasedWavetable.objectIdHex));
      setSyncStatus(`Erased ${erasedWavetable.name} from Browser Wavetables`);
      return;
    }

    if (transport instanceof MockMidiTransport || erasedWavetable.deviceHandle === undefined) {
      setHexboardWavetables((current) => removeWavetable(current, erasedWavetable.objectIdHex));
      setSyncStatus(`Erased ${erasedWavetable.name} from HexBoard Wavetables`);
      return;
    }

    void client.deleteSynthWavetable(erasedWavetable.deviceHandle)
      .then(() => refreshHexBoardWavetables(`Erased ${erasedWavetable.name} from HexBoard Wavetables`))
      .catch((error) => setSyncStatus(error instanceof Error ? error.message : "Failed to erase HexBoard wavetable"));
  }

  async function editWavetable(space: LibrarySpace, editedWavetable: EditableSynthWavetable) {
    const name = window.prompt("Wavetable name", editedWavetable.name);
    if (name === null) {
      setSyncStatus("Edit canceled");
      return;
    }
    const folderPath = window.prompt("Wavetable folder", editedWavetable.folderPath);
    if (folderPath === null) {
      setSyncStatus("Edit canceled");
      return;
    }
    const renamed = {
      ...cloneWavetable(editedWavetable),
      name: normalizedWavetableName(name),
      folderPath: normalizeDisplayFolderPath(folderPath)
    };

    if (space === "computer") {
      const duplicate = computerWavetables.find((candidate) =>
        candidate.objectIdHex !== renamed.objectIdHex && wavetableSaveKey(candidate) === wavetableSaveKey(renamed)
      );
      if (duplicate && !confirmWavetableOverwrite("Browser Wavetables", duplicate)) {
        setSyncStatus("Edit canceled");
        return;
      }
      setComputerWavetables((current) => {
        const withoutDuplicate = duplicate ? removeWavetable(current, duplicate.objectIdHex) : current;
        return upsertWavetable(withoutDuplicate, renamed);
      });
      setCustomWavetableFolders((current) => Array.from(new Set([...current, renamed.folderPath])).sort());
      setSyncStatus(`Updated ${renamed.name} in Browser Wavetables`);
      return;
    }

    if (renamed.deviceHandle === undefined) {
      setHexboardWavetables((current) => upsertWavetable(current, renamed));
      setSyncStatus(`Updated ${renamed.name} in HexBoard Wavetables`);
      return;
    }

    const duplicate = hexboardWavetables.find((candidate) =>
      candidate.objectIdHex !== renamed.objectIdHex && wavetableSaveKey(candidate) === wavetableSaveKey(renamed)
    );
    if (duplicate) {
      setSyncStatus(`Cannot rename: ${renamed.name} already exists on HexBoard`);
      return;
    }

    try {
      const frames = await client.sendSynthWavetableMetadataUpdate(encodeEditableWavetableMetadata(renamed), renamed.deviceHandle);
      setLastFrameCount(frames.length);
      await refreshHexBoardWavetables(`Updated ${renamed.name} in HexBoard Wavetables with ${frames.length} frame${frames.length === 1 ? "" : "s"}`);
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : "Failed to update HexBoard wavetable");
    }
  }

  function downloadFromHexBoard(nextPreset: EditableSynthPreset) {
    saveToComputer(nextPreset, "Copied");
  }

  function erasePreset(space: LibrarySpace, erasedPreset: EditableSynthPreset) {
    const libraryLabel = space === "computer" ? "Browser Library" : "HexBoard Library";
    if (!window.confirm(
      `Delete “${erasedPreset.name}” from ${folderLabel(erasedPreset.folderPath)} in ${libraryLabel}? This cannot be undone.`
    )) {
      setSyncStatus("Delete canceled");
      return;
    }
    if (space === "computer") {
      setComputerPresets((current) => removePreset(current, erasedPreset.objectIdHex));
      setSyncStatus(`Deleted ${erasedPreset.name} from Browser Library`);
      return;
    }

    if (transport instanceof MockMidiTransport || erasedPreset.deviceHandle === undefined) {
      setHexboardPresets((current) => removePreset(current, erasedPreset.objectIdHex));
      setSyncStatus(`Deleted ${erasedPreset.name} from HexBoard Library`);
      return;
    }

    void client.deleteSynthPreset(erasedPreset.deviceHandle)
      .then(() => refreshHexBoardLibrary(`Deleted ${erasedPreset.name} from HexBoard Library`))
      .catch((error) => setSyncStatus(error instanceof Error ? error.message : "Failed to delete HexBoard preset"));
  }

  function downloadPresetFile(nextPreset: EditableSynthPreset) {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            format: presetFileFormat,
            preset: exportPreset(nextPreset)
          },
          null,
          2
        )
      ],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeFileName(`${nextPreset.folderPath}-${nextPreset.name}`)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setSyncStatus(`Exported ${nextPreset.name} as a preset file`);
  }

  function downloadPresetLibraryFile(presetsToExport: EditableSynthPreset[]) {
    const blob = new Blob(
      [JSON.stringify({
        format: presetLibraryFileFormat,
        presets: presetsToExport.map(exportPreset)
      }, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `hexboard-presets-${presetsToExport.length}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setSyncStatus(`Exported ${presetsToExport.length} presets as one library file`);
  }

  function selectedPresets(space: LibrarySpace): EditableSynthPreset[] {
    const selected = new Set(selectedPresetIds[space]);
    const source = space === "computer" ? computerPresets : hexboardPresets;
    return source.filter((candidate) => selected.has(candidate.objectIdHex));
  }

  function setPresetSelected(space: LibrarySpace, objectIdHex: string, selected: boolean) {
    setSelectedPresetIds((current) => {
      const ids = new Set(current[space]);
      if (selected) ids.add(objectIdHex);
      else ids.delete(objectIdHex);
      return { ...current, [space]: [...ids] };
    });
  }

  function selectVisiblePresets(space: LibrarySpace, objectIds: string[], selected: boolean) {
    setSelectedPresetIds((current) => {
      const ids = new Set(current[space]);
      for (const objectIdHex of objectIds) {
        if (selected) ids.add(objectIdHex);
        else ids.delete(objectIdHex);
      }
      return { ...current, [space]: [...ids] };
    });
  }

  function clearPresetSelection(space: LibrarySpace) {
    setSelectedPresetIds((current) => ({ ...current, [space]: [] }));
  }

  function confirmPresetBatchConflicts(action: string, conflicts: EditableSynthPreset[]): boolean {
    if (conflicts.length === 0) return true;
    const preview = conflicts.slice(0, 6)
      .map((conflict) => `• ${folderLabel(conflict.folderPath)} / ${conflict.name}`)
      .join("\n");
    const remainder = conflicts.length > 6 ? `\n• …and ${conflicts.length - 6} more` : "";
    return window.confirm(
      `${action} will overwrite ${conflicts.length} existing preset${conflicts.length === 1 ? "" : "s"}:\n\n${preview}${remainder}`
      + "\n\nExisting destination presets are permanently deleted only after their replacements save successfully. Continue?"
    );
  }

  async function transferSelectedPresets(space: LibrarySpace) {
    const sources = selectedPresets(space);
    if (sources.length === 0) return;
    if (space === "hexboard") {
      const merged = mergePresetBatch(computerPresets, sources);
      if (!confirmPresetBatchConflicts("Copying these presets to Browser Library", merged.conflicts)) {
        setSyncStatus("Bulk copy canceled");
        return;
      }
      setComputerPresets(merged.presets);
      setCustomFolders((current) => Array.from(new Set([
        ...current,
        ...sources.map((source) => source.folderPath)
      ])).sort(compareFolderPaths));
      clearPresetSelection(space);
      setSyncStatus(`Copied ${sources.length} presets to Browser Library`);
      return;
    }

    const conflicts = Array.from(new Map(sources.flatMap((source) => {
      const conflict = hexboardPresets.find((candidate) =>
        candidate.objectIdHex !== source.objectIdHex && presetSaveKey(candidate) === presetSaveKey(source)
      );
      return conflict ? [[conflict.objectIdHex, conflict] as const] : [];
    })).values());
    if (!confirmPresetBatchConflicts("Copying these presets to HexBoard", conflicts)) {
      setSyncStatus("Bulk copy canceled");
      return;
    }
    // A same-named preset is replaced in place, keeping its object id.
    const planned = sources.map((source) => {
      if (hexboardPresets.some((candidate) => candidate.objectIdHex === source.objectIdHex)) return source;
      const sameName = hexboardPresets.find((candidate) => presetSaveKey(candidate) === presetSaveKey(source));
      return sameName ? { ...source, objectIdHex: sameName.objectIdHex } : source;
    });
    const capacityProblem = hexboardPresetCapacityProblem(hexboardPresets, planned);
    if (capacityProblem) {
      setSyncStatus(`Nothing copied. ${capacityProblem}`);
      return;
    }

    setBulkPresetBusy(true);
    let completed = 0;
    try {
      for (const source of sources) {
        setSyncStatus(`Copying preset ${completed + 1}/${sources.length}: ${source.name}`);
        const saved = await uploadToHexBoard(source, "Copied", {
          confirmOverwrite: false,
          refresh: false,
          updateEditor: false
        });
        if (!saved) break;
        completed += 1;
      }
      if (!(transport instanceof MockMidiTransport)) {
        await refreshHexBoardLibrary(`Copied ${completed}/${sources.length} selected presets to HexBoard`);
      }
      if (completed === sources.length) clearPresetSelection(space);
    } finally {
      setBulkPresetBusy(false);
    }
  }

  function exportSelectedPresets(space: LibrarySpace) {
    const sources = selectedPresets(space);
    if (sources.length > 0) downloadPresetLibraryFile(sources);
  }

  async function downloadWavetableFile(nextWavetable: EditableSynthWavetable) {
    let exportWavetable = nextWavetable;
    try {
      exportWavetable = await loadHexBoardWavetableSamples(nextWavetable);
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : "Failed to read HexBoard wavetable for export");
      return;
    }
    if (!exportWavetable.samples) {
      setSyncStatus(`${exportWavetable.name} does not have sample data loaded for export`);
      return;
    }
    const wavBytes = encodeHexBoardWavetableWav(exportWavetable.samples);
    const wavBuffer = wavBytes.buffer.slice(wavBytes.byteOffset, wavBytes.byteOffset + wavBytes.byteLength) as ArrayBuffer;
    const blob = new Blob([wavBuffer], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeFileName(`${exportWavetable.folderPath}-${exportWavetable.name}`)}.hexwav`;
    link.click();
    URL.revokeObjectURL(url);
    setSyncStatus(`Exported ${exportWavetable.name} as a HexBoard wavetable file`);
  }

  async function importPresetFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    if (files.length === 0) {
      return;
    }

    try {
      const imported = (await Promise.all(files.map(async (file) =>
        presetsFromUnknown(JSON.parse(await file.text()))
      ))).flat();
      const merged = mergePresetBatch(computerPresets, imported);
      if (!confirmPresetBatchConflicts("Importing these files", merged.conflicts)) {
        setSyncStatus("Import canceled");
        return;
      }
      setComputerPresets(merged.presets);
      setCustomFolders((current) => Array.from(new Set([
        ...current,
        ...imported.map((item) => item.folderPath)
      ])).sort(compareFolderPaths));
      skipNextAutoSend.current = true;
      setPreset(clonePreset(imported.at(-1) ?? defaultPreset));
      setOpenedSource("computer");
      setSyncStatus(`Imported ${imported.length} preset${imported.length === 1 ? "" : "s"} into Browser Library`);
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : "Failed to import preset file");
    } finally {
      input.value = "";
    }
  }

  async function importWavetableFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    try {
      const importFormat = file.name.toLowerCase().endsWith(".hexwav") ? "hexboard" : wavetableImportFormat;
      const source: WavetableImportSource = {
        fileName: file.name,
        format: importFormat,
        bytes: new Uint8Array(await file.arrayBuffer())
      };
      setWavetableImportSource(source);
      setWavetablePreviewFrame(0);
      setWavetablePreviewMipLevel(0);
      setSyncStatus(`Previewing ${file.name}`);
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : "Failed to import wavetable");
    } finally {
      input.value = "";
    }
  }

  async function importRenderedWavetablePreview() {
    if (!renderedWavetableImport?.samples) {
      setSyncStatus(renderedWavetableImport?.error ?? "Choose a wavetable file before importing");
      return;
    }
    try {
      await finalizeWavetableImport(renderedWavetableImport.source.fileName, renderedWavetableImport.samples);
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : "Failed to import wavetable");
    }
  }

  async function finalizeWavetableImport(fileName: string, samples: Uint8Array) {
    const sampleCrc = crc32(samples);
    const wavetableName = normalizedWavetableName(wavetableImportName || fileName.replace(/\.[^.]+$/, ""));
    const folderPath = normalizeDisplayFolderPath(wavetableImportFolder || defaultUserWavetableFolder);
    const wavetable: EditableSynthWavetable = {
      objectIdHex: objectIdToHex(deterministicObjectId(`synth-wavetable:${folderPath}:${wavetableName}:${sampleCrc.toString(16)}`)),
      name: wavetableName,
      folderPath,
      samples,
      sampleCrc
    };
    const computerDecision = prepareWavetableForLibrarySave(wavetable, computerWavetables, "Browser Wavetables", false);
    if (!computerDecision) {
      setSyncStatus("Import canceled");
      return;
    }
    setComputerWavetables((current) => upsertWavetable(current, computerDecision.wavetable));
    setCustomWavetableFolders((current) => Array.from(new Set([...current, folderPath])).sort());
    skipNextAutoSend.current = true;
    setEditorHydrated(true);
    setPreset((current) => ({
      ...current,
      wavetableName,
      wavetableFolderPath: folderPath,
      values: {
        ...current.values,
        Waveform: 27,
        SynthWavetablePosition: 0
      }
    }));
    closeWavetableImportDialog();
    await uploadWavetableToHexBoard(computerDecision.wavetable, "Imported");
  }

  function closeWavetableImportDialog() {
    setWavetableImportName("");
    setWavetableImportDialogOpen(false);
    setWavetableImportSource(null);
    setWavetablePreviewFrame(0);
    setWavetablePreviewMipLevel(0);
  }

  async function loadCurrentHexBoardPatch(isCancelled: () => boolean = () => false) {
    if (transport instanceof MockMidiTransport) {
      return false;
    }
    if (transport instanceof WebMidiTransport && !transport.hasInput) {
      setSyncStatus("Connect HexBoard from the top bar before loading the current patch.");
      return false;
    }

    try {
      setSyncStatus("Loading current HexBoard patch...");
      const currentPreset = {
        ...presetFromObjectBody(await client.readCurrentSynthPreset()),
        deviceHandle: undefined
      };
      if (isCancelled() || !sameContent(latestPreset.current, preset)) {
        return false;
      }
      skipNextAutoSend.current = true;
      setDraftBase(clonePreset(currentPreset));
      setPreset(clonePreset(currentPreset));
      setOpenedSource("hexboard");
      setEditorHydrated(true);
      setSyncStatus(`Loaded current HexBoard patch into editor as ${currentPreset.name}`);
      return true;
    } catch (error) {
      if (!isCancelled()) {
        setSyncStatus(error instanceof Error ? error.message : "Failed to load current HexBoard patch");
      }
      return false;
    }
  }

  async function refreshHexBoardLibrary(successStatus = "Refreshed HexBoard Library") {
    if (transport instanceof MockMidiTransport) {
      setSyncStatus("Connect to see your saved sounds");
      return;
    }
    if (transport instanceof WebMidiTransport && !transport.hasInput) {
      setSyncStatus("Connect HexBoard from the top bar before refreshing device presets.");
      return;
    }

    try {
      setSyncStatus("Requesting HexBoard Library...");
      const records = await client.listSynthPresets();
      setSyncStatus(`Found ${records.length} HexBoard preset record${records.length === 1 ? "" : "s"}; reading preset data...`);
      const presets: EditableSynthPreset[] = [];
      const readErrors: string[] = [];
      for (const record of records) {
        try {
          presets.push(presetFromObjectBody(await client.readSynthPreset(record.handle), record.handle));
        } catch (error) {
          presets.push(presetFromObjectListRecord(record));
          readErrors.push(`${record.name || `handle ${record.handle}`}: ${error instanceof Error ? error.message : "read failed"}`);
        }
      }
      setHexboardPresets(presets.sort(comparePresets));
      if (presets.some((item) => item.sampler)) {
        try { await loadHexBoardInstruments(); } catch { setHexboardInstruments(null); }
      }
      if (readErrors.length > 0) {
        setSyncStatus(`${successStatus}: listed ${presets.length} preset${presets.length === 1 ? "" : "s"}, but ${readErrors.length} full read${readErrors.length === 1 ? "" : "s"} failed. ${readErrors[0]}`);
      } else {
        setSyncStatus(`${successStatus}: ${presets.length} preset${presets.length === 1 ? "" : "s"}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to refresh HexBoard Library";
      setSyncStatus(
        message.includes("Timed out")
          ? `${message}. Use Connect HexBoard in the top bar so the browser can receive HexBoard SysEx replies.`
          : message
      );
    }
  }

  async function refreshHexBoardWavetables(successStatus = "Refreshed HexBoard Wavetables") {
    if (transport instanceof MockMidiTransport) {
      setSyncStatus("Connect to see your wavetables");
      return;
    }
    if (transport instanceof WebMidiTransport && !transport.hasInput) {
      setSyncStatus("Connect HexBoard from the top bar before refreshing device wavetables.");
      return;
    }

    try {
      setSyncStatus("Requesting HexBoard Wavetables...");
      const records = await client.listSynthWavetables();
      const wavetables = records.map(wavetableFromObjectListRecord);
      setHexboardWavetables(wavetables.sort(compareWavetables));
      setSyncStatus(`${successStatus}: ${wavetables.length} wavetable${wavetables.length === 1 ? "" : "s"} listed; sample data will transfer only on Copy to Browser or Export`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to refresh HexBoard Wavetables";
      setSyncStatus(
        message.includes("Timed out")
          ? `${message}. Use Connect HexBoard in the top bar so the browser can receive HexBoard SysEx replies.`
          : message
      );
    }
  }

  function startDrag(space: LibrarySpace, objectIdHex: string, event: DragEvent<HTMLLIElement>) {
    setDraggedPreset({ space, objectIdHex });
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData("text/plain", `${space}:${objectIdHex}`);
  }

  function allowDrop(event: DragEvent<HTMLElement>) {
    if (!draggedPreset) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = draggedPreset.space === "hexboard" ? "copy" : "move";
  }

  function dropPreset(targetSpace: LibrarySpace, folderPath?: string) {
    if (!draggedPreset) {
      return;
    }

    const sourcePreset = findPreset(draggedPreset);
    setDraggedPreset(null);
    if (!sourcePreset) {
      return;
    }

    const nextPreset = {
      ...clonePreset(sourcePreset),
      folderPath: folderPath ?? sourcePreset.folderPath
    };

    if (targetSpace === draggedPreset.space) {
      if (normalizeDisplayFolderPath(nextPreset.folderPath) === normalizeDisplayFolderPath(sourcePreset.folderPath)) {
        return;
      }
      setPresetOrganizationRequest({
        space: targetSpace,
        preset: clonePreset(sourcePreset),
        initialFolderPath: nextPreset.folderPath
      });
      return;
    }

    if (targetSpace === "computer") {
      saveToComputer(nextPreset, "Copied");
      return;
    }

    void uploadToHexBoard(nextPreset, "Copied");
  }

  return (
    <section className="workspace synthEditor">
      <aside className="panel stack wavetable-identity synthLibraryPanel">
        <h2>Synth Library</h2>
        <nav className="sectionTabs" aria-label="Synth library sections">
          <button aria-current={libraryKind === "presets" ? "page" : undefined} type="button" onClick={() => setLibraryKind("presets")}>Presets</button>
          <button aria-current={libraryKind === "wavetables" ? "page" : undefined} type="button" onClick={() => setLibraryKind("wavetables")}>Wavetables</button>
        </nav>
        <input ref={fileInputRef} className="hiddenFileInput" type="file" accept="application/json,.json" multiple onChange={(event) => void importPresetFile(event)} />
        <input ref={wavetableFileInputRef} className="hiddenFileInput" type="file" accept="audio/wav,audio/wave,.wav,.hexwav" onChange={(event) => void importWavetableFile(event)} />

        {presetOrganizationRequest ? (
          <OrganizeLibraryItemDialog
            itemLabel="preset"
            libraryLabel={presetOrganizationRequest.space === "computer" ? "Browser Library" : "HexBoard Library"}
            name={presetOrganizationRequest.preset.name}
            folderPath={presetOrganizationRequest.preset.folderPath}
            initialFolderPath={presetOrganizationRequest.initialFolderPath}
            folders={presetOrganizationRequest.space === "computer" ? computerPresetFolders : hexboardPresetFolders}
            maxNameLength={HEXBOARD_PRESET_NAME_MAX_BYTES}
            maxFolderLength={deviceFolderMaxBytes}
            normalizeName={normalizedPresetName}
            normalizeFolderPath={normalizeDisplayFolderPath}
            folderLabel={folderLabel}
            findConflict={(name, folderPath) => organizationConflictSummary(
              presetOrganizationRequest.space,
              presetOrganizationRequest.preset,
              name,
              folderPath
            )}
            onCancel={() => setPresetOrganizationRequest(null)}
            onSave={(name, folderPath) => organizePresetInPlace(presetOrganizationRequest, name, folderPath)}
          />
        ) : null}

        {wavetableResolutionRequest ? (
          <div className="modalOverlay" role="presentation" onMouseDown={() => closeWavetableResolution(null)}>
            <div
              className="modalPanel stack"
              role="dialog"
              aria-modal="true"
              aria-labelledby="wavetableResolutionTitle"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <h3 id="wavetableResolutionTitle">Missing Wavetable</h3>
              <p>
                “{wavetableResolutionRequest.presetName}” requires “{wavetableResolutionRequest.requiredName}”,
                which is not currently on this HexBoard.
              </p>
              <button
                className="primary"
                disabled={!wavetableResolutionRequest.matchingComputerWavetable?.samples}
                type="button"
                onClick={() => closeWavetableResolution({ kind: "upload" })}
              >
                Copy “{wavetableResolutionRequest.requiredName}” to HexBoard
              </button>
              {!wavetableResolutionRequest.matchingComputerWavetable?.samples ? (
                <span className="muted">No matching wavetable with loaded sample data is available in Browser Wavetables.</span>
              ) : null}
              <label className="field">
                <span>Use an alternate wavetable</span>
                <select
                  value={wavetableResolutionAlternate}
                  onChange={(event) => setWavetableResolutionAlternate(event.target.value)}
                >
                  {[...builtInWavetables, ...hexboardWavetables].map((wavetable) => (
                    <option key={`${wavetable.folderPath}-${wavetable.name}`} value={wavetable.name}>
                      {wavetable.name} — {folderLabel(wavetable.folderPath)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="row">
                <button
                  type="button"
                  onClick={() => {
                    const alternate = [...builtInWavetables, ...hexboardWavetables]
                      .find((wavetable) => wavetable.name === wavetableResolutionAlternate);
                    if (alternate) {
                      closeWavetableResolution({ kind: "alternate", wavetable: alternate });
                    }
                  }}
                >
                  Use Alternate
                </button>
                <button type="button" onClick={() => closeWavetableResolution(null)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {newSamplerSound ? (
          <form className="row synthFolderCreation" aria-label="New sampler sound" onSubmit={(event) => { event.preventDefault(); createSamplerSound(newSamplerSound.choice); }}>
            <label className="field">
              <span>Instrument on HexBoard</span>
              <select autoFocus value={newSamplerSound.choice} onChange={(event) => setNewSamplerSound({ ...newSamplerSound, choice: event.target.value })}>
                {newSamplerSound.instruments.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
            <button className="primary" type="submit">Make sound</button>
            <button type="button" onClick={() => setNewSamplerSound(null)}>Cancel</button>
            <span className="muted">The sound keeps this instrument. Send new instruments from the Instruments tab.</span>
          </form>
        ) : null}

        {libraryKind === "presets" ? (
          <>
            <div className="row libraryPrimaryActions">
              <button className="primary" type="button" onClick={newPreset}>New sound</button>
              <button disabled={!connected} type="button" title="A sound that plays an instrument on the HexBoard" onClick={() => void openNewSamplerSound()}>New sampler sound</button>
              <button disabled={!connected} type="button" onClick={() => void refreshHexBoardLibrary()}>
                Refresh HexBoard
              </button>
              <button type="button" onClick={() => fileInputRef.current?.click()}>
                Import Preset Files
              </button>
            </div>

            <FolderControls
              folderLabel={folderLabel}
              folders={customFolders.filter((folder) => folder !== rootFolderPath)}
              itemCount={(folder) => computerPresets.filter((candidate) => candidate.folderPath === folder).length}
              itemLabel="preset"
              newFolder={newFolder}
              onCreate={addFolder}
              onDelete={deletePresetFolder}
              onNewFolderChange={setNewFolder}
            />

            <div className="librarySpaces">
              <LibrarySpacePanel
                connected={connected}
                draftIds={Object.entries(drafts.entries).filter(([,entry]) => !sameContent(entry.value, entry.base)).map(([key]) => key)}
                title="Browser Library"
                subtitle="Saved in this browser"
                space="computer"
                presets={computerPresets}
                folders={computerPresetFolders}
                selectedFolder={folderFilters.computer}
                selectedIds={selectedPresetIds.computer}
                bulkBusy={bulkPresetBusy}
                draggedPreset={draggedPreset}
                onAllowDrop={allowDrop}
                onDrop={dropPreset}
                onFolderSelect={selectFolderFilter}
                onDragStart={startDrag}
                onDragEnd={() => setDraggedPreset(null)}
                onOpen={openPreset}
                onOrganize={(space, item) => setPresetOrganizationRequest({ space, preset: clonePreset(item) })}
                onSelectionChange={setPresetSelected}
                onSelectVisible={selectVisiblePresets}
                onClearSelection={clearPresetSelection}
                onBulkTransfer={(space) => void transferSelectedPresets(space)}
                onBulkExport={exportSelectedPresets}
                onUpload={(item) => void uploadToHexBoard(item)}
                onDownload={downloadFromHexBoard}
                onExport={downloadPresetFile}
                onErase={erasePreset}
                onFavorite={togglePresetFavorite}
                activeId={openedSource === "computer" ? preset.objectIdHex : undefined}
              />
              <LibrarySpacePanel
                connected={connected}
                draftIds={Object.entries(drafts.entries).filter(([,entry]) => !sameContent(entry.value, entry.base)).map(([key]) => key)}
                title="HexBoard Library"
                subtitle="Saved on your instrument"
                space="hexboard"
                presets={hexboardPresets}
                folders={hexboardPresetFolders}
                selectedFolder={folderFilters.hexboard}
                selectedIds={selectedPresetIds.hexboard}
                bulkBusy={bulkPresetBusy}
                draggedPreset={draggedPreset}
                onAllowDrop={allowDrop}
                onDrop={dropPreset}
                onFolderSelect={selectFolderFilter}
                onDragStart={startDrag}
                onDragEnd={() => setDraggedPreset(null)}
                onOpen={openPreset}
                onOrganize={(space, item) => setPresetOrganizationRequest({ space, preset: clonePreset(item) })}
                onSelectionChange={setPresetSelected}
                onSelectVisible={selectVisiblePresets}
                onClearSelection={clearPresetSelection}
                onBulkTransfer={(space) => void transferSelectedPresets(space)}
                onBulkExport={exportSelectedPresets}
                onUpload={(item) => void uploadToHexBoard(item)}
                onDownload={downloadFromHexBoard}
                onExport={downloadPresetFile}
                onErase={erasePreset}
                onFavorite={togglePresetFavorite}
                activeId={openedSource === "hexboard" ? preset.objectIdHex : undefined}
              />
            </div>
          </>
        ) : (
          <>
            <div className="row libraryPrimaryActions">
              <button disabled={!connected} type="button" onClick={() => void refreshHexBoardWavetables()}>
                Refresh HexBoard
              </button>
              <button type="button" onClick={() => setWavetableImportDialogOpen(true)}>
                Import Wavetable
              </button>
            </div>

            <FolderControls
              folderLabel={folderLabel}
              folders={customWavetableFolders.filter((folder) => folder !== rootFolderPath && folder !== builtInWavetableFolder)}
              itemCount={(folder) => computerWavetables.filter((candidate) => candidate.folderPath === folder).length}
              itemLabel="wavetable"
              newFolder={newWavetableFolder}
              onCreate={addWavetableFolder}
              onDelete={deleteWavetableFolder}
              onNewFolderChange={setNewWavetableFolder}
            />


            <div className="librarySpaces">
              <WavetableLibraryPanel
                connected={connected}
                title="Browser Wavetables"
                subtitle="Saved in this browser"
                space="computer"
                wavetables={computerWavetables}
                folders={computerWavetableFolders}
                selectedFolder={wavetableFolderFilters.computer}
                onFolderSelect={selectWavetableFolderFilter}
                onUse={useWavetableAsPresetSource}
                onUpload={(item) => void uploadWavetableToHexBoard(item)}
                onDownload={(item) => void downloadWavetableFromHexBoard(item)}
                onExport={(item) => void downloadWavetableFile(item)}
                onEdit={(item) => void editWavetable("computer", item)}
                onErase={eraseWavetable}
              />
              <WavetableLibraryPanel
                connected={connected}
                title="HexBoard Wavetables"
                subtitle="Device wavetables loaded through SysEx"
                space="hexboard"
                wavetables={hexboardWavetables}
                folders={hexboardWavetableFolders}
                selectedFolder={wavetableFolderFilters.hexboard}
                onFolderSelect={selectWavetableFolderFilter}
                onUse={useWavetableAsPresetSource}
                onUpload={(item) => void uploadWavetableToHexBoard(item)}
                onDownload={(item) => void downloadWavetableFromHexBoard(item)}
                onExport={(item) => void downloadWavetableFile(item)}
                onEdit={(item) => void editWavetable("hexboard", item)}
                onErase={eraseWavetable}
              />
            </div>
          </>
        )}
      </aside>

      {wavetableImportDialogOpen ? (
        <div className="modalOverlay" role="presentation" onMouseDown={closeWavetableImportDialog}>
          <div className="modalPanel stack" role="dialog" aria-modal="true" aria-labelledby="wavetableImportTitle" onMouseDown={(event) => event.stopPropagation()}>
            <div className="row between">
              <h3 id="wavetableImportTitle">Import Wavetable</h3>
              <button type="button" onClick={closeWavetableImportDialog}>
                Close
              </button>
            </div>
            <div className="stack">
              <button className="primary" type="button" onClick={() => wavetableFileInputRef.current?.click()}>
                Choose File
              </button>
              <span className="muted">Files ending in .hexwav are parsed as HexBoard wavetables automatically.</span>
            </div>
            <div className="fieldGrid compact oneColumn">
              <label className="field">
                <span>File Type</span>
                <select
                  value={wavetableImportFormat}
                  onChange={(event) => {
                    setWavetableImportFormat(event.target.value as WavetableImportFormat);
                    setWavetableImportSource(null);
                    setWavetablePreviewFrame(0);
                    setWavetablePreviewMipLevel(0);
                  }}
                >
                  <option value="serum-vital">Serum/Vital wavetable</option>
                  <option value="hexboard">HexBoard wavetable</option>
                </select>
              </label>
              <label className="field">
                <span>WT Name</span>
                <input
                  placeholder="Use file name"
                  value={wavetableImportName}
                  onChange={(event) => setWavetableImportName(event.target.value)}
                />
              </label>
              <label className="field">
                <span>WT Folder</span>
                <select value={wavetableImportFolder} onChange={(event) => setWavetableImportFolder(event.target.value)}>
                  {allWavetableFolders
                    .filter((folder) => folder !== builtInWavetableFolder)
                    .map((folder) => (
                      <option key={folder} value={folder}>
                        {folderLabel(folder)}
                      </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Frame mapping</span>
                <select
                  disabled={wavetableImportControlsDisabled}
                  value={wavetableFrameReduction}
                  onChange={(event) => setWavetableFrameReduction(event.target.value as WavetableFrameReduction)}
                >
                  <option value="nearest">Nearest source frame</option>
                  <option value="interpolated">Interpolate source frames</option>
                </select>
              </label>
              <label className="field">
                <span>Normalization</span>
                <select
                  disabled={wavetableImportControlsDisabled}
                  value={wavetableNormalization}
                  onChange={(event) => setWavetableNormalization(event.target.value as WavetableNormalization)}
                >
                  <option value="per-frame">Per-frame</option>
                  <option value="whole-table">Whole-table</option>
                </select>
              </label>
              <div className="row">
                <label className="checkField">
                  <input
                    checked={wavetableSmooth}
                    disabled={wavetableImportControlsDisabled}
                    type="checkbox"
                    onChange={(event) => setWavetableSmooth(event.target.checked)}
                  />
                  <span>Smooth</span>
                </label>
                <label className="checkField">
                  <input
                    checked={wavetableDither}
                    disabled={wavetableImportControlsDisabled}
                    type="checkbox"
                    onChange={(event) => setWavetableDither(event.target.checked)}
                  />
                  <span>Dither</span>
                </label>
              </div>
            </div>
            <div className="wavetablePreviewPanel stack">
              {renderedWavetableImport ? (
                renderedWavetableImport.error ? (
                  <div className="status warn">{renderedWavetableImport.error}</div>
                ) : (
                  <>
                    <div className="row between">
                      <span className="muted">{renderedWavetableImport.source.fileName}</span>
                      <span className="muted">CRC {(renderedWavetableImport.sampleCrc ?? 0).toString(16).toUpperCase().padStart(8, "0")}</span>
                    </div>
                    <svg className="wavetablePreviewGraph" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`Wavetable frame ${wavetablePreviewFrame + 1}`}>
                      <line x1="0" x2="100" y1="50" y2="50" />
                      <path d={wavetablePreviewPath} />
                    </svg>
                    <label className="field rangeField">
                      <span>Frame {wavetablePreviewFrame + 1} / {SYNTH_WAVETABLE_FRAME_COUNT}</span>
                      <input
                        max={SYNTH_WAVETABLE_FRAME_COUNT - 1}
                        min={0}
                        type="range"
                        value={wavetablePreviewFrame}
                        onChange={(event) => setWavetablePreviewFrame(Number(event.target.value))}
                      />
                    </label>
                    <label className="field rangeField">
                      <span>Mip {Math.min(wavetablePreviewMipLevel, renderedWavetableMipLevelCount - 1) + 1} / {renderedWavetableMipLevelCount} ({renderedWavetableMipSampleCount} samples, {renderedWavetableMipHarmonicLimit} harmonics)</span>
                      <input
                        disabled={renderedWavetableMipLevelCount <= 1}
                        max={Math.max(0, renderedWavetableMipLevelCount - 1)}
                        min={0}
                        type="range"
                        value={Math.min(wavetablePreviewMipLevel, renderedWavetableMipLevelCount - 1)}
                        onChange={(event) => setWavetablePreviewMipLevel(Number(event.target.value))}
                      />
                    </label>
                  </>
                )
              ) : (
                <div className="status">No wavetable file selected</div>
              )}
            </div>
            <button className="primary" disabled={!renderedWavetableImport?.samples} type="button" onClick={() => void importRenderedWavetablePreview()}>
              Import
            </button>
          </div>
        </div>
      ) : null}

      <div className="card physical-editor wavetable-editor stack synthMainPanel">
        <header className="editorSummary">
        <div className="row between editorActionBar synthSaveBar">
          <div className="synthIdentityFields">
            <label className="field">
              <span>Name</span>
              <input value={preset.name} maxLength={HEXBOARD_PRESET_NAME_MAX_BYTES} onChange={(event) => updatePresetName(event.target.value)} />
            </label>
            <label className="field">
              <span>Folder</span>
              <select ref={presetFolderSelectRef} value={`folder:${preset.folderPath}`} onChange={(event) => selectPresetFolder(event.target.value)}>
                {allFolders.map((folder) => <option key={folder} value={`folder:${folder}`}>{folderLabel(folder)}</option>)}
                <option value="new">New folder…</option>
              </select>
            </label>
            <label className="checkField synthFavoriteField">
              <input type="checkbox" checked={preset.favorite} onChange={(event) => updatePresetMetadata((current) => ({ ...current, favorite: event.target.checked }))} />
              <span>Favorite</span>
            </label>
          </div>
          <div className="row">
            {connected ? <>
            <label className="checkField">
              <input disabled={!connected} checked={autoSend} type="checkbox" onChange={(event) => { setAutoSend(event.target.checked); if (event.target.checked) void sendPreview(); }} />
              <span>Live preview</span>
            </label>
            <button disabled={!connected} type="button" onClick={() => void sendPreview("Sent")}>
              Preview on HexBoard
            </button>
            </> : null}
            <button disabled={browserSaved} type="button" onClick={() => saveToComputer()}>
              Save to Browser
            </button>
            <button className="primary" disabled={!connected} type="button" onClick={() => void uploadToHexBoard(preset, "Saved")}>
              Save to HexBoard
            </button>
            <details className="presetOverflowMenu"><summary aria-label="Sound actions">•••</summary><div className="presetOverflowActions">
              <button type="button" onClick={() => downloadPresetFile(preset)}>Export file</button>
              <button disabled={!connected} type="button" onClick={() => void loadCurrentHexBoardPatch()}>Load current HexBoard sound</button>
              <button disabled={!hasDraft} type="button" onClick={discardPresetDraft}>Discard draft</button>
            </div></details>
          </div>
        </div>

        {creatingPresetFolder ? (
          <form className="row synthFolderCreation" onSubmit={(event) => {
            event.preventDefault();
            const folder = createPresetFolder(presetFolderName);
            if (folder === null) return;
            updatePresetMetadata((current) => ({ ...current, folderPath: folder }));
            setCreatingPresetFolder(false);
            presetFolderSelectRef.current?.focus();
          }}>
            <label className="field">
              <span>New folder name</span>
              <input autoFocus value={presetFolderName} placeholder="e.g. Pads/Warm" onChange={(event) => setPresetFolderName(event.target.value)} onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setCreatingPresetFolder(false);
                  presetFolderSelectRef.current?.focus();
                }
              }} />
            </label>
            <button type="submit">Create folder</button>
            <button type="button" onClick={() => { setCreatingPresetFolder(false); presetFolderSelectRef.current?.focus(); }}>Cancel</button>
          </form>
        ) : null}

        <div className="saveStatus" role="status">
          <div className="browserSaveStatus">
            <span>{drafts.error || libraryStorageError || (browserSaved ? "Saved in browser" : "Draft kept in browser")}</span>
            {Object.entries(drafts.entries).some(([key, entry]) => key !== draftKey && !sameContent(entry.value, entry.base)) ? (
              <details className="compactDisclosure otherDraftsDisclosure">
                <summary>Other drafts</summary>
                <div className="row">
                  {Object.entries(drafts.entries).filter(([key, entry]) => key !== draftKey && !sameContent(entry.value, entry.base)).map(([key, entry]) => (
                    <button type="button" key={key} onClick={() => openPreset(key.startsWith("hexboard:") ? "hexboard" : "computer", entry.value)}>{entry.value.name}</button>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
          <span>{connected ? deviceSaved ? "Saved on HexBoard" : "Changes not saved to HexBoard" : "Offline"}</span>
        </div>
        {syncStatus !== "Ready" ? <div className="operationStatus" role="status">{syncStatus}</div> : null}
        </header>
        <div className="editorBody">
        {preset.sampler ? <>
        <header className="instrument-title"><h2>Sampler</h2><span>HexBoard Classic · installed instrument</span></header>
        <ClassicSamplerSoundEditor
          values={preset.values}
          onChange={updateValue}
          instrumentName={preset.sampler.name}
          instrumentStatus={samplerInstrumentStatus}
          envelopeOverride={preset.sampler.envelopeOverride}
          onEnvelopeOverrideChange={(mask) => updatePresetMetadata((current) => current.sampler
            ? { ...current, sampler: { ...current.sampler, envelopeOverride: mask & SAMPLER_ENVELOPE_OVERRIDE_ALL } } : current)}
          modWheel={previewMod}
        />
        </> : <>
        <header className="instrument-title"><h2>Wavetable</h2><span>HexBoard Classic · 16-frame wavetables</span></header>

        <section className={auditionOpen ? "auditionPanel" : "auditionPanel collapsed"}>
          <SynthMidiPreview transport={transport} connected={connected} controller={previewController}
            resetToken={previewResetToken} onStatus={setPreviewStatus} onMod={setPreviewMod}
            expanded={auditionOpen} onToggle={() => setAuditionExpanded(!auditionOpen)}
            onStop={() => stopAllPreviewNotes()}>
          {auditionOpen ? (
            <>
              <h4>Test keyboard</h4>
              <p className="muted" role="status">{previewStatus}</p>
              <p className="muted">Browser sound preview · use a MIDI controller, the keys below, or your typing keyboard. Typing and onscreen notes use 12 EDO.</p>
              <div className="auditionKeyRows">
                {auditionKeyRows.map((row, rowIndex) => (
                  <div className="auditionKeys" key={`audition-row-${rowIndex}`}>
                    {row.map((mapping) => {
                      const note = auditionNoteFromKey(mapping.key, previewOctave) ?? 60;
                      return (
                        <button
                          className={`auditionKey ${[1, 3, 6, 8, 10].includes(mapping.offset) ? "blackKey" : "whiteKey"}${heldPreviewNotes.includes(note) ? " active" : ""}`}
                          style={{ gridColumn: `${[1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 15][mapping.offset]} / span 2` }}
                          key={mapping.key}
                          type="button"
                          onPointerDown={(event) => {
                            event.preventDefault();
                            event.currentTarget.setPointerCapture(event.pointerId);
                            void startPreviewNote(note);
                          }}
                          onPointerUp={(event) => {
                            event.preventDefault();
                            stopPreviewNote(note);
                          }}
                          onPointerCancel={() => stopPreviewNote(note)}
                          onLostPointerCapture={() => stopPreviewNote(note)}
                          aria-label={`Play ${midiNoteLabel(note)}`}
                        >
                          <strong>{mapping.key}</strong>
                          <span>{midiNoteLabel(note)}</span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
              <div className="editorGrid compact">
                <label className="field">
                  <span>Octave</span>
                  <select value={previewOctave} onChange={(event) => changePreviewOctave(Number(event.target.value))}>
                    {[1, 2, 3, 4, 5, 6, 7].map((octave) => (
                      <option key={octave} value={octave}>
                        {octave}
                      </option>
                    ))}
                  </select>
                </label>
                <ClassicKnob label="Preview Vol" value={Math.round(previewVolume * 100)} min={0} max={100} format={(value) => `${value}%`} onChange={(value) => setPreviewVolume(value / 100)} />
                <ClassicKnob label="Mod" value={previewMod} min={0} max={127} format={(value) => `${Math.round(value / 127 * 100)}%`} onChange={setPreviewMod} />
                <div className="row auditionActions">
                  <button type="button" onClick={() => void playPreviewChord()}>
                    Chord
                  </button>
                </div>
              </div>
            </>
          ) : null}
          </SynthMidiPreview>
        </section>

        <ClassicSoundEditor
          values={preset.values}
          onChange={updateValue}
          wavetableName={preset.wavetableName}
          samples={previewPatch.wavetableSamples}
          modWheel={previewMod}
          subscribeVoiceShape={subscribeVoiceShape}
          missingSamples={!previewPatch.wavetableSamples && requiredHexBoardWavetable ? (
            <button type="button" disabled={copyingPreviewWavetable} onClick={() => void copyPreviewWavetableFromHexBoard()}>
              {copyingPreviewWavetable ? "Copying…" : "Copy wavetable from HexBoard"}
            </button>
          ) : undefined}
          wavetablePicker={(
              <label className="field">
                <span>Wavetable</span>
                <select
                  value={wavetableOptionValue(preset.wavetableFolderPath, preset.wavetableName)}
                  onChange={(event) => void selectPresetWavetable(event.target.value)}
                >
                  <option value="import-wavetable">Import Wavetable...</option>
                  <optgroup label={connected ? "On HexBoard" : "Built-in"}>
                    {wavetableOptions.device.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </optgroup>
                  {wavetableOptions.computer.length > 0 ? (
                    <optgroup label="Browser wavetables">
                      {wavetableOptions.computer.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  {wavetableOptions.unavailable.length > 0 ? (
                    <optgroup label="Unavailable">
                      {wavetableOptions.unavailable.map((option) => (
                        <option disabled key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
              </label>
          )}
        />
        </>}

        <details className="compactDisclosure"><summary>Developer details</summary><pre className="dataPreview">
{`Frames on last send: ${lastFrameCount}
Preset body: ${formatByteLength(draftPreset.body)}
CRC: ${crc32(draftPreset.body).toString(16).toUpperCase()}

${formatHex(draftPreset.body)}`}
        </pre></details>
        </div>
      </div>
    </section>
  );
}

/** The board's preset-row icons: a sine cycle for wavetable sounds, an audio clip for sampler sounds. */
function EngineIcon({ sampler }: { sampler: boolean }) {
  const label = sampler ? "Sampler sound" : "Wavetable sound";
  return <svg className="engineIcon" viewBox="0 0 14 14" role="img" aria-label={label}>
    <title>{label}</title>
    {sampler
      ? <path d="M1 7h12M3.5 5v4M5.5 3v8M8 1.5v11M10.5 4v6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      : <path d="M1 7C2.5 2 5.5 2 7 7S11.5 12 13 7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>}
  </svg>;
}

interface LibrarySpacePanelProps {
  connected: boolean;
  draftIds: string[];
  title: string;
  subtitle: string;
  space: LibrarySpace;
  presets: EditableSynthPreset[];
  folders: string[];
  selectedFolder: string | null;
  selectedIds: string[];
  bulkBusy: boolean;
  draggedPreset: DraggedPreset | null;
  onAllowDrop: (event: DragEvent<HTMLElement>) => void;
  onDrop: (space: LibrarySpace, folderPath?: string) => void;
  onFolderSelect: (space: LibrarySpace, folderPath: string | null) => void;
  onDragStart: (space: LibrarySpace, objectIdHex: string, event: DragEvent<HTMLLIElement>) => void;
  onDragEnd: () => void;
  onOpen: (space: LibrarySpace, preset: EditableSynthPreset) => void;
  onOrganize: (space: LibrarySpace, preset: EditableSynthPreset) => void;
  onSelectionChange: (space: LibrarySpace, objectIdHex: string, selected: boolean) => void;
  onSelectVisible: (space: LibrarySpace, objectIds: string[], selected: boolean) => void;
  onClearSelection: (space: LibrarySpace) => void;
  onBulkTransfer: (space: LibrarySpace) => void;
  onBulkExport: (space: LibrarySpace) => void;
  onUpload: (preset: EditableSynthPreset) => void;
  onDownload: (preset: EditableSynthPreset) => void;
  onExport: (preset: EditableSynthPreset) => void;
  onErase: (space: LibrarySpace, preset: EditableSynthPreset) => void;
  onFavorite: (space: LibrarySpace, preset: EditableSynthPreset) => void;
  /** The sound open in the editor, when it came from this library. */
  activeId?: string;
}

function LibrarySpacePanel({
  connected,
  draftIds,
  title,
  subtitle,
  space,
  presets,
  folders,
  selectedFolder,
  selectedIds,
  bulkBusy,
  draggedPreset,
  onAllowDrop,
  onDrop,
  onFolderSelect,
  onDragStart,
  onDragEnd,
  onOpen,
  onOrganize,
  onSelectionChange,
  onSelectVisible,
  onClearSelection,
  onBulkTransfer,
  onBulkExport,
  onUpload,
  onDownload,
  onExport,
  onErase,
  onFavorite,
  activeId
}: LibrarySpacePanelProps) {
  const [expanded, setExpanded] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const isDropTarget = draggedPreset !== null;
  const visiblePresets = filterLibraryPresets(presets, selectedFolder, searchQuery);
  const presetIdSet = new Set(presets.map((preset) => preset.objectIdHex));
  const validSelectedIds = selectedIds.filter((objectIdHex) => presetIdSet.has(objectIdHex));
  const selectedIdSet = new Set(validSelectedIds);
  const visibleIds = visiblePresets.map((preset) => preset.objectIdHex);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((objectIdHex) => selectedIdSet.has(objectIdHex));
  const contentId = `preset-library-${space}-content`;

  if (space === "hexboard" && !connected) return <section className="librarySpace"><h3>{title}</h3><p className="emptyListItem">Connect to see your saved sounds</p></section>;

  return (
    <section
      className={isDropTarget ? "librarySpace dropReady" : "librarySpace"}
      onDragOver={onAllowDrop}
      onDrop={(event) => {
        event.preventDefault();
        onDrop(space);
      }}
    >
      <div className="librarySpaceHeader">
        <div>
          <h3>{title}</h3>
          <span className="muted">{subtitle}</span>
        </div>
        <div className="librarySpaceHeaderActions">
          <span className="countBadge">{visiblePresets.length}</span>
          <button
            aria-controls={contentId}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${title}`}
            className="iconButton librarySpaceToggle"
            title={`${expanded ? "Collapse" : "Expand"} ${title}`}
            type="button"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? "−" : "+"}
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="librarySpaceContent" id={contentId}>
          <label className="presetLibrarySearch">
            <input
              aria-label={`Search ${title}`}
              type="search"
              value={searchQuery}
              placeholder="Search presets"
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </label>

          <div className="presetLibraryBrowser">
            <nav className="folderTargets presetFolderSidebar" aria-label={`${title} folders`}>
              <button
                className={selectedFolder === null ? "folderTarget systemFolderTarget active" : "folderTarget systemFolderTarget"}
                type="button"
                aria-pressed={selectedFolder === null}
                onClick={() => onFolderSelect(space, null)}
              >
                <span>All presets</span>
                <span>{presets.length}</span>
              </button>
              {presets.some((preset) => preset.favorite) ? (
                <button
                  className={selectedFolder === favoritesFilter ? "folderTarget systemFolderTarget active" : "folderTarget systemFolderTarget"}
                  type="button"
                  aria-pressed={selectedFolder === favoritesFilter}
                  onClick={() => onFolderSelect(space, favoritesFilter)}
                >
                  <span>★ Favorites</span>
                  <span>{presets.filter((preset) => preset.favorite).length}</span>
                </button>
              ) : null}
              {folders.map((folder) => (
                <button
                  className={`folderTarget${folder === rootFolderPath ? " systemFolderTarget" : ""}${folder === selectedFolder ? " active" : ""}`}
                  key={`${space}-${folder}`}
                  type="button"
                  aria-pressed={folder === selectedFolder}
                  onClick={() => onFolderSelect(space, folder)}
                  onDragOver={onAllowDrop}
                  onDrop={(event) => {
                    event.preventDefault();
                    onDrop(space, folder);
                  }}
                >
                  <span>{folderLabel(folder)}</span>
                  <span>{presets.filter((preset) => preset.folderPath === folder).length}</span>
                </button>
              ))}
            </nav>

            <div className="presetLibraryResults">
              <div className="presetLibraryListToolbar">
                <label className="checkField" title="Select every preset in these results">
                  <input
                    aria-label="Select all shown presets"
                    checked={allVisibleSelected}
                    disabled={bulkBusy || visibleIds.length === 0}
                    type="checkbox"
                    onChange={(event) => onSelectVisible(space, visibleIds, event.target.checked)}
                  />
                  <span>Select shown</span>
                </label>
                <span className="muted">{visiblePresets.length} shown</span>
              </div>

              {validSelectedIds.length > 0 ? (
                <LibraryBulkActions
                  selectedCount={validSelectedIds.length}
                  visibleCount={visibleIds.length}
                  allVisibleSelected={allVisibleSelected}
                  transferLabel={space === "computer" ? "Copy to HexBoard" : "Copy to Browser"}
                  transferDisabled={space === "computer" && !connected}
                  busy={bulkBusy}
                  showSelectVisible={false}
                  onSelectVisible={(selected) => onSelectVisible(space, visibleIds, selected)}
                  onClear={() => onClearSelection(space)}
                  onTransfer={() => onBulkTransfer(space)}
                  onExport={() => onBulkExport(space)}
                />
              ) : null}

              <ul className="list presetCompactList">
                {visiblePresets.length === 0 ? (
                  <li className="emptyListItem">
                    {searchQuery.trim()
                      ? `No presets match “${searchQuery.trim()}”`
                      : selectedFolder === favoritesFilter ? "No favorites yet · star a sound to add it" : selectedFolder ? `No presets in ${folderLabel(selectedFolder)}` : space === "hexboard" && !connected ? "Connect to see your saved sounds" : "No presets"}
                  </li>
                ) : (
                  visiblePresets.map((item) => (
                    <li
                      className={`listItem presetListItem compactPresetRow${item.objectIdHex === activeId ? " activeListItem" : ""}`}
                      aria-current={item.objectIdHex === activeId ? "true" : undefined}
                      draggable
                      key={`${space}-${item.objectIdHex}`}
                      onDoubleClick={() => onOpen(space, item)}
                      onDragStart={(event) => onDragStart(space, item.objectIdHex, event)}
                      onDragEnd={onDragEnd}
                    >
                      <label className="libraryItemSelection" title={`Select ${item.name}`}>
                        <input
                          aria-label={`Select ${item.name}`}
                          checked={selectedIdSet.has(item.objectIdHex)}
                          type="checkbox"
                          onChange={(event) => onSelectionChange(space, item.objectIdHex, event.target.checked)}
                        />
                      </label>
                      <EngineIcon sampler={item.sampler !== undefined}/>
                      <button className="presetNameButton" type="button" title={`Open ${item.name}`} onClick={() => onOpen(space, item)}>
                        <strong>{item.name}</strong>
                        <span>{folderLabel(item.folderPath)}{draftIds.includes(`${space}:${item.objectIdHex}`) ? " · Draft" : ""}</span>
                      </button>
                      <button
                        className="iconButton presetFavorite"
                        type="button"
                        aria-pressed={item.favorite}
                        aria-label={`${item.favorite ? "Unfavorite" : "Favorite"} ${item.name}`}
                        title={item.favorite ? "Remove from favorites" : "Add to favorites"}
                        disabled={space === "hexboard" && !connected}
                        onClick={() => onFavorite(space, item)}
                      >
                        {item.favorite ? "★" : "☆"}
                      </button>
                      <details className="presetOverflowMenu">
                        <summary aria-label={`More actions for ${item.name}`} title="More actions">•••</summary>
                        <div className="presetOverflowActions">
                          <button type="button" onClick={() => onOpen(space, item)}>Open</button>
                          <button type="button" onClick={() => onOrganize(space, item)}>Rename / Move</button>
                          {space === "computer" ? (
                            <button disabled={!connected} type="button" onClick={() => onUpload(item)}>Copy to HexBoard</button>
                          ) : (
                            <button type="button" onClick={() => onDownload(item)}>Copy to Browser</button>
                          )}
                          <button type="button" onClick={() => onExport(item)}>Export</button>
                          <button className="warning" type="button" onClick={() => onErase(space, item)}>Delete</button>
                        </div>
                      </details>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

interface WavetableLibraryPanelProps {
  connected: boolean;
  title: string;
  subtitle: string;
  space: LibrarySpace;
  wavetables: EditableSynthWavetable[];
  folders: string[];
  selectedFolder: string | null;
  onFolderSelect: (space: LibrarySpace, folderPath: string | null) => void;
  onUse: (wavetable: EditableSynthWavetable) => void;
  onUpload: (wavetable: EditableSynthWavetable) => void;
  onDownload: (wavetable: EditableSynthWavetable) => void;
  onExport: (wavetable: EditableSynthWavetable) => void;
  onEdit: (wavetable: EditableSynthWavetable) => void;
  onErase: (space: LibrarySpace, wavetable: EditableSynthWavetable) => void;
}

function WavetableLibraryPanel({
  connected,
  title,
  subtitle,
  space,
  wavetables,
  folders,
  selectedFolder,
  onFolderSelect,
  onUse,
  onUpload,
  onDownload,
  onExport,
  onEdit,
  onErase
}: WavetableLibraryPanelProps) {
  const visibleWavetables = selectedFolder
    ? wavetables.filter((wavetable) => wavetable.folderPath === selectedFolder)
    : wavetables;

  if (space === "hexboard" && !connected) return <section className="librarySpace"><h3>{title}</h3><p className="emptyListItem">Connect to see your wavetables</p></section>;

  return (
    <section className="librarySpace">
      <div className="librarySpaceHeader">
        <div>
          <h3>{title}</h3>
          <span className="muted">{subtitle}</span>
        </div>
        <span className="countBadge">{visibleWavetables.length}</span>
      </div>

      <div className="folderTargets">
        <button
          className={selectedFolder === null ? "folderTarget systemFolderTarget active" : "folderTarget systemFolderTarget"}
          type="button"
          aria-pressed={selectedFolder === null}
          onClick={() => onFolderSelect(space, null)}
        >
          <span>All</span>
          <span>{wavetables.length}</span>
        </button>
        {folders.map((folder) => (
          <button
            className={`folderTarget${folder === rootFolderPath ? " systemFolderTarget" : ""}${folder === selectedFolder ? " active" : ""}`}
            key={`${space}-wavetable-${folder}`}
            type="button"
            aria-pressed={folder === selectedFolder}
            onClick={() => onFolderSelect(space, folder)}
          >
            <span>{folderLabel(folder)}</span>
            <span>{wavetables.filter((wavetable) => wavetable.folderPath === folder).length}</span>
          </button>
        ))}
      </div>

      <ul className="list">
        {visibleWavetables.length === 0 ? (
          <li className="emptyListItem">{selectedFolder ? `No wavetables in ${folderLabel(selectedFolder)}` : space === "hexboard" && !connected ? "Connect to see your wavetables" : "No wavetables"}</li>
        ) : (
          visibleWavetables.map((item) => (
            <li className="listItem presetListItem" key={`${space}-wavetable-${item.objectIdHex}`}>
              <div className="presetMeta">
                <strong>{item.name}</strong>
                <span>{folderLabel(item.folderPath)}</span>
                <span>{item.sampleCrc === undefined ? item.objectIdHex.slice(0, 8).toUpperCase() : `CRC ${item.sampleCrc.toString(16).toUpperCase()}`}</span>
              </div>
              <div className="presetActions">
                <button type="button" onClick={() => onUse(item)}>
                  Use
                </button>
                <button type="button" onClick={() => onEdit(item)}>
                  Edit
                </button>
                {space === "computer" ? (
                  <button disabled={!connected} type="button" title="Copy wavetable to HexBoard" aria-label="Copy wavetable to HexBoard" onClick={() => onUpload(item)}>
                    → HexBoard
                  </button>
                ) : (
                  <button type="button" title="Copy wavetable to Browser Library" aria-label="Copy wavetable to Browser Library" onClick={() => onDownload(item)}>
                    → Browser
                  </button>
                )}
                <button type="button" onClick={() => onExport(item)}>
                  Export
                </button>
                <button className="warning" type="button" onClick={() => onErase(space, item)}>
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
