#pragma once

#include "../FirmwareModule.h"

struct ParsedSynthWavetableObject;

void load_geometry_objects();
void save_geometry_objects();
void flashSafeSaveGeometryObjects();
bool saveParsedSynthWavetable(const ParsedSynthWavetableObject& wavetable);
bool processPresetSyncSysEx(const uint8_t* data, const unsigned int len);
