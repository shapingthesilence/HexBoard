import { HEXBOARD_COMMAND_INDICES } from "../catalogs/hexBoardGeometry.ts";
import type { LessonLedColor } from "./lessonColors.ts";

// Top to bottom on the separate, staggered side bank (portrait orientation).
export const courseControls = [
  { index: HEXBOARD_COMMAND_INDICES[0], label: "Next lesson / Continue", short: "Next / Continue", color: { hue: 78, saturation: 105, value: 110 } },
  { index: HEXBOARD_COMMAND_INDICES[2], label: "Hear example", short: "Hear example", color: { hue: 61, saturation: 110, value: 110 } },
  { index: HEXBOARD_COMMAND_INDICES[4], label: "Toggle hints", short: "Hints", color: { hue: 19, saturation: 110, value: 110 } },
  { index: HEXBOARD_COMMAND_INDICES[6], label: "Repeat lesson", short: "Repeat", color: { hue: 10, saturation: 110, value: 110 } },
] as const satisfies readonly { index: number; label: string; short: string; color: LessonLedColor }[];

export function courseControl(index: number) { return courseControls.find(control => control.index === index); }
export function courseControlLight(index: number, enabled: boolean, hints = true): LessonLedColor {
  const control = courseControl(index);
  return control && enabled && (index !== HEXBOARD_COMMAND_INDICES[4] || hints) ? control.color : { hue: 0, saturation: 0, value: 0 };
}
