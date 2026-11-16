import { describe, expect, it, vi } from "vitest";
import { withAdvancedContentMaintenance, withStoppedSynth } from "./contentMaintenance.ts";
function synth(state = "playing", instrument = 5) {
  return { status: vi.fn(async () => ({ state, instrument, bend: 1.25 })), stopAndWait: vi.fn(async () => {}), start: vi.fn(async (_instrument: number) => {}), bend: vi.fn(async (_semitones: number) => {}), close: vi.fn() };
}
describe("Advanced content maintenance", () => {
  it("stops before saving and resumes the same instrument", async () => {
    const control = synth();
    const operation = vi.fn(async () => { expect(control.stopAndWait).toHaveBeenCalledOnce(); expect(control.start).not.toHaveBeenCalled(); return 7; });
    expect(await withStoppedSynth(control, operation)).toBe(7);
    expect(control.start).toHaveBeenCalledWith(5); expect(control.bend).toHaveBeenCalledWith(1.25); expect(control.close).toHaveBeenCalledOnce();
  });
  it("restores playback and closes after a rejected write", async () => {
    const control = synth("playing", 6);
    await expect(withStoppedSynth(control, async () => { throw Error("Storage full"); })).rejects.toThrow("Storage full");
    expect(control.start).toHaveBeenCalledWith(6); expect(control.close).toHaveBeenCalledOnce();
  });
  it("keeps a stopped synth stopped and closes if restart fails", async () => {
    const stopped = synth("stopped"); await withStoppedSynth(stopped, async () => {});
    expect(stopped.start).not.toHaveBeenCalled(); expect(stopped.stopAndWait).not.toHaveBeenCalled();
    const control = synth();control.start.mockRejectedValueOnce(Error("Disconnected"));
    await expect(withStoppedSynth(control, async () => {})).rejects.toThrow("Disconnected"); expect(control.close).toHaveBeenCalledOnce();
  });
  it("does not use synth controls on the original board", async () => {
    const operation = vi.fn(async () => 3);
    expect(await withAdvancedContentMaintenance({ label: "original", send: vi.fn(), subscribe: vi.fn() }, false, operation)).toBe(3);
  });
});
