#include "../FirmwareModule.h"
#include "../app/DiagnosticsTiming.h"
#include "../app/RuntimeDefaults.h"
#include "../menu/MenuAndDisplay.h"
#include "../synth/SynthAudio.h"
#include "../synth/SynthDefaults.h"
#include "Settings.h"
#include "SynthPresetStorage.h"
#include "SynthWavetableStorage.h"

namespace {
constexpr uint16_t CURRENT_SYNTH_PRESET_NONE = 0xFFFFu;
constexpr char SYNTH_PRESET_CATALOG_FILE_PATH[] = "/synth_presets.dat";
constexpr char CURRENT_SYNTH_PRESET_REFERENCE_FILE_PATH[] = "/current_synth_preset.dat";
constexpr uint8_t CURRENT_SYNTH_PRESET_REFERENCE_VERSION = 1;
constexpr uint8_t CURRENT_SYNTH_PRESET_REFERENCE_LOADED_FLAG = 0x01;
constexpr uint8_t CURRENT_SYNTH_PRESET_REFERENCE_BLANK_FLAG = 0x02;

struct CurrentSynthPresetReferenceFile {
  char magic[3];
  uint8_t version;
  uint8_t flags;
  uint8_t reserved[3];
  uint8_t objectId[SYNTH_PRESET_OBJECT_ID_LENGTH];
  uint32_t crc32;
};
static_assert(sizeof(CurrentSynthPresetReferenceFile) == 28,
              "CurrentSynthPresetReferenceFile disk layout changed");

uint16_t currentSynthPresetIndex = CURRENT_SYNTH_PRESET_NONE;
uint8_t currentSynthPresetObjectId[SYNTH_PRESET_OBJECT_ID_LENGTH] = {};
char currentSynthPresetName[SYNTH_PRESET_NAME_LENGTH] = "Current";
bool currentSynthPresetIsBlank = false;
SynthPresetSlot currentSynthPresetLoadedSlot = {};
bool currentSynthPresetLoadedSlotValid = false;
SynthPresetSlot pendingSynthPresetSaveSlot = {};
bool pendingSynthPresetSaveSlotValid = false;

bool writeSynthPresetRecordsDirect(const SynthPresetSlot* presets, size_t presetCount, bool logResult);

bool objectIdIsEmpty(const uint8_t* objectId, size_t objectIdLength) {
  for (size_t i = 0; i < objectIdLength; ++i) {
    if (objectId[i] != 0) {
      return false;
    }
  }
  return true;
}

void clearCurrentSynthPresetObjectId() {
  memset(currentSynthPresetObjectId, 0, sizeof(currentSynthPresetObjectId));
}

uint32_t currentSynthPresetReferenceCrc(const CurrentSynthPresetReferenceFile& reference) {
  uint8_t bytes[1 + sizeof(reference.objectId)] = {};
  bytes[0] = reference.flags;
  memcpy(bytes + 1, reference.objectId, sizeof(reference.objectId));
  return crc32(bytes, sizeof(bytes));
}

template <typename Record>
bool persistedRecordMatches(const char* path, const Record& record) {
  File f = LittleFS.open(path, "r");
  if (!f) {
    return false;
  }

  Record existing = {};
  size_t bytesRead = f.read(reinterpret_cast<uint8_t*>(&existing), sizeof(existing));
  bool matches = bytesRead == sizeof(existing)
                 && f.available() == 0
                 && memcmp(&existing, &record, sizeof(record)) == 0;
  f.close();
  return matches;
}

const SynthPresetIndexEntry* trackedCurrentSynthPresetEntry() {
  if (objectIdIsEmpty(currentSynthPresetObjectId, sizeof(currentSynthPresetObjectId))) {
    return nullptr;
  }
  if (currentSynthPresetIndex < synthPresets.size()
      && synthPresets[currentSynthPresetIndex].valid
      && memcmp(synthPresets[currentSynthPresetIndex].objectId,
                currentSynthPresetObjectId,
                sizeof(currentSynthPresetObjectId)) == 0) {
    return &synthPresets[currentSynthPresetIndex];
  }
  for (size_t i = 0; i < synthPresets.size(); ++i) {
    if (synthPresets[i].valid
        && memcmp(synthPresets[i].objectId, currentSynthPresetObjectId, sizeof(currentSynthPresetObjectId)) == 0) {
      currentSynthPresetIndex = static_cast<uint16_t>(i);
      return &synthPresets[i];
    }
  }
  currentSynthPresetIndex = CURRENT_SYNTH_PRESET_NONE;
  clearCurrentSynthPresetObjectId();
  snprintf(currentSynthPresetName, sizeof(currentSynthPresetName), "Current");
  currentSynthPresetIsBlank = false;
  currentSynthPresetLoadedSlotValid = false;
  return nullptr;
}

void trackCurrentSynthPresetSlot(uint16_t presetIndex, const SynthPresetSlot* loadedPreset = nullptr) {
  if (presetIndex >= synthPresets.size() || !synthPresets[presetIndex].valid) {
    currentSynthPresetIndex = CURRENT_SYNTH_PRESET_NONE;
    clearCurrentSynthPresetObjectId();
    snprintf(currentSynthPresetName, sizeof(currentSynthPresetName), "Current");
    currentSynthPresetIsBlank = false;
    currentSynthPresetLoadedSlotValid = false;
    return;
  }
  currentSynthPresetIndex = presetIndex;
  memcpy(currentSynthPresetObjectId, synthPresets[presetIndex].objectId, sizeof(currentSynthPresetObjectId));
  snprintf(currentSynthPresetName, sizeof(currentSynthPresetName), "%s", synthPresets[presetIndex].name);
  currentSynthPresetIsBlank = false;
  if (loadedPreset) {
    currentSynthPresetLoadedSlot = *loadedPreset;
    currentSynthPresetLoadedSlotValid = true;
  } else {
    currentSynthPresetLoadedSlotValid = readSynthPresetFromCatalog(presetIndex, currentSynthPresetLoadedSlot);
  }
}

void trackBlankSynthPreset() {
  currentSynthPresetIndex = CURRENT_SYNTH_PRESET_NONE;
  clearCurrentSynthPresetObjectId();
  snprintf(currentSynthPresetName, sizeof(currentSynthPresetName), "Blank");
  currentSynthPresetIsBlank = true;
  currentSynthPresetLoadedSlotValid = false;
}

bool trackCurrentSynthPresetObjectId(const uint8_t* objectId) {
  if (!objectId || objectIdIsEmpty(objectId, SYNTH_PRESET_OBJECT_ID_LENGTH)) {
    return false;
  }
  for (size_t i = 0; i < synthPresets.size(); ++i) {
    if (!synthPresets[i].valid
        || memcmp(synthPresets[i].objectId, objectId, SYNTH_PRESET_OBJECT_ID_LENGTH) != 0) {
      continue;
    }
    SynthPresetSlot preset = {};
    if (readSynthPresetFromCatalog(static_cast<uint16_t>(i), preset)) {
      trackCurrentSynthPresetSlot(static_cast<uint16_t>(i), &preset);
    } else {
      trackCurrentSynthPresetSlot(static_cast<uint16_t>(i));
    }
    return true;
  }
  return false;
}

bool appendSynthPresetMetadataFromSlot(const SynthPresetSlot& preset) {
  SynthPresetIndexEntry metadata = {};
  copySynthPresetMetadata(metadata, preset);
  return synthPresets.push_back(metadata);
}

}  // namespace

void applyDefaultSynthPresets() {
  synthPresets.clear();
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

int synthPresetValueIndexForKey(SettingKey key) {
  for (size_t i = 0; i < synthPresetKeys.size(); ++i) {
    if (synthPresetKeys[i] == key) {
      return static_cast<int>(i);
    }
  }
  return -1;
}

uint8_t synthPresetValueForKey(const SynthPresetSlot& preset, SettingKey key, uint8_t fallback) {
  int index = synthPresetValueIndexForKey(key);
  return index >= 0 ? preset.values[index] : fallback;
}

void setSynthPresetValueForKey(SynthPresetSlot& preset, SettingKey key, uint8_t value) {
  int index = synthPresetValueIndexForKey(key);
  if (index >= 0) {
    preset.values[index] = value;
  }
}

void normalizeSynthWavetableFolderPath(char* folderPath, size_t folderPathLength) {
  normalizeSynthPresetFolderPath(folderPath, folderPathLength);
}

void normalizeSynthWavetableBuiltInFolderAlias(char* folderPath, size_t folderPathLength) {
  if (folderPathLength == 0) {
    return;
  }
  if (strcmp(folderPath, "Built In") == 0
      || strcmp(folderPath, "%2FBuilt In") == 0
      || strcmp(folderPath, "%2fBuilt In") == 0) {
    snprintf(folderPath, folderPathLength, "%s", SYNTH_WAVETABLE_BUILTIN_FOLDER);
  }
}

void normalizeSynthPresetWavetableReference(SynthPresetSlot& preset) {
  preset.wavetableName[sizeof(preset.wavetableName) - 1] = '\0';
  preset.wavetableFolderPath[sizeof(preset.wavetableFolderPath) - 1] = '\0';
  if (!preset.wavetableName[0]) {
    byte waveform = synthPresetValueForKey(preset, SettingKey::Waveform, WAVEFORM_BASIC_WAVETABLE);
    const char* folderPath = SYNTH_WAVETABLE_BUILTIN_FOLDER;
    const char* name = SYNTH_WAVETABLE_BASIC_NAME;
    uint8_t position = synthPresetValueForKey(preset,
                                              SettingKey::SynthWavetablePosition,
                                              SYNTH_WAVETABLE_POSITION_DEFAULT);
    legacyWaveformCompatibilityReference(waveform, folderPath, name, position);
    snprintf(preset.wavetableFolderPath, sizeof(preset.wavetableFolderPath), "%s", folderPath);
    snprintf(preset.wavetableName, sizeof(preset.wavetableName), "%s", name);
    setSynthPresetValueForKey(preset, SettingKey::SynthWavetablePosition, position);
  }
  if (!preset.wavetableFolderPath[0]) {
    snprintf(preset.wavetableFolderPath, sizeof(preset.wavetableFolderPath), "%s", SYNTH_WAVETABLE_BUILTIN_FOLDER);
  }
  normalizeSynthWavetableFolderPath(preset.wavetableFolderPath, sizeof(preset.wavetableFolderPath));
  normalizeSynthWavetableBuiltInFolderAlias(preset.wavetableFolderPath, sizeof(preset.wavetableFolderPath));
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
  normalizeSynthPresetWavetableReference(preset);
  if (synthPresetObjectIdIsEmpty(preset)) {
    generateSynthPresetObjectId(preset, fallbackIndex);
  }
}

void copySynthPresetMetadata(SynthPresetIndexEntry& metadata, const SynthPresetSlot& preset) {
  metadata.valid = preset.valid;
  metadata.favorite = preset.favorite;
  memcpy(metadata.objectId, preset.objectId, sizeof(metadata.objectId));
  snprintf(metadata.name, sizeof(metadata.name), "%s", preset.name);
  snprintf(metadata.folderPath, sizeof(metadata.folderPath), "%s", preset.folderPath);
}

void normalizeSynthPresetValues(SynthPresetSlot& preset) {
  for (size_t i = 0; i < synthPresetKeys.size(); ++i) {
    if (synthPresetKeys[i] == SettingKey::PlaybackMode) {
      preset.values[i] = normalizeSynthPlaybackMode(preset.values[i]);
      return;
    }
  }
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

bool currentRuntimeMatchesSynthPresetValues(const SynthPresetSlot& preset) {
  for (size_t i = 0; i < synthPresetKeys.size(); ++i) {
    uint8_t currentValue = currentSynthPresetValue(synthPresetKeys[i]);
    uint8_t presetValue = preset.values[i];
    if (synthPresetKeys[i] == SettingKey::PlaybackMode) {
      currentValue = normalizeSynthPlaybackMode(currentValue);
      presetValue = normalizeSynthPlaybackMode(presetValue);
    }
    if (currentValue != presetValue) {
      return false;
    }
  }
  return strncmp(currentSynthWavetableName, preset.wavetableName, sizeof(preset.wavetableName)) == 0
         && strncmp(currentSynthWavetableFolderPath,
                    preset.wavetableFolderPath,
                    sizeof(preset.wavetableFolderPath)) == 0;
}

bool currentRuntimeMatchesBlankSynthPreset() {
  for (SettingKey key : synthPresetKeys) {
    uint8_t currentValue = currentSynthPresetValue(key);
    uint8_t defaultValue = factoryDefaults[static_cast<uint8_t>(key)];
    if (key == SettingKey::PlaybackMode) {
      currentValue = normalizeSynthPlaybackMode(currentValue);
      defaultValue = normalizeSynthPlaybackMode(defaultValue);
    }
    if (currentValue != defaultValue) {
      return false;
    }
  }
  return strcmp(currentSynthWavetableName, SYNTH_WAVETABLE_BASIC_NAME) == 0
         && strcmp(currentSynthWavetableFolderPath, SYNTH_WAVETABLE_BUILTIN_FOLDER) == 0;
}

const char* currentSynthPresetDisplayName() {
  if (!currentSynthPresetIsBlank) {
    trackedCurrentSynthPresetEntry();
  }
  return currentSynthPresetName[0] ? currentSynthPresetName : "Current";
}

bool currentSynthPresetRuntimeModified() {
  if (currentSynthPresetIsBlank) {
    return !currentRuntimeMatchesBlankSynthPreset();
  }
  const SynthPresetIndexEntry* metadata = trackedCurrentSynthPresetEntry();
  if (!metadata) {
    return false;
  }
  if (!currentSynthPresetLoadedSlotValid
      || memcmp(currentSynthPresetLoadedSlot.objectId,
                metadata->objectId,
                sizeof(currentSynthPresetLoadedSlot.objectId)) != 0) {
    currentSynthPresetLoadedSlotValid =
      readSynthPresetFromCatalog(currentSynthPresetIndex, currentSynthPresetLoadedSlot);
  }
  return currentSynthPresetLoadedSlotValid
    ? !currentRuntimeMatchesSynthPresetValues(currentSynthPresetLoadedSlot)
    : false;
}

bool currentSynthPresetCatalogIndex(uint16_t& presetIndex) {
  if (currentSynthPresetIsBlank) {
    return false;
  }
  const SynthPresetIndexEntry* metadata = trackedCurrentSynthPresetEntry();
  if (!metadata || currentSynthPresetIndex >= synthPresets.size()) {
    return false;
  }
  presetIndex = currentSynthPresetIndex;
  return true;
}

void captureCurrentSynthPreset(SynthPresetSlot& preset) {
  preset.valid = 1;
  for (size_t i = 0; i < synthPresetKeys.size(); ++i) {
    preset.values[i] = currentSynthPresetValue(synthPresetKeys[i]);
  }
  snprintf(preset.wavetableName, sizeof(preset.wavetableName), "%s", currentSynthWavetableName);
  snprintf(preset.wavetableFolderPath, sizeof(preset.wavetableFolderPath), "%s", currentSynthWavetableFolderPath);
  normalizeSynthPresetWavetableReference(preset);
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
  for (const char* p = preset.wavetableFolderPath; *p; ++p) {
    mixByte(static_cast<uint8_t>(*p));
  }
  mixByte(':');
  for (const char* p = preset.wavetableName; *p; ++p) {
    mixByte(static_cast<uint8_t>(*p));
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
  selectFallbackSynthWavetable();
}

void loadBlankSynthPreset() {
  applyBlankSynthPresetToSettings();
  markSettingsDirty();
  trackBlankSynthPreset();
  syncSynthSettingsToRuntime();
  flashSafeSaveCurrentSynthReferences();
  sendToLog("Loaded blank synth preset.");
}

void compactSynthPresets() {
  size_t writeIndex = 0;
  for (size_t readIndex = 0; readIndex < synthPresets.size(); ++readIndex) {
    if (!synthPresets[readIndex].valid) {
      continue;
    }
    if (writeIndex != readIndex) {
      synthPresets[writeIndex] = synthPresets[readIndex];
    }
    if (!synthPresets[writeIndex].name[0]) {
      snprintf(synthPresets[writeIndex].name,
               sizeof(synthPresets[writeIndex].name),
               "Preset %u",
               static_cast<unsigned>(writeIndex + 1));
    }
    if (!synthPresets[writeIndex].folderPath[0]) {
      snprintf(synthPresets[writeIndex].folderPath,
               sizeof(synthPresets[writeIndex].folderPath),
               "%s",
               SYNTH_PRESET_ROOT_FOLDER);
    }
    synthPresets[writeIndex].name[sizeof(synthPresets[writeIndex].name) - 1] = '\0';
    synthPresets[writeIndex].folderPath[sizeof(synthPresets[writeIndex].folderPath) - 1] = '\0';
    normalizeSynthPresetFolderPath(synthPresets[writeIndex].folderPath,
                                   sizeof(synthPresets[writeIndex].folderPath));
    ++writeIndex;
  }
  synthPresets.resize(writeIndex);
}

namespace {
constexpr char SYNTH_PRESET_CATALOG_TEMP_FILE_PATH[] = "/synth_presets.tmp";

void copySynthPresetMetadataToSlot(const SynthPresetIndexEntry& metadata, SynthPresetSlot& preset) {
  preset.valid = metadata.valid;
  preset.favorite = metadata.favorite;
  memcpy(preset.objectId, metadata.objectId, sizeof(preset.objectId));
  snprintf(preset.name, sizeof(preset.name), "%s", metadata.name);
  snprintf(preset.folderPath, sizeof(preset.folderPath), "%s", metadata.folderPath);
}

bool synthPresetMetadataMatchesSlot(const SynthPresetIndexEntry& metadata, const SynthPresetSlot& preset) {
  return metadata.valid
         && preset.valid
         && memcmp(metadata.objectId, preset.objectId, sizeof(metadata.objectId)) == 0;
}

bool synthPresetHeaderBaseValid(const SynthPresetFileHeaderBase& header) {
  return strncmp(header.magic, "SYP", 3) == 0
         && header.version > 0
         && header.version <= SYNTH_PRESET_FILE_VERSION;
}

bool readSynthPresetFileHeaderBase(File& f, SynthPresetFileHeaderBase& header) {
  return f.read(reinterpret_cast<uint8_t*>(&header), sizeof(header)) == sizeof(header)
         && synthPresetHeaderBaseValid(header);
}

bool readSynthPresetFileHeader(File& f, SynthPresetFileHeader& header) {
  if (!readSynthPresetFileHeaderBase(f, header.base)) {
    return false;
  }
  return header.base.version == SYNTH_PRESET_FILE_VERSION
         && f.read(reinterpret_cast<uint8_t*>(&header.count), sizeof(header.count)) == sizeof(header.count)
         && f.read(reinterpret_cast<uint8_t*>(&header.reserved), sizeof(header.reserved)) == sizeof(header.reserved)
         && header.count <= SYNTH_PRESET_MAX_COUNT;
}

bool readSynthPresetRecordAt(uint16_t presetIndex, SynthPresetSlot& preset) {
  if (!fileSystemExists) {
    return false;
  }
  File f = LittleFS.open(SYNTH_PRESET_CATALOG_FILE_PATH, "r");
  if (!f) {
    return false;
  }
  SynthPresetFileHeader header = {};
  if (!readSynthPresetFileHeader(f, header) || presetIndex >= header.count) {
    f.close();
    return false;
  }
  uint32_t offset = sizeof(header) + static_cast<uint32_t>(presetIndex) * sizeof(SynthPresetSlot);
  if (!f.seek(offset)) {
    f.close();
    return false;
  }
  size_t bytesRead = f.read(reinterpret_cast<uint8_t*>(&preset), sizeof(preset));
  f.close();
  if (bytesRead != sizeof(preset) || !preset.valid) {
    return false;
  }
  normalizeSynthPresetValues(preset);
  normalizeSynthPresetMetadata(preset, static_cast<uint8_t>(presetIndex));
  return true;
}

bool readSynthPresetRecordByObjectId(const uint8_t* objectId, SynthPresetSlot& preset) {
  if (!objectId) {
    return false;
  }
  if (!fileSystemExists) {
    return false;
  }
  File f = LittleFS.open(SYNTH_PRESET_CATALOG_FILE_PATH, "r");
  if (!f) {
    return false;
  }
  SynthPresetFileHeader header = {};
  if (!readSynthPresetFileHeader(f, header)) {
    f.close();
    return false;
  }
  for (uint16_t i = 0; i < header.count; ++i) {
    if (f.read(reinterpret_cast<uint8_t*>(&preset), sizeof(preset)) != sizeof(preset)) {
      f.close();
      return false;
    }
    if (preset.valid && memcmp(preset.objectId, objectId, sizeof(preset.objectId)) == 0) {
      f.close();
      normalizeSynthPresetValues(preset);
      normalizeSynthPresetMetadata(preset, static_cast<uint8_t>(i));
      return true;
    }
  }
  f.close();
  return false;
}

void synthPresetFallbackRecordFromMetadata(const SynthPresetIndexEntry& metadata,
                                           uint8_t fallbackIndex,
                                           SynthPresetSlot& preset) {
  preset = {};
  copySynthPresetMetadataToSlot(metadata, preset);
  for (size_t i = 0; i < synthPresetKeys.size(); ++i) {
    preset.values[i] = factoryDefaults[static_cast<uint8_t>(synthPresetKeys[i])];
  }
  snprintf(preset.wavetableName, sizeof(preset.wavetableName), "%s", SYNTH_WAVETABLE_BASIC_NAME);
  snprintf(preset.wavetableFolderPath, sizeof(preset.wavetableFolderPath), "%s", SYNTH_WAVETABLE_BUILTIN_FOLDER);
  normalizeSynthPresetMetadata(preset, fallbackIndex);
}

bool writeSynthPresetRecord(File& f, const SynthPresetSlot& preset, uint32_t& crc) {
  size_t written = f.write(reinterpret_cast<const uint8_t*>(&preset), sizeof(preset));
  if (written != sizeof(preset)) {
    return false;
  }
  crc = crc32Update(crc, reinterpret_cast<const uint8_t*>(&preset), sizeof(preset));
  return true;
}

bool finishSynthPresetTempFile(File& f, SynthPresetFileHeader& header) {
  if (!f.seek(0)) {
    return false;
  }
  return f.write(reinterpret_cast<uint8_t*>(&header), sizeof(header)) == sizeof(header);
}

bool replaceSynthPresetCatalogWithTemp() {
  LittleFS.remove(SYNTH_PRESET_CATALOG_FILE_PATH);
  return LittleFS.rename(SYNTH_PRESET_CATALOG_TEMP_FILE_PATH, SYNTH_PRESET_CATALOG_FILE_PATH);
}

bool writeSynthPresetRecordsDirect(const SynthPresetSlot* presets, size_t presetCount, bool logResult) {
  if (!fileSystemExists) {
    sendToLog("File system not available.");
    return false;
  }
  if (presetCount > SYNTH_PRESET_MAX_COUNT) {
    return false;
  }
  LittleFS.remove(SYNTH_PRESET_CATALOG_TEMP_FILE_PATH);
  File f = LittleFS.open(SYNTH_PRESET_CATALOG_TEMP_FILE_PATH, "w");
  if (!f) {
    sendToLog("Error: Unable to open /synth_presets.tmp for writing.");
    return false;
  }
  SynthPresetFileHeader header = {};
  header.base.magic[0] = 'S'; header.base.magic[1] = 'Y'; header.base.magic[2] = 'P';
  header.base.version = SYNTH_PRESET_FILE_VERSION;
  header.count = static_cast<uint16_t>(presetCount);
  header.reserved = 0;
  f.write(reinterpret_cast<uint8_t*>(&header), sizeof(SynthPresetFileHeader));
  uint32_t crc = crc32Begin();
  for (size_t i = 0; i < presetCount; ++i) {
    SynthPresetSlot preset = presets[i];
    normalizeSynthPresetValues(preset);
    normalizeSynthPresetMetadata(preset, static_cast<uint8_t>(i));
    if (!writeSynthPresetRecord(f, preset, crc)) {
      f.close();
      LittleFS.remove(SYNTH_PRESET_CATALOG_TEMP_FILE_PATH);
      sendToLog("Error: Incomplete synth preset write.");
      return false;
    }
  }
  header.base.crc32 = crc32Finish(crc);
  bool ok = finishSynthPresetTempFile(f, header);
  f.close();
  if (!ok || !replaceSynthPresetCatalogWithTemp()) {
    LittleFS.remove(SYNTH_PRESET_CATALOG_TEMP_FILE_PATH);
    sendToLog("Error: Unable to replace /synth_presets.dat.");
    return false;
  }
  if (logResult) {
    sendToLog("Synth presets saved (" + std::to_string(presetCount) + ").");
  }
  return true;
}
}  // namespace

bool readSynthPresetFromCatalog(uint16_t presetIndex, SynthPresetSlot& preset) {
  return readSynthPresetRecordAt(presetIndex, preset);
}

void saveCurrentSynthPresetReference() {
  if (!fileSystemExists) {
    return;
  }

  CurrentSynthPresetReferenceFile reference = {};
  reference.magic[0] = 'C'; reference.magic[1] = 'S'; reference.magic[2] = 'P';
  reference.version = CURRENT_SYNTH_PRESET_REFERENCE_VERSION;
  if (currentSynthPresetIsBlank) {
    reference.flags = CURRENT_SYNTH_PRESET_REFERENCE_BLANK_FLAG;
  } else {
    const SynthPresetIndexEntry* metadata = trackedCurrentSynthPresetEntry();
    if (!metadata) {
      if (LittleFS.exists(CURRENT_SYNTH_PRESET_REFERENCE_FILE_PATH)) {
        LittleFS.remove(CURRENT_SYNTH_PRESET_REFERENCE_FILE_PATH);
      }
      return;
    }
    reference.flags = CURRENT_SYNTH_PRESET_REFERENCE_LOADED_FLAG;
    memcpy(reference.objectId, metadata->objectId, sizeof(reference.objectId));
  }
  reference.crc32 = currentSynthPresetReferenceCrc(reference);

  if (persistedRecordMatches(CURRENT_SYNTH_PRESET_REFERENCE_FILE_PATH, reference)) {
    return;
  }

  File f = LittleFS.open(CURRENT_SYNTH_PRESET_REFERENCE_FILE_PATH, "w");
  if (!f) {
    sendToLog("Error: Unable to open /current_synth_preset.dat for writing.");
    return;
  }
  size_t written = f.write(reinterpret_cast<uint8_t*>(&reference), sizeof(reference));
  f.close();
  if (written != sizeof(reference)) {
    sendToLog("Error: Incomplete current synth preset reference write.");
  }
}

bool loadCurrentSynthPresetReference() {
  if (!fileSystemExists) {
    return false;
  }
  File f = LittleFS.open(CURRENT_SYNTH_PRESET_REFERENCE_FILE_PATH, "r");
  if (!f) {
    return false;
  }
  CurrentSynthPresetReferenceFile reference = {};
  size_t fileSize = f.size();
  size_t bytesRead = f.read(reinterpret_cast<uint8_t*>(&reference), sizeof(reference));
  f.close();
  uint8_t knownFlags = CURRENT_SYNTH_PRESET_REFERENCE_LOADED_FLAG
                       | CURRENT_SYNTH_PRESET_REFERENCE_BLANK_FLAG;
  bool hasLoadedFlag = (reference.flags & CURRENT_SYNTH_PRESET_REFERENCE_LOADED_FLAG) != 0;
  bool hasBlankFlag = (reference.flags & CURRENT_SYNTH_PRESET_REFERENCE_BLANK_FLAG) != 0;
  if (fileSize != sizeof(reference)
      || bytesRead != sizeof(reference)
      || strncmp(reference.magic, "CSP", 3) != 0
      || reference.version != CURRENT_SYNTH_PRESET_REFERENCE_VERSION
      || (reference.flags & ~knownFlags) != 0
      || hasLoadedFlag == hasBlankFlag
      || currentSynthPresetReferenceCrc(reference) != reference.crc32) {
    sendToLog("Invalid current synth preset reference. Using Current.");
    return false;
  }
  if (hasBlankFlag) {
    trackBlankSynthPreset();
    sendToLog("Current synth preset reference loaded: Blank.");
    return true;
  }
  if (trackCurrentSynthPresetObjectId(reference.objectId)) {
    sendToLog("Current synth preset reference loaded: " + std::string(currentSynthPresetDisplayName()) + ".");
    return true;
  }
  sendToLog("Current synth preset reference not found in catalog. Using Current.");
  return false;
}

void save_synth_presets() {
  if (!fileSystemExists) {
    sendToLog("File system not available.");
    return;
  }
  compactSynthPresets();
  LittleFS.remove(SYNTH_PRESET_CATALOG_TEMP_FILE_PATH);
  File f = LittleFS.open(SYNTH_PRESET_CATALOG_TEMP_FILE_PATH, "w");
  if (!f) {
    sendToLog("Error: Unable to open /synth_presets.tmp for writing.");
    return;
  }
  SynthPresetFileHeader header = {};
  header.base.magic[0] = 'S'; header.base.magic[1] = 'Y'; header.base.magic[2] = 'P';
  header.base.version = SYNTH_PRESET_FILE_VERSION;
  header.count = static_cast<uint16_t>(synthPresets.size());
  f.write(reinterpret_cast<uint8_t*>(&header), sizeof(header));

  uint32_t crc = crc32Begin();
  for (size_t i = 0; i < synthPresets.size(); ++i) {
    SynthPresetSlot preset = {};
    bool usePending = pendingSynthPresetSaveSlotValid
                      && synthPresetMetadataMatchesSlot(synthPresets[i], pendingSynthPresetSaveSlot);
    if (usePending) {
      preset = pendingSynthPresetSaveSlot;
    } else if (!readSynthPresetRecordByObjectId(synthPresets[i].objectId, preset)) {
      synthPresetFallbackRecordFromMetadata(synthPresets[i], static_cast<uint8_t>(i), preset);
    }
    copySynthPresetMetadataToSlot(synthPresets[i], preset);
    normalizeSynthPresetValues(preset);
    normalizeSynthPresetMetadata(preset, static_cast<uint8_t>(i));
    copySynthPresetMetadata(synthPresets[i], preset);
    if (!writeSynthPresetRecord(f, preset, crc)) {
      f.close();
      LittleFS.remove(SYNTH_PRESET_CATALOG_TEMP_FILE_PATH);
      pendingSynthPresetSaveSlotValid = false;
      sendToLog("Error: Incomplete synth preset write.");
      return;
    }
  }
  header.base.crc32 = crc32Finish(crc);
  bool ok = finishSynthPresetTempFile(f, header);
  f.close();
  pendingSynthPresetSaveSlotValid = false;
  if (!ok || !replaceSynthPresetCatalogWithTemp()) {
    LittleFS.remove(SYNTH_PRESET_CATALOG_TEMP_FILE_PATH);
    sendToLog("Error: Unable to replace /synth_presets.dat.");
    return;
  }
  saveCurrentSynthPresetReference();
  sendToLog("Synth presets saved (" + std::to_string(synthPresets.size()) + ").");
}

void load_synth_presets() {
  synthPresets.clear();
  currentSynthPresetLoadedSlotValid = false;
  if (!fileSystemExists) {
    sendToLog("File system not available. Using an empty synth preset library.");
    applyDefaultSynthPresets();
    return;
  }
  File f = LittleFS.open(SYNTH_PRESET_CATALOG_FILE_PATH, "r");
  if (!f) {
    sendToLog("Synth preset file not found. Using an empty synth preset library.");
    applyDefaultSynthPresets();
    return;
  }
  SynthPresetFileHeaderBase headerBase = {};
  if (!readSynthPresetFileHeaderBase(f, headerBase)) {
    sendToLog("Invalid synth preset file. Using an empty synth preset library.");
    f.close();
    applyDefaultSynthPresets();
    return;
  }
  if (headerBase.version != SYNTH_PRESET_FILE_VERSION) {
    f.close();
    sendToLog("Unsupported synth preset catalog. Using an empty synth preset library.");
    applyDefaultSynthPresets();
    return;
  }

  SynthPresetFileHeader header = {};
  header.base = headerBase;
  if (f.read(reinterpret_cast<uint8_t*>(&header.count), sizeof(header.count)) != sizeof(header.count)
      || f.read(reinterpret_cast<uint8_t*>(&header.reserved), sizeof(header.reserved)) != sizeof(header.reserved)
      || header.count > SYNTH_PRESET_MAX_COUNT
      || f.size() != sizeof(header) + static_cast<size_t>(header.count) * sizeof(SynthPresetSlot)) {
    sendToLog("Invalid synth preset file. Using an empty synth preset library.");
    f.close();
    applyDefaultSynthPresets();
    return;
  }
  uint32_t crc = crc32Begin();
  for (uint16_t i = 0; i < header.count; ++i) {
    SynthPresetSlot preset = {};
    if (f.read(reinterpret_cast<uint8_t*>(&preset), sizeof(preset)) != sizeof(preset)) {
      sendToLog("Warning: Synth preset data incomplete. Using an empty synth preset library.");
      f.close();
      applyDefaultSynthPresets();
      return;
    }
    crc = crc32Update(crc, reinterpret_cast<const uint8_t*>(&preset), sizeof(preset));
    if (!preset.valid) {
      continue;
    }
    normalizeSynthPresetValues(preset);
    normalizeSynthPresetMetadata(preset, static_cast<uint8_t>(synthPresets.size()));
    appendSynthPresetMetadataFromSlot(preset);
  }
  f.close();
  if (crc32Finish(crc) != header.base.crc32) {
    sendToLog("Synth preset CRC32 mismatch. Using an empty synth preset library.");
    applyDefaultSynthPresets();
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
  setCurrentSynthWavetableReference(preset.wavetableFolderPath, preset.wavetableName);
}

namespace {
constexpr uint64_t FLASH_SAVE_AUDIO_MUTE_TIMEOUT_MICROS = 24000ULL;
uint8_t flashSafeWriteDepth = 0;

void waitForAudioOutputMute(bool muted) {
  uint64_t start = readClock();
  while (!audioOutputMuteSettled(muted) && (readClock() - start) < FLASH_SAVE_AUDIO_MUTE_TIMEOUT_MICROS) {
    delayMicroseconds(AUDIO_DMA_BUFFER_MICROS);
  }
}
}  // namespace

// On the RP2040 flash writes disable ALL interrupts on BOTH cores, which
// starves buffer refills. Fade to silence first, drain queued audio, then hold
// the physical outputs idle until the flash operation finishes.
void beginFlashSafeWrite() {
  if (flashSafeWriteDepth > 0) {
    ++flashSafeWriteDepth;
    return;
  }
  ++flashSafeWriteDepth;
  showFlashSaveScreen();
  setAudioOutputMuteTarget(true);
  waitForAudioOutputMute(true);
  delayMicroseconds(AUDIO_DMA_BUFFER_MICROS * 2);
  flashWriteInProgress.store(true, std::memory_order_release);
  quiesceAudioDmaForFlashWrite();
}

void endFlashSafeWrite() {
  if (flashSafeWriteDepth == 0) {
    return;
  }
  --flashSafeWriteDepth;
  if (flashSafeWriteDepth > 0) {
    return;
  }
  resumeAudioDmaAfterFlashWrite();
  delayMicroseconds(AUDIO_DMA_BUFFER_MICROS * 2);
  flashWriteInProgress.store(false, std::memory_order_release);
  setAudioOutputMuteTarget(false);
  waitForAudioOutputMute(false);
  closeFlashSaveScreen();
}

void flashSafeWrite(void (*writeOperation)()) {
  beginFlashSafeWrite();
  writeOperation();
  endFlashSafeWrite();
}

void flashSafeSave() {
  flashSafeWrite(save_settings);
}

void saveCurrentSynthReferences() {
  saveCurrentSynthWavetableReference();
  saveCurrentSynthPresetReference();
}

void flashSafeSaveCurrentSynthReferences() {
  flashSafeWrite(saveCurrentSynthReferences);
}

void flashSafeSaveSynthPresets() {
  flashSafeWrite(save_synth_presets);
}

void flashSafeSaveSynthWavetables() {
  flashSafeWrite(save_synth_wavetables);
}

void flashSafeSaveCurrentSynthWavetableReference() {
  flashSafeWrite(saveCurrentSynthWavetableReference);
}

void flashSafeSaveUserSynthWavetable() {
  flashSafeWrite(save_user_wavetable);
}

void saveSynthPresetToSlot(uint16_t presetIndex) {
  if (presetIndex >= synthPresets.size() || !synthPresets[presetIndex].valid) {
    return;
  }
  SynthPresetSlot preset = {};
  if (!readSynthPresetFromCatalog(presetIndex, preset)) {
    synthPresetFallbackRecordFromMetadata(synthPresets[presetIndex], static_cast<uint8_t>(presetIndex), preset);
  }
  captureCurrentSynthPreset(preset);
  normalizeSynthPresetMetadata(preset, static_cast<uint8_t>(presetIndex));
  copySynthPresetMetadata(synthPresets[presetIndex], preset);
  pendingSynthPresetSaveSlot = preset;
  pendingSynthPresetSaveSlotValid = true;
  trackCurrentSynthPresetSlot(presetIndex, &preset);
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
  SynthPresetIndexEntry metadata = {};
  copySynthPresetMetadata(metadata, preset);
  if (!synthPresets.push_back(metadata)) {
    sendToLog("Synth preset library is full.");
    return;
  }
  pendingSynthPresetSaveSlot = preset;
  pendingSynthPresetSaveSlotValid = true;
  trackCurrentSynthPresetSlot(static_cast<uint16_t>(synthPresets.size() - 1), &preset);
  flashSafeSaveSynthPresets();
  sendToLog("Saved new synth preset " + std::string(preset.name));
}

bool writeSynthPresetToCatalogSlot(uint16_t presetIndex, const SynthPresetSlot& preset) {
  if (presetIndex > synthPresets.size()
      || (presetIndex == synthPresets.size() && synthPresets.size() >= SYNTH_PRESET_MAX_COUNT)) {
    sendToLog("Synth preset library is full.");
    return false;
  }
  SynthPresetSlot normalized = preset;
  normalizeSynthPresetValues(normalized);
  normalizeSynthPresetMetadata(normalized, static_cast<uint8_t>(presetIndex));
  SynthPresetIndexEntry metadata = {};
  copySynthPresetMetadata(metadata, normalized);
  if (presetIndex == synthPresets.size()) {
    if (!synthPresets.push_back(metadata)) {
      sendToLog("Synth preset library is full.");
      return false;
    }
  } else {
    synthPresets[presetIndex] = metadata;
  }
  pendingSynthPresetSaveSlot = normalized;
  pendingSynthPresetSaveSlotValid = true;
  flashSafeSaveSynthPresets();
  return true;
}

void loadSynthPresetFromSlot(uint16_t presetIndex) {
  if (presetIndex >= synthPresets.size() || !synthPresets[presetIndex].valid) {
    sendToLog("Synth preset handle is empty.");
    return;
  }
  SynthPresetSlot preset = {};
  if (!readSynthPresetFromCatalog(presetIndex, preset)) {
    sendToLog("Synth preset record is missing.");
    return;
  }
  applySynthPresetToSettings(preset);
  markSettingsDirty();
  trackCurrentSynthPresetSlot(presetIndex, &preset);
  syncSynthSettingsToRuntime();
  flashSafeSaveCurrentSynthReferences();
  sendToLog("Loaded synth preset " + std::string(synthPresets[presetIndex].name));
}
