#pragma once
#include <stddef.h>
#include <stdint.h>
#include <string.h>

// Frozen on-disk profile widths. Add an explicit entry and conversion whenever
// a version changes; never infer compatibility from file length alone.
constexpr size_t persistedSettingsWidth(uint8_t version) {
  return version == 32 ? 57 : version == 33 ? 60 : 0;
}

// Versions 32 and 33 share the same ordered prefix. Destination profiles have
// already been initialized with current factory defaults. References follow
// the profile bytes and are read separately, unchanged.
inline void expandPersistedSettings(uint8_t* destination, size_t destinationWidth,
                                    const uint8_t* source, size_t sourceWidth,
                                    size_t profileCount) {
  for (size_t profile = 0; profile < profileCount; ++profile) {
    memcpy(destination + profile * destinationWidth,
           source + profile * sourceWidth, sourceWidth);
  }
}
