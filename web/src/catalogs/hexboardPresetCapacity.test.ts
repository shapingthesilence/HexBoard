import { describe, expect, it } from "vitest";
import {
  HEXBOARD_PRESET_FOLDER_MAX_COUNT,
  HEXBOARD_PRESET_FOLDER_MAX_PRESETS,
  HEXBOARD_PRESET_MAX_COUNT,
  hexboardPresetCapacityProblem
} from "./hexboardPresetCapacity.ts";

const id = (n: number) => n.toString(16).padStart(32, "0");
const presets = (count: number, folder: (n: number) => string, offset = 0) =>
  Array.from({ length: count }, (_, n) => ({ objectIdHex: id(n + offset), folderPath: folder(n) }));

describe("HexBoard preset capacity", () => {
  it("refuses a preset entering a full folder but allows edits inside it", () => {
    const full = presets(HEXBOARD_PRESET_FOLDER_MAX_PRESETS, () => "Pads");
    expect(hexboardPresetCapacityProblem(full, [{ objectIdHex: id(999), folderPath: "/Pads/" }])).toMatch(/"Pads" is full/);
    expect(hexboardPresetCapacityProblem(full, [{ objectIdHex: id(3), folderPath: "Pads" }])).toBeNull();
    expect(hexboardPresetCapacityProblem(full, [{ objectIdHex: id(3), folderPath: "Leads" }])).toBeNull();
  });

  it("counts a batch against the folder limit", () => {
    const batch = presets(HEXBOARD_PRESET_FOLDER_MAX_PRESETS + 1, () => "/", 100);
    expect(hexboardPresetCapacityProblem([], batch)).toMatch(/root folder is full/);
    expect(hexboardPresetCapacityProblem([], batch.slice(1))).toBeNull();
  });

  it("refuses the 513th preset", () => {
    const library = presets(HEXBOARD_PRESET_MAX_COUNT, (n) => `F${n % 16}`);
    expect(hexboardPresetCapacityProblem(library, [{ objectIdHex: id(9999), folderPath: "F0" }])).toMatch(/at most 512 presets/);
  });

  it("refuses a 33rd folder unless a move empties one", () => {
    const library = presets(HEXBOARD_PRESET_FOLDER_MAX_COUNT, (n) => `F${n}`);
    expect(hexboardPresetCapacityProblem(library, [{ objectIdHex: id(9999), folderPath: "New" }])).toMatch(/32 preset folders/);
    expect(hexboardPresetCapacityProblem(library, [{ objectIdHex: id(0), folderPath: "New" }])).toBeNull();
  });
});
