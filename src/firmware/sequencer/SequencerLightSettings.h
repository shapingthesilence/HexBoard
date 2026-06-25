#pragma once

#include "../FirmwareModule.h"
#include "../model/ScalePalettePreset.h"

namespace sequencer {

constexpr byte kStepAccentOff = 0;
constexpr byte kStepAccentEveryDefault = 4;

constexpr byte kStepColorNote = 0;
constexpr byte kStepColorRegular = 1;
constexpr byte kStepColorDefault = kStepColorRegular;

constexpr byte kStepLightOff = 0;
constexpr byte kStepLightMedium = 112;
constexpr byte kStepLightHigh = 192;
constexpr byte kStepLightHighest = 255;

constexpr byte kStepHueRed = 0;
constexpr byte kStepHueOrange = 1;
constexpr byte kStepHueYellow = 2;
constexpr byte kStepHueLime = 3;
constexpr byte kStepHueGreen = 4;
constexpr byte kStepHueTeal = 5;
constexpr byte kStepHueCyan = 6;
constexpr byte kStepHueLightBlue = 7;
constexpr byte kStepHueBlue = 8;
constexpr byte kStepHueIndigo = 9;
constexpr byte kStepHuePurple = 10;
constexpr byte kStepHueMagenta = 11;
constexpr byte kStepHuePink = 12;
constexpr byte kStepHueDefault = kStepHueIndigo;

byte stepAccentEvery();
byte stepColorMode();
byte stepHue();
byte& stepAccentEveryMutable();
byte& stepColorModeMutable();
byte& stepHueMutable();

byte normalizeStepAccentEvery(byte value);
byte normalizeStepColorMode(byte value);
byte normalizeStepHue(byte value);
void normalizeLightSettings();
bool stepIsAccented(byte stepIndex);
float stepHueValue(byte hueSetting);

void applyLightSettingsFromProfile();
void persistLightSettingsToProfile();

}  // namespace sequencer
