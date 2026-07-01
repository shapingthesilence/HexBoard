#pragma once

#include "../FirmwareModule.h"
#include "PersistentDataModels.h"

void setupFileSystem();
void applyFactoryDefaultsToSettings();
bool load_settings();
void save_settings();
void restore_default_settings();
void markSettingsDirty();
void checkAndAutoSave();
void copyCurrentSettingsToProfile(uint8_t profileIndex);
void saveProfileToSlot(uint8_t profileIndex);
void setActiveProfile(uint8_t profileIndex);

extern bool settingsDirty;
extern bool fileSystemExists;
extern bool autoSave;
extern const uint8_t factoryDefaults[NUM_SETTINGS];
