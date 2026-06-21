#pragma once

#include "../FirmwareModule.h"
#include "PersistentDataModels.h"

void load_synth_presets();
void save_synth_presets();
void flashSafeWrite(void (*writeOperation)());
void beginFlashSafeWrite();
void endFlashSafeWrite();
void flashSafeSave();
void flashSafeSaveSynthPresets();
void saveSynthPresetToSlot(uint16_t presetIndex);
void saveSynthPresetAsNew(const char* folderPath);
void loadSynthPresetFromSlot(uint16_t presetIndex);
void loadBlankSynthPreset();
const char* currentSynthPresetDisplayName();
bool currentSynthPresetRuntimeModified();
void captureCurrentSynthPreset(SynthPresetSlot& preset);
SynthPresetSlot buildCurrentSynthPresetObject();
void applySynthPresetToSettings(const SynthPresetSlot& preset);
void normalizeSynthPresetFolderPath(char* folderPath, size_t folderPathLength);
void normalizeSynthPresetValues(SynthPresetSlot& preset);
void normalizeSynthPresetMetadata(SynthPresetSlot& preset, uint8_t fallbackIndex);
void compactSynthPresets();
