import { describe, expect, it } from "vitest";
import {
  HEXBOARD_COMMAND_INDICES,
  computeVectorLayoutSteps,
  hexBoardGeometry,
  hexBoardKeyByIndex
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
      upRightSteps: 8
    };
    expect(computeVectorLayoutSteps(hexBoardKeyByIndex(65), layout)).toBe(0);
    expect(computeVectorLayoutSteps(hexBoardKeyByIndex(66), layout)).toBe(3);
    expect(computeVectorLayoutSteps(hexBoardKeyByIndex(54), layout)).toBe(8);
  });
});
