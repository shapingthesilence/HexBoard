#pragma once

#include "../FirmwareModule.h"

void createSynthPresetMenuItems();
void rebuildSynthPresetMenuItems();
void requestSynthPresetMenuRebuild();
void serviceSynthPresetMenuRebuild();
// Auditions the sound resting under the cursor in the Sounds list.
void serviceSynthPresetMenuAudition();
void openMainSynthPresetLoadMenu();
void openSynthPresetLoadMenu();
void openSynthPresetSaveMenu();
void synthPresetFolderLabel(const char* folderPath, char* output, size_t outputLength);
