import { engineCommand, validPoints, type LabConfig } from "./model.ts";

export const RAM_EDIT_DELAY_MS = 400;
export type RamSyncStatus = "synced" | "pending" | "applying" | "held" | "invalid" | "error";
export interface RamUpdate { command: string; acknowledge: (previous: LabConfig) => LabConfig }
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// Validate the complete edit batch before sending any commands. Acknowledged
// groups advance independently, so a later failure never conceals partial work.
export function ramUpdates(draft: LabConfig, applied: LabConfig): RamUpdate[] {
  const updates: RamUpdate[] = [];
  const model = (c: LabConfig) => [c.engine, c.thresholds, c.minimum, c.maximum];
  if (!equal(model(draft), model(applied))) updates.push({ command: engineCommand(draft), acknowledge: previous => ({
    ...previous, engine: draft.engine, thresholds: draft.thresholds, minimum: draft.minimum, maximum: draft.maximum
  }) });
  for (const kind of ["on", "off"] as const) {
    if (equal(draft.curves[kind], applied.curves[kind]) && draft.customCurves[kind] === applied.customCurves[kind]) continue;
    if (!draft.capabilities.includes("curve_xy") || !validPoints(draft.curves[kind]))
      throw Error("Use 4–8 curve points with descending times, increasing velocities, and at least 0.1 ms between times.");
    updates.push({ command: `velocity curve_xy ${kind} ${draft.curves[kind].length} ${draft.curves[kind].flatMap(p => [p.us, p.velocity]).join(" ")}`,
      acknowledge: previous => ({ ...previous, curves: { ...previous.curves, [kind]: draft.curves[kind] }, customCurves: { ...previous.customCurves, [kind]: true } }) });
  }
  if (!equal(draft.pressure, applied.pressure)) {
    const [mode, start, fullEnd, damperEnd] = draft.pressure;
    if (!draft.capabilities.includes("pressure_ends") || mode < 0 || mode > 2 ||
        ![mode, start, fullEnd, damperEnd].every(Number.isInteger) || start < 0 || fullEnd < 1 || damperEnd <= start ||
        Math.max(start, fullEnd, damperEnd) > 65535) throw Error("Pressure end must exceed its start and stay within key travel.");
    updates.push({ command: `velocity pressure_config ${["off", "full", "damper"][mode]} ${start} ${fullEnd} ${damperEnd}`,
      acknowledge: previous => ({ ...previous, pressure: draft.pressure }) });
  }
  if (!equal(draft.pressureCurve, applied.pressureCurve)) {
    if (!draft.capabilities.includes("pressure_curve") || draft.pressureCurve.length !== 3 ||
        draft.pressureCurve.some((p, i) => !Number.isInteger(p) || p < 0 || p > 65535 || (i > 0 && p < draft.pressureCurve[i - 1])))
      throw Error("Pressure response must increase from 0% to 100%.");
    updates.push({ command: `velocity pressure_curve ${draft.pressureCurve.join(" ")}`,
      acknowledge: previous => ({ ...previous, pressureCurve: draft.pressureCurve }) });
  }
  return updates;
}

// Owns debounce, retries and acknowledgment independently of React. The caller
// serializes run() with capture/profile operations on the same MIDI connection.
// This controller never saves, erases, calibrates Hall keys, or changes scan timing.
export class RamSettingsSync {
  private desired?: LabConfig;
  private applied?: LabConfig;
  private timer?: ReturnType<typeof setTimeout>;
  private paused = true;
  private running = false;
  private active = true;
  private generation = 0;
  private editedAt = 0;
  constructor(private run: (action: (send: (command: string) => Promise<unknown>) => Promise<void>) => Promise<void>,
    private acknowledge: (config: LabConfig) => void,
    private status: (status: RamSyncStatus, detail?: string) => void) {}
  reset(config: LabConfig) {
    this.clear(); this.generation++; this.active = true;
    this.desired = this.applied = config; this.status("synced"); this.acknowledge(config);
  }
  update(config: LabConfig) {
    this.desired = config; this.editedAt = Date.now(); this.clear();
    if (this.applied && !equal(config, this.applied)) { this.status("pending"); this.schedule(RAM_EDIT_DELAY_MS); }
    else this.status("synced");
  }
  setPaused(value: boolean) {
    if (this.paused === value) return;
    this.paused = value;
    if (value) this.clear(); else this.schedule(Math.max(0, this.editedAt + RAM_EDIT_DELAY_MS - Date.now()));
  }
  pendingUpdates(): RamUpdate[] {
    if (!this.desired || !this.applied) return [];
    try { return ramUpdates(this.desired, this.applied); } catch { return []; }
  }
  stop() { this.active = false; this.generation++; this.clear(); }
  private clear() { if (this.timer) clearTimeout(this.timer); this.timer = undefined; }
  private schedule(ms: number) {
    if (!this.active || this.paused || this.running || !this.applied || equal(this.desired, this.applied)) return;
    this.clear(); this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, ms);
  }
  private async flush() {
    if (!this.active || this.paused || this.running || !this.desired || !this.applied) return;
    let updates: RamUpdate[];
    try { updates = ramUpdates(this.desired, this.applied); }
    catch (error) { this.status("invalid", error instanceof Error ? error.message : "Check your settings."); return; }
    if (!updates.length) { this.status("synced"); return; }
    const generation = this.generation;
    this.running = true; this.status("applying");
    let retry = false;
    try {
      await this.run(async send => {
        for (const update of updates) {
          if (!this.active || this.paused || this.generation !== generation) return;
          await send(update.command);
          if (!this.active || this.generation !== generation) return;
          this.applied = update.acknowledge(this.applied!); this.acknowledge(this.applied);
        }
      });
      if (this.active && this.generation === generation) {
        retry = !equal(this.desired, this.applied);
        this.status(retry ? "pending" : "synced");
      }
    } catch (error) {
      if (this.active && this.generation === generation) {
        const message = error instanceof Error ? error.message : "Could not apply settings.";
        retry = /release keys first/i.test(message);
        this.status(retry ? "held" : "error", retry ? "Release keys to apply pending edits." : message);
      }
    } finally {
      this.running = false;
      if (retry) this.schedule(Math.max(400, this.editedAt + RAM_EDIT_DELAY_MS - Date.now()));
    }
  }
}
