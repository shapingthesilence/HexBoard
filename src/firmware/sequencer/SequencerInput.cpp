#include "SequencerInput.h"

#include "../config/FeatureFlags.h"

#if HEXBOARD_ENABLE_SEQUENCER
#include "SequencerManagedNotes.h"
#include "SequencerOverlay.h"
#include "SequencerPerformanceMonitor.h"
#include "SequencerPlaybackSettings.h"
#include "SequencerState.h"
#include "SequencerStorage.h"
#include "SequencerTools.h"
#include "SequencerTransport.h"
#include "../app/DiagnosticsTiming.h"
#include "../hardware/GridState.h"
#include "../tuning/Tuning.h"

namespace sequencer {
namespace {

constexpr byte kConfirmClearButtonIndex = 19;
constexpr byte kOverviewButtonIndex = 18;
constexpr byte kTransportButtonIndex = 9;
constexpr uint64_t kClearHoldMicros = 1000000ULL;
constexpr uint64_t kPerformanceHoldMicros = 2000000ULL;

bool confirmHeld = false;
uint64_t confirmPressedAt = 0;
bool transportHeld = false;
bool transportHoldConsumed = false;
uint64_t transportPressedAt = 0;

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
    deselectSelectedStep();
    return;
  }

  selectStepForEditing(stepIndex);
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
  transportHeld = false;
  transportHoldConsumed = false;
  transportPressedAt = 0;
  if (performanceMonitorActive()) {
    hidePerformanceMonitor();
    markOverlayDirty();
  }
}

void serviceInput() {
  serviceTools();

  if (transportHeld && transportPressedAt != 0 && !transportHoldConsumed) {
    uint64_t heldMicros = runTime - transportPressedAt;
    if (heldMicros >= kPerformanceHoldMicros) {
      hideOverview();
      showPerformanceMonitor();
      transportHoldConsumed = true;
      markOverlayDirty();
    }
  }

  if (confirmHeld && hasSelectedStep() && (runTime - confirmPressedAt) >= kClearHoldMicros) {
    clearSelectedStepForHold();
    confirmHeld = false;
    confirmPressedAt = 0;
  }
}

void handleButtonEvent(byte buttonIndex, bool pressed) {
  if (buttonIndex == kTransportButtonIndex) {
    if (pressed) {
      transportHeld = true;
      transportHoldConsumed = false;
      transportPressedAt = runTime;
    } else {
      bool showedPerformanceMonitor = performanceMonitorActive() || transportHoldConsumed;
      transportHeld = false;
      transportHoldConsumed = false;
      transportPressedAt = 0;
      if (showedPerformanceMonitor) {
        hidePerformanceMonitor();
        markOverlayDirty();
      } else {
        if (hasSelectedStep()) {
          hideOverview();
          deselectSelectedStep();
        }
        toggleTransport();
      }
    }
    confirmHeld = false;
    confirmPressedAt = 0;
    return;
  }

  if (!pressed) {
    if (buttonIndex == kConfirmClearButtonIndex) {
      if (confirmHeld && hasSelectedStep()) {
        restoreSelectedStepFromUndo();
      }
      resetInputState();
    }
    int16_t releasedPitchSteps = 0;
    if (buttonPitchSteps(buttonIndex, releasedPitchSteps)) {
      stopManagedNote(releasedPitchSteps, SequencerManagedNoteRole::Audition);
    }
    return;
  }

  if (performanceMonitorActive()) {
    return;
  }

  if (buttonIndex == kToolsButtonIndex) {
    hideOverview();
    if (!cancelCurrentToolEdit()) {
      openToolsForSelectedStep();
    }
    resetInputState();
    return;
  }

  if (toolMode() == SequencerToolMode::StatusMessage && toolModeSuppressesNoteEntry()) {
    extendToolsStatusMessage();
    return;
  }

  if (overviewActive() && buttonIndex != kOverviewButtonIndex) {
    hideOverview();
  }

  if (buttonIndex == kConfirmClearButtonIndex) {
    if (hasSelectedStep()) {
      confirmHeld = true;
      confirmPressedAt = runTime;
    }
    return;
  }

  if (toolMode() == SequencerToolMode::ToolsPicker) {
    const SequencerToolKey* toolKey = toolKeyForButton(buttonIndex);
    if (toolKey != nullptr) {
      handleToolAction(toolKey->action);
      resetInputState();
      return;
    }

    int8_t stepIndex = buttonIndexToStep(buttonIndex);
    if (stepIndex >= 0) {
      stopPreviewNotes();
      selectStepForEditing(static_cast<byte>(stepIndex), SequencerToolMode::ToolsPicker);
      if (tapPreview() == kTapPreviewOn) {
        previewStep(static_cast<byte>(stepIndex));
      }
    }
    return;
  }

  if (toolMode() == SequencerToolMode::ExactLength) {
    handleExactLengthButton(buttonIndex);
    return;
  }

  if (toolMode() == SequencerToolMode::ExactVelocity ||
      toolMode() == SequencerToolMode::ExactProbability) {
    int8_t stepIndex = buttonIndexToStep(buttonIndex);
    if (stepIndex >= 0) {
      stopPreviewNotes();
      handleEncoderStepSwitch(static_cast<byte>(stepIndex));
      if (tapPreview() == kTapPreviewOn) {
        previewStep(static_cast<byte>(stepIndex));
      }
    }
    return;
  }

  if (toolMode() == SequencerToolMode::CopyTarget) {
    int8_t destinationStep = buttonIndexToStep(buttonIndex);
    int8_t sourceStep = copySourceStepIndex();
    if (destinationStep >= 0 && sourceStep >= 0) {
      byte target = static_cast<byte>(destinationStep);
      copyStep(static_cast<byte>(sourceStep), target);
      releasePlaybackForStep(target);
      markSequenceDirty();
      stopPreviewNotes();
      selectStepForEditing(target, SequencerToolMode::ToolsPicker);
      if (tapPreview() == kTapPreviewOn) {
        previewStep(target);
      }
    }
    return;
  }

  if (buttonIndex == kOverviewButtonIndex) {
    showOverviewPage(overviewActive());
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
    bool replaceWithSingleNote = monophonicMode() == kMonophonicModeOn;
    if (hasSelectedStep() && togglePitchOnSelectedStep(pitchSteps, replaceWithSingleNote)) {
      releasePlaybackForStep(static_cast<byte>(selectedStepIndex()));
      returnToNormalEditing();
      markSequenceDirty();
      markOverlayDirty();
    }
  }
}

}  // namespace sequencer
#endif
