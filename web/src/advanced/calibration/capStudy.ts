import type { PressureSample } from "./model.ts";

export interface StudySettings { steadyMs: number; tolerance: number; blocks: number; samplesPerBlock: number }
export interface Reading { raw: number; frame: number; time: number; receivedMs: number }
export interface CapResult { key: number; distanceMm: number; mean: number; peakToPeak: number; stddev: number; blockMeans: number[]; samples: Reading[] }
export type Phase = "cap" | "zero" | "release" | "hold" | "collect" | "paused" | "done";
export const defaultStudySettings: StudySettings = { steadyMs: 1000, tolerance: 6, blocks: 3, samplesPerBlock: 5 };
export const defaultCaps = Array.from({ length: 21 }, (_, i) => i / 5);
export function parseCaps(text: string) {
  const caps = text.split(/[,\s]+/).filter(Boolean).map(Number);
  if (caps.length < 2 || caps.length > 51 || caps[0] !== 0 || caps.some((n, i) => !Number.isFinite(n) || n < 0 || n > 5 || (i > 0 && n <= caps[i - 1])))
    throw Error("Enter increasing cap distances starting with 0, up to 5 mm.");
  return caps;
}
function spread(samples: Reading[]) { return Math.max(...samples.map(s => s.raw)) - Math.min(...samples.map(s => s.raw)); }
export class CapStudy {
  phase: Phase = "cap";
  capIndex = 0;
  keyIndex = 0;
  results: CapResult[] = [];
  window: Reading[] = [];
  collecting: Reading[] = [];
  last?: Reading;
  released = 0;
  constructor(readonly keys: number[], readonly caps: number[], readonly settings: StudySettings) {
    if (!keys.length || keys.length > 133 || new Set(keys).size !== keys.length || keys.some(k => !Number.isInteger(k) || k < 0 || k > 132)) throw Error("Select distinct keys from 0 to 132.");
    parseCaps(caps.join(","));
    const { steadyMs, tolerance, blocks, samplesPerBlock } = settings;
    if (![steadyMs, tolerance, blocks, samplesPerBlock].every(Number.isInteger) || steadyMs < 500 || steadyMs > 10000 || tolerance < 1 || tolerance > 64 || blocks < 1 || blocks > 10 || samplesPerBlock < 3 || samplesPerBlock > 50) throw Error("Check stability and sampling settings.");
    this.keys = [...keys]; this.caps = [...caps]; this.settings = { ...settings };
  }
  get key() { return this.keys[this.keyIndex]; }
  get distance() { return this.caps[this.capIndex]; }
  get active() { return this.phase !== "done"; }
  private clear() { this.window = []; this.collecting = []; this.last = undefined; this.released = 0; }
  confirmCap() { if (this.phase === "cap") this.beginKey(); }
  private beginKey() { this.clear(); this.phase = this.distance === 0 ? "zero" : "release"; }
  confirmZero() { if (this.phase === "zero") { this.clear(); this.phase = "hold"; } }
  pause() { if (this.phase !== "done") { this.clear(); this.phase = "paused"; } }
  stop() { this.clear(); this.phase = "done"; }
  resume() { if (this.phase === "paused") { this.clear(); this.phase = "cap"; } }
  retryPrevious() {
    const previous = this.results.pop(); if (!previous) return;
    this.capIndex = this.caps.indexOf(previous.distanceMm); this.keyIndex = this.keys.indexOf(previous.key);
    this.clear(); this.phase = "cap";
  }
  push(sample: PressureSample, now: number) {
    if (!["release", "hold", "collect"].includes(this.phase) || sample.key !== this.key || !Number.isFinite(now) || !Number.isInteger(sample.raw) || sample.raw < 0 || sample.raw > 4095) return;
    const reading: Reading = { raw: sample.raw, frame: sample.frame, time: sample.time, receivedMs: now };
    if (this.last) {
      const frameAdvance = (sample.frame - this.last.frame) >>> 0;
      const timeAdvance = (sample.time - this.last.time) >>> 0;
      if (!frameAdvance || frameAdvance > 0x7fffffff || !timeAdvance || timeAdvance > 0x7fffffff || now <= this.last.receivedMs) return;
      if (now - this.last.receivedMs > 350 || timeAdvance > 350000) { this.clear(); this.phase = this.distance === 0 ? "hold" : "release"; }
    }
    this.last = reading;
    const baseline = this.results.find(r => r.key === this.key && r.distanceMm === 0)?.mean;
    const excursion = baseline === undefined ? 0 : Math.abs(sample.raw - baseline);
    const restTolerance = Math.max(8, Math.min(12, this.settings.tolerance * 2));
    if (this.phase === "release") {
      this.released = excursion <= restTolerance ? this.released + 1 : 0;
      if (this.released >= 2) { this.phase = "hold"; this.window = []; }
      return;
    }
    if (this.distance > 0 && excursion <= restTolerance) { this.window = []; this.collecting = []; this.phase = "hold"; return; }
    this.window.push(reading);
    // Retain the sample immediately before the time boundary to prove dwell.
    while (this.window.length > 1 && now - this.window[1].receivedMs >= this.settings.steadyMs) this.window.shift();
    if (spread(this.window) > this.settings.tolerance || (this.collecting.length && spread([...this.collecting, reading]) > this.settings.tolerance)) {
      this.window = [reading]; this.collecting = []; this.phase = "hold"; return;
    }
    if (this.phase === "hold" && this.window.length >= 3 && now - this.window[0].receivedMs >= this.settings.steadyMs) this.phase = "collect";
    if (this.phase !== "collect") return;
    this.collecting.push(reading);
    const total = this.settings.blocks * this.settings.samplesPerBlock;
    if (this.collecting.length < total) return;
    const samples = [...this.collecting], mean = samples.reduce((sum, s) => sum + s.raw, 0) / total;
    const blockMeans = Array.from({ length: this.settings.blocks }, (_, i) => samples.slice(i * this.settings.samplesPerBlock, (i + 1) * this.settings.samplesPerBlock).reduce((sum, s) => sum + s.raw, 0) / this.settings.samplesPerBlock);
    this.results.push({ key: this.key, distanceMm: this.distance, mean, peakToPeak: spread(samples), stddev: Math.sqrt(samples.reduce((sum, s) => sum + (s.raw - mean) ** 2, 0) / total), blockMeans, samples });
    this.keyIndex++;
    if (this.keyIndex === this.keys.length) { this.keyIndex = 0; this.capIndex++; this.clear(); this.phase = this.capIndex === this.caps.length ? "done" : "cap"; }
    else this.beginKey();
  }
}
export function studyCsv(study: CapStudy) {
  // Wide raw-ADC format accepted by hall_absolute_curve.py. Incomplete cap rows
  // are omitted so blanks cannot be mistaken for measured zeros by analysis.
  const rows: Array<Array<string | number>> = [["Distance Pressed", ...study.keys.map(k => `Key #${k}`)]];
  for (const distance of study.caps) {
    const results = study.keys.map(key => study.results.find(r => r.key === key && r.distanceMm === distance));
    if (results.every(Boolean)) rows.push([distance, ...results.map(r => r!.mean)]);
  }
  return rows.map(row => row.join(",")).join("\r\n") + "\r\n";
}
