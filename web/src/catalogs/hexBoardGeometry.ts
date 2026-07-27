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
  centerStepsFromC?: number;
  acrossSteps: number;
  upRightSteps: number;
  layoutRotationSteps?: number;
  mirrorLeftRight?: boolean;
  mirrorUpDown?: boolean;
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
  let acrossSteps = layout.acrossSteps;
  let downLeftSteps = -layout.upRightSteps;
  if (layout.mirrorUpDown) {
    downLeftSteps = -(acrossSteps + downLeftSteps);
  }
  let unmirroredAcrossSteps = acrossSteps;
  let unmirroredDownLeftSteps = downLeftSteps;
  if (layout.mirrorLeftRight) {
    downLeftSteps = acrossSteps + downLeftSteps;
    acrossSteps = -acrossSteps;
  }
  const rotationCount = positiveModulo(layout.layoutRotationSteps ?? 0, 6);
  for (let rotation = 0; rotation < rotationCount; rotation += 1) {
    [acrossSteps, downLeftSteps] = rotateLayoutClockwise(acrossSteps, downLeftSteps);
    [unmirroredAcrossSteps, unmirroredDownLeftSteps] = rotateLayoutClockwise(unmirroredAcrossSteps, unmirroredDownLeftSteps);
  }
  let mirrorOffset = 0;
  if (layout.mirrorLeftRight) {
    const physicalCenter = keys.find((candidate) => candidate.index === 65);
    if (physicalCenter) {
      const centerDistCol = physicalCenter.coordCol - center.coordCol;
      const centerDistRow = physicalCenter.coordRow - center.coordRow;
      mirrorOffset = layoutStepsForDelta(centerDistCol, centerDistRow, unmirroredAcrossSteps, unmirroredDownLeftSteps)
        - layoutStepsForDelta(centerDistCol, centerDistRow, acrossSteps, downLeftSteps);
    }
  }
  return layoutStepsForDelta(
    key.coordCol - center.coordCol,
    key.coordRow - center.coordRow,
    acrossSteps,
    downLeftSteps
  ) + mirrorOffset + Math.round(layout.centerStepsFromC ?? 0);
}

export interface HexAxialCoordinate {
  q: number;
  r: number;
}

export type HexSpatialTransform = "rotate-clockwise" | "rotate-counterclockwise" | "mirror-left-right" | "mirror-up-down";

export function hexKeyAxialCoordinate(key: Pick<HexBoardKey, "coordCol" | "coordRow">): HexAxialCoordinate {
  return {
    q: (key.coordCol + key.coordRow) / 2,
    r: key.coordRow
  };
}

export function hexAxialToCoordinate(coordinate: HexAxialCoordinate): { coordCol: number; coordRow: number } {
  return {
    coordCol: (2 * coordinate.q) - coordinate.r,
    coordRow: coordinate.r
  };
}

export function transformHexCoordinate(
  coordinate: HexAxialCoordinate,
  pivot: HexAxialCoordinate,
  transform: HexSpatialTransform
): HexAxialCoordinate {
  const q = coordinate.q - pivot.q;
  const r = coordinate.r - pivot.r;
  const transformed = (() => {
    switch (transform) {
      case "rotate-clockwise": return { q: q - r, r: q };
      case "rotate-counterclockwise": return { q: r, r: r - q };
      case "mirror-left-right": return { q: r - q, r };
      case "mirror-up-down": return { q: q - r, r: -r };
    }
  })();
  return {
    q: transformed.q + pivot.q,
    r: transformed.r + pivot.r
  };
}

export function inverseHexSpatialTransform(transform: HexSpatialTransform): HexSpatialTransform {
  if (transform === "rotate-clockwise") return "rotate-counterclockwise";
  if (transform === "rotate-counterclockwise") return "rotate-clockwise";
  return transform;
}

export function virtualHexKeyAt(coordinate: HexAxialCoordinate): HexBoardKey {
  const { coordCol, coordRow } = hexAxialToCoordinate(coordinate);
  return {
    index: -1,
    row: coordRow,
    column: 0,
    coordRow,
    coordCol,
    role: "note"
  };
}

export function transformGeneratedLayoutAroundKey<T extends VectorLayoutModel>(
  layout: T,
  pivotKey: HexBoardKey,
  transform: HexSpatialTransform,
  keys = hexBoardGeometry
): T {
  const pivot = hexKeyAxialCoordinate(pivotKey);
  const inverse = inverseHexSpatialTransform(transform);
  const pitchAtTarget = (target: HexAxialCoordinate) => computeVectorLayoutSteps(
    virtualHexKeyAt(transformHexCoordinate(target, pivot, inverse)),
    layout,
    keys
  );
  const pivotPitch = pitchAtTarget(pivot);
  const acrossPitch = pitchAtTarget({ q: pivot.q + 1, r: pivot.r });
  const upRightPitch = pitchAtTarget({ q: pivot.q, r: pivot.r - 1 });
  return {
    ...layout,
    centerButton: pivotKey.index,
    centerStepsFromC: Math.round(pivotPitch),
    acrossSteps: Math.round(acrossPitch - pivotPitch),
    upRightSteps: Math.round(upRightPitch - pivotPitch),
    layoutRotationSteps: 0,
    mirrorLeftRight: false,
    mirrorUpDown: false
  };
}

function layoutStepsForDelta(distCol: number, distRow: number, acrossSteps: number, downLeftSteps: number): number {
  return ((distCol * acrossSteps) + (distRow * (acrossSteps + (2 * downLeftSteps)))) / 2;
}

function rotateLayoutClockwise(acrossSteps: number, downLeftSteps: number): [number, number] {
  const nextDownLeft = acrossSteps + downLeftSteps;
  return [nextDownLeft, -acrossSteps];
}

export function positiveModulo(value: number, modulus: number): number {
  const safeModulus = Math.max(1, Math.round(modulus));
  return ((Math.round(value) % safeModulus) + safeModulus) % safeModulus;
}
