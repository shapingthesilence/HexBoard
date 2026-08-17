#pragma once

#include "../FirmwareModule.h"
#include "PersistentDataModels.h"

constexpr char SYNTH_PRESET_STORAGE_ROOT[] = "/presets";
constexpr char SYNTH_PRESET_FILE_EXTENSION[] = ".hsp";
constexpr size_t SYNTH_PRESET_STORAGE_PATH_LENGTH = 64;

void load_synth_presets();
void save_synth_presets();
void flashSafeWrite(void (*writeOperation)());
void beginFlashSafeWrite();
void endFlashSafeWrite();
void flashSafeSave();
void flashSafeSaveSynthPresets();
void queueCurrentSynthStateForProfile(uint8_t profileIndex);
bool persistPendingSynthProfileDrafts();
bool restoreSynthStateForProfile(uint8_t profileIndex);
void saveSynthPresetToSlot(uint16_t presetIndex);
void saveSynthPresetAsNew(const char* folderPath);
bool writeSynthPresetToCatalogSlot(uint16_t presetIndex, const SynthPresetSlot& preset);
bool deleteSynthPresetFromCatalog(uint16_t presetIndex);
bool synthPresetStoragePath(const uint8_t* objectId, char* output, size_t outputLength);
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
