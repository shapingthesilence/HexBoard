import { ColorMode, resolveTuningBundleButtonColor } from "../catalogs/layoutsCatalog.ts";
import type { KeyLight } from "./majorScale.ts";

export interface LessonLedColor { hue: number; saturation: number; value: number }

// Pitch class owns hue, lesson state only changes brightness. These 7-bit
// values go directly to delegated LEDs; hardware applies its normal hue/gamma
// calibration and current limit. The screen shows nominal rainbow hues.
export function lessonLedColor(note: number | null, state: KeyLight): LessonLedColor {
  if (note === null || state === "off") return { hue: 0, saturation: 0, value: 0 };
  const { color } = resolveTuningBundleButtonColor({
    degreeColors: [], cycleLength: 12, stepsFromC: note - 60,
    keyDegree: 0, defaultColorMode: ColorMode.Rainbow, periodCents: 1200
  });
  return {
    hue: Math.round(color.hueTenthDegrees * 127 / 3600),
    saturation: Math.round(color.saturation * 127 / 255),
    value: state === "target" ? 127 : state === "held" ? 110 : 42
  };
}

export function lessonScreenColor({ hue, saturation, value }: LessonLedColor) {
  const h = hue * 6 / 127, s = saturation / 127, v = value / 127;
  const channels = [5, 3, 1].map((offset) => {
    const k = (offset + h) % 6;
    return v * (1 - s * Math.max(0, Math.min(k, 4 - k, 1)));
  });
  const luminance = channels.map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    .reduce((sum, c, index) => sum + c * [0.2126, 0.7152, 0.0722][index], 0);
  return {
    fill: `rgb(${channels.map((c) => Math.round(c * 255)).join(" ")})`,
    text: luminance > 0.179 ? "#101914" : "#ffffff"
  };
}
