// Classic HexBoard synth preset library limits (firmware PersistentDataModels.h).
export const HEXBOARD_PRESET_MAX_COUNT = 512;
export const HEXBOARD_PRESET_FOLDER_MAX_COUNT = 32;
export const HEXBOARD_PRESET_FOLDER_MAX_PRESETS = 32;
// The board browser shows 23 characters; names are limited to match.
export const HEXBOARD_PRESET_NAME_MAX_BYTES = 23;

export interface PresetPlacement {
  objectIdHex: string;
  folderPath: string;
}

function folderKey(folderPath: string): string {
  const trimmed = folderPath.trim().replace(/^\/+|\/+$/g, "");
  return trimmed || "/";
}

function folderLabel(folderPath: string): string {
  const key = folderKey(folderPath);
  return key === "/" ? "the root folder" : `"${key}"`;
}

/**
 * Applies saves in order (same object id replaces, otherwise appends) and
 * reports the first HexBoard limit a save would break. Deletes that follow a
 * replacing save run after it, so they cannot make room for it.
 * Presets that already exceed a folder limit only fail when more enter it,
 * matching the firmware.
 */
export function hexboardPresetCapacityProblem(
  existing: readonly PresetPlacement[],
  saves: readonly PresetPlacement[]
): string | null {
  const placement = new Map(existing.map((preset) => [preset.objectIdHex.toLowerCase(), folderKey(preset.folderPath)]));
  const counts = new Map<string, number>();
  for (const folder of placement.values()) counts.set(folder, (counts.get(folder) ?? 0) + 1);

  for (const save of saves) {
    const id = save.objectIdHex.toLowerCase();
    const folder = folderKey(save.folderPath);
    const previous = placement.get(id);
    if (previous === folder) continue;
    if (previous === undefined && placement.size >= HEXBOARD_PRESET_MAX_COUNT) {
      return `The HexBoard holds at most ${HEXBOARD_PRESET_MAX_COUNT} presets. Delete some before adding more.`;
    }
    const inFolder = counts.get(folder) ?? 0;
    if (inFolder >= HEXBOARD_PRESET_FOLDER_MAX_PRESETS) {
      return `A HexBoard folder holds at most ${HEXBOARD_PRESET_FOLDER_MAX_PRESETS} presets, and ${folderLabel(folder)} is full. Choose another folder.`;
    }
    if (previous !== undefined) {
      const remaining = (counts.get(previous) ?? 1) - 1;
      if (remaining > 0) counts.set(previous, remaining);
      else counts.delete(previous);
    }
    if (inFolder === 0 && counts.size >= HEXBOARD_PRESET_FOLDER_MAX_COUNT) {
      return `The HexBoard holds at most ${HEXBOARD_PRESET_FOLDER_MAX_COUNT} preset folders. Use an existing folder.`;
    }
    counts.set(folder, inFolder + 1);
    placement.set(id, folder);
  }
  return null;
}
