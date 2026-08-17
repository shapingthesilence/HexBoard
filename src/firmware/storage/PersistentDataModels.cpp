#include "../FirmwareModule.h"
#include "PersistentDataModels.h"

// CRC32 computation for settings and catalog integrity verification.
uint32_t crc32Begin() {
  return 0xFFFFFFFFu;
}

uint32_t crc32Update(uint32_t crc, const uint8_t* data, size_t length) {
  for (size_t i = 0; i < length; i++) {
    crc ^= data[i];
    for (int j = 0; j < 8; j++) {
      crc = (crc >> 1) ^ (0xEDB88320 & -(crc & 1));
    }
  }
  return crc;
}

uint32_t crc32Finish(uint32_t crc) {
  return ~crc;
}

uint32_t crc32(const uint8_t* data, size_t length) {
  return crc32Finish(crc32Update(crc32Begin(), data, length));
}

// ==================================================
// Global Settings Array and Factory Defaults
// ==================================================

uint8_t settingsProfiles[PROFILE_COUNT][NUM_SETTINGS] = { { 0 } };
GeometryProfileReference geometryProfileReferences[PROFILE_COUNT] = {};
SynthProfileReference synthProfileReferences[PROFILE_COUNT] = {};
uint8_t* settings = settingsProfiles[DEFAULT_PROFILE_INDEX];
uint8_t activeProfileIndex = DEFAULT_PROFILE_INDEX;
uint8_t defaultProfileIndex = DEFAULT_PROFILE_INDEX;

SynthPresetCatalog synthPresets;
SynthWavetableCatalog synthWavetables;
GeometryBundleCatalog geometryBundles;
uint16_t geometryCatalogObjectCount = 0;
