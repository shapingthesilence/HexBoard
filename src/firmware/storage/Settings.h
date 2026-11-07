#pragma once

#include "../FirmwareModule.h"
#include "PersistentDataModels.h"

void setupFileSystem();
void applyFactoryDefaultsToSettings();
bool load_settings();
void save_settings();
bool saveCurrentSettingsForStartup();
void restore_default_settings();
void markSettingsDirty();
void checkAndAutoSave();
void copyCurrentSettingsToProfile(uint8_t profileIndex);
void saveProfileToSlot(uint8_t profileIndex);
void setActiveProfile(uint8_t profileIndex);
int loadCurrentKeyStepsFromSettings();
void storeCurrentKeyStepsInSettings(int stepsFromA);

extern bool settingsDirty;
extern bool fileSystemExists;
// Boot profile sampler slot from a version 36 settings file, or 255.
extern uint8_t migratedSamplerSlot;
extern bool autoSave;
extern const uint8_t factoryDefaults[NUM_SETTINGS];

void syncLedSettingsToRuntime();
void storeLedFramePeriodInSettings(int periodMicros);
