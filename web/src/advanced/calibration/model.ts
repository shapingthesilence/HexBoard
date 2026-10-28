// Speeds are integer micrometers/second (1000 = 1 mm/s).
export interface CurvePoint { speed: number; velocity: number }
export interface Strike {
  key: number; velocity: number; travel: number; frame: number; kind: "on" | "off";
  us: number | null; speed: number | null; engine?: number; measurement?: number; flags?: number;
}
export interface PressureSample {
  key: number; frame: number; time: number; raw: number; travel: number;
  pressure: number; valid: boolean; mode: number; start: number; fullEnd: number; damperEnd: number; firmTravel?: number;
}
export interface CapturePoint { frame: number; t: number; raw: number; time: number; mm: number; delta: number }
export interface Capture {
  count: number; channelCount: number; trigger: number; result: number; gaps: number;
  thresholds: number[];
  channels: Array<{ key: number; baseline: number; polarity: number; valid: boolean; rest: number; points: CapturePoint[] }>;
}
export interface LabConfig {
  capabilities: string[]; thresholds: number[]; engine: number[];
  minimum: number; maximum: number; pressure: number[]; pressureCurve: number[];
  curves: Record<"on" | "off", CurvePoint[]>;
  customCurves: Record<"on" | "off", boolean>;
}
export const defaultConfig = (): LabConfig => ({
  capabilities: [], thresholds: [7864, 45875, 3277],
  engine: [0, 3, 64, 0, 492, 8028, 328, 16384, 1638, 49151, 3277, 30000],
  minimum: 1, maximum: 127, pressure: [2, 55705, 65535, 65535],
  pressureCurve: [16384, 32768, 49151],
  curves: { on: [], off: [] }, customCurves: { on: false, off: false }
});
export function fields(line: string): Record<string, string> {
  return Object.fromEntries(line.split(",").slice(1).filter(part => part.includes("=")).map(part => {
    const i = part.indexOf("="); return [part.slice(0, i), part.slice(i + 1)];
  }));
}
export function validPoints(points: CurvePoint[]) {
  return points.length >= 4 && points.length <= 8 && points.every((p, i) =>
    Boolean(p) && Number.isInteger(p.speed) && p.speed >= 1 && p.speed <= 4000000 &&
    Number.isInteger(p.velocity) && p.velocity >= 1 && p.velocity <= 127 &&
    (!i || (Boolean(points[i-1]) && p.speed >= points[i-1].speed+100 && p.velocity >= points[i-1].velocity)));
}
export function curveVelocity(points: CurvePoint[], speed: number): number {
  if (!points.length) return 0;
  if (speed <= points[0].speed) return points[0].velocity;
  for (let i=1; i<points.length; i++) if (speed <= points[i].speed)
    return Math.round(points[i-1].velocity + (speed-points[i-1].speed) *
      (points[i].velocity-points[i-1].velocity)/(points[i].speed-points[i-1].speed));
  return points.at(-1)!.velocity;
}
export function movePoint(points: CurvePoint[], index: number, speed: number, velocity: number) {
  return points.map((p, i) => i !== index ? p : ({
    speed: Math.max(index ? points[index-1].speed+100 : 1,
      Math.min(index === points.length-1 ? 4000000 : points[index+1].speed-100, Math.round(speed))),
    velocity: Math.max(index ? points[index-1].velocity : 1,
      Math.min(index === points.length-1 ? 127 : points[index+1].velocity, Math.round(velocity)))
  }));
}
export function respacePoints(points: CurvePoint[], count: number) {
  if (!points.length) return [];
  const soft = Math.min(points[0].speed, 4000000-(count-1)*100);
  const hard = Math.max(points.at(-1)!.speed, soft+(count-1)*100);
  return Array.from({ length: count }, (_, i) => {
    const speed = Math.round(soft+(hard-soft)*i/(count-1));
    return { speed, velocity: curveVelocity(points, speed) };
  });
}
export function movePressurePoint(curve: number[], i: number, value: number) {
  return curve.map((p, j) => j !== i ? p : Math.max(i ? curve[i - 1] : 0,
    Math.min(i < 2 ? curve[i + 1] : 65535, Math.round(value))));
}
// Reject incomplete config responses instead of replacing a usable draft with defaults.
export function parseConfig(lines: string[]): LabConfig {
  const result = defaultConfig();
  let threshold = false, settings = false, completed = false;
  const manual: number[] = [];
  for (const line of lines) {
    const p = line.split(","), n = p.slice(2).map(Number);
    if (p[0] !== "tr") continue;
    switch (p[1]) {
      case "cap": result.capabilities = p.slice(2); break;
      case "c": result.thresholds = n; threshold = true; break;
      case "p": result.minimum = n[4]; result.maximum = n[5]; settings = true; break;
      case "engine": result.engine = n; break;
      case "pressure": result.pressure = n; break;
      case "pressure_curve": result.pressureCurve = n; break;
      case "v": manual[n[0]] = n[1]; break;
      case "curve": if (p[2] === "on" || p[2] === "off") { result.curves[p[2]] = []; result.customCurves[p[2]] = Number(p[3]) > 0; } break;
      case "xy": if (p[2] === "on" || p[2] === "off") result.curves[p[2]][Number(p[3])] = { speed: Number(p[4]), velocity: Number(p[5]) }; break;
      case "config_end": completed = true; break;
    }
  }
  if (!completed || !threshold || !settings || result.thresholds.length !== 3 ||
      result.engine.length !== 12 || result.pressure.length !== 4 || result.pressureCurve.length !== 3 ||
      [...result.thresholds, ...result.engine, ...result.pressure, ...result.pressureCurve, result.minimum, result.maximum].some(n => !Number.isInteger(n) || n < 0))
    throw Error("The board returned incomplete calibration settings. Refresh or reconnect.");
  if (!result.capabilities.includes("curve_speed"))
    throw Error("Update the board firmware to use speed-based velocity curves.");
  for (const kind of ["on", "off"] as const) {
    if (!result.curves[kind].length) result.curves[kind] = manual.map((speed, i) => ({ speed,
      velocity: Math.round(result.minimum + (result.maximum - result.minimum) * i / (manual.length - 1)) }));
    if (!validPoints(result.curves[kind]) || Object.keys(result.curves[kind]).length !== result.curves[kind].length)
      throw Error("The board returned an invalid velocity curve.");
  }
  return result;
}
export function engineCommand(config: LabConfig) {
  const args = [...config.engine, ...config.thresholds, config.minimum, config.maximum];
  const [start, end, release] = config.thresholds;
  if (args.some(n => !Number.isInteger(n) || n < 0) || !(release < start && start < end) ||
      config.minimum < 1 || config.maximum > 127 || config.minimum > config.maximum ||
      config.engine[5] <= config.engine[4] || config.engine[7] <= config.engine[6] || config.engine[9] <= config.engine[8])
    throw Error(!(release < start && start < end)
      ? "Release must be below Arm/Start, and Arm/Start must be below Trigger/End. For Fixed Velocity try Release 0.04 mm, Re-arm 0.06 mm, Trigger 0.10 mm."
      : "Use whole-number velocity limits from 1 to 127, minimum no greater than maximum, and Hard measurements greater than Soft.");
  return `velocity engine ${args.join(" ")}`;
}
