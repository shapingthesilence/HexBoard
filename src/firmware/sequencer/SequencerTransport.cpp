#include "SequencerTransport.h"

#include "../config/FeatureFlags.h"

#if HEXBOARD_ENABLE_SEQUENCER
#include "SequencerManagedNotes.h"
#include "SequencerPlaybackSettings.h"
#include "SequencerState.h"
#include "../app/DiagnosticsTiming.h"

namespace sequencer {
namespace {

bool running = false;
int8_t playingStep = kNoSelectedStep;
int8_t pingPongDelta = 1;
uint64_t nextStepAt = 0;
uint64_t currentStepStartedAt = 0;
int16_t activePitchSteps[kMaxNotesPerStep] = {};
byte activeNoteCount = 0;

void releaseActiveNotes() {
  for (byte i = 0; i < activeNoteCount && i < kMaxNotesPerStep; ++i) {
    stopManagedNote(activePitchSteps[i], SequencerManagedNoteRole::Playback);
    activePitchSteps[i] = 0;
  }
  activeNoteCount = 0;
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

void startStepNotes(byte stepIndex) {
  const SequencerStep& target = step(stepIndex);
  if (target.noteCount == 0 || target.gatePercent == 0) {
    return;
  }

  for (byte i = 0; i < target.noteCount && i < kMaxNotesPerStep; ++i) {
    if (startManagedNote(target.pitchSteps[i], target.velocity, SequencerManagedNoteRole::Playback)) {
      activePitchSteps[activeNoteCount++] = target.pitchSteps[i];
    }
  }
}

void advanceStep() {
  releaseActiveNotes();
  byte nextStep = nextPlayingStep();
  playingStep = static_cast<int8_t>(nextStep);
  startStepNotes(nextStep);
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
  releaseActiveNotes();
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
  releaseActiveNotes();
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
  }
}

void releasePlaybackNotesForPanic() {
  stopTransport();
  stopAllManagedNotes();
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
    releaseActiveNotes();
    playingStep = kNoSelectedStep;
    pingPongDelta = 1;
    currentStepStartedAt = runTime;
    nextStepAt = runTime;
    return;
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

void handlePlaybackSettingsChanged(bool /*resetDirectionState*/) {
}

}  // namespace sequencer
#endif
