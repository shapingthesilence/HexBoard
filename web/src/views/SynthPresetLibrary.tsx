import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
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
  SynthSettingKey,
  SynthWavetableTlv,
  type SerumWavetableCrunchOptions,
  type SynthPresetValues,
  type SynthSettingName,
  type WavetableFrameReduction,
  type WavetableNormalization
} from "../catalogs/index.ts";
import { SynthPreviewController, type SynthPreviewPatch } from "../audio/synthPreview.ts";
import { MockMidiTransport } from "../midi/mockTransport.ts";
import { PresetSyncClient } from "../midi/presetSyncClient.ts";
import type { MidiTransport } from "../midi/types.ts";
import { WebMidiTransport } from "../midi/webMidi.ts";
import { crc32 } from "../protocol/crc32.ts";
import type { ObjectListRecord } from "../protocol/index.ts";
import { CommonTlv, decodeObjectBody, textFromBytes } from "../protocol/tlv.ts";
import { formatByteLength, formatHex } from "./format.ts";

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

const synthValueKeys = [
  "PlaybackMode",
  "Waveform",
  "SynthDrive",
  "SynthModTarget",
  "SynthModAmount",
  "SynthVibratoSpeed",
  "ArpeggiatorDivision",
  "SynthBPM",
  "EnvelopeAttackIndex",
  "EnvelopeHoldIndex",
  "EnvelopeDecayIndex",
  "EnvelopeSustainLevel",
  "EnvelopeReleaseIndex",
  "EffectEnvelopeTarget",
  "EffectEnvelopeAmount",
  "EffectEnvelopeAttackIndex",
  "EffectEnvelopeHoldIndex",
  "EffectEnvelopeDecayIndex",
  "EffectEnvelopeSustainLevel",
  "EffectEnvelopeReleaseIndex",
  "EffectEnvelope2Target",
  "EffectEnvelope2Amount",
  "EffectEnvelope2AttackIndex",
  "EffectEnvelope2HoldIndex",
  "EffectEnvelope2DecayIndex",
  "EffectEnvelope2SustainLevel",
  "EffectEnvelope2ReleaseIndex",
  "SynthPortamentoTimeIndex",
  "ArpeggiatorDirection",
  "SynthWavetablePosition",
  "SynthLfoTarget",
  "SynthLfoAmount",
  "SynthLfoWave",
  "SynthLfoSpeed"
] as const satisfies readonly SynthSettingName[];

type EditableSynthValueKey = (typeof synthValueKeys)[number];
type EditableSynthValues = Record<EditableSynthValueKey, number>;

interface EditableSynthPreset {
  objectIdHex: string;
  deviceHandle?: number;
  name: string;
  folderPath: string;
  wavetableName: string;
  wavetableFolderPath: string;
  favorite: boolean;
  values: EditableSynthValues;
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

const computerLibraryStorageKey = "hexboard.synthPresetComputerLibrary.v1";
const computerWavetableStorageKey = "hexboard.synthWavetableComputerLibrary.v1";
const computerWavetableFactorySeedStorageKey = "hexboard.synthWavetableFactorySeed.v1";
const presetFileFormat = "hexboard.synthPreset.v1";
const wavetableFileFormat = "hexboard.synthWavetable.v1";
const builtInWavetableFolder = "/Built In";
const basicWavetableName = "Basic";
const deviceNameMaxBytes = 31;
const deviceFolderMaxBytes = 47;

const defaultPreset: EditableSynthPreset = {
  objectIdHex: objectIdToHex(deterministicObjectId("Soft String Pad")),
  name: "Soft String Pad",
  folderPath: "/",
  wavetableName: "Classic",
  wavetableFolderPath: builtInWavetableFolder,
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
    folderPath: "/",
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
const defaultFolders = [rootFolderPath, "Pads/Warm", "Leads", "FX/Animated"];

const builtInWavetables = [
  { name: "Basic", folderPath: builtInWavetableFolder },
  { name: "Classic", folderPath: builtInWavetableFolder },
  { name: "Edge", folderPath: builtInWavetableFolder },
  { name: "Glass", folderPath: builtInWavetableFolder },
  { name: "Digital", folderPath: builtInWavetableFolder },
  { name: "Motion", folderPath: builtInWavetableFolder }
] as const;

const legacyWaveformCompatibility = new Map<number, { name: string; folderPath: string; position: number }>([
  [7, { name: basicWavetableName, folderPath: builtInWavetableFolder, position: 0 }],
  [8, { name: basicWavetableName, folderPath: builtInWavetableFolder, position: 127 }],
  [9, { name: basicWavetableName, folderPath: builtInWavetableFolder, position: 85 }],
  [10, { name: basicWavetableName, folderPath: builtInWavetableFolder, position: 42 }],
  [0, { name: basicWavetableName, folderPath: builtInWavetableFolder, position: 0 }],
  [1, { name: "Classic", folderPath: builtInWavetableFolder, position: 0 }],
  [2, { name: "Classic", folderPath: builtInWavetableFolder, position: 127 }],
  [11, { name: "Motion", folderPath: builtInWavetableFolder, position: 0 }],
  [12, { name: "Edge", folderPath: builtInWavetableFolder, position: 0 }],
  [13, { name: "Edge", folderPath: builtInWavetableFolder, position: 42 }],
  [14, { name: "Glass", folderPath: builtInWavetableFolder, position: 0 }],
  [15, { name: "Digital", folderPath: builtInWavetableFolder, position: 0 }],
  [16, { name: "Digital", folderPath: builtInWavetableFolder, position: 42 }],
  [17, { name: "Digital", folderPath: builtInWavetableFolder, position: 85 }],
  [18, { name: "Glass", folderPath: builtInWavetableFolder, position: 42 }],
  [19, { name: "Glass", folderPath: builtInWavetableFolder, position: 85 }],
  [20, { name: "Digital", folderPath: builtInWavetableFolder, position: 127 }],
  [21, { name: "Motion", folderPath: builtInWavetableFolder, position: 42 }],
  [22, { name: "Glass", folderPath: builtInWavetableFolder, position: 127 }],
  [23, { name: "Motion", folderPath: builtInWavetableFolder, position: 85 }],
  [24, { name: "Edge", folderPath: builtInWavetableFolder, position: 85 }],
  [25, { name: "Edge", folderPath: builtInWavetableFolder, position: 127 }],
  [26, { name: "Motion", folderPath: builtInWavetableFolder, position: 127 }],
  [27, { name: basicWavetableName, folderPath: builtInWavetableFolder, position: 0 }],
  [28, { name: "UserTbl", folderPath: "/User", position: 0 }]
]);

const playbackOptions = [
  { label: "Off", value: 0 },
  { label: "MonoRtg", value: 1 },
  { label: "MonoLeg", value: 4 },
  { label: "Arp'gio", value: 2 },
  { label: "Poly", value: 3 }
];

const arpDivisionOptions = [
  { label: "1/2", value: 2 },
  { label: "1/3", value: 3 },
  { label: "1/4", value: 4 },
  { label: "1/6", value: 6 },
  { label: "1/8", value: 8 },
  { label: "1/12", value: 12 },
  { label: "1/16", value: 16 },
  { label: "1/24", value: 24 },
  { label: "1/32", value: 32 }
];

const arpDirectionOptions = [
  { label: "Up", value: 0 },
  { label: "Down", value: 1 },
  { label: "Order played", value: 2 },
  { label: "Reverse played", value: 3 },
  { label: "Up/down", value: 4 },
  { label: "Down/up", value: 5 },
  { label: "Random", value: 6 }
];

const driveOptions = [
  { label: "Off", value: 0 },
  { label: "Warm", value: 1 },
  { label: "Edge", value: 2 },
  { label: "Dirty", value: 3 }
];

const modTargetOptions = [
  { label: "Vibrato", value: 1 },
  { label: "Pitch", value: 2 },
  { label: "WT Pos", value: 3 },
  { label: "FoldWrp", value: 0 },
  { label: "DutyWrp", value: 4 },
  { label: "PolyWrp", value: 5 }
];

const lfoWaveOptions = [
  { label: "Sine", value: 0 },
  { label: "Triangle", value: 1 },
  { label: "Saw", value: 2 },
  { label: "Square", value: 3 }
];

const lfoSpeedOptions = [
  { label: "0.05 Hz", value: 0 },
  { label: "0.1 Hz", value: 1 },
  { label: "0.2 Hz", value: 2 },
  { label: "0.33 Hz", value: 3 },
  { label: "0.5 Hz", value: 4 },
  { label: "0.75 Hz", value: 5 },
  { label: "1 Hz", value: 6 },
  { label: "1.25 Hz", value: 7 },
  { label: "1.5 Hz", value: 8 },
  { label: "2 Hz", value: 9 },
  { label: "2.5 Hz", value: 10 },
  { label: "3 Hz", value: 11 },
  { label: "4 Hz", value: 12 },
  { label: "5 Hz", value: 13 },
  { label: "6 Hz", value: 14 },
  { label: "8 Hz", value: 15 },
  { label: "10 Hz", value: 16 },
  { label: "12 Hz", value: 17 },
  { label: "16 Hz", value: 18 },
  { label: "20 Hz", value: 19 }
];

const envelopeTimeOptions = [
  "0 ms",
  "5 ms",
  "10 ms",
  "15 ms",
  "20 ms",
  "30 ms",
  "50 ms",
  "75 ms",
  "100 ms",
  "150 ms",
  "200 ms",
  "300 ms",
  "500 ms",
  "750 ms",
  "1 s",
  "1.5 s",
  "2 s",
  "2.5 s",
  "3 s",
  "4 s"
].map((label, value) => ({ label, value }));

const synthValueBounds: Record<EditableSynthValueKey, readonly [number, number]> = {
  PlaybackMode: [0, 4],
  Waveform: [0, 28],
  SynthDrive: [0, 3],
  SynthModTarget: [0, 5],
  SynthModAmount: [0, 127],
  SynthVibratoSpeed: [0, 11],
  ArpeggiatorDivision: [1, 32],
  SynthBPM: [1, 255],
  EnvelopeAttackIndex: [0, 19],
  EnvelopeHoldIndex: [0, 19],
  EnvelopeDecayIndex: [0, 19],
  EnvelopeSustainLevel: [0, 127],
  EnvelopeReleaseIndex: [0, 19],
  EffectEnvelopeTarget: [0, 5],
  EffectEnvelopeAmount: [0, 254],
  EffectEnvelopeAttackIndex: [0, 19],
  EffectEnvelopeHoldIndex: [0, 19],
  EffectEnvelopeDecayIndex: [0, 19],
  EffectEnvelopeSustainLevel: [0, 127],
  EffectEnvelopeReleaseIndex: [0, 19],
  EffectEnvelope2Target: [0, 5],
  EffectEnvelope2Amount: [0, 254],
  EffectEnvelope2AttackIndex: [0, 19],
  EffectEnvelope2HoldIndex: [0, 19],
  EffectEnvelope2DecayIndex: [0, 19],
  EffectEnvelope2SustainLevel: [0, 127],
  EffectEnvelope2ReleaseIndex: [0, 19],
  SynthPortamentoTimeIndex: [0, 19],
  ArpeggiatorDirection: [0, 6],
  SynthWavetablePosition: [0, 127],
  SynthLfoTarget: [0, 5],
  SynthLfoAmount: [0, 254],
  SynthLfoWave: [0, 3],
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

function clampEnvelopeTimeIndex(value: number): number {
  return Math.max(0, Math.min(envelopeTimeOptions.length - 1, Math.round(value)));
}

function envelopeTimeLabel(index: number): string {
  return envelopeTimeOptions[clampEnvelopeTimeIndex(index)].label;
}

function driveLabel(value: number): string {
  return driveOptions.find((option) => option.value === value)?.label ?? "Off";
}

function lfoSpeedLabel(value: number): string {
  return lfoSpeedOptions.find((option) => option.value === clampNumber(value, 0, lfoSpeedOptions.length - 1))?.label ?? "1 Hz";
}

function fxAmountByteToPercent(value: number): number {
  if (value === 127) {
    return 0;
  }
  if (value > 127) {
    return Math.round(((value - 127) / 127) * 100);
  }
  return -Math.round(((127 - value) / 127) * 100);
}

function fxAmountPercentToByte(value: number): number {
  const clamped = Math.max(-100, Math.min(100, Math.round(value)));
  return Math.round(127 + (clamped / 100) * 127);
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
    values: { ...preset.values }
  };
}

function cloneWavetable(wavetable: EditableSynthWavetable): EditableSynthWavetable {
  return {
    ...wavetable,
    samples: wavetable.samples ? new Uint8Array(wavetable.samples) : undefined
  };
}

function folderLabel(folderPath: string): string {
  return folderPath === rootFolderPath ? "Root" : folderPath;
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
  return clampUtf8Bytes(folderPath.trim() || rootFolderPath, deviceFolderMaxBytes);
}

function normalizeWavetableReference(folderPath: string | undefined, name: string | undefined) {
  return {
    folderPath: normalizeDisplayFolderPath(folderPath ?? builtInWavetableFolder),
    name: normalizedWavetableName(name?.trim() ? name : basicWavetableName)
  };
}

function normalizedPresetName(name: string): string {
  return clampUtf8Bytes(name.trim() || "Untitled", deviceNameMaxBytes);
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
  return `${normalizeDisplayFolderPath(wavetable.folderPath).toLocaleLowerCase()}\u0000${normalizedWavetableName(wavetable.name).toLocaleLowerCase()}`;
}

function findPresetByFolderAndName(presets: EditableSynthPreset[], preset: EditableSynthPreset): EditableSynthPreset | undefined {
  const saveKey = presetSaveKey(preset);
  return presets.find((candidate) => presetSaveKey(candidate) === saveKey);
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

function mergeMissingFactoryWavetables(wavetables: EditableSynthWavetable[]): EditableSynthWavetable[] {
  const existingKeys = new Set(wavetables.map((wavetable) => wavetableSaveKey(wavetable)));
  const additions = factoryComputerWavetables().filter((wavetable) => !existingKeys.has(wavetableSaveKey(wavetable)));
  return [...wavetables.map(cloneWavetable), ...additions].sort(compareWavetables);
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
    }
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
    values: preset.values satisfies SynthPresetValues
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
  const name = typeof source.wavetableName === "string" ? source.wavetableName : "";
  const folderPath = typeof source.wavetableFolderPath === "string" ? source.wavetableFolderPath : "";
  if (name.trim()) {
    return normalizeWavetableReference(folderPath, name);
  }
  return null;
}

function legacyWavetableReference(values: EditableSynthValues): { name: string; folderPath: string; position: number } {
  return legacyWaveformCompatibility.get(values.Waveform)
    ?? { name: basicWavetableName, folderPath: builtInWavetableFolder, position: 0 };
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
  const explicitWavetable = wavetableReferenceFromUnknown(source);
  const legacyWavetable = legacyWavetableReference(values);
  const wavetable = explicitWavetable ?? legacyWavetable;
  if (!explicitWavetable) {
    values.SynthWavetablePosition = legacyWavetable.position;
  }
  values.Waveform = 27;

  return {
    objectIdHex: normalizeObjectIdHex(source.objectId, `synth:${folderPath}:${name}:${Date.now()}`),
    name,
    folderPath,
    wavetableName: wavetable.name,
    wavetableFolderPath: wavetable.folderPath,
    favorite: source.favorite === true,
    values
  };
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
    } else if (record.tag === SynthPresetTlv.SynthValues) {
      for (let index = 0; index + 1 < record.value.length; index += 2) {
        const setting = Object.entries(SynthSettingKey).find(([, value]) => value === record.value[index])?.[0] as EditableSynthValueKey | undefined;
        if (setting && synthValueKeys.includes(setting)) {
          values[setting] = clampSynthValue(setting, record.value[index + 1]);
        }
      }
    }
  }
  let wavetable = normalizeWavetableReference(wavetableFolderPath, wavetableName);
  if (!wavetableName.trim()) {
    const legacyWavetable = legacyWavetableReference(values);
    wavetable = legacyWavetable;
    values.SynthWavetablePosition = legacyWavetable.position;
  }
  values.Waveform = 27;

  return {
    objectIdHex,
    deviceHandle,
    name,
    folderPath,
    wavetableName: wavetable.name,
    wavetableFolderPath: wavetable.folderPath,
    favorite,
    values
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
  const folderPath = typeof source.folderPath === "string" && source.folderPath.trim() ? normalizeDisplayFolderPath(source.folderPath) : "Wavetables";
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
  window.localStorage.setItem(computerLibraryStorageKey, JSON.stringify(presets.map(exportPreset)));
}

function loadComputerWavetables(): EditableSynthWavetable[] {
  if (typeof window === "undefined") {
    return factoryComputerWavetables();
  }

  try {
    const factorySeeded = window.localStorage.getItem(computerWavetableFactorySeedStorageKey) === "1";
    const stored = window.localStorage.getItem(computerWavetableStorageKey);
    const parsed = stored ? JSON.parse(stored) : null;
    if (Array.isArray(parsed)) {
      const wavetables = parsed.map(wavetableFromUnknown);
      if (!factorySeeded) {
        window.localStorage.setItem(computerWavetableFactorySeedStorageKey, "1");
        return mergeMissingFactoryWavetables(wavetables);
      }
      return wavetables.sort(compareWavetables);
    }
  } catch {
    window.localStorage.removeItem(computerWavetableStorageKey);
  }

  window.localStorage.setItem(computerWavetableFactorySeedStorageKey, "1");
  return factoryComputerWavetables();
}

function saveComputerWavetables(wavetables: EditableSynthWavetable[]) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(computerWavetableStorageKey, JSON.stringify(wavetables.map(exportWavetable)));
}

function safeFileName(value: string): string {
  const sanitized = value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "");
  return sanitized || "hexboard-synth-preset";
}

function librarySpaceLabel(space: LibrarySpace): string {
  return space === "computer" ? "Computer Library" : "HexBoard Library";
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

const auditionKeyRows = [
  auditionKeyMap.slice(0, 12),
  auditionKeyMap.slice(12)
] as const;
const auditionFeatureVisible = false;

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
  const [libraryKind, setLibraryKind] = useState<SynthLibraryKind>("presets");
  const [computerPresets, setComputerPresets] = useState(loadComputerPresets);
  const [hexboardPresets, setHexboardPresets] = useState<EditableSynthPreset[]>([]);
  const [computerWavetables, setComputerWavetables] = useState(loadComputerWavetables);
  const [hexboardWavetables, setHexboardWavetables] = useState<EditableSynthWavetable[]>([]);
  const [preset, setPreset] = useState<EditableSynthPreset>(() => clonePreset(defaultPreset));
  const [openedSource, setOpenedSource] = useState<LibrarySpace>("computer");
  const [customFolders, setCustomFolders] = useState(defaultFolders);
  const [customWavetableFolders, setCustomWavetableFolders] = useState([rootFolderPath, "Wavetables"]);
  const [newFolder, setNewFolder] = useState("");
  const [newWavetableFolder, setNewWavetableFolder] = useState("");
  const [wavetableImportName, setWavetableImportName] = useState("");
  const [wavetableImportFolder, setWavetableImportFolder] = useState("Wavetables");
  const [wavetableImportDialogOpen, setWavetableImportDialogOpen] = useState(false);
  const [wavetableImportFormat, setWavetableImportFormat] = useState<WavetableImportFormat>("serum-vital");
  const [wavetablePreviewFrame, setWavetablePreviewFrame] = useState(0);
  const [wavetablePreviewMipLevel, setWavetablePreviewMipLevel] = useState(0);
  const [wavetableFrameReduction, setWavetableFrameReduction] = useState<WavetableFrameReduction>("interpolated");
  const [wavetableNormalization, setWavetableNormalization] = useState<WavetableNormalization>("whole-table");
  const [wavetableSmooth, setWavetableSmooth] = useState(false);
  const [wavetableDither, setWavetableDither] = useState(false);
  const [wavetableImportSource, setWavetableImportSource] = useState<WavetableImportSource | null>(null);
  const [autoSend, setAutoSend] = useState(true);
  const [editorHydrated, setEditorHydrated] = useState(() => transport instanceof MockMidiTransport);
  const [syncStatus, setSyncStatus] = useState("Ready");
  const [auditionOpen, setAuditionOpen] = useState(false);
  const [previewOctave, setPreviewOctave] = useState(4);
  const [previewStatus, setPreviewStatus] = useState("Ready");
  const [previewVolume, setPreviewVolume] = useState(0.35);
  const [previewMod, setPreviewMod] = useState(0);
  const [heldPreviewNotes, setHeldPreviewNotes] = useState<number[]>([]);
  const [lastFrameCount, setLastFrameCount] = useState(0);
  const [draggedPreset, setDraggedPreset] = useState<DraggedPreset | null>(null);
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
  const pressedPreviewKeys = useRef(new Map<string, number>());
  const latestPreviewPatch = useRef<SynthPreviewPatch | null>(null);
  const latestPreviewVolume = useRef(previewVolume);
  const latestPreviewMod = useRef(previewMod);
  const skipNextAutoSend = useRef(true);
  const pendingLiveSynthParam = useRef<{ key: EditableSynthValueKey; value: number } | null>(null);

  const client = useMemo(() => new PresetSyncClient(transport), [transport]);
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
      ).sort((left, right) => left.localeCompare(right)),
    [computerPresets, customFolders, hexboardPresets, preset.folderPath]
  );
  const allWavetableFolders = useMemo(
    () =>
      Array.from(
        new Set([
          rootFolderPath,
          "Wavetables",
          ...builtInWavetables.map((wavetable) => wavetable.folderPath),
          ...customWavetableFolders,
          ...computerWavetables.map((candidate) => candidate.folderPath),
          ...hexboardWavetables.map((candidate) => candidate.folderPath),
          preset.wavetableFolderPath,
          wavetableImportFolder
        ].filter(Boolean))
      ).sort((left, right) => left.localeCompare(right)),
    [computerWavetables, customWavetableFolders, hexboardWavetables, preset.wavetableFolderPath, wavetableImportFolder]
  );
  const wavetableOptions = useMemo(() => {
    const refs = [
      ...builtInWavetables,
      ...computerWavetables,
      ...hexboardWavetables,
      normalizeWavetableReference(preset.wavetableFolderPath, preset.wavetableName)
    ];
    const unique = new Map<string, { name: string; folderPath: string }>();
    for (const ref of refs) {
      const normalized = normalizeWavetableReference(ref.folderPath, ref.name);
      unique.set(wavetableSaveKey(normalized), normalized);
    }
    return Array.from(unique.values())
      .sort((left, right) => `${left.folderPath}/${left.name}`.localeCompare(`${right.folderPath}/${right.name}`))
      .map((ref) => ({
        value: wavetableOptionValue(ref.folderPath, ref.name),
        label: `${folderLabel(ref.folderPath)} / ${ref.name}`
      }));
  }, [computerWavetables, hexboardWavetables, preset.wavetableFolderPath, preset.wavetableName]);
  const selectedPreviewWavetable = useMemo(() => {
    const selectedKey = wavetableSaveKey(normalizeWavetableReference(preset.wavetableFolderPath, preset.wavetableName));
    return [...computerWavetables, ...hexboardWavetables, ...factoryWavetableSources()].find((wavetable) =>
      wavetable.samples && wavetableSaveKey(wavetable) === selectedKey
    );
  }, [computerWavetables, hexboardWavetables, preset.wavetableFolderPath, preset.wavetableName]);
  const previewPatch = useMemo<SynthPreviewPatch>(() => ({
    wavetableName: preset.wavetableName,
    wavetableFolderPath: preset.wavetableFolderPath,
    wavetableSamples: selectedPreviewWavetable?.samples ? synthWavetableBaseSamples(selectedPreviewWavetable.samples) : undefined,
    values: preset.values
  }), [preset.values, preset.wavetableFolderPath, preset.wavetableName, selectedPreviewWavetable?.samples]);
  const draftPreset = useMemo(() => encodeEditablePreset(preset), [preset]);
  const monoModeSelected = preset.values.PlaybackMode === 1 || preset.values.PlaybackMode === 4;
  const arpModeSelected = preset.values.PlaybackMode === 2;
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
    saveComputerPresets(computerPresets);
  }, [computerPresets]);

  useEffect(() => {
    saveComputerWavetables(computerWavetables);
  }, [computerWavetables]);

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

  useEffect(() => () => {
    if (previewChordTimerRef.current !== null) {
      window.clearTimeout(previewChordTimerRef.current);
    }
    void previewControllerRef.current?.close();
  }, []);

  useEffect(() => {
    if (transport instanceof MockMidiTransport) {
      setEditorHydrated(true);
      return;
    }

    let cancelled = false;
    setEditorHydrated(false);
    skipNextAutoSend.current = true;

    const hydrateTimer = window.setTimeout(() => void (async () => {
      await loadCurrentHexBoardPatch(() => cancelled);
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
    if (!autoSend || !editorHydrated) {
      return;
    }
    if (skipNextAutoSend.current) {
      skipNextAutoSend.current = false;
      return;
    }

    const timeout = window.setTimeout(() => {
      const liveParam = pendingLiveSynthParam.current;
      pendingLiveSynthParam.current = null;
      if (liveParam) {
        void sendLiveParameterPreview(liveParam, "Auto-sent");
      } else {
        void sendPreview("Auto-sent");
      }
    }, 120);

    return () => window.clearTimeout(timeout);
  }, [autoSend, draftPreset, editorHydrated]);

  function updateValue(key: EditableSynthValueKey, value: number) {
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

  function previewController(): SynthPreviewController {
    if (!previewControllerRef.current) {
      previewControllerRef.current = new SynthPreviewController();
    }
    previewControllerRef.current.setPatch(latestPreviewPatch.current ?? previewPatch);
    previewControllerRef.current.setVolume(latestPreviewVolume.current);
    previewControllerRef.current.setMod(latestPreviewMod.current);
    return previewControllerRef.current;
  }

  async function startPreviewNote(note: number) {
    try {
      await previewController().noteOn(note);
      setHeldPreviewNotes((current) => current.includes(note) ? current : [...current, note]);
      setPreviewStatus(`Playing ${midiNoteLabel(note)}`);
    } catch (error) {
      setPreviewStatus(error instanceof Error ? error.message : "Failed to start browser audio");
    }
  }

  function stopPreviewNote(note: number) {
    previewControllerRef.current?.noteOff(note);
    setHeldPreviewNotes((current) => current.filter((heldNote) => heldNote !== note));
  }

  function stopAllPreviewNotes(status = "Stopped") {
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
      stopAllPreviewNotes("Hidden");
    }
    setAuditionOpen(open);
  }

  function changePreviewOctave(octave: number) {
    stopAllPreviewNotes("Octave changed");
    setPreviewOctave(clampNumber(octave, 1, 7));
  }

  async function playPreviewChord() {
    stopAllPreviewNotes("Starting chord");
    const root = (previewOctave + 1) * 12;
    const notes = [root, root + 7, root + 12, root + 16, root + 19];
    await Promise.all(notes.map((note) => startPreviewNote(note)));
    previewChordTimerRef.current = window.setTimeout(() => {
      stopAllPreviewNotes("Chord played");
    }, 1400);
  }

  function addFolder() {
    const folder = newFolder.trim();
    if (!folder) {
      return;
    }
    skipNextAutoSend.current = false;
    pendingLiveSynthParam.current = null;
    setEditorHydrated(true);
    setCustomFolders((current) => Array.from(new Set([...current, folder])).sort());
    setPreset((current) => ({ ...current, folderPath: folder }));
    setNewFolder("");
  }

  function addWavetableFolder() {
    const folder = newWavetableFolder.trim();
    if (!folder) {
      return;
    }
    setCustomWavetableFolders((current) => Array.from(new Set([...current, folder])).sort());
    setWavetableImportFolder(folder);
    setNewWavetableFolder("");
  }

  function selectPresetWavetable(value: string) {
    const wavetable = wavetableReferenceFromOptionValue(value);
    skipNextAutoSend.current = false;
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

  function openPreset(source: LibrarySpace, nextPreset: EditableSynthPreset) {
    const selectedPreset = clonePreset(nextPreset);
    stopAllPreviewNotes("Loaded preset");
    skipNextAutoSend.current = true;
    setEditorHydrated(true);
    setPreset(selectedPreset);
    setOpenedSource(source);
    void sendPresetPreview(selectedPreset, "Opened for audition");
  }

  function findPreset(dragged: DraggedPreset): EditableSynthPreset | undefined {
    const presets = dragged.space === "computer" ? computerPresets : hexboardPresets;
    return presets.find((candidate) => candidate.objectIdHex === dragged.objectIdHex);
  }

  function toggleFolderFilter(space: LibrarySpace, folderPath: string) {
    setFolderFilters((current) => ({
      ...current,
      [space]: current[space] === folderPath ? null : folderPath
    }));
  }

  function toggleWavetableFolderFilter(space: LibrarySpace, folderPath: string) {
    setWavetableFolderFilters((current) => ({
      ...current,
      [space]: current[space] === folderPath ? null : folderPath
    }));
  }

  function confirmPresetOverwrite(targetLabel: string, existing: EditableSynthPreset): boolean {
    return window.confirm(`Overwrite "${existing.name}" in ${folderLabel(existing.folderPath)} on ${targetLabel}?`);
  }

  function preparePresetForLibrarySave(
    nextPreset: EditableSynthPreset,
    targetPresets: EditableSynthPreset[],
    targetLabel: string,
    keepDeviceHandle: boolean
  ): { preset: EditableSynthPreset; overwritten: boolean } | null {
    const normalized = normalizedPresetForSave(nextPreset);
    const existing = findPresetByFolderAndName(targetPresets, normalized);
    if (existing) {
      if (!confirmPresetOverwrite(targetLabel, existing)) {
        return null;
      }
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

  function saveToComputer(nextPreset = preset, prefix = "Saved") {
    const decision = preparePresetForLibrarySave(nextPreset, computerPresets, "Computer Library", false);
    if (!decision) {
      setSyncStatus("Save canceled");
      return;
    }
    const normalized = {
      ...decision.preset,
      deviceHandle: undefined
    };
    setComputerPresets((current) => upsertPreset(current, normalized));
    setCustomFolders((current) => Array.from(new Set([...current, normalized.folderPath])).sort());
    skipNextAutoSend.current = true;
    setPreset(clonePreset(normalized));
    setOpenedSource("computer");
    setSyncStatus(`${decision.overwritten ? "Overwrote" : prefix} ${normalized.name} in Computer Library`);
  }

  async function sendPresetPreview(nextPreset: EditableSynthPreset, prefix = "Sent") {
    pendingLiveSynthParam.current = null;
    try {
      const frames = await client.sendSynthPresetPreview(encodeEditablePreset(nextPreset));
      setLastFrameCount(frames.length);
      setSyncStatus(`${prefix} ${frames.length} frame${frames.length === 1 ? "" : "s"} to ${transport.label}`);
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : "Failed to send synth preset");
    }
  }

  async function sendPreview(prefix = "Sent") {
    await sendPresetPreview(preset, prefix);
  }

  async function sendLiveParameterPreview(param: { key: EditableSynthValueKey; value: number }, prefix = "Sent") {
    try {
      await client.sendSynthParameterPreview(SynthSettingKey[param.key], param.value);
      setLastFrameCount(1);
      setSyncStatus(`${prefix} ${param.key} to ${transport.label}`);
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : "Failed to send synth parameter");
    }
  }

  async function uploadToHexBoard(nextPreset = preset, prefix = "Saved") {
    const decision = preparePresetForLibrarySave(nextPreset, hexboardPresets, "HexBoard Library", true);
    if (!decision) {
      setSyncStatus("Save canceled");
      return;
    }
    const normalized = decision.preset;
    try {
      const encodedPreset = encodeEditablePreset(normalized);
      const frames = transport instanceof MockMidiTransport
        ? await client.sendSynthPresetSave(encodedPreset)
        : await client.sendSynthPresetSaveConfirmed(encodedPreset);
      setLastFrameCount(frames.length);
      setCustomFolders((current) => Array.from(new Set([...current, normalized.folderPath])).sort());
      skipNextAutoSend.current = true;
      setPreset(clonePreset(normalized));
      setOpenedSource("hexboard");
      if (transport instanceof MockMidiTransport) {
        setHexboardPresets((current) => upsertPreset(current, normalized));
        setSyncStatus(`${decision.overwritten ? "Overwrote" : prefix} ${normalized.name} in HexBoard Library with ${frames.length} frame${frames.length === 1 ? "" : "s"}`);
      } else {
        await refreshHexBoardLibrary(`${decision.overwritten ? "Overwrote" : prefix} ${normalized.name} in HexBoard Library with ${frames.length} frame${frames.length === 1 ? "" : "s"}`);
      }
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : "Failed to save synth preset");
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
    const decision = prepareWavetableForLibrarySave(nextWavetable, computerWavetables, "Computer Wavetables", false);
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
    setSyncStatus(`${decision.overwritten ? "Overwrote" : prefix} ${normalized.name} in Computer Wavetables`);
  }

  async function uploadWavetableToHexBoard(nextWavetable: EditableSynthWavetable, prefix = "Saved") {
    const decision = prepareWavetableForLibrarySave(nextWavetable, hexboardWavetables, "HexBoard Wavetables", true);
    if (!decision) {
      setSyncStatus("Save canceled");
      return;
    }
    const normalized = decision.wavetable;
    try {
      const encodedWavetable = encodeEditableWavetable(normalized);
      const frames = transport instanceof MockMidiTransport
        ? await client.sendSynthWavetableImport(encodedWavetable)
        : await client.sendSynthWavetableImportConfirmed(encodedWavetable);
      setLastFrameCount(frames.length);
      setCustomWavetableFolders((current) => Array.from(new Set([...current, normalized.folderPath])).sort());
      if (transport instanceof MockMidiTransport) {
        setHexboardWavetables((current) => upsertWavetable(current, normalized));
        setSyncStatus(`${decision.overwritten ? "Overwrote" : prefix} ${normalized.name} in HexBoard Wavetables with ${frames.length} frame${frames.length === 1 ? "" : "s"}`);
      } else {
        await refreshHexBoardWavetables(`${decision.overwritten ? "Overwrote" : prefix} ${normalized.name} in HexBoard Wavetables with ${frames.length} frame${frames.length === 1 ? "" : "s"}`);
      }
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : "Failed to save synth wavetable");
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
        setSyncStatus(`${loaded.name} does not have sample data loaded for download`);
        return;
      }
      saveWavetableToComputer(loaded, "Downloaded");
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : "Failed to download HexBoard wavetable");
    }
  }

  function useWavetableAsPresetSource(nextWavetable: EditableSynthWavetable) {
    skipNextAutoSend.current = false;
    pendingLiveSynthParam.current = null;
    setEditorHydrated(true);
    setPreset((current) => ({
      ...current,
      wavetableName: nextWavetable.name,
      wavetableFolderPath: nextWavetable.folderPath,
      values: {
        ...current.values,
        Waveform: 27
      }
    }));
    setSyncStatus(`Selected ${nextWavetable.name} for the open preset`);
  }

  function eraseWavetable(space: LibrarySpace, erasedWavetable: EditableSynthWavetable) {
    if (space === "computer") {
      setComputerWavetables((current) => removeWavetable(current, erasedWavetable.objectIdHex));
      setSyncStatus(`Erased ${erasedWavetable.name} from Computer Wavetables`);
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
      if (duplicate && !confirmWavetableOverwrite("Computer Wavetables", duplicate)) {
        setSyncStatus("Edit canceled");
        return;
      }
      setComputerWavetables((current) => {
        const withoutDuplicate = duplicate ? removeWavetable(current, duplicate.objectIdHex) : current;
        return upsertWavetable(withoutDuplicate, renamed);
      });
      setCustomWavetableFolders((current) => Array.from(new Set([...current, renamed.folderPath])).sort());
      setSyncStatus(`Updated ${renamed.name} in Computer Wavetables`);
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
      setSyncStatus(`Cannot rename: ${renamed.name} already exists in ${folderLabel(renamed.folderPath)} on HexBoard`);
      return;
    }

    try {
      const frames = await client.sendSynthWavetableMetadataUpdate(encodeEditableWavetableMetadata(renamed), renamed.deviceHandle);
      setLastFrameCount(frames.length);
      setCustomWavetableFolders((current) => Array.from(new Set([...current, renamed.folderPath])).sort());
      await refreshHexBoardWavetables(`Updated ${renamed.name} in HexBoard Wavetables with ${frames.length} frame${frames.length === 1 ? "" : "s"}`);
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : "Failed to update HexBoard wavetable");
    }
  }

  function downloadFromHexBoard(nextPreset: EditableSynthPreset) {
    saveToComputer(nextPreset, "Downloaded");
  }

  function erasePreset(space: LibrarySpace, erasedPreset: EditableSynthPreset) {
    if (space === "computer") {
      setComputerPresets((current) => removePreset(current, erasedPreset.objectIdHex));
      setSyncStatus(`Erased ${erasedPreset.name} from Computer Library`);
      return;
    }

    if (transport instanceof MockMidiTransport || erasedPreset.deviceHandle === undefined) {
      setHexboardPresets((current) => removePreset(current, erasedPreset.objectIdHex));
      setSyncStatus(`Erased ${erasedPreset.name} from HexBoard Library`);
      return;
    }

    void client.deleteSynthPreset(erasedPreset.deviceHandle)
      .then(() => refreshHexBoardLibrary(`Erased ${erasedPreset.name} from HexBoard Library`))
      .catch((error) => setSyncStatus(error instanceof Error ? error.message : "Failed to erase HexBoard preset"));
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
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    try {
      const imported = presetFromUnknown(JSON.parse(await file.text()));
      setComputerPresets((current) => upsertPreset(current, imported));
      setCustomFolders((current) => Array.from(new Set([...current, imported.folderPath])).sort());
      skipNextAutoSend.current = true;
      setPreset(clonePreset(imported));
      setOpenedSource("computer");
      setSyncStatus(`Imported ${imported.name} into Computer Library`);
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
    const folderPath = normalizeDisplayFolderPath(wavetableImportFolder || "Wavetables");
    const wavetable: EditableSynthWavetable = {
      objectIdHex: objectIdToHex(deterministicObjectId(`synth-wavetable:${folderPath}:${wavetableName}:${sampleCrc.toString(16)}`)),
      name: wavetableName,
      folderPath,
      samples,
      sampleCrc
    };
    const computerDecision = prepareWavetableForLibrarySave(wavetable, computerWavetables, "Computer Wavetables", false);
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
      if (isCancelled()) {
        return false;
      }
      skipNextAutoSend.current = true;
      setPreset(clonePreset(currentPreset));
      setOpenedSource("hexboard");
      setEditorHydrated(true);
      setCustomFolders((current) => Array.from(new Set([...current, currentPreset.folderPath])).sort());
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
      setSyncStatus("Mock transport does not have device storage to refresh");
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
      setCustomFolders((current) => Array.from(new Set([...current, ...presets.map((item) => item.folderPath)])).sort());
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
      setSyncStatus("Mock transport does not have device wavetable storage to refresh");
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
      setCustomWavetableFolders((current) => Array.from(new Set([...current, ...wavetables.map((item) => item.folderPath)])).sort());
      setSyncStatus(`${successStatus}: ${wavetables.length} wavetable${wavetables.length === 1 ? "" : "s"} listed; sample data will transfer only on Download or Export`);
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

    if (targetSpace === "computer") {
      setComputerPresets((current) => upsertPreset(current, nextPreset));
      skipNextAutoSend.current = true;
      setPreset(clonePreset(nextPreset));
      setOpenedSource("computer");
      setSyncStatus(`${draggedPreset.space === "hexboard" ? "Downloaded" : "Moved"} ${nextPreset.name} to ${nextPreset.folderPath}`);
      return;
    }

    void uploadToHexBoard(nextPreset, draggedPreset.space === "computer" ? "Uploaded" : "Moved");
  }

  return (
    <section className="workspace synthEditor">
      <aside className="panel stack">
        <div className="row between">
          <h2>Synth Library</h2>
          <div className="row">
            <button className={libraryKind === "presets" ? "active" : ""} type="button" onClick={() => setLibraryKind("presets")}>
              Presets
            </button>
            <button className={libraryKind === "wavetables" ? "active" : ""} type="button" onClick={() => setLibraryKind("wavetables")}>
              Wavetables
            </button>
          </div>
        </div>
        <input ref={fileInputRef} className="hiddenFileInput" type="file" accept="application/json,.json" onChange={(event) => void importPresetFile(event)} />
        <input ref={wavetableFileInputRef} className="hiddenFileInput" type="file" accept="audio/wav,audio/wave,.wav,.hexwav" onChange={(event) => void importWavetableFile(event)} />

        {libraryKind === "presets" ? (
          <>
            <div className="row">
              <button type="button" onClick={() => void refreshHexBoardLibrary()}>
                Refresh HexBoard
              </button>
              <button type="button" onClick={() => fileInputRef.current?.click()}>
                Import Preset
              </button>
            </div>

            <div className="row">
              <input
                aria-label="New folder"
                placeholder="New folder"
                value={newFolder}
                onChange={(event) => setNewFolder(event.target.value)}
              />
              <button type="button" onClick={addFolder}>
                Add
              </button>
            </div>

            <div className="librarySpaces">
              <LibrarySpacePanel
                title="Computer Library"
                subtitle="Browser-saved presets and imported files"
                space="computer"
                presets={computerPresets}
                folders={allFolders}
                selectedFolder={folderFilters.computer}
                draggedPreset={draggedPreset}
                onAllowDrop={allowDrop}
                onDrop={dropPreset}
                onFolderSelect={toggleFolderFilter}
                onDragStart={startDrag}
                onDragEnd={() => setDraggedPreset(null)}
                onOpen={openPreset}
                onUpload={(item) => void uploadToHexBoard(item)}
                onDownload={downloadFromHexBoard}
                onExport={downloadPresetFile}
                onErase={erasePreset}
              />
              <LibrarySpacePanel
                title="HexBoard Library"
                subtitle="Device presets loaded through SysEx"
                space="hexboard"
                presets={hexboardPresets}
                folders={allFolders}
                selectedFolder={folderFilters.hexboard}
                draggedPreset={draggedPreset}
                onAllowDrop={allowDrop}
                onDrop={dropPreset}
                onFolderSelect={toggleFolderFilter}
                onDragStart={startDrag}
                onDragEnd={() => setDraggedPreset(null)}
                onOpen={openPreset}
                onUpload={(item) => void uploadToHexBoard(item)}
                onDownload={downloadFromHexBoard}
                onExport={downloadPresetFile}
                onErase={erasePreset}
              />
            </div>
          </>
        ) : (
          <>
            <div className="row">
              <button type="button" onClick={() => void refreshHexBoardWavetables()}>
                Refresh HexBoard
              </button>
              <button type="button" onClick={() => setWavetableImportDialogOpen(true)}>
                Import Wavetable
              </button>
            </div>

            <div className="row">
              <input
                aria-label="New wavetable folder"
                placeholder="New WT folder"
                value={newWavetableFolder}
                onChange={(event) => setNewWavetableFolder(event.target.value)}
              />
              <button type="button" onClick={addWavetableFolder}>
                Add
              </button>
            </div>

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
                      Upload File
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
                      <span>Frame reduction</span>
                      <select
                        disabled={wavetableImportControlsDisabled}
                        value={wavetableFrameReduction}
                        onChange={(event) => setWavetableFrameReduction(event.target.value as WavetableFrameReduction)}
                      >
                        <option value="nearest">Nearest</option>
                        <option value="interpolated">Interpolated</option>
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

            <div className="librarySpaces">
              <WavetableLibraryPanel
                title="Computer Wavetables"
                subtitle="Browser-saved imported wavetables"
                space="computer"
                wavetables={computerWavetables}
                folders={allWavetableFolders}
                selectedFolder={wavetableFolderFilters.computer}
                onFolderSelect={toggleWavetableFolderFilter}
                onUse={useWavetableAsPresetSource}
                onUpload={(item) => void uploadWavetableToHexBoard(item)}
                onDownload={(item) => void downloadWavetableFromHexBoard(item)}
                onExport={(item) => void downloadWavetableFile(item)}
                onEdit={(item) => void editWavetable("computer", item)}
                onErase={eraseWavetable}
              />
              <WavetableLibraryPanel
                title="HexBoard Wavetables"
                subtitle="Device wavetables loaded through SysEx"
                space="hexboard"
                wavetables={hexboardWavetables}
                folders={allWavetableFolders}
                selectedFolder={wavetableFolderFilters.hexboard}
                onFolderSelect={toggleWavetableFolderFilter}
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

      <div className="panel stack">
        <div className="row between">
          <div>
            <h2>Synth Preset Editor</h2>
            <span className="muted">Opened from {librarySpaceLabel(openedSource)}</span>
          </div>
          <div className="row">
            <label className="checkField">
              <input checked={autoSend} type="checkbox" onChange={(event) => setAutoSend(event.target.checked)} />
              <span>Live send</span>
            </label>
            <button className="primary" type="button" onClick={() => void sendPreview("Sent")}>
              Send Now
            </button>
            <button type="button" onClick={() => saveToComputer()}>
              Save to Computer
            </button>
            <button type="button" onClick={() => void uploadToHexBoard(preset, "Saved")}>
              Save to HexBoard
            </button>
            <button type="button" onClick={() => downloadPresetFile(preset)}>
              Export
            </button>
          </div>
        </div>

        <div className={transport instanceof MockMidiTransport ? "status warn" : "status"}>
          {syncStatus}
          {transport instanceof MockMidiTransport ? " (mock transport)" : ""}
        </div>

        {auditionFeatureVisible ? (
        <section className={auditionOpen ? "auditionPanel" : "auditionPanel collapsed"}>
          <div className="row between">
            <div>
              <h3>Audition</h3>
              <span className="muted">{auditionOpen ? previewStatus : "Hidden"}</span>
            </div>
            <button
              aria-expanded={auditionOpen}
              aria-label={auditionOpen ? "Hide audition" : "Show audition"}
              className="iconButton auditionToggle"
              type="button"
              onClick={() => setAuditionExpanded(!auditionOpen)}
            >
              {auditionOpen ? "-" : "+"}
            </button>
          </div>

          {auditionOpen ? (
            <>
              <div className="auditionKeyRows" onPointerLeave={() => stopAllPreviewNotes("Stopped")}>
                {auditionKeyRows.map((row, rowIndex) => (
                  <div className="auditionKeys" key={`audition-row-${rowIndex}`}>
                    {row.map((mapping) => {
                      const note = auditionNoteFromKey(mapping.key, previewOctave) ?? 60;
                      return (
                        <button
                          className={heldPreviewNotes.includes(note) ? "auditionKey active" : "auditionKey"}
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
                <RangeField label="Preview Vol" value={Math.round(previewVolume * 100)} min={0} max={100} onChange={(value) => setPreviewVolume(value / 100)} suffix="%" />
                <RangeField label="Mod" value={previewMod} min={0} max={127} onChange={setPreviewMod} suffix="/127" />
                <div className="row auditionActions">
                  <button type="button" onClick={() => void playPreviewChord()}>
                    Chord
                  </button>
                  <button type="button" onClick={() => stopAllPreviewNotes()}>
                    Stop
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </section>
        ) : null}

        <div className="fieldGrid">
          <label className="field">
            <span>Name</span>
            <input value={preset.name} onChange={(event) => updatePresetMetadata((current) => ({ ...current, name: event.target.value }))} />
          </label>
          <label className="field">
            <span>Folder</span>
            <select
              value={preset.folderPath}
              onChange={(event) => updatePresetMetadata((current) => ({ ...current, folderPath: event.target.value }))}
            >
              {allFolders.map((folder) => (
                <option key={folder} value={folder}>
                  {folderLabel(folder)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Favorite</span>
            <select
              value={preset.favorite ? "yes" : "no"}
              onChange={(event) => updatePresetMetadata((current) => ({ ...current, favorite: event.target.value === "yes" }))}
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
        </div>

        <section className="editorSection">
          <h3>Voice</h3>
          <div className="editorGrid">
            <SelectField label="Synth Mode" value={preset.values.PlaybackMode} options={playbackOptions} onChange={(value) => updateValue("PlaybackMode", value)} />
            {arpModeSelected ? (
              <>
                <SelectField label="Arp Speed" value={preset.values.ArpeggiatorDivision} options={arpDivisionOptions} onChange={(value) => updateValue("ArpeggiatorDivision", value)} />
                <SelectField label="Arp Direction" value={preset.values.ArpeggiatorDirection} options={arpDirectionOptions} onChange={(value) => updateValue("ArpeggiatorDirection", value)} />
                <RangeField label="Tempo" value={preset.values.SynthBPM} min={1} max={255} onChange={(value) => updateValue("SynthBPM", value)} suffix=" BPM" />
              </>
            ) : null}
            {monoModeSelected ? (
              <RangeField label="Portamento" value={preset.values.SynthPortamentoTimeIndex} min={0} max={19} onChange={(value) => updateValue("SynthPortamentoTimeIndex", value)} suffix={` (${envelopeTimeLabel(preset.values.SynthPortamentoTimeIndex)})`} />
            ) : null}
            <label className="field">
              <span>Wavetable</span>
              <select
                value={wavetableOptionValue(preset.wavetableFolderPath, preset.wavetableName)}
                onChange={(event) => selectPresetWavetable(event.target.value)}
              >
                {wavetableOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <RangeField label="WT Pos" value={preset.values.SynthWavetablePosition} min={0} max={127} onChange={(value) => updateValue("SynthWavetablePosition", value)} suffix="/127" />
            <RangeField label="Drive" value={preset.values.SynthDrive} min={0} max={3} onChange={(value) => updateValue("SynthDrive", value)} suffix={` (${driveLabel(preset.values.SynthDrive)})`} />
            <SelectField label="Wheel FX" value={preset.values.SynthModTarget} options={modTargetOptions} onChange={(value) => updateValue("SynthModTarget", value)} />
            <RangeField label="Wheel Amt" value={preset.values.SynthModAmount} min={0} max={127} onChange={(value) => updateValue("SynthModAmount", value)} suffix="/127" />
            <RangeField label="Vib Speed" value={preset.values.SynthVibratoSpeed} min={0} max={11} onChange={(value) => updateValue("SynthVibratoSpeed", value)} suffix={` (${preset.values.SynthVibratoSpeed + 1} Hz)`} />
          </div>
        </section>

        <section className="editorSection">
          <h3>Amp AHDSR</h3>
          <div className="editorGrid">
            <RangeField label="Attack" value={preset.values.EnvelopeAttackIndex} min={0} max={19} onChange={(value) => updateValue("EnvelopeAttackIndex", value)} suffix={` (${envelopeTimeLabel(preset.values.EnvelopeAttackIndex)})`} />
            <RangeField label="Hold" value={preset.values.EnvelopeHoldIndex} min={0} max={19} onChange={(value) => updateValue("EnvelopeHoldIndex", value)} suffix={` (${envelopeTimeLabel(preset.values.EnvelopeHoldIndex)})`} />
            <RangeField label="Decay" value={preset.values.EnvelopeDecayIndex} min={0} max={19} onChange={(value) => updateValue("EnvelopeDecayIndex", value)} suffix={` (${envelopeTimeLabel(preset.values.EnvelopeDecayIndex)})`} />
            <RangeField label="Sustain" value={preset.values.EnvelopeSustainLevel} min={0} max={127} onChange={(value) => updateValue("EnvelopeSustainLevel", value)} suffix="/127" />
            <RangeField label="Release" value={preset.values.EnvelopeReleaseIndex} min={0} max={19} onChange={(value) => updateValue("EnvelopeReleaseIndex", value)} suffix={` (${envelopeTimeLabel(preset.values.EnvelopeReleaseIndex)})`} />
          </div>
        </section>

        <FxEnvelopeEditor
          title="FX Env 1 AHDSR"
          targetValue={preset.values.EffectEnvelopeTarget}
          amountValue={preset.values.EffectEnvelopeAmount}
          attackValue={preset.values.EffectEnvelopeAttackIndex}
          holdValue={preset.values.EffectEnvelopeHoldIndex}
          decayValue={preset.values.EffectEnvelopeDecayIndex}
          sustainValue={preset.values.EffectEnvelopeSustainLevel}
          releaseValue={preset.values.EffectEnvelopeReleaseIndex}
          onTargetChange={(value) => updateValue("EffectEnvelopeTarget", value)}
          onAmountChange={(value) => updateValue("EffectEnvelopeAmount", value)}
          onAttackChange={(value) => updateValue("EffectEnvelopeAttackIndex", value)}
          onHoldChange={(value) => updateValue("EffectEnvelopeHoldIndex", value)}
          onDecayChange={(value) => updateValue("EffectEnvelopeDecayIndex", value)}
          onSustainChange={(value) => updateValue("EffectEnvelopeSustainLevel", value)}
          onReleaseChange={(value) => updateValue("EffectEnvelopeReleaseIndex", value)}
        />

        <FxEnvelopeEditor
          title="FX Env 2 AHDSR"
          targetValue={preset.values.EffectEnvelope2Target}
          amountValue={preset.values.EffectEnvelope2Amount}
          attackValue={preset.values.EffectEnvelope2AttackIndex}
          holdValue={preset.values.EffectEnvelope2HoldIndex}
          decayValue={preset.values.EffectEnvelope2DecayIndex}
          sustainValue={preset.values.EffectEnvelope2SustainLevel}
          releaseValue={preset.values.EffectEnvelope2ReleaseIndex}
          onTargetChange={(value) => updateValue("EffectEnvelope2Target", value)}
          onAmountChange={(value) => updateValue("EffectEnvelope2Amount", value)}
          onAttackChange={(value) => updateValue("EffectEnvelope2AttackIndex", value)}
          onHoldChange={(value) => updateValue("EffectEnvelope2HoldIndex", value)}
          onDecayChange={(value) => updateValue("EffectEnvelope2DecayIndex", value)}
          onSustainChange={(value) => updateValue("EffectEnvelope2SustainLevel", value)}
          onReleaseChange={(value) => updateValue("EffectEnvelope2ReleaseIndex", value)}
        />

        <section className="editorSection">
          <h3>LFO</h3>
          <div className="editorGrid">
            <SelectField label="Target" value={preset.values.SynthLfoTarget} options={modTargetOptions} onChange={(value) => updateValue("SynthLfoTarget", value)} />
            <RangeField label="Amount" value={fxAmountByteToPercent(preset.values.SynthLfoAmount)} min={-100} max={100} onChange={(value) => updateValue("SynthLfoAmount", fxAmountPercentToByte(value))} suffix="%" />
            <SelectField label="Wave" value={preset.values.SynthLfoWave} options={lfoWaveOptions} onChange={(value) => updateValue("SynthLfoWave", value)} />
            <RangeField label="Speed" value={preset.values.SynthLfoSpeed} min={0} max={19} onChange={(value) => updateValue("SynthLfoSpeed", value)} suffix={` (${lfoSpeedLabel(preset.values.SynthLfoSpeed)})`} />
          </div>
        </section>

        <pre className="dataPreview">
{`Frames on last send: ${lastFrameCount}
Preset body: ${formatByteLength(draftPreset.body)}
CRC: ${crc32(draftPreset.body).toString(16).toUpperCase()}

${formatHex(draftPreset.body)}`}
        </pre>
      </div>
    </section>
  );
}

interface LibrarySpacePanelProps {
  title: string;
  subtitle: string;
  space: LibrarySpace;
  presets: EditableSynthPreset[];
  folders: string[];
  selectedFolder: string | null;
  draggedPreset: DraggedPreset | null;
  onAllowDrop: (event: DragEvent<HTMLElement>) => void;
  onDrop: (space: LibrarySpace, folderPath?: string) => void;
  onFolderSelect: (space: LibrarySpace, folderPath: string) => void;
  onDragStart: (space: LibrarySpace, objectIdHex: string, event: DragEvent<HTMLLIElement>) => void;
  onDragEnd: () => void;
  onOpen: (space: LibrarySpace, preset: EditableSynthPreset) => void;
  onUpload: (preset: EditableSynthPreset) => void;
  onDownload: (preset: EditableSynthPreset) => void;
  onExport: (preset: EditableSynthPreset) => void;
  onErase: (space: LibrarySpace, preset: EditableSynthPreset) => void;
}

function LibrarySpacePanel({
  title,
  subtitle,
  space,
  presets,
  folders,
  selectedFolder,
  draggedPreset,
  onAllowDrop,
  onDrop,
  onFolderSelect,
  onDragStart,
  onDragEnd,
  onOpen,
  onUpload,
  onDownload,
  onExport,
  onErase
}: LibrarySpacePanelProps) {
  const isDropTarget = draggedPreset !== null;
  const visiblePresets = selectedFolder
    ? presets.filter((preset) => preset.folderPath === selectedFolder)
    : presets;

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
        <span className="countBadge">{visiblePresets.length}</span>
      </div>

      <div className="folderTargets">
        {folders.map((folder) => (
          <button
            className={folder === selectedFolder ? "folderTarget active" : "folderTarget"}
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
      </div>

      <ul className="list">
        {visiblePresets.length === 0 ? (
          <li className="emptyListItem">{selectedFolder ? `No presets in ${folderLabel(selectedFolder)}` : "No presets"}</li>
        ) : (
          visiblePresets.map((item) => (
            <li
              className="listItem presetListItem"
              draggable
              key={`${space}-${item.objectIdHex}`}
              onDragStart={(event) => onDragStart(space, item.objectIdHex, event)}
              onDragEnd={onDragEnd}
            >
              <div className="presetMeta">
                <strong>{item.name}</strong>
                <span>{item.folderPath}</span>
                <span>{item.objectIdHex.slice(0, 8).toUpperCase()}</span>
              </div>
              <div className="presetActions">
                <button type="button" onClick={() => onOpen(space, item)}>
                  Open
                </button>
                {space === "computer" ? (
                  <button type="button" onClick={() => onUpload(item)}>
                    Upload
                  </button>
                ) : (
                  <button type="button" onClick={() => onDownload(item)}>
                    Download
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

interface WavetableLibraryPanelProps {
  title: string;
  subtitle: string;
  space: LibrarySpace;
  wavetables: EditableSynthWavetable[];
  folders: string[];
  selectedFolder: string | null;
  onFolderSelect: (space: LibrarySpace, folderPath: string) => void;
  onUse: (wavetable: EditableSynthWavetable) => void;
  onUpload: (wavetable: EditableSynthWavetable) => void;
  onDownload: (wavetable: EditableSynthWavetable) => void;
  onExport: (wavetable: EditableSynthWavetable) => void;
  onEdit: (wavetable: EditableSynthWavetable) => void;
  onErase: (space: LibrarySpace, wavetable: EditableSynthWavetable) => void;
}

function WavetableLibraryPanel({
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
  const visibleFolders = folders.filter((folder) => wavetables.some((wavetable) => wavetable.folderPath === folder) || folder === selectedFolder);

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
        {visibleFolders.map((folder) => (
          <button
            className={folder === selectedFolder ? "folderTarget active" : "folderTarget"}
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
          <li className="emptyListItem">{selectedFolder ? `No wavetables in ${folderLabel(selectedFolder)}` : "No wavetables"}</li>
        ) : (
          visibleWavetables.map((item) => (
            <li className="listItem presetListItem" key={`${space}-wavetable-${item.objectIdHex}`}>
              <div className="presetMeta">
                <strong>{item.name}</strong>
                <span>{item.folderPath}</span>
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
                  <button type="button" onClick={() => onUpload(item)}>
                    Upload
                  </button>
                ) : (
                  <button type="button" onClick={() => onDownload(item)}>
                    Download
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

interface SelectFieldProps {
  label: string;
  value: number;
  options: Array<{ label: string; value: number }>;
  onChange: (value: number) => void;
}

function SelectField({ label, value, options, onChange }: SelectFieldProps) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(Number(event.target.value))}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

interface RangeFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (value: number) => void;
}

function RangeField({ label, value, min, max, suffix = "", onChange }: RangeFieldProps) {
  return (
    <label className="field rangeField">
      <span>
        {label}: {value}{suffix}
      </span>
      <input min={min} max={max} type="range" value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

interface FxEnvelopeEditorProps {
  title: string;
  targetValue: number;
  amountValue: number;
  attackValue: number;
  holdValue: number;
  decayValue: number;
  sustainValue: number;
  releaseValue: number;
  onTargetChange: (value: number) => void;
  onAmountChange: (value: number) => void;
  onAttackChange: (value: number) => void;
  onHoldChange: (value: number) => void;
  onDecayChange: (value: number) => void;
  onSustainChange: (value: number) => void;
  onReleaseChange: (value: number) => void;
}

function FxEnvelopeEditor({
  title,
  targetValue,
  amountValue,
  attackValue,
  holdValue,
  decayValue,
  sustainValue,
  releaseValue,
  onTargetChange,
  onAmountChange,
  onAttackChange,
  onHoldChange,
  onDecayChange,
  onSustainChange,
  onReleaseChange
}: FxEnvelopeEditorProps) {
  const amountPercent = fxAmountByteToPercent(amountValue);

  return (
    <section className="editorSection">
      <h3>{title}</h3>
      <div className="editorGrid">
        <SelectField label="Target" value={targetValue} options={modTargetOptions} onChange={onTargetChange} />
        <RangeField label="Amount" value={amountPercent} min={-100} max={100} onChange={(value) => onAmountChange(fxAmountPercentToByte(value))} suffix="%" />
        <RangeField label="Attack" value={attackValue} min={0} max={19} onChange={onAttackChange} suffix={` (${envelopeTimeLabel(attackValue)})`} />
        <RangeField label="Hold" value={holdValue} min={0} max={19} onChange={onHoldChange} suffix={` (${envelopeTimeLabel(holdValue)})`} />
        <RangeField label="Decay" value={decayValue} min={0} max={19} onChange={onDecayChange} suffix={` (${envelopeTimeLabel(decayValue)})`} />
        <RangeField label="Sustain" value={sustainValue} min={0} max={127} onChange={onSustainChange} suffix="/127" />
        <RangeField label="Release" value={releaseValue} min={0} max={19} onChange={onReleaseChange} suffix={` (${envelopeTimeLabel(releaseValue)})`} />
      </div>
    </section>
  );
}
