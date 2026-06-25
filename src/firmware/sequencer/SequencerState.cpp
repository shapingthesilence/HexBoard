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

void clearStepNotes(SequencerStep& target) {
  for (byte i = 0; i < kMaxNotesPerStep; ++i) {
    target.pitchSteps[i] = 0;
  }
  target.noteCount = 0;
}

void copyStepData(const SequencerStep& source, SequencerStep& destination) {
  clearStepNotes(destination);
  byte count = (source.noteCount < kMaxNotesPerStep) ? source.noteCount : kMaxNotesPerStep;
  for (byte i = 0; i < count; ++i) {
    destination.pitchSteps[i] = source.pitchSteps[i];
  }
  destination.noteCount = count;
  destination.gatePercent = source.gatePercent;
  destination.velocity = source.velocity;
  destination.probability = source.probability;
  destination.tie = source.tie;
  sortStepNotes(destination);
}

void copySnapshotToStep(const SequencerStepSnapshot& source, SequencerStep& destination) {
  clearStepNotes(destination);
  byte count = (source.noteCount < kMaxNotesPerStep) ? source.noteCount : kMaxNotesPerStep;
  for (byte i = 0; i < count; ++i) {
    destination.pitchSteps[i] = source.pitchSteps[i];
  }
  destination.noteCount = count;
  destination.gatePercent = (source.gatePercent < 1000) ? source.gatePercent : 1000;
  destination.velocity = (source.velocity < 127) ? source.velocity : 127;
  destination.probability = (source.probability < 100) ? source.probability : 100;
  destination.tie = source.tie;
  sortStepNotes(destination);
}

void copyStepToSnapshot(const SequencerStep& source, SequencerStepSnapshot& destination) {
  destination = SequencerStepSnapshot{};
  byte count = (source.noteCount < kMaxNotesPerStep) ? source.noteCount : kMaxNotesPerStep;
  for (byte i = 0; i < count; ++i) {
    destination.pitchSteps[i] = source.pitchSteps[i];
  }
  destination.noteCount = count;
  destination.gatePercent = source.gatePercent;
  destination.velocity = source.velocity;
  destination.probability = source.probability;
  destination.tie = source.tie;
}

int positiveModulo(int value, int modulus) {
  if (modulus <= 0) {
    return 0;
  }
  int result = value % modulus;
  return (result < 0) ? (result + modulus) : result;
}

int displayedOctaveForPitchSteps(int16_t pitchSteps, int16_t currentTranspose, int cycleLength) {
  int safeCycleLength = (cycleLength > 0) ? cycleLength : 12;
  int displayedPitch = static_cast<int>(pitchSteps) + currentTranspose;
  int stepInCycle = positiveModulo(displayedPitch, safeCycleLength);
  return ((displayedPitch - stepInCycle) / safeCycleLength) + 4;
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

void snapshotStep(byte stepIndex, SequencerStepSnapshot& snapshot) {
  if (!validStepIndex(stepIndex)) {
    snapshot = SequencerStepSnapshot{};
    return;
  }
  copyStepToSnapshot(sequencerSteps[stepIndex], snapshot);
}

void restoreStep(byte stepIndex, const SequencerStepSnapshot& snapshot) {
  if (validStepIndex(stepIndex)) {
    copySnapshotToStep(snapshot, sequencerSteps[stepIndex]);
  }
}

void clearStepNotesAndTie(byte stepIndex) {
  if (!validStepIndex(stepIndex)) {
    return;
  }
  clearStepNotes(sequencerSteps[stepIndex]);
  sequencerSteps[stepIndex].tie = false;
}

void copyStep(byte sourceStep, byte destinationStep) {
  if (!validStepIndex(sourceStep) || !validStepIndex(destinationStep)) {
    return;
  }
  copyStepData(sequencerSteps[sourceStep], sequencerSteps[destinationStep]);
}

bool setStepGatePercent(byte stepIndex, uint16_t gatePercent) {
  if (!validStepIndex(stepIndex)) {
    return false;
  }
  uint16_t clamped = (gatePercent < 1000) ? gatePercent : 1000;
  if (sequencerSteps[stepIndex].gatePercent == clamped) {
    return false;
  }
  sequencerSteps[stepIndex].gatePercent = clamped;
  return true;
}

bool setStepVelocity(byte stepIndex, byte velocity) {
  if (!validStepIndex(stepIndex)) {
    return false;
  }
  byte clamped = (velocity < 127) ? velocity : 127;
  if (sequencerSteps[stepIndex].velocity == clamped) {
    return false;
  }
  sequencerSteps[stepIndex].velocity = clamped;
  return true;
}

bool setStepProbability(byte stepIndex, byte probability) {
  if (!validStepIndex(stepIndex)) {
    return false;
  }
  byte clamped = (probability < 100) ? probability : 100;
  if (sequencerSteps[stepIndex].probability == clamped) {
    return false;
  }
  sequencerSteps[stepIndex].probability = clamped;
  return true;
}

bool setStepTie(byte stepIndex, bool tie) {
  if (!validStepIndex(stepIndex)) {
    return false;
  }
  if (sequencerSteps[stepIndex].tie == tie) {
    return false;
  }
  sequencerSteps[stepIndex].tie = tie;
  return true;
}

SequencerTransposeResult transposeStep(byte stepIndex, int16_t pitchStepDelta, int16_t currentTranspose, int cycleLength) {
  if (!validStepIndex(stepIndex) || sequencerSteps[stepIndex].noteCount == 0) {
    return SequencerTransposeResult::Empty;
  }

  const SequencerStep& source = sequencerSteps[stepIndex];
  for (byte i = 0; i < source.noteCount && i < kMaxNotesPerStep; ++i) {
    int32_t transposed = static_cast<int32_t>(source.pitchSteps[i]) + pitchStepDelta;
    if (transposed < -32768 || transposed > 32767) {
      return SequencerTransposeResult::OutOfRange;
    }
    int octave = displayedOctaveForPitchSteps(static_cast<int16_t>(transposed), currentTranspose, cycleLength);
    if (octave < 0 || octave > 9) {
      return SequencerTransposeResult::OutOfRange;
    }
  }

  SequencerStep transposedStep = source;
  clearStepNotes(transposedStep);
  for (byte i = 0; i < source.noteCount && i < kMaxNotesPerStep; ++i) {
    int16_t transposedPitch = static_cast<int16_t>(source.pitchSteps[i] + pitchStepDelta);
    if (findPitchIndex(transposedStep, transposedPitch) >= kMaxNotesPerStep &&
        transposedStep.noteCount < kMaxNotesPerStep) {
      transposedStep.pitchSteps[transposedStep.noteCount++] = transposedPitch;
    }
  }
  sortStepNotes(transposedStep);

  bool changed = transposedStep.noteCount != source.noteCount;
  for (byte i = 0; !changed && i < transposedStep.noteCount; ++i) {
    changed = transposedStep.pitchSteps[i] != source.pitchSteps[i];
  }
  if (!changed) {
    return SequencerTransposeResult::Unchanged;
  }

  sequencerSteps[stepIndex] = transposedStep;
  return SequencerTransposeResult::Changed;
}

}  // namespace sequencer
#endif
