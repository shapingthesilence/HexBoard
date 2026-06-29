#pragma once

#include "../FirmwareModule.h"

enum class CommandWheelOverlayType : byte {
  Velocity,
  Modulation,
  PitchBend
};

bool commandWheelOverlayActive();
void RAM_FUNC(notifyCommandWheelOverlay)(CommandWheelOverlayType type,
                                         int16_t currentValue,
                                         int16_t minValue,
                                         int16_t maxValue,
                                         bool immediateRedraw);
void RAM_FUNC(dismissCommandWheelOverlay)();
void drawCommandWheelOverlay();
