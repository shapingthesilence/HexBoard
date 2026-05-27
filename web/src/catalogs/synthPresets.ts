import { ObjectType } from "../protocol/constants.ts";
import {
  createCommonRecords,
  encodeObjectBody,
  tlv,
  tlvText,
  tlvU8,
  type TlvRecord
} from "../protocol/tlv.ts";
import type { EncodedCatalogObject, SynthPresetCatalog } from "./types.ts";

export const SynthPresetTlv = {
  SynthPresetSchemaVersion: 0x20,
  SynthValues: 0x21,
  Category: 0x22,
  Favorite: 0x23,
  LastModifiedUnixTime: 0x24
} as const;

export const SynthSettingKey = {
  PlaybackMode: 27,
  Waveform: 28,
  SynthDrive: 48,
  SynthModTarget: 49,
  SynthModAmount: 70,
  SynthVibratoSpeed: 50,
  ArpeggiatorDivision: 30,
  SynthBPM: 31,
  EnvelopeAttackIndex: 42,
  EnvelopeHoldIndex: 67,
  EnvelopeDecayIndex: 43,
  EnvelopeSustainLevel: 44,
  EnvelopeReleaseIndex: 45,
  EffectEnvelopeTarget: 58,
  EffectEnvelopeAmount: 59,
  EffectEnvelopeAttackIndex: 53,
  EffectEnvelopeHoldIndex: 68,
  EffectEnvelopeDecayIndex: 54,
  EffectEnvelopeSustainLevel: 55,
  EffectEnvelopeReleaseIndex: 56,
  EffectEnvelope2Target: 60,
  EffectEnvelope2Amount: 61,
  EffectEnvelope2AttackIndex: 62,
  EffectEnvelope2HoldIndex: 69,
  EffectEnvelope2DecayIndex: 63,
  EffectEnvelope2SustainLevel: 64,
  EffectEnvelope2ReleaseIndex: 65
} as const;

export type SynthSettingName = keyof typeof SynthSettingKey;
export type SynthPresetValues = Partial<Record<SynthSettingName, number>>;

export interface SynthPresetInput {
  objectId: Uint8Array;
  name: string;
  folderPath: string;
  values: SynthPresetValues;
  category?: string;
  favorite?: boolean;
  tags?: string[];
}

export function encodeSynthValues(values: SynthPresetValues): Uint8Array {
  const bytes: number[] = [];
  for (const [name, value] of Object.entries(values) as Array<[SynthSettingName, number]>) {
    if (value < 0 || value > 255 || !Number.isInteger(value)) {
      throw new RangeError(`${name} must be a byte`);
    }
    bytes.push(SynthSettingKey[name], value);
  }
  return new Uint8Array(bytes);
}

export function createSynthPresetObject(input: SynthPresetInput): EncodedCatalogObject {
  const records: TlvRecord[] = [
    ...createCommonRecords({
      objectId: input.objectId,
      name: input.name,
      source: "web-app",
      folderPath: input.folderPath,
      tags: input.tags
    }),
    tlvU8(SynthPresetTlv.SynthPresetSchemaVersion, 3),
    tlv(SynthPresetTlv.SynthValues, encodeSynthValues(input.values))
  ];

  if (input.category) {
    records.push(tlvText(SynthPresetTlv.Category, input.category));
  }
  if (input.favorite !== undefined) {
    records.push(tlvU8(SynthPresetTlv.Favorite, input.favorite ? 1 : 0));
  }

  const body = encodeObjectBody({
    objectType: ObjectType.SynthPreset,
    schemaMajor: 1,
    schemaMinor: 0,
    objectFlags: 0,
    records
  });

  return {
    objectType: ObjectType.SynthPreset,
    schemaMajor: 1,
    schemaMinor: 0,
    objectId: input.objectId,
    name: input.name,
    folderPath: input.folderPath,
    records,
    body
  };
}

export function createSynthPresetCatalog(presets: EncodedCatalogObject[]): SynthPresetCatalog {
  const folders = Array.from(new Set(presets.map((preset) => preset.folderPath ?? "").filter(Boolean))).sort();
  return { presets, folders };
}

