#include "SequencerPlaybackSettings.h"

#include "../config/FeatureFlags.h"

namespace sequencer {
namespace {

byte tempo = kPlaybackTempoDefault;
byte stepCount = kActiveStepCountDefault;
byte direction = kDirectionDefault;
byte preview = kTapPreviewDefault;

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

void normalizePlaybackSettings() {
  tempo = playbackTempo();
  stepCount = activeStepCount();
  direction = playbackDirection();
  preview = tapPreview();
}

}  // namespace sequencer
