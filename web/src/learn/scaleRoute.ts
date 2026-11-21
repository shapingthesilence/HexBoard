import type { HexBoardKey } from "../catalogs/hexBoardGeometry.ts";
import type { KeyLight, LessonKey } from "./majorScale.ts";

// Keys use doubled-width coordinates: side neighbours are two columns apart,
// diagonal neighbours one column and one row apart.
export function hexDistance(a: HexBoardKey, b: HexBoardKey) {
  const rows = Math.abs(a.row - b.row), columns = Math.abs(a.coordCol - b.coordCol);
  return rows + Math.max(0, (columns - rows) / 2);
}

// The cluster score counts the distance between every pair of chosen keys, so
// the shape stays a compact block. Moves between neighbouring scale notes
// count on top of that, so ties go to the smoother path.
const moveWeight = 0.5;
const beamWidth = 256;

/**
 * Chooses one key per scale pitch around the key that played the first note.
 * Pitches are placed outward from the anchor (one above, one below, and so on)
 * and the tightest cluster wins. Returns pitch → key index, or undefined when
 * the anchor does not play the first note or a pitch is missing from the layout.
 */
export function scaleRoute(keys: readonly LessonKey[], notes: readonly number[], anchor: number): Map<number, number> | undefined {
  const start = keys[anchor];
  if (!start || start.note === null || start.note !== notes[0]) return undefined;
  const pitches = [...new Set(notes)].sort((a, b) => a - b);
  const at = pitches.indexOf(start.note);
  // Outward order means each pitch's scale neighbour toward the anchor is placed first.
  const order: { pitch: number; neighbour: number }[] = [];
  for (let distance = 1; at + distance < pitches.length || at - distance >= 0; distance++) {
    if (at + distance < pitches.length) order.push({ pitch: pitches[at + distance], neighbour: distance - 1 });
    if (at - distance >= 0) order.push({ pitch: pitches[at - distance], neighbour: -(distance - 1) });
  }
  const position = (offset: number) => offset === 0 ? 0 : order.findIndex(item => item.pitch === pitches[at + offset]) + 1;
  let beam = [{ chosen: [start.key] as HexBoardKey[], cost: 0 }];
  for (const { pitch, neighbour } of order) {
    const candidates = keys.filter(key => key.note === pitch);
    if (!candidates.length) return undefined;
    const from = position(neighbour);
    beam = beam.flatMap(state => candidates.map(({ key }) => ({
      chosen: [...state.chosen, key],
      cost: state.cost + state.chosen.reduce((sum, other) => sum + hexDistance(other, key), 0) + moveWeight * hexDistance(state.chosen[from], key),
    }))).sort((a, b) => a.cost - b.cost).slice(0, beamWidth);
  }
  const best = beam[0].chosen;
  return new Map([[start.note, anchor], ...order.map(({ pitch }, index) => [pitch, best[index + 1].index] as [number, number])]);
}

/**
 * Lights a chosen scale route: the next note stays bright, the key just played
 * keeps a trail, the rest of the shape is softly lit and every other key,
 * including other copies of scale notes, dims.
 */
export function routeKeyLight(key: LessonKey, state: KeyLight, route: ReadonlyMap<number, number>, trail?: number): KeyLight {
  if (state === "off" || state === "held") return state;
  if (key.key.index === trail) return "trail";
  if (key.note === null || route.get(key.note) !== key.key.index) return "outside";
  return state === "target" ? "target" : "shape";
}
