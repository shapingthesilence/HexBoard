import type { Recording } from "./prepare.mjs";

export type Boundary = "start" | "end" | "loopStart" | "loopEnd";
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
export function recordingBounds(a: Recording) {
  const start = a.start ?? 0, end = a.end ?? a.channels[0].length;
  return { start, end, loopStart: a.loopStart ?? start, loopEnd: a.loopEnd ?? end };
}
function at(data: Float32Array, frame: number) {
  if (frame < 0) return data[0] + frame * ((data[1] ?? data[0]) - data[0]);
  if (frame >= data.length) return data[data.length - 1] + (frame - data.length + 1) * (data[data.length - 1] - (data[data.length - 2] ?? data[0]));
  return data[frame];
}
export function loopSeam(a: Recording, start = recordingBounds(a).loopStart, end = recordingBounds(a).loopEnd) {
  // Compare the expected continuation at the exclusive end with the start,
  // rather than treating an ordinary one-sample slope as a discontinuity.
  let jump = 0, slope = 0, score = 0;
  for (const channel of a.channels) {
    jump = Math.max(jump, Math.abs(at(channel, end) - at(channel, start)));
    slope = Math.max(slope, Math.abs((at(channel, end + 1) - at(channel, end - 1) - at(channel, start + 1) + at(channel, start - 1)) / 2));
    for (let i = -2; i <= 2; ++i) score += (at(channel, end + i) - at(channel, start + i)) ** 2;
  }
  return { jump, slope, score };
}
function reference(a: Recording) {
  return a.channels.reduce((best, channel) => {
    const energy = (data: Float32Array) => {
      let sum = 0; const step = Math.max(1, Math.floor(data.length / 1024));
      for (let i = 0; i < data.length; i += step) sum += data[i] ** 2;
      return sum;
    };
    return energy(channel) > energy(best) ? channel : best;
  });
}
function direction(data: Float32Array, frame: number) {
  const previous = at(data, frame - 1), value = at(data, frame), next = at(data, frame + 1);
  if (Math.abs(value) < 1e-9) return Math.sign(next - previous);
  // Select the actual sample closest to the crossing, not necessarily the
  // first sample after it. End markers use that same exclusive coordinate.
  if (Math.abs(value) <= Math.abs(previous)) {
    if (previous < 0 && value > 0) return 1;
    if (previous > 0 && value < 0) return -1;
  }
  if (Math.abs(value) < Math.abs(next)) {
    if (value < 0 && next > 0) return 1;
    if (value > 0 && next < 0) return -1;
  }
  return 0;
}
function nearestZero(a: Recording, frame: number, low: number, high: number, partner: number, radius: number, period?: number) {
  const data = reference(a), wanted = direction(data, partner) || Math.sign(at(data, partner + 1) - at(data, partner));
  let best = frame, distance = Infinity;
  for (let n = Math.max(low, frame - radius); n <= Math.min(high, frame + radius); ++n) {
    const crossing = direction(data, n);
    if (!crossing || (wanted && crossing !== wanted)) continue;
    if (period !== undefined && direction(data, n + period) !== crossing) continue;
    const d = Math.abs(n - frame);
    if (d < distance || (d === distance && loopSeam(a, n, partner).score < loopSeam(a, best, partner).score)) { best = n; distance = d; }
  }
  return best;
}
export function moveBoundary(a: Recording, boundary: Boundary, frame: number, lockLength: boolean, snap = false, radius = 32): Partial<Recording> {
  const b = recordingBounds(a), n = Math.round(frame);
  const length = b.loopEnd - b.loopStart;
  if (boundary === "start") {
    const start = clamp(n, 0, Math.min(b.end - 4, lockLength ? b.end - length : b.end - 4));
    if (lockLength) { const loopStart = Math.max(start, b.loopStart); return { start, loopStart, loopEnd: loopStart + length }; }
    return { start, loopStart: Math.max(start, b.loopStart), loopEnd: Math.max(start + 1, b.loopEnd) };
  }
  if (boundary === "end") {
    const end = clamp(n, Math.max(b.start + 4, lockLength ? b.start + length : b.start + 4), a.channels[0].length);
    if (lockLength) { const loopEnd = Math.min(end, b.loopEnd); return { end, loopEnd, loopStart: loopEnd - length }; }
    return { end, loopEnd: Math.min(end, b.loopEnd), loopStart: Math.min(end - 1, b.loopStart) };
  }
  if (lockLength) {
    let start = clamp(boundary === "loopStart" ? n : n - length, b.start, b.end - length);
    if (snap) start = nearestZero(a, start, b.start, b.end - length, start + length, radius, length);
    return { loopStart: start, loopEnd: start + length };
  }
  const low = boundary === "loopStart" ? b.start : b.loopStart + 1;
  const high = boundary === "loopStart" ? b.loopEnd - 1 : b.end;
  let value = clamp(n, low, high);
  if (snap) value = nearestZero(a, value, low, high, boundary === "loopStart" ? b.loopEnd : b.loopStart, radius);
  return { [boundary]: value };
}
export function snapLoop(a: Recording, lockLength: boolean, radius = 128): Partial<Recording> {
  const b = recordingBounds(a);
  if (lockLength) return moveBoundary(a, "loopStart", b.loopStart, true, true, radius);
  const start = moveBoundary(a, "loopStart", b.loopStart, false, true, radius);
  return { ...start, ...moveBoundary({ ...a, ...start }, "loopEnd", b.loopEnd, false, true, radius) };
}
export function matchLoop(a: Recording, lockLength: boolean, boundary: "loopStart" | "loopEnd", radius = 128): Partial<Recording> {
  const b = recordingBounds(a), length = b.loopEnd - b.loopStart;
  const power = (start: number, end: number) => {
    let sum = 0;
    for (const channel of a.channels) for (let i = 0; i < 32; ++i) sum += at(channel, Math.floor(start + i * (end - start) / 32)) ** 2;
    return sum;
  };
  const minimumPower = power(b.loopStart, b.loopEnd) / 4;
  let result: Partial<Recording> = {}, best = loopSeam(a).score;
  for (let delta = -radius; delta <= radius; ++delta) {
    const start = lockLength || boundary === "loopStart" ? b.loopStart + delta : b.loopStart;
    const end = lockLength ? start + length : boundary === "loopEnd" ? b.loopEnd + delta : b.loopEnd;
    if (start < b.start || end > b.end || start >= end || power(start, end) < minimumPower) continue;
    const score = loopSeam(a, start, end).score + Math.abs(delta) * 1e-7;
    if (score < best) { best = score; result = { loopStart: start, loopEnd: end }; }
  }
  return result;
}
export function loopPitchChange(a: Recording, originalFrames: number) {
  const b = recordingBounds(a);
  return 1200 * Math.log2(originalFrames / (b.loopEnd - b.loopStart));
}
export function waveformDetail(data: Float32Array, start: number, end: number, width: number, height: number, gain: number) {
  const length = end - start, y = (n: number) => height / 2 - n * height * .43 * gain;
  if (length <= width) return Array.from({ length: Math.min(data.length, end) - start }, (_, i) => `${i ? "L" : "M"}${(i * width / length).toFixed(2)},${y(data[start + i]).toFixed(2)}`).join("");
  const out: string[] = [];
  for (let x = 0; x < width; ++x) {
    let low = Infinity, high = -Infinity;
    const begin = Math.floor(start + x * length / width), finish = Math.min(data.length, Math.ceil(start + (x + 1) * length / width));
    for (let i = begin; i < finish; ++i) { low = Math.min(low, data[i]); high = Math.max(high, data[i]); }
    out.push(`M${x},${y(low).toFixed(2)}V${y(high).toFixed(2)}`);
  }
  return out.join("");
}
