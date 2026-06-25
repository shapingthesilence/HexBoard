#include "SequencerTransport.h"

#include "../config/FeatureFlags.h"

#if HEXBOARD_ENABLE_SEQUENCER
#include "SequencerMidi.h"
#include "SequencerState.h"
#include "../app/DiagnosticsTiming.h"

namespace sequencer {
namespace {

constexpr uint64_t kDefaultBpm = 120;
constexpr uint64_t kStepDurationMicros = 60000000ULL / kDefaultBpm / 4ULL;

bool running = false;
int8_t playingStep = kNoSelectedStep;
uint64_t nextStepAt = 0;
SequencerMidiNoteHandle activeNotes[kMaxNotesPerStep];
byte activeNoteCount = 0;

void releaseActiveNotes() {
  for (byte i = 0; i < activeNoteCount && i < kMaxNotesPerStep; ++i) {
    stopMidiNote(activeNotes[i]);
  }
  activeNoteCount = 0;
}

byte nextPlayingStep() {
  if (playingStep < 0 || playingStep >= static_cast<int8_t>(kStepCount - 1)) {
    return 0;
  }
  return static_cast<byte>(playingStep + 1);
}

void startStepNotes(byte stepIndex) {
  const SequencerStep& target = step(stepIndex);
  if (target.noteCount == 0 || target.gatePercent == 0) {
    return;
  }

  for (byte i = 0; i < target.noteCount && i < kMaxNotesPerStep; ++i) {
    if (startMidiNote(target.pitchSteps[i], target.velocity, activeNotes[activeNoteCount])) {
      ++activeNoteCount;
    }
  }
}

void advanceStep() {
  releaseActiveNotes();
  byte nextStep = nextPlayingStep();
  playingStep = static_cast<int8_t>(nextStep);
  startStepNotes(nextStep);
}

}  // namespace

bool transportRunning() {
  return running;
}

int8_t playingStepIndex() {
  return playingStep;
}

void startTransport() {
  releaseActiveNotes();
  running = true;
  playingStep = kNoSelectedStep;
  nextStepAt = runTime;
}

void stopTransport() {
  running = false;
  playingStep = kNoSelectedStep;
  nextStepAt = 0;
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
    nextStepAt = runTime;
  }
  if (runTime >= nextStepAt) {
    nextStepAt += kStepDurationMicros;
    advanceStep();
  }
}

void releasePlaybackNotesForPanic() {
  stopTransport();
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

}  // namespace sequencer
#endif
