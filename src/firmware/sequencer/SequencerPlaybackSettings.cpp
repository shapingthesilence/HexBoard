#include "SequencerPlaybackSettings.h"

#include "../config/FeatureFlags.h"
#include "../storage/PersistentDataModels.h"
#include "../storage/Settings.h"

namespace sequencer {
namespace {

byte tempo = kPlaybackTempoDefault;
byte stepCount = kActiveStepCountDefault;
byte direction = kDirectionDefault;
byte preview = kTapPreviewDefault;
byte outputType = kPlayTypeDefault;
byte monoMode = kMonophonicModeDefault;

byte clampByte(byte value, byte minValue, byte maxValue) {
  if (value < minValue) {
    return minValue;
  }
  if (value > maxValue) {
    return maxValue;
  }
  return value;
}

bool validDirection(byte value) {
  return value >= kDirectionForward && value <= kDirectionDrunk;
}

bool validTapPreview(byte value) {
  return value == kTapPreviewOff || value == kTapPreviewOn;
}

bool validPlayType(byte value) {
  return value == kPlayTypeMidi || value == kPlayTypeObSynth;
}

bool validMonophonicMode(byte value) {
  return value == kMonophonicModeOff || value == kMonophonicModeOn;
}

}  // namespace

byte playbackTempo() {
  return clampByte(tempo, kPlaybackTempoMin, kPlaybackTempoMax);
}

byte activeStepCount() {
  return clampByte(stepCount, kActiveStepCountMin, kActiveStepCountMax);
}

byte playbackDirection() {
  return validDirection(direction) ? direction : kDirectionDefault;
}

byte tapPreview() {
  return validTapPreview(preview) ? preview : kTapPreviewDefault;
}

byte playType() {
  return validPlayType(outputType) ? outputType : kPlayTypeDefault;
}

byte monophonicMode() {
  return validMonophonicMode(monoMode) ? monoMode : kMonophonicModeDefault;
}

uint64_t playbackStepDurationMicros() {
  return 60000000ULL / static_cast<uint64_t>(playbackTempo()) / 4ULL;
}

byte& playbackTempoMutable() {
  return tempo;
}

byte& activeStepCountMutable() {
  return stepCount;
}

byte& playbackDirectionMutable() {
  return direction;
}

byte& tapPreviewMutable() {
  return preview;
}

byte& playTypeMutable() {
  return outputType;
}

byte& monophonicModeMutable() {
  return monoMode;
}

void normalizePlaybackSettings() {
  tempo = playbackTempo();
  stepCount = activeStepCount();
  direction = playbackDirection();
  preview = tapPreview();
  outputType = playType();
  monoMode = monophonicMode();
}

void applyPlaybackPreferencesFromProfile() {
  monoMode = validMonophonicMode(settingValue(SettingKey::SequencerMonophonicMode))
               ? settingValue(SettingKey::SequencerMonophonicMode)
               : kMonophonicModeDefault;
  settings[static_cast<uint8_t>(SettingKey::SequencerMonophonicMode)] = monoMode;
}

void persistMonophonicModeToProfile() {
  monoMode = monophonicMode();
  settings[static_cast<uint8_t>(SettingKey::SequencerMonophonicMode)] = monoMode;
  markSettingsDirty();
}

}  // namespace sequencer
