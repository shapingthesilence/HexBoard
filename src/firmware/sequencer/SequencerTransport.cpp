#include "SequencerTransport.h"

#include "../config/FeatureFlags.h"

#if HEXBOARD_ENABLE_SEQUENCER
#include "SequencerManagedNotes.h"
#include "SequencerPlaybackSettings.h"
#include "SequencerState.h"
#include "../app/DiagnosticsTiming.h"

namespace sequencer {
namespace {

constexpr byte kPlaybackGroupCount = 16;

struct PlaybackGroup {
  bool active = false;
  int16_t pitchSteps[kMaxNotesPerStep] = {};
  byte noteCount = 0;
  int8_t sourceStep = kNoSelectedStep;
  uint64_t noteOffAt = 0;
};

bool running = false;
int8_t playingStep = kNoSelectedStep;
int8_t pingPongDelta = 1;
uint64_t nextStepAt = 0;
uint64_t currentStepStartedAt = 0;
PlaybackGroup playbackGroups[kPlaybackGroupCount];

void clearPlaybackGroup(PlaybackGroup& group, bool stopNotes = true) {
  if (stopNotes) {
    for (byte i = 0; i < group.noteCount && i < kMaxNotesPerStep; ++i) {
      stopManagedNote(group.pitchSteps[i], SequencerManagedNoteRole::Playback);
    }
  }
  group = PlaybackGroup{};
}

void releaseAllPlaybackGroups() {
  for (byte i = 0; i < kPlaybackGroupCount; ++i) {
    if (playbackGroups[i].active) {
      clearPlaybackGroup(playbackGroups[i], true);
    }
  }
  stopPlaybackNotes();
}

byte nextPlayingStep() {
  byte activeSteps = activeStepCount();
  if (activeSteps <= 1) {
    return 0;
  }

  switch (playbackDirection()) {
    case kDirectionBackward:
      if (playingStep < 0 || playingStep >= static_cast<int8_t>(activeSteps)) {
        return static_cast<byte>(activeSteps - 1);
      }
      return static_cast<byte>((playingStep + activeSteps - 1) % activeSteps);

    case kDirectionPingPong:
      if (playingStep < 0 || playingStep >= static_cast<int8_t>(activeSteps)) {
        pingPongDelta = 1;
        return 0;
      }
      if (playingStep >= static_cast<int8_t>(activeSteps - 1)) {
        pingPongDelta = -1;
      } else if (playingStep <= 0) {
        pingPongDelta = 1;
      }
      return static_cast<byte>(playingStep + pingPongDelta);

    case kDirectionRandom:
      return static_cast<byte>(random(activeSteps));

    case kDirectionBrownian:
      if (playingStep < 0 || playingStep >= static_cast<int8_t>(activeSteps)) {
        return 0;
      }
      if (playingStep <= 0) {
        return 1;
      }
      if (playingStep >= static_cast<int8_t>(activeSteps - 1)) {
        return static_cast<byte>(activeSteps - 2);
      }
      return static_cast<byte>(playingStep + (random(2) == 0 ? -1 : 1));

    case kDirectionDrunk:
      if (playingStep < 0 || playingStep >= static_cast<int8_t>(activeSteps)) {
        return 0;
      }
      {
        int8_t candidate = static_cast<int8_t>(playingStep + static_cast<int8_t>(random(3)) - 1);
        if (candidate < 0) {
          candidate = 0;
        } else if (candidate >= static_cast<int8_t>(activeSteps)) {
          candidate = static_cast<int8_t>(activeSteps - 1);
        }
        return static_cast<byte>(candidate);
      }

    case kDirectionForward:
    default:
      if (playingStep < 0 || playingStep >= static_cast<int8_t>(activeSteps)) {
        return 0;
      }
      return static_cast<byte>((playingStep + 1) % activeSteps);
  }
}

bool stepHasPlayableNoteData(byte stepIndex) {
  if (stepIndex >= kStepCount) {
    return false;
  }
  const SequencerStep& target = step(stepIndex);
  return !target.tie && target.noteCount > 0 && target.gatePercent > 0;
}

int8_t findTieSourceStep(byte stepIndex, byte activeSteps) {
  if (stepIndex == 0 || stepIndex >= activeSteps || !step(stepIndex).tie) {
    return kNoSelectedStep;
  }
  for (int8_t sourceStep = static_cast<int8_t>(stepIndex - 1); sourceStep >= 0; --sourceStep) {
    if (stepHasPlayableNoteData(static_cast<byte>(sourceStep))) {
      return sourceStep;
    }
  }
  return kNoSelectedStep;
}

int findActivePlaybackGroup(byte sourceStep) {
  for (byte i = 0; i < kPlaybackGroupCount; ++i) {
    if (playbackGroups[i].active && playbackGroups[i].sourceStep == static_cast<int8_t>(sourceStep)) {
      return i;
    }
  }
  return -1;
}

bool nextStepContinuesSource(byte stepIndex, byte activeSteps) {
  byte nextStep = static_cast<byte>(stepIndex + 1);
  return nextStep < activeSteps && findTieSourceStep(nextStep, activeSteps) == static_cast<int8_t>(stepIndex);
}

bool stepContinuesGroup(int8_t stepIndex, byte activeSteps, const PlaybackGroup& group) {
  if (stepIndex < 0 || stepIndex >= static_cast<int8_t>(activeSteps) || group.sourceStep < 0) {
    return false;
  }
  return findTieSourceStep(static_cast<byte>(stepIndex), activeSteps) == group.sourceStep;
}

void releasePlaybackGroupsForStepBoundary(int8_t nextStepIndex, byte activeSteps) {
  for (byte i = 0; i < kPlaybackGroupCount; ++i) {
    PlaybackGroup& group = playbackGroups[i];
    if (!group.active || runTime < group.noteOffAt) {
      continue;
    }
    // Boundary note-offs happen before the next non-tied step starts; ties keep the source alive.
    if (stepContinuesGroup(nextStepIndex, activeSteps, group)) {
      continue;
    }
    clearPlaybackGroup(group, true);
  }
}

void servicePlaybackGroups() {
  for (byte i = 0; i < kPlaybackGroupCount; ++i) {
    PlaybackGroup& group = playbackGroups[i];
    if (group.active && runTime >= group.noteOffAt) {
      clearPlaybackGroup(group, true);
    }
  }
}

int allocatePlaybackGroup() {
  for (byte i = 0; i < kPlaybackGroupCount; ++i) {
    if (!playbackGroups[i].active) {
      return i;
    }
  }

  byte earliest = 0;
  for (byte i = 1; i < kPlaybackGroupCount; ++i) {
    if (playbackGroups[i].noteOffAt < playbackGroups[earliest].noteOffAt) {
      earliest = i;
    }
  }
  clearPlaybackGroup(playbackGroups[earliest], true);
  return earliest;
}

void startStepNotes(byte stepIndex, uint64_t stepDuration) {
  const SequencerStep& target = step(stepIndex);
  if (target.noteCount == 0 || target.gatePercent == 0 || target.tie) {
    return;
  }
  if (target.probability == 0) {
    return;
  }
  if (target.probability < 100 && static_cast<byte>(random(100)) >= target.probability) {
    return;
  }

  int groupIndex = allocatePlaybackGroup();
  if (groupIndex < 0) {
    return;
  }

  PlaybackGroup& group = playbackGroups[groupIndex];
  group = PlaybackGroup{};
  group.active = true;
  group.sourceStep = static_cast<int8_t>(stepIndex);

  uint64_t playbackStartedAt = (currentStepStartedAt != 0) ? currentStepStartedAt : runTime;
  group.noteOffAt = playbackStartedAt + ((stepDuration * static_cast<uint64_t>(target.gatePercent)) / 100ULL);
  uint64_t stepBoundary = playbackStartedAt + stepDuration;
  if (nextStepContinuesSource(stepIndex, activeStepCount()) && group.noteOffAt < stepBoundary) {
    group.noteOffAt = stepBoundary;
  }

  for (byte i = 0; i < target.noteCount && i < kMaxNotesPerStep; ++i) {
    if (startManagedNote(target.pitchSteps[i], target.velocity, SequencerManagedNoteRole::Playback)) {
      group.pitchSteps[group.noteCount++] = target.pitchSteps[i];
    }
  }

  if (group.noteCount == 0) {
    clearPlaybackGroup(group, false);
  }
}

void continueTiePlayback(byte stepIndex, uint64_t stepDuration) {
  byte activeSteps = activeStepCount();
  int8_t sourceStep = findTieSourceStep(stepIndex, activeSteps);
  if (sourceStep < 0) {
    return;
  }

  int groupIndex = findActivePlaybackGroup(static_cast<byte>(sourceStep));
  if (groupIndex < 0) {
    return;
  }

  PlaybackGroup& group = playbackGroups[groupIndex];
  uint64_t tieNoteOffAt = ((currentStepStartedAt != 0) ? currentStepStartedAt : runTime) + stepDuration;
  if (group.noteOffAt < tieNoteOffAt) {
    group.noteOffAt = tieNoteOffAt;
  }
}

void advanceStep() {
  byte activeSteps = activeStepCount();
  byte nextStep = nextPlayingStep();
  releasePlaybackGroupsForStepBoundary(static_cast<int8_t>(nextStep), activeSteps);
  playingStep = static_cast<int8_t>(nextStep);
  if (step(nextStep).tie) {
    continueTiePlayback(nextStep, playbackStepDurationMicros());
    return;
  }
  startStepNotes(nextStep, playbackStepDurationMicros());
}

void rescheduleNextStepFromCurrentStart() {
  if (currentStepStartedAt == 0) {
    currentStepStartedAt = runTime;
  }
  nextStepAt = currentStepStartedAt + playbackStepDurationMicros();
}

}  // namespace

bool transportRunning() {
  return running;
}

int8_t playingStepIndex() {
  return playingStep;
}

void startTransport() {
  stopPreviewNotes();
  releaseAllPlaybackGroups();
  running = true;
  playingStep = kNoSelectedStep;
  pingPongDelta = 1;
  currentStepStartedAt = runTime;
  nextStepAt = runTime;
}

void stopTransport() {
  running = false;
  playingStep = kNoSelectedStep;
  pingPongDelta = 1;
  nextStepAt = 0;
  currentStepStartedAt = 0;
  stopPreviewNotes();
  releaseAllPlaybackGroups();
}

void toggleTransport() {
  if (running) {
    stopTransport();
  } else {
    startTransport();
  }
}

void serviceTransport() {
  if (!running) {
    return;
  }
  if (nextStepAt == 0) {
    currentStepStartedAt = runTime;
    nextStepAt = runTime;
  }
  if (runTime >= nextStepAt) {
    currentStepStartedAt = nextStepAt;
    advanceStep();
    rescheduleNextStepFromCurrentStart();
  } else {
    servicePlaybackGroups();
  }
}

void releasePlaybackNotesForPanic() {
  stopTransport();
  stopAllManagedNotes();
}

void releasePlaybackForStep(byte stepIndex) {
  for (byte i = 0; i < kPlaybackGroupCount; ++i) {
    PlaybackGroup& group = playbackGroups[i];
    if (group.active && group.sourceStep == static_cast<int8_t>(stepIndex)) {
      clearPlaybackGroup(group, true);
    }
  }
}

void handlePlaybackSettingsChanged(bool resetDirectionState) {
  normalizePlaybackSettings();
  if (resetDirectionState) {
    pingPongDelta = 1;
  }

  if (!running) {
    return;
  }

  byte activeSteps = activeStepCount();
  if (playingStep >= static_cast<int8_t>(activeSteps)) {
    releaseAllPlaybackGroups();
    playingStep = kNoSelectedStep;
    pingPongDelta = 1;
    currentStepStartedAt = runTime;
    nextStepAt = runTime;
    return;
  }

  for (byte i = 0; i < kPlaybackGroupCount; ++i) {
    PlaybackGroup& group = playbackGroups[i];
    if (group.active && group.sourceStep >= static_cast<int8_t>(activeSteps)) {
      clearPlaybackGroup(group, true);
    }
  }

  rescheduleNextStepFromCurrentStart();
}

}  // namespace sequencer
#else
namespace sequencer {

bool transportRunning() {
  return false;
}

int8_t playingStepIndex() {
  return -1;
}

void startTransport() {
}

void stopTransport() {
}

void toggleTransport() {
}

void serviceTransport() {
}

void releasePlaybackNotesForPanic() {
}

void releasePlaybackForStep(byte /*stepIndex*/) {
}

void handlePlaybackSettingsChanged(bool /*resetDirectionState*/) {
}

}  // namespace sequencer
#endif
