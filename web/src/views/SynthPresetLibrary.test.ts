import { describe, expect, it } from "vitest";
import { deterministicObjectId, objectIdToHex } from "../catalogs/index.ts";
import { filterLibraryPresets, mergePresetBatch, presetsFromUnknown } from "./SynthPresetLibrary.tsx";

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
