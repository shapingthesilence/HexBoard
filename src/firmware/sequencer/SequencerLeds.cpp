#include "SequencerLeds.h"

#include "../config/FeatureFlags.h"

#if HEXBOARD_ENABLE_SEQUENCER
#include "SequencerInput.h"
#include "SequencerPlaybackSettings.h"
#include "SequencerState.h"
#include "SequencerTransport.h"
#include "../app/DiagnosticsTiming.h"
#include "../app/RuntimeDefaults.h"
#include "../hardware/LedRender.h"
#include "../model/ScalePalettePreset.h"

namespace sequencer {
namespace {

constexpr byte kTransportGuardButtonIndex = 9;
constexpr byte kOverviewGuardButtonIndex = 18;
constexpr byte kConfirmClearButtonIndex = 19;
constexpr byte kFunctionGuardButtonIndex = 29;
constexpr byte kPostStepGuardButtonIndexA = 38;
constexpr byte kPostStepGuardButtonIndexB = 39;
constexpr float kActionBlueHue = 250.0f;
constexpr byte kActionBlueValue = 211;

uint32_t ledColor(float hue, byte saturation, byte value) {
  colorDef color = {
    hue,
    saturation,
    applyLEDLevel(value, ledRestBrightness)
  };
  return getLEDcode(color);
}

uint32_t emptySelectedStepColor() {
  byte value = ((runTime / 250000ULL) % 2) == 0 ? VALUE_FULL : VALUE_LOW;
  return ledColor(HUE_BLUE, SAT_MODERATE, value);
}

uint32_t programmedStepColor(bool selected) {
  if (!selected) {
    return ledColor(HUE_GREEN, SAT_VIVID, VALUE_SHADE);
  }
  byte value = ((runTime / 250000ULL) % 2) == 0 ? VALUE_FULL : VALUE_NORMAL;
  return ledColor(HUE_CYAN, SAT_VIVID, value);
}

uint32_t stoppedTransportColor() {
  return ledColor(HUE_RED, SAT_VIVID, VALUE_FULL);
}

uint32_t runningTransportColor() {
  return ledColor(HUE_GREEN, SAT_VIVID, VALUE_FULL);
}

uint32_t playingStepColor(bool programmed, bool selected) {
  if (selected) {
    return ledColor(HUE_YELLOW, SAT_VIVID, VALUE_FULL);
  }
  if (programmed) {
    return ledColor(HUE_LIME, SAT_VIVID, VALUE_FULL);
  }
  return ledColor(HUE_YELLOW, SAT_MODERATE, VALUE_NORMAL);
}

uint32_t confirmClearColor() {
  byte value = confirmClearHeld() ? VALUE_FULL : kActionBlueValue;
  return ledColor(kActionBlueHue, SAT_VIVID, value);
}

void neutralizeOwnedGuards(SetLedPixelFn setLedPixel) {
  setLedPixel(kOverviewGuardButtonIndex, 0);
  setLedPixel(kFunctionGuardButtonIndex, 0);
  setLedPixel(kPostStepGuardButtonIndexA, 0);
  setLedPixel(kPostStepGuardButtonIndexB, 0);
}

}  // namespace

void renderLedOverrides(SetLedPixelFn setLedPixel) {
  if (setLedPixel == nullptr) {
    return;
  }

  neutralizeOwnedGuards(setLedPixel);
  setLedPixel(kTransportGuardButtonIndex, transportRunning() ? runningTransportColor() : stoppedTransportColor());

  byte activeSteps = activeStepCount();
  for (byte stepIndex = 0; stepIndex < kStepCount; ++stepIndex) {
    int8_t buttonIndex = stepToButtonIndex(stepIndex);
    if (buttonIndex < 0) {
      continue;
    }

    if (stepIndex >= activeSteps) {
      setLedPixel(static_cast<byte>(buttonIndex), 0);
      continue;
    }

    bool selected = selectedStepIndex() == static_cast<int8_t>(stepIndex);
    bool programmed = stepIsProgrammed(stepIndex);
    bool playing = playingStepIndex() == static_cast<int8_t>(stepIndex);
    if (!programmed && !selected && !playing) {
      setLedPixel(static_cast<byte>(buttonIndex), 0);
      continue;
    }

    uint32_t color = playing ? playingStepColor(programmed, selected)
                             : (programmed ? programmedStepColor(selected) : emptySelectedStepColor());
    setLedPixel(static_cast<byte>(buttonIndex), color);
  }

  setLedPixel(kConfirmClearButtonIndex, hasSelectedStep() ? confirmClearColor() : 0);
}

}  // namespace sequencer
#else
namespace sequencer {

void renderLedOverrides(SetLedPixelFn /*setLedPixel*/) {
}

}  // namespace sequencer
#endif
