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
bool migrateSettingsFromVersion(File& f, const SettingsHeader& header, uint8_t settingsPerProfile);
