// View transforms only: captured samples and velocity calculations stay intact.
export function clampRange(range, bounds, minimum = 1) {
  const [lo, hi] = bounds;
  if (!(hi > lo)) return [lo, lo + 1];
  const width = Math.min(hi - lo, Math.max(Math.min(minimum, hi - lo), range[1] - range[0]));
  const start = Math.max(lo, Math.min(hi - width, (range[0] + range[1] - width) / 2));
  return [start, start + width];
}
export function scaleRange(range, factor, bounds) {
  const middle = (range[0] + range[1]) / 2;
  const half = (range[1] - range[0]) * factor / 2;
  return clampRange([middle - half, middle + half], bounds);
}
export function phaseRange(points, phase, triggerIndex = 0) {
  if (points.length < 2) return null;
  const peak = Math.max(...points.map(p => p.mm));
  if (peak < .05) return null;
  const lower = peak * .1, upper = peak * .9;
  // Anchor to the captured trigger; do not accidentally zoom a pre-trigger blip.
  let first = Math.max(0, Math.min(points.length - 1, triggerIndex));
  while (first > 0 && points[first].mm > lower) --first;
  let end = first;
  while (end < points.length && points[end].mm < upper) ++end;
  if (end === points.length) return null;
  if (phase === 'release') {
    let start = end;
    while (end < points.length && points[end].mm > lower) {
      if (points[end].mm >= upper) start = end;
      ++end;
    }
    // If the release is not in the capture, leave the button unavailable.
    if (end === points.length) return null;
    first = start;
  }
  const startTime = points[first].time, endTime = points[end].time;
  const padding = Math.max(3, (endTime - startTime) * .3);
  return clampRange([startTime - padding, endTime + padding], [points[0].time, points.at(-1).time]);
}
export function yPosition(value, min, max, top, bottom, inverted = false) {
  const ratio = (value - min) / (max - min);
  return inverted ? top + ratio * (bottom - top) : bottom - ratio * (bottom - top);
}
