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

describe("Classic sampler sounds in Sync", () => {
  it("keeps a sound and its instrument together in a .hexsound file", async () => {
    const { decodeHexSound, encodeHexSound, hexSoundTitle } = await import("./hexSound.ts");
    const sound = createSynthPresetObject({ objectId, name: "Felt Keys", folderPath: "Keys", values: {}, sampler: { name: "Felt Piano", envelopeOverride: 0 } });
    const instrument = new Uint8Array([0x48, 0x42, 0x43, 0x31, 1, 2, 3]);
    const file = encodeHexSound(sound.body, instrument);
    // Header: magic, then the preset body length (little endian).
    expect(Array.from(file.slice(0, 6))).toEqual([0x48, 0x58, 0x53, 0x31, sound.body.length & 0xff, sound.body.length >> 8]);
    const decoded = decodeHexSound(file);
    expect(decoded.presetBody).toEqual(sound.body);
    expect(decoded.instrument).toEqual(instrument);
    expect(hexSoundTitle(decoded.presetBody)).toEqual({ name: "Felt Keys", folderPath: "Keys" });
    expect(() => decodeHexSound(file.slice(0, 6 + sound.body.length))).toThrow("incomplete");
    expect(() => decodeHexSound(new Uint8Array([1, 2, 3, 4, 5, 6, 7]))).toThrow("Not a HexBoard sound file");
  });

  it("shows Inst for stages that follow the instrument and no wavetable controls", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { ClassicSamplerSoundEditor } = await import("../views/classicSynth/ClassicSamplerSoundEditor.tsx");
    const [preset] = presetsFromUnknown({ name: "Felt Keys", folderPath: "Keys", values: {}, sampler: { name: "Felt Piano", envelopeOverride: 0b00001 } });
    const html = renderToStaticMarkup(createElement(ClassicSamplerSoundEditor, {
      values: preset.values, onChange: () => {}, instrumentName: "Felt Piano", onEditInstrument: () => {},
      envelopeOverride: 0b00001, onEnvelopeOverrideChange: () => {}, modWheel: 0
    }));
    expect(html).toContain("Felt Piano");
    expect(html).toContain("Edit instrument");
    // Attack is replaced; hold, decay, sustain and release follow the instrument.
    expect(html.match(/<output>Inst<\/output>/g)?.length).toBe(4);
    for (const hidden of ["Wavetable", "Motion sources", "LFO"]) expect(html).not.toContain(hidden);
    for (const shown of ["Amp envelope", "Vibrato", "Wheel amount", "Drive", "Synth mode"]) expect(html).toContain(shown);
  });
});
