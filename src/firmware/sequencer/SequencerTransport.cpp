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
constexpr byte kMidiClocksPerStep = 6;

struct PlaybackExternalClockState {
  bool pendingGateSync = false;
  bool pendingTieBoundary = false;
  uint16_t gatePercent = kDefaultGatePercent;
  uint64_t startedAt = 0;
};

struct PlaybackGroup {
  bool active = false;
  int16_t pitchSteps[kMaxNotesPerStep] = {};
  byte noteCount = 0;
  int8_t sourceStep = kNoSelectedStep;
  PlaybackExternalClockState externalClock = {};
  uint64_t noteOffAt = 0;
};

struct ExternalClockState {
  byte pulseCount = 0;
  uint64_t lastPulseAt = 0;
  uint64_t stepDuration = 0;
  uint64_t pulseMicrosAccum = 0;
  byte pulseIntervalCount = 0;
};

bool running = false;
int8_t playingStep = kNoSelectedStep;
int8_t pingPongDelta = 1;
uint64_t nextStepAt = 0;
uint64_t currentStepStartedAt = 0;
ExternalClockState externalClock = {};
PlaybackGroup playbackGroups[kPlaybackGroupCount];

void resetExternalClockState() {
  externalClock = ExternalClockState{};
}

uint64_t currentStepDurationMicros() {
  if (usesExternalClock() && externalClock.stepDuration > 0) {
    return externalClock.stepDuration;
  }
  return playbackStepDurationMicros();
}

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
    if (!group.active ||
        (usesExternalClock() && group.externalClock.pendingGateSync && group.noteOffAt == 0) ||
        (usesExternalClock() && group.externalClock.pendingTieBoundary) ||
        runTime < group.noteOffAt) {
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
    if (group.active &&
        !(usesExternalClock() && group.externalClock.pendingGateSync && group.noteOffAt == 0) &&
        !(usesExternalClock() && group.externalClock.pendingTieBoundary) &&
        runTime >= group.noteOffAt) {
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
  group.externalClock = PlaybackExternalClockState{};
  group.externalClock.gatePercent = target.gatePercent;
  group.externalClock.startedAt = playbackStartedAt;
  group.noteOffAt = playbackStartedAt + ((stepDuration * static_cast<uint64_t>(target.gatePercent)) / 100ULL);
  uint64_t stepBoundary = playbackStartedAt + stepDuration;
  bool nextStepContinues = nextStepContinuesSource(stepIndex, activeStepCount());
  if (usesExternalClock() && nextStepContinues) {
    group.externalClock.pendingTieBoundary = true;
    group.noteOffAt = 0;
  } else if (usesExternalClock() && externalClock.stepDuration == 0) {
    group.externalClock.pendingGateSync = true;
    group.noteOffAt = 0;
  } else if (nextStepContinues && group.noteOffAt < stepBoundary) {
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
  if (usesExternalClock()) {
    group.externalClock.pendingTieBoundary = true;
    group.noteOffAt = 0;
    return;
  }

  uint64_t tieNoteOffAt = ((currentStepStartedAt != 0) ? currentStepStartedAt : runTime) + stepDuration;
  if (group.noteOffAt < tieNoteOffAt) {
    group.noteOffAt = tieNoteOffAt;
  }
}

void advanceStep(uint64_t stepDuration) {
  byte activeSteps = activeStepCount();
  byte nextStep = nextPlayingStep();
  releasePlaybackGroupsForStepBoundary(static_cast<int8_t>(nextStep), activeSteps);
  playingStep = static_cast<int8_t>(nextStep);
  if (step(nextStep).tie) {
    continueTiePlayback(nextStep, stepDuration);
    return;
  }
  startStepNotes(nextStep, stepDuration);
}

void rescheduleNextStepFromCurrentStart() {
  if (currentStepStartedAt == 0) {
    currentStepStartedAt = runTime;
  }
  nextStepAt = currentStepStartedAt + playbackStepDurationMicros();
}

void recordExternalClockPulse() {
  if (externalClock.lastPulseAt != 0 && runTime > externalClock.lastPulseAt) {
    uint64_t pulseDuration = runTime - externalClock.lastPulseAt;
    if (pulseDuration > 0 && externalClock.pulseIntervalCount < 255) {
      externalClock.pulseMicrosAccum += pulseDuration;
      ++externalClock.pulseIntervalCount;
    }
  }
  externalClock.lastPulseAt = runTime;
}

void updatePendingExternalGateSyncEstimate() {
  if (externalClock.pulseIntervalCount == 0) {
    return;
  }

  uint64_t estimatedStepDuration =
    (externalClock.pulseMicrosAccum * kMidiClocksPerStep) / externalClock.pulseIntervalCount;
  if (estimatedStepDuration == 0) {
    return;
  }

  for (byte i = 0; i < kPlaybackGroupCount; ++i) {
    PlaybackGroup& group = playbackGroups[i];
    if (!group.active || !group.externalClock.pendingGateSync) {
      continue;
    }
    group.noteOffAt =
      group.externalClock.startedAt + ((estimatedStepDuration * group.externalClock.gatePercent) / 100ULL);
  }
}

void resolvePendingExternalGateSync(uint64_t stepDuration) {
  for (byte i = 0; i < kPlaybackGroupCount; ++i) {
    PlaybackGroup& group = playbackGroups[i];
    if (!group.active || !group.externalClock.pendingGateSync) {
      continue;
    }
    group.externalClock.pendingGateSync = false;
    uint64_t resolvedNoteOffAt =
      group.externalClock.startedAt + ((stepDuration * group.externalClock.gatePercent) / 100ULL);
    if (resolvedNoteOffAt > 0) {
      group.noteOffAt = resolvedNoteOffAt;
    }
  }
}

bool advanceExternalClockState(uint64_t& stepDuration) {
  updatePendingExternalGateSyncEstimate();

  externalClock.pulseCount = static_cast<byte>((externalClock.pulseCount + 1) % kMidiClocksPerStep);
  if (externalClock.pulseCount != 0) {
    return false;
  }

  stepDuration = currentStepDurationMicros();
  if (currentStepStartedAt != 0 && runTime > currentStepStartedAt) {
    uint64_t measuredStepDuration = runTime - currentStepStartedAt;
    if (measuredStepDuration > 0) {
      externalClock.stepDuration = measuredStepDuration;
      stepDuration = measuredStepDuration;
    }
  }

  resolvePendingExternalGateSync(stepDuration);
  externalClock.pulseMicrosAccum = 0;
  externalClock.pulseIntervalCount = 0;
  return true;
}

void resolvePendingExternalTieBoundaries(byte activeSteps) {
  for (byte i = 0; i < kPlaybackGroupCount; ++i) {
    PlaybackGroup& group = playbackGroups[i];
    if (!group.active || !group.externalClock.pendingTieBoundary) {
      continue;
    }
    if (group.externalClock.startedAt >= currentStepStartedAt) {
      continue;
    }

    bool currentStepContinuesSource =
      playingStep >= 0 &&
      step(static_cast<byte>(playingStep)).tie &&
      findTieSourceStep(static_cast<byte>(playingStep), activeSteps) == group.sourceStep;

    if (currentStepContinuesSource) {
      group.noteOffAt = 0;
      continue;
    }

    group.externalClock.pendingTieBoundary = false;
    group.noteOffAt = runTime;
  }
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
  resetExternalClockState();
  running = true;
  playingStep = kNoSelectedStep;
  pingPongDelta = 1;
  currentStepStartedAt = runTime;
  nextStepAt = usesExternalClock() ? 0 : runTime;
}

void stopTransport() {
  running = false;
  playingStep = kNoSelectedStep;
  pingPongDelta = 1;
  nextStepAt = 0;
  currentStepStartedAt = 0;
  resetExternalClockState();
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
  if (usesExternalClock()) {
    servicePlaybackGroups();
    return;
  }
  if (nextStepAt == 0) {
    currentStepStartedAt = runTime;
    nextStepAt = runTime;
  }
  if (runTime >= nextStepAt) {
    currentStepStartedAt = nextStepAt;
    advanceStep(playbackStepDurationMicros());
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
  resetExternalClockState();
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
    nextStepAt = usesExternalClock() ? 0 : runTime;
    return;
  }

  for (byte i = 0; i < kPlaybackGroupCount; ++i) {
    PlaybackGroup& group = playbackGroups[i];
    if (group.active && group.sourceStep >= static_cast<int8_t>(activeSteps)) {
      clearPlaybackGroup(group, true);
    }
  }

  if (usesExternalClock()) {
    nextStepAt = 0;
  } else {
    rescheduleNextStepFromCurrentStart();
  }
}

void handleExternalMidiClock() {
  if (!usesExternalClock()) {
    return;
  }

  recordExternalClockPulse();
  if (!running) {
    return;
  }

  uint64_t stepDuration = 0;
  if (!advanceExternalClockState(stepDuration)) {
    return;
  }

  currentStepStartedAt = runTime;
  advanceStep(stepDuration);
  resolvePendingExternalTieBoundaries(activeStepCount());
  servicePlaybackGroups();
}

void handleExternalMidiStart() {
  if (!usesExternalClock()) {
    return;
  }

  startTransport();
  currentStepStartedAt = runTime;
  advanceStep(currentStepDurationMicros());
  servicePlaybackGroups();
}

void handleExternalMidiStop() {
  if (!usesExternalClock()) {
    return;
  }

  stopTransport();
}

void handleExternalMidiContinue() {
  if (!usesExternalClock()) {
    return;
  }

  startTransport();
  currentStepStartedAt = runTime;
  advanceStep(currentStepDurationMicros());
  servicePlaybackGroups();
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

void handleExternalMidiClock() {
}

void handleExternalMidiStart() {
}

void handleExternalMidiStop() {
}

void handleExternalMidiContinue() {
}

}  // namespace sequencer
#endif
