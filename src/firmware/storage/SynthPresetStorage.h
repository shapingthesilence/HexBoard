#pragma once

#include "../FirmwareModule.h"
#include "PersistentDataModels.h"
#include "SynthPresetCatalog.h"

void load_synth_presets();
void flashSafeWrite(void (*writeOperation)());
void beginFlashSafeWrite();
void endFlashSafeWrite();
void flashSafeSave();
void queueCurrentSynthStateForProfile(uint8_t profileIndex);
bool persistPendingSynthProfileDrafts();
bool restoreSynthStateForProfile(uint8_t profileIndex);
void saveSynthPresetToSlot(uint16_t presetIndex);
void saveSynthPresetAsNew(const char* folderPath);
// presetIndex may be SYNTH_PRESET_CATALOG_NEW_HANDLE.
bool writeSynthPresetToCatalogSlot(uint16_t presetIndex, const SynthPresetSlot& preset);
bool deleteSynthPresetFromCatalog(uint16_t presetIndex);
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
void normalizeSynthPresetMetadata(SynthPresetSlot& preset, uint16_t fallbackIndex);
void generateSynthPresetObjectId(SynthPresetSlot& preset, uint16_t fallbackIndex);
// Once per board: gives every installed sampler instrument without a sound one
// in "Instruments" (then "Instruments 2", ...). Writes flash; never at boot.
void addSoundsForInstalledInstruments();
