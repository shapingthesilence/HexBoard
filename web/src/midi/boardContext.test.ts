import { describe, it, expect } from "vitest";
import { hasAdvancedDevice, advancedNoteSurface, advancedHallKey, advancedContentKey, boards, boardForHello, canEditConnectedSynth, canPreviewGeometry } from "./boardContext.ts";
import { CapabilityFlag, type HelloResponsePayload } from "../protocol/index.ts";
const hello = { negotiatedMajor: 1, hardwareVersion: 0x20, capabilityFlags: CapabilityFlag.UserTuning | CapabilityFlag.UserLayout | CapabilityFlag.AtomicGeometryPreview, synthPresetSchemaVersion: 0 } as HelloResponsePayload;
describe("shared board context", () => {
  it("translates all 133 playable content IDs without assigning navigation slots", () => {
    expect(advancedNoteSurface).toHaveLength(133);
    for (const key of advancedNoteSurface) expect(advancedContentKey(advancedHallKey(key.index)!)).toBe(key.index);
    for (const index of [0,20,40,60,80,100,120,140]) expect(advancedHallKey(index)).toBeUndefined();
    expect(advancedHallKey(65)).toBe(61);
    expect(advancedContentKey(132)).toBe(139);
  });
  it("resolves connected and offline contexts without enabling deferred synthesis", () => {
    expect(hasAdvancedDevice(null)).toBe(false);
    expect(hasAdvancedDevice({ ...hello, hardwareVersion: 2 })).toBe(false);
    expect(hasAdvancedDevice(hello)).toBe(true);
    expect(boardForHello(hello)).toBe(boards.advanced);
    expect(canPreviewGeometry(hello)).toBe(true);
    expect(canEditConnectedSynth(hello)).toBe(false);
    expect(boards.advanced.navigation).toBe("joystick");
    expect(boards.hexboard.navigation).toBe("command-buttons");
    expect(canEditConnectedSynth(null)).toBe(false);
    expect(canEditConnectedSynth({ ...hello, hardwareVersion: 2, capabilityFlags: CapabilityFlag.SynthPreset, synthPresetSchemaVersion: 7 })).toBe(true);
  });
});
