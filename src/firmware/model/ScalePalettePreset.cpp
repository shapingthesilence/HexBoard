#include "ScalePalettePreset.h"

UserGeometryRuntimeState userGeometryRuntime = {};

// Immutable rescue scale and color palette. Editable factory scales and
// per-degree colors are generated into /geometry/*.hgb.
const scaleDef scaleOptions[] = {
  { "All Notes", ALL_TUNINGS, nullptr }
};

extern const byte scaleCount = sizeof(scaleOptions) / sizeof(scaleDef);

namespace {
const colorDef rescueSwatches[] = {
      { HUE_NONE, SAT_BW, VALUE_NORMAL },
      { HUE_RED, SAT_VIVID, VALUE_NORMAL },
      { HUE_ORANGE, SAT_VIVID, VALUE_NORMAL },
      { HUE_YELLOW, SAT_VIVID, VALUE_NORMAL },
      { HUE_GREEN, SAT_VIVID, VALUE_NORMAL },
      { HUE_CYAN, SAT_VIVID, VALUE_NORMAL },
      { HUE_BLUE, SAT_VIVID, VALUE_NORMAL },
      { HUE_INDIGO, SAT_VIVID, VALUE_NORMAL },
      { HUE_PURPLE, SAT_VIVID, VALUE_NORMAL },
      { HUE_MAGENTA, SAT_VIVID, VALUE_NORMAL },
      { HUE_RED, SAT_DULL, VALUE_SHADE },
      { HUE_BLUE, SAT_DULL, VALUE_SHADE }
};
const byte rescueColorNumbers[] = { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12 };
const char* const rescueKeyLabels[] = {
  "C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"
};
}

paletteDef palette[] = { { rescueSwatches, rescueColorNumbers, 12 } };

bool userGeometryScaleIncludes(uint16_t degree) {
  if (userGeometryRuntime.cycleLength == 0) return true;
  degree %= userGeometryRuntime.cycleLength;
  return (userGeometryRuntime.scaleIncluded[degree >> 3] & (1u << (degree & 7))) != 0;
}

colorDef userGeometryDegreeColor(uint16_t degree, uint16_t cycleLength) {
  if (cycleLength == 0) return { HUE_NONE, SAT_BW, VALUE_BLACK };
  degree %= cycleLength;
  const auto& records = userGeometryRuntime.degreeColors;
  for (size_t offset = 0; offset + 5 < records.size(); offset += 6) {
    uint16_t storedDegree = static_cast<uint16_t>(records[offset])
                            | (static_cast<uint16_t>(records[offset + 1]) << 8);
    if (storedDegree != degree) continue;
    uint16_t hueTenthDegrees = static_cast<uint16_t>(records[offset + 2])
                               | (static_cast<uint16_t>(records[offset + 3]) << 8);
    return { static_cast<float>(hueTenthDegrees) / 10.0f, records[offset + 4], records[offset + 5] };
  }
  return {
    360.0f * (static_cast<float>(degree) / static_cast<float>(cycleLength)),
    static_cast<byte>(degree == 0 ? SAT_BW : SAT_VIVID),
    static_cast<byte>(degree == 0 ? VALUE_NORMAL : VALUE_SHADE)
  };
}

void formatTuningDegreeLabel(const tuningDef& tuning, uint16_t degree, char* output, size_t outputLength) {
  if (!output || outputLength == 0) return;
  degree %= std::max<uint16_t>(1, tuning.cycleLength);
  if (&tuning == &userGeometryRuntime.tuning && !userGeometryRuntime.keyLabels.empty()) {
    size_t cursor = 0;
    uint16_t currentDegree = 0;
    while (cursor < userGeometryRuntime.keyLabels.size()) {
      uint8_t length = userGeometryRuntime.keyLabels[cursor++];
      if (cursor + length > userGeometryRuntime.keyLabels.size()) break;
      if (currentDegree == degree) {
        size_t copyLength = std::min<size_t>(length, outputLength - 1);
        memcpy(output, userGeometryRuntime.keyLabels.data() + cursor, copyLength);
        output[copyLength] = '\0';
        return;
      }
      cursor += length;
      ++currentDegree;
    }
  } else if (&tuning == &tuningOptions[TUNING_12EDO] && degree < 12) {
    snprintf(output, outputLength, "%s", rescueKeyLabels[degree]);
    return;
  }
  uint16_t aDegree = positiveMod(static_cast<int>(degree) + tuning.spanCtoA(), tuning.cycleLength);
  if (aDegree == 0) {
    snprintf(output, outputLength, "A");
  } else {
    snprintf(output, outputLength, "A+%u", aDegree);
  }
}

presetDef current = {
  "Default",
  TUNING_12EDO,
  0,
  0,
  -9,
  0
};

byte displayRotationFromDeviceRotation(byte rotation) {
  return (DEVICE_DISPLAY_UPRIGHT_OFFSET + 4 - (rotation % 4)) % 4;
}
