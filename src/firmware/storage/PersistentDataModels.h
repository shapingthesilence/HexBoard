#pragma once

#include "../FirmwareModule.h"
#include "../tuning/Tuning.h"

struct SettingsHeader {
  char magic[3];           // e.g., "STG"
  uint8_t version;         // settings file version
  uint8_t defaultProfileIndex;
  uint32_t crc32;          // CRC32 of all profile data bytes
};

constexpr uint8_t CURRENT_SETTINGS_VERSION = 27;
constexpr uint8_t PROFILE_COUNT = 9;
constexpr uint8_t DEFAULT_PROFILE_INDEX = 0;

enum class SettingKey : uint8_t {
#define HEXBOARD_SETTING(name, defaultValue) name,
#include "SettingKeys.inc.h"
#undef HEXBOARD_SETTING
  NumSettings
};

constexpr uint8_t NUM_SETTINGS = static_cast<uint8_t>(SettingKey::NumSettings);
constexpr size_t SETTINGS_VALUES_DATA_SIZE = static_cast<size_t>(PROFILE_COUNT) * NUM_SETTINGS;

constexpr uint8_t SYNTH_PRESET_MAX_COUNT = 128;
constexpr uint8_t SYNTH_PRESET_FILE_VERSION = 11;
constexpr uint8_t SYNTH_PRESET_SCHEMA_VERSION = 7;
constexpr uint8_t SYNTH_WAVETABLE_FILE_VERSION = 1;
constexpr uint8_t SYNTH_WAVETABLE_SCHEMA_VERSION = 1;
constexpr uint8_t SYNTH_WAVETABLE_MAX_COUNT = 32;
constexpr uint8_t GEOMETRY_OBJECT_FILE_VERSION = 3;
constexpr uint8_t GEOMETRY_OBJECT_SCHEMA_VERSION = 2;
constexpr uint16_t GEOMETRY_CATALOG_ORDER_UNSORTED = 0xFFFFu;
constexpr uint8_t GEOMETRY_ORDER_FILE_VERSION = 1;
constexpr char GEOMETRY_ORDER_FILE_PATH[] = "/geometry_order.dat";
constexpr char GEOMETRY_ORDER_TEMP_FILE_PATH[] = "/geometry_order.tmp";
// Geometry bundles are stored as linked tuning/layout/scale/color/map records.
// The public limit counts tuning roots (complete bundles), while this internal
// sanity ceiling only bounds malformed files. Only tuning menu metadata and
// the active tuning's layout/scale labels are retained; object bodies stream
// from LittleFS on demand.
constexpr uint8_t GEOMETRY_BUNDLE_MAX_COUNT = 64;
constexpr uint16_t GEOMETRY_BUNDLE_RECORD_MAX_COUNT = 255;
constexpr uint16_t GEOMETRY_OBJECT_MAX_COUNT =
  GEOMETRY_BUNDLE_MAX_COUNT * GEOMETRY_BUNDLE_RECORD_MAX_COUNT;
constexpr uint8_t GEOMETRY_LAYOUT_SCALE_MAX_COUNT = 32;
constexpr size_t GEOMETRY_MENU_TEXT_LENGTH = 20;
constexpr size_t GEOMETRY_OBJECT_NAME_LENGTH = GEOMETRY_MENU_TEXT_LENGTH;
constexpr size_t GEOMETRY_OBJECT_FOLDER_LENGTH = GEOMETRY_MENU_TEXT_LENGTH;
constexpr size_t GEOMETRY_OBJECT_ID_LENGTH = 16;
constexpr size_t GEOMETRY_OBJECT_MAX_RAW_BYTES = 16384;
constexpr size_t GEOMETRY_BUNDLE_MAX_RAW_BYTES = 262144;
constexpr size_t GEOMETRY_STORAGE_PATH_LENGTH = 64;
constexpr char GEOMETRY_STORAGE_ROOT[] = "/geometry";
constexpr char GEOMETRY_BUNDLE_FILE_EXTENSION[] = ".hgb";
constexpr char DEFAULT_GEOMETRY_REFERENCE_FILE_PATH[] = "/default_geometry.dat";
constexpr uint8_t DEFAULT_GEOMETRY_REFERENCE_VERSION = 1;
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
  char magic[3];     // "HSP"
  uint8_t version;
  uint32_t crc32;
};

struct DefaultGeometryReferenceFile {
  char magic[3];
  uint8_t version;
  uint8_t tuningObjectId[GEOMETRY_OBJECT_ID_LENGTH];
  uint32_t crc32;
};
static_assert(sizeof(DefaultGeometryReferenceFile) == 24,
              "DefaultGeometryReferenceFile disk layout changed");

enum GeometryProfileReferenceFlags : uint8_t {
  GEOMETRY_PROFILE_HAS_TUNING = 1u << 0,
  GEOMETRY_PROFILE_HAS_LAYOUT = 1u << 1,
  GEOMETRY_PROFILE_HAS_SCALE = 1u << 2
};

struct GeometryProfileReference {
  uint8_t flags = 0;
  uint8_t tuningObjectId[GEOMETRY_OBJECT_ID_LENGTH] = {};
  uint8_t layoutObjectId[GEOMETRY_OBJECT_ID_LENGTH] = {};
  uint8_t scaleObjectId[GEOMETRY_OBJECT_ID_LENGTH] = {};
};

static_assert(sizeof(GeometryProfileReference) == 49,
              "GeometryProfileReference disk layout changed");

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

struct SynthWavetableProfileReference {
  char name[SYNTH_WAVETABLE_NAME_LENGTH] = {};
  char folderPath[SYNTH_WAVETABLE_FOLDER_LENGTH] = {};
};

constexpr size_t SETTINGS_GEOMETRY_DATA_SIZE =
  sizeof(GeometryProfileReference) * PROFILE_COUNT;
constexpr size_t SETTINGS_WAVETABLE_DATA_SIZE =
  sizeof(SynthWavetableProfileReference) * PROFILE_COUNT;
constexpr size_t SETTINGS_DATA_SIZE =
  SETTINGS_VALUES_DATA_SIZE
  + SETTINGS_GEOMETRY_DATA_SIZE
  + SETTINGS_WAVETABLE_DATA_SIZE;

// The host-side factory-library compiler writes these records byte-for-byte.
// Fail the firmware build if the RP2040 ABI ever changes their disk layout.
static_assert(sizeof(SettingsHeader) == 12, "SettingsHeader disk layout changed");
static_assert(SETTINGS_VALUES_DATA_SIZE == 810,
              "Settings value payload changed; update the factory-library builder");
static_assert(SETTINGS_DATA_SIZE == 1971,
              "Settings payload changed; update the factory-library builder");
static_assert(sizeof(SynthPresetFileHeaderBase) == 8, "SynthPresetFileHeaderBase disk layout changed");
static_assert(sizeof(SynthPresetSlot) == 212, "SynthPresetSlot disk layout changed");
static_assert(sizeof(SynthWavetableFileHeader) == 12, "SynthWavetableFileHeader disk layout changed");
static_assert(sizeof(SynthWavetableSlot) == 145, "SynthWavetableSlot disk layout changed");

struct GeometryObjectFileHeader {
  char magic[3];     // "HGB"
  uint8_t version;
  uint16_t count;
  uint16_t catalogOrder;
  uint32_t crc32;
};
static_assert(sizeof(GeometryObjectFileHeader) == 12,
              "GeometryObjectFileHeader disk layout changed");

struct GeometryOrderFileHeader {
  char magic[3];     // "HGO"
  uint8_t version;
  uint8_t count;
  uint8_t reserved[3];
  uint32_t crc32;
};
static_assert(sizeof(GeometryOrderFileHeader) == 12,
              "GeometryOrderFileHeader disk layout changed");

struct GeometryObjectSlot {
  uint8_t valid = 0;
  uint8_t objectType = 0;
  uint8_t schemaMajor = GEOMETRY_OBJECT_SCHEMA_VERSION;
  uint8_t schemaMinor = 0;
  uint8_t objectId[GEOMETRY_OBJECT_ID_LENGTH] = {};
  char name[GEOMETRY_OBJECT_NAME_LENGTH] = {};
  char folderPath[GEOMETRY_OBJECT_FOLDER_LENGTH] = {};
  std::vector<uint8_t> body;
};

struct GeometryObjectIndexEntry {
  uint8_t valid = 0;
  uint8_t objectType = 0;
  uint8_t schemaMajor = GEOMETRY_OBJECT_SCHEMA_VERSION;
  uint8_t schemaMinor = 0;
  uint8_t objectId[GEOMETRY_OBJECT_ID_LENGTH] = {};
  char name[GEOMETRY_OBJECT_NAME_LENGTH] = {};
  char folderPath[GEOMETRY_OBJECT_FOLDER_LENGTH] = {};
  uint32_t recordOffset = 0;
  uint32_t recordLength = 0;
  uint32_t storageOffset = 0;
  uint32_t bodyLength = 0;
  char storagePath[GEOMETRY_STORAGE_PATH_LENGTH] = {};
};

struct GeometryBundleIndexEntry {
  uint8_t tuningObjectId[GEOMETRY_OBJECT_ID_LENGTH] = {};
  char tuningName[GEOMETRY_OBJECT_NAME_LENGTH] = {};
  char folderPath[GEOMETRY_OBJECT_FOLDER_LENGTH] = {};
  uint16_t firstHandle = 0;
  uint16_t recordCount = 0;
  uint16_t catalogOrder = GEOMETRY_CATALOG_ORDER_UNSORTED;
};

using GeometryBundleCatalog = FixedCatalog<GeometryBundleIndexEntry, GEOMETRY_BUNDLE_MAX_COUNT>;

struct GeometryCatalogReader {
  File file;
  uint16_t nextHandle = 0;
  uint16_t count = 0;
  uint16_t bundleRecordsRemaining = 0;
  uint8_t nextBundleIndex = 0;
  char storagePath[GEOMETRY_STORAGE_PATH_LENGTH] = {};
};

using SynthWavetableCatalog = FixedCatalog<SynthWavetableSlot, SYNTH_WAVETABLE_MAX_COUNT>;

extern uint8_t settingsProfiles[PROFILE_COUNT][NUM_SETTINGS];
extern GeometryProfileReference geometryProfileReferences[PROFILE_COUNT];
extern SynthWavetableProfileReference synthWavetableProfileReferences[PROFILE_COUNT];
extern uint8_t* settings;
extern uint8_t activeProfileIndex;
extern uint8_t defaultProfileIndex;
extern SynthPresetCatalog synthPresets;
extern SynthWavetableCatalog synthWavetables;
extern GeometryBundleCatalog geometryBundles;
extern uint16_t geometryCatalogObjectCount;

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
