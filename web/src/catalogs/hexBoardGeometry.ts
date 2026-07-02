export const HEXBOARD_VISIBLE_KEY_COUNT = 140;
export const HEXBOARD_COLUMN_COUNT = 10;
export const HEXBOARD_VISIBLE_ROW_COUNT = 14;
export const HEXBOARD_COMMAND_INDICES = [0, 20, 40, 60, 80, 100, 120] as const;

export type HexBoardKeyRole = "note" | "command";

export interface HexBoardKey {
  index: number;
  row: number;
  column: number;
  coordRow: number;
  coordCol: number;
  role: HexBoardKeyRole;
}

export interface VectorLayoutModel {
  centerButton: number;
  acrossSteps: number;
  upRightSteps: number;
}

const commandIndexSet = new Set<number>(HEXBOARD_COMMAND_INDICES);

export function isHexBoardCommandIndex(index: number): boolean {
  return commandIndexSet.has(index);
}

export function createHexBoardGeometry(): HexBoardKey[] {
  return Array.from({ length: HEXBOARD_VISIBLE_KEY_COUNT }, (_, index) => {
    const row = Math.floor(index / HEXBOARD_COLUMN_COUNT);
    const column = index % HEXBOARD_COLUMN_COUNT;
    return {
      index,
      row,
      column,
      coordRow: row,
      coordCol: (2 * column) + (row & 1),
      role: isHexBoardCommandIndex(index) ? "command" : "note"
    };
  });
}

export const hexBoardGeometry = createHexBoardGeometry();

export function hexBoardKeyByIndex(index: number, keys = hexBoardGeometry): HexBoardKey {
  const key = keys.find((candidate) => candidate.index === index);
  if (!key) {
    throw new Error(`Unknown HexBoard key index ${index}`);
  }
  return key;
}

export function vectorLayoutDistances(key: HexBoardKey, center: HexBoardKey): { acrossDistance: number; upRightDistance: number } {
  const distCol = key.coordCol - center.coordCol;
  const distRow = key.coordRow - center.coordRow;
  return {
    acrossDistance: (distCol + distRow) / 2,
    upRightDistance: -distRow
  };
}

export function computeVectorLayoutSteps(key: HexBoardKey, layout: VectorLayoutModel, keys = hexBoardGeometry): number {
  const center = hexBoardKeyByIndex(layout.centerButton, keys);
  const distances = vectorLayoutDistances(key, center);
  return (distances.acrossDistance * layout.acrossSteps) + (distances.upRightDistance * layout.upRightSteps);
}

export function positiveModulo(value: number, modulus: number): number {
  const safeModulus = Math.max(1, Math.round(modulus));
  return ((Math.round(value) % safeModulus) + safeModulus) % safeModulus;
}
