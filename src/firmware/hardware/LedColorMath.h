#pragma once
#include "LedColor.h"
#include <algorithm>

// Adafruit's 2.6 response, evaluated to 16 bits rather than expanding gamma8.
// RAM table keeps conversion independent of flash reads during normal rendering.

inline uint16_t gammaChannel16(uint16_t value) {
  static uint16_t gammaTable[257] = {
    0, 0, 0, 1, 1, 2, 4, 6, 8, 11, 14, 18, 23, 28, 34, 41,
    49, 57, 66, 76, 87, 98, 111, 125, 139, 155, 171, 189, 208, 228, 249, 271,
    294, 319, 344, 371, 399, 429, 460, 492, 525, 560, 596, 634, 673, 714, 755, 799,
    844, 890, 938, 988, 1039, 1092, 1146, 1202, 1260, 1319, 1380, 1443, 1507, 1574, 1642, 1711,
    1783, 1856, 1931, 2008, 2087, 2168, 2251, 2335, 2422, 2510, 2600, 2693, 2787, 2884, 2982, 3082,
    3185, 3289, 3396, 3505, 3616, 3729, 3844, 3961, 4080, 4202, 4326, 4452, 4580, 4711, 4844, 4979,
    5116, 5256, 5398, 5542, 5689, 5838, 5990, 6144, 6300, 6459, 6620, 6783, 6949, 7118, 7289, 7463,
    7639, 7817, 7998, 8182, 8368, 8557, 8749, 8943, 9139, 9339, 9541, 9745, 9953, 10163, 10376, 10591,
    10809, 11030, 11254, 11480, 11710, 11942, 12176, 12414, 12655, 12898, 13144, 13393, 13645, 13900, 14158, 14419,
    14682, 14949, 15218, 15491, 15766, 16045, 16326, 16611, 16898, 17189, 17482, 17779, 18079, 18382, 18688, 18997,
    19309, 19624, 19943, 20265, 20589, 20917, 21249, 21583, 21921, 22262, 22606, 22953, 23304, 23658, 24015, 24375,
    24739, 25106, 25477, 25850, 26228, 26608, 26992, 27379, 27770, 28164, 28562, 28963, 29367, 29775, 30186, 30601,
    31019, 31441, 31866, 32295, 32728, 33164, 33603, 34046, 34493, 34943, 35397, 35854, 36315, 36780, 37248, 37720,
    38196, 38675, 39158, 39645, 40135, 40629, 41127, 41628, 42134, 42643, 43156, 43672, 44192, 44717, 45245, 45776,
    46312, 46852, 47395, 47942, 48493, 49048, 49607, 50170, 50736, 51307, 51881, 52460, 53042, 53628, 54219, 54813,
    55411, 56014, 56620, 57230, 57845, 58463, 59085, 59712, 60343, 60977, 61616, 62259, 62906, 63557, 64212, 64871,
    65535
  };

  if (value == 65535) return 65535;
  uint32_t position = static_cast<uint32_t>(value) * 256;
  unsigned index = position / 65535;
  uint32_t fraction = position % 65535;
  return gammaTable[index] +
         (static_cast<uint32_t>(gammaTable[index + 1] - gammaTable[index]) * fraction + 32767) / 65535;
}
inline LedColor gammaColor16(LedColor color) {
  return {gammaChannel16(color.r), gammaChannel16(color.g), gammaChannel16(color.b)};
}
inline uint16_t normalizedChannel(float value) {
  return static_cast<uint16_t>(std::clamp(value, 0.0f, 1.0f) * 65535.0f + 0.5f);
}
inline LedColor hsvColor16(uint16_t hue, float saturation, float value) {
  float h6 = hue * (6.0f / 65536.0f);
  int sector = static_cast<int>(h6);
  float fraction = h6 - sector;
  float s = std::clamp(saturation / 255.0f, 0.0f, 1.0f);
  float v = std::clamp(value / 255.0f, 0.0f, 1.0f);
  uint16_t top = normalizedChannel(v);
  uint16_t bottom = normalizedChannel(v * (1.0f - s));
  uint16_t falling = normalizedChannel(v * (1.0f - s * fraction));
  uint16_t rising = normalizedChannel(v * (1.0f - s * (1.0f - fraction)));
  switch (sector) {
    case 0: return {top, rising, bottom};
    case 1: return {falling, top, bottom};
    case 2: return {bottom, top, rising};
    case 3: return {bottom, falling, top};
    case 4: return {rising, bottom, top};
    default: return {top, bottom, falling};
  }
}
