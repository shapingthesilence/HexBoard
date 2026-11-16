#pragma once

#include "../FirmwareModule.h"
#include "LedColor.h"
#include "../config/FeatureFlags.h"
#include "../model/ScalePalettePreset.h"

// Transient HSV retains fractional brightness; persisted colorDef stays unchanged.
struct LedHsv {
  float hue = 0, sat = 0, val = 0;
  LedHsv() = default;
  template <typename S, typename V>
  LedHsv(float h, S s, V v) : hue(h), sat(static_cast<float>(s)), val(static_cast<float>(v)) {}
  LedHsv(colorDef c) : hue(c.hue), sat(c.sat), val(c.val) {}
  LedHsv tint() const { return {hue, std::min(sat, float(SAT_MODERATE)), VALUE_FULL}; }
  LedHsv shade() const { return {hue, std::min(sat, float(SAT_MODERATE)), VALUE_LOW}; }
};
inline float scaleLedLevel(float value, byte level) { return value * level / 255.0f; }

extern bool settingsFileMissingOnBoot;

void setupLEDs();
void clearLEDs();
void clearLEDsAndWait();
void runBootLedSelfCheckSplash();
void finishBootLedSelfCheck();
void setLEDcolorCodes();
LedColor RAM_FUNC(getLEDcode)(LedHsv c);
LedColor RAM_FUNC(getLedPerceptualRgb16)(LedHsv c);
LedColor RAM_FUNC(applyLedGamma16)(LedColor color);
bool RAM_FUNC(getBaseLedColorForPitchSteps)(int16_t pitchSteps, LedHsv& colorOut);
void RAM_FUNC(resetVelocityLEDs)();
void RAM_FUNC(resetWheelLEDs)();
LedColor RAM_FUNC(applyNotePixelColor)(byte x);
void lightUpLEDs();
