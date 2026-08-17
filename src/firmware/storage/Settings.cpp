#include "../FirmwareModule.h"
#include "../app/DiagnosticsTiming.h"
#include "../app/PlatformCommon.h"
#include "../app/RuntimeDefaults.h"
#include "../hardware/GridState.h"
#include "../hardware/LedRender.h"
#include "../menu/MenuAndDisplay.h"
#include "../menu/PlayedNotesOverlay.h"
#include "../model/ScalePalettePreset.h"
#include "../sequencer/SequencerLightSettings.h"
#include "../sequencer/SequencerPlaybackSettings.h"
#include "../synth/SynthDefaults.h"
#include "../synth/SynthAudio.h"
#include "Settings.h"
#include "PresetSync.h"
#include "StorageHealth.h"
#include "SynthPresetStorage.h"
#include "SynthWavetableStorage.h"

extern const uint8_t factoryDefaults[NUM_SETTINGS] = {
#define HEXBOARD_SETTING(name, defaultValue) static_cast<uint8_t>(defaultValue),
#include "SettingKeys.inc.h"
#undef HEXBOARD_SETTING
};

// ==================================================
// File System Handling: LittleFS Setup
// ==================================================
bool fileSystemExists = false;
bool lastSettingsSaveSucceeded = false;
constexpr char SETTINGS_FILE_PATH[] = "/settings.dat";

namespace {
bool isSynthProfileSetting(SettingKey key) {
  for (SettingKey synthKey : synthPresetKeys) {
    if (synthKey == key) {
      return true;
    }
  }
  return false;
}

void packPersistedProfileSettings(uint8_t* output) {
  size_t cursor = 0;
  for (uint8_t profile = 0; profile < PROFILE_COUNT; ++profile) {
    for (uint8_t keyIndex = 0; keyIndex < NUM_SETTINGS; ++keyIndex) {
      SettingKey key = static_cast<SettingKey>(keyIndex);
      if (!isSynthProfileSetting(key)) {
        output[cursor++] = settingsProfiles[profile][keyIndex];
      }
    }
  }
}

void unpackPersistedProfileSettings(const uint8_t* input) {
  size_t cursor = 0;
  for (uint8_t profile = 0; profile < PROFILE_COUNT; ++profile) {
    for (uint8_t keyIndex = 0; keyIndex < NUM_SETTINGS; ++keyIndex) {
      SettingKey key = static_cast<SettingKey>(keyIndex);
      if (!isSynthProfileSetting(key)) {
        settingsProfiles[profile][keyIndex] = input[cursor++];
      }
    }
  }
}
}  // namespace

int loadCurrentKeyStepsFromSettings() {
  uint16_t encoded = static_cast<uint16_t>(settingValue(SettingKey::CurrentKeyStepsFromA))
                     | (static_cast<uint16_t>(settingValue(SettingKey::CurrentKeyStepsFromAHigh)) << 8);
  return static_cast<int16_t>(encoded);
}

void storeCurrentKeyStepsInSettings(int stepsFromA) {
  uint16_t encoded = static_cast<uint16_t>(static_cast<int16_t>(stepsFromA));
  settings[static_cast<uint8_t>(SettingKey::CurrentKeyStepsFromA)] = encoded & 0xFF;
  settings[static_cast<uint8_t>(SettingKey::CurrentKeyStepsFromAHigh)] = encoded >> 8;
}

void setupFileSystem() {
  LittleFSConfig cfg;
  cfg.setAutoFormat(false);
  LittleFS.setConfig(cfg);
  fileSystemExists = LittleFS.begin();
  if (!fileSystemExists) {
    reportStorageHealthIssue("LittleFS", "mount failed");
    sendToLog("Error: LittleFS mount failed. Using safe defaults with saving disabled.");
  } else {
    sendToLog("LittleFS mounted successfully.");
  }
}

// --------------------------------------------------------
// Persistent Settings Functions: Save, Load, Restore
// --------------------------------------------------------
void applyFactoryDefaultsToSettings() {
  defaultProfileIndex = DEFAULT_PROFILE_INDEX;  // profile 1 is the canonical boot target
  for (uint8_t profile = 0; profile < PROFILE_COUNT; ++profile) {
    memcpy(settingsProfiles[profile], factoryDefaults, NUM_SETTINGS);
  }
  memset(geometryProfileReferences, 0, sizeof(geometryProfileReferences));
  for (SynthProfileReference& reference : synthProfileReferences) {
    reference = SynthProfileReference{};
  }
  activeProfileIndex = defaultProfileIndex;
  settings = settingsProfiles[activeProfileIndex];
  selectFallbackSynthWavetable();
  settingsDirty = false;
}

bool load_settings() {
  settingsFileMissingOnBoot = false;
  if (!fileSystemExists) {
    reportStorageHealthIssue("/settings.dat", "filesystem unavailable");
    sendToLog("LittleFS: unavailable while loading /settings.dat; using factory defaults.");
    applyFactoryDefaultsToSettings();
    return false;
  }
  File f = LittleFS.open(SETTINGS_FILE_PATH, "r");
  if (!f) {
    settingsFileMissingOnBoot = true;
    reportStorageHealthIssue("/settings.dat", "missing");
    sendToLog("/settings.dat: missing or cannot open; using factory defaults.");
    applyFactoryDefaultsToSettings();
    return false;
  }
  if (f.size() != sizeof(SettingsHeader) + SETTINGS_DATA_SIZE) {
    reportStorageHealthIssue("/settings.dat", "wrong size");
    sendToLog("/settings.dat: wrong file size; using factory defaults.");
    f.close();
    applyFactoryDefaultsToSettings();
    return false;
  }
  SettingsHeader header = {};
  if (f.readBytes((char*)&header, sizeof(SettingsHeader)) != sizeof(SettingsHeader)) {
    reportStorageHealthIssue("/settings.dat", "short header");
    sendToLog("/settings.dat: short header read; using factory defaults.");
    f.close();
    applyFactoryDefaultsToSettings();
    return false;
  }
  if (strncmp(header.magic, "STG", 3) != 0) {
    reportStorageHealthIssue("/settings.dat", "magic mismatch");
    sendToLog("/settings.dat: magic mismatch; using factory defaults.");
    f.close();
    applyFactoryDefaultsToSettings();
    return false;
  }
  if (header.version != CURRENT_SETTINGS_VERSION) {
    reportStorageHealthIssue("/settings.dat", "version mismatch");
    sendToLog("/settings.dat: version " + std::to_string(header.version)
              + " does not match " + std::to_string(CURRENT_SETTINGS_VERSION)
              + "; using factory defaults.");
    f.close();
    applyFactoryDefaultsToSettings();
    return false;
  }
  // Profile 1 is the canonical boot target.
  defaultProfileIndex = DEFAULT_PROFILE_INDEX;
  uint8_t persistedProfileSettings[SETTINGS_PROFILE_VALUES_DATA_SIZE] = {};
  size_t settingsBytesRead =
    f.read(persistedProfileSettings, sizeof(persistedProfileSettings));
  size_t geometryBytesRead =
    f.read(reinterpret_cast<uint8_t*>(geometryProfileReferences),
           SETTINGS_GEOMETRY_DATA_SIZE);
  size_t synthReferenceBytesRead =
    f.read(reinterpret_cast<uint8_t*>(synthProfileReferences),
           SETTINGS_SYNTH_REFERENCE_DATA_SIZE);
  f.close();
  if (settingsBytesRead != SETTINGS_PROFILE_VALUES_DATA_SIZE
      || geometryBytesRead != SETTINGS_GEOMETRY_DATA_SIZE
      || synthReferenceBytesRead != SETTINGS_SYNTH_REFERENCE_DATA_SIZE) {
    reportStorageHealthIssue("/settings.dat", "short payload");
    sendToLog("/settings.dat: short payload read; using factory defaults.");
    applyFactoryDefaultsToSettings();
    return false;
  }
  uint32_t computed = crc32Begin();
  computed = crc32Update(computed,
                         persistedProfileSettings,
                         sizeof(persistedProfileSettings));
  computed = crc32Update(computed,
                         reinterpret_cast<uint8_t*>(geometryProfileReferences),
                         SETTINGS_GEOMETRY_DATA_SIZE);
  computed = crc32Update(computed,
                         reinterpret_cast<uint8_t*>(synthProfileReferences),
                         SETTINGS_SYNTH_REFERENCE_DATA_SIZE);
  computed = crc32Finish(computed);
  if (computed != header.crc32) {
    reportStorageHealthIssue("/settings.dat", "CRC mismatch");
    sendToLog("/settings.dat: CRC mismatch; using factory defaults.");
    applyFactoryDefaultsToSettings();
    return false;
  }
  for (uint8_t profile = 0; profile < PROFILE_COUNT; ++profile) {
    memcpy(settingsProfiles[profile], factoryDefaults, NUM_SETTINGS);
  }
  unpackPersistedProfileSettings(persistedProfileSettings);
  activeProfileIndex = defaultProfileIndex;
  settings = settingsProfiles[activeProfileIndex];
  settingsDirty = false;
  sendToLog("Settings loaded successfully.");
  return true;
}

void save_settings() {
  lastSettingsSaveSucceeded = false;
  if (!fileSystemExists) {
    sendToLog("LittleFS: unavailable while saving /settings.dat.");
    return;
  }
  rememberCurrentGeometryReferenceForProfile(activeProfileIndex);
  if (!persistPendingSynthProfileDrafts()) {
    sendToLog("Error: Unable to save pending synth profile draft.");
    return;
  }
  uint8_t persistedProfileSettings[SETTINGS_PROFILE_VALUES_DATA_SIZE] = {};
  packPersistedProfileSettings(persistedProfileSettings);
  SettingsHeader header = {};
  header.magic[0] = 'S'; header.magic[1] = 'T'; header.magic[2] = 'G';
  header.version = CURRENT_SETTINGS_VERSION;
  header.defaultProfileIndex = defaultProfileIndex;
  uint32_t settingsCrc = crc32Begin();
  settingsCrc = crc32Update(settingsCrc,
                            persistedProfileSettings,
                            sizeof(persistedProfileSettings));
  settingsCrc = crc32Update(settingsCrc,
                            reinterpret_cast<uint8_t*>(geometryProfileReferences),
                            SETTINGS_GEOMETRY_DATA_SIZE);
  settingsCrc = crc32Update(settingsCrc,
                            reinterpret_cast<uint8_t*>(synthProfileReferences),
                            SETTINGS_SYNTH_REFERENCE_DATA_SIZE);
  header.crc32 = crc32Finish(settingsCrc);
  File existing = LittleFS.open(SETTINGS_FILE_PATH, "r");
  if (existing && existing.size() == sizeof(SettingsHeader) + SETTINGS_DATA_SIZE) {
    SettingsHeader existingHeader = {};
    bool unchanged =
      existing.read(reinterpret_cast<uint8_t*>(&existingHeader), sizeof(existingHeader))
        == sizeof(existingHeader)
      && memcmp(&existingHeader, &header, sizeof(header)) == 0;
    existing.close();
    if (unchanged) {
      lastSettingsSaveSucceeded = true;
      sendToLog("Settings unchanged; flash write skipped.");
      return;
    }
  } else if (existing) {
    existing.close();
  }

  File f = LittleFS.open(SETTINGS_FILE_PATH, "w");
  if (!f) {
    sendToLog("Error: Unable to open /settings.dat for writing.");
    return;
  }
  bool written =
    f.write(reinterpret_cast<uint8_t*>(&header), sizeof(SettingsHeader))
      == sizeof(SettingsHeader)
    && f.write(persistedProfileSettings, sizeof(persistedProfileSettings))
      == sizeof(persistedProfileSettings)
    && f.write(reinterpret_cast<uint8_t*>(geometryProfileReferences),
               SETTINGS_GEOMETRY_DATA_SIZE) == SETTINGS_GEOMETRY_DATA_SIZE
    && f.write(reinterpret_cast<uint8_t*>(synthProfileReferences),
               SETTINGS_SYNTH_REFERENCE_DATA_SIZE) == SETTINGS_SYNTH_REFERENCE_DATA_SIZE;
  f.close();
  if (!written) {
    sendToLog("Error: Incomplete /settings.dat write.");
    return;
  }
  lastSettingsSaveSucceeded = true;
  sendToLog("Settings saved.");
}

// Restore all settings to the factory defaults.
void restore_default_settings() {
  applyFactoryDefaultsToSettings();
  sendToLog("Default settings restored.");
  flashSafeSave();
}

// --------------------------------------------------------
// Auto-Save Debouncing Implementation
// --------------------------------------------------------
// When a menu item changes a setting, mark the settings as "dirty" and record the time.
// In the main loop, check if a change has occurred and if enough time (debounceDelay)
// has passed before calling save_settings().

bool settingsDirty = false;
unsigned long lastSettingsChangeTime = 0;
constexpr unsigned long debounceDelay = 10000;  // 10 second delay

void markSettingsDirty() {
  settingsDirty = true;
  lastSettingsChangeTime = millis();
}

bool autoSave = settingEnabled(SettingKey::AutoSave);
// Call this in your main loop to autosave if changes have stabilized.
void checkAndAutoSave() {
  if (!autoSave || !settingsDirty) {
    return;
  }
  if (millis() - lastSettingsChangeTime <= debounceDelay) {
    return;
  }
  // Auto-save always snapshots the current settings into profile 1 before writing to disk.
  copyCurrentSettingsToProfile(DEFAULT_PROFILE_INDEX);
  flashSafeSave();
  if (lastSettingsSaveSucceeded) {
    settingsDirty = false;
  } else {
    lastSettingsChangeTime = millis();
  }
}

void copyCurrentSettingsToProfile(uint8_t profileIndex) {
  if (profileIndex >= PROFILE_COUNT) {
    return;
  }
  // When profileIndex matches the active profile we are already editing its backing array.
  if (profileIndex != activeProfileIndex) {
    memcpy(settingsProfiles[profileIndex], settings, NUM_SETTINGS);
  }
  rememberCurrentGeometryReferenceForProfile(profileIndex);
  queueCurrentSynthStateForProfile(profileIndex);
}

void saveProfileToSlot(uint8_t profileIndex) {
  if (profileIndex >= PROFILE_COUNT) {
    return;
  }
  copyCurrentSettingsToProfile(profileIndex);
  flashSafeSave();
  if (lastSettingsSaveSucceeded && profileIndex == activeProfileIndex) {
    settingsDirty = false;
  }
  sendToLog(std::string(lastSettingsSaveSucceeded ? "Saved profile " : "Failed to save profile ")
            + std::to_string(profileIndex + 1));
}

void setActiveProfile(uint8_t profileIndex) {
  if (profileIndex >= PROFILE_COUNT) {
    return;
  }
  if (profileIndex == activeProfileIndex) {
    settingsDirty = false;
    return;
  }
  // Switching profiles swaps the backing array that the runtime reads from.
  activeProfileIndex = profileIndex;
  settings = settingsProfiles[activeProfileIndex];
  settingsDirty = false;
  restoreSynthStateForProfile(activeProfileIndex);
  syncSettingsToRuntime();
  sendToLog("Loaded profile " + std::to_string(profileIndex + 1));
}
