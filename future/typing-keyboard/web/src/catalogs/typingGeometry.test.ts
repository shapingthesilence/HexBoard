import { describe, it, expect } from "vitest";
import { typingGeometry } from "./typingGeometry.ts";

describe("physical typing preview", () => {
  it("shows 133 main keys and command 0–6 top to bottom in a separate left bank", () => {
    const { keys } = typingGeometry(0);
    const main = keys.filter((k) => k.command < 0), commands = keys.filter((k) => k.command >= 0);
    expect(main).toHaveLength(133);
    expect(commands.map((k) => k.index)).toEqual([0, 20, 40, 60, 80, 100, 120]);
    expect(Math.max(...commands.map((k) => k.x))).toBeLessThan(Math.min(...main.map((k) => k.x)) - 48);
    commands.slice(1).forEach((k, i) => expect(k.y).toBeGreaterThan(commands[i].y));
    expect(keys[1].x).toBeLessThan(keys[9].x);
    expect(keys[1].x).toBeGreaterThan(keys[10].x); // Nine-key rows inset from ten-key rows.
    expect(keys[1].y).toBeLessThan(keys[131].y);
  });
  it("rotates clockwise without reflection or changing physical key identities", () => {
    const base = typingGeometry(0);
    for (let r = 0; r < 4; r++) {
      const board = typingGeometry(r);
      expect(board.keys.map((k) => k.index)).toEqual(base.keys.map((k) => k.index));
      const a = board.keys[1], b = board.keys[9], c = board.keys[131];
      expect((b.x-a.x)*(c.y-a.y) - (b.y-a.y)*(c.x-a.x)).toBeGreaterThan(0);
      expect(board.width).toBeCloseTo(r % 2 ? base.height : base.width);
      expect(board.height).toBeCloseTo(r % 2 ? base.width : base.height);
    }
    expect(typingGeometry(1).keys[9].y).toBeGreaterThan(typingGeometry(1).keys[1].y);
  });
});
