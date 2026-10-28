#pragma once
#include <cstddef>
#include <cstdint>

// Control/storage entry points are Core 0 only. Selection replaces the exclusive
// sample workspace after an acknowledged render-block boundary.
bool compactSamplerActive();
uint8_t compactSamplerSlot();
const char* compactSamplerName();
bool selectCompactSampler(uint8_t slot, bool persist = true);
void syncCompactSamplerSelection();
bool compactSamplerFileInfo(uint8_t slot, char* name, size_t capacity, uint32_t& bytes);
bool installCompactSampler(const char* stagedPath, uint16_t slot);
bool deleteCompactSampler(uint8_t slot);
void compactSamplerPath(uint8_t slot, char* path, size_t capacity);
void handleCompactSamplerRequest(uint16_t transaction, const uint8_t* payload, size_t length);
