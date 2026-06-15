#pragma once

#include "../FirmwareModule.h"

void createSynthPresetMenuItems();
void rebuildSynthPresetMenuItems();
void requestSynthPresetMenuRebuild();
void serviceSynthPresetMenuRebuild();
void synthPresetFolderLabel(const char* folderPath, char* output, size_t outputLength);
