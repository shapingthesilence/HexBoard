import { describe, expect, it } from "vitest";
import { decodeObjectBody } from "../protocol/tlv.ts";
import { createSynthPresetObject, SynthPresetTlv } from "./synthPresets.ts";
import { presetsFromUnknown } from "../views/SynthPresetLibrary.tsx";

const objectId = new Uint8Array(16).fill(7);

describe("Classic sampler presets", () => {
  it("encodes the instrument name and envelope mask only for sampler presets", () => {
    const sampler = createSynthPresetObject({
      objectId, name: "Felt Keys", folderPath: "Keys", values: {},
      sampler: { name: "Felt Piano", envelopeOverride: 0b110001 }
    });
    const records = decodeObjectBody(sampler.body).records;
    const name = records.find((record) => record.tag === SynthPresetTlv.SamplerName);
    const mask = records.find((record) => record.tag === SynthPresetTlv.SamplerEnvelopeOverride);
    expect(new TextDecoder().decode(name?.value)).toBe("Felt Piano");
    expect(Array.from(mask?.value ?? [])).toEqual([0b10001]);  // only the five stage bits

    const wavetable = createSynthPresetObject({ objectId, name: "Pad", folderPath: "Pads", values: {} });
    expect(decodeObjectBody(wavetable.body).records.some((record) => record.tag === SynthPresetTlv.SamplerName)).toBe(false);
  });

  it("keeps the sampler reference through JSON import", () => {
    const [preset] = presetsFromUnknown({
      name: "Felt Keys", folderPath: "Keys", values: {},
      sampler: { name: "Felt Piano", envelopeOverride: 3 }
    });
    expect(preset.sampler).toEqual({ name: "Felt Piano", envelopeOverride: 3 });
    const [plain] = presetsFromUnknown({ name: "Pad", folderPath: "Pads", values: {} });
    expect(plain.sampler).toBeUndefined();
  });
});
