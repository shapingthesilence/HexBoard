#include "SequencerState.h"

#include "../config/FeatureFlags.h"

#if HEXBOARD_ENABLE_SEQUENCER
namespace sequencer {
namespace {

SequencerStep sequencerSteps[kStepCount];
int8_t selectedStep = kNoSelectedStep;

bool validStepIndex(byte stepIndex) {
  return stepIndex < kStepCount;
}

void resetStepData(SequencerStep& target) {
  for (byte i = 0; i < kMaxNotesPerStep; ++i) {
    target.pitchSteps[i] = 0;
  }
  target.noteCount = 0;
  target.gatePercent = kDefaultGatePercent;
  target.velocity = kDefaultVelocity;
  target.probability = kDefaultProbability;
  target.tie = false;
}

byte findPitchIndex(const SequencerStep& target, int16_t pitchSteps) {
  for (byte i = 0; i < target.noteCount && i < kMaxNotesPerStep; ++i) {
    if (target.pitchSteps[i] == pitchSteps) {
      return i;
    }
  }
  return kMaxNotesPerStep;
}

void sortStepNotes(SequencerStep& target) {
  if (target.noteCount < 2) {
    return;
  }
  for (byte i = 0; i + 1 < target.noteCount; ++i) {
    for (byte j = static_cast<byte>(i + 1); j < target.noteCount; ++j) {
      if (target.pitchSteps[j] < target.pitchSteps[i]) {
        int16_t value = target.pitchSteps[i];
        target.pitchSteps[i] = target.pitchSteps[j];
        target.pitchSteps[j] = value;
      }
    }
  }
}

}  // namespace

const SequencerStep& step(byte stepIndex) {
  static SequencerStep emptyStep;
  if (!validStepIndex(stepIndex)) {
    resetStepData(emptyStep);
    return emptyStep;
  }
  return sequencerSteps[stepIndex];
}

int8_t selectedStepIndex() {
  return selectedStep;
}

bool hasSelectedStep() {
  return selectedStep >= 0 && selectedStep < static_cast<int8_t>(kStepCount);
}

void selectStep(byte stepIndex) {
  if (validStepIndex(stepIndex)) {
    selectedStep = static_cast<int8_t>(stepIndex);
  }
}

void deselectStep() {
  selectedStep = kNoSelectedStep;
}

void resetStep(byte stepIndex) {
  if (validStepIndex(stepIndex)) {
    resetStepData(sequencerSteps[stepIndex]);
  }
}

void resetAllSteps() {
  for (byte stepIndex = 0; stepIndex < kStepCount; ++stepIndex) {
    resetStep(stepIndex);
  }
  deselectStep();
}

bool stepIsProgrammed(byte stepIndex) {
  if (!validStepIndex(stepIndex)) {
    return false;
  }
  const SequencerStep& target = sequencerSteps[stepIndex];
  return target.noteCount > 0 || target.tie;
}

bool togglePitchOnSelectedStep(int16_t pitchSteps) {
  if (!hasSelectedStep()) {
    return false;
  }

  SequencerStep& target = sequencerSteps[selectedStep];
  byte pitchIndex = findPitchIndex(target, pitchSteps);
  if (pitchIndex < kMaxNotesPerStep) {
    for (byte i = pitchIndex; i + 1 < target.noteCount; ++i) {
      target.pitchSteps[i] = target.pitchSteps[i + 1];
    }
    if (target.noteCount > 0) {
      --target.noteCount;
      target.pitchSteps[target.noteCount] = 0;
    }
    return true;
  }

  if (target.noteCount >= kMaxNotesPerStep) {
    return false;
  }

  target.pitchSteps[target.noteCount++] = pitchSteps;
  sortStepNotes(target);
  return true;
}

}  // namespace sequencer
#endif
