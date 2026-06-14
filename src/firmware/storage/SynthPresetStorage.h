#pragma once

#include "../FirmwareModule.h"
#include "PersistentDataModels.h"

void load_synth_presets();
void save_synth_presets();
void flashSafeSaveSynthPresets();
void saveSynthPresetToSlot(uint16_t presetIndex);
void saveSynthPresetAsNew(const char* folderPath);
void loadSynthPresetFromSlot(uint16_t presetIndex);
void loadBlankSynthPreset();
void captureCurrentSynthPreset(SynthPresetSlot& preset);
SynthPresetSlot buildCurrentSynthPresetObject();
void applySynthPresetToSettings(const SynthPresetSlot& preset);
void normalizeSynthPresetValues(SynthPresetSlot& preset);
void normalizeSynthPresetMetadata(SynthPresetSlot& preset, uint8_t fallbackIndex);
void compactSynthPresets();
