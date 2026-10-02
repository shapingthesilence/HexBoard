#pragma once
#include <stdint.h>

// Preserve legacy positive depths 0..127; 128..254 encode -1..-127.
inline int16_t RAM_FUNC(synthWheelAmountDepth)(uint8_t setting) {
  return setting <= 127 ? setting : setting <= 254 ? 127 - static_cast<int16_t>(setting) : 0;
}

inline int16_t RAM_FUNC(scaleSynthWheelDepth)(uint8_t value, uint8_t setting) {
  const int16_t depth = synthWheelAmountDepth(setting);
  const uint16_t magnitude = depth < 0 ? -depth : depth;
  const int16_t scaled = magnitude == 127 ? value : (value * magnitude + 64u) >> 7;
  return depth < 0 ? -scaled : scaled;
}
