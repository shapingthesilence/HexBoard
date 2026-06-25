#pragma once

#include "../FirmwareModule.h"

namespace sequencer {

constexpr byte kStepCount = 32;
constexpr byte kMaxNotesPerStep = 6;
constexpr uint16_t kDefaultGatePercent = 100;
constexpr byte kDefaultVelocity = 96;
constexpr byte kDefaultProbability = 100;
constexpr int8_t kNoSelectedStep = -1;

struct SequencerStep {
  int16_t pitchSteps[kMaxNotesPerStep] = {};
  byte noteCount = 0;
  uint16_t gatePercent = kDefaultGatePercent;
  byte velocity = kDefaultVelocity;
  byte probability = kDefaultProbability;
  bool tie = false;
};

struct SequencerStepSnapshot {
  int16_t pitchSteps[kMaxNotesPerStep] = {};
  byte noteCount = 0;
  uint16_t gatePercent = kDefaultGatePercent;
  byte velocity = kDefaultVelocity;
  byte probability = kDefaultProbability;
  bool tie = false;
};

enum class SequencerTransposeResult : byte {
  Changed,
  Empty,
  OutOfRange,
  Unchanged
};

const SequencerStep& step(byte stepIndex);
int8_t selectedStepIndex();
bool hasSelectedStep();
void selectStep(byte stepIndex);
void deselectStep();
void resetStep(byte stepIndex);
void resetAllSteps();
bool stepIsProgrammed(byte stepIndex);
bool togglePitchOnSelectedStep(int16_t pitchSteps);
void snapshotStep(byte stepIndex, SequencerStepSnapshot& snapshot);
void restoreStep(byte stepIndex, const SequencerStepSnapshot& snapshot);
void clearStepNotesAndTie(byte stepIndex);
void copyStep(byte sourceStep, byte destinationStep);
bool setStepGatePercent(byte stepIndex, uint16_t gatePercent);
bool setStepVelocity(byte stepIndex, byte velocity);
bool setStepProbability(byte stepIndex, byte probability);
bool setStepTie(byte stepIndex, bool tie);
SequencerTransposeResult transposeStep(byte stepIndex, int16_t pitchStepDelta, int16_t currentTranspose, int cycleLength);

}  // namespace sequencer
