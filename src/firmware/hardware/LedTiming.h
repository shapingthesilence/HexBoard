#pragma once
#include <stddef.h>
#include <stdint.h>

constexpr uint8_t LED_DEFAULT_DITHER_BITS = 10;
constexpr int LED_FRAME_PERIOD_MIN_US = 4328;
constexpr int LED_FRAME_PERIOD_MAX_US = 5000;
constexpr int LED_FRAME_PERIOD_STEP_US = 4;
constexpr unsigned LED_FRAME_BIT_COUNT_BITS = 12;
constexpr uint32_t LED_FRAME_BIT_COUNT_MASK = (1u << LED_FRAME_BIT_COUNT_BITS) - 1;

inline int normalizeLedFramePeriod(int periodMicros) {
  if (periodMicros < LED_FRAME_PERIOD_MIN_US) return LED_FRAME_PERIOD_MIN_US;
  if (periodMicros > LED_FRAME_PERIOD_MAX_US) return LED_FRAME_PERIOD_MAX_US;
  return LED_FRAME_PERIOD_MIN_US +
         ((periodMicros - LED_FRAME_PERIOD_MIN_US + LED_FRAME_PERIOD_STEP_US / 2) /
          LED_FRAME_PERIOD_STEP_US) * LED_FRAME_PERIOD_STEP_US;
}

// PIO runs at 8 MHz. 140 RGB pixels take 4200us; each reset-loop iteration
// takes 32 clocks (4us). Four framing instructions add 0.5us, so the menu
// displays the integer part of the nominal period (4328 means 4328.5us).
inline uint32_t ledFrameHeader(size_t count, int periodMicros) {
  unsigned resetIterations = (normalizeLedFramePeriod(periodMicros) - 4200) / 4;
  return ((resetIterations - 1) << LED_FRAME_BIT_COUNT_BITS) | (count * 24 - 1);
}
