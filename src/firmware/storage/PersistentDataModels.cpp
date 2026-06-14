#include "../FirmwareModule.h"
#include "../model/ScalePalettePreset.h"
#include "../synth/SynthDefaults.h"
#include "PersistentDataModels.h"

// CRC32 computation for settings integrity verification
uint32_t crc32(const uint8_t* data, size_t length) {
  uint32_t crc = 0xFFFFFFFF;
  for (size_t i = 0; i < length; i++) {
    crc ^= data[i];
    for (int j = 0; j < 8; j++) {
      crc = (crc >> 1) ^ (0xEDB88320 & -(crc & 1));
    }
  }
  return ~crc;
}

// ==================================================
// Settings Definitions
// ==================================================
constexpr std::array<uint8_t, 4> legacySynthVibratoSpeedIndexToCurrent = {
  3, 5, 7, 9
};

inline uint8_t remapLegacyEnvelopeTimeIndex(uint8_t legacyIndex) {
  if (legacyIndex >= legacyEnvelopeTimeIndexToCurrent.size()) {
    return legacyEnvelopeTimeIndexToCurrent.back();
  }
  return legacyEnvelopeTimeIndexToCurrent[legacyIndex];
}

inline bool isEnvelopeTimeSettingKey(SettingKey key) {
  switch (key) {
    case SettingKey::EnvelopeAttackIndex:
    case SettingKey::EnvelopeHoldIndex:
    case SettingKey::EnvelopeDecayIndex:
    case SettingKey::EnvelopeReleaseIndex:
    case SettingKey::EffectEnvelopeAttackIndex:
    case SettingKey::EffectEnvelopeHoldIndex:
    case SettingKey::EffectEnvelopeDecayIndex:
    case SettingKey::EffectEnvelopeReleaseIndex:
    case SettingKey::EffectEnvelope2AttackIndex:
    case SettingKey::EffectEnvelope2HoldIndex:
    case SettingKey::EffectEnvelope2DecayIndex:
    case SettingKey::EffectEnvelope2ReleaseIndex:
      return true;
    default:
      return false;
  }
}

void remapLegacyEnvelopeTimeSettings(uint8_t* profileSettings, uint8_t settingsPerProfile) {
  for (uint8_t keyIndex = 0; keyIndex < settingsPerProfile; ++keyIndex) {
    SettingKey key = static_cast<SettingKey>(keyIndex);
    if (isEnvelopeTimeSettingKey(key)) {
      profileSettings[keyIndex] = remapLegacyEnvelopeTimeIndex(profileSettings[keyIndex]);
    }
  }
}

inline uint8_t remapLegacySynthVibratoSpeedIndex(uint8_t legacyIndex) {
  if (legacyIndex >= legacySynthVibratoSpeedIndexToCurrent.size()) {
    return SYNTH_VIBRATO_SPEED_DEFAULT;
  }
  return legacySynthVibratoSpeedIndexToCurrent[legacyIndex];
}

void remapLegacySynthVibratoSpeedSetting(uint8_t* profileSettings, uint8_t settingsPerProfile) {
  uint8_t keyIndex = static_cast<uint8_t>(SettingKey::SynthVibratoSpeed);
  if (keyIndex < settingsPerProfile) {
    profileSettings[keyIndex] = remapLegacySynthVibratoSpeedIndex(profileSettings[keyIndex]);
  }
}

uint8_t remapLegacyDeviceRotationSetting(uint8_t oldDriverRotation) {
  return displayRotationFromDeviceRotation(oldDriverRotation);
}

void remapLegacyDeviceRotationSetting(uint8_t* profileSettings, uint8_t settingsPerProfile) {
  uint8_t keyIndex = static_cast<uint8_t>(SettingKey::DeviceRotation);
  if (keyIndex < settingsPerProfile) {
    profileSettings[keyIndex] = remapLegacyDeviceRotationSetting(profileSettings[keyIndex]);
  }
}

// ==================================================
// Global Settings Array and Factory Defaults
// ==================================================

uint8_t settingsProfiles[PROFILE_COUNT][NUM_SETTINGS] = { { 0 } };
uint8_t* settings = settingsProfiles[DEFAULT_PROFILE_INDEX];
uint8_t activeProfileIndex = DEFAULT_PROFILE_INDEX;
uint8_t defaultProfileIndex = DEFAULT_PROFILE_INDEX;

std::vector<SynthPresetSlot> synthPresets;
std::vector<SynthWavetableSlot> synthWavetables;
std::vector<GeometryObjectSlot> geometryObjects;

void remapLegacySynthPresetEnvelopeTimes(SynthPresetSlot& preset) {
  if (!preset.valid) {
    return;
  }
  for (size_t i = 0; i < synthPresetKeys.size(); ++i) {
    if (isEnvelopeTimeSettingKey(synthPresetKeys[i])) {
      preset.values[i] = remapLegacyEnvelopeTimeIndex(preset.values[i]);
    }
  }
}

void remapLegacySynthPresetEnvelopeTimes(LegacySynthPresetSlot& preset) {
  if (!preset.valid) {
    return;
  }
  for (size_t i = 0; i < SYNTH_PRESET_VALUE_COUNT_V6; ++i) {
    if (isEnvelopeTimeSettingKey(synthPresetKeys[i])) {
      preset.values[i] = remapLegacyEnvelopeTimeIndex(preset.values[i]);
    }
  }
}

void remapLegacySynthPresetVibratoSpeed(SynthPresetSlot& preset) {
  if (!preset.valid) {
    return;
  }
  for (size_t i = 0; i < synthPresetKeys.size(); ++i) {
    if (synthPresetKeys[i] == SettingKey::SynthVibratoSpeed) {
      preset.values[i] = remapLegacySynthVibratoSpeedIndex(preset.values[i]);
      return;
    }
  }
}

void remapLegacySynthPresetVibratoSpeed(LegacySynthPresetSlot& preset) {
  if (!preset.valid) {
    return;
  }
  for (size_t i = 0; i < SYNTH_PRESET_VALUE_COUNT_V6; ++i) {
    if (synthPresetKeys[i] == SettingKey::SynthVibratoSpeed) {
      preset.values[i] = remapLegacySynthVibratoSpeedIndex(preset.values[i]);
      return;
    }
  }
}
