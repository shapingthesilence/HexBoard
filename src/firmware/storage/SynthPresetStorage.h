#pragma once

#include "../FirmwareModule.h"
#include "PersistentDataModels.h"

void load_synth_presets();
void save_synth_presets();
bool loadCurrentSynthPresetReference();
void saveCurrentSynthPresetReference();
void flashSafeWrite(void (*writeOperation)());
void beginFlashSafeWrite();
void endFlashSafeWrite();
void flashSafeSave();
void flashSafeSaveCurrentSynthReferences();
void flashSafeSaveSynthPresets();
void saveSynthPresetToSlot(uint16_t presetIndex);
void saveSynthPresetAsNew(const char* folderPath);
bool writeSynthPresetToCatalogSlot(uint16_t presetIndex, const SynthPresetSlot& preset);
void loadSynthPresetFromSlot(uint16_t presetIndex);
void loadBlankSynthPreset();
bool readSynthPresetFromCatalog(uint16_t presetIndex, SynthPresetSlot& preset);
const char* currentSynthPresetDisplayName();
bool currentSynthPresetRuntimeModified();
bool currentSynthPresetCatalogIndex(uint16_t& presetIndex);
void captureCurrentSynthPreset(SynthPresetSlot& preset);
SynthPresetSlot buildCurrentSynthPresetObject();
void applySynthPresetToSettings(const SynthPresetSlot& preset);
void normalizeSynthPresetFolderPath(char* folderPath, size_t folderPathLength);
void normalizeSynthPresetValues(SynthPresetSlot& preset);
void normalizeSynthPresetMetadata(SynthPresetSlot& preset, uint8_t fallbackIndex);
void copySynthPresetMetadata(SynthPresetIndexEntry& metadata, const SynthPresetSlot& preset);
void compactSynthPresets();
