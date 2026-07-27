import { describe, expect, it } from "vitest";
import {
  HEXBOARD_COMMAND_INDICES,
  computeVectorLayoutSteps,
  hexBoardGeometry,
  hexBoardKeyByIndex,
  hexKeyAxialCoordinate,
  inverseHexSpatialTransform,
  transformGeneratedLayoutAroundKey,
  transformHexCoordinate,
  virtualHexKeyAt
} from "./index.ts";

describe("HexBoard geometry", () => {
  it("matches the visible firmware key grid", () => {
    expect(hexBoardGeometry).toHaveLength(140);
    expect(hexBoardGeometry.filter((key) => key.role === "command").map((key) => key.index)).toEqual(Array.from(HEXBOARD_COMMAND_INDICES));
    expect(hexBoardGeometry.filter((key) => key.role === "note")).toHaveLength(133);
  });

  it("uses firmware row and coordinate mapping", () => {
    expect(hexBoardKeyByIndex(0)).toMatchObject({ row: 0, column: 0, coordRow: 0, coordCol: 0 });
    expect(hexBoardKeyByIndex(9)).toMatchObject({ row: 0, column: 9, coordRow: 0, coordCol: 18 });
    expect(hexBoardKeyByIndex(10)).toMatchObject({ row: 1, column: 0, coordRow: 1, coordCol: 1 });
    expect(hexBoardKeyByIndex(139)).toMatchObject({ row: 13, column: 9, coordRow: 13, coordCol: 19 });
  });

  it("previews the current 19 EDO Wicki mapping through up-right compatibility", () => {
    const layout = {
      centerButton: 65,
      acrossSteps: 3,
      upRightSteps: 11
    };
    expect(computeVectorLayoutSteps(hexBoardKeyByIndex(65), layout)).toBe(0);
    expect(computeVectorLayoutSteps(hexBoardKeyByIndex(66), layout)).toBe(3);
    expect(computeVectorLayoutSteps(hexBoardKeyByIndex(55), layout)).toBe(11);
    expect(computeVectorLayoutSteps(hexBoardKeyByIndex(54), layout)).toBe(8);
  });

  it("applies musical rotation and mirroring while keeping the physical center anchored", () => {
    const base = {
      centerButton: 65,
      acrossSteps: 3,
      upRightSteps: 11
    };
    expect(computeVectorLayoutSteps(hexBoardKeyByIndex(66), { ...base, layoutRotationSteps: 3 })).toBe(-3);
    expect(computeVectorLayoutSteps(hexBoardKeyByIndex(66), { ...base, mirrorLeftRight: true })).toBe(-3);
    expect(computeVectorLayoutSteps(hexBoardKeyByIndex(65), { ...base, layoutRotationSteps: 3, mirrorLeftRight: true })).toBe(0);
  });

  it("round trips axial rotation around an arbitrary primary key", () => {
    const pivot = hexKeyAxialCoordinate(hexBoardKeyByIndex(65));
    const source = hexKeyAxialCoordinate(hexBoardKeyByIndex(32));
    const rotated = transformHexCoordinate(source, pivot, "rotate-clockwise");
    expect(transformHexCoordinate(rotated, pivot, inverseHexSpatialTransform("rotate-clockwise"))).toEqual(source);
    expect(transformHexCoordinate(
      transformHexCoordinate(source, pivot, "mirror-left-right"),
      pivot,
      "mirror-left-right"
    )).toEqual(source);
  });

  it("rewrites generated mapping vectors without changing the transformed pitches", () => {
    const layout = {
      centerButton: 65,
      centerStepsFromC: 4,
      acrossSteps: 3,
      upRightSteps: 11,
      layoutRotationSteps: 2,
      mirrorLeftRight: true
    };
    const pivotKey = hexBoardKeyByIndex(66);
    const pivot = hexKeyAxialCoordinate(pivotKey);
    const transformed = transformGeneratedLayoutAroundKey(layout, pivotKey, "rotate-clockwise");
    for (const targetKey of [hexBoardKeyByIndex(55), pivotKey, hexBoardKeyByIndex(67), hexBoardKeyByIndex(77)]) {
      const source = transformHexCoordinate(
        hexKeyAxialCoordinate(targetKey),
        pivot,
        "rotate-counterclockwise"
      );
      expect(computeVectorLayoutSteps(targetKey, transformed)).toBe(
        computeVectorLayoutSteps(virtualHexKeyAt(source), layout)
      );
    }
    expect(transformed).toMatchObject({
      centerButton: 66,
      layoutRotationSteps: 0,
      mirrorLeftRight: false,
      mirrorUpDown: false
    });
  });
});
