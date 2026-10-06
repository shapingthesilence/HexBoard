import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultConfig, type LabConfig } from "./model.ts";
import { RAM_EDIT_DELAY_MS, RamSettingsSync, ramUpdates } from "./ramSync.ts";

function configuration(): LabConfig {
  return { ...defaultConfig(), capabilities: ["curve_xy", "pressure_ends", "pressure_curve", "engines"],
    curves: { on: [40000, 27000, 14000, 1800].map((us, i) => ({ us, velocity: 1 + 42 * i })),
      off: [40000, 27000, 14000, 1800].map((us, i) => ({ us, velocity: 1 + 42 * i })) } };
}
function harness(send = vi.fn(async (_command: string) => {})) {
  const acknowledged: LabConfig[] = [], statuses: string[] = [];
  const sync = new RamSettingsSync(action => action(send), next => acknowledged.push(next), status => statuses.push(status));
  const initial = configuration(); sync.reset(initial); sync.setPaused(false);
  return { sync, initial, send, acknowledged, statuses };
}
describe("automatic calibration RAM updates", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("coalesces edits after inactivity and never sends a flash or scanner command", async () => {
    const h = harness();
    h.sync.update({ ...h.initial, pressureCurve: [10000, 32768, 49151] });
    await vi.advanceTimersByTimeAsync(300);
    h.sync.update({ ...h.initial, pressureCurve: [12000, 32768, 49151] });
    await vi.advanceTimersByTimeAsync(RAM_EDIT_DELAY_MS - 1);
    expect(h.send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.send.mock.calls).toEqual([["velocity pressure_curve 12000 32768 49151"]]);
    expect(h.acknowledged.at(-1)!.pressureCurve[0]).toBe(12000);
    expect(h.statuses.at(-1)).toBe("synced");
  });
  it("waits for released keys and then applies the latest edit", async () => {
    let held = true;
    const h = harness(vi.fn(async () => { if (held) throw Error("release keys first"); }));
    h.sync.update({ ...h.initial, engine: h.initial.engine.map((p, i) => i === 2 ? 80 : p) });
    await vi.advanceTimersByTimeAsync(400);
    expect(h.statuses.at(-1)).toBe("held"); expect(h.acknowledged).toHaveLength(1);
    held = false; await vi.advanceTimersByTimeAsync(400);
    expect(h.acknowledged.at(-1)!.engine[2]).toBe(80); expect(h.statuses.at(-1)).toBe("synced");
  });
  it("retains edits made during an in-flight acknowledgment", async () => {
    let finish!: () => void;
    const h = harness(vi.fn(() => new Promise<void>(resolve => { finish = resolve; })));
    h.sync.update({ ...h.initial, pressureCurve: [10000, 32768, 49151] });
    await vi.advanceTimersByTimeAsync(400);
    h.sync.update({ ...h.initial, pressureCurve: [12000, 32768, 49151] });
    finish(); await vi.advanceTimersByTimeAsync(0);
    expect(h.acknowledged.at(-1)!.pressureCurve[0]).toBe(10000);
    await vi.advanceTimersByTimeAsync(400); finish(); await vi.advanceTimersByTimeAsync(0);
    expect(h.acknowledged.at(-1)!.pressureCurve[0]).toBe(12000);
    expect(h.send).toHaveBeenCalledTimes(2);
  });
  it("pauses for capture and resumes pending work without applying stale edits after reset", async () => {
    const h = harness();
    h.sync.update({ ...h.initial, pressureCurve: [10000, 32768, 49151] }); h.sync.setPaused(true);
    await vi.advanceTimersByTimeAsync(1000); expect(h.send).not.toHaveBeenCalled();
    h.sync.setPaused(false); await vi.advanceTimersByTimeAsync(0); expect(h.send).toHaveBeenCalledTimes(1);
    h.sync.update({ ...h.initial, pressureCurve: [12000, 32768, 49151] }); h.sync.reset(h.initial);
    await vi.advanceTimersByTimeAsync(1000); expect(h.send).toHaveBeenCalledTimes(1);
  });
  it("validates the whole batch before changing RAM and preserves the last valid settings", async () => {
    const h = harness();
    h.sync.update({ ...h.initial, thresholds: [20000, 10000, 3277], pressureCurve: [10000, 32768, 49151] });
    await vi.advanceTimersByTimeAsync(400);
    expect(h.statuses.at(-1)).toBe("invalid"); expect(h.send).not.toHaveBeenCalled(); expect(h.acknowledged.at(-1)).toBe(h.initial);
  });
  it("records only acknowledged groups on a partial failure, and stops on cleanup", async () => {
    const h = harness(vi.fn(async command => { if (command.includes("pressure_curve")) throw Error("USB lost"); }));
    h.sync.update({ ...h.initial, pressure: [2, 50000, 65535, 60000], pressureCurve: [10000, 32768, 49151] });
    await vi.advanceTimersByTimeAsync(400);
    expect(h.acknowledged.at(-1)!.pressure[0]).toBe(2); expect(h.acknowledged.at(-1)!.pressureCurve).toEqual(h.initial.pressureCurve);
    expect(h.statuses.at(-1)).toBe("error");
    h.sync.update({ ...h.initial, pressureCurve: [12000, 32768, 49151] }); h.sync.stop();
    await vi.advanceTimersByTimeAsync(1000); expect(h.send).toHaveBeenCalledTimes(2);
  });
  it("exposes only the latest valid RAM edits when navigating before debounce", () => {
    const h = harness();
    h.sync.update({ ...h.initial, pressureCurve: [10000, 32768, 49151] });
    h.sync.update({ ...h.initial, pressureCurve: [12000, 32768, 49151] });
    expect(h.sync.pendingUpdates().map(p => p.command)).toEqual(["velocity pressure_curve 12000 32768 49151"]);
    h.sync.update({ ...h.initial, pressureCurve: [60000, 32768, 49151] });
    expect(h.sync.pendingUpdates()).toEqual([]);
  });
  it("enables an edited timing curve without changing a disabled curve merely on connect", () => {
    const initial = configuration();
    expect(ramUpdates(initial, initial)).toEqual([]);
    const changed = { ...initial, customCurves: { ...initial.customCurves, off: true } };
    const updates = ramUpdates(changed, initial);
    expect(updates).toHaveLength(1); expect(updates[0].command).toMatch(/^velocity curve_xy off /);
  });
});
