#pragma once

#include "../FirmwareModule.h"
#include "../tuning/Tuning.h"

struct SettingsHeader {
  char magic[3];           // e.g., "STG"
  uint8_t version;         // settings file version
  uint8_t defaultProfileIndex;
  uint32_t crc32;          // CRC32 of all profile data bytes
};

constexpr uint8_t CURRENT_SETTINGS_VERSION = 24;
constexpr uint8_t PROFILE_COUNT = 9;
constexpr uint8_t DEFAULT_PROFILE_INDEX = 0;

enum class SettingKey : uint8_t {
  RotaryInvert,  // User reversal relative to the detected hardware direction.
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
  SequencerStepAccentEvery,
  SequencerStepColorMode,
  SequencerStepHue,
  SequencerMonophonicMode,
  SequencerTapPreview,
  SequencerClockSource,
  SequencerSendClock,
  SequencerSendTransport,
  PiezoVolumeCap,
  // This must remain last - it gives the total number of settings.
  NumSettings
};

constexpr uint8_t NUM_SETTINGS = static_cast<uint8_t>(SettingKey::NumSettings);
constexpr size_t SETTINGS_DATA_SIZE = static_cast<size_t>(PROFILE_COUNT) * NUM_SETTINGS;

constexpr uint8_t SYNTH_PRESET_LEGACY_NAMED_COUNT = 20;
constexpr uint8_t SYNTH_PRESET_MAX_COUNT = 128;
constexpr uint8_t SYNTH_PRESET_FILE_VERSION = 10;
constexpr uint8_t SYNTH_PRESET_SCHEMA_VERSION = 7;
constexpr uint8_t SYNTH_WAVETABLE_FILE_VERSION = 1;
constexpr uint8_t SYNTH_WAVETABLE_SCHEMA_VERSION = 1;
constexpr uint8_t SYNTH_WAVETABLE_MAX_COUNT = 32;
constexpr uint8_t GEOMETRY_OBJECT_FILE_VERSION = 2;
constexpr uint8_t GEOMETRY_OBJECT_MAX_COUNT = 64;
constexpr uint8_t GEOMETRY_ASSOCIATED_MAX_COUNT = 24;
constexpr size_t GEOMETRY_MENU_TEXT_LENGTH = 20;
constexpr size_t GEOMETRY_OBJECT_NAME_LENGTH = GEOMETRY_MENU_TEXT_LENGTH;
constexpr size_t GEOMETRY_OBJECT_FOLDER_LENGTH = GEOMETRY_MENU_TEXT_LENGTH;
constexpr size_t GEOMETRY_OBJECT_ID_LENGTH = 16;
constexpr size_t GEOMETRY_OBJECT_MAX_RAW_BYTES = 8192;
constexpr size_t SYNTH_PRESET_NAME_LENGTH = 32;
constexpr size_t SYNTH_PRESET_FOLDER_LENGTH = 48;
constexpr size_t SYNTH_PRESET_MENU_LABEL_LENGTH = 64;
constexpr size_t SYNTH_PRESET_OBJECT_ID_LENGTH = 16;
constexpr const char* SYNTH_PRESET_ROOT_FOLDER = "/";
constexpr size_t SYNTH_WAVETABLE_NAME_LENGTH = 32;
constexpr size_t SYNTH_WAVETABLE_FOLDER_LENGTH = 48;
constexpr size_t SYNTH_WAVETABLE_OBJECT_ID_LENGTH = 16;
constexpr size_t SYNTH_WAVETABLE_SAMPLE_PATH_LENGTH = 48;
constexpr const char* SYNTH_WAVETABLE_ROOT_FOLDER = "/";
constexpr const char* SYNTH_WAVETABLE_BUILTIN_FOLDER = "/Built In";
constexpr const char* SYNTH_WAVETABLE_BASIC_NAME = "Basic Shapes";
constexpr uint8_t CURRENT_SYNTH_WAVETABLE_REFERENCE_VERSION = 1;
constexpr char CURRENT_SYNTH_WAVETABLE_REFERENCE_FILE_PATH[] = "/current_wavetable.dat";
constexpr uint8_t SYNTH_WAVETABLE_PROFILE_REFERENCES_VERSION = 1;
constexpr char SYNTH_WAVETABLE_PROFILE_REFERENCES_FILE_PATH[] = "/profile_wavetables.dat";

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

template <typename Slot, size_t Capacity>
class FixedCatalog {
public:
  using iterator = Slot*;
  using const_iterator = const Slot*;

  void clear() {
    count_ = 0;
  }

  size_t size() const {
    return count_;
  }

  bool empty() const {
    return count_ == 0;
  }

  size_t capacity() const {
    return slots_.size();
  }

  Slot* data() {
    return slots_.data();
  }

  const Slot* data() const {
    return slots_.data();
  }

  Slot& operator[](size_t index) {
    return slots_[index];
  }

  const Slot& operator[](size_t index) const {
    return slots_[index];
  }

  iterator begin() {
    return slots_.data();
  }

  iterator end() {
    return slots_.data() + count_;
  }

  const_iterator begin() const {
    return slots_.data();
  }

  const_iterator end() const {
    return slots_.data() + count_;
  }

  bool push_back(const Slot& preset) {
    if (count_ >= slots_.size()) {
      return false;
    }
    slots_[count_] = preset;
    ++count_;
    return true;
  }

  void resize(size_t newSize) {
    count_ = std::min(newSize, slots_.size());
  }

  iterator erase(iterator position) {
    if (position < begin() || position >= end()) {
      return end();
    }
    size_t index = static_cast<size_t>(position - begin());
    eraseAt(index);
    return begin() + index;
  }

  void eraseAt(size_t index) {
    if (index >= count_) {
      return;
    }
    for (size_t i = index; i + 1 < count_; ++i) {
      slots_[i] = slots_[i + 1];
    }
    --count_;
  }

private:
  std::array<Slot, Capacity> slots_ = {};
  size_t count_ = 0;
};

struct SynthPresetIndexEntry {
  uint8_t valid = 0;
  uint8_t favorite = 0;
  uint8_t objectId[SYNTH_PRESET_OBJECT_ID_LENGTH] = {};
  char name[SYNTH_PRESET_NAME_LENGTH] = {};
  char folderPath[SYNTH_PRESET_FOLDER_LENGTH] = {};
};

using SynthPresetCatalog = FixedCatalog<SynthPresetIndexEntry, SYNTH_PRESET_MAX_COUNT>;

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

struct SynthWavetableProfileReference {
  char name[SYNTH_WAVETABLE_NAME_LENGTH] = {};
  char folderPath[SYNTH_WAVETABLE_FOLDER_LENGTH] = {};
};

struct SynthWavetableProfileReferenceFile {
  char magic[3];     // "PWT"
  uint8_t version;
  SynthWavetableProfileReference profiles[PROFILE_COUNT] = {};
  uint32_t crc32;
};

// The host-side factory-library compiler writes these records byte-for-byte.
// Fail the firmware build if the RP2040 ABI ever changes their disk layout.
static_assert(sizeof(SettingsHeader) == 12, "SettingsHeader disk layout changed");
static_assert(sizeof(SynthPresetFileHeader) == 12, "SynthPresetFileHeader disk layout changed");
static_assert(sizeof(SynthPresetSlot) == 212, "SynthPresetSlot disk layout changed");
static_assert(sizeof(SynthWavetableFileHeader) == 12, "SynthWavetableFileHeader disk layout changed");
static_assert(sizeof(SynthWavetableSlot) == 145, "SynthWavetableSlot disk layout changed");
static_assert(sizeof(CurrentSynthWavetableReferenceFile) == 88,
              "CurrentSynthWavetableReferenceFile disk layout changed");
static_assert(sizeof(SynthWavetableProfileReferenceFile) == 728,
              "SynthWavetableProfileReferenceFile disk layout changed");

struct GeometryObjectFileHeader {
  char magic[3];     // "LYT"
  uint8_t version;
  uint16_t count;
  uint16_t reserved;
  uint32_t crc32;
};
static_assert(sizeof(GeometryObjectFileHeader) == 12,
              "GeometryObjectFileHeader disk layout changed");

struct GeometryObjectSlot {
  uint8_t valid = 0;
  uint8_t objectType = 0;
  uint8_t schemaMajor = 1;
  uint8_t schemaMinor = 0;
  uint8_t objectId[GEOMETRY_OBJECT_ID_LENGTH] = {};
  char name[GEOMETRY_OBJECT_NAME_LENGTH] = {};
  char folderPath[GEOMETRY_OBJECT_FOLDER_LENGTH] = {};
  std::vector<uint8_t> body;
};

struct GeometryObjectIndexEntry {
  uint8_t valid = 0;
  uint8_t objectType = 0;
  uint8_t schemaMajor = 1;
  uint8_t schemaMinor = 0;
  uint8_t objectId[GEOMETRY_OBJECT_ID_LENGTH] = {};
  char name[GEOMETRY_OBJECT_NAME_LENGTH] = {};
  char folderPath[GEOMETRY_OBJECT_FOLDER_LENGTH] = {};
  uint32_t storageOffset = 0;
  uint32_t bodyLength = 0;
};

using SynthWavetableCatalog = FixedCatalog<SynthWavetableSlot, SYNTH_WAVETABLE_MAX_COUNT>;
using GeometryObjectCatalog = FixedCatalog<GeometryObjectIndexEntry, GEOMETRY_OBJECT_MAX_COUNT>;

extern uint8_t settingsProfiles[PROFILE_COUNT][NUM_SETTINGS];
extern uint8_t* settings;
extern uint8_t activeProfileIndex;
extern uint8_t defaultProfileIndex;
extern SynthPresetCatalog synthPresets;
extern SynthWavetableCatalog synthWavetables;
extern GeometryObjectCatalog geometryObjects;

uint32_t crc32Begin();
uint32_t crc32Update(uint32_t crc, const uint8_t* data, size_t length);
uint32_t crc32Finish(uint32_t crc);
uint32_t crc32(const uint8_t* data, size_t length);

inline uint8_t settingValue(SettingKey key) {
  return settings[static_cast<uint8_t>(key)];
}

inline bool settingEnabled(SettingKey key) {
  return settingValue(key) != 0;
}

inline int decodeBiasedSetting(SettingKey key) {
  return static_cast<int>(settingValue(key)) - 128;
}
