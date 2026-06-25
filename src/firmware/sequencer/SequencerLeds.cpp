#include "SequencerLeds.h"

#include "../config/FeatureFlags.h"

#if HEXBOARD_ENABLE_SEQUENCER
#include "SequencerFileMenu.h"
#include "SequencerInput.h"
#include "SequencerLightSettings.h"
#include "SequencerOverlay.h"
#include "SequencerPlaybackSettings.h"
#include "SequencerState.h"
#include "SequencerTools.h"
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
constexpr uint64_t kSelectedStepBlinkOnMicros = 600000ULL;
constexpr uint64_t kSelectedStepBlinkOffMicros = 200000ULL;

bool selectedStepBlinkLit() {
  uint64_t cycleMicros = kSelectedStepBlinkOnMicros + kSelectedStepBlinkOffMicros;
  if (cycleMicros == 0) {
    return true;
  }
  return (runTime % cycleMicros) < kSelectedStepBlinkOnMicros;
}

uint32_t ledColor(float hue, byte saturation, byte value) {
  colorDef color = {
    hue,
    saturation,
    applyLEDLevel(value, ledRestBrightness)
  };
  return getLEDcode(color);
}

uint32_t emptySelectedStepColor() {
  return ledColor(HUE_NONE, SAT_BW, kStepLightHigh);
}

uint32_t neutralStepColor(byte value) {
  return ledColor(HUE_NONE, SAT_BW, value);
}

byte programmedStepLightLevel(bool selected, bool playing, bool accented) {
  if (playing) {
    return kStepLightHighest;
  }
  if (selected || accented) {
    return kStepLightHigh;
  }
  return kStepLightMedium;
}

uint32_t scaleLinearLedColor(uint32_t color, byte level) {
  if (level == kStepLightOff) {
    return 0;
  }
  if (level >= kStepLightHighest) {
    return gammaLEDcode(color);
  }

  uint32_t scaled = 0;
  for (byte shift = 0; shift <= 16; shift += 8) {
    uint32_t channel = (color >> shift) & 0xFF;
    channel = (channel * level + 127) / 255;
    scaled |= (channel << shift);
  }
  return gammaLEDcode(scaled);
}

uint32_t filledStepColor(float hue, byte saturation, byte level) {
  colorDef referenceColor = {
    hue,
    saturation,
    applyLEDLevel(kStepLightHighest, ledRestBrightness)
  };
  return scaleLinearLedColor(getLEDcodeLinear(referenceColor), level);
}

uint32_t regularProgrammedStepColor(bool selected, bool playing, bool accented) {
  byte level = programmedStepLightLevel(selected, playing, accented);
  return filledStepColor(stepHueValue(stepHue()), SAT_VIVID, level);
}

bool noteProgrammedStepColor(int16_t pitchSteps,
                             bool selected,
                             bool playing,
                             bool accented,
                             uint32_t& colorOut) {
  colorDef baseColor = {};
  if (!getBaseLedColorForPitchSteps(pitchSteps, baseColor)) {
    return false;
  }

  byte level = programmedStepLightLevel(selected, playing, accented);
  colorOut = filledStepColor(baseColor.hue, baseColor.sat, level);
  return true;
}

uint32_t programmedStepColor(byte stepIndex, bool selected, bool playing, bool accented) {
  if (stepColorMode() == kStepColorNote) {
    const SequencerStep& target = step(stepIndex);
    if (target.noteCount > 0) {
      uint32_t color = 0;
      if (noteProgrammedStepColor(target.pitchSteps[0], selected, playing, accented, color)) {
        return color;
      }
    }
  }
  return regularProgrammedStepColor(selected, playing, accented);
}

uint32_t stoppedTransportColor() {
  return ledColor(HUE_RED, SAT_VIVID, VALUE_FULL);
}

uint32_t runningTransportColor() {
  return ledColor(HUE_GREEN, SAT_VIVID, VALUE_FULL);
}

uint32_t emptyStepColor(bool selected, bool playing, bool accented) {
  if (accented) {
    return neutralStepColor((selected || playing) ? kStepLightHighest : kStepLightMedium);
  }
  if (selected || playing) {
    return emptySelectedStepColor();
  }
  return 0;
}

uint32_t confirmClearColor() {
  byte value = confirmClearHeld() ? VALUE_FULL : kActionBlueValue;
  return ledColor(kActionBlueHue, SAT_VIVID, value);
}

uint32_t utilityWhiteColor(bool active) {
  return ledColor(HUE_NONE, SAT_BW, active ? kStepLightHigh : kStepLightMedium);
}

uint32_t actionBlueColor() {
  return ledColor(kActionBlueHue, SAT_VIVID, kActionBlueValue);
}

void clearLedFrame(SetLedPixelFn setLedPixel) {
  for (byte buttonIndex = 0; buttonIndex < LED_COUNT; ++buttonIndex) {
    setLedPixel(buttonIndex, 0);
  }
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

  SequencerToolMode mode = toolMode();
  if (mode == SequencerToolMode::ToolsPicker ||
      mode == SequencerToolMode::ExactLength ||
      mode == SequencerToolMode::ExactVelocity ||
      mode == SequencerToolMode::ExactProbability ||
      mode == SequencerToolMode::CopyTarget) {
    clearLedFrame(setLedPixel);
  }

  neutralizeOwnedGuards(setLedPixel);
  setLedPixel(kTransportGuardButtonIndex, transportRunning() ? runningTransportColor() : stoppedTransportColor());
  setLedPixel(kOverviewGuardButtonIndex, utilityWhiteColor(overviewActive()));

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
    bool accented = stepIsAccented(stepIndex);
    if (selected && !selectedStepBlinkLit()) {
      setLedPixel(static_cast<byte>(buttonIndex), 0);
      continue;
    }

    if (!programmed) {
      setLedPixel(static_cast<byte>(buttonIndex), emptyStepColor(selected, playing, accented));
      continue;
    }

    uint32_t color = programmedStepColor(stepIndex, selected, playing, accented);
    setLedPixel(static_cast<byte>(buttonIndex), color);
  }

  setLedPixel(kConfirmClearButtonIndex, hasSelectedStep() ? confirmClearColor() : 0);
  setLedPixel(
    kFunctionGuardButtonIndex,
    utilityWhiteColor(mode == SequencerToolMode::ToolsPicker || statusMessageIsToolsPrompt()));

  if (mode == SequencerToolMode::ToolsPicker) {
    const SequencerToolKey* keys = toolKeys();
    uint32_t blue = actionBlueColor();
    for (byte i = 0; i < toolKeyCount(); ++i) {
      setLedPixel(keys[i].buttonIndex, blue);
    }
  } else if (mode == SequencerToolMode::ExactLength) {
    const SequencerTextKey* keys = exactLengthKeys();
    uint32_t blue = actionBlueColor();
    for (byte i = 0; i < exactLengthKeyCount(); ++i) {
      setLedPixel(keys[i].buttonIndex, blue);
    }
  }

  renderFileMenuLedOverrides(setLedPixel);
}

}  // namespace sequencer
#else
namespace sequencer {

void renderLedOverrides(SetLedPixelFn /*setLedPixel*/) {
}

}  // namespace sequencer
#endif
