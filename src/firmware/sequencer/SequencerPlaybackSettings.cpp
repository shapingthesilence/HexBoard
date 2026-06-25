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
byte syncSource = kClockSourceDefault;
byte midiClockSend = kSendClockDefault;
byte midiTransportSend = kSendTransportDefault;

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

bool validClockSource(byte value) {
  return value == kClockSourceInternal || value == kClockSourceExternalMidi;
}

bool validSendClock(byte value) {
  return value == kSendClockOff || value == kSendClockOn;
}

bool validSendTransport(byte value) {
  return value == kSendTransportOff || value == kSendTransportOn;
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

byte clockSource() {
  return validClockSource(syncSource) ? syncSource : kClockSourceDefault;
}

byte sendClock() {
  return validSendClock(midiClockSend) ? midiClockSend : kSendClockDefault;
}

byte sendTransport() {
  return validSendTransport(midiTransportSend) ? midiTransportSend : kSendTransportDefault;
}

bool usesExternalClock() {
  return clockSource() == kClockSourceExternalMidi;
}

bool shouldSendMidiClock() {
  return !usesExternalClock() && sendClock() == kSendClockOn;
}

bool shouldSendMidiTransport() {
  return !usesExternalClock() && sendTransport() == kSendTransportOn;
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

byte& clockSourceMutable() {
  return syncSource;
}

byte& sendClockMutable() {
  return midiClockSend;
}

byte& sendTransportMutable() {
  return midiTransportSend;
}

void normalizePlaybackSettings() {
  tempo = playbackTempo();
  stepCount = activeStepCount();
  direction = playbackDirection();
  preview = tapPreview();
  outputType = playType();
  monoMode = monophonicMode();
  syncSource = clockSource();
  midiClockSend = sendClock();
  midiTransportSend = sendTransport();
}

void applyPlaybackPreferencesFromProfile() {
  monoMode = validMonophonicMode(settingValue(SettingKey::SequencerMonophonicMode))
               ? settingValue(SettingKey::SequencerMonophonicMode)
               : kMonophonicModeDefault;
  preview = validTapPreview(settingValue(SettingKey::SequencerTapPreview))
              ? settingValue(SettingKey::SequencerTapPreview)
              : kTapPreviewDefault;
  syncSource = validClockSource(settingValue(SettingKey::SequencerClockSource))
                 ? settingValue(SettingKey::SequencerClockSource)
                 : kClockSourceDefault;
  midiClockSend = validSendClock(settingValue(SettingKey::SequencerSendClock))
                    ? settingValue(SettingKey::SequencerSendClock)
                    : kSendClockDefault;
  midiTransportSend = validSendTransport(settingValue(SettingKey::SequencerSendTransport))
                        ? settingValue(SettingKey::SequencerSendTransport)
                        : kSendTransportDefault;
  settings[static_cast<uint8_t>(SettingKey::SequencerMonophonicMode)] = monoMode;
  settings[static_cast<uint8_t>(SettingKey::SequencerTapPreview)] = preview;
  settings[static_cast<uint8_t>(SettingKey::SequencerClockSource)] = syncSource;
  settings[static_cast<uint8_t>(SettingKey::SequencerSendClock)] = midiClockSend;
  settings[static_cast<uint8_t>(SettingKey::SequencerSendTransport)] = midiTransportSend;
}

void persistMonophonicModeToProfile() {
  monoMode = monophonicMode();
  settings[static_cast<uint8_t>(SettingKey::SequencerMonophonicMode)] = monoMode;
  markSettingsDirty();
}

void persistTapPreviewToProfile() {
  preview = tapPreview();
  settings[static_cast<uint8_t>(SettingKey::SequencerTapPreview)] = preview;
  markSettingsDirty();
}

void persistClockSourceToProfile() {
  syncSource = clockSource();
  settings[static_cast<uint8_t>(SettingKey::SequencerClockSource)] = syncSource;
  markSettingsDirty();
}

void persistSendClockToProfile() {
  midiClockSend = sendClock();
  settings[static_cast<uint8_t>(SettingKey::SequencerSendClock)] = midiClockSend;
  markSettingsDirty();
}

void persistSendTransportToProfile() {
  midiTransportSend = sendTransport();
  settings[static_cast<uint8_t>(SettingKey::SequencerSendTransport)] = midiTransportSend;
  markSettingsDirty();
}

}  // namespace sequencer
