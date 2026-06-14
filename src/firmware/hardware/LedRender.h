#pragma once

#include "../FirmwareModule.h"
#include "../model/ScalePalettePreset.h"

extern bool settingsFileMissingOnBoot;

uint32_t RAM_FUNC(getLEDcode)(colorDef c);
void RAM_FUNC(applyLedCurrentLimitToFrame)();
void RAM_FUNC(resetVelocityLEDs)();
void RAM_FUNC(resetWheelLEDs)();
uint32_t RAM_FUNC(applyNotePixelColor)(byte x);
void lightUpLEDs();
