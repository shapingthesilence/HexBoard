#pragma once
#include "LedColor.h"
#include <stddef.h>
#include <string.h>

// Four physical phases in every DMA cycle. 9-bit banks contain A,B,A,B;
// 8-bit banks repeat the same frame. count must be a multiple of four.
inline uint32_t encodeLedBank(uint32_t* words, const LedColor* frame, size_t count,
                              uint8_t phases, uint16_t scale) {
  const size_t phaseWords = 1 + count * 3 / 4;
  memset(words, 0, 4 * phaseWords * sizeof(uint32_t));
  uint32_t sums[4] = {};
  for (unsigned phase = 0; phase < 4; ++phase) words[phase * phaseWords] = count * 24 - 1;
  for (size_t pixel = 0; pixel < count; ++pixel) {
    LedColor color = scaleLedColor16(frame[pixel], scale);
    uint16_t channels[] = {quantizeLedChannel(color.g, phases),
                           quantizeLedChannel(color.r, phases),
                           quantizeLedChannel(color.b, phases)};
    for (unsigned phase = 0; phase < 4; ++phase) {
      uint32_t* payload = words + phase * phaseWords + 1;
      // Rotate whole pixels; equal RGB channels pulse together to preserve whites.
      uint8_t shiftedPhase = (phase + pixel) % phases;
      for (unsigned channel = 0; channel < 3; ++channel) {
        uint8_t value = ledChannelPhase(channels[channel], phases, shiftedPhase);
        size_t byteIndex = pixel * 3 + channel;
        payload[byteIndex / 4] |= static_cast<uint32_t>(value) << (24 - 8 * (byteIndex % 4));
        sums[phase] += value;
      }
    }
  }
  uint32_t peak = 0;
  for (uint32_t sum : sums) if (sum > peak) peak = sum;
  return peak;
}

inline void encodeLimitedLedBank(uint32_t* words, const LedColor* frame, size_t count,
                                  uint8_t phases, uint16_t currentLimitMilliamps) {
  uint32_t peak = encodeLedBank(words, frame, count, phases, 65535);
  // Preserve the conservative model: 1mA idle/pixel + 20mA/channel.
  // Compare sums before rounding to mA. One common scale for every phase.
  if (currentLimitMilliamps == 0) return;
  uint32_t allowed = currentLimitMilliamps > count
                       ? (currentLimitMilliamps - count) * 255u / 20u : 0;
  if (peak <= allowed) return;
  uint16_t low = 0, high = 65535;
  // Per-phase quantization is monotone. A bounded search finds a safe scale.
  for (unsigned iteration = 0; iteration < 16; ++iteration) {
    uint16_t mid = low + (static_cast<uint32_t>(high) - low + 1) / 2;
    if (encodeLedBank(words, frame, count, phases, mid) <= allowed) low = mid;
    else high = mid - 1;
  }
  encodeLedBank(words, frame, count, phases, low);
}
