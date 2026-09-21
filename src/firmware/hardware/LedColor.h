#pragma once

#include <stdint.h>

// Linear LED-drive channels after gamma, or perceptual RGB before gamma.
// The owning API explicitly names the latter; never quantize until transport.
struct LedColor {
  uint16_t r, g, b;
  constexpr LedColor(uint32_t rgb8 = 0)
      : r(((rgb8 >> 16) & 255) * 257), g(((rgb8 >> 8) & 255) * 257), b((rgb8 & 255) * 257) {}
  constexpr LedColor(uint16_t red, uint16_t green, uint16_t blue) : r(red), g(green), b(blue) {}
  constexpr bool operator==(const LedColor& other) const { return r == other.r && g == other.g && b == other.b; }
  constexpr bool operator!=(const LedColor& other) const { return !(*this == other); }
};
static_assert(sizeof(LedColor) == 6, "RGB16 must remain compact");

inline uint16_t scaleLedChannel16(uint16_t value, uint16_t scale) {
  return (static_cast<uint32_t>(value) * scale + 32767u) / 65535u;
}
inline LedColor scaleLedColor16(LedColor color, uint16_t scale) {
  return {scaleLedChannel16(color.r, scale), scaleLedChannel16(color.g, scale), scaleLedChannel16(color.b, scale)};
}

// Round once to half/quarter codes. Full scale is 255 * phases, not 256 * phases.
// At four phases, promote the lone quarter-code to a half-code. This avoids the
// lowest nonzero level spending three consecutive frames off; its alternating
// 1,0 pattern moves the remaining flicker to the two-phase rate.
inline uint16_t quantizeLedChannel(uint16_t value, uint8_t phases) {
  uint16_t quantized = (static_cast<uint32_t>(value) * (255u * phases) + 32767u) / 65535u;
  return phases == 4 && quantized == 1 ? 2 : quantized;
}
inline uint8_t ledChannelPhase(uint16_t quantized, uint8_t phases, uint8_t phase) {
  // Four-phase order 0,2,1,3 makes half levels alternate at the two-phase rate.
  uint8_t rank = phases == 4 ? ((phase & 1u) * 2u + ((phase >> 1u) & 1u)) : (phase % phases);
  return quantized / phases + (rank < quantized % phases);
}
