#pragma once
#include <stddef.h>
#include <stdint.h>
#include <string.h>

// Frozen on-disk profile widths. Add an explicit entry and conversion whenever
// a version changes; never infer compatibility from file length alone.
constexpr size_t persistedSettingsWidth(uint8_t version) {
  return version == 32 ? 57
       : (version == 33 || version == 34 || version == 35 || version == 37) ? 60
       : version == 36 ? 61 : 0;
}
// The widest supported profile, for sizing read buffers.
constexpr size_t MAX_PERSISTED_SETTINGS_WIDTH = 61;

// Versions 32 through 37 share the same ordered prefix. Destination profiles have
// already been initialized with current factory defaults. References follow
// the profile bytes and are read separately, unchanged. Version 35 preserves
// all existing wheel depths; new negative depths use previously unused bytes.
// Version 36 appended a sampler slot byte. Version 37 removes it again: the
// profile's synth preset or draft now chooses the engine, so the byte is
// dropped when an older file is expanded.
inline void expandPersistedSettings(uint8_t* destination, size_t destinationWidth,
                                    const uint8_t* source, size_t sourceWidth,
                                    size_t profileCount) {
  const size_t copied = sourceWidth < destinationWidth ? sourceWidth : destinationWidth;
  for (size_t profile = 0; profile < profileCount; ++profile) {
    memmove(destination + profile * destinationWidth,
            source + profile * sourceWidth, copied);
  }
}

// Synth record v12 appends one value to the v11 record. v13 appends a 32-byte
// sampler instrument name (empty selects the wavetable engine) and the sampler
// envelope override mask. Profile references and the first 213 payload bytes
// retain their meaning; older records become wavetable presets.
constexpr size_t SYNTH_PRESET_RECORD_WIDTH = 246;
constexpr size_t persistedSynthPresetWidth(uint8_t version) {
  return version == 11 ? 212 : version == 12 ? 213 : version == 13 ? SYNTH_PRESET_RECORD_WIDTH : 0;
}
inline bool expandPersistedSynthPreset(uint8_t* destination, size_t destinationWidth,
                                      const uint8_t* source, size_t sourceWidth,
                                      uint8_t noteLengthDefault) {
  if (destinationWidth != SYNTH_PRESET_RECORD_WIDTH
      || (sourceWidth != 212 && sourceWidth != 213 && sourceWidth != SYNTH_PRESET_RECORD_WIDTH)) return false;
  memmove(destination, source, sourceWidth);
  if (sourceWidth == 212) destination[212] = noteLengthDefault;
  if (sourceWidth < SYNTH_PRESET_RECORD_WIDTH) memset(destination + 213, 0, SYNTH_PRESET_RECORD_WIDTH - 213);
  return true;
}
