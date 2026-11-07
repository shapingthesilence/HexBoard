#pragma once
#include <cstddef>
#include <cstdint>

// Control/storage entry points are Core 0 only. Selection replaces the exclusive
// sample workspace after an acknowledged render-block boundary.
bool compactSamplerActive();
uint8_t compactSamplerSlot();
const char* compactSamplerName();
// With persist, the selection becomes the current sound's engine: it is
// recorded in the requested instrument name and marks settings dirty, so the
// profile draft or a saved preset keeps it.
bool selectCompactSampler(uint8_t slot, bool persist = true);
// The engine the current sound asks for: an instrument name, or "" for the
// wavetable engine. Presets set it; syncCompactSamplerSelection() loads it.
const char* compactSamplerRequestedName();
void requestCompactSampler(const char* name);
bool compactSamplerSlotForName(const char* name, uint8_t& slot);
// Amp envelope stages the current sampler sound overrides (SAMPLER_ENVELOPE_*).
uint8_t compactSamplerEnvelopeOverride();
void setCompactSamplerEnvelopeOverride(uint8_t mask);
void syncCompactSamplerSelection();
void applyMigratedCompactSamplerSelection();
bool compactSamplerFileInfo(uint8_t slot, char* name, size_t capacity, uint32_t& bytes);
bool installCompactSampler(const char* stagedPath, uint16_t slot);
bool deleteCompactSampler(uint8_t slot);
void compactSamplerPath(uint8_t slot, char* path, size_t capacity);
void handleCompactSamplerRequest(uint16_t transaction, const uint8_t* payload, size_t length);
