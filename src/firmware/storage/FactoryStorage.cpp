#include "FactoryStorage.h"

#include "../sequencer/SequencerStorage.h"
#include "../synth/SynthAudio.h"
#include "PersistentDataModels.h"
#include "Settings.h"

namespace {
constexpr char STORAGE_READY_PATH[] = "/storage_ready.dat";
constexpr char SETTINGS_PATH[] = "/settings.dat";
constexpr char SYNTH_PRESETS_PATH[] = "/synth_presets.dat";
constexpr char SYNTH_WAVETABLES_PATH[] = "/synth_wavetables.dat";
constexpr char GEOMETRY_PATH[] = "/layouts.dat";
constexpr char CURRENT_SYNTH_PRESET_PATH[] = "/current_synth_preset.dat";
constexpr char CURRENT_SYNTH_WAVETABLE_PATH[] = "/current_wavetable.dat";
constexpr char PROFILE_SYNTH_WAVETABLES_PATH[] = "/profile_wavetables.dat";
constexpr uint8_t STORAGE_READY_VERSION = 2;
constexpr uint8_t CURRENT_SYNTH_PRESET_REFERENCE_VERSION = 1;
constexpr uint8_t CURRENT_SYNTH_PRESET_LOADED_FLAG = 0x01;
constexpr uint8_t CURRENT_SYNTH_PRESET_BLANK_FLAG = 0x02;

struct StorageReadyRecord {
  char magic[3];
  uint8_t version;
  uint32_t crc32;
};
static_assert(sizeof(StorageReadyRecord) == 8, "StorageReadyRecord disk layout changed");

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

char firstStorageIssue[64] = {};
uint8_t storageIssueCount = 0;

void reportStorageIssue(const char* path, const char* reason) {
  if (storageIssueCount < UINT8_MAX) {
    ++storageIssueCount;
  }
  if (!firstStorageIssue[0]) {
    snprintf(firstStorageIssue, sizeof(firstStorageIssue), "%s", path ? path : "LittleFS");
  }
  char message[160] = {};
  snprintf(message,
           sizeof(message),
           "Storage warning [%s]: %s",
           path ? path : "LittleFS",
           reason ? reason : "invalid");
  Serial.println(message);
}

bool readExactFile(const char* path, void* output, size_t length) {
  File file = LittleFS.open(path, "r");
  if (!file) {
    reportStorageIssue(path, "missing or cannot open");
    return false;
  }
  if (file.size() != length) {
    file.close();
    reportStorageIssue(path, "wrong file size");
    return false;
  }
  size_t bytesRead = file.read(reinterpret_cast<uint8_t*>(output), length);
  file.close();
  if (bytesRead != length) {
    reportStorageIssue(path, "short read");
    return false;
  }
  return true;
}

bool storageReadyRecordValid() {
  // This record is advisory; individual stores are the validation boundary.
  if (!LittleFS.exists(STORAGE_READY_PATH)) {
    return true;
  }
  StorageReadyRecord record = {};
  if (!readExactFile(STORAGE_READY_PATH, &record, sizeof(record))) {
    return false;
  }
  uint32_t expectedCrc = crc32(reinterpret_cast<const uint8_t*>(&record), sizeof(record) - sizeof(record.crc32));
  if (strncmp(record.magic, "HFS", 3) != 0) {
    reportStorageIssue(STORAGE_READY_PATH, "magic mismatch");
    return false;
  }
  if (record.version == 0 || record.version > STORAGE_READY_VERSION) {
    reportStorageIssue(STORAGE_READY_PATH, "filesystem generation mismatch");
    return false;
  }
  if (record.crc32 != expectedCrc) {
    reportStorageIssue(STORAGE_READY_PATH, "CRC mismatch");
    return false;
  }
  return true;
}

const char* skipLeadingSlash(const char* value) {
  while (value && *value == '/') {
    ++value;
  }
  return value ? value : "";
}

bool folderMatches(const char* left, const char* right) {
  return strcmp(skipLeadingSlash(left), skipLeadingSlash(right)) == 0;
}

bool wavetableReferenceExists(const char* folder, const char* name) {
  if (!name || !name[0]) {
    return false;
  }
  const char* normalizedFolder = skipLeadingSlash(folder);
  if ((strcmp(normalizedFolder, "Built In") == 0
       || strcmp(normalizedFolder, "%2FBuilt In") == 0
       || strcmp(normalizedFolder, "%2fBuilt In") == 0)
      && strcmp(name, SYNTH_WAVETABLE_BASIC_NAME) == 0) {
    return true;
  }
  File file = LittleFS.open(SYNTH_WAVETABLES_PATH, "r");
  if (!file) {
    return false;
  }
  SynthWavetableFileHeader header = {};
  if (file.read(reinterpret_cast<uint8_t*>(&header), sizeof(header)) != sizeof(header)
      || strncmp(header.magic, "SYW", 3) != 0
      || header.version != SYNTH_WAVETABLE_FILE_VERSION
      || header.count > SYNTH_WAVETABLE_MAX_COUNT) {
    file.close();
    return false;
  }
  for (uint16_t index = 0; index < header.count; ++index) {
    SynthWavetableSlot wavetable = {};
    if (file.read(reinterpret_cast<uint8_t*>(&wavetable), sizeof(wavetable)) != sizeof(wavetable)) {
      break;
    }
    wavetable.name[sizeof(wavetable.name) - 1] = '\0';
    wavetable.folderPath[sizeof(wavetable.folderPath) - 1] = '\0';
    if (wavetable.valid
        && strcmp(wavetable.name, name) == 0
        && folderMatches(wavetable.folderPath, folder)) {
      file.close();
      return true;
    }
  }
  file.close();
  return false;
}

bool synthPresetObjectExists(const uint8_t* objectId) {
  File file = LittleFS.open(SYNTH_PRESETS_PATH, "r");
  if (!file) {
    return false;
  }
  SynthPresetFileHeader header = {};
  if (file.read(reinterpret_cast<uint8_t*>(&header), sizeof(header)) != sizeof(header)
      || strncmp(header.base.magic, "SYP", 3) != 0
      || header.base.version != SYNTH_PRESET_FILE_VERSION
      || header.count > SYNTH_PRESET_MAX_COUNT) {
    file.close();
    return false;
  }
  for (uint16_t index = 0; index < header.count; ++index) {
    SynthPresetSlot preset = {};
    if (file.read(reinterpret_cast<uint8_t*>(&preset), sizeof(preset)) != sizeof(preset)) {
      break;
    }
    if (preset.valid && memcmp(preset.objectId, objectId, sizeof(preset.objectId)) == 0) {
      file.close();
      return true;
    }
  }
  file.close();
  return false;
}

bool settingsFileValid() {
  File file = LittleFS.open(SETTINGS_PATH, "r");
  if (!file) {
    reportStorageIssue(SETTINGS_PATH, "missing; using hardware-aware defaults");
    return false;
  }
  if (file.size() != sizeof(SettingsHeader) + SETTINGS_DATA_SIZE) {
    file.close();
    reportStorageIssue(SETTINGS_PATH, "wrong file size; using defaults");
    return false;
  }
  SettingsHeader header = {};
  uint8_t data[SETTINGS_DATA_SIZE] = {};
  bool readOk = file.read(reinterpret_cast<uint8_t*>(&header), sizeof(header)) == sizeof(header)
                && file.read(data, sizeof(data)) == sizeof(data);
  file.close();
  if (!readOk) {
    reportStorageIssue(SETTINGS_PATH, "short read; using defaults");
    return false;
  }
  if (strncmp(header.magic, "STG", 3) != 0) {
    reportStorageIssue(SETTINGS_PATH, "magic mismatch; using defaults");
    return false;
  }
  constexpr uint8_t SETTINGS_VERSION_ABSOLUTE_ROTARY = 23;
  if (header.version != CURRENT_SETTINGS_VERSION
      && header.version != SETTINGS_VERSION_ABSOLUTE_ROTARY) {
    reportStorageIssue(SETTINGS_PATH, "settings version mismatch; using defaults");
    return false;
  }
  if (header.defaultProfileIndex >= PROFILE_COUNT) {
    reportStorageIssue(SETTINGS_PATH, "profile index is out of range; using defaults");
    return false;
  }
  if (header.crc32 != crc32(data, sizeof(data))) {
    reportStorageIssue(SETTINGS_PATH, "CRC mismatch; using defaults");
    return false;
  }
  return true;
}

bool synthPresetCatalogValid() {
  File file = LittleFS.open(SYNTH_PRESETS_PATH, "r");
  if (!file) {
    reportStorageIssue(SYNTH_PRESETS_PATH, "missing; using an empty preset library");
    return false;
  }
  SynthPresetFileHeader header = {};
  if (file.read(reinterpret_cast<uint8_t*>(&header), sizeof(header)) != sizeof(header)) {
    file.close();
    reportStorageIssue(SYNTH_PRESETS_PATH, "short header; using an empty preset library");
    return false;
  }
  size_t expectedSize = sizeof(header) + static_cast<size_t>(header.count) * sizeof(SynthPresetSlot);
  if (strncmp(header.base.magic, "SYP", 3) != 0
      || header.base.version != SYNTH_PRESET_FILE_VERSION
      || header.count > SYNTH_PRESET_MAX_COUNT
      || file.size() != expectedSize) {
    file.close();
    reportStorageIssue(SYNTH_PRESETS_PATH, "invalid header or size; using an empty preset library");
    return false;
  }
  uint32_t crc = crc32Begin();
  SynthPresetSlot preset = {};
  for (uint16_t index = 0; index < header.count; ++index) {
    if (file.read(reinterpret_cast<uint8_t*>(&preset), sizeof(preset)) != sizeof(preset)) {
      file.close();
      reportStorageIssue(SYNTH_PRESETS_PATH, "short record; using an empty preset library");
      return false;
    }
    crc = crc32Update(crc, reinterpret_cast<const uint8_t*>(&preset), sizeof(preset));
    if (preset.valid) {
      preset.wavetableName[sizeof(preset.wavetableName) - 1] = '\0';
      preset.wavetableFolderPath[sizeof(preset.wavetableFolderPath) - 1] = '\0';
      if (!wavetableReferenceExists(preset.wavetableFolderPath, preset.wavetableName)) {
        char reason[80] = {};
        snprintf(reason,
                 sizeof(reason),
                 "preset %u references missing wavetable %s/%s",
                 static_cast<unsigned>(index),
                 preset.wavetableFolderPath,
                 preset.wavetableName);
        reportStorageIssue(SYNTH_PRESETS_PATH, reason);
      }
    }
  }
  file.close();
  if (crc32Finish(crc) != header.base.crc32) {
    reportStorageIssue(SYNTH_PRESETS_PATH, "CRC mismatch; using an empty preset library");
    return false;
  }
  return true;
}

bool wavetableSampleValid(const SynthWavetableSlot& wavetable, uint16_t index) {
  char path[SYNTH_WAVETABLE_SAMPLE_PATH_LENGTH] = {};
  memcpy(path, wavetable.samplePath, sizeof(path));
  path[sizeof(path) - 1] = '\0';
  if (!path[0]) {
    char reason[64] = {};
    snprintf(reason, sizeof(reason), "record %u has no sample path", static_cast<unsigned>(index));
    reportStorageIssue(SYNTH_WAVETABLES_PATH, reason);
    return false;
  }
  File sample = LittleFS.open(path, "r");
  if (!sample) {
    reportStorageIssue(path, "wavetable sample file is missing");
    return false;
  }
  size_t length = sample.size();
  sample.close();
  if (!isSupportedSynthWavetableSampleLength(length)) {
    reportStorageIssue(path, "wavetable sample length is invalid");
    return false;
  }
  return true;
}

bool synthWavetableCatalogValid() {
  File file = LittleFS.open(SYNTH_WAVETABLES_PATH, "r");
  if (!file) {
    reportStorageIssue(SYNTH_WAVETABLES_PATH, "missing; using Basic Shapes");
    return false;
  }
  SynthWavetableFileHeader header = {};
  if (file.read(reinterpret_cast<uint8_t*>(&header), sizeof(header)) != sizeof(header)) {
    file.close();
    reportStorageIssue(SYNTH_WAVETABLES_PATH, "short header; using Basic Shapes");
    return false;
  }
  size_t expectedSize = sizeof(header) + static_cast<size_t>(header.count) * sizeof(SynthWavetableSlot);
  if (strncmp(header.magic, "SYW", 3) != 0
      || header.version != SYNTH_WAVETABLE_FILE_VERSION
      || header.count > SYNTH_WAVETABLE_MAX_COUNT
      || file.size() != expectedSize) {
    file.close();
    reportStorageIssue(SYNTH_WAVETABLES_PATH, "invalid header or size; using Basic Shapes");
    return false;
  }
  uint32_t crc = crc32Begin();
  bool samplesValid = true;
  SynthWavetableSlot wavetable = {};
  for (uint16_t index = 0; index < header.count; ++index) {
    if (file.read(reinterpret_cast<uint8_t*>(&wavetable), sizeof(wavetable)) != sizeof(wavetable)) {
      file.close();
      reportStorageIssue(SYNTH_WAVETABLES_PATH, "short record; using Basic Shapes");
      return false;
    }
    crc = crc32Update(crc, reinterpret_cast<const uint8_t*>(&wavetable), sizeof(wavetable));
    if (wavetable.valid && !wavetableSampleValid(wavetable, index)) {
      samplesValid = false;
    }
  }
  file.close();
  if (crc32Finish(crc) != header.crc32) {
    reportStorageIssue(SYNTH_WAVETABLES_PATH, "CRC mismatch; using Basic Shapes");
    return false;
  }
  return samplesValid;
}

bool geometryCatalogValid() {
  File file = LittleFS.open(GEOMETRY_PATH, "r");
  if (!file) {
    reportStorageIssue(GEOMETRY_PATH, "missing; using built-in 12 EDO");
    return false;
  }
  GeometryObjectFileHeader header = {};
  if (file.read(reinterpret_cast<uint8_t*>(&header), sizeof(header)) != sizeof(header)) {
    file.close();
    reportStorageIssue(GEOMETRY_PATH, "short header; using built-in 12 EDO");
    return false;
  }
  if (strncmp(header.magic, "LYT", 3) != 0
      || header.version != GEOMETRY_OBJECT_FILE_VERSION
      || header.count > GEOMETRY_OBJECT_MAX_COUNT) {
    file.close();
    reportStorageIssue(GEOMETRY_PATH, "invalid header; using built-in 12 EDO");
    return false;
  }
  uint32_t crc = crc32Begin();
  uint8_t buffer[128] = {};
  while (file.available() > 0) {
    size_t count = file.read(buffer, std::min(static_cast<size_t>(file.available()), sizeof(buffer)));
    if (count == 0) {
      file.close();
      reportStorageIssue(GEOMETRY_PATH, "short read; using built-in 12 EDO");
      return false;
    }
    crc = crc32Update(crc, buffer, count);
  }
  file.close();
  if (crc32Finish(crc) != header.crc32) {
    reportStorageIssue(GEOMETRY_PATH, "CRC mismatch; using built-in 12 EDO");
    return false;
  }
  return true;
}

bool currentPresetReferenceValid() {
  CurrentSynthPresetReferenceFile reference = {};
  if (!readExactFile(CURRENT_SYNTH_PRESET_PATH, &reference, sizeof(reference))) {
    return false;
  }
  uint8_t knownFlags = CURRENT_SYNTH_PRESET_LOADED_FLAG | CURRENT_SYNTH_PRESET_BLANK_FLAG;
  bool loaded = (reference.flags & CURRENT_SYNTH_PRESET_LOADED_FLAG) != 0;
  bool blank = (reference.flags & CURRENT_SYNTH_PRESET_BLANK_FLAG) != 0;
  uint8_t crcBytes[1 + sizeof(reference.objectId)] = { reference.flags };
  memcpy(crcBytes + 1, reference.objectId, sizeof(reference.objectId));
  if (strncmp(reference.magic, "CSP", 3) != 0
      || reference.version != CURRENT_SYNTH_PRESET_REFERENCE_VERSION
      || (reference.flags & ~knownFlags) != 0
      || loaded == blank
      || reference.crc32 != crc32(crcBytes, sizeof(crcBytes))) {
    reportStorageIssue(CURRENT_SYNTH_PRESET_PATH, "invalid; using Current");
    return false;
  }
  if (loaded && !synthPresetObjectExists(reference.objectId)) {
    reportStorageIssue(CURRENT_SYNTH_PRESET_PATH, "selected preset is not in the catalog; using Current");
    return false;
  }
  return true;
}

bool currentWavetableReferenceValid() {
  CurrentSynthWavetableReferenceFile reference = {};
  if (!readExactFile(CURRENT_SYNTH_WAVETABLE_PATH, &reference, sizeof(reference))) {
    return false;
  }
  uint8_t data[sizeof(reference.name) + sizeof(reference.folderPath)] = {};
  memcpy(data, reference.name, sizeof(reference.name));
  memcpy(data + sizeof(reference.name), reference.folderPath, sizeof(reference.folderPath));
  if (strncmp(reference.magic, "CWT", 3) != 0
      || reference.version != CURRENT_SYNTH_WAVETABLE_REFERENCE_VERSION
      || !reference.name[0]
      || reference.crc32 != crc32(data, sizeof(data))) {
    reportStorageIssue(CURRENT_SYNTH_WAVETABLE_PATH, "invalid; using Basic Shapes");
    return false;
  }
  reference.name[sizeof(reference.name) - 1] = '\0';
  reference.folderPath[sizeof(reference.folderPath) - 1] = '\0';
  if (!wavetableReferenceExists(reference.folderPath, reference.name)) {
    reportStorageIssue(CURRENT_SYNTH_WAVETABLE_PATH, "selected wavetable is unavailable; using Basic Shapes");
    return false;
  }
  return true;
}

bool profileWavetableReferencesValid() {
  SynthWavetableProfileReferenceFile references = {};
  if (!readExactFile(PROFILE_SYNTH_WAVETABLES_PATH, &references, sizeof(references))) {
    return false;
  }
  if (strncmp(references.magic, "PWT", 3) != 0
      || references.version != SYNTH_WAVETABLE_PROFILE_REFERENCES_VERSION
      || references.crc32 != crc32(reinterpret_cast<const uint8_t*>(references.profiles), sizeof(references.profiles))) {
    reportStorageIssue(PROFILE_SYNTH_WAVETABLES_PATH, "invalid; using Basic Shapes for every profile");
    return false;
  }
  for (uint8_t profile = 0; profile < PROFILE_COUNT; ++profile) {
    SynthWavetableProfileReference& reference = references.profiles[profile];
    reference.name[sizeof(reference.name) - 1] = '\0';
    reference.folderPath[sizeof(reference.folderPath) - 1] = '\0';
    if (!wavetableReferenceExists(reference.folderPath, reference.name)) {
      char reason[72] = {};
      snprintf(reason,
               sizeof(reason),
               "profile %u wavetable is unavailable; using Basic Shapes",
               static_cast<unsigned>(profile + 1));
      reportStorageIssue(PROFILE_SYNTH_WAVETABLES_PATH, reason);
      return false;
    }
  }
  return true;
}
}  // namespace

FactoryStorageBootState inspectFactoryStorage() {
  firstStorageIssue[0] = '\0';
  storageIssueCount = 0;
  if (!fileSystemExists) {
    reportStorageIssue("LittleFS", "mount failed; saving is disabled");
    return FactoryStorageBootState::Unavailable;
  }
  storageReadyRecordValid();
  settingsFileValid();
  synthPresetCatalogValid();
  synthWavetableCatalogValid();
  geometryCatalogValid();
  currentPresetReferenceValid();
  currentWavetableReferenceValid();
  profileWavetableReferencesValid();
#if HEXBOARD_ENABLE_SEQUENCER
  if (!LittleFS.exists(sequencer::kSequenceStorageRoot)) {
    reportStorageIssue(sequencer::kSequenceStorageRoot, "missing; sequence library starts empty");
  }
#endif
  if (storageIssueCount == 0) {
    Serial.println("Storage check: all factory files valid.");
    return FactoryStorageBootState::Ready;
  }
  char summary[80] = {};
  snprintf(summary, sizeof(summary), "Storage check: %u warning(s); booting safe fallback.", storageIssueCount);
  Serial.println(summary);
  return FactoryStorageBootState::Degraded;
}

const char* factoryStorageLastError() {
  return firstStorageIssue[0] ? firstStorageIssue : "LittleFS";
}

uint8_t factoryStorageIssueCount() {
  return storageIssueCount;
}
