#pragma once

#include "../FirmwareModule.h"
#include "../config/FeatureFlags.h"
#include "../model/ScalePalettePreset.h"

extern bool settingsFileMissingOnBoot;

#if HEXBOARD_BOOT_DIAGNOSTICS
enum class BootDiagnosticStage : uint8_t {
  FileSystem,
  Hardware,
  Settings,
  SynthPresets,
  SynthPresetReference,
  SynthWavetables,
  Geometry,
  Interface,
  SynthRuntime,
  Ready,
};
#endif

void setupLEDs();
#if HEXBOARD_BOOT_DIAGNOSTICS
void showBootDiagnosticStage(BootDiagnosticStage stage);
#endif
void clearLEDs();
void runBootLedSelfCheck();
void setLEDcolorCodes();
uint32_t RAM_FUNC(getLEDcode)(colorDef c);
uint32_t RAM_FUNC(getLEDcodeLinear)(colorDef c);
uint32_t RAM_FUNC(gammaLEDcode)(uint32_t color);
bool RAM_FUNC(getBaseLedColorForPitchSteps)(int16_t pitchSteps, colorDef& colorOut);
void RAM_FUNC(applyLedCurrentLimitToFrame)();
void RAM_FUNC(resetVelocityLEDs)();
void RAM_FUNC(resetWheelLEDs)();
uint32_t RAM_FUNC(applyNotePixelColor)(byte x);
void lightUpLEDs();
