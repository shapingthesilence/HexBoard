import { hexBoardGeometry, HEXBOARD_COMMAND_INDICES } from "./hexBoardGeometry.ts";

// Portrait, controls on the left, viewed from above (not the PCB underside).
// The command bank is physically separate from the 133-key musical grid.
export function typingGeometry(rotation: number) {
  const turn = ((rotation % 4) + 4) % 4;
  const points = hexBoardGeometry.map((hex) => {
    const command = (HEXBOARD_COMMAND_INDICES as readonly number[]).indexOf(hex.index);
    const x = command < 0 ? hex.coordCol * 25 + 100 : 25 + (command % 2 === 0 ? 25 : 0);
    const y = command < 0 ? hex.coordRow * 43.3 : (6 + command) * 43.3;
    const [rx, ry] = turn === 0 ? [x, y] : turn === 1 ? [-y, x] : turn === 2 ? [-x, -y] : [y, -x];
    return { index: hex.index, command, x: rx, y: ry };
  });
  const minX = Math.min(...points.map((p) => p.x)), minY = Math.min(...points.map((p) => p.y));
  return {
    keys: points.map((p) => ({ ...p, x: p.x - minX + 36, y: p.y - minY + 36 })),
    width: Math.max(...points.map((p) => p.x)) - minX + 72,
    height: Math.max(...points.map((p) => p.y)) - minY + 72,
  };
}
