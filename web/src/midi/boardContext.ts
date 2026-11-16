import { CapabilityFlag, type HelloResponsePayload } from "../protocol/index.ts";
import { hexBoardGeometry } from "../catalogs/hexBoardGeometry.ts";

export type BoardId = "hexboard" | "advanced";
export const advancedHardwareVersion = 0x20;
export const boards = {
  hexboard: { id: "hexboard", label: "HexBoard", navigation: "command-buttons", recovery: "Hold the encoder for five seconds to exit an abandoned lesson.", synth: "hexboard-v3" },
  advanced: { id: "advanced", label: "HexBoard Advanced", navigation: "joystick", recovery: "Stop in this tab. For an abandoned lesson, use Web stop in Main Bring-up or restart the board.", synth: null }
} as const;
export function boardForHello(hello?: HelloResponsePayload | null) {
  return hello?.hardwareVersion === advancedHardwareVersion ? boards.advanced : boards.hexboard;
}
export function canPreviewGeometry(hello?: HelloResponsePayload | null) {
  const required = CapabilityFlag.UserTuning | CapabilityFlag.UserLayout;
  return Boolean(hello && (hello.capabilityFlags & required) === required);
}
export function canEditConnectedSynth(hello?: HelloResponsePayload | null) {
  return Boolean(hello && boardForHello(hello).synth && (hello.capabilityFlags & CapabilityFlag.SynthPreset) && hello.synthPresetSchemaVersion >= 3);
}
// Portable content keeps logical IDs. Translation is explicit at the device
// boundary, so saved courses, fingering, centers and overrides remain stable.
export const advancedNoteSurface = hexBoardGeometry.filter(key => key.role === "note")
  .map((key, hallKey) => ({ ...key, hallKey, coordCol: key.coordCol - 1 }));
export function advancedHallKey(contentKey: number) { return advancedNoteSurface.find(key => key.index === contentKey)?.hallKey; }
export function advancedContentKey(hallKey: number) { return advancedNoteSurface[hallKey]?.index; }

// Unreleased Advanced tools are available only with a positively identified board.
export function hasAdvancedDevice(hello?: HelloResponsePayload | null) {
  return Boolean(hello && boardForHello(hello).id === "advanced");
}
