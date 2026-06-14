#pragma once

#include "../FirmwareModule.h"

enum class SettingKey : uint8_t;
struct SettingsHeader;
struct SynthPresetSlot;
struct SynthPresetSlotV7;
struct SynthPresetSlotV6;
struct LegacySynthPresetSlot;
struct SynthWavetableSlot;
struct GeometryObjectSlot;

extern uint8_t* settings;
extern uint8_t activeProfileIndex;
extern uint8_t defaultProfileIndex;
extern std::vector<SynthPresetSlot> synthPresets;
extern std::vector<SynthWavetableSlot> synthWavetables;
extern std::vector<GeometryObjectSlot> geometryObjects;

uint32_t crc32(const uint8_t* data, size_t length);
