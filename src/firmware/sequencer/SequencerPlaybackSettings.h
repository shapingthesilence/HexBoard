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

constexpr byte kTapPreviewOff = 0;
constexpr byte kTapPreviewOn = 1;
constexpr byte kTapPreviewDefault = kTapPreviewOn;

constexpr byte kPlayTypeMidi = 0;
constexpr byte kPlayTypeObSynth = 1;
constexpr byte kPlayTypeDefault = kPlayTypeMidi;

constexpr byte kMonophonicModeOff = 0;
constexpr byte kMonophonicModeOn = 1;
constexpr byte kMonophonicModeDefault = kMonophonicModeOff;

constexpr byte kClockSourceInternal = 0;
constexpr byte kClockSourceExternalMidi = 1;
constexpr byte kClockSourceDefault = kClockSourceInternal;

byte playbackTempo();
byte activeStepCount();
byte playbackDirection();
byte tapPreview();
byte playType();
byte monophonicMode();
byte clockSource();
bool usesExternalClock();
uint64_t playbackStepDurationMicros();

byte& playbackTempoMutable();
byte& activeStepCountMutable();
byte& playbackDirectionMutable();
byte& tapPreviewMutable();
byte& playTypeMutable();
byte& monophonicModeMutable();
byte& clockSourceMutable();
void normalizePlaybackSettings();
void applyPlaybackPreferencesFromProfile();
void persistMonophonicModeToProfile();
void persistTapPreviewToProfile();
void persistClockSourceToProfile();

}  // namespace sequencer
