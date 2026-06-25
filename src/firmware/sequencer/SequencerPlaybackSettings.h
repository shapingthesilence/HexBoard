#pragma once

#include "../FirmwareModule.h"
#include "SequencerState.h"

namespace sequencer {

constexpr byte kPlaybackTempoMin = 1;
constexpr byte kPlaybackTempoMax = 255;
constexpr byte kPlaybackTempoDefault = 120;
constexpr byte kActiveStepCountMin = 1;
constexpr byte kActiveStepCountMax = kStepCount;
constexpr byte kActiveStepCountDefault = kStepCount;

constexpr byte kDirectionForward = 0;
constexpr byte kDirectionBackward = 1;
constexpr byte kDirectionPingPong = 2;
constexpr byte kDirectionRandom = 3;
constexpr byte kDirectionBrownian = 4;
constexpr byte kDirectionDrunk = 5;
constexpr byte kDirectionDefault = kDirectionForward;

byte playbackTempo();
byte activeStepCount();
byte playbackDirection();
uint64_t playbackStepDurationMicros();

byte& playbackTempoMutable();
byte& activeStepCountMutable();
byte& playbackDirectionMutable();
void normalizePlaybackSettings();

}  // namespace sequencer
