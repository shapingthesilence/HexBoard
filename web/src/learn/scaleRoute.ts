import type { HexBoardKey } from "../catalogs/hexBoardGeometry.ts";
import type { KeyLight, LessonKey } from "./majorScale.ts";
import type { HintLevel } from "./scaleCoaching.ts";

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

interface RankedRoute { route: Map<number, number>; cost: number; maxMove: number; spread: number }

// Every complete placement the beam keeps from one anchor, best first.
function rankedRoutes(keys: readonly LessonKey[], notes: readonly number[], anchor: number): RankedRoute[] {
  const start = keys[anchor];
  if (!start || start.note === null || start.note !== notes[0]) return [];
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
    if (!candidates.length) return [];
    const from = position(neighbour);
    beam = beam.flatMap(state => candidates.map(({ key }) => ({
      chosen: [...state.chosen, key],
      cost: state.cost + state.chosen.reduce((sum, other) => sum + hexDistance(other, key), 0) + moveWeight * hexDistance(state.chosen[from], key),
    }))).sort((a, b) => a.cost - b.cost).slice(0, beamWidth);
  }
  return beam.map(({ chosen, cost }) => {
    const route = new Map([[start.note!, anchor], ...order.map(({ pitch }, index) => [pitch, chosen[index + 1].index] as [number, number])]);
    const placed = pitches.map(pitch => chosen[pitch === start.note ? 0 : order.findIndex(item => item.pitch === pitch) + 1]);
    const maxMove = Math.max(0, ...placed.slice(1).map((key, index) => hexDistance(placed[index], key)));
    const spread = Math.max(0, ...chosen.flatMap((key, index) => chosen.slice(index + 1).map(other => hexDistance(key, other))));
    return { route, cost, maxMove, spread };
  });
}

/**
 * Chooses one key per scale pitch around the key that played the first note.
 * Pitches are placed outward from the anchor (one above, one below, and so on)
 * and the tightest cluster wins. Returns pitch → key index, or undefined when
 * the anchor does not play the first note or a pitch is missing from the layout.
 */
export function scaleRoute(keys: readonly LessonKey[], notes: readonly number[], anchor: number): Map<number, number> | undefined {
  return rankedRoutes(keys, notes, anchor)[0]?.route;
}

// Alternatives must stay nearly as compact as the best shape, no wider, and
// keep every step between neighbouring scale notes short, so no note is stranded.
const alternativeCost = 1.3;

/**
 * Distinct compact shapes from one anchor, best first. The first is
 * scaleRoute's choice; later ones are other fingerable ways to play the scale.
 */
export function scaleShapes(keys: readonly LessonKey[], notes: readonly number[], anchor: number, limit = 4): Map<number, number>[] {
  const ranked = rankedRoutes(keys, notes, anchor);
  if (!ranked.length) return [];
  const [best] = ranked, seen = new Set<string>(), shapes: Map<number, number>[] = [];
  for (const { route, cost, maxMove, spread } of ranked) {
    if (shapes.length >= limit || cost > best.cost * alternativeCost) break;
    const signature = [...route.values()].join();
    if (maxMove > best.maxMove + 1 || spread > best.spread + 1 || seen.has(signature)) continue;
    seen.add(signature); shapes.push(route);
  }
  return shapes;
}

/** The copy of the first note whose best shape sits nearest the middle of the board. */
export function centralScaleAnchor(keys: readonly LessonKey[], notes: readonly number[]): number | undefined {
  let best: { anchor: number; distance: number } | undefined;
  for (const { key, note } of keys) {
    if (note === null || note !== notes[0]) continue;
    const route = scaleRoute(keys, notes, key.index);
    if (!route) continue;
    const placed = [...route.values()].map(index => keys[index].key);
    const col = placed.reduce((sum, item) => sum + item.coordCol, 0) / placed.length, row = placed.reduce((sum, item) => sum + item.row, 0) / placed.length;
    const distance = (col - 9.5) ** 2 + 3 * (row - 6.5) ** 2;
    if (!best || distance < best.distance) best = { anchor: key.index, distance };
  }
  return best?.anchor;
}

/**
 * The same shape played from another copy of the first note, when every key
 * of the moved shape plays the same pitch; otherwise undefined.
 */
export function moveScaleShape(keys: readonly LessonKey[], route: ReadonlyMap<number, number>, from: number, to: number): Map<number, number> | undefined {
  const col = keys[to].key.coordCol - keys[from].key.coordCol, row = keys[to].key.row - keys[from].key.row;
  const moved = new Map<number, number>();
  for (const [pitch, index] of route) {
    const key = keys.find(item => item.note === pitch && item.key.coordCol === keys[index].key.coordCol + col && item.key.row === keys[index].key.row + row);
    if (!key) return undefined;
    moved.set(pitch, key.key.index);
  }
  return moved;
}

/**
 * Lights a chosen scale route: the next note stays bright, the key just played
 * keeps a trail, the rest of the shape is softly lit and every other key,
 * including other copies of scale notes, dims. Faded hints keep only the
 * shape (and trail), or only the shape's roots.
 */
export function routeKeyLight(key: LessonKey, state: KeyLight, route: ReadonlyMap<number, number>, trail?: number, level: HintLevel = "full", isRoot?: (pitch: number) => boolean): KeyLight {
  if (state === "off" || state === "held" || state === "wrong") return state;
  if (level !== "root" && key.key.index === trail) return "trail";
  if (key.note === null || route.get(key.note) !== key.key.index) return "outside";
  if (level === "root") return isRoot?.(key.note) ? "shape" : "outside";
  return level === "full" && state === "target" ? "target" : "shape";
}
