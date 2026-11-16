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
#include "SequencerUsbBackup.h"
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

LedColor ledColor(float hue, byte saturation, byte value) {
  LedHsv color = {
    hue,
    saturation,
    scaleLedLevel(value, ledRestBrightness)
  };
  return getLEDcode(color);
}

LedColor emptySelectedStepColor() {
  return ledColor(HUE_NONE, SAT_BW, kStepLightHigh);
}

LedColor neutralStepColor(byte value) {
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

LedColor scalePerceptualLedColor(LedColor color, byte level) {
  if (level == kStepLightOff) {
    return 0;
  }
  if (level >= kStepLightHighest) {
    return applyLedGamma16(color);
  }

  return applyLedGamma16(scaleLedColor16(color, static_cast<uint16_t>(level) * 257u));
}

LedColor filledStepColor(float hue, byte saturation, byte level) {
  LedHsv referenceColor = {
    hue,
    saturation,
    scaleLedLevel(kStepLightHighest, ledRestBrightness)
  };
  return scalePerceptualLedColor(getLedPerceptualRgb16(referenceColor), level);
}

LedColor regularProgrammedStepColor(bool selected, bool playing, bool accented) {
  byte level = programmedStepLightLevel(selected, playing, accented);
  return filledStepColor(stepHueValue(stepHue()), SAT_VIVID, level);
}

bool noteProgrammedStepColor(int16_t pitchSteps,
                             bool selected,
                             bool playing,
                             bool accented,
                             LedColor& colorOut) {
  LedHsv baseColor = {};
  if (!getBaseLedColorForPitchSteps(pitchSteps, baseColor)) {
    return false;
  }

  byte level = programmedStepLightLevel(selected, playing, accented);
  colorOut = filledStepColor(baseColor.hue, baseColor.sat, level);
  return true;
}

LedColor programmedStepColor(byte stepIndex, bool selected, bool playing, bool accented) {
  if (stepColorMode() == kStepColorNote) {
    const SequencerStep& target = step(stepIndex);
    if (target.noteCount > 0) {
      LedColor color = 0;
      if (noteProgrammedStepColor(target.pitchSteps[0], selected, playing, accented, color)) {
        return color;
      }
    }
  }
  return regularProgrammedStepColor(selected, playing, accented);
}

LedColor stoppedTransportColor() {
  return ledColor(HUE_RED, SAT_VIVID, VALUE_FULL);
}

LedColor runningTransportColor() {
  return ledColor(HUE_GREEN, SAT_VIVID, VALUE_FULL);
}

LedColor emptyStepColor(bool selected, bool playing, bool accented) {
  if (accented) {
    return neutralStepColor((selected || playing) ? kStepLightHighest : kStepLightMedium);
  }
  if (selected || playing) {
    return emptySelectedStepColor();
  }
  return 0;
}

LedColor confirmClearColor() {
  byte value = confirmClearHeld() ? VALUE_FULL : kActionBlueValue;
  return ledColor(kActionBlueHue, SAT_VIVID, value);
}

LedColor utilityWhiteColor(bool active) {
  return ledColor(HUE_NONE, SAT_BW, active ? kStepLightHigh : kStepLightMedium);
}

LedColor actionBlueColor() {
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

  if (isUsbBackupActive()) {
    clearLedFrame(setLedPixel);
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

    LedColor color = programmedStepColor(stepIndex, selected, playing, accented);
    setLedPixel(static_cast<byte>(buttonIndex), color);
  }

  setLedPixel(kConfirmClearButtonIndex, hasSelectedStep() ? confirmClearColor() : 0);
  setLedPixel(
    kFunctionGuardButtonIndex,
    utilityWhiteColor(mode == SequencerToolMode::ToolsPicker || statusMessageIsToolsPrompt()));

  if (mode == SequencerToolMode::ToolsPicker) {
    const SequencerToolKey* keys = toolKeys();
    LedColor blue = actionBlueColor();
    for (byte i = 0; i < toolKeyCount(); ++i) {
      setLedPixel(keys[i].buttonIndex, blue);
    }
  } else if (mode == SequencerToolMode::ExactLength) {
    const SequencerTextKey* keys = exactLengthKeys();
    LedColor blue = actionBlueColor();
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
