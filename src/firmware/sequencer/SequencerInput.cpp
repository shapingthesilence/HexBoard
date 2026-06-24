#include "SequencerInput.h"

#include "../config/FeatureFlags.h"

#if HEXBOARD_ENABLE_SEQUENCER
#include "SequencerState.h"
#include "../app/DiagnosticsTiming.h"
#include "../hardware/GridState.h"

namespace sequencer {
namespace {

constexpr byte kConfirmClearButtonIndex = 19;
constexpr uint64_t kClearHoldMicros = 1000000ULL;

bool confirmHeld = false;
uint64_t confirmPressedAt = 0;

bool isPlayableNoteButton(byte buttonIndex) {
  return buttonIndex < LED_COUNT && !h[buttonIndex].isCmd;
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
    resetInputState();
  }
}

void handleButtonEvent(byte buttonIndex, bool pressed) {
  if (!pressed) {
    if (buttonIndex == kConfirmClearButtonIndex) {
      resetInputState();
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

  int8_t stepIndex = buttonIndexToStep(buttonIndex);
  if (stepIndex >= 0) {
    if (selectedStepIndex() == stepIndex) {
      deselectStep();
    } else {
      selectStep(static_cast<byte>(stepIndex));
    }
    resetInputState();
    return;
  }

  if (hasSelectedStep() && isPlayableNoteButton(buttonIndex)) {
    togglePitchOnSelectedStep(h[buttonIndex].stepsFromC);
  }
}

}  // namespace sequencer
#endif
