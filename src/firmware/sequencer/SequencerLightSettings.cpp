#include "SequencerLightSettings.h"

#include "../storage/PersistentDataModels.h"
#include "../storage/Settings.h"

namespace sequencer {
namespace {

byte accentEvery = kStepAccentEveryDefault;
byte colorMode = kStepColorDefault;
byte hue = kStepHueDefault;

}  // namespace

byte stepAccentEvery() {
  return normalizeStepAccentEvery(accentEvery);
}

byte stepColorMode() {
  return normalizeStepColorMode(colorMode);
}

byte stepHue() {
  return normalizeStepHue(hue);
}

byte& stepAccentEveryMutable() {
  return accentEvery;
}

byte& stepColorModeMutable() {
  return colorMode;
}

byte& stepHueMutable() {
  return hue;
}

byte normalizeStepAccentEvery(byte value) {
  return (value >= 2 && value <= 8) ? value : kStepAccentOff;
}

byte normalizeStepColorMode(byte value) {
  return (value == kStepColorRegular) ? kStepColorRegular : kStepColorNote;
}

byte normalizeStepHue(byte value) {
  return (value <= kStepHuePink) ? value : kStepHueDefault;
}

void normalizeLightSettings() {
  accentEvery = stepAccentEvery();
  colorMode = stepColorMode();
  hue = stepHue();
}

bool stepIsAccented(byte stepIndex) {
  byte every = stepAccentEvery();
  if (every < 2) {
    return false;
  }
  return (stepIndex % every) == 0;
}

float stepHueValue(byte hueSetting) {
  switch (normalizeStepHue(hueSetting)) {
    case kStepHueRed: return HUE_RED;
    case kStepHueOrange: return HUE_ORANGE;
    case kStepHueYellow: return HUE_YELLOW;
    case kStepHueLime: return HUE_LIME;
    case kStepHueGreen: return HUE_GREEN;
    case kStepHueTeal: return 162.0f;
    case kStepHueCyan: return HUE_CYAN;
    case kStepHueLightBlue: return 198.0f;
    case kStepHueBlue: return HUE_BLUE;
    case kStepHuePurple: return HUE_PURPLE;
    case kStepHueMagenta: return HUE_MAGENTA;
    case kStepHuePink: return 342.0f;
    case kStepHueIndigo:
    default:
      return HUE_INDIGO;
  }
}

void applyLightSettingsFromProfile() {
  accentEvery = normalizeStepAccentEvery(settingValue(SettingKey::SequencerStepAccentEvery));
  colorMode = normalizeStepColorMode(settingValue(SettingKey::SequencerStepColorMode));
  hue = normalizeStepHue(settingValue(SettingKey::SequencerStepHue));

  settings[static_cast<uint8_t>(SettingKey::SequencerStepAccentEvery)] = accentEvery;
  settings[static_cast<uint8_t>(SettingKey::SequencerStepColorMode)] = colorMode;
  settings[static_cast<uint8_t>(SettingKey::SequencerStepHue)] = hue;
}

void persistLightSettingsToProfile() {
  normalizeLightSettings();
  settings[static_cast<uint8_t>(SettingKey::SequencerStepAccentEvery)] = accentEvery;
  settings[static_cast<uint8_t>(SettingKey::SequencerStepColorMode)] = colorMode;
  settings[static_cast<uint8_t>(SettingKey::SequencerStepHue)] = hue;
  markSettingsDirty();
}

}  // namespace sequencer
