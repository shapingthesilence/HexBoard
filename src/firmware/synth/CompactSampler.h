#pragma once
#include <cstddef>
#include <cstdint>

// A sampler sound's preset file ends with its HBC1 instrument
// (SynthPresetCatalog.h); there are no separate instrument files.
// Control/storage entry points are Core 0 only. Loading replaces the exclusive
// sample workspace after an acknowledged render-block boundary.
bool compactSamplerActive();
const char* compactSamplerName();
// The current sound's sampler instrument: its name, and the object id of the
// sound file that holds it. An empty name means the wavetable engine. Presets
// set it; syncCompactSamplerSelection() loads it.
const char* compactSamplerRequestedName();
const uint8_t* compactSamplerRequestedSource();
void requestCompactSampler(const char* name, const uint8_t* sourceObjectId);
// The instrument was copied into another sound file (Save as new, or saved
// over another sound): play it from there without reloading.
void retargetCompactSamplerSource(const uint8_t* sourceObjectId);
// The sound file's instrument changed: reload it if it is the one playing.
void reloadCompactSamplerSource(const uint8_t* sourceObjectId);
// Amp envelope stages the current sampler sound overrides (SAMPLER_ENVELOPE_*).
uint8_t compactSamplerEnvelopeOverride();
void setCompactSamplerEnvelopeOverride(uint8_t mask);
void syncCompactSamplerSelection();
// Switches to the wavetable engine and makes it the current sound's engine.
bool useCompactSamplerWavetableEngine();
// Checks the HBC1 instrument stored at [offset, offset + length) of path and
// copies its name (32 bytes with terminator).
bool validateCompactSamplerInstrument(const char* path, uint32_t offset, uint32_t length, char* name, size_t capacity);
void handleCompactSamplerRequest(uint16_t transaction, const uint8_t* payload, size_t length);
