#pragma once

#include <stdint.h>

// Dynamic OLED content shares one cadence. Producers retain their latest state
// between frames, so limiting presentation rate never drops control data.
constexpr uint64_t DISPLAY_REFRESH_INTERVAL_MICROS = 50000ULL;

inline bool displayRefreshDue(uint64_t now, uint64_t lastRefreshAt) {
  return lastRefreshAt == 0
         || (now - lastRefreshAt) >= DISPLAY_REFRESH_INTERVAL_MICROS;
}
