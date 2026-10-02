#pragma once
#include <stddef.h>
#include <stdint.h>
#include <string.h>

// Frozen on-disk profile widths. Add an explicit entry and conversion whenever
// a version changes; never infer compatibility from file length alone.
constexpr size_t persistedSettingsWidth(uint8_t version) {
  return version == 32 ? 57 : (version == 33 || version == 34 || version == 35) ? 60 : 0;
}

// Versions 32 through 35 share the same ordered prefix. Destination profiles have
// already been initialized with current factory defaults. References follow
// the profile bytes and are read separately, unchanged. Version 35 preserves
// all existing wheel depths; new negative depths use previously unused bytes.
inline void expandPersistedSettings(uint8_t* destination, size_t destinationWidth,
                                    const uint8_t* source, size_t sourceWidth,
                                    size_t profileCount) {
  for (size_t profile = 0; profile < profileCount; ++profile) {
    memcpy(destination + profile * destinationWidth,
           source + profile * sourceWidth, sourceWidth);
  }
}

// Synth record v12 appends one value to the v11 record. Profile references and
// the first 212 payload bytes retain their meaning.
constexpr size_t persistedSynthPresetWidth(uint8_t version) {
  return version == 11 ? 212 : version == 12 ? 213 : 0;
}
inline bool expandPersistedSynthPreset(uint8_t* destination, size_t destinationWidth,
                                      const uint8_t* source, size_t sourceWidth,
                                      uint8_t noteLengthDefault) {
  if (destinationWidth != 213 || (sourceWidth != 212 && sourceWidth != 213)) return false;
  memmove(destination, source, sourceWidth);
  if (sourceWidth == 212) destination[212] = noteLengthDefault;
  return true;
}
