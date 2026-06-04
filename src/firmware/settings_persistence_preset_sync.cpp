#include "FirmwareModule.h"

#if HEXBOARD_FIRMWARE_UNITY

// @assignment
/*
    This section of the code contains broad
    procedures for assigning musical notes
    and related values to each button
    of the hex grid.
  */
// run this if the layout, key, or transposition changes, but not if color or scale changes
void assignPitches() {
  sendToLog("assignPitch was called:");
  for (auto& bucket : midiNoteToHexIndices) {
    bucket.clear();
  }
  int32_t lowestMidiIndex = std::numeric_limits<int32_t>::max();
  for (byte i = 0; i < LED_COUNT; i++) {
    if (!(h[i].isCmd)) {
      // steps is the distance from C
      // the stepsToMIDI function needs distance from A4
      // it also needs to reflect any transposition, but
      // NOT the key of the scale.
      int32_t relativeSteps = current.pitchRelToA4(h[i].stepsFromC);
      int32_t midiIndex = relativeSteps + 69;
      h[i].midiNoteIndex = midiIndex;
      if (standardMidiMicrotonalActive && midiIndex < lowestMidiIndex) {
        lowestMidiIndex = midiIndex;
      }
    }
  }

  if (standardMidiMicrotonalActive && lowestMidiIndex != std::numeric_limits<int32_t>::max()) {
    int32_t offset = midiChannelOffset(lowestMidiIndex);
    int32_t baseIndex = positiveMod(static_cast<int>(defaultMidiChannel - 1 - offset), 16);
    standardMidiBaseChannel = static_cast<byte>(baseIndex + 1);
  } else {
    standardMidiBaseChannel = defaultMidiChannel;
  }

  for (byte i = 0; i < LED_COUNT; i++) {
    if (!(h[i].isCmd)) {
      int32_t relativeSteps = current.pitchRelToA4(h[i].stepsFromC);
      float N = stepsToMIDI(static_cast<int16_t>(relativeSteps));
      float targetFrequency = MIDItoFreq(N);
      if (standardMidiMicrotonalActive) {
        byte mappedNote = 0;
        byte mappedChannel = 0;
        mapExtendedMidiNote(h[i].midiNoteIndex, standardMidiBaseChannel, mappedNote, mappedChannel);
        h[i].note = mappedNote;
        h[i].bend = 0;
        h[i].frequency = targetFrequency;
        h[i].mappedMidiChannel = mappedChannel;
      } else {
        h[i].mappedMidiChannel = 0;
        if (N < 0 || N >= 128) {
          h[i].note = UNUSED_NOTE;
          h[i].bend = 0;
          h[i].frequency = 0.0;
        } else {
          h[i].note = ((N >= 127) ? 127 : round(N));
          h[i].bend = (ldexp(N - h[i].note, 13) / MPEpitchBendSemis);
          h[i].frequency = targetFrequency;
        }
      }
      h[i].jiRetune = 0;
      h[i].jiFrequencyMultiplier = 1.0f;
      if (h[i].note < 128) {
        midiNoteToHexIndices[h[i].note].push_back(i);
      }
      h[i].externalNoteDepth = 0;
      sendToLog(
        "hex #" + std::to_string(i) + ", " + "steps=" + std::to_string(h[i].stepsFromC) + ", " + "isCmd? " + std::to_string(h[i].isCmd) + ", " + "note=" + std::to_string(h[i].note) + ", " + "bend=" + std::to_string(h[i].bend) + ", " + "freq=" + std::to_string(h[i].frequency) + ", " + "inScale? " + std::to_string(h[i].inScale) + ".");
    }
  }
  sendToLog("assignPitches complete.");
}

void refreshMidiRouting() {
  resetTuningMIDI();
  assignPitches();
}

/*
    Returns true when the hex's pitch class belongs
    to the currently selected scale. Pulling this
    logic into one helper keeps applyScale() easy to
    read for beginners.
  */
bool hexIsInCurrentScale(byte hexIndex) {
  if (current.scale().tuning == ALL_TUNINGS) {
    return true;
  }

  byte degree = current.keyDegree(h[hexIndex].stepsFromC);
  if (degree == 0) {
    return true;  // The root is always in the scale.
  }

  byte accumulatedSteps = 0;
  byte patternIndex = 0;
  while (degree > accumulatedSteps) {
    accumulatedSteps += current.scale().pattern[patternIndex];
    ++patternIndex;
  }
  return accumulatedSteps == degree;
}

void applyScale() {
  sendToLog("applyScale was called:");
  for (byte i = 0; i < LED_COUNT; ++i) {
    if (!h[i].isCmd) {
      h[i].inScale = hexIsInCurrentScale(i);
      sendToLog(
        "hex #" + std::to_string(i) + ", " + "steps=" + std::to_string(h[i].stepsFromC) + ", " + "isCmd? " + std::to_string(h[i].isCmd) + ", " + "note=" + std::to_string(h[i].note) + ", " + "inScale? " + std::to_string(h[i].inScale) + ".");
    }
  }
  setLEDcolorCodes();
  sendToLog("applyScale complete.");
}
void applyLayout() {  // call this function when the layout changes
  sendToLog("buildLayout was called:");
  ///////////////////////////////////////////////////////////////////////////////////////
  int8_t acrossSteps = current.layout().acrossSteps;  // x
  int8_t dnLeftSteps = current.layout().dnLeftSteps;  // y
  if (mirrorUpDown) {
    dnLeftSteps = -(acrossSteps + dnLeftSteps);  // y = -(x + y)
  }
  if (mirrorLeftRight) {
    dnLeftSteps = acrossSteps + dnLeftSteps;  // y = x + y
    acrossSteps = -acrossSteps;               // x = -x
  }
  for (byte rotations = 0; rotations < layoutRotation; rotations++) {
    byte keyOffsetY = dnLeftSteps;
    byte keyOffsetX = acrossSteps;
    dnLeftSteps = keyOffsetX + keyOffsetY;
    keyOffsetY = dnLeftSteps;
    dnLeftSteps = -acrossSteps;
    acrossSteps = keyOffsetY;
  }
  ////////////////////////////////////////////////////////////////////////////////////////
  for (byte i = 0; i < LED_COUNT; i++) {
    if (!(h[i].isCmd)) {
      int8_t distCol = h[i].coordCol - h[current.layout().hexMiddleC].coordCol;
      int8_t distRow = h[i].coordRow - h[current.layout().hexMiddleC].coordRow;
      h[i].stepsFromC = ((distCol * acrossSteps) + (distRow * (acrossSteps + (2 * dnLeftSteps)))) / 2;
      sendToLog(
        "hex #" + std::to_string(i) + ", " + "steps from C4=" + std::to_string(h[i].stepsFromC) + ".");
    }
  }
  applyScale();     // when layout changes, have to re-apply scale and re-apply LEDs
  assignPitches();  // same with pitches
  sendToLog("buildLayout complete.");
}
void RAM_FUNC(cmdOn)(byte x) {  // volume and mod wheel read all current buttons
  switch (h[x].note) {
    case CMDB + 3:
      toggleWheel = !toggleWheel;
      break;
    case HARDWARE_V1_2:
      Hardware_Version = h[x].note;
      setupHardware();
      break;
    default:
      // the rest should all be taken care of within the wheelDef structure
      break;
  }
}
void RAM_FUNC(cmdOff)(byte x) {  // pitch bend wheel only if buttons held.
  switch (h[x].note) {
    default:
      break;  // nothing; should all be taken care of within the wheelDef structure
  }
}

// --------------------------------------------------------
// Settings File Header Definition
// --------------------------------------------------------
struct SettingsHeader {
  char magic[3];           // e.g., "STG"
  uint8_t version;         // settings file version
  uint8_t defaultProfileIndex;
  uint32_t crc32;          // CRC32 of all profile data bytes
};

constexpr uint8_t CURRENT_SETTINGS_VERSION = 15;
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
constexpr size_t SETTINGS_DATA_SIZE = static_cast<size_t>(PROFILE_COUNT) * NUM_SETTINGS;

constexpr uint8_t SYNTH_PRESET_LEGACY_NAMED_COUNT = 20;
constexpr uint8_t SYNTH_PRESET_MAX_COUNT = 128;
constexpr uint8_t LEGACY_SYNTH_PRESET_COUNT = 8;
constexpr uint8_t SYNTH_PRESET_FILE_VERSION = 8;
constexpr uint8_t SYNTH_PRESET_SCHEMA_VERSION = 5;
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

std::vector<SynthPresetSlot> synthPresets;

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

// SETTINGS STEP 2 - Define factory defaults (in the same order as the enum).
// Adjust values below to match your desired defaults.
const uint8_t factoryDefaults[NUM_SETTINGS] = {
  /* Debug                        */ 0,
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
  /* Waveform                     */ WAVEFORM_HYBRID,
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
  /* Display played notes         */ 1,
  /* LED current limit mode       */ LED_CURRENT_LIMIT_1500MA,
  /* SynthDrive                   */ SYNTH_DRIVE_OFF,
  /* SynthModTarget               */ SYNTH_MOD_TARGET_MORPH,
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
  /* SynthLfoTarget               */ SYNTH_MOD_TARGET_MORPH,
  /* SynthLfoAmount               */ SYNTH_FX_AMOUNT_OFF,
  /* SynthLfoWave                 */ SYNTH_LFO_WAVE_SINE,
  /* SynthLfoSpeed                */ SYNTH_LFO_SPEED_DEFAULT,
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
  settingsDirty = false;
}

bool migrateSettingsFromVersion(File& f, const SettingsHeader& header, uint8_t settingsPerProfile) {
  size_t previousDataSize = static_cast<size_t>(PROFILE_COUNT) * settingsPerProfile;
  std::array<uint8_t, SETTINGS_DATA_SIZE> previousProfiles = { 0 };
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
    memcpy(settingsProfiles[profile],
           previousProfiles.data() + (static_cast<size_t>(profile) * settingsPerProfile),
           settingsPerProfile);
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
        wheelTarget = SYNTH_MOD_TARGET_MORPH;
      }
      settingsProfiles[profile][static_cast<uint8_t>(SettingKey::EffectEnvelopeTarget)] =
        (wheelTarget == SYNTH_MOD_TARGET_VIBRATO) ? SYNTH_MOD_TARGET_MORPH : SYNTH_MOD_TARGET_VIBRATO;
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
  switch (header.version) {
    case 2:
      return migrateSettingsFromVersion(f, header, NUM_SETTINGS_V2);
    case 3:
      return migrateSettingsFromVersion(f, header, NUM_SETTINGS_V3);
    case 4:
      return migrateSettingsFromVersion(f, header, NUM_SETTINGS_V4);
    case 5:
      return migrateSettingsFromVersion(f, header, NUM_SETTINGS_V5);
    case 6:
      return migrateSettingsFromVersion(f, header, NUM_SETTINGS_V6);
    case 7:
      return migrateSettingsFromVersion(f, header, NUM_SETTINGS_V7);
    case 8:
      return migrateSettingsFromVersion(f, header, NUM_SETTINGS_V8);
    case 9:
      return migrateSettingsFromVersion(f, header, NUM_SETTINGS_BEFORE_HEADPHONE_CAP);
    case 10:
      return migrateSettingsFromVersion(f, header, NUM_SETTINGS_BEFORE_HEADPHONE_CAP);
    case 11:
      return migrateSettingsFromVersion(f, header, NUM_SETTINGS_V11);
    case 12:
      return migrateSettingsFromVersion(f, header, NUM_SETTINGS_V12);
    case 13:
      return migrateSettingsFromVersion(f, header, NUM_SETTINGS_V14);
    case 14:
      return migrateSettingsFromVersion(f, header, NUM_SETTINGS_V14);
    default:
      break;
  }
  if (header.version != CURRENT_SETTINGS_VERSION) {
    sendToLog("Settings version mismatch. File version: " + std::to_string(header.version) + "; Expected version: " + std::to_string(CURRENT_SETTINGS_VERSION));
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
  sendToLog("Settings saved.");
}

struct UserSynthWavetableFileHeader {
  char magic[3];
  uint8_t version;
  uint16_t frameCount;
  uint16_t sampleCount;
  uint32_t crc32;
};

constexpr uint8_t USER_SYNTH_WAVETABLE_FILE_VERSION = 1;
constexpr char USER_SYNTH_WAVETABLE_FILE_PATH[] = "/user_wavetable.dat";

void applyUploadedSynthWavetableSamples(const uint8_t* samples) {
  synthWaveTableLoadInProgress = true;
  memcpy(&activeSynthWaveTable[0][0], samples, SYNTH_WAVETABLE_SAMPLE_BYTES);
  setActiveSynthWaveFrameCount(SYNTH_WAVETABLE_FRAME_COUNT);
  userSynthWavetableAvailable = true;
  currWave = WAVEFORM_USER_WAVETABLE;
  settings[static_cast<uint8_t>(SettingKey::Waveform)] = WAVEFORM_USER_WAVETABLE;
  loadedSynthWaveform = WAVEFORM_USER_WAVETABLE;
  synthWaveTableLoadInProgress = false;
}

bool loadUserSynthWavetableFromFile() {
  if (!fileSystemExists) {
    return false;
  }
  File f = LittleFS.open(USER_SYNTH_WAVETABLE_FILE_PATH, "r");
  if (!f) {
    return false;
  }
  UserSynthWavetableFileHeader header;
  if (f.readBytes(reinterpret_cast<char*>(&header), sizeof(UserSynthWavetableFileHeader)) != sizeof(UserSynthWavetableFileHeader)) {
    sendToLog("Error: Failed to read user wavetable header.");
    f.close();
    userSynthWavetableAvailable = false;
    return false;
  }
  bool validHeader = strncmp(header.magic, "UWT", 3) == 0
                  && header.version == USER_SYNTH_WAVETABLE_FILE_VERSION
                  && header.frameCount == SYNTH_WAVETABLE_FRAME_COUNT
                  && header.sampleCount == SYNTH_WAVE_SAMPLE_COUNT;
  if (!validHeader) {
    sendToLog("Invalid user wavetable file.");
    f.close();
    userSynthWavetableAvailable = false;
    return false;
  }
  size_t bytesRead = f.read(&activeSynthWaveTable[0][0], SYNTH_WAVETABLE_SAMPLE_BYTES);
  f.close();
  if (bytesRead != SYNTH_WAVETABLE_SAMPLE_BYTES) {
    sendToLog("Warning: User wavetable data incomplete.");
    userSynthWavetableAvailable = false;
    return false;
  }
  uint32_t computed = crc32(&activeSynthWaveTable[0][0], SYNTH_WAVETABLE_SAMPLE_BYTES);
  if (computed != header.crc32) {
    sendToLog("User wavetable CRC32 mismatch.");
    userSynthWavetableAvailable = false;
    return false;
  }
  setActiveSynthWaveFrameCount(SYNTH_WAVETABLE_FRAME_COUNT);
  userSynthWavetableAvailable = true;
  return true;
}

void save_user_wavetable() {
  if (!fileSystemExists) {
    sendToLog("File system not available.");
    return;
  }
  File f = LittleFS.open(USER_SYNTH_WAVETABLE_FILE_PATH, "w");
  if (!f) {
    sendToLog("Error: Unable to open /user_wavetable.dat for writing.");
    return;
  }
  UserSynthWavetableFileHeader header;
  header.magic[0] = 'U'; header.magic[1] = 'W'; header.magic[2] = 'T';
  header.version = USER_SYNTH_WAVETABLE_FILE_VERSION;
  header.frameCount = SYNTH_WAVETABLE_FRAME_COUNT;
  header.sampleCount = SYNTH_WAVE_SAMPLE_COUNT;
  header.crc32 = crc32(&activeSynthWaveTable[0][0], SYNTH_WAVETABLE_SAMPLE_BYTES);
  f.write(reinterpret_cast<uint8_t*>(&header), sizeof(UserSynthWavetableFileHeader));
  f.write(&activeSynthWaveTable[0][0], SYNTH_WAVETABLE_SAMPLE_BYTES);
  f.close();
  sendToLog("User wavetable saved.");
}

void applyDefaultSynthPresets() {
  synthPresets.clear();
  synthPresets.reserve(SYNTH_PRESET_LEGACY_NAMED_COUNT);
}

void generateSynthPresetObjectId(SynthPresetSlot& preset, uint8_t fallbackIndex) {
  uint32_t hash = 2166136261u;
  auto mixByte = [&](uint8_t value) {
    hash ^= value;
    hash *= 16777619u;
  };

  const char* folder = preset.folderPath[0] ? preset.folderPath : SYNTH_PRESET_ROOT_FOLDER;
  const char* name = preset.name[0] ? preset.name : "Slot";
  for (const char* p = "synth:"; *p; ++p) {
    mixByte(static_cast<uint8_t>(*p));
  }
  for (const char* p = folder; *p; ++p) {
    mixByte(static_cast<uint8_t>(*p));
  }
  mixByte(':');
  for (const char* p = name; *p; ++p) {
    mixByte(static_cast<uint8_t>(*p));
  }
  mixByte(':');
  mixByte(fallbackIndex);

  for (size_t i = 0; i < sizeof(preset.objectId); ++i) {
    hash ^= static_cast<uint8_t>(i * 31u + fallbackIndex);
    hash *= 16777619u;
    preset.objectId[i] = static_cast<uint8_t>((hash >> ((i % 4) * 8)) & 0xFF);
  }
}

bool synthPresetObjectIdIsEmpty(const SynthPresetSlot& preset) {
  for (uint8_t byteValue : preset.objectId) {
    if (byteValue != 0) {
      return false;
    }
  }
  return true;
}

void normalizeSynthPresetFolderPath(char* folderPath, size_t folderPathLength) {
  if (folderPathLength == 0) {
    return;
  }
  folderPath[folderPathLength - 1] = '\0';
  if (!folderPath[0]) {
    snprintf(folderPath, folderPathLength, "%s", SYNTH_PRESET_ROOT_FOLDER);
    return;
  }

  char normalized[SYNTH_PRESET_FOLDER_LENGTH] = {};
  size_t outputIndex = 0;
  bool previousWasSlash = false;
  for (size_t i = 0; folderPath[i] != '\0' && outputIndex + 1 < sizeof(normalized); ++i) {
    char value = folderPath[i];
    if (value == '\\') {
      value = '/';
    }
    if (value == '/') {
      if (outputIndex == 0 || previousWasSlash) {
        previousWasSlash = true;
        continue;
      }
      previousWasSlash = true;
    } else {
      previousWasSlash = false;
    }
    normalized[outputIndex++] = value;
  }
  while (outputIndex > 0 && normalized[outputIndex - 1] == '/') {
    normalized[--outputIndex] = '\0';
  }
  if (outputIndex == 0) {
    snprintf(folderPath, folderPathLength, "%s", SYNTH_PRESET_ROOT_FOLDER);
    return;
  }
  snprintf(folderPath, folderPathLength, "%s", normalized);
}

void normalizeSynthPresetMetadata(SynthPresetSlot& preset, uint8_t fallbackIndex) {
  if (!preset.name[0]) {
    snprintf(preset.name, sizeof(preset.name), "Slot %u", static_cast<unsigned>(fallbackIndex + 1));
  }
  if (!preset.folderPath[0]) {
    snprintf(preset.folderPath, sizeof(preset.folderPath), "%s", SYNTH_PRESET_ROOT_FOLDER);
  }
  preset.name[sizeof(preset.name) - 1] = '\0';
  preset.folderPath[sizeof(preset.folderPath) - 1] = '\0';
  normalizeSynthPresetFolderPath(preset.folderPath, sizeof(preset.folderPath));
  if (synthPresetObjectIdIsEmpty(preset)) {
    generateSynthPresetObjectId(preset, fallbackIndex);
  }
}

void normalizeSynthPresetValues(SynthPresetSlot& preset) {
  for (size_t i = 0; i < synthPresetKeys.size(); ++i) {
    if (synthPresetKeys[i] == SettingKey::PlaybackMode) {
      preset.values[i] = normalizeSynthPlaybackMode(preset.values[i]);
      return;
    }
  }
}

void migrateLegacySynthPresetSlot(const LegacySynthPresetSlot& legacyPreset, uint8_t index) {
  if (!legacyPreset.valid || synthPresets.size() >= SYNTH_PRESET_MAX_COUNT) {
    return;
  }
  SynthPresetSlot preset = {};
  preset.valid = legacyPreset.valid;
  snprintf(preset.name, sizeof(preset.name), "Slot %u", static_cast<unsigned>(index + 1));
  snprintf(preset.folderPath, sizeof(preset.folderPath), "%s", SYNTH_PRESET_ROOT_FOLDER);
  for (size_t i = 0; i < synthPresetKeys.size(); ++i) {
    preset.values[i] = factoryDefaults[static_cast<uint8_t>(synthPresetKeys[i])];
  }
  memcpy(preset.values, legacyPreset.values, sizeof(legacyPreset.values));
  normalizeSynthPresetValues(preset);
  normalizeSynthPresetMetadata(preset, index);
  synthPresets.push_back(preset);
}

void migrateSynthPresetSlotV7(const SynthPresetSlotV7& legacyPreset, uint8_t index) {
  if (!legacyPreset.valid || synthPresets.size() >= SYNTH_PRESET_MAX_COUNT) {
    return;
  }
  SynthPresetSlot preset = {};
  preset.valid = legacyPreset.valid;
  preset.favorite = legacyPreset.favorite;
  memcpy(preset.objectId, legacyPreset.objectId, sizeof(preset.objectId));
  memcpy(preset.name, legacyPreset.name, sizeof(preset.name));
  memcpy(preset.folderPath, legacyPreset.folderPath, sizeof(preset.folderPath));
  for (size_t i = 0; i < synthPresetKeys.size(); ++i) {
    preset.values[i] = factoryDefaults[static_cast<uint8_t>(synthPresetKeys[i])];
  }
  memcpy(preset.values, legacyPreset.values, sizeof(legacyPreset.values));
  normalizeSynthPresetValues(preset);
  normalizeSynthPresetMetadata(preset, index);
  synthPresets.push_back(preset);
}

void migrateSynthPresetSlotV6(const SynthPresetSlotV6& legacyPreset, uint8_t index) {
  if (!legacyPreset.valid || synthPresets.size() >= SYNTH_PRESET_MAX_COUNT) {
    return;
  }
  SynthPresetSlot preset = {};
  preset.valid = legacyPreset.valid;
  preset.favorite = legacyPreset.favorite;
  memcpy(preset.objectId, legacyPreset.objectId, sizeof(preset.objectId));
  memcpy(preset.name, legacyPreset.name, sizeof(preset.name));
  memcpy(preset.folderPath, legacyPreset.folderPath, sizeof(preset.folderPath));
  for (size_t i = 0; i < synthPresetKeys.size(); ++i) {
    preset.values[i] = factoryDefaults[static_cast<uint8_t>(synthPresetKeys[i])];
  }
  memcpy(preset.values, legacyPreset.values, sizeof(legacyPreset.values));
  normalizeSynthPresetValues(preset);
  normalizeSynthPresetMetadata(preset, index);
  synthPresets.push_back(preset);
}

uint8_t currentSynthPresetValue(SettingKey key) {
  switch (key) {
    case SettingKey::PlaybackMode: return playbackMode;
    case SettingKey::Waveform: return currWave;
    case SettingKey::SynthDrive: return synthDrive;
    case SettingKey::SynthModTarget: return synthModTarget;
    case SettingKey::SynthModAmount: return synthModAmount;
    case SettingKey::SynthVibratoSpeed: return synthVibratoSpeed;
    case SettingKey::ArpeggiatorDivision: return arpeggiatorDivision;
    case SettingKey::ArpeggiatorDirection: return arpeggiatorDirection;
    case SettingKey::SynthBPM: return synthBPM;
    case SettingKey::SynthPortamentoTimeIndex: return synthPortamentoTimeIndex;
    case SettingKey::SynthWavetablePosition: return synthWavetablePosition;
    case SettingKey::SynthLfoTarget: return synthLfoTarget;
    case SettingKey::SynthLfoAmount: return synthLfoAmount;
    case SettingKey::SynthLfoWave: return synthLfoWave;
    case SettingKey::SynthLfoSpeed: return synthLfoSpeed;
    case SettingKey::EnvelopeAttackIndex: return envelopeAttackIndex;
    case SettingKey::EnvelopeHoldIndex: return envelopeHoldIndex;
    case SettingKey::EnvelopeDecayIndex: return envelopeDecayIndex;
    case SettingKey::EnvelopeSustainLevel: return envelopeSustainLevel;
    case SettingKey::EnvelopeReleaseIndex: return envelopeReleaseIndex;
    case SettingKey::EffectEnvelopeTarget: return effectEnvelopeTarget[0];
    case SettingKey::EffectEnvelopeAmount: return effectEnvelopeAmount[0];
    case SettingKey::EffectEnvelopeAttackIndex: return effectEnvelopeAttackIndex[0];
    case SettingKey::EffectEnvelopeHoldIndex: return effectEnvelopeHoldIndex[0];
    case SettingKey::EffectEnvelopeDecayIndex: return effectEnvelopeDecayIndex[0];
    case SettingKey::EffectEnvelopeSustainLevel: return effectEnvelopeSustainLevel[0];
    case SettingKey::EffectEnvelopeReleaseIndex: return effectEnvelopeReleaseIndex[0];
    case SettingKey::EffectEnvelope2Target: return effectEnvelopeTarget[1];
    case SettingKey::EffectEnvelope2Amount: return effectEnvelopeAmount[1];
    case SettingKey::EffectEnvelope2AttackIndex: return effectEnvelopeAttackIndex[1];
    case SettingKey::EffectEnvelope2HoldIndex: return effectEnvelopeHoldIndex[1];
    case SettingKey::EffectEnvelope2DecayIndex: return effectEnvelopeDecayIndex[1];
    case SettingKey::EffectEnvelope2SustainLevel: return effectEnvelopeSustainLevel[1];
    case SettingKey::EffectEnvelope2ReleaseIndex: return effectEnvelopeReleaseIndex[1];
    default:
      return settingValue(key);
  }
}

void captureCurrentSynthPreset(SynthPresetSlot& preset) {
  preset.valid = 1;
  for (size_t i = 0; i < synthPresetKeys.size(); ++i) {
    preset.values[i] = currentSynthPresetValue(synthPresetKeys[i]);
  }
}

void generateCurrentSynthPresetObjectId(SynthPresetSlot& preset) {
  uint32_t hash = 2166136261u;
  auto mixByte = [&](uint8_t value) {
    hash ^= value;
    hash *= 16777619u;
  };

  for (const char* p = "synth:current:"; *p; ++p) {
    mixByte(static_cast<uint8_t>(*p));
  }
  for (size_t i = 0; i < synthPresetKeys.size(); ++i) {
    mixByte(static_cast<uint8_t>(synthPresetKeys[i]));
    mixByte(preset.values[i]);
  }

  for (size_t i = 0; i < sizeof(preset.objectId); ++i) {
    hash ^= static_cast<uint8_t>(i * 29u);
    hash *= 16777619u;
    preset.objectId[i] = static_cast<uint8_t>((hash >> ((i % 4) * 8)) & 0xFF);
  }
}

SynthPresetSlot buildCurrentSynthPresetObject() {
  SynthPresetSlot preset = {};
  captureCurrentSynthPreset(preset);
  snprintf(preset.name, sizeof(preset.name), "Current Patch");
  snprintf(preset.folderPath, sizeof(preset.folderPath), "%s", SYNTH_PRESET_ROOT_FOLDER);
  generateCurrentSynthPresetObjectId(preset);
  return preset;
}

void applyBlankSynthPresetToSettings() {
  for (SettingKey key : synthPresetKeys) {
    uint8_t keyIndex = static_cast<uint8_t>(key);
    settings[keyIndex] = factoryDefaults[keyIndex];
  }
}

void loadBlankSynthPreset() {
  applyBlankSynthPresetToSettings();
  markSettingsDirty();
  syncSettingsToRuntime();
  sendToLog("Loaded blank synth preset.");
}

void compactSynthPresets() {
  synthPresets.erase(
    std::remove_if(synthPresets.begin(), synthPresets.end(), [](const SynthPresetSlot& preset) {
      return !preset.valid;
    }),
    synthPresets.end()
  );
  if (synthPresets.size() > SYNTH_PRESET_MAX_COUNT) {
    synthPresets.resize(SYNTH_PRESET_MAX_COUNT);
  }
  for (size_t i = 0; i < synthPresets.size(); ++i) {
    normalizeSynthPresetMetadata(synthPresets[i], static_cast<uint8_t>(i));
  }
}

uint32_t synthPresetDataCrc(const SynthPresetSlot* presets, size_t presetCount) {
  return crc32(reinterpret_cast<const uint8_t*>(presets), sizeof(SynthPresetSlot) * presetCount);
}

void save_synth_presets() {
  if (!fileSystemExists) {
    sendToLog("File system not available.");
    return;
  }
  compactSynthPresets();
  File f = LittleFS.open("/synth_presets.dat", "w");
  if (!f) {
    sendToLog("Error: Unable to open /synth_presets.dat for writing.");
    return;
  }
  SynthPresetFileHeader header;
  header.base.magic[0] = 'S'; header.base.magic[1] = 'Y'; header.base.magic[2] = 'P';
  header.base.version = SYNTH_PRESET_FILE_VERSION;
  header.base.crc32 = synthPresetDataCrc(synthPresets.data(), synthPresets.size());
  header.count = static_cast<uint16_t>(synthPresets.size());
  header.reserved = 0;
  f.write(reinterpret_cast<uint8_t*>(&header), sizeof(SynthPresetFileHeader));
  if (!synthPresets.empty()) {
    f.write(reinterpret_cast<uint8_t*>(synthPresets.data()), sizeof(SynthPresetSlot) * synthPresets.size());
  }
  f.close();
  sendToLog("Synth presets saved (" + std::to_string(synthPresets.size()) + ").");
}

void load_synth_presets() {
  applyDefaultSynthPresets();
  if (!fileSystemExists) {
    sendToLog("File system not available. Using empty synth presets.");
    return;
  }
  File f = LittleFS.open("/synth_presets.dat", "r");
  if (!f) {
    sendToLog("Synth preset file not found. Starting with empty preset slots.");
    return;
  }
  SynthPresetFileHeaderBase header;
  if (f.readBytes(reinterpret_cast<char*>(&header), sizeof(SynthPresetFileHeaderBase)) != sizeof(SynthPresetFileHeaderBase)) {
    sendToLog("Error: Failed to read synth preset header.");
    f.close();
    applyDefaultSynthPresets();
    return;
  }
  if (strncmp(header.magic, "SYP", 3) != 0 || header.version == 0 || header.version > SYNTH_PRESET_FILE_VERSION) {
    sendToLog("Invalid synth preset file. Starting with empty preset slots.");
    f.close();
    applyDefaultSynthPresets();
    return;
  }

  if (header.version < 5) {
    size_t presetCountInFile = (header.version < 4) ? LEGACY_SYNTH_PRESET_COUNT : SYNTH_PRESET_LEGACY_NAMED_COUNT;
    std::array<LegacySynthPresetSlot, SYNTH_PRESET_LEGACY_NAMED_COUNT> legacyPresets = {};
    size_t presetDataSize = sizeof(LegacySynthPresetSlot) * presetCountInFile;
    size_t bytesRead = f.read(reinterpret_cast<uint8_t*>(legacyPresets.data()), presetDataSize);
    f.close();
    if (bytesRead != presetDataSize) {
      sendToLog("Warning: Synth preset data incomplete. Starting with empty preset slots.");
      applyDefaultSynthPresets();
      return;
    }
    uint32_t computed = crc32(reinterpret_cast<const uint8_t*>(legacyPresets.data()), presetDataSize);
    if (computed != header.crc32) {
      sendToLog("Synth preset CRC32 mismatch. Starting with empty preset slots.");
      applyDefaultSynthPresets();
      return;
    }
    for (size_t i = 0; i < presetCountInFile; ++i) {
      if (header.version < 2) {
        remapLegacySynthPresetEnvelopeTimes(legacyPresets[i]);
      }
      if (header.version < 3) {
        remapLegacySynthPresetVibratoSpeed(legacyPresets[i]);
      }
      migrateLegacySynthPresetSlot(legacyPresets[i], i);
    }
    sendToLog("Synth presets migrated from version " + std::to_string(header.version) + " to version " + std::to_string(SYNTH_PRESET_FILE_VERSION) + ".");
    save_synth_presets();
    return;
  }

  if (header.version < SYNTH_PRESET_FILE_VERSION) {
    uint16_t presetCountInFile = SYNTH_PRESET_LEGACY_NAMED_COUNT;
    if (header.version >= 6) {
      if (f.read(reinterpret_cast<uint8_t*>(&presetCountInFile), sizeof(presetCountInFile)) != sizeof(presetCountInFile)) {
        sendToLog("Warning: Synth preset count missing. Starting with empty preset slots.");
        f.close();
        applyDefaultSynthPresets();
        return;
      }
      uint16_t reserved = 0;
      if (f.read(reinterpret_cast<uint8_t*>(&reserved), sizeof(reserved)) != sizeof(reserved)) {
        sendToLog("Warning: Synth preset header incomplete. Starting with empty preset slots.");
        f.close();
        applyDefaultSynthPresets();
        return;
      }
    }
    if (presetCountInFile > SYNTH_PRESET_MAX_COUNT) {
      sendToLog("Synth preset file exceeds maximum preset count. Starting with empty preset slots.");
      f.close();
      applyDefaultSynthPresets();
      return;
    }

    if (header.version < 7) {
      std::vector<SynthPresetSlotV6> legacyPresets(presetCountInFile);
      size_t presetDataSize = sizeof(SynthPresetSlotV6) * legacyPresets.size();
      size_t bytesRead = presetDataSize == 0 ? 0 : f.read(reinterpret_cast<uint8_t*>(legacyPresets.data()), presetDataSize);
      f.close();
      if (bytesRead != presetDataSize) {
        sendToLog("Warning: Synth preset data incomplete. Starting with empty preset slots.");
        applyDefaultSynthPresets();
        return;
      }
      uint32_t computed = crc32(reinterpret_cast<const uint8_t*>(legacyPresets.data()), presetDataSize);
      if (computed != header.crc32) {
        sendToLog("Synth preset CRC32 mismatch. Starting with empty preset slots.");
        applyDefaultSynthPresets();
        return;
      }
      for (size_t i = 0; i < legacyPresets.size() && synthPresets.size() < SYNTH_PRESET_MAX_COUNT; ++i) {
        migrateSynthPresetSlotV6(legacyPresets[i], static_cast<uint8_t>(i));
      }
    } else {
      std::vector<SynthPresetSlotV7> legacyPresets(presetCountInFile);
      size_t presetDataSize = sizeof(SynthPresetSlotV7) * legacyPresets.size();
      size_t bytesRead = presetDataSize == 0 ? 0 : f.read(reinterpret_cast<uint8_t*>(legacyPresets.data()), presetDataSize);
      f.close();
      if (bytesRead != presetDataSize) {
        sendToLog("Warning: Synth preset data incomplete. Starting with empty preset slots.");
        applyDefaultSynthPresets();
        return;
      }
      uint32_t computed = crc32(reinterpret_cast<const uint8_t*>(legacyPresets.data()), presetDataSize);
      if (computed != header.crc32) {
        sendToLog("Synth preset CRC32 mismatch. Starting with empty preset slots.");
        applyDefaultSynthPresets();
        return;
      }
      for (size_t i = 0; i < legacyPresets.size() && synthPresets.size() < SYNTH_PRESET_MAX_COUNT; ++i) {
        migrateSynthPresetSlotV7(legacyPresets[i], static_cast<uint8_t>(i));
      }
    }
    sendToLog("Synth presets migrated from version " + std::to_string(header.version) + " to version " + std::to_string(SYNTH_PRESET_FILE_VERSION) + ".");
    save_synth_presets();
    return;
  }

  uint16_t presetCountInFile = SYNTH_PRESET_LEGACY_NAMED_COUNT;
  if (header.version >= 6) {
    if (f.read(reinterpret_cast<uint8_t*>(&presetCountInFile), sizeof(presetCountInFile)) != sizeof(presetCountInFile)) {
      sendToLog("Warning: Synth preset count missing. Starting with empty preset slots.");
      f.close();
      applyDefaultSynthPresets();
      return;
    }
    uint16_t reserved = 0;
    if (f.read(reinterpret_cast<uint8_t*>(&reserved), sizeof(reserved)) != sizeof(reserved)) {
      sendToLog("Warning: Synth preset header incomplete. Starting with empty preset slots.");
      f.close();
      applyDefaultSynthPresets();
      return;
    }
  }
  if (presetCountInFile > SYNTH_PRESET_MAX_COUNT) {
    sendToLog("Synth preset file exceeds maximum preset count. Starting with empty preset slots.");
    f.close();
    applyDefaultSynthPresets();
    return;
  }

  std::vector<SynthPresetSlot> loadedPresets(presetCountInFile);
  size_t presetDataSize = sizeof(SynthPresetSlot) * loadedPresets.size();
  size_t bytesRead = presetDataSize == 0 ? 0 : f.read(reinterpret_cast<uint8_t*>(loadedPresets.data()), presetDataSize);
  f.close();
  if (bytesRead != presetDataSize) {
    sendToLog("Warning: Synth preset data incomplete. Starting with empty preset slots.");
    applyDefaultSynthPresets();
    return;
  }
  uint32_t computed = synthPresetDataCrc(loadedPresets.data(), loadedPresets.size());
  if (computed != header.crc32) {
    sendToLog("Synth preset CRC32 mismatch. Starting with empty preset slots.");
    applyDefaultSynthPresets();
    return;
  }
  synthPresets.clear();
  synthPresets.reserve(std::min<size_t>(loadedPresets.size(), SYNTH_PRESET_MAX_COUNT));
  for (size_t i = 0; i < loadedPresets.size() && synthPresets.size() < SYNTH_PRESET_MAX_COUNT; ++i) {
    if (!loadedPresets[i].valid) {
      continue;
    }
    normalizeSynthPresetValues(loadedPresets[i]);
    normalizeSynthPresetMetadata(loadedPresets[i], static_cast<uint8_t>(synthPresets.size()));
    synthPresets.push_back(loadedPresets[i]);
  }
  if (header.version < SYNTH_PRESET_FILE_VERSION) {
    sendToLog("Synth presets migrated from version " + std::to_string(header.version) + " to version " + std::to_string(SYNTH_PRESET_FILE_VERSION) + ".");
    save_synth_presets();
    return;
  }
  sendToLog("Synth presets loaded successfully (" + std::to_string(synthPresets.size()) + ").");
}

void applySynthPresetToSettings(const SynthPresetSlot& preset) {
  for (size_t i = 0; i < synthPresetKeys.size(); ++i) {
    uint8_t value = preset.values[i];
    if (synthPresetKeys[i] == SettingKey::PlaybackMode) {
      value = normalizeSynthPlaybackMode(value);
    }
    settings[static_cast<uint8_t>(synthPresetKeys[i])] = value;
  }
}

// Wrapper that mutes audio before writing to flash and unmutes afterward.
// On the RP2040 flash writes disable ALL interrupts on BOTH cores, which
// starves buffer refills. Muting first gives the DMA path silence to play
// instead of an audible glitch when interrupts resume.
void flashSafeWrite(void (*writeOperation)()) {
  flashWriteInProgress.store(true, std::memory_order_release);
  // Allow Core 1 enough time to render queued silence before the flash write
  // freezes interrupt handling.
  delayMicroseconds(AUDIO_DMA_BUFFER_MICROS * 2);
  writeOperation();
  flashWriteInProgress.store(false, std::memory_order_release);
}

void flashSafeSave() {
  flashSafeWrite(save_settings);
}

void flashSafeSaveSynthPresets() {
  flashSafeWrite(save_synth_presets);
}

void flashSafeSaveUserSynthWavetable() {
  flashSafeWrite(save_user_wavetable);
}

void saveSynthPresetToSlot(uint16_t presetIndex) {
  if (presetIndex >= synthPresets.size()) {
    return;
  }
  captureCurrentSynthPreset(synthPresets[presetIndex]);
  normalizeSynthPresetMetadata(synthPresets[presetIndex], static_cast<uint8_t>(presetIndex));
  flashSafeSaveSynthPresets();
  sendToLog("Saved synth preset " + std::string(synthPresets[presetIndex].name));
}

void saveSynthPresetAsNew(const char* folderPath) {
  if (synthPresets.size() >= SYNTH_PRESET_MAX_COUNT) {
    sendToLog("Synth preset library is full.");
    return;
  }
  SynthPresetSlot preset = {};
  captureCurrentSynthPreset(preset);
  snprintf(preset.name, sizeof(preset.name), "Preset %u", static_cast<unsigned>(synthPresets.size() + 1));
  snprintf(preset.folderPath, sizeof(preset.folderPath), "%s", folderPath && folderPath[0] ? folderPath : SYNTH_PRESET_ROOT_FOLDER);
  normalizeSynthPresetMetadata(preset, static_cast<uint8_t>(synthPresets.size()));
  synthPresets.push_back(preset);
  flashSafeSaveSynthPresets();
  sendToLog("Saved new synth preset " + std::string(preset.name));
}

void loadSynthPresetFromSlot(uint16_t presetIndex) {
  if (presetIndex >= synthPresets.size() || !synthPresets[presetIndex].valid) {
    sendToLog("Synth preset handle is empty.");
    return;
  }
  applySynthPresetToSettings(synthPresets[presetIndex]);
  markSettingsDirty();
  syncSettingsToRuntime();
  sendToLog("Loaded synth preset " + std::string(synthPresets[presetIndex].name));
}

constexpr uint8_t PRESET_SYNC_FAMILY = 0x10;
constexpr uint8_t PRESET_SYNC_MAJOR = 1;
constexpr uint8_t PRESET_SYNC_MINOR = 0;
constexpr uint16_t PRESET_SYNC_NEW_OBJECT_HANDLE = 0x3FFF;
constexpr uint16_t PRESET_SYNC_CURRENT_SYNTH_PRESET_HANDLE = PRESET_SYNC_NEW_OBJECT_HANDLE;
constexpr uint16_t PRESET_SYNC_RAW_CHUNK_SIZE = 64;
constexpr size_t PRESET_SYNC_MAX_SYNTH_PRESET_BYTES = 2048;
constexpr size_t PRESET_SYNC_MAX_SYNTH_WAVETABLE_BYTES = SYNTH_WAVETABLE_SAMPLE_BYTES + 256;
constexpr size_t PRESET_SYNC_MAX_RAW_OBJECT_BYTES = PRESET_SYNC_MAX_SYNTH_WAVETABLE_BYTES;

constexpr uint8_t PRESET_SYNC_MSG_HELLO_REQ = 0x01;
constexpr uint8_t PRESET_SYNC_MSG_HELLO_RESP = 0x02;
constexpr uint8_t PRESET_SYNC_MSG_ACK = 0x06;
constexpr uint8_t PRESET_SYNC_MSG_NACK = 0x07;
constexpr uint8_t PRESET_SYNC_MSG_OBJECT_LIST_REQ = 0x20;
constexpr uint8_t PRESET_SYNC_MSG_OBJECT_LIST_RESP = 0x21;
constexpr uint8_t PRESET_SYNC_MSG_READ_REQ = 0x22;
constexpr uint8_t PRESET_SYNC_MSG_READ_BEGIN = 0x23;
constexpr uint8_t PRESET_SYNC_MSG_WRITE_BEGIN = 0x24;
constexpr uint8_t PRESET_SYNC_MSG_DATA_CHUNK = 0x25;
constexpr uint8_t PRESET_SYNC_MSG_TRANSFER_END = 0x26;
constexpr uint8_t PRESET_SYNC_MSG_WRITE_COMMIT = 0x27;
constexpr uint8_t PRESET_SYNC_MSG_TRANSFER_ABORT = 0x28;
constexpr uint8_t PRESET_SYNC_MSG_DELETE_REQ = 0x29;

constexpr uint8_t PRESET_SYNC_OBJECT_TYPE_SYNTH_PRESET = 0x07;
constexpr uint8_t PRESET_SYNC_OBJECT_TYPE_SYNTH_WAVETABLE = 0x0B;
constexpr uint8_t PRESET_SYNC_TLV_NAME = 0x01;
constexpr uint8_t PRESET_SYNC_TLV_OBJECT_ID = 0x02;
constexpr uint8_t PRESET_SYNC_TLV_SOURCE = 0x03;
constexpr uint8_t PRESET_SYNC_TLV_FOLDER_PATH = 0x06;
constexpr uint8_t PRESET_SYNC_TLV_SYNTH_SCHEMA_VERSION = 0x20;
constexpr uint8_t PRESET_SYNC_TLV_SYNTH_VALUES = 0x21;
constexpr uint8_t PRESET_SYNC_TLV_FAVORITE = 0x23;
constexpr uint8_t PRESET_SYNC_TLV_WAVETABLE_FRAME_COUNT = 0x30;
constexpr uint8_t PRESET_SYNC_TLV_WAVETABLE_SAMPLE_COUNT = 0x31;
constexpr uint8_t PRESET_SYNC_TLV_WAVETABLE_SAMPLES = 0x32;

constexpr uint8_t PRESET_SYNC_WRITE_APPLY_TO_RUNTIME = 0x01;
constexpr uint8_t PRESET_SYNC_WRITE_SAVE_TO_FLASH = 0x02;
constexpr uint8_t PRESET_SYNC_WRITE_DRY_RUN = 0x08;

constexpr uint32_t PRESET_SYNC_CAP_SYNTH_PRESET = 1u << 1;
constexpr uint32_t PRESET_SYNC_CAP_DRY_RUN = 1u << 8;
constexpr uint32_t PRESET_SYNC_CAP_SYNTH_WAVETABLE = 1u << 11;

constexpr uint8_t PRESET_SYNC_ERROR_UNSUPPORTED_PROTOCOL = 0x01;
constexpr uint8_t PRESET_SYNC_ERROR_UNKNOWN_MESSAGE = 0x02;
constexpr uint8_t PRESET_SYNC_ERROR_BAD_LENGTH = 0x03;
constexpr uint8_t PRESET_SYNC_ERROR_BAD_OBJECT_TYPE = 0x04;
constexpr uint8_t PRESET_SYNC_ERROR_BAD_CHECKSUM = 0x05;
constexpr uint8_t PRESET_SYNC_ERROR_BAD_CRC = 0x06;
constexpr uint8_t PRESET_SYNC_ERROR_UNEXPECTED_CHUNK = 0x07;
constexpr uint8_t PRESET_SYNC_ERROR_BUSY = 0x08;
constexpr uint8_t PRESET_SYNC_ERROR_STORAGE_FULL = 0x09;
constexpr uint8_t PRESET_SYNC_ERROR_OBJECT_MISSING = 0x0B;
constexpr uint8_t PRESET_SYNC_ERROR_SCHEMA_MISMATCH = 0x0C;
constexpr uint8_t PRESET_SYNC_ERROR_VALIDATION_FAILED = 0x0D;

struct PresetSyncWriteTransfer {
  bool active = false;
  bool ended = false;
  uint8_t objectType = 0;
  uint16_t handle = PRESET_SYNC_NEW_OBJECT_HANDLE;
  uint16_t transferId = 0;
  uint8_t schemaMajor = 0;
  uint8_t schemaMinor = 0;
  uint32_t rawByteLength = 0;
  uint32_t objectCrc32 = 0;
  uint16_t rawChunkSize = 0;
  uint8_t writeFlags = 0;
  uint32_t receivedBytes = 0;
  uint32_t expectedChunkIndex = 0;
  std::vector<uint8_t> rawData;
};

struct PresetSyncReadTransfer {
  bool active = false;
  bool endSent = false;
  uint8_t objectType = 0;
  uint16_t handle = PRESET_SYNC_NEW_OBJECT_HANDLE;
  uint16_t transactionId = 0;
  uint16_t transferId = 0;
  uint8_t schemaMajor = 0;
  uint8_t schemaMinor = 0;
  uint32_t objectCrc32 = 0;
  uint32_t sentBytes = 0;
  uint32_t nextChunkIndex = 0;
  std::vector<uint8_t> rawData;
};

PresetSyncWriteTransfer presetSyncWriteTransfer;
PresetSyncReadTransfer presetSyncReadTransfer;
uint16_t presetSyncNextTransferId = 1;

size_t boundedCStringLength(const char* text, size_t maxLength) {
  size_t length = 0;
  while (length < maxLength && text[length] != '\0') {
    ++length;
  }
  return length;
}

uint16_t presetSyncDecodeU14(const uint8_t* bytes) {
  return (static_cast<uint16_t>(bytes[0] & 0x7F) << 7) | (bytes[1] & 0x7F);
}

uint32_t presetSyncDecodeU21(const uint8_t* bytes) {
  return (static_cast<uint32_t>(bytes[0] & 0x7F) << 14)
         | (static_cast<uint32_t>(bytes[1] & 0x7F) << 7)
         | (bytes[2] & 0x7F);
}

uint32_t presetSyncDecodeU28(const uint8_t* bytes) {
  return (static_cast<uint32_t>(bytes[0] & 0x7F) << 21)
         | (static_cast<uint32_t>(bytes[1] & 0x7F) << 14)
         | (static_cast<uint32_t>(bytes[2] & 0x7F) << 7)
         | (bytes[3] & 0x7F);
}

uint32_t presetSyncDecodeU35ToU32(const uint8_t* bytes) {
  return ((static_cast<uint32_t>(bytes[0] & 0x0F) << 28)
          | (static_cast<uint32_t>(bytes[1] & 0x7F) << 21)
          | (static_cast<uint32_t>(bytes[2] & 0x7F) << 14)
          | (static_cast<uint32_t>(bytes[3] & 0x7F) << 7)
          | (bytes[4] & 0x7F));
}

void presetSyncAppendU14(std::vector<uint8_t>& output, uint16_t value) {
  output.push_back((value >> 7) & 0x7F);
  output.push_back(value & 0x7F);
}

void presetSyncAppendU21(std::vector<uint8_t>& output, uint32_t value) {
  output.push_back((value >> 14) & 0x7F);
  output.push_back((value >> 7) & 0x7F);
  output.push_back(value & 0x7F);
}

void presetSyncAppendU28(std::vector<uint8_t>& output, uint32_t value) {
  output.push_back((value >> 21) & 0x7F);
  output.push_back((value >> 14) & 0x7F);
  output.push_back((value >> 7) & 0x7F);
  output.push_back(value & 0x7F);
}

void presetSyncAppendU35FromU32(std::vector<uint8_t>& output, uint32_t value) {
  output.push_back((value >> 28) & 0x7F);
  output.push_back((value >> 21) & 0x7F);
  output.push_back((value >> 14) & 0x7F);
  output.push_back((value >> 7) & 0x7F);
  output.push_back(value & 0x7F);
}

bool presetSyncPayloadIsSevenBit(const uint8_t* payload, size_t length) {
  for (size_t i = 0; i < length; ++i) {
    if (payload[i] > 0x7F) {
      return false;
    }
  }
  return true;
}

void presetSyncSendFrame(uint8_t message, uint16_t transactionId, const std::vector<uint8_t>& payload) {
  std::vector<uint8_t> frame;
  frame.reserve(7 + payload.size());
  frame.push_back(0x7D);
  frame.push_back(PRESET_SYNC_FAMILY);
  frame.push_back(PRESET_SYNC_MAJOR);
  frame.push_back(PRESET_SYNC_MINOR);
  frame.push_back(message & 0x7F);
  presetSyncAppendU14(frame, transactionId);
  frame.insert(frame.end(), payload.begin(), payload.end());
  withMIDI([&](auto& M) { M.sendSysEx(frame.size(), frame.data()); });
}

void presetSyncSendAck(uint16_t transactionId, uint8_t ackedMessage, uint32_t nextChunkIndex = 0, uint8_t detail = 0) {
  std::vector<uint8_t> payload;
  payload.push_back(ackedMessage);
  payload.push_back(0);
  presetSyncAppendU21(payload, nextChunkIndex);
  payload.push_back(detail & 0x7F);
  presetSyncSendFrame(PRESET_SYNC_MSG_ACK, transactionId, payload);
}

void presetSyncSendNack(uint16_t transactionId, uint8_t failedMessage, uint8_t errorCode, uint32_t expectedChunkIndex = 0, uint8_t detail = 0) {
  std::vector<uint8_t> payload;
  payload.push_back(failedMessage);
  payload.push_back(errorCode);
  presetSyncAppendU21(payload, expectedChunkIndex);
  payload.push_back(detail & 0x7F);
  presetSyncSendFrame(PRESET_SYNC_MSG_NACK, transactionId, payload);
}

void presetSyncCancelReadTransfer() {
  presetSyncReadTransfer = PresetSyncReadTransfer{};
}

void presetSyncCancelWriteTransfer() {
  presetSyncWriteTransfer = PresetSyncWriteTransfer{};
}

uint8_t presetSyncChunkChecksum(const uint8_t* data, size_t length) {
  uint8_t sum = 0;
  for (size_t i = 0; i < length; ++i) {
    sum = (sum + data[i]) & 0x7F;
  }
  return sum;
}

void presetSyncPack8To7(const uint8_t* raw, size_t rawLength, std::vector<uint8_t>& packed) {
  for (size_t offset = 0; offset < rawLength; offset += 7) {
    size_t count = std::min<size_t>(7, rawLength - offset);
    uint8_t prefix = 0;
    size_t prefixIndex = packed.size();
    packed.push_back(0);
    for (size_t i = 0; i < count; ++i) {
      uint8_t value = raw[offset + i];
      if (value & 0x80) {
        prefix |= (1u << i);
      }
      packed.push_back(value & 0x7F);
    }
    packed[prefixIndex] = prefix;
  }
}

bool presetSyncUnpack8To7(const uint8_t* packed, size_t packedLength, size_t rawLength, std::vector<uint8_t>& raw) {
  raw.clear();
  raw.reserve(rawLength);
  size_t offset = 0;
  while (offset < packedLength && raw.size() < rawLength) {
    uint8_t prefix = packed[offset++];
    if (prefix > 0x7F) {
      return false;
    }
    size_t remainingRaw = rawLength - raw.size();
    size_t count = std::min<size_t>(7, remainingRaw);
    if (offset + count > packedLength) {
      return false;
    }
    for (size_t i = 0; i < count; ++i) {
      uint8_t low = packed[offset++];
      if (low > 0x7F) {
        return false;
      }
      raw.push_back(low | (((prefix >> i) & 0x01) << 7));
    }
  }
  return raw.size() == rawLength;
}

void presetSyncAppendTlv(std::vector<uint8_t>& body, uint8_t tag, const uint8_t* value, uint16_t length) {
  body.push_back(tag);
  body.push_back(length & 0xFF);
  body.push_back((length >> 8) & 0xFF);
  body.insert(body.end(), value, value + length);
}

void presetSyncAppendTextTlv(std::vector<uint8_t>& body, uint8_t tag, const char* text, size_t maxLength) {
  size_t length = boundedCStringLength(text, maxLength);
  presetSyncAppendTlv(body, tag, reinterpret_cast<const uint8_t*>(text), static_cast<uint16_t>(length));
}

std::vector<uint8_t> buildSynthPresetObjectBody(const SynthPresetSlot& preset) {
  std::vector<uint8_t> body;
  body.reserve(192);
  body.push_back('H');
  body.push_back('B');
  body.push_back('S');
  body.push_back('1');
  body.push_back(PRESET_SYNC_OBJECT_TYPE_SYNTH_PRESET);
  body.push_back(1);
  body.push_back(0);
  body.push_back(0);
  presetSyncAppendTextTlv(body, PRESET_SYNC_TLV_NAME, preset.name, sizeof(preset.name));
  presetSyncAppendTlv(body, PRESET_SYNC_TLV_OBJECT_ID, preset.objectId, sizeof(preset.objectId));
  static constexpr char source[] = "device";
  presetSyncAppendTlv(body, PRESET_SYNC_TLV_SOURCE, reinterpret_cast<const uint8_t*>(source), sizeof(source) - 1);
  presetSyncAppendTextTlv(body, PRESET_SYNC_TLV_FOLDER_PATH, preset.folderPath, sizeof(preset.folderPath));
  uint8_t schemaVersion = SYNTH_PRESET_SCHEMA_VERSION;
  presetSyncAppendTlv(body, PRESET_SYNC_TLV_SYNTH_SCHEMA_VERSION, &schemaVersion, 1);
  std::vector<uint8_t> values;
  values.reserve(SYNTH_PRESET_VALUE_COUNT * 2);
  for (size_t i = 0; i < synthPresetKeys.size(); ++i) {
    values.push_back(static_cast<uint8_t>(synthPresetKeys[i]));
    values.push_back(preset.values[i]);
  }
  presetSyncAppendTlv(body, PRESET_SYNC_TLV_SYNTH_VALUES, values.data(), static_cast<uint16_t>(values.size()));
  uint8_t favorite = preset.favorite ? 1 : 0;
  presetSyncAppendTlv(body, PRESET_SYNC_TLV_FAVORITE, &favorite, 1);
  return body;
}

int synthPresetKeyIndex(uint8_t settingKey) {
  for (size_t i = 0; i < synthPresetKeys.size(); ++i) {
    if (static_cast<uint8_t>(synthPresetKeys[i]) == settingKey) {
      return static_cast<int>(i);
    }
  }
  return -1;
}

void copyPresetSyncText(char* destination, size_t destinationLength, const uint8_t* source, size_t sourceLength) {
  if (destinationLength == 0) {
    return;
  }
  size_t copyLength = std::min(destinationLength - 1, sourceLength);
  memcpy(destination, source, copyLength);
  destination[copyLength] = '\0';
}

bool parseSynthPresetObjectBody(const std::vector<uint8_t>& body, SynthPresetSlot& preset, std::string& error) {
  if (body.size() < 8 || body[0] != 'H' || body[1] != 'B' || body[2] != 'S' || body[3] != '1') {
    error = "bad object magic";
    return false;
  }
  if (body[4] != PRESET_SYNC_OBJECT_TYPE_SYNTH_PRESET) {
    error = "not synth preset";
    return false;
  }
  if (body[5] != 1) {
    error = "unsupported synth preset object schema";
    return false;
  }

  preset = SynthPresetSlot{};
  preset.valid = 1;
  snprintf(preset.folderPath, sizeof(preset.folderPath), "%s", SYNTH_PRESET_ROOT_FOLDER);
  for (size_t i = 0; i < synthPresetKeys.size(); ++i) {
    preset.values[i] = factoryDefaults[static_cast<uint8_t>(synthPresetKeys[i])];
  }

  bool sawName = false;
  bool sawObjectId = false;
  bool sawValues = false;
  size_t cursor = 8;
  while (cursor < body.size()) {
    if (cursor + 3 > body.size()) {
      error = "truncated TLV header";
      return false;
    }
    uint8_t tag = body[cursor++];
    uint16_t length = static_cast<uint16_t>(body[cursor]) | (static_cast<uint16_t>(body[cursor + 1]) << 8);
    cursor += 2;
    if (cursor + length > body.size()) {
      error = "truncated TLV value";
      return false;
    }
    const uint8_t* value = body.data() + cursor;

    switch (tag) {
      case PRESET_SYNC_TLV_NAME:
        copyPresetSyncText(preset.name, sizeof(preset.name), value, length);
        sawName = preset.name[0] != '\0';
        break;
      case PRESET_SYNC_TLV_OBJECT_ID:
        if (length != sizeof(preset.objectId)) {
          error = "bad object id length";
          return false;
        }
        memcpy(preset.objectId, value, sizeof(preset.objectId));
        sawObjectId = true;
        break;
      case PRESET_SYNC_TLV_FOLDER_PATH:
        copyPresetSyncText(preset.folderPath, sizeof(preset.folderPath), value, length);
        if (!preset.folderPath[0]) {
          snprintf(preset.folderPath, sizeof(preset.folderPath), "%s", SYNTH_PRESET_ROOT_FOLDER);
        }
        break;
      case PRESET_SYNC_TLV_SYNTH_VALUES:
        if ((length % 2) != 0) {
          error = "bad synth values length";
          return false;
        }
        for (uint16_t i = 0; i < length; i += 2) {
          int keyIndex = synthPresetKeyIndex(value[i]);
          if (keyIndex >= 0) {
            preset.values[keyIndex] = value[i + 1];
          }
        }
        sawValues = true;
        break;
      case PRESET_SYNC_TLV_SYNTH_SCHEMA_VERSION:
        if (length >= 1 && value[0] > SYNTH_PRESET_SCHEMA_VERSION) {
          error = "unsupported synth preset value schema";
          return false;
        }
        break;
      case PRESET_SYNC_TLV_FAVORITE:
        if (length >= 1) {
          preset.favorite = value[0] ? 1 : 0;
        }
        break;
      default:
        break;
    }

    cursor += length;
  }

  if (!sawName || !sawObjectId || !sawValues) {
    error = "missing required synth preset TLV";
    return false;
  }
  normalizeSynthPresetValues(preset);
  normalizeSynthPresetMetadata(preset, 0);
  return true;
}

struct ParsedSynthWavetableObject {
  const uint8_t* samples = nullptr;
  uint16_t sampleLength = 0;
};

bool parseSynthWavetableObjectBody(const std::vector<uint8_t>& body, ParsedSynthWavetableObject& wavetable, std::string& error) {
  if (body.size() < 8 || body[0] != 'H' || body[1] != 'B' || body[2] != 'S' || body[3] != '1') {
    error = "bad object magic";
    return false;
  }
  if (body[4] != PRESET_SYNC_OBJECT_TYPE_SYNTH_WAVETABLE) {
    error = "not synth wavetable";
    return false;
  }
  if (body[5] != 1) {
    error = "unsupported synth wavetable object schema";
    return false;
  }

  bool sawFrameCount = false;
  bool sawSampleCount = false;
  bool sawSamples = false;
  size_t cursor = 8;
  while (cursor < body.size()) {
    if (cursor + 3 > body.size()) {
      error = "truncated TLV header";
      return false;
    }
    uint8_t tag = body[cursor++];
    uint16_t length = static_cast<uint16_t>(body[cursor]) | (static_cast<uint16_t>(body[cursor + 1]) << 8);
    cursor += 2;
    if (cursor + length > body.size()) {
      error = "truncated TLV value";
      return false;
    }
    const uint8_t* value = body.data() + cursor;

    switch (tag) {
      case PRESET_SYNC_TLV_WAVETABLE_FRAME_COUNT:
        if (length != 1 || value[0] != SYNTH_WAVETABLE_FRAME_COUNT) {
          error = "bad wavetable frame count";
          return false;
        }
        sawFrameCount = true;
        break;
      case PRESET_SYNC_TLV_WAVETABLE_SAMPLE_COUNT: {
        if (length != 2) {
          error = "bad wavetable sample count length";
          return false;
        }
        uint16_t sampleCount = static_cast<uint16_t>(value[0]) | (static_cast<uint16_t>(value[1]) << 8);
        if (sampleCount != SYNTH_WAVE_SAMPLE_COUNT) {
          error = "bad wavetable sample count";
          return false;
        }
        sawSampleCount = true;
        break;
      }
      case PRESET_SYNC_TLV_WAVETABLE_SAMPLES:
        if (length != SYNTH_WAVETABLE_SAMPLE_BYTES) {
          error = "bad wavetable sample data length";
          return false;
        }
        wavetable.samples = value;
        wavetable.sampleLength = length;
        sawSamples = true;
        break;
      default:
        break;
    }

    cursor += length;
  }

  if (!sawFrameCount || !sawSampleCount || !sawSamples || wavetable.samples == nullptr) {
    error = "missing required wavetable TLV";
    return false;
  }
  return true;
}

size_t presetSyncMaxRawObjectBytesForType(uint8_t objectType) {
  switch (objectType) {
    case PRESET_SYNC_OBJECT_TYPE_SYNTH_PRESET:
      return PRESET_SYNC_MAX_SYNTH_PRESET_BYTES;
    case PRESET_SYNC_OBJECT_TYPE_SYNTH_WAVETABLE:
      return PRESET_SYNC_MAX_SYNTH_WAVETABLE_BYTES;
    default:
      return 0;
  }
}

int findSynthPresetByObjectId(const uint8_t* objectId) {
  for (size_t i = 0; i < synthPresets.size(); ++i) {
    if (synthPresets[i].valid && memcmp(synthPresets[i].objectId, objectId, SYNTH_PRESET_OBJECT_ID_LENGTH) == 0) {
      return static_cast<int>(i);
    }
  }
  return -1;
}

int chooseSynthPresetWriteSlot(uint16_t handle, const SynthPresetSlot& preset) {
  if (handle != PRESET_SYNC_NEW_OBJECT_HANDLE && handle < synthPresets.size()) {
    return handle;
  }
  int existing = findSynthPresetByObjectId(preset.objectId);
  if (existing >= 0) {
    return existing;
  }
  if (synthPresets.size() < SYNTH_PRESET_MAX_COUNT) {
    return static_cast<int>(synthPresets.size());
  }
  return -1;
}

void applySynthPresetRuntimeOnly(const SynthPresetSlot& preset) {
  applySynthPresetToSettings(preset);
  syncSettingsToRuntime();
}

void presetSyncHandleHello(uint16_t transactionId, const uint8_t* payload, size_t payloadLength) {
  if (payloadLength != 6) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_HELLO_REQ, PRESET_SYNC_ERROR_BAD_LENGTH);
    return;
  }
  std::vector<uint8_t> response;
  response.push_back(PRESET_SYNC_MAJOR);
  response.push_back(PRESET_SYNC_MINOR);
  presetSyncAppendU14(response, 128);
  presetSyncAppendU28(response, PRESET_SYNC_CAP_SYNTH_PRESET | PRESET_SYNC_CAP_DRY_RUN | PRESET_SYNC_CAP_SYNTH_WAVETABLE);
  presetSyncAppendU28(response, PRESET_SYNC_MAX_RAW_OBJECT_BYTES);
  response.push_back(CURRENT_SETTINGS_VERSION);
  response.push_back(SYNTH_PRESET_SCHEMA_VERSION);
  response.push_back(PROFILE_COUNT);
  presetSyncAppendU14(response, SYNTH_PRESET_MAX_COUNT);
  response.push_back(0);
  response.push_back(0);
  response.push_back(0);
  response.push_back(0);
  response.push_back(Hardware_Version & 0x7F);
  presetSyncSendFrame(PRESET_SYNC_MSG_HELLO_RESP, transactionId, response);
}

void presetSyncAppendAscii(std::vector<uint8_t>& output, const char* text, size_t maxLength) {
  size_t length = boundedCStringLength(text, maxLength);
  output.push_back(std::min<size_t>(length, 127));
  for (size_t i = 0; i < length && i < 127; ++i) {
    uint8_t value = static_cast<uint8_t>(text[i]);
    output.push_back(value <= 0x7F ? value : '?');
  }
}

void presetSyncHandleObjectList(uint16_t transactionId, const uint8_t* payload, size_t payloadLength) {
  if (payloadLength < 5) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_OBJECT_LIST_REQ, PRESET_SYNC_ERROR_BAD_LENGTH);
    return;
  }
  uint8_t objectType = payload[0];
  if (objectType != PRESET_SYNC_OBJECT_TYPE_SYNTH_PRESET) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_OBJECT_LIST_REQ, PRESET_SYNC_ERROR_BAD_OBJECT_TYPE);
    return;
  }
  uint16_t pageIndex = presetSyncDecodeU14(payload + 1);
  uint8_t requestedPageSize = payload[3];
  uint8_t folderLength = payload[4];
  if (payloadLength != static_cast<size_t>(5 + folderLength)) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_OBJECT_LIST_REQ, PRESET_SYNC_ERROR_BAD_LENGTH);
    return;
  }

  char folderFilter[SYNTH_PRESET_FOLDER_LENGTH] = {};
  if (folderLength > 0) {
    copyPresetSyncText(folderFilter, sizeof(folderFilter), payload + 5, folderLength);
  }

  std::vector<uint8_t> handles;
  for (size_t i = 0; i < synthPresets.size(); ++i) {
    if (!synthPresets[i].valid) {
      continue;
    }
    if (folderFilter[0] && strncmp(synthPresets[i].folderPath, folderFilter, sizeof(synthPresets[i].folderPath)) != 0) {
      continue;
    }
    handles.push_back(static_cast<uint8_t>(i));
  }

  uint8_t pageSize = requestedPageSize == 0 ? 4 : std::min<uint8_t>(requestedPageSize, 4);
  uint16_t pageCount = std::max<uint16_t>(1, (handles.size() + pageSize - 1) / pageSize);
  size_t start = static_cast<size_t>(pageIndex) * pageSize;
  size_t end = std::min(handles.size(), start + pageSize);

  std::vector<uint8_t> response;
  response.push_back(objectType);
  presetSyncAppendU14(response, pageIndex);
  presetSyncAppendU14(response, pageCount);
  response.push_back((start < handles.size()) ? static_cast<uint8_t>(end - start) : 0);
  if (start < handles.size()) {
    for (size_t listIndex = start; listIndex < end; ++listIndex) {
      uint8_t handle = handles[listIndex];
      SynthPresetSlot& preset = synthPresets[handle];
      normalizeSynthPresetMetadata(preset, static_cast<uint8_t>(handle));
      response.push_back(PRESET_SYNC_OBJECT_TYPE_SYNTH_PRESET);
      presetSyncAppendU14(response, handle);
      response.push_back(0x01);
      response.push_back(1);
      response.push_back(0);
      std::vector<uint8_t> packedObjectId;
      presetSyncPack8To7(preset.objectId, sizeof(preset.objectId), packedObjectId);
      response.push_back(packedObjectId.size());
      response.insert(response.end(), packedObjectId.begin(), packedObjectId.end());
      presetSyncAppendAscii(response, preset.folderPath, sizeof(preset.folderPath));
      presetSyncAppendAscii(response, preset.name, sizeof(preset.name));
    }
  }
  presetSyncSendFrame(PRESET_SYNC_MSG_OBJECT_LIST_RESP, transactionId, response);
}

uint16_t presetSyncAllocateTransferId() {
  uint16_t current = presetSyncNextTransferId;
  ++presetSyncNextTransferId;
  if (presetSyncNextTransferId == 0 || presetSyncNextTransferId > PRESET_SYNC_NEW_OBJECT_HANDLE) {
    presetSyncNextTransferId = 1;
  }
  return current;
}

void presetSyncSendReadBegin() {
  std::vector<uint8_t> begin;
  begin.push_back(presetSyncReadTransfer.objectType);
  presetSyncAppendU14(begin, presetSyncReadTransfer.handle);
  presetSyncAppendU14(begin, presetSyncReadTransfer.transferId);
  begin.push_back(presetSyncReadTransfer.schemaMajor);
  begin.push_back(presetSyncReadTransfer.schemaMinor);
  presetSyncAppendU28(begin, presetSyncReadTransfer.rawData.size());
  presetSyncAppendU35FromU32(begin, presetSyncReadTransfer.objectCrc32);
  presetSyncAppendU14(begin, PRESET_SYNC_RAW_CHUNK_SIZE);
  begin.push_back(0);
  presetSyncSendFrame(PRESET_SYNC_MSG_READ_BEGIN, presetSyncReadTransfer.transactionId, begin);
}

void presetSyncSendReadEnd() {
  std::vector<uint8_t> endPayload;
  presetSyncAppendU14(endPayload, presetSyncReadTransfer.transferId);
  presetSyncAppendU21(endPayload, presetSyncReadTransfer.nextChunkIndex);
  presetSyncReadTransfer.endSent = true;
  presetSyncSendFrame(PRESET_SYNC_MSG_TRANSFER_END, presetSyncReadTransfer.transactionId, endPayload);
}

void presetSyncSendNextReadChunk() {
  if (!presetSyncReadTransfer.active) {
    return;
  }
  if (presetSyncReadTransfer.sentBytes >= presetSyncReadTransfer.rawData.size()) {
    presetSyncSendReadEnd();
    return;
  }

  size_t offset = presetSyncReadTransfer.sentBytes;
  size_t chunkLength = std::min<size_t>(PRESET_SYNC_RAW_CHUNK_SIZE, presetSyncReadTransfer.rawData.size() - offset);
  std::vector<uint8_t> chunk;
  presetSyncAppendU14(chunk, presetSyncReadTransfer.transferId);
  presetSyncAppendU21(chunk, presetSyncReadTransfer.nextChunkIndex);
  presetSyncAppendU28(chunk, offset);
  presetSyncAppendU14(chunk, chunkLength);
  chunk.push_back(presetSyncChunkChecksum(presetSyncReadTransfer.rawData.data() + offset, chunkLength));
  presetSyncPack8To7(presetSyncReadTransfer.rawData.data() + offset, chunkLength, chunk);
  presetSyncSendFrame(PRESET_SYNC_MSG_DATA_CHUNK, presetSyncReadTransfer.transactionId, chunk);
  presetSyncReadTransfer.sentBytes += chunkLength;
  ++presetSyncReadTransfer.nextChunkIndex;
}

void presetSyncSendRawObject(uint16_t transactionId, uint8_t objectType, uint16_t handle, uint8_t schemaMajor, uint8_t schemaMinor, const std::vector<uint8_t>& raw) {
  presetSyncReadTransfer = PresetSyncReadTransfer{};
  presetSyncReadTransfer.active = true;
  presetSyncReadTransfer.objectType = objectType;
  presetSyncReadTransfer.handle = handle;
  presetSyncReadTransfer.transactionId = transactionId;
  presetSyncReadTransfer.transferId = presetSyncAllocateTransferId();
  presetSyncReadTransfer.schemaMajor = schemaMajor;
  presetSyncReadTransfer.schemaMinor = schemaMinor;
  presetSyncReadTransfer.objectCrc32 = crc32(raw.data(), raw.size());
  presetSyncReadTransfer.rawData = raw;
  presetSyncSendReadBegin();
}

void presetSyncHandleReadRequest(uint16_t transactionId, const uint8_t* payload, size_t payloadLength) {
  if (payloadLength != 4) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_READ_REQ, PRESET_SYNC_ERROR_BAD_LENGTH);
    return;
  }
  if (presetSyncReadTransfer.active || presetSyncWriteTransfer.active) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_READ_REQ, PRESET_SYNC_ERROR_BUSY);
    return;
  }
  if (payload[0] != PRESET_SYNC_OBJECT_TYPE_SYNTH_PRESET) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_READ_REQ, PRESET_SYNC_ERROR_BAD_OBJECT_TYPE);
    return;
  }
  uint16_t handle = presetSyncDecodeU14(payload + 1);
  if (handle == PRESET_SYNC_CURRENT_SYNTH_PRESET_HANDLE) {
    SynthPresetSlot currentPreset = buildCurrentSynthPresetObject();
    presetSyncSendRawObject(transactionId, PRESET_SYNC_OBJECT_TYPE_SYNTH_PRESET, handle, 1, 0, buildSynthPresetObjectBody(currentPreset));
    return;
  }
  if (handle >= synthPresets.size() || !synthPresets[handle].valid) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_READ_REQ, PRESET_SYNC_ERROR_OBJECT_MISSING);
    return;
  }
  normalizeSynthPresetMetadata(synthPresets[handle], handle);
  presetSyncSendRawObject(transactionId, PRESET_SYNC_OBJECT_TYPE_SYNTH_PRESET, handle, 1, 0, buildSynthPresetObjectBody(synthPresets[handle]));
}

void presetSyncHandleAck(uint16_t transactionId, const uint8_t* payload, size_t payloadLength) {
  if (payloadLength != 6 || !presetSyncReadTransfer.active || transactionId != presetSyncReadTransfer.transactionId) {
    return;
  }

  uint8_t ackedMessage = payload[0];
  uint32_t nextChunkIndex = presetSyncDecodeU21(payload + 2);
  switch (ackedMessage) {
    case PRESET_SYNC_MSG_READ_BEGIN:
      if (presetSyncReadTransfer.nextChunkIndex == 0 && presetSyncReadTransfer.sentBytes == 0) {
        presetSyncSendNextReadChunk();
      }
      break;
    case PRESET_SYNC_MSG_DATA_CHUNK:
      if (!presetSyncReadTransfer.endSent && nextChunkIndex == presetSyncReadTransfer.nextChunkIndex) {
        presetSyncSendNextReadChunk();
      }
      break;
    case PRESET_SYNC_MSG_TRANSFER_END:
      presetSyncCancelReadTransfer();
      break;
    default:
      break;
  }
}

void presetSyncHandleNack(uint16_t transactionId, const uint8_t* payload, size_t payloadLength) {
  if (payloadLength != 6 || !presetSyncReadTransfer.active || transactionId != presetSyncReadTransfer.transactionId) {
    return;
  }
  uint8_t failedMessage = payload[0];
  if (failedMessage == PRESET_SYNC_MSG_READ_BEGIN
      || failedMessage == PRESET_SYNC_MSG_DATA_CHUNK
      || failedMessage == PRESET_SYNC_MSG_TRANSFER_END) {
    sendToLog("Preset-sync read transfer aborted by host NACK.");
    presetSyncCancelReadTransfer();
  }
}

void presetSyncHandleWriteBegin(uint16_t transactionId, const uint8_t* payload, size_t payloadLength) {
  if (payloadLength != 19) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_WRITE_BEGIN, PRESET_SYNC_ERROR_BAD_LENGTH);
    return;
  }
  if (presetSyncWriteTransfer.active || presetSyncReadTransfer.active) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_WRITE_BEGIN, PRESET_SYNC_ERROR_BUSY);
    return;
  }
  uint8_t objectType = payload[0];
  size_t maxRawObjectBytes = presetSyncMaxRawObjectBytesForType(objectType);
  if (maxRawObjectBytes == 0) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_WRITE_BEGIN, PRESET_SYNC_ERROR_BAD_OBJECT_TYPE);
    return;
  }

  uint32_t rawByteLength = presetSyncDecodeU28(payload + 7);
  if (rawByteLength == 0 || rawByteLength > maxRawObjectBytes) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_WRITE_BEGIN, PRESET_SYNC_ERROR_BAD_LENGTH);
    return;
  }
  if (payload[5] != 1) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_WRITE_BEGIN, PRESET_SYNC_ERROR_SCHEMA_MISMATCH);
    return;
  }

  presetSyncWriteTransfer = PresetSyncWriteTransfer{};
  presetSyncWriteTransfer.active = true;
  presetSyncWriteTransfer.objectType = objectType;
  presetSyncWriteTransfer.handle = presetSyncDecodeU14(payload + 1);
  presetSyncWriteTransfer.transferId = presetSyncDecodeU14(payload + 3);
  presetSyncWriteTransfer.schemaMajor = payload[5];
  presetSyncWriteTransfer.schemaMinor = payload[6];
  presetSyncWriteTransfer.rawByteLength = rawByteLength;
  presetSyncWriteTransfer.objectCrc32 = presetSyncDecodeU35ToU32(payload + 11);
  presetSyncWriteTransfer.rawChunkSize = presetSyncDecodeU14(payload + 16);
  presetSyncWriteTransfer.writeFlags = payload[18];
  presetSyncWriteTransfer.rawData.assign(rawByteLength, 0);
  presetSyncSendAck(transactionId, PRESET_SYNC_MSG_WRITE_BEGIN);
}

void presetSyncHandleDataChunk(uint16_t transactionId, const uint8_t* payload, size_t payloadLength) {
  if (payloadLength < 12) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_DATA_CHUNK, PRESET_SYNC_ERROR_BAD_LENGTH);
    return;
  }
  if (!presetSyncWriteTransfer.active) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_DATA_CHUNK, PRESET_SYNC_ERROR_UNEXPECTED_CHUNK);
    return;
  }
  uint16_t transferId = presetSyncDecodeU14(payload);
  uint32_t chunkIndex = presetSyncDecodeU21(payload + 2);
  uint32_t rawOffset = presetSyncDecodeU28(payload + 5);
  uint16_t rawLength = presetSyncDecodeU14(payload + 9);
  uint8_t checksum = payload[11];
  if (transferId != presetSyncWriteTransfer.transferId
      || chunkIndex != presetSyncWriteTransfer.expectedChunkIndex
      || rawOffset != presetSyncWriteTransfer.receivedBytes
      || rawOffset + rawLength > presetSyncWriteTransfer.rawByteLength) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_DATA_CHUNK, PRESET_SYNC_ERROR_UNEXPECTED_CHUNK, presetSyncWriteTransfer.expectedChunkIndex);
    return;
  }

  std::vector<uint8_t> raw;
  if (!presetSyncUnpack8To7(payload + 12, payloadLength - 12, rawLength, raw)) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_DATA_CHUNK, PRESET_SYNC_ERROR_BAD_LENGTH, presetSyncWriteTransfer.expectedChunkIndex);
    return;
  }
  if (presetSyncChunkChecksum(raw.data(), raw.size()) != checksum) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_DATA_CHUNK, PRESET_SYNC_ERROR_BAD_CHECKSUM, presetSyncWriteTransfer.expectedChunkIndex);
    return;
  }

  memcpy(presetSyncWriteTransfer.rawData.data() + rawOffset, raw.data(), raw.size());
  presetSyncWriteTransfer.receivedBytes += raw.size();
  ++presetSyncWriteTransfer.expectedChunkIndex;
  presetSyncSendAck(transactionId, PRESET_SYNC_MSG_DATA_CHUNK, presetSyncWriteTransfer.expectedChunkIndex);
}

void presetSyncHandleTransferEnd(uint16_t transactionId, const uint8_t* payload, size_t payloadLength) {
  if (payloadLength != 5) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_TRANSFER_END, PRESET_SYNC_ERROR_BAD_LENGTH);
    return;
  }
  if (!presetSyncWriteTransfer.active) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_TRANSFER_END, PRESET_SYNC_ERROR_UNEXPECTED_CHUNK);
    return;
  }
  uint16_t transferId = presetSyncDecodeU14(payload);
  uint32_t finalChunkCount = presetSyncDecodeU21(payload + 2);
  if (transferId != presetSyncWriteTransfer.transferId
      || finalChunkCount != presetSyncWriteTransfer.expectedChunkIndex
      || presetSyncWriteTransfer.receivedBytes != presetSyncWriteTransfer.rawByteLength) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_TRANSFER_END, PRESET_SYNC_ERROR_UNEXPECTED_CHUNK, presetSyncWriteTransfer.expectedChunkIndex);
    return;
  }
  presetSyncWriteTransfer.ended = true;
  presetSyncSendAck(transactionId, PRESET_SYNC_MSG_TRANSFER_END);
}

void presetSyncHandleWriteCommit(uint16_t transactionId, const uint8_t* payload, size_t payloadLength) {
  if (payloadLength != 12) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_WRITE_COMMIT, PRESET_SYNC_ERROR_BAD_LENGTH);
    return;
  }
  if (!presetSyncWriteTransfer.active || !presetSyncWriteTransfer.ended) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_WRITE_COMMIT, PRESET_SYNC_ERROR_UNEXPECTED_CHUNK);
    return;
  }
  uint16_t transferId = presetSyncDecodeU14(payload);
  uint32_t rawByteLength = presetSyncDecodeU28(payload + 2);
  uint32_t objectCrc32 = presetSyncDecodeU35ToU32(payload + 6);
  uint8_t commitFlags = payload[11];
  if (transferId != presetSyncWriteTransfer.transferId
      || rawByteLength != presetSyncWriteTransfer.rawByteLength
      || objectCrc32 != presetSyncWriteTransfer.objectCrc32) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_WRITE_COMMIT, PRESET_SYNC_ERROR_UNEXPECTED_CHUNK);
    return;
  }
  if (crc32(presetSyncWriteTransfer.rawData.data(), presetSyncWriteTransfer.rawData.size()) != objectCrc32) {
    presetSyncWriteTransfer = PresetSyncWriteTransfer{};
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_WRITE_COMMIT, PRESET_SYNC_ERROR_BAD_CRC);
    return;
  }

  std::string parseError;
  if (presetSyncWriteTransfer.objectType == PRESET_SYNC_OBJECT_TYPE_SYNTH_PRESET) {
    SynthPresetSlot parsedPreset;
    if (!parseSynthPresetObjectBody(presetSyncWriteTransfer.rawData, parsedPreset, parseError)) {
      sendToLog("Preset sync rejected synth preset: " + parseError);
      presetSyncWriteTransfer = PresetSyncWriteTransfer{};
      presetSyncSendNack(transactionId, PRESET_SYNC_MSG_WRITE_COMMIT, PRESET_SYNC_ERROR_VALIDATION_FAILED);
      return;
    }

    if (!(commitFlags & PRESET_SYNC_WRITE_DRY_RUN)) {
      if (commitFlags & PRESET_SYNC_WRITE_APPLY_TO_RUNTIME) {
        applySynthPresetRuntimeOnly(parsedPreset);
      }
      if (commitFlags & PRESET_SYNC_WRITE_SAVE_TO_FLASH) {
        int slotIndex = chooseSynthPresetWriteSlot(presetSyncWriteTransfer.handle, parsedPreset);
        if (slotIndex < 0) {
          presetSyncWriteTransfer = PresetSyncWriteTransfer{};
          presetSyncSendNack(transactionId, PRESET_SYNC_MSG_WRITE_COMMIT, PRESET_SYNC_ERROR_STORAGE_FULL);
          return;
        }
        if (static_cast<size_t>(slotIndex) == synthPresets.size()) {
          synthPresets.push_back(parsedPreset);
        } else {
          synthPresets[slotIndex] = parsedPreset;
        }
        normalizeSynthPresetMetadata(synthPresets[slotIndex], static_cast<uint8_t>(slotIndex));
        flashSafeSaveSynthPresets();
        requestSynthPresetMenuRebuild();
      }
    }
  } else if (presetSyncWriteTransfer.objectType == PRESET_SYNC_OBJECT_TYPE_SYNTH_WAVETABLE) {
    ParsedSynthWavetableObject parsedWavetable;
    if (!parseSynthWavetableObjectBody(presetSyncWriteTransfer.rawData, parsedWavetable, parseError)) {
      sendToLog("Preset sync rejected synth wavetable: " + parseError);
      presetSyncWriteTransfer = PresetSyncWriteTransfer{};
      presetSyncSendNack(transactionId, PRESET_SYNC_MSG_WRITE_COMMIT, PRESET_SYNC_ERROR_VALIDATION_FAILED);
      return;
    }

    if (!(commitFlags & PRESET_SYNC_WRITE_DRY_RUN)) {
      if ((commitFlags & PRESET_SYNC_WRITE_APPLY_TO_RUNTIME) || (commitFlags & PRESET_SYNC_WRITE_SAVE_TO_FLASH)) {
        applyUploadedSynthWavetableSamples(parsedWavetable.samples);
      }
      if (commitFlags & PRESET_SYNC_WRITE_SAVE_TO_FLASH) {
        flashSafeSaveUserSynthWavetable();
      }
    }
  } else {
    presetSyncWriteTransfer = PresetSyncWriteTransfer{};
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_WRITE_COMMIT, PRESET_SYNC_ERROR_BAD_OBJECT_TYPE);
    return;
  }

  presetSyncWriteTransfer = PresetSyncWriteTransfer{};
  presetSyncSendAck(transactionId, PRESET_SYNC_MSG_WRITE_COMMIT);
}

void presetSyncHandleTransferAbort(uint16_t transactionId, const uint8_t* payload, size_t payloadLength) {
  (void)payload;
  if (payloadLength < 2) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_TRANSFER_ABORT, PRESET_SYNC_ERROR_BAD_LENGTH);
    return;
  }
  presetSyncWriteTransfer = PresetSyncWriteTransfer{};
  presetSyncSendAck(transactionId, PRESET_SYNC_MSG_TRANSFER_ABORT);
}

void presetSyncHandleDelete(uint16_t transactionId, const uint8_t* payload, size_t payloadLength) {
  if (payloadLength != 4) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_DELETE_REQ, PRESET_SYNC_ERROR_BAD_LENGTH);
    return;
  }
  if (payload[0] != PRESET_SYNC_OBJECT_TYPE_SYNTH_PRESET) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_DELETE_REQ, PRESET_SYNC_ERROR_BAD_OBJECT_TYPE);
    return;
  }
  uint16_t handle = presetSyncDecodeU14(payload + 1);
  uint8_t deleteFlags = payload[3];
  if (handle >= synthPresets.size() || !synthPresets[handle].valid) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_DELETE_REQ, PRESET_SYNC_ERROR_OBJECT_MISSING);
    return;
  }
  if (!(deleteFlags & 0x01)) {
    synthPresets.erase(synthPresets.begin() + handle);
    flashSafeSaveSynthPresets();
    requestSynthPresetMenuRebuild();
  }
  presetSyncSendAck(transactionId, PRESET_SYNC_MSG_DELETE_REQ);
}

bool processPresetSyncSysEx(const uint8_t* data, const unsigned int len) {
  if (len < 9 || data[0] != 0xF0 || data[len - 1] != 0xF7 || data[1] != 0x7D || data[2] != PRESET_SYNC_FAMILY) {
    return false;
  }
  uint8_t major = data[3];
  uint8_t message = data[5];
  uint16_t transactionId = presetSyncDecodeU14(data + 6);
  const uint8_t* payload = data + 8;
  size_t payloadLength = len - 9;
  notePresetSyncTransferActivity(message);

  if (!presetSyncPayloadIsSevenBit(payload, payloadLength)) {
    presetSyncSendNack(transactionId, message, PRESET_SYNC_ERROR_BAD_LENGTH);
    return true;
  }
  if (major != PRESET_SYNC_MAJOR) {
    presetSyncSendNack(transactionId, message, PRESET_SYNC_ERROR_UNSUPPORTED_PROTOCOL);
    return true;
  }

  switch (message) {
    case PRESET_SYNC_MSG_HELLO_REQ:
      presetSyncHandleHello(transactionId, payload, payloadLength);
      break;
    case PRESET_SYNC_MSG_OBJECT_LIST_REQ:
      presetSyncHandleObjectList(transactionId, payload, payloadLength);
      break;
    case PRESET_SYNC_MSG_READ_REQ:
      presetSyncHandleReadRequest(transactionId, payload, payloadLength);
      break;
    case PRESET_SYNC_MSG_WRITE_BEGIN:
      presetSyncHandleWriteBegin(transactionId, payload, payloadLength);
      break;
    case PRESET_SYNC_MSG_DATA_CHUNK:
      presetSyncHandleDataChunk(transactionId, payload, payloadLength);
      break;
    case PRESET_SYNC_MSG_TRANSFER_END:
      presetSyncHandleTransferEnd(transactionId, payload, payloadLength);
      break;
    case PRESET_SYNC_MSG_WRITE_COMMIT:
      presetSyncHandleWriteCommit(transactionId, payload, payloadLength);
      break;
    case PRESET_SYNC_MSG_TRANSFER_ABORT:
      presetSyncHandleTransferAbort(transactionId, payload, payloadLength);
      break;
    case PRESET_SYNC_MSG_DELETE_REQ:
      presetSyncHandleDelete(transactionId, payload, payloadLength);
      break;
    case PRESET_SYNC_MSG_ACK:
      presetSyncHandleAck(transactionId, payload, payloadLength);
      break;
    case PRESET_SYNC_MSG_NACK:
      presetSyncHandleNack(transactionId, payload, payloadLength);
      break;
    default:
      presetSyncSendNack(transactionId, message, PRESET_SYNC_ERROR_UNKNOWN_MESSAGE);
      break;
  }
  return true;
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
  syncSettingsToRuntime();
  sendToLog("Loaded profile " + std::to_string(profileIndex + 1));
}


#endif  // HEXBOARD_FIRMWARE_UNITY
