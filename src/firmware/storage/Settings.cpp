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
  /* PBWheelSpeed (2^N)           */ 9,     // 2^9 == 512
  /* ModWheelSpeed                */ 4,
  /* VelWheelSpeed                */ 4,
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
  /* DeviceRotation               */ DEVICE_ROTATION_0,
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
  /* SequencerSendClock           */ sequencer::kSendClockDefault,
  /* SequencerSendTransport       */ sequencer::kSendTransportDefault,
  /* PiezoVolumeCap               */ HEADPHONE_VOLUME_CAP_FULL,
};

// ==================================================
// File System Handling: LittleFS Setup
// ==================================================
bool fileSystemExists = false;
constexpr char SETTINGS_FILE_PATH[] = "/settings.dat";

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
  memset(synthWavetableProfileReferences, 0, sizeof(synthWavetableProfileReferences));
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
  size_t settingsBytesRead =
    f.read(reinterpret_cast<uint8_t*>(settingsProfiles), SETTINGS_VALUES_DATA_SIZE);
  size_t geometryBytesRead =
    f.read(reinterpret_cast<uint8_t*>(geometryProfileReferences),
           SETTINGS_GEOMETRY_DATA_SIZE);
  size_t wavetableBytesRead =
    f.read(reinterpret_cast<uint8_t*>(synthWavetableProfileReferences),
           SETTINGS_WAVETABLE_DATA_SIZE);
  f.close();
  if (settingsBytesRead != SETTINGS_VALUES_DATA_SIZE
      || geometryBytesRead != SETTINGS_GEOMETRY_DATA_SIZE
      || wavetableBytesRead != SETTINGS_WAVETABLE_DATA_SIZE) {
    reportStorageHealthIssue("/settings.dat", "short payload");
    sendToLog("/settings.dat: short payload read; using factory defaults.");
    applyFactoryDefaultsToSettings();
    return false;
  }
  uint32_t computed = crc32Begin();
  computed = crc32Update(computed,
                         reinterpret_cast<uint8_t*>(settingsProfiles),
                         SETTINGS_VALUES_DATA_SIZE);
  computed = crc32Update(computed,
                         reinterpret_cast<uint8_t*>(geometryProfileReferences),
                         SETTINGS_GEOMETRY_DATA_SIZE);
  computed = crc32Update(computed,
                         reinterpret_cast<uint8_t*>(synthWavetableProfileReferences),
                         SETTINGS_WAVETABLE_DATA_SIZE);
  computed = crc32Finish(computed);
  if (computed != header.crc32) {
    reportStorageHealthIssue("/settings.dat", "CRC mismatch");
    sendToLog("/settings.dat: CRC mismatch; using factory defaults.");
    applyFactoryDefaultsToSettings();
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
    sendToLog("LittleFS: unavailable while saving /settings.dat.");
    return;
  }
  rememberCurrentSynthWavetableReferenceForProfile(activeProfileIndex);
  rememberCurrentGeometryReferenceForProfile(activeProfileIndex);
  SettingsHeader header = {};
  header.magic[0] = 'S'; header.magic[1] = 'T'; header.magic[2] = 'G';
  header.version = CURRENT_SETTINGS_VERSION;
  header.defaultProfileIndex = defaultProfileIndex;
  uint32_t settingsCrc = crc32Begin();
  settingsCrc = crc32Update(settingsCrc,
                            reinterpret_cast<uint8_t*>(settingsProfiles),
                            SETTINGS_VALUES_DATA_SIZE);
  settingsCrc = crc32Update(settingsCrc,
                            reinterpret_cast<uint8_t*>(geometryProfileReferences),
                            SETTINGS_GEOMETRY_DATA_SIZE);
  settingsCrc = crc32Update(settingsCrc,
                            reinterpret_cast<uint8_t*>(synthWavetableProfileReferences),
                            SETTINGS_WAVETABLE_DATA_SIZE);
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
      saveCurrentSynthPresetReference();
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
    && f.write(reinterpret_cast<uint8_t*>(settingsProfiles), SETTINGS_VALUES_DATA_SIZE)
      == SETTINGS_VALUES_DATA_SIZE
    && f.write(reinterpret_cast<uint8_t*>(geometryProfileReferences),
               SETTINGS_GEOMETRY_DATA_SIZE) == SETTINGS_GEOMETRY_DATA_SIZE
    && f.write(reinterpret_cast<uint8_t*>(synthWavetableProfileReferences),
               SETTINGS_WAVETABLE_DATA_SIZE) == SETTINGS_WAVETABLE_DATA_SIZE;
  f.close();
  if (!written) {
    sendToLog("Error: Incomplete /settings.dat write.");
    return;
  }
  saveCurrentSynthPresetReference();
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
  rememberCurrentGeometryReferenceForProfile(profileIndex);
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
