import { useEffect, useMemo, useRef, useState } from "react";
import {
  createSynthPresetCatalog,
  createSynthPresetObject,
  deterministicObjectId,
  sampleSynthCatalog,
  type SynthPresetValues
} from "../catalogs/index.ts";
import { MockMidiTransport } from "../midi/mockTransport.ts";
import { PresetSyncClient } from "../midi/presetSyncClient.ts";
import type { MidiTransport } from "../midi/types.ts";
import { crc32 } from "../protocol/crc32.ts";
import { formatByteLength, formatHex } from "./format.ts";

interface SynthPresetLibraryProps {
  transport: MidiTransport;
}

interface EditableSynthPreset {
  name: string;
  folderPath: string;
  category: string;
  favorite: boolean;
  values: Required<Pick<
    SynthPresetValues,
    | "PlaybackMode"
    | "Waveform"
    | "SynthDrive"
    | "SynthModTarget"
    | "SynthModAmount"
    | "SynthVibratoSpeed"
    | "EnvelopeAttackIndex"
    | "EnvelopeHoldIndex"
    | "EnvelopeDecayIndex"
    | "EnvelopeSustainLevel"
    | "EnvelopeReleaseIndex"
    | "EffectEnvelopeTarget"
    | "EffectEnvelopeAmount"
    | "EffectEnvelopeAttackIndex"
    | "EffectEnvelopeHoldIndex"
    | "EffectEnvelopeDecayIndex"
    | "EffectEnvelopeSustainLevel"
    | "EffectEnvelopeReleaseIndex"
    | "EffectEnvelope2Target"
    | "EffectEnvelope2Amount"
    | "EffectEnvelope2AttackIndex"
    | "EffectEnvelope2HoldIndex"
    | "EffectEnvelope2DecayIndex"
    | "EffectEnvelope2SustainLevel"
    | "EffectEnvelope2ReleaseIndex"
  >>;
}

const defaultPreset: EditableSynthPreset = {
  name: "Soft String Pad",
  folderPath: "Pads/Warm",
  category: "Pad",
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

function clampByte(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(255, Math.round(value)));
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
  if (clamped === 0) {
    return 127;
  }
  if (clamped > 0) {
    return Math.round(127 + (clamped / 100) * 127);
  }
  return Math.round(127 + (clamped / 100) * 127);
}

export function SynthPresetLibrary({ transport }: SynthPresetLibraryProps) {
  const [preset, setPreset] = useState<EditableSynthPreset>(defaultPreset);
  const [folders, setFolders] = useState(() => Array.from(new Set(["Pads/Warm", "Leads", ...sampleSynthCatalog.folders])).sort());
  const [newFolder, setNewFolder] = useState("");
  const [autoSend, setAutoSend] = useState(true);
  const [syncStatus, setSyncStatus] = useState("Ready");
  const [lastFrameCount, setLastFrameCount] = useState(0);
  const firstRender = useRef(true);

  const client = useMemo(() => new PresetSyncClient(transport), [transport]);
  const draftPreset = useMemo(
    () =>
      createSynthPresetObject({
        objectId: deterministicObjectId(`synth:${preset.folderPath}:${preset.name}`),
        name: preset.name.trim() || "Untitled",
        folderPath: preset.folderPath.trim() || "Unfiled",
        category: preset.category.trim() || undefined,
        favorite: preset.favorite,
        values: preset.values
      }),
    [preset]
  );

  const catalog = useMemo(
    () => createSynthPresetCatalog([...sampleSynthCatalog.presets, draftPreset]),
    [draftPreset]
  );

  const visiblePresets = catalog.presets.filter((candidate) => candidate.folderPath === preset.folderPath);

  useEffect(() => {
    if (!autoSend) {
      return;
    }
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }

    const timeout = window.setTimeout(() => {
      void sendPreview("Auto-sent");
    }, 120);

    return () => window.clearTimeout(timeout);
  }, [autoSend, draftPreset]);

  function updateValue(key: keyof EditableSynthPreset["values"], value: number) {
    setPreset((current) => ({
      ...current,
      values: {
        ...current.values,
        [key]: clampByte(value)
      }
    }));
  }

  function addFolder() {
    const folder = newFolder.trim();
    if (!folder) {
      return;
    }
    setFolders((current) => Array.from(new Set([...current, folder])).sort());
    setPreset((current) => ({ ...current, folderPath: folder }));
    setNewFolder("");
  }

  async function sendPreview(prefix = "Sent") {
    try {
      const frames = await client.sendSynthPresetPreview(draftPreset);
      setLastFrameCount(frames.length);
      setSyncStatus(`${prefix} ${frames.length} frame${frames.length === 1 ? "" : "s"} to ${transport.label}`);
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : "Failed to send synth preset");
    }
  }

  async function savePreset() {
    try {
      const frames = await client.sendSynthPresetSave(draftPreset);
      setLastFrameCount(frames.length);
      setSyncStatus(`Save sync sent ${frames.length} frame${frames.length === 1 ? "" : "s"} to ${transport.label}`);
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : "Failed to save synth preset");
    }
  }

  return (
    <section className="workspace synthEditor">
      <aside className="panel stack">
        <h2>Synth Library</h2>
        <label className="field">
          <span>Folder</span>
          <select
            value={preset.folderPath}
            onChange={(event) => setPreset((current) => ({ ...current, folderPath: event.target.value }))}
          >
            {folders.map((folder) => (
              <option key={folder} value={folder}>
                {folder}
              </option>
            ))}
          </select>
        </label>
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
        <ul className="list">
          {folders.map((folder) => (
            <li className="listItem" key={folder}>
              <button
                className={folder === preset.folderPath ? "primary" : ""}
                type="button"
                onClick={() => setPreset((current) => ({ ...current, folderPath: folder }))}
              >
                {folder}
              </button>
              <span>{catalog.presets.filter((candidate) => candidate.folderPath === folder).length}</span>
            </li>
          ))}
        </ul>
      </aside>

      <div className="panel stack">
        <div className="row between">
          <h2>Synth Preset Editor</h2>
          <div className="row">
            <label className="checkField">
              <input checked={autoSend} type="checkbox" onChange={(event) => setAutoSend(event.target.checked)} />
              <span>Live send</span>
            </label>
            <button className="primary" type="button" onClick={() => void sendPreview("Sent")}>
              Send Now
            </button>
            <button type="button" onClick={() => void savePreset()}>
              Save to HexBoard
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
            <input value={preset.name} onChange={(event) => setPreset((current) => ({ ...current, name: event.target.value }))} />
          </label>
          <label className="field">
            <span>Category</span>
            <input
              value={preset.category}
              onChange={(event) => setPreset((current) => ({ ...current, category: event.target.value }))}
            />
          </label>
          <label className="field">
            <span>Favorite</span>
            <select
              value={preset.favorite ? "yes" : "no"}
              onChange={(event) => setPreset((current) => ({ ...current, favorite: event.target.value === "yes" }))}
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

        <h3>Current Folder</h3>
        <ul className="list">
          {visiblePresets.map((candidate) => (
            <li className="listItem" key={`${candidate.folderPath}/${candidate.name}`}>
              <div>
                <strong>{candidate.name}</strong>
                <span>
                  {formatByteLength(candidate.body)} CRC {crc32(candidate.body).toString(16).toUpperCase()}
                </span>
              </div>
              <span>{candidate.folderPath}</span>
            </li>
          ))}
        </ul>

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
