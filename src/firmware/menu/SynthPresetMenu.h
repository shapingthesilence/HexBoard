#pragma once

#include "../FirmwareModule.h"

void createSynthPresetMenuItems();
void rebuildSynthPresetMenuItems();
void requestSynthPresetMenuRebuild();
void serviceSynthPresetMenuRebuild();
void openMainSynthPresetLoadMenu();
void openSynthPresetLoadMenu();
void openSynthPresetSaveMenu();
void synthPresetFolderLabel(const char* folderPath, char* output, size_t outputLength);
