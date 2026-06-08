#if HEXBOARD_FIRMWARE_UNITY

#include "../FirmwareModule.h"

// --------------------------------------------------------
// Settings File Header Definition
// --------------------------------------------------------
struct SettingsHeader {
  char magic[3];           // e.g., "STG"
  uint8_t version;         // settings file version
  uint8_t defaultProfileIndex;
  uint32_t crc32;          // CRC32 of all profile data bytes
};

constexpr uint8_t CURRENT_SETTINGS_VERSION = 17;
constexpr uint8_t PROFILE_COUNT = 9;
constexpr uint8_t DEFAULT_PROFILE_INDEX = 0;

// CRC32 computation for settings integrity verification
uint32_t crc32(const uint8_t* data, size_t length) {
  uint32_t crc = 0xFFFFFFFF;
  for (size_t i = 0; i < length; i++) {
    crc ^= data[i];
    for (int j = 0; j < 8; j++) {
      crc = (crc >> 1) ^ (0xEDB88320 & -(crc & 1));
    }
  }
  return ~crc;
}

// ==================================================
// Settings Definitions
// ==================================================
// There are 4 steps to make a new setting work properly.
// I will document each SETTINGS STEP as below to make it easy to find.
// SETTINGS STEP 1 - Define each setting by name.
enum class SettingKey : uint8_t {
  Debug,
  RotaryInvert,
  AutoSave,
  MPEpitchBend,
  MPEMode,
  ExtraMPE,
  MPELowestChannel,
  MPEHighestChannel,
  MPELowPriority,
  DefaultMIDIChannel,
  CC74Value,
  CurrentTuning,
  CurrentLayout,
  CurrentScale,
  CurrentKeyStepsFromA,
  CurrentTransposeSteps,
  LayoutRotation,
  MirrorLeftRight,
  MirrorUpDown,
  ScaleLock,
  PaletteCenterOnKey,
  WheelAltMode,
  PBSticky,
  ModSticky,
  PBWheelSpeed,
  ModWheelSpeed,
  VelWheelSpeed,
  PlaybackMode,
  Waveform,
  AudioDestination,
  ArpeggiatorDivision,
  SynthBPM,
  ColorMode,
  RestLedBrightness,
  DimLedBrightness,
  GlobalBrightness,
  AnimationType,
  ProgramChange,
  JustIntonationBPMSync,
  BeatBPM,
  BPMMultiplier,
  DynamicJI,
  EnvelopeAttackIndex,
  EnvelopeDecayIndex,
  EnvelopeSustainLevel,
  EnvelopeReleaseIndex,
  DisplayPlayedNotes,
  LedCurrentLimitMode,
  SynthDrive,
  SynthModTarget,
  SynthVibratoSpeed,
  MetronomeMode,
  MetronomeSignature,
  EffectEnvelopeAttackIndex,
  EffectEnvelopeDecayIndex,
  EffectEnvelopeSustainLevel,
  EffectEnvelopeReleaseIndex,
  BootAnimationEnabled,
  EffectEnvelopeTarget,
  EffectEnvelopeAmount,
  EffectEnvelope2Target,
  EffectEnvelope2Amount,
  EffectEnvelope2AttackIndex,
  EffectEnvelope2DecayIndex,
  EffectEnvelope2SustainLevel,
  EffectEnvelope2ReleaseIndex,
  SynthAttackEffect,       // Deprecated: hidden and ignored by runtime.
  EnvelopeHoldIndex,
  EffectEnvelopeHoldIndex,
  EffectEnvelope2HoldIndex,
  SynthModAmount,
  HeadphoneVolumeCap,
  DeviceRotation,
  SynthPortamentoTimeIndex,
  ArpeggiatorDirection,
  SynthWavetablePosition,
  SynthLfoTarget,
  SynthLfoAmount,
  SynthLfoWave,
  SynthLfoSpeed,
  DynamicJIRatioTable,
  SynthOutputSmoothing,
  // This must remain last – it gives the total number of settings.
  NumSettings
};

// Use a constexpr to get the total number of settings.
constexpr uint8_t NUM_SETTINGS = static_cast<uint8_t>(SettingKey::NumSettings);
constexpr uint8_t NUM_SETTINGS_V2 = static_cast<uint8_t>(SettingKey::LedCurrentLimitMode);
constexpr uint8_t NUM_SETTINGS_V3 = static_cast<uint8_t>(SettingKey::SynthDrive);
constexpr uint8_t NUM_SETTINGS_V4 = static_cast<uint8_t>(SettingKey::SynthModTarget);
constexpr uint8_t NUM_SETTINGS_V5 = static_cast<uint8_t>(SettingKey::MetronomeMode);
constexpr uint8_t NUM_SETTINGS_V6 = static_cast<uint8_t>(SettingKey::EffectEnvelopeAttackIndex);
constexpr uint8_t NUM_SETTINGS_V7 = static_cast<uint8_t>(SettingKey::EffectEnvelopeTarget);
constexpr uint8_t NUM_SETTINGS_V8 = static_cast<uint8_t>(SettingKey::EnvelopeHoldIndex);
constexpr uint8_t NUM_SETTINGS_BEFORE_HEADPHONE_CAP = static_cast<uint8_t>(SettingKey::HeadphoneVolumeCap);
constexpr uint8_t NUM_SETTINGS_V11 = static_cast<uint8_t>(SettingKey::DeviceRotation);
constexpr uint8_t NUM_SETTINGS_V12 = static_cast<uint8_t>(SettingKey::SynthPortamentoTimeIndex);
constexpr uint8_t NUM_SETTINGS_V14 = static_cast<uint8_t>(SettingKey::SynthWavetablePosition);
constexpr uint8_t NUM_SETTINGS_V15 = static_cast<uint8_t>(SettingKey::DynamicJIRatioTable);
constexpr uint8_t NUM_SETTINGS_V16 = static_cast<uint8_t>(SettingKey::SynthOutputSmoothing);
constexpr size_t SETTINGS_DATA_SIZE = static_cast<size_t>(PROFILE_COUNT) * NUM_SETTINGS;

constexpr uint8_t SYNTH_PRESET_LEGACY_NAMED_COUNT = 20;
constexpr uint8_t SYNTH_PRESET_MAX_COUNT = 128;
constexpr uint8_t LEGACY_SYNTH_PRESET_COUNT = 8;
constexpr uint8_t SYNTH_PRESET_FILE_VERSION = 9;
constexpr uint8_t SYNTH_PRESET_SCHEMA_VERSION = 7;
constexpr uint8_t SYNTH_WAVETABLE_FILE_VERSION = 1;
constexpr uint8_t SYNTH_WAVETABLE_SCHEMA_VERSION = 1;
constexpr uint8_t SYNTH_WAVETABLE_MAX_COUNT = 64;
constexpr size_t SYNTH_PRESET_VALUE_COUNT_V6 = 27;
constexpr size_t SYNTH_PRESET_VALUE_COUNT_V7 = 29;
constexpr size_t SYNTH_PRESET_NAME_LENGTH = 32;
constexpr size_t SYNTH_PRESET_FOLDER_LENGTH = 48;
constexpr size_t SYNTH_PRESET_MENU_LABEL_LENGTH = 64;
constexpr size_t SYNTH_PRESET_OBJECT_ID_LENGTH = 16;
constexpr const char* SYNTH_PRESET_ROOT_FOLDER = "/";
constexpr std::array<SettingKey, 34> synthPresetKeys = {
  SettingKey::PlaybackMode,
  SettingKey::Waveform,
  SettingKey::SynthDrive,
  SettingKey::SynthModTarget,
  SettingKey::SynthModAmount,
  SettingKey::SynthVibratoSpeed,
  SettingKey::ArpeggiatorDivision,
  SettingKey::SynthBPM,
  SettingKey::EnvelopeAttackIndex,
  SettingKey::EnvelopeHoldIndex,
  SettingKey::EnvelopeDecayIndex,
  SettingKey::EnvelopeSustainLevel,
  SettingKey::EnvelopeReleaseIndex,
  SettingKey::EffectEnvelopeTarget,
  SettingKey::EffectEnvelopeAmount,
  SettingKey::EffectEnvelopeAttackIndex,
  SettingKey::EffectEnvelopeHoldIndex,
  SettingKey::EffectEnvelopeDecayIndex,
  SettingKey::EffectEnvelopeSustainLevel,
  SettingKey::EffectEnvelopeReleaseIndex,
  SettingKey::EffectEnvelope2Target,
  SettingKey::EffectEnvelope2Amount,
  SettingKey::EffectEnvelope2AttackIndex,
  SettingKey::EffectEnvelope2HoldIndex,
  SettingKey::EffectEnvelope2DecayIndex,
  SettingKey::EffectEnvelope2SustainLevel,
  SettingKey::EffectEnvelope2ReleaseIndex,
  SettingKey::SynthPortamentoTimeIndex,
  SettingKey::ArpeggiatorDirection,
  SettingKey::SynthWavetablePosition,
  SettingKey::SynthLfoTarget,
  SettingKey::SynthLfoAmount,
  SettingKey::SynthLfoWave,
  SettingKey::SynthLfoSpeed
};
constexpr size_t SYNTH_PRESET_VALUE_COUNT = synthPresetKeys.size();
constexpr std::array<uint8_t, 4> legacySynthVibratoSpeedIndexToCurrent = {
  3, 5, 7, 9
};

inline uint8_t remapLegacyEnvelopeTimeIndex(uint8_t legacyIndex) {
  if (legacyIndex >= legacyEnvelopeTimeIndexToCurrent.size()) {
    return legacyEnvelopeTimeIndexToCurrent.back();
  }
  return legacyEnvelopeTimeIndexToCurrent[legacyIndex];
}

inline bool isEnvelopeTimeSettingKey(SettingKey key) {
  switch (key) {
    case SettingKey::EnvelopeAttackIndex:
    case SettingKey::EnvelopeHoldIndex:
    case SettingKey::EnvelopeDecayIndex:
    case SettingKey::EnvelopeReleaseIndex:
    case SettingKey::EffectEnvelopeAttackIndex:
    case SettingKey::EffectEnvelopeHoldIndex:
    case SettingKey::EffectEnvelopeDecayIndex:
    case SettingKey::EffectEnvelopeReleaseIndex:
    case SettingKey::EffectEnvelope2AttackIndex:
    case SettingKey::EffectEnvelope2HoldIndex:
    case SettingKey::EffectEnvelope2DecayIndex:
    case SettingKey::EffectEnvelope2ReleaseIndex:
      return true;
    default:
      return false;
  }
}

void remapLegacyEnvelopeTimeSettings(uint8_t* profileSettings, uint8_t settingsPerProfile) {
  for (uint8_t keyIndex = 0; keyIndex < settingsPerProfile; ++keyIndex) {
    SettingKey key = static_cast<SettingKey>(keyIndex);
    if (isEnvelopeTimeSettingKey(key)) {
      profileSettings[keyIndex] = remapLegacyEnvelopeTimeIndex(profileSettings[keyIndex]);
    }
  }
}

inline uint8_t remapLegacySynthVibratoSpeedIndex(uint8_t legacyIndex) {
  if (legacyIndex >= legacySynthVibratoSpeedIndexToCurrent.size()) {
    return SYNTH_VIBRATO_SPEED_DEFAULT;
  }
  return legacySynthVibratoSpeedIndexToCurrent[legacyIndex];
}

void remapLegacySynthVibratoSpeedSetting(uint8_t* profileSettings, uint8_t settingsPerProfile) {
  uint8_t keyIndex = static_cast<uint8_t>(SettingKey::SynthVibratoSpeed);
  if (keyIndex < settingsPerProfile) {
    profileSettings[keyIndex] = remapLegacySynthVibratoSpeedIndex(profileSettings[keyIndex]);
  }
}

uint8_t remapLegacyDeviceRotationSetting(uint8_t oldDriverRotation) {
  return displayRotationFromDeviceRotation(oldDriverRotation);
}

void remapLegacyDeviceRotationSetting(uint8_t* profileSettings, uint8_t settingsPerProfile) {
  uint8_t keyIndex = static_cast<uint8_t>(SettingKey::DeviceRotation);
  if (keyIndex < settingsPerProfile) {
    profileSettings[keyIndex] = remapLegacyDeviceRotationSetting(profileSettings[keyIndex]);
  }
}

// ==================================================
// Global Settings Array and Factory Defaults
// ==================================================

uint8_t settingsProfiles[PROFILE_COUNT][NUM_SETTINGS] = { { 0 } };
uint8_t* settings = settingsProfiles[DEFAULT_PROFILE_INDEX];
uint8_t activeProfileIndex = DEFAULT_PROFILE_INDEX;
uint8_t defaultProfileIndex = DEFAULT_PROFILE_INDEX;
extern bool settingsDirty;
void syncSettingsToRuntime();

struct SynthPresetFileHeaderBase {
  char magic[3];     // "SYP"
  uint8_t version;
  uint32_t crc32;
};

struct SynthPresetFileHeader {
  SynthPresetFileHeaderBase base;
  uint16_t count;
  uint16_t reserved;
};

struct SynthPresetSlot {
  uint8_t valid = 0;
  uint8_t favorite = 0;
  uint8_t objectId[SYNTH_PRESET_OBJECT_ID_LENGTH] = {};
  char name[SYNTH_PRESET_NAME_LENGTH] = {};
  char folderPath[SYNTH_PRESET_FOLDER_LENGTH] = {};
  char wavetableName[SYNTH_WAVETABLE_NAME_LENGTH] = {};
  char wavetableFolderPath[SYNTH_WAVETABLE_FOLDER_LENGTH] = {};
  uint8_t values[SYNTH_PRESET_VALUE_COUNT] = {};
};

struct SynthPresetSlotV8 {
  uint8_t valid = 0;
  uint8_t favorite = 0;
  uint8_t objectId[SYNTH_PRESET_OBJECT_ID_LENGTH] = {};
  char name[SYNTH_PRESET_NAME_LENGTH] = {};
  char folderPath[SYNTH_PRESET_FOLDER_LENGTH] = {};
  uint8_t values[SYNTH_PRESET_VALUE_COUNT] = {};
};

struct SynthPresetSlotV7 {
  uint8_t valid = 0;
  uint8_t favorite = 0;
  uint8_t objectId[SYNTH_PRESET_OBJECT_ID_LENGTH] = {};
  char name[SYNTH_PRESET_NAME_LENGTH] = {};
  char folderPath[SYNTH_PRESET_FOLDER_LENGTH] = {};
  uint8_t values[SYNTH_PRESET_VALUE_COUNT_V7] = {};
};

struct SynthPresetSlotV6 {
  uint8_t valid = 0;
  uint8_t favorite = 0;
  uint8_t objectId[SYNTH_PRESET_OBJECT_ID_LENGTH] = {};
  char name[SYNTH_PRESET_NAME_LENGTH] = {};
  char folderPath[SYNTH_PRESET_FOLDER_LENGTH] = {};
  uint8_t values[SYNTH_PRESET_VALUE_COUNT_V6] = {};
};

struct LegacySynthPresetSlot {
  uint8_t valid = 0;
  uint8_t values[SYNTH_PRESET_VALUE_COUNT_V6] = {};
};

struct SynthWavetableFileHeader {
  char magic[3];     // "SYW"
  uint8_t version;
  uint16_t count;
  uint16_t reserved;
  uint32_t crc32;
};

struct SynthWavetableSlot {
  uint8_t valid = 0;
  uint8_t objectId[SYNTH_WAVETABLE_OBJECT_ID_LENGTH] = {};
  char name[SYNTH_WAVETABLE_NAME_LENGTH] = {};
  char folderPath[SYNTH_WAVETABLE_FOLDER_LENGTH] = {};
  char samplePath[SYNTH_WAVETABLE_SAMPLE_PATH_LENGTH] = {};
};

struct CurrentSynthWavetableReferenceFile {
  char magic[3];     // "CWT"
  uint8_t version;
  char name[SYNTH_WAVETABLE_NAME_LENGTH] = {};
  char folderPath[SYNTH_WAVETABLE_FOLDER_LENGTH] = {};
  uint32_t crc32;
};

constexpr uint8_t CURRENT_SYNTH_WAVETABLE_REFERENCE_VERSION = 1;
constexpr char CURRENT_SYNTH_WAVETABLE_REFERENCE_FILE_PATH[] = "/current_wavetable.dat";

std::vector<SynthPresetSlot> synthPresets;
std::vector<SynthWavetableSlot> synthWavetables;

void saveCurrentSynthWavetableReference();
bool loadCurrentSynthWavetableReference();
void normalizeSynthWavetableBuiltInFolderAlias(char* folderPath, size_t folderPathLength);
void flashSafeSave();

void remapLegacySynthPresetEnvelopeTimes(SynthPresetSlot& preset) {
  if (!preset.valid) {
    return;
  }
  for (size_t i = 0; i < synthPresetKeys.size(); ++i) {
    if (isEnvelopeTimeSettingKey(synthPresetKeys[i])) {
      preset.values[i] = remapLegacyEnvelopeTimeIndex(preset.values[i]);
    }
  }
}

void remapLegacySynthPresetEnvelopeTimes(LegacySynthPresetSlot& preset) {
  if (!preset.valid) {
    return;
  }
  for (size_t i = 0; i < SYNTH_PRESET_VALUE_COUNT_V6; ++i) {
    if (isEnvelopeTimeSettingKey(synthPresetKeys[i])) {
      preset.values[i] = remapLegacyEnvelopeTimeIndex(preset.values[i]);
    }
  }
}

void remapLegacySynthPresetVibratoSpeed(SynthPresetSlot& preset) {
  if (!preset.valid) {
    return;
  }
  for (size_t i = 0; i < synthPresetKeys.size(); ++i) {
    if (synthPresetKeys[i] == SettingKey::SynthVibratoSpeed) {
      preset.values[i] = remapLegacySynthVibratoSpeedIndex(preset.values[i]);
      return;
    }
  }
}

void remapLegacySynthPresetVibratoSpeed(LegacySynthPresetSlot& preset) {
  if (!preset.valid) {
    return;
  }
  for (size_t i = 0; i < SYNTH_PRESET_VALUE_COUNT_V6; ++i) {
    if (synthPresetKeys[i] == SettingKey::SynthVibratoSpeed) {
      preset.values[i] = remapLegacySynthVibratoSpeedIndex(preset.values[i]);
      return;
    }
  }
}

inline uint8_t settingValue(SettingKey key) {
  return settings[static_cast<uint8_t>(key)];
}

inline bool settingEnabled(SettingKey key) {
  return settingValue(key) != 0;
}

inline int decodeBiasedSetting(SettingKey key) {
  return static_cast<int>(settingValue(key)) - 128;
}
#endif  // HEXBOARD_FIRMWARE_UNITY
