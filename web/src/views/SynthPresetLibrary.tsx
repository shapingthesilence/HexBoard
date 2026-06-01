import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import {
  createSynthPresetObject,
  deterministicObjectId,
  objectIdFromHex,
  objectIdToHex,
  SynthPresetTlv,
  SynthSettingKey,
  type SynthPresetValues,
  type SynthSettingName
} from "../catalogs/index.ts";
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

const synthValueKeys = [
  "PlaybackMode",
  "Waveform",
  "SynthDrive",
  "SynthModTarget",
  "SynthModAmount",
  "SynthVibratoSpeed",
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
  "EffectEnvelope2ReleaseIndex"
] as const satisfies readonly SynthSettingName[];

type EditableSynthValueKey = (typeof synthValueKeys)[number];
type EditableSynthValues = Record<EditableSynthValueKey, number>;

interface EditableSynthPreset {
  objectIdHex: string;
  deviceHandle?: number;
  name: string;
  folderPath: string;
  favorite: boolean;
  values: EditableSynthValues;
}

interface DraggedPreset {
  space: LibrarySpace;
  objectIdHex: string;
}

const computerLibraryStorageKey = "hexboard.synthPresetComputerLibrary.v1";
const presetFileFormat = "hexboard.synthPreset.v1";

const defaultPreset: EditableSynthPreset = {
  objectIdHex: objectIdToHex(deterministicObjectId("Soft String Pad")),
  name: "Soft String Pad",
  folderPath: "Pads/Warm",
  favorite: true,
  values: {
    PlaybackMode: 3,
    Waveform: 1,
    SynthDrive: 0,
    SynthModTarget: 0,
    SynthModAmount: 127,
    SynthVibratoSpeed: 5,
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
    EffectEnvelope2ReleaseIndex: 0
  }
};

const initialComputerPresets: EditableSynthPreset[] = [
  defaultPreset,
  {
    objectIdHex: objectIdToHex(deterministicObjectId("Bright Mono Lead")),
    name: "Bright Mono Lead",
    folderPath: "Leads",
    favorite: false,
    values: {
      ...defaultPreset.values,
      PlaybackMode: 1,
      Waveform: 9,
      SynthDrive: 2,
      SynthModTarget: 2,
      SynthModAmount: 100,
      SynthVibratoSpeed: 4,
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

const playbackOptions = [
  { label: "Off", value: 0 },
  { label: "Mono", value: 1 },
  { label: "Arp'gio", value: 2 },
  { label: "Poly", value: 3 }
];

const waveformOptions = [
  { label: "Hybrid", value: 7 },
  { label: "Square", value: 8 },
  { label: "Saw", value: 9 },
  { label: "Triangle", value: 10 },
  { label: "Sine", value: 0 },
  { label: "Strings", value: 1 },
  { label: "Clarinet", value: 2 },
  { label: "MP", value: 11 },
  { label: "BoxSaw", value: 12 },
  { label: "Friendly Square", value: 13 },
  { label: "Glassy", value: 14 },
  { label: "Koolaid", value: 15 },
  { label: "Merv", value: 16 },
  { label: "mBellish", value: 17 },
  { label: "Oval", value: 18 },
  { label: "Pretty Shape", value: 19 },
  { label: "Quick 808", value: 20 },
  { label: "Rich Repeater", value: 21 },
  { label: "Rounded Triangle", value: 22 },
  { label: "Stardew", value: 23 },
  { label: "Sync The Titanic", value: 24 },
  { label: "Weird Wizard", value: 25 },
  { label: "Woo", value: 26 }
];

const driveOptions = [
  { label: "Off", value: 0 },
  { label: "Warm", value: 1 },
  { label: "Edge", value: 2 },
  { label: "Dirty", value: 3 }
];

const modTargetOptions = [
  { label: "Tone", value: 0 },
  { label: "Vibrato", value: 1 },
  { label: "Pitch", value: 2 }
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
  PlaybackMode: [0, 3],
  Waveform: [0, 26],
  SynthDrive: [0, 3],
  SynthModTarget: [0, 2],
  SynthModAmount: [0, 127],
  SynthVibratoSpeed: [0, 11],
  EnvelopeAttackIndex: [0, 19],
  EnvelopeHoldIndex: [0, 19],
  EnvelopeDecayIndex: [0, 19],
  EnvelopeSustainLevel: [0, 127],
  EnvelopeReleaseIndex: [0, 19],
  EffectEnvelopeTarget: [0, 2],
  EffectEnvelopeAmount: [0, 254],
  EffectEnvelopeAttackIndex: [0, 19],
  EffectEnvelopeHoldIndex: [0, 19],
  EffectEnvelopeDecayIndex: [0, 19],
  EffectEnvelopeSustainLevel: [0, 127],
  EffectEnvelopeReleaseIndex: [0, 19],
  EffectEnvelope2Target: [0, 2],
  EffectEnvelope2Amount: [0, 254],
  EffectEnvelope2AttackIndex: [0, 19],
  EffectEnvelope2HoldIndex: [0, 19],
  EffectEnvelope2DecayIndex: [0, 19],
  EffectEnvelope2SustainLevel: [0, 127],
  EffectEnvelope2ReleaseIndex: [0, 19]
};

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}

function clampSynthValue(key: EditableSynthValueKey, value: number): number {
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

function folderLabel(folderPath: string): string {
  return folderPath === rootFolderPath ? "Root" : folderPath;
}

function normalizeDisplayFolderPath(folderPath: string): string {
  return folderPath.trim() || rootFolderPath;
}

function normalizedPresetName(name: string): string {
  return name.trim() || "Untitled";
}

function presetSaveKey(preset: EditableSynthPreset): string {
  return `${normalizeDisplayFolderPath(preset.folderPath).toLocaleLowerCase()}\u0000${normalizedPresetName(preset.name).toLocaleLowerCase()}`;
}

function findPresetByFolderAndName(presets: EditableSynthPreset[], preset: EditableSynthPreset): EditableSynthPreset | undefined {
  const saveKey = presetSaveKey(preset);
  return presets.find((candidate) => presetSaveKey(candidate) === saveKey);
}

function freshPresetObjectIdHex(preset: EditableSynthPreset): string {
  const nonce = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}:${Math.random()}`;
  return objectIdToHex(deterministicObjectId(`synth:${preset.folderPath}:${preset.name}:${nonce}`));
}

function normalizedPresetForSave(preset: EditableSynthPreset): EditableSynthPreset {
  return {
    ...clonePreset(preset),
    name: normalizedPresetName(preset.name),
    folderPath: normalizeDisplayFolderPath(preset.folderPath)
  };
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

function comparePresets(left: EditableSynthPreset, right: EditableSynthPreset): number {
  return `${left.folderPath}/${left.name}`.localeCompare(`${right.folderPath}/${right.name}`);
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

function encodeEditablePreset(preset: EditableSynthPreset) {
  return createSynthPresetObject({
    objectId: objectIdFromHex(preset.objectIdHex),
    name: preset.name.trim() || "Untitled",
    folderPath: encodeDeviceFolderPath(preset.folderPath),
    favorite: preset.favorite,
    values: preset.values
  });
}

function exportPreset(preset: EditableSynthPreset) {
  return {
    objectId: preset.objectIdHex,
    name: preset.name,
    folderPath: preset.folderPath,
    favorite: preset.favorite,
    values: preset.values satisfies SynthPresetValues
  };
}

function presetFromUnknown(value: unknown): EditableSynthPreset {
  const source = isRecord(value) && value.format === presetFileFormat ? value.preset : value;
  if (!isRecord(source)) {
    throw new Error("Preset file does not contain a synth preset object");
  }

  const name = typeof source.name === "string" && source.name.trim() ? source.name.trim() : "Imported Preset";
  const folderPath = typeof source.folderPath === "string" && source.folderPath.trim() ? normalizeDisplayFolderPath(source.folderPath) : rootFolderPath;
  const importedValues = isRecord(source.values) ? source.values : {};
  const values = { ...defaultPreset.values };

  for (const key of synthValueKeys) {
    const rawValue = importedValues[key];
    if (typeof rawValue === "number") {
      values[key] = clampSynthValue(key, rawValue);
    }
  }

  return {
    objectIdHex: normalizeObjectIdHex(source.objectId, `synth:${folderPath}:${name}:${Date.now()}`),
    name,
    folderPath,
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
    } else if (record.tag === SynthPresetTlv.SynthValues) {
      for (let index = 0; index + 1 < record.value.length; index += 2) {
        const setting = Object.entries(SynthSettingKey).find(([, value]) => value === record.value[index])?.[0] as EditableSynthValueKey | undefined;
        if (setting && synthValueKeys.includes(setting)) {
          values[setting] = clampSynthValue(setting, record.value[index + 1]);
        }
      }
    }
  }

  return {
    objectIdHex,
    deviceHandle,
    name,
    folderPath,
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
    favorite: (record.flags & 0x02) !== 0,
    values: { ...defaultPreset.values }
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

function safeFileName(value: string): string {
  const sanitized = value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "");
  return sanitized || "hexboard-synth-preset";
}

function librarySpaceLabel(space: LibrarySpace): string {
  return space === "computer" ? "Computer Library" : "HexBoard Library";
}

export function SynthPresetLibrary({ transport }: SynthPresetLibraryProps) {
  const [computerPresets, setComputerPresets] = useState(loadComputerPresets);
  const [hexboardPresets, setHexboardPresets] = useState<EditableSynthPreset[]>([]);
  const [preset, setPreset] = useState<EditableSynthPreset>(() => clonePreset(defaultPreset));
  const [openedSource, setOpenedSource] = useState<LibrarySpace>("computer");
  const [customFolders, setCustomFolders] = useState(defaultFolders);
  const [newFolder, setNewFolder] = useState("");
  const [autoSend, setAutoSend] = useState(true);
  const [editorHydrated, setEditorHydrated] = useState(() => transport instanceof MockMidiTransport);
  const [syncStatus, setSyncStatus] = useState("Ready");
  const [lastFrameCount, setLastFrameCount] = useState(0);
  const [draggedPreset, setDraggedPreset] = useState<DraggedPreset | null>(null);
  const [folderFilters, setFolderFilters] = useState<Record<LibrarySpace, string | null>>({
    computer: null,
    hexboard: null
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const skipNextAutoSend = useRef(true);

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
  const draftPreset = useMemo(() => encodeEditablePreset(preset), [preset]);

  useEffect(() => {
    saveComputerPresets(computerPresets);
  }, [computerPresets]);

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
      void sendPreview("Auto-sent");
    }, 120);

    return () => window.clearTimeout(timeout);
  }, [autoSend, draftPreset, editorHydrated]);

  function updateValue(key: EditableSynthValueKey, value: number) {
    skipNextAutoSend.current = false;
    setEditorHydrated(true);
    setPreset((current) => ({
      ...current,
      values: {
        ...current.values,
        [key]: clampSynthValue(key, value)
      }
    }));
  }

  function updatePresetMetadata(update: (current: EditableSynthPreset) => EditableSynthPreset) {
    skipNextAutoSend.current = false;
    setEditorHydrated(true);
    setPreset(update);
  }

  function addFolder() {
    const folder = newFolder.trim();
    if (!folder) {
      return;
    }
    skipNextAutoSend.current = false;
    setEditorHydrated(true);
    setCustomFolders((current) => Array.from(new Set([...current, folder])).sort());
    setPreset((current) => ({ ...current, folderPath: folder }));
    setNewFolder("");
  }

  function openPreset(source: LibrarySpace, nextPreset: EditableSynthPreset) {
    const selectedPreset = clonePreset(nextPreset);
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
            <button type="button" onClick={() => void refreshHexBoardLibrary()}>
              Refresh HexBoard
            </button>
            <button type="button" onClick={() => fileInputRef.current?.click()}>
              Import File
            </button>
          </div>
        </div>
        <input ref={fileInputRef} className="hiddenFileInput" type="file" accept="application/json,.json" onChange={(event) => void importPresetFile(event)} />

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
            <SelectField label="Waveform" value={preset.values.Waveform} options={waveformOptions} onChange={(value) => updateValue("Waveform", value)} />
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
