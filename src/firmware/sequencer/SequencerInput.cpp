#include "SequencerInput.h"

#include "../config/FeatureFlags.h"

#if HEXBOARD_ENABLE_SEQUENCER
#include "SequencerManagedNotes.h"
#include "SequencerOverlay.h"
#include "SequencerPlaybackSettings.h"
#include "SequencerState.h"
#include "SequencerTransport.h"
#include "../app/DiagnosticsTiming.h"
#include "../hardware/GridState.h"
#include "../tuning/Tuning.h"

namespace sequencer {
namespace {

constexpr byte kConfirmClearButtonIndex = 19;
constexpr byte kTransportButtonIndex = 9;
constexpr uint64_t kClearHoldMicros = 1000000ULL;

bool confirmHeld = false;
uint64_t confirmPressedAt = 0;

bool buttonPitchSteps(byte buttonIndex, int16_t& pitchSteps) {
  if (buttonIndex >= LED_COUNT) {
    return false;
  }

  byte row = buttonIndex / COLCOUNT;
  if (row < 4 || h[buttonIndex].isCmd || h[buttonIndex].note == UNUSED_NOTE || h[buttonIndex].frequency <= 0.0f) {
    return false;
  }

  pitchSteps = h[buttonIndex].stepsFromC;
  return true;
}

byte auditionVelocity() {
  if (!hasSelectedStep()) {
    return kDefaultVelocity;
  }
  return step(static_cast<byte>(selectedStepIndex())).velocity;
}

void selectOrDeselectStep(byte stepIndex) {
  stopPreviewNotes();

  if (selectedStepIndex() == static_cast<int8_t>(stepIndex)) {
    deselectStep();
    hideSelectedStepOverlay();
    return;
  }

  selectStep(stepIndex);
  markOverlayDirty();
  if (tapPreview() == kTapPreviewOn) {
    previewStep(stepIndex);
  }
}

}  // namespace

int8_t buttonIndexToStep(byte buttonIndex) {
  if (buttonIndex >= 1 && buttonIndex <= 8) {
    return static_cast<int8_t>(buttonIndex - 1);
  }
  if (buttonIndex >= 10 && buttonIndex <= 17) {
    return static_cast<int8_t>(8 + (buttonIndex - 10));
  }
  if (buttonIndex >= 21 && buttonIndex <= 28) {
    return static_cast<int8_t>(16 + (buttonIndex - 21));
  }
  if (buttonIndex >= 30 && buttonIndex <= 37) {
    return static_cast<int8_t>(24 + (buttonIndex - 30));
  }
  return -1;
}

int8_t stepToButtonIndex(byte stepIndex) {
  if (stepIndex < 8) {
    return static_cast<int8_t>(stepIndex + 1);
  }
  if (stepIndex < 16) {
    return static_cast<int8_t>(10 + (stepIndex - 8));
  }
  if (stepIndex < 24) {
    return static_cast<int8_t>(21 + (stepIndex - 16));
  }
  if (stepIndex < kStepCount) {
    return static_cast<int8_t>(30 + (stepIndex - 24));
  }
  return -1;
}

bool confirmClearHeld() {
  return confirmHeld;
}

void resetInputState() {
  confirmHeld = false;
  confirmPressedAt = 0;
}

void serviceInput() {
  if (!confirmHeld || !hasSelectedStep()) {
    return;
  }
  if ((runTime - confirmPressedAt) >= kClearHoldMicros) {
    resetStep(static_cast<byte>(selectedStepIndex()));
    stopPreviewNotes();
    markOverlayDirty();
    resetInputState();
  }
}

void handleButtonEvent(byte buttonIndex, bool pressed) {
  if (!pressed) {
    if (buttonIndex == kConfirmClearButtonIndex) {
      resetInputState();
    }
    int16_t releasedPitchSteps = 0;
    if (buttonPitchSteps(buttonIndex, releasedPitchSteps)) {
      stopManagedNote(releasedPitchSteps, SequencerManagedNoteRole::Audition);
    }
    return;
  }

  if (buttonIndex == kConfirmClearButtonIndex) {
    if (hasSelectedStep()) {
      confirmHeld = true;
      confirmPressedAt = runTime;
    }
    return;
  }

  if (buttonIndex == kTransportButtonIndex) {
    toggleTransport();
    resetInputState();
    return;
  }

  int8_t stepIndex = buttonIndexToStep(buttonIndex);
  if (stepIndex >= 0) {
    selectOrDeselectStep(static_cast<byte>(stepIndex));
    resetInputState();
    return;
  }

  int16_t pitchSteps = 0;
  if (buttonPitchSteps(buttonIndex, pitchSteps)) {
    startManagedNote(pitchSteps, auditionVelocity(), SequencerManagedNoteRole::Audition);
    if (hasSelectedStep() && togglePitchOnSelectedStep(pitchSteps)) {
      markOverlayDirty();
    }
  }
}

}  // namespace sequencer
#endif
