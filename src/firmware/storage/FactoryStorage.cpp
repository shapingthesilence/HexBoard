#include "FactoryStorage.h"

#include "../sequencer/SequencerStorage.h"
#include "../synth/SynthAudio.h"
#include "PersistentDataModels.h"
#include "Settings.h"
#include "SynthPresetStorage.h"

namespace {
constexpr char STORAGE_READY_PATH[] = "/storage_ready.dat";
constexpr char SETTINGS_PATH[] = "/settings.dat";
constexpr char SYNTH_WAVETABLES_PATH[] = "/synth_wavetables.dat";
constexpr char CURRENT_SYNTH_PRESET_PATH[] = "/current_synth_preset.dat";
constexpr uint8_t STORAGE_READY_VERSION = 4;
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
  if (record.version != STORAGE_READY_VERSION) {
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
  char path[SYNTH_PRESET_STORAGE_PATH_LENGTH] = {};
  if (!synthPresetStoragePath(objectId, path, sizeof(path))) {
    return false;
  }
  File file = LittleFS.open(path, "r");
  if (!file || file.size() != sizeof(SynthPresetFileHeaderBase) + sizeof(SynthPresetSlot)) {
    if (file) file.close();
    return false;
  }
  SynthPresetFileHeaderBase header = {};
  SynthPresetSlot preset = {};
  bool valid = file.read(reinterpret_cast<uint8_t*>(&header), sizeof(header)) == sizeof(header)
               && file.read(reinterpret_cast<uint8_t*>(&preset), sizeof(preset)) == sizeof(preset)
               && strncmp(header.magic, "HSP", 3) == 0
               && header.version == SYNTH_PRESET_FILE_VERSION
               && preset.valid
               && memcmp(preset.objectId, objectId, sizeof(preset.objectId)) == 0
               && header.crc32 == crc32(reinterpret_cast<const uint8_t*>(&preset), sizeof(preset));
  file.close();
  return valid;
}

bool settingsFileValid() {
  File file = LittleFS.open(SETTINGS_PATH, "r");
  if (!file) {
    reportStorageIssue(SETTINGS_PATH, "missing; using hardware-aware defaults");
    return false;
  }
  SettingsHeader header = {};
  uint8_t data[SETTINGS_DATA_SIZE] = {};
  bool headerRead =
    file.read(reinterpret_cast<uint8_t*>(&header), sizeof(header)) == sizeof(header);
  constexpr uint8_t SETTINGS_VERSION_ABSOLUTE_ROTARY = 23;
  constexpr uint8_t SETTINGS_VERSION_WITHOUT_GEOMETRY_REFERENCES = 24;
  bool legacyPayload =
    header.version == SETTINGS_VERSION_ABSOLUTE_ROTARY
    || header.version == SETTINGS_VERSION_WITHOUT_GEOMETRY_REFERENCES;
  size_t expectedDataSize = legacyPayload ? SETTINGS_VALUES_DATA_SIZE : SETTINGS_DATA_SIZE;
  bool readOk =
    headerRead
    && file.size() == sizeof(SettingsHeader) + expectedDataSize
    && file.read(data, expectedDataSize) == expectedDataSize;
  file.close();
  if (!readOk) {
    reportStorageIssue(SETTINGS_PATH, "short read; using defaults");
    return false;
  }
  if (strncmp(header.magic, "STG", 3) != 0) {
    reportStorageIssue(SETTINGS_PATH, "magic mismatch; using defaults");
    return false;
  }
  if (header.version != CURRENT_SETTINGS_VERSION
      && !legacyPayload) {
    reportStorageIssue(SETTINGS_PATH, "settings version mismatch; using defaults");
    return false;
  }
  if (header.defaultProfileIndex >= PROFILE_COUNT) {
    reportStorageIssue(SETTINGS_PATH, "profile index is out of range; using defaults");
    return false;
  }
  if (header.crc32 != crc32(data, expectedDataSize)) {
    reportStorageIssue(SETTINGS_PATH, "CRC mismatch; using defaults");
    return false;
  }
  if (!legacyPayload) {
    size_t wavetableOffset = SETTINGS_VALUES_DATA_SIZE + SETTINGS_GEOMETRY_DATA_SIZE;
    for (uint8_t profile = 0; profile < PROFILE_COUNT; ++profile) {
      SynthWavetableProfileReference reference = {};
      memcpy(&reference,
             data + wavetableOffset + profile * sizeof(reference),
             sizeof(reference));
      reference.name[sizeof(reference.name) - 1] = '\0';
      reference.folderPath[sizeof(reference.folderPath) - 1] = '\0';
      if (!reference.name[0]) {
        continue;
      }
      if (!wavetableReferenceExists(reference.folderPath, reference.name)) {
        char reason[80] = {};
        snprintf(reason,
                 sizeof(reason),
                 "profile %u wavetable is unavailable; using Basic Shapes",
                 static_cast<unsigned>(profile + 1));
        reportStorageIssue(SETTINGS_PATH, reason);
        return false;
      }
    }
  }
  return true;
}

bool synthPresetCatalogValid() {
  File directory = LittleFS.open(SYNTH_PRESET_STORAGE_ROOT, "r");
  if (!directory || !directory.isDirectory()) {
    if (directory) directory.close();
    reportStorageIssue(SYNTH_PRESET_STORAGE_ROOT, "missing; using an empty preset library");
    return false;
  }
  uint16_t count = 0;
  File entry;
  while ((entry = directory.openNextFile())) {
    char path[SYNTH_PRESET_STORAGE_PATH_LENGTH] = {};
    snprintf(path, sizeof(path), "%s", entry.fullName());
    bool regular = !entry.isDirectory();
    entry.close();
    size_t length = strlen(path);
    if (!regular || length < 4 || strcmp(path + length - 4, SYNTH_PRESET_FILE_EXTENSION) != 0) {
      continue;
    }
    if (++count > SYNTH_PRESET_MAX_COUNT) {
      reportStorageIssue(SYNTH_PRESET_STORAGE_ROOT, "contains more than 128 presets");
      directory.close();
      return false;
    }
    File file = LittleFS.open(path, "r");
    SynthPresetFileHeaderBase header = {};
    SynthPresetSlot preset = {};
    bool valid = file
                 && file.size() == sizeof(header) + sizeof(preset)
                 && file.read(reinterpret_cast<uint8_t*>(&header), sizeof(header)) == sizeof(header)
                 && file.read(reinterpret_cast<uint8_t*>(&preset), sizeof(preset)) == sizeof(preset)
                 && strncmp(header.magic, "HSP", 3) == 0
                 && header.version == SYNTH_PRESET_FILE_VERSION
                 && preset.valid
                 && header.crc32 == crc32(reinterpret_cast<const uint8_t*>(&preset), sizeof(preset));
    if (file) file.close();
    if (!valid) {
      reportStorageIssue(path, "invalid synth preset file");
      continue;
    }
    preset.wavetableName[sizeof(preset.wavetableName) - 1] = '\0';
    preset.wavetableFolderPath[sizeof(preset.wavetableFolderPath) - 1] = '\0';
    if (!wavetableReferenceExists(preset.wavetableFolderPath, preset.wavetableName)) {
      reportStorageIssue(path, "references a missing wavetable");
    }
  }
  directory.close();
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
  File directory = LittleFS.open(GEOMETRY_STORAGE_ROOT, "r");
  if (!directory || !directory.isDirectory()) {
    if (directory) directory.close();
    reportStorageIssue(GEOMETRY_STORAGE_ROOT, "missing; using built-in 12 EDO");
    return false;
  }
  uint8_t bundleCount = 0;
  uint16_t recordCount = 0;
  File entry;
  while ((entry = directory.openNextFile())) {
    char path[GEOMETRY_STORAGE_PATH_LENGTH] = {};
    snprintf(path, sizeof(path), "%s", entry.fullName());
    bool regular = !entry.isDirectory();
    entry.close();
    size_t pathLength = strlen(path);
    size_t extensionLength = strlen(GEOMETRY_BUNDLE_FILE_EXTENSION);
    if (!regular || pathLength < extensionLength
        || strcmp(path + pathLength - extensionLength, GEOMETRY_BUNDLE_FILE_EXTENSION) != 0) continue;
    File file = LittleFS.open(path, "r");
    GeometryObjectFileHeader header = {};
    if (!file || file.size() < sizeof(header)
        || file.size() > GEOMETRY_BUNDLE_MAX_RAW_BYTES
        || file.read(reinterpret_cast<uint8_t*>(&header), sizeof(header)) != sizeof(header)
        || strncmp(header.magic, "HGB", 3) != 0
        || header.version != GEOMETRY_OBJECT_FILE_VERSION
        || header.count == 0
        || header.count > GEOMETRY_BUNDLE_RECORD_MAX_COUNT) {
      if (file) file.close();
      reportStorageIssue(path, "invalid geometry bundle header");
      continue;
    }
    uint32_t crc = crc32Begin();
    uint8_t buffer[128] = {};
    while (file.available() > 0) {
      size_t count = file.read(buffer, std::min(static_cast<size_t>(file.available()), sizeof(buffer)));
      if (count == 0) break;
      crc = crc32Update(crc, buffer, count);
    }
    file.close();
    if (crc32Finish(crc) != header.crc32) {
      reportStorageIssue(path, "geometry bundle CRC mismatch");
      continue;
    }
    ++bundleCount;
    recordCount += header.count;
  }
  directory.close();
  if (bundleCount > GEOMETRY_BUNDLE_MAX_COUNT || recordCount > GEOMETRY_OBJECT_MAX_COUNT) {
    reportStorageIssue(GEOMETRY_STORAGE_ROOT, "geometry library exceeds capacity");
    return false;
  }
  return bundleCount > 0;
}

bool defaultGeometryReferenceValid() {
  DefaultGeometryReferenceFile reference = {};
  if (!readExactFile(DEFAULT_GEOMETRY_REFERENCE_FILE_PATH, &reference, sizeof(reference))) {
    return false;
  }
  if (strncmp(reference.magic, "DGE", 3) != 0
      || reference.version != DEFAULT_GEOMETRY_REFERENCE_VERSION
      || reference.crc32 != crc32(reference.tuningObjectId, sizeof(reference.tuningObjectId))) {
    reportStorageIssue(DEFAULT_GEOMETRY_REFERENCE_FILE_PATH, "invalid; using the first usable geometry bundle");
    return false;
  }
  char path[GEOMETRY_STORAGE_PATH_LENGTH] = {};
  size_t cursor = snprintf(path, sizeof(path), "%s/", GEOMETRY_STORAGE_ROOT);
  constexpr char HEX_DIGITS[] = "0123456789ABCDEF";
  for (uint8_t byteValue : reference.tuningObjectId) {
    path[cursor++] = HEX_DIGITS[byteValue >> 4];
    path[cursor++] = HEX_DIGITS[byteValue & 0x0F];
  }
  snprintf(path + cursor, sizeof(path) - cursor, "%s", GEOMETRY_BUNDLE_FILE_EXTENSION);
  if (LittleFS.exists(path)) {
    return true;
  }
  reportStorageIssue(DEFAULT_GEOMETRY_REFERENCE_FILE_PATH, "selected tuning is unavailable; using the first usable bundle");
  return false;
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
  defaultGeometryReferenceValid();
  currentPresetReferenceValid();
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
