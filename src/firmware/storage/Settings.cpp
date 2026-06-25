#include "../FirmwareModule.h"
#include "../app/DiagnosticsTiming.h"
#include "../app/PlatformCommon.h"
#include "../app/RuntimeDefaults.h"
#include "../hardware/LedRender.h"
#include "../menu/MenuAndDisplay.h"
#include "../menu/PlayedNotesOverlay.h"
#include "../model/ScalePalettePreset.h"
#include "../sequencer/SequencerLightSettings.h"
#include "../sequencer/SequencerPlaybackSettings.h"
#include "../synth/SynthDefaults.h"
#include "../synth/SynthAudio.h"
#include "Settings.h"
#include "SynthPresetStorage.h"
#include "SynthWavetableStorage.h"

// SETTINGS STEP 2 - Define factory defaults (in the same order as the enum).
// Adjust values below to match your desired defaults.
extern const uint8_t factoryDefaults[NUM_SETTINGS] = {
  /* Invert rotary encoder        */ 0,
  /* Auto save settings           */ 1,
  /* MPE pitch bend semitones     */ 48,
  /* MPE Mode                     */ MPE_MODE_AUTO,
  /* Extra MPE Messages           */ 0,
  /* MPE Lowest Channel           */ 2,
  /* MPE Highest Channel          */ 16,
  /* MPE Low Priority Mode        */ 0,
  /* Default MIDI Channel         */ 1,
  /* CC74 value                   */ 0,
  /* CurrentTuning                */ TUNING_12EDO,
  /* CurrentLayout                */ 0,
  /* CurrentScale                 */ 0,
  /* CurrentKeyStepsFromA         */ 119,   // -9 + 128
  /* CurrentTransposeSteps        */ 128,   // 0 + 128
  /* LayoutRotation               */ 0,
  /* MirrorLeftRight              */ 0,
  /* MirrorUpDown                 */ 0,
  /* ScaleLock                    */ 0,
  /* PaletteCenterOnKey           */ 1,
  /* WheelAltMode                 */ 0,
  /* PBSticky                     */ 0,
  /* ModSticky                    */ 0,
  /* PBWheelSpeed (2^N)           */ 10,    // 2^10 == 1024
  /* ModWheelSpeed                */ 8,
  /* VelWheelSpeed                */ 8,
  /* PlaybackMode                 */ SYNTH_POLY,
  /* Waveform                     */ WAVEFORM_BASIC_WAVETABLE,
  /* AudioDestination             */ 0,
  /* ArpeggiatorDivision          */ 32,
  /* SynthBPM                     */ 120,
  /* ColorMode                    */ RAINBOW_MODE,
  /* Rest LED Brightness          */ 255,
  /* Dim LED Brightness           */ 255,
  /* GlobalBrightness             */ BRIGHT_DIM,
  /* AnimationType                */ ANIMATE_BUTTON,
  /* ProgramChange                */ 0,
  /* JustIntonationBPMSync        */ 0,
  /* BeatBPM                      */ 60,
  /* BPMMultiplier                */ 1,
  /* DynamicJI                    */ 0,
  /* EnvelopeAttackIndex          */ 2,
  /* EnvelopeDecayIndex           */ 4,
  /* EnvelopeSustainLevel         */ 127,
  /* EnvelopeReleaseIndex         */ 4,
  /* Display played note mode     */ NOTE_DISPLAY_LABEL,
  /* LED current limit mode       */ LED_CURRENT_LIMIT_1500MA,
  /* SynthDrive                   */ SYNTH_DRIVE_OFF,
  /* SynthModTarget               */ SYNTH_MOD_TARGET_FOLD_WARP,
  /* SynthVibratoSpeed            */ SYNTH_VIBRATO_SPEED_DEFAULT,
  /* MetronomeMode                */ METRONOME_MODE_OFF,
  /* MetronomeSignature           */ 0,
  /* EffectEnvelopeAttackIndex    */ 0,
  /* EffectEnvelopeDecayIndex     */ 0,
  /* EffectEnvelopeSustainLevel   */ 0,
  /* EffectEnvelopeReleaseIndex   */ 0,
  /* BootAnimationEnabled         */ 1,
  /* EffectEnvelopeTarget         */ SYNTH_MOD_TARGET_VIBRATO,
  /* EffectEnvelopeAmount         */ SYNTH_FX_AMOUNT_FULL,
  /* EffectEnvelope2Target        */ SYNTH_MOD_TARGET_PITCH,
  /* EffectEnvelope2Amount        */ SYNTH_FX_AMOUNT_FULL,
  /* EffectEnvelope2AttackIndex   */ 0,
  /* EffectEnvelope2DecayIndex    */ 0,
  /* EffectEnvelope2SustainLevel  */ 0,
  /* EffectEnvelope2ReleaseIndex  */ 0,
  /* SynthAttackEffect deprecated */ 0,
  /* EnvelopeHoldIndex            */ 0,
  /* EffectEnvelopeHoldIndex      */ 0,
  /* EffectEnvelope2HoldIndex     */ 0,
  /* SynthModAmount               */ SYNTH_MOD_AMOUNT_FULL,
  /* HeadphoneVolumeCap           */ HEADPHONE_VOLUME_CAP_FULL,
  /* DeviceRotation               */ DEVICE_ROTATION_PORTRAIT,
  /* SynthPortamentoTimeIndex     */ 0,
  /* ArpeggiatorDirection         */ ARP_DIRECTION_UP,
  /* SynthWavetablePosition       */ SYNTH_WAVETABLE_POSITION_DEFAULT,
  /* SynthLfoTarget               */ SYNTH_MOD_TARGET_FOLD_WARP,
  /* SynthLfoAmount               */ SYNTH_FX_AMOUNT_OFF,
  /* SynthLfoWave                 */ SYNTH_LFO_WAVE_SINE,
  /* SynthLfoSpeed                */ SYNTH_LFO_SPEED_DEFAULT,
  /* DynamicJIRatioTable          */ DYNAMIC_JI_RATIO_TABLE_41_LIMIT,
  /* SequencerStepAccentEvery     */ sequencer::kStepAccentEveryDefault,
  /* SequencerStepColorMode       */ sequencer::kStepColorDefault,
  /* SequencerStepHue             */ sequencer::kStepHueDefault,
  /* SequencerMonophonicMode      */ sequencer::kMonophonicModeDefault,
  /* SequencerTapPreview          */ sequencer::kTapPreviewDefault,
  /* SequencerClockSource         */ sequencer::kClockSourceDefault,
};

// ==================================================
// File System Handling: LittleFS Setup
// ==================================================
bool fileSystemExists = false;

void setupFileSystem() {
  LittleFSConfig cfg;
  cfg.setAutoFormat(true);  // Format automatically if LittleFS cannot be mounted.
  LittleFS.setConfig(cfg);
  fileSystemExists = LittleFS.begin();
  if (!fileSystemExists) {
    // Mount failed (first boot or corrupted FS). USB enumeration guard in
    // setup() already waited up to 2 s, so only a short extra margin here.
    sendToLog("LittleFS mount failed. Formatting after USB settles...");
    delay(500);
    if (LittleFS.format()) {
      sendToLog("LittleFS format succeeded. Mounting...");
      fileSystemExists = LittleFS.begin();
      if (!fileSystemExists) {
        sendToLog("Error: mount failed after format.");
      } else {
        sendToLog("LittleFS mounted successfully after format.");
      }
    } else {
      sendToLog("Error: LittleFS format failed.");
    }
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
    if (Hardware_Version == HARDWARE_V1_2) {
      settingsProfiles[profile][static_cast<uint8_t>(SettingKey::RotaryInvert)] = 1;
    }
  }
  activeProfileIndex = defaultProfileIndex;
  settings = settingsProfiles[activeProfileIndex];
  selectFallbackSynthWavetable();
  applyDefaultSynthWavetableProfileReferences();
  settingsDirty = false;
}

bool migrateSettingsFromVersion(File& f, const SettingsHeader& header, uint8_t settingsPerProfile) {
  size_t previousDataSize = static_cast<size_t>(PROFILE_COUNT) * settingsPerProfile;
  std::array<uint8_t, static_cast<size_t>(PROFILE_COUNT) * NUM_SETTINGS_V17> previousProfiles = { 0 };
  if (previousDataSize > previousProfiles.size()) {
    sendToLog("Warning: Settings migration source is too large. Restoring defaults.");
    f.close();
    applyFactoryDefaultsToSettings();
    save_settings();
    return false;
  }

  size_t bytesRead = f.read(previousProfiles.data(), previousDataSize);
  f.close();
  if (bytesRead != previousDataSize) {
    sendToLog("Warning: Previous settings data incomplete. Restoring defaults.");
    applyFactoryDefaultsToSettings();
    save_settings();
    return false;
  }

  uint32_t computed = crc32(previousProfiles.data(), previousDataSize);
  if (computed != header.crc32) {
    sendToLog("Previous settings CRC32 mismatch (stored=" + std::to_string(header.crc32) + ", computed=" + std::to_string(computed) + "). Restoring defaults.");
    applyFactoryDefaultsToSettings();
    save_settings();
    return false;
  }

  applyFactoryDefaultsToSettings();
  for (uint8_t profile = 0; profile < PROFILE_COUNT; ++profile) {
    uint8_t settingsToCopy = settingsPerProfile;
    if (settingsToCopy > NUM_SETTINGS) {
      settingsToCopy = NUM_SETTINGS;
    }
    memcpy(settingsProfiles[profile],
           previousProfiles.data() + (static_cast<size_t>(profile) * settingsPerProfile),
           settingsToCopy);
    if (header.version < 10) {
      remapLegacyEnvelopeTimeSettings(settingsProfiles[profile], settingsPerProfile);
    }
    if (header.version < 11) {
      remapLegacySynthVibratoSpeedSetting(settingsProfiles[profile], settingsPerProfile);
    }
    if (header.version < 14) {
      remapLegacyDeviceRotationSetting(settingsProfiles[profile], settingsPerProfile);
    }
    if (header.version < 8) {
      uint8_t wheelTarget = settingsProfiles[profile][static_cast<uint8_t>(SettingKey::SynthModTarget)];
      if (wheelTarget > SYNTH_MOD_TARGET_VIBRATO) {
        wheelTarget = SYNTH_MOD_TARGET_FOLD_WARP;
      }
      settingsProfiles[profile][static_cast<uint8_t>(SettingKey::EffectEnvelopeTarget)] =
        (wheelTarget == SYNTH_MOD_TARGET_VIBRATO) ? SYNTH_MOD_TARGET_FOLD_WARP : SYNTH_MOD_TARGET_VIBRATO;
    }
    if (settingsPerProfile > static_cast<uint8_t>(SettingKey::PlaybackMode)) {
      settingsProfiles[profile][static_cast<uint8_t>(SettingKey::PlaybackMode)] =
        normalizeSynthPlaybackMode(settingsProfiles[profile][static_cast<uint8_t>(SettingKey::PlaybackMode)]);
    }
  }
  activeProfileIndex = defaultProfileIndex;
  settings = settingsProfiles[activeProfileIndex];
  settingsDirty = false;
  sendToLog("Settings migrated from version " + std::to_string(header.version) + " to version " + std::to_string(CURRENT_SETTINGS_VERSION) + ".");
  save_settings();
  return true;
}

bool load_settings() {
  settingsFileMissingOnBoot = false;
  if (!fileSystemExists) {
    sendToLog("File system not available. Using factory defaults.");
    applyFactoryDefaultsToSettings();
    return false;
  }
  File f = LittleFS.open("/settings.dat", "r");
  if (!f) {
    settingsFileMissingOnBoot = true;
    sendToLog("Settings file not found. Creating new file with factory defaults.");
    applyFactoryDefaultsToSettings();
    save_settings();
    return true;
  }
  SettingsHeader header;
  if (f.readBytes((char*)&header, sizeof(SettingsHeader)) != sizeof(SettingsHeader)) {
    sendToLog("Error: Failed to read settings header.");
    f.close();
    applyFactoryDefaultsToSettings();
    save_settings();
    return false;
  }
  if (strncmp(header.magic, "STG", 3) != 0) {
    sendToLog("Invalid settings file (magic mismatch). Restoring defaults.");
    f.close();
    applyFactoryDefaultsToSettings();
    save_settings();
    return false;
  }
  if (header.version != CURRENT_SETTINGS_VERSION) {
    if (header.version == 20) {
      sendToLog("Settings version mismatch. Migrating version 20 settings to version "
                + std::to_string(CURRENT_SETTINGS_VERSION) + ".");
      return migrateSettingsFromVersion(f, header, NUM_SETTINGS_V20);
    }
    sendToLog("Settings version mismatch. File version: " + std::to_string(header.version)
              + "; Expected version: " + std::to_string(CURRENT_SETTINGS_VERSION)
              + ". Restoring factory defaults for this release.");
    f.close();
    applyFactoryDefaultsToSettings();
    save_settings();
    return false;
  }
  // Always boot from profile 1 even if an older file recorded a different default.
  defaultProfileIndex = DEFAULT_PROFILE_INDEX;
  size_t bytesRead = f.read(reinterpret_cast<uint8_t*>(settingsProfiles), SETTINGS_DATA_SIZE);
  f.close();
  if (bytesRead != SETTINGS_DATA_SIZE) {
    sendToLog("Warning: Settings data incomplete. Restoring defaults.");
    applyFactoryDefaultsToSettings();
    save_settings();
    return false;
  }
  // Verify CRC32 integrity of loaded profile data
  uint32_t computed = crc32(reinterpret_cast<uint8_t*>(settingsProfiles), SETTINGS_DATA_SIZE);
  if (computed != header.crc32) {
    sendToLog("CRC32 mismatch (stored=" + std::to_string(header.crc32) + ", computed=" + std::to_string(computed) + "). Restoring defaults.");
    applyFactoryDefaultsToSettings();
    save_settings();
    return false;
  }
  activeProfileIndex = defaultProfileIndex;
  settings = settingsProfiles[activeProfileIndex];
  settingsDirty = false;
  sendToLog("Settings loaded successfully.");
  return true;
}

void save_settings() {
  if (!fileSystemExists) {
    sendToLog("File system not available.");
    return;
  }
  rememberCurrentSynthWavetableReferenceForProfile(activeProfileIndex);
  File f = LittleFS.open("/settings.dat", "w");
  if (!f) {
    sendToLog("Error: Unable to open /settings.dat for writing.");
    return;
  }
  SettingsHeader header;
  header.magic[0] = 'S'; header.magic[1] = 'T'; header.magic[2] = 'G';
  header.version = CURRENT_SETTINGS_VERSION;
  header.defaultProfileIndex = defaultProfileIndex;
  header.crc32 = crc32(reinterpret_cast<uint8_t*>(settingsProfiles), SETTINGS_DATA_SIZE);
  f.write(reinterpret_cast<uint8_t*>(&header), sizeof(SettingsHeader));
  f.write(reinterpret_cast<uint8_t*>(settingsProfiles), SETTINGS_DATA_SIZE);
  f.close();
  saveCurrentSynthWavetableReference();
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
  settingsDirty = false;
}

void copyCurrentSettingsToProfile(uint8_t profileIndex) {
  if (profileIndex >= PROFILE_COUNT) {
    return;
  }
  // When profileIndex matches the active profile we are already editing its backing array.
  if (profileIndex != activeProfileIndex) {
    memcpy(settingsProfiles[profileIndex], settings, NUM_SETTINGS);
  }
  rememberCurrentSynthWavetableReferenceForProfile(profileIndex);
}

void saveProfileToSlot(uint8_t profileIndex) {
  if (profileIndex >= PROFILE_COUNT) {
    return;
  }
  copyCurrentSettingsToProfile(profileIndex);
  flashSafeSave();
  if (profileIndex == activeProfileIndex) {
    settingsDirty = false;
  }
  sendToLog("Saved profile " + std::to_string(profileIndex + 1));
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
  restoreSynthWavetableReferenceForProfile(activeProfileIndex);
  syncSettingsToRuntime();
  sendToLog("Loaded profile " + std::to_string(profileIndex + 1));
}
