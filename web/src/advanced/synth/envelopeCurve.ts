// Envelope segment curves shared by every engine. Mirrors Advanced
// src/synth/modulators.h (Modulators::curve): bend -1..1, 0 is a straight
// line, negative rises fast then settles, positive starts slowly.
export const linearCurveWord = 32768;
export const curveBend = (word: number) => Math.max(-1, Math.min(1, (word - linearCurveWord) / 32767));
export const curveWord = (bend: number) => Math.round(Math.max(0, Math.min(65535, linearCurveWord + Math.max(-1, Math.min(1, bend)) * 32767)));
export function envelopeCurve(x: number, bend: number) {
  if (!bend) return x;
  const k = Math.exp(4 * bend);
  return x / (x + k * (1 - x));
}
/** The bend whose curve passes through `fraction` of the segment at its midpoint. */
export function bendThrough(fraction: number) {
  const f = Math.max(.02, Math.min(.98, fraction));
  return Math.max(-1, Math.min(1, Math.log((1 - f) / f) / 4));
}
export interface EnvelopeShape {delay?: number; attack: number; hold?: number; decay: number; sustain: number; release?: number; attackBend?: number; decayBend?: number; releaseBend?: number}
/** Level 0..1 at `t` seconds after note-on while held (no release). */
export function envelopeLevel(e: EnvelopeShape, t: number) {
  let x = t - (e.delay ?? 0);
  if (x < 0) return 0;
  if (x < e.attack) return envelopeCurve(x / e.attack, e.attackBend ?? 0);
  x -= e.attack;
  if (x < (e.hold ?? 0)) return 1;
  x -= e.hold ?? 0;
  return x < e.decay ? 1 + (e.sustain - 1) * envelopeCurve(x / e.decay, e.decayBend ?? 0) : e.sustain;
}
/** Schedule a curved Web Audio ramp; straight segments use a linear ramp. */
export function rampCurve(param: AudioParam, from: number, to: number, start: number, duration: number, bend: number) {
  if (!bend || duration < .002) { param.linearRampToValueAtTime(to, start + Math.max(.0001, duration)); return; }
  const points = new Float32Array(33);
  for (let i = 0; i < points.length; ++i) points[i] = from + (to - from) * envelopeCurve(i / (points.length - 1), bend);
  // A curve may not share its start time with an earlier set-value event.
  param.setValueCurveAtTime(points, start + 1e-5, duration - 1e-5);
}
