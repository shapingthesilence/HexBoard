const clamp = (value: number) => Math.max(0, Math.min(1, value));
/** The knob's 270-degree scale, from lower left through noon to lower right. */
export function knobRingPoint(value: number, radius: number) {
  const angle = -135 + clamp(value) * 270, radians = angle * Math.PI / 180;
  return {x: 36 + radius * Math.sin(radians), y: 36 - radius * Math.cos(radians), angle};
}
/** Signed depth starts at the base pointer and stops at the parameter limits. */
export function modulationRing(depth: number, radius: number, base: number) {
  const start = knobRingPoint(base, radius);
  const end = knobRingPoint(clamp(base) + Math.max(-1, Math.min(1, depth / 65536)), radius);
  const delta = end.angle - start.angle;
  return {...end, start, path: delta === 0 ? '' : `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${Math.abs(delta) > 180 ? 1 : 0} ${delta > 0 ? 1 : 0} ${end.x} ${end.y}`};
}

/** Tilt spans both sides of neutral; note expression remains unipolar. */
export function modulationRings(depth: number, radius: number, base: number, bipolar: boolean) {
  return bipolar ? [modulationRing(depth, radius, base), modulationRing(-depth, radius, base)] : [modulationRing(depth, radius, base)];
}
