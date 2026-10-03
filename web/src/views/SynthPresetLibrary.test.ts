import { afterEach, describe, expect, it, vi } from "vitest";
import { deterministicObjectId, objectIdToHex } from "../catalogs/index.ts";
import { loadComputerWavetables, wheelAmountByteToPercent, wheelAmountPercentToByte, filterLibraryPresets, mergePresetBatch, presetsFromUnknown } from "./SynthPresetLibrary.tsx";

function presetRecord(id: string, name: string, folderPath: string) {
  return {
    objectId: objectIdToHex(deterministicObjectId(id)),
    name,
    folderPath,
    values: { PlaybackMode: 0, Waveform: 1 }
  };
}

describe("synth preset batch files", () => {
  it("imports a multi-preset library file", () => {
    const presets = presetsFromUnknown({
      format: "hexboard.synthPresetLibrary.v1",
      presets: [
        presetRecord("one", "One", "Pads"),
        presetRecord("two", "Two", "Leads")
      ]
    });

    expect(presets.map((preset) => `${preset.folderPath}/${preset.name}`)).toEqual([
      "Pads/One",
      "Leads/Two"
    ]);
  });

  it("replaces an occupied destination once instead of creating a duplicate", () => {
    const [existing] = presetsFromUnknown(presetRecord("existing", "Warm", "Pads"));
    const [incoming] = presetsFromUnknown(presetRecord("incoming", "Warm", "Pads"));

    const merged = mergePresetBatch([existing], [incoming]);

    expect(merged.conflicts.map((preset) => preset.objectIdHex)).toEqual([existing.objectIdHex]);
    expect(merged.presets).toHaveLength(1);
    expect(merged.presets[0].objectIdHex).toBe(existing.objectIdHex);
  });
});

describe("synth preset library filtering", () => {
  const presets = presetsFromUnknown({
    format: "hexboard.synthPresetLibrary.v1",
    presets: [
      presetRecord("warm-pad", "Warm Pad", "Pads"),
      presetRecord("bright-lead", "Bright Lead", "Leads"),
      presetRecord("soft-lead", "Soft Voice", "Leads")
    ]
  });

  it("searches preset names without regard to case", () => {
    expect(filterLibraryPresets(presets, null, "WARM").map((preset) => preset.name)).toEqual(["Warm Pad"]);
  });

  it("searches folder names and respects the active folder", () => {
    expect(filterLibraryPresets(presets, null, "leads").map((preset) => preset.name)).toEqual([
      "Bright Lead",
      "Soft Voice"
    ]);
    expect(filterLibraryPresets(presets, "Pads", "lead")).toEqual([]);
  });
});

describe("signed wheel amount", () => {
  it("round trips every slider percentage and preserves legacy positive depths", () => {
    for (let percent = -100; percent <= 100; ++percent) {
      expect(wheelAmountByteToPercent(wheelAmountPercentToByte(percent))).toBe(percent);
    }
    expect(wheelAmountByteToPercent(127)).toBe(100);
    expect(wheelAmountByteToPercent(0)).toBe(0);
    expect(wheelAmountByteToPercent(254)).toBe(-100);
    const [preset] = presetsFromUnknown({ ...presetRecord("negative", "Negative", ""), values: { SynthModAmount: 254 } });
    expect(preset.values.SynthModAmount).toBe(254);
  });
});

describe("factory wavetable library upgrade", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("adds missing device defaults once and preserves existing same-name samples", () => {
    const stored = new Map<string, string>([
      ["hexboard.synthWavetableFactorySeed.v1", "1"],
      ["hexboard.synthWavetableComputerLibrary.v1", JSON.stringify([{ name: "NotPiano", folderPath: "/Custom", sampleCrc: 123 }])]
    ]);
    vi.stubGlobal("window", { localStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key)
    } });
    const upgraded = loadComputerWavetables();
    expect(upgraded).toHaveLength(7);
    expect(upgraded.find(record => record.name === "NotPiano")?.sampleCrc).toBe(123);
    expect(stored.get("hexboard.synthWavetableFactorySeed.v1")).toBe("2");
    // Subsequent loads respect the user's library, including intentional removals.
    expect(loadComputerWavetables()).toHaveLength(1);
  });
});
