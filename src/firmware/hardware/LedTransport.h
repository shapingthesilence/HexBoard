#pragma once
#include "LedColor.h"

bool setupLedTransport();
// Single producer: core 1 during boot, core 0 after the boot handoff.
// Bounded, nonblocking. False means all banks are still in use;
// the renderer retries the newest desired frame on its next pass.
bool submitLedFrame(const LedColor* frame, uint8_t bits, uint16_t currentLimitMilliamps, int framePeriodMicros);
