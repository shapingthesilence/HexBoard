#include "../FirmwareModule.h"
#include "../app/DiagnosticsTiming.h"
#include "../menu/MenuAndDisplay.h"
#include "Settings.h"
#include "StorageHealth.h"
#include "SynthPresetCatalog.h"
#include "SynthPresetIndexCodec.h"
#include "SynthPresetStorage.h"


namespace {
using SynthPresetIndex::Header;
using SynthPresetIndex::Record;

constexpr uint8_t FOLDER_SLOTS = SYNTH_PRESET_FOLDER_MAX_COUNT;
constexpr uint8_t FOLDER_FILE_MAX_RECORDS = 255;  // legacy folders may exceed the add limit
constexpr size_t RECORDS_PER_READ = 8;
constexpr size_t TABLE_FILE_BYTES = SynthPresetIndex::kHeaderBytes + FOLDER_SLOTS * SynthPresetIndex::kFolderBytes;
constexpr char FOLDER_FILE_MAGIC[] = "HPI";
constexpr char TABLE_FILE_MAGIC[] = "HPF";
constexpr char STAGING_PATH[] = "/preset_index/staging.tmp";
constexpr char TABLE_TEMP_PATH[] = "/preset_index/folders.tmp";
// The single-file index written by earlier firmware; removed by a rebuild.
constexpr char LEGACY_INDEX_PATH[] = "/synth_preset_index.dat";
constexpr char LEGACY_INDEX_TEMP_PATH[] = "/synth_preset_index.tmp";
static_assert(SYNTH_PRESET_CATALOG_FLAG_FAVORITE == SynthPresetIndex::kFlagFavorite, "favorite flag must match the index");
static_assert(SYNTH_PRESET_CATALOG_ENGINE_MASK == SynthPresetIndex::kFlagEngineMask
              && SYNTH_PRESET_CATALOG_ENGINE_SAMPLER == (SynthPresetIndex::kEngineSampler << SynthPresetIndex::kFlagEngineShift),
              "engine flags must match the index");
static_assert(FOLDER_FILE_MAX_RECORDS < SYNTH_PRESET_HANDLE_STRIDE, "folder positions must fit the handle stride");
static_assert(FOLDER_SLOTS * SYNTH_PRESET_HANDLE_STRIDE <= 0x3FFF, "handles must stay below preset sync NEW_OBJECT");

struct CatalogState {
  bool indexed = false;
  bool automaticRebuildFailed = false;
  uint16_t scanCount = 0;  // canonical preset files, in scan mode
  uint32_t generation = 1;
};

CatalogState catalog;
// The only resident catalog data: folder slot paths and their preset counts.
SynthPresetIndex::FolderTable<FOLDER_SLOTS> catalogFolders;

void bumpGeneration() {
  ++catalog.generation;
}

uint16_t handleFor(uint8_t slot, uint8_t position) {
  return static_cast<uint16_t>(slot * SYNTH_PRESET_HANDLE_STRIDE + position);
}

void folderFilePath(uint8_t slot, char* output, size_t outputLength, const char* extension = ".hpi") {
  snprintf(output, outputLength, "%s/%02X%s", SYNTH_PRESET_INDEX_ROOT, static_cast<unsigned>(slot), extension);
}

// --- Preset files ---------------------------------------------------------

uint8_t synthPresetIndexFlags(const SynthPresetSlot& preset) {
  const uint8_t engine = preset.samplerName[0] ? SynthPresetIndex::kEngineSampler : SynthPresetIndex::kEngineWavetable;
  return static_cast<uint8_t>((preset.favorite ? SynthPresetIndex::kFlagFavorite : 0)
                              | (engine << SynthPresetIndex::kFlagEngineShift));
}

bool objectIdIsEmpty(const uint8_t* objectId) {
  for (size_t i = 0; i < SYNTH_PRESET_OBJECT_ID_LENGTH; ++i) {
    if (objectId[i] != 0) {
      return false;
    }
  }
  return true;
}

void appendObjectIdHex(char* output, size_t outputLength, const uint8_t* objectId) {
  constexpr char HEX_DIGITS[] = "0123456789ABCDEF";
  size_t cursor = strlen(output);
  for (size_t i = 0; i < SYNTH_PRESET_OBJECT_ID_LENGTH && cursor + 2 < outputLength; ++i) {
    output[cursor++] = HEX_DIGITS[objectId[i] >> 4];
    output[cursor++] = HEX_DIGITS[objectId[i] & 0x0F];
  }
  output[cursor] = '\0';
}

// The flat path used before preset files moved into buckets.
void legacyPresetPath(const uint8_t* objectId, char* output, size_t outputLength) {
  snprintf(output, outputLength, "%s/", SYNTH_PRESET_STORAGE_ROOT);
  appendObjectIdHex(output, outputLength, objectId);
  snprintf(output + strlen(output), outputLength - strlen(output), "%s", SYNTH_PRESET_FILE_EXTENSION);
}

void bucketPath(char digit, char* output, size_t outputLength) {
  snprintf(output, outputLength, "%s/%c", SYNTH_PRESET_STORAGE_ROOT, digit);
}

bool readSynthPresetFile(const char* path, SynthPresetSlot& preset) {
  File f = LittleFS.open(path, "r");
  if (!f) {
    return false;
  }
  bool readOk = readSynthPresetPayload(f, preset);
  f.close();
  return readOk && !objectIdIsEmpty(preset.objectId);
}

bool copyFileRange(File& output, const SynthPresetInstrumentSource& source) {
  File input = LittleFS.open(source.path, "r");
  if (!input || uint64_t(source.offset) + source.length > input.size() || !input.seek(source.offset)) {
    return false;
  }
  static uint8_t buffer[256];  // Core 0 only; saves stack in deep save paths
  for (uint32_t remaining = source.length; remaining;) {
    const size_t n = remaining < sizeof(buffer) ? remaining : sizeof(buffer);
    if (input.read(buffer, n) != n || output.write(buffer, n) != n) {
      return false;
    }
    remaining -= n;
  }
  return true;
}

bool writeFileAtomic(const char* path, const uint8_t* first, size_t firstLength,
                     const uint8_t* second, size_t secondLength,
                     const SynthPresetInstrumentSource* tail = nullptr) {
  char tempPath[SYNTH_PRESET_STORAGE_PATH_LENGTH + 4] = {};
  snprintf(tempPath, sizeof(tempPath), "%s.tmp", path);
  LittleFS.remove(tempPath);
  File output = LittleFS.open(tempPath, "w");
  bool ok = output
            && output.write(first, firstLength) == firstLength
            && (!second || output.write(second, secondLength) == secondLength)
            && (!tail || copyFileRange(output, *tail));
  if (output) {
    output.close();
  }
  if (!ok || !LittleFS.rename(tempPath, path)) {
    LittleFS.remove(tempPath);
    return false;
  }
  return true;
}

bool ensureDirectory(const char* path) {
  if (LittleFS.exists(path) || LittleFS.mkdir(path)) {
    return true;
  }
  reportStorageHealthIssue(path, "create failed");
  return false;
}

bool writeSynthPresetFileAtomic(const SynthPresetSlot& preset, const SynthPresetInstrumentSource* instrument) {
  char path[SYNTH_PRESET_STORAGE_PATH_LENGTH] = {};
  char bucket[16] = {};
  if (!synthPresetStoragePath(preset.objectId, path, sizeof(path))) {
    return false;
  }
  bucketPath(SynthPresetIndex::bucketDigit(preset.objectId), bucket, sizeof(bucket));
  SynthPresetFileHeaderBase header = {};
  header.magic[0] = 'H'; header.magic[1] = 'S'; header.magic[2] = 'P';
  header.version = SYNTH_PRESET_FILE_VERSION;
  header.crc32 = crc32(reinterpret_cast<const uint8_t*>(&preset), sizeof(preset));
  if (!ensureDirectory(SYNTH_PRESET_STORAGE_ROOT) || !ensureDirectory(bucket)) {
    return false;
  }
  if (!writeFileAtomic(path,
                       reinterpret_cast<const uint8_t*>(&header), sizeof(header),
                       reinterpret_cast<const uint8_t*>(&preset), sizeof(preset),
                       instrument)) {
    reportStorageHealthIssue(path, "write failed");
    sendToLog("Error: Unable to atomically save synth preset " + std::string(path) + ".");
    return false;
  }
  return true;
}

// Reads and validates a preset stored under its canonical name, in its bucket
// or (before migration) in the flat layout.
bool readCanonicalPresetFile(const uint8_t* fileId, uint16_t handle, SynthPresetSlot& preset, bool report) {
  char path[SYNTH_PRESET_STORAGE_PATH_LENGTH] = {};
  if (!synthPresetStoragePath(fileId, path, sizeof(path))) {
    return false;
  }
  bool read = readSynthPresetFile(path, preset);
  if (!read && !catalog.indexed) {
    legacyPresetPath(fileId, path, sizeof(path));
    read = readSynthPresetFile(path, preset);
  }
  if (!read) {
    if (report) {
      reportStorageHealthIssue(path, "invalid preset");
      sendToLog("Warning: Invalid synth preset file " + std::string(path) + ".");
    }
    return false;
  }
  if (memcmp(preset.objectId, fileId, SYNTH_PRESET_OBJECT_ID_LENGTH) != 0) {
    if (report) {
      reportStorageHealthIssue(path, "filename mismatch");
      sendToLog("Warning: Synth preset filename does not match its object id: " + std::string(path));
    }
    return false;
  }
  normalizeSynthPresetValues(preset);
  normalizeSynthPresetMetadata(preset, handle);
  return true;
}

void entryFromPreset(const SynthPresetSlot& preset, uint16_t handle, SynthPresetCatalogEntry& entry) {
  entry = SynthPresetCatalogEntry{};
  entry.handle = handle;
  entry.flags = synthPresetIndexFlags(preset);
  memcpy(entry.objectId, preset.objectId, sizeof(entry.objectId));
  snprintf(entry.name, sizeof(entry.name), "%s", preset.name);
  snprintf(entry.folderPath, sizeof(entry.folderPath), "%s", preset.folderPath);
}

// --- Directory scan (no index) --------------------------------------------

// Visits canonical preset file names: flat legacy files first, then buckets
// 0..F. Returns false when /presets is missing.
template <typename Visit>
bool forEachCanonicalPresetFile(Visit visit) {
  if (!LittleFS.exists(SYNTH_PRESET_STORAGE_ROOT)) {
    return false;
  }
  uint16_t position = 0;
  auto scan = [&](const char* directoryPath) {
    Dir directory = LittleFS.openDir(directoryPath);
    while (directory.next()) {
      if (!directory.isFile()) {
        continue;
      }
      uint8_t id[SYNTH_PRESET_OBJECT_ID_LENGTH] = {};
      String fileName = directory.fileName();
      if (!SynthPresetIndex::parseCanonicalFileName(fileName.c_str(), id)) {
        continue;
      }
      if (!visit(position, id)) {
        return false;
      }
      if (position < 0xFFFFu) {
        ++position;
      }
    }
    return true;
  };
  if (!scan(SYNTH_PRESET_STORAGE_ROOT)) {
    return true;
  }
  static constexpr char DIGITS[] = "0123456789ABCDEF";
  for (size_t i = 0; i < 16; ++i) {
    char bucket[16] = {};
    bucketPath(DIGITS[i], bucket, sizeof(bucket));
    if (LittleFS.exists(bucket) && !scan(bucket)) {
      return true;
    }
  }
  return true;
}

// --- Index files ----------------------------------------------------------

bool readExact(File& file, uint8_t* data, size_t length) {
  return file.read(data, length) == length;
}

void reportIndexReadFailure(const char* path) {
  reportStorageHealthIssue(path, "read failed");
  sendToLog("Error: Synth preset index read failed: " + std::string(path));
}

// Streams one folder file's records. Returns false on a read or decode error.
template <typename Visit>
bool forEachFolderRecord(uint8_t slot, Visit visit, uint8_t first = 0) {
  const uint8_t count = catalogFolders.counts[slot];
  if (!catalogFolders.used(slot) || first >= count) {
    return true;
  }
  char path[32] = {};
  folderFilePath(slot, path, sizeof(path));
  File file = LittleFS.open(path, "r");
  if (!file || !file.seek(SynthPresetIndex::kHeaderBytes + first * SynthPresetIndex::kRecordBytes)) {
    if (file) {
      file.close();
    }
    reportIndexReadFailure(path);
    return false;
  }
  uint8_t buffer[RECORDS_PER_READ * SynthPresetIndex::kRecordBytes];
  for (uint16_t base = first; base < count;) {
    size_t batch = std::min<size_t>(RECORDS_PER_READ, count - base);
    if (!readExact(file, buffer, batch * SynthPresetIndex::kRecordBytes)) {
      file.close();
      reportIndexReadFailure(path);
      return false;
    }
    for (size_t i = 0; i < batch; ++i) {
      Record record;
      if (!SynthPresetIndex::decodeRecord(buffer + i * SynthPresetIndex::kRecordBytes, record, slot)) {
        file.close();
        reportIndexReadFailure(path);
        return false;
      }
      if (!visit(static_cast<uint8_t>(base + i), record)) {
        file.close();
        return true;
      }
    }
    base = static_cast<uint16_t>(base + batch);
  }
  file.close();
  return true;
}

void entryFromRecord(const Record& record, uint8_t slot, uint8_t position, SynthPresetCatalogEntry& entry) {
  entry = SynthPresetCatalogEntry{};
  entry.handle = handleFor(slot, position);
  entry.flags = record.flags;
  memcpy(entry.objectId, record.id, sizeof(entry.objectId));
  memcpy(entry.name, record.name, sizeof(entry.name));
  entry.name[sizeof(entry.name) - 1] = '\0';
  snprintf(entry.folderPath, sizeof(entry.folderPath), "%s", catalogFolders.paths[slot]);
}

bool loadTable() {
  File file = LittleFS.open(SYNTH_PRESET_INDEX_TABLE_PATH, "r");
  if (!file) {
    return false;
  }
  uint8_t headerBytes[SynthPresetIndex::kHeaderBytes] = {};
  Header header;
  bool ok = file.size() == TABLE_FILE_BYTES
            && readExact(file, headerBytes, sizeof(headerBytes))
            && SynthPresetIndex::decodeHeader(headerBytes, TABLE_FILE_MAGIC, SynthPresetIndex::kTableVersion, header)
            && header.count == FOLDER_SLOTS && header.slot == 0;
  uint32_t crc = SynthPresetIndex::crcBegin();
  for (uint8_t slot = 0; ok && slot < FOLDER_SLOTS; ++slot) {
    uint8_t bytes[SynthPresetIndex::kFolderBytes];
    ok = readExact(file, bytes, sizeof(bytes))
         && SynthPresetIndex::decodeFolder(bytes, catalogFolders.paths[slot]);
    crc = SynthPresetIndex::crcUpdate(crc, bytes, sizeof(bytes));
  }
  file.close();
  return ok && SynthPresetIndex::sealCrc(crc, headerBytes) == header.crc;
}

// Validates one folder file completely and records its count.
bool loadFolderFile(uint8_t slot) {
  char path[32] = {};
  folderFilePath(slot, path, sizeof(path));
  File file = LittleFS.open(path, "r");
  if (!file) {
    return false;
  }
  uint8_t headerBytes[SynthPresetIndex::kHeaderBytes] = {};
  Header header;
  bool ok = readExact(file, headerBytes, sizeof(headerBytes))
            && SynthPresetIndex::decodeHeader(headerBytes, FOLDER_FILE_MAGIC, SynthPresetIndex::kFolderFileVersion, header)
            && header.slot == slot && header.count > 0
            && file.size() == SynthPresetIndex::kHeaderBytes + header.count * SynthPresetIndex::kRecordBytes;
  uint32_t crc = SynthPresetIndex::crcBegin();
  uint8_t buffer[RECORDS_PER_READ * SynthPresetIndex::kRecordBytes];
  for (uint16_t base = 0; ok && base < header.count;) {
    size_t batch = std::min<size_t>(RECORDS_PER_READ, header.count - base);
    size_t length = batch * SynthPresetIndex::kRecordBytes;
    ok = readExact(file, buffer, length);
    for (size_t i = 0; ok && i < batch; ++i) {
      Record record;
      ok = SynthPresetIndex::decodeRecord(buffer + i * SynthPresetIndex::kRecordBytes, record, slot);
    }
    crc = SynthPresetIndex::crcUpdate(crc, buffer, length);
    base = static_cast<uint16_t>(base + batch);
  }
  file.close();
  if (!ok || SynthPresetIndex::sealCrc(crc, headerBytes) != header.crc) {
    return false;
  }
  catalogFolders.counts[slot] = header.count;
  return true;
}

// Loads the table and every folder file. On failure the folder table is
// cleared and `failure` names the stage.
bool loadIndexState(const char*& failure) {
  catalogFolders.clear();
  failure = "interrupted";
  if (LittleFS.exists(SYNTH_PRESET_INDEX_PENDING_PATH)) {
    return false;
  }
  failure = "missing";
  if (!LittleFS.exists(SYNTH_PRESET_INDEX_TABLE_PATH)) {
    return false;
  }
  failure = "invalid";
  bool ok = loadTable();
  for (uint8_t slot = 0; ok && slot < FOLDER_SLOTS; ++slot) {
    ok = !catalogFolders.used(slot) || loadFolderFile(slot);
  }
  if (!ok || catalogFolders.total() > SYNTH_PRESET_MAX_COUNT) {
    catalogFolders.clear();
    return false;
  }
  catalog.indexed = true;
  bumpGeneration();
  return true;
}

uint16_t countCanonicalPresetFiles() {
  uint32_t count = 0;
  forEachCanonicalPresetFile([&](uint16_t, const uint8_t*) {
    ++count;
    return true;
  });
  return static_cast<uint16_t>(std::min<uint32_t>(count, SYNTH_PRESET_MAX_COUNT));
}

void enterScanMode() {
  catalog.indexed = false;
  catalogFolders.clear();
  catalog.scanCount = countCanonicalPresetFiles();
  bumpGeneration();
}

bool markPending() {
  if (!ensureDirectory(SYNTH_PRESET_INDEX_ROOT)) {
    return false;
  }
  File marker = LittleFS.open(SYNTH_PRESET_INDEX_PENDING_PATH, "w");
  if (!marker) {
    reportStorageHealthIssue(SYNTH_PRESET_INDEX_PENDING_PATH, "write failed");
    return false;
  }
  marker.close();
  return true;
}

void clearPending() {
  LittleFS.remove(SYNTH_PRESET_INDEX_PENDING_PATH);
}

// A change failed part-way. The pending marker stays, so later reads and the
// next boot scan the preset files until a rebuild succeeds.
void abandonIndexAfterFailedEdit() {
  reportStorageHealthIssue(SYNTH_PRESET_INDEX_ROOT, "update failed");
  sendToLog("Error: Synth preset index update failed; scanning preset files.");
  enterScanMode();
}

bool writeTable() {
  uint8_t headerBytes[SynthPresetIndex::kHeaderBytes];
  Header header;
  header.count = FOLDER_SLOTS;
  uint32_t crc = SynthPresetIndex::crcBegin();
  for (uint8_t slot = 0; slot < FOLDER_SLOTS; ++slot) {
    uint8_t bytes[SynthPresetIndex::kFolderBytes];
    SynthPresetIndex::encodeFolder(catalogFolders.paths[slot], bytes);
    crc = SynthPresetIndex::crcUpdate(crc, bytes, sizeof(bytes));
  }
  SynthPresetIndex::encodeHeader(TABLE_FILE_MAGIC, SynthPresetIndex::kTableVersion, header, headerBytes);
  header.crc = SynthPresetIndex::sealCrc(crc, headerBytes);
  SynthPresetIndex::encodeHeader(TABLE_FILE_MAGIC, SynthPresetIndex::kTableVersion, header, headerBytes);

  LittleFS.remove(TABLE_TEMP_PATH);
  File file = LittleFS.open(TABLE_TEMP_PATH, "w");
  bool ok = file && file.write(headerBytes, sizeof(headerBytes)) == sizeof(headerBytes);
  for (uint8_t slot = 0; ok && slot < FOLDER_SLOTS; ++slot) {
    uint8_t bytes[SynthPresetIndex::kFolderBytes];
    SynthPresetIndex::encodeFolder(catalogFolders.paths[slot], bytes);
    ok = file.write(bytes, sizeof(bytes)) == sizeof(bytes);
  }
  if (file) {
    file.close();
  }
  if (!ok || !LittleFS.rename(TABLE_TEMP_PATH, SYNTH_PRESET_INDEX_TABLE_PATH)) {
    LittleFS.remove(TABLE_TEMP_PATH);
    reportStorageHealthIssue(SYNTH_PRESET_INDEX_TABLE_PATH, "write failed");
    return false;
  }
  return true;
}

// Writes one folder file from a record source. The source calls emit() for
// each record in order; the file is removed when it ends up empty.
template <typename Source>
bool writeFolderFile(uint8_t slot, Source source, uint8_t& writtenCount) {
  char path[32] = {};
  char tempPath[32] = {};
  folderFilePath(slot, path, sizeof(path));
  folderFilePath(slot, tempPath, sizeof(tempPath), ".tmp");
  LittleFS.remove(tempPath);
  File file = LittleFS.open(tempPath, "w");
  uint8_t placeholder[SynthPresetIndex::kHeaderBytes] = {};
  bool ok = file && file.write(placeholder, sizeof(placeholder)) == sizeof(placeholder);
  uint32_t crc = SynthPresetIndex::crcBegin();
  uint16_t count = 0;
  auto emit = [&](const Record& record) {
    if (!ok || count >= FOLDER_FILE_MAX_RECORDS) {
      ok = false;
      return false;
    }
    Record stored = record;
    stored.folder = slot;
    uint8_t bytes[SynthPresetIndex::kRecordBytes];
    SynthPresetIndex::encodeRecord(stored, bytes);
    ok = file.write(bytes, sizeof(bytes)) == sizeof(bytes);
    crc = SynthPresetIndex::crcUpdate(crc, bytes, sizeof(bytes));
    ++count;
    return ok;
  };
  bool sourceOk = ok && source(emit);
  ok = ok && sourceOk;
  if (ok && count > 0) {
    Header header;
    header.count = static_cast<uint8_t>(count);
    header.slot = slot;
    uint8_t headerBytes[SynthPresetIndex::kHeaderBytes];
    SynthPresetIndex::encodeHeader(FOLDER_FILE_MAGIC, SynthPresetIndex::kFolderFileVersion, header, headerBytes);
    header.crc = SynthPresetIndex::sealCrc(crc, headerBytes);
    SynthPresetIndex::encodeHeader(FOLDER_FILE_MAGIC, SynthPresetIndex::kFolderFileVersion, header, headerBytes);
    ok = file.seek(0) && file.write(headerBytes, sizeof(headerBytes)) == sizeof(headerBytes);
  }
  if (file) {
    file.close();
  }
  if (ok && count == 0) {
    LittleFS.remove(tempPath);
    LittleFS.remove(path);
  } else if (!ok || !LittleFS.rename(tempPath, path)) {
    LittleFS.remove(tempPath);
    reportStorageHealthIssue(path, "write failed");
    return false;
  }
  writtenCount = static_cast<uint8_t>(count);
  return true;
}

enum class FolderEdit : uint8_t { Replace, Append, Remove };

// Rewrites one folder file with a single record replaced, appended or removed.
bool editFolderFile(uint8_t slot, FolderEdit edit, uint8_t position, const Record* record) {
  uint8_t written = 0;
  bool ok = writeFolderFile(slot, [&](auto& emit) {
    bool emitted = true;
    bool readOk = forEachFolderRecord(slot, [&](uint8_t recordPosition, const Record& existing) {
      if (recordPosition == position && edit == FolderEdit::Remove) {
        return true;
      }
      emitted = emit(recordPosition == position && edit == FolderEdit::Replace ? *record : existing);
      return emitted;
    });
    if (readOk && emitted && edit == FolderEdit::Append) {
      emitted = emit(*record);
    }
    return readOk && emitted;
  }, written);
  if (ok) {
    catalogFolders.counts[slot] = written;
  }
  return ok;
}

void recordFromPreset(const SynthPresetSlot& preset, Record& record) {
  record = Record{};
  memcpy(record.id, preset.objectId, sizeof(record.id));
  snprintf(record.name, sizeof(record.name), "%s", preset.name);
  record.flags = synthPresetIndexFlags(preset);
}

// Counts a long rebuild step on the flash-save screen, at most 4 times a second.
struct RebuildProgress {
  const char* task;
  uint16_t total;
  uint64_t lastDrawn = 0;

  void show(uint16_t done) {
    const uint64_t now = readClock();
    if (total > 0 && (lastDrawn == 0 || now - lastDrawn >= 250000ULL || done == total)) {
      lastDrawn = now;
      showFlashSaveProgress(task, done, total);
    }
  }
};

uint16_t countLegacyPresetFiles() {
  uint16_t count = 0;
  Dir directory = LittleFS.openDir(SYNTH_PRESET_STORAGE_ROOT);
  while (directory.next()) {
    uint8_t id[SYNTH_PRESET_OBJECT_ID_LENGTH] = {};
    String fileName = directory.fileName();
    if (directory.isFile() && SynthPresetIndex::parseCanonicalFileName(fileName.c_str(), id) && count < 0xFFFFu) {
      ++count;
    }
  }
  return count;
}

// Moves flat-layout preset files into buckets, a batch per directory listing.
bool migrateLegacyPresetFiles() {
  constexpr uint8_t BATCH = 16;
  RebuildProgress progress{"Moving presets", countLegacyPresetFiles()};
  uint16_t moved = 0;
  progress.show(0);
  for (uint16_t round = 0; round < (SYNTH_PRESET_MAX_COUNT / BATCH) + 2; ++round) {
    uint8_t ids[BATCH][SYNTH_PRESET_OBJECT_ID_LENGTH] = {};
    uint8_t found = 0;
    {
      Dir directory = LittleFS.openDir(SYNTH_PRESET_STORAGE_ROOT);
      while (found < BATCH && directory.next()) {
        String fileName = directory.fileName();
        if (directory.isFile() && SynthPresetIndex::parseCanonicalFileName(fileName.c_str(), ids[found])) {
          ++found;
        }
      }
    }
    if (found == 0) {
      return true;
    }
    for (uint8_t i = 0; i < found; ++i) {
      char from[SYNTH_PRESET_STORAGE_PATH_LENGTH] = {};
      char to[SYNTH_PRESET_STORAGE_PATH_LENGTH] = {};
      char bucket[16] = {};
      legacyPresetPath(ids[i], from, sizeof(from));
      synthPresetStoragePath(ids[i], to, sizeof(to));
      bucketPath(SynthPresetIndex::bucketDigit(ids[i]), bucket, sizeof(bucket));
      if (!ensureDirectory(bucket)) {
        return false;
      }
      if (LittleFS.exists(to)) {
        // Both layouts hold this id; the bucketed file is the newer save.
        LittleFS.remove(from);
      } else if (!LittleFS.rename(from, to)) {
        reportStorageHealthIssue(from, "move failed");
        return false;
      }
      progress.show(++moved);
    }
  }
  return false;
}

// Builds a new index from every valid preset file. Records are staged in one
// sequential file, then split into folder files.
bool rebuildIndexFromDirectory() {
  if (!markPending()) {
    return false;
  }
  if (LittleFS.exists(SYNTH_PRESET_STORAGE_ROOT) && !migrateLegacyPresetFiles()) {
    return false;
  }
  LittleFS.remove(LEGACY_INDEX_PATH);
  LittleFS.remove(LEGACY_INDEX_TEMP_PATH);
  for (uint8_t slot = 0; slot < FOLDER_SLOTS; ++slot) {
    char path[32] = {};
    folderFilePath(slot, path, sizeof(path));
    LittleFS.remove(path);
  }

  catalogFolders.clear();
  catalog.indexed = true;  // every file is bucketed from here on
  LittleFS.remove(STAGING_PATH);
  File staging = LittleFS.open(STAGING_PATH, "w");
  if (!staging) {
    reportStorageHealthIssue(STAGING_PATH, "create failed");
    return false;
  }
  bool ok = true;
  uint16_t total = 0;
  uint16_t visited = 0;
  bool limitReported = false;
  RebuildProgress progress{"Indexing presets", countCanonicalPresetFiles()};
  progress.show(0);
  forEachCanonicalPresetFile([&](uint16_t, const uint8_t* id) {
    progress.show(++visited < progress.total ? visited : progress.total);
    if (total >= SYNTH_PRESET_MAX_COUNT) {
      if (!limitReported) {
        reportStorageHealthIssue(SYNTH_PRESET_STORAGE_ROOT, "too many files");
        limitReported = true;
      }
      return false;
    }
    SynthPresetSlot preset = {};
    if (!readCanonicalPresetFile(id, total, preset, true)) {
      return true;
    }
    char path[SYNTH_PRESET_STORAGE_PATH_LENGTH] = {};
    synthPresetStoragePath(id, path, sizeof(path));
    int slot = catalogFolders.findOrAdd(preset.folderPath);
    if (slot < 0) {
      reportStorageHealthIssue(path, "too many folders");
      return true;
    }
    if (catalogFolders.counts[slot] >= FOLDER_FILE_MAX_RECORDS) {
      reportStorageHealthIssue(path, "folder too large");
      return true;
    }
    Record record;
    recordFromPreset(preset, record);
    record.folder = static_cast<uint8_t>(slot);
    uint8_t bytes[SynthPresetIndex::kRecordBytes];
    SynthPresetIndex::encodeRecord(record, bytes);
    ok = staging.write(bytes, sizeof(bytes)) == sizeof(bytes);
    ++catalogFolders.counts[slot];
    ++total;
    return ok;
  });
  staging.close();

  for (uint8_t slot = 0; ok && slot < FOLDER_SLOTS; ++slot) {
    if (!catalogFolders.used(slot)) {
      continue;
    }
    const uint8_t expected = catalogFolders.counts[slot];
    uint8_t written = 0;
    ok = writeFolderFile(slot, [&](auto& emit) {
      File input = LittleFS.open(STAGING_PATH, "r");
      if (!input) {
        return false;
      }
      uint8_t bytes[SynthPresetIndex::kRecordBytes];
      bool emitted = true;
      while (emitted && readExact(input, bytes, sizeof(bytes))) {
        Record record;
        if (bytes[48] == slot && SynthPresetIndex::decodeRecord(bytes, record, slot)) {
          emitted = emit(record);
        }
      }
      input.close();
      return emitted;
    }, written) && written == expected;
  }
  LittleFS.remove(STAGING_PATH);
  if (!ok || !writeTable()) {
    return false;
  }
  clearPending();
  bumpGeneration();
  sendToLog("Indexed synth presets (" + std::to_string(total) + ").");
  return true;
}
}  // namespace

// --- Public API -----------------------------------------------------------

bool synthPresetStoragePath(const uint8_t* objectId, char* output, size_t outputLength) {
  if (!objectId || !output || outputLength < 49) {
    return false;
  }
  snprintf(output, outputLength, "%s/%c/", SYNTH_PRESET_STORAGE_ROOT, SynthPresetIndex::bucketDigit(objectId));
  appendObjectIdHex(output, outputLength, objectId);
  snprintf(output + strlen(output), outputLength - strlen(output), "%s", SYNTH_PRESET_FILE_EXTENSION);
  return true;
}

bool readSynthPresetPayload(File& file, SynthPresetSlot& preset) {
  SynthPresetFileHeaderBase header = {};
  if (file.read(reinterpret_cast<uint8_t*>(&header), sizeof(header)) != sizeof(header)
      || strncmp(header.magic, "HSP", 3) != 0) return false;
  const size_t width = persistedSynthPresetWidth(header.version);
  if (width == 0 || width > sizeof(preset)) return false;
  if (file.size() < sizeof(header) + width
      || file.read(reinterpret_cast<uint8_t*>(&preset), width) != width
      || !preset.valid
      || header.crc32 != crc32(reinterpret_cast<const uint8_t*>(&preset), width)) return false;
  // Only current sampler sounds carry an instrument after the record.
  if (file.size() != sizeof(header) + width
      && (header.version != SYNTH_PRESET_FILE_VERSION || !preset.samplerName[0])) return false;
  return expandPersistedSynthPreset(reinterpret_cast<uint8_t*>(&preset), sizeof(preset),
      reinterpret_cast<const uint8_t*>(&preset), width,
      factoryDefaults[static_cast<uint8_t>(SettingKey::ArpeggiatorNoteLength)]);
}

bool synthPresetInstrumentRange(const uint8_t* objectId, char* path, size_t pathLength,
                                uint32_t& offset, uint32_t& length) {
  if (!objectId || !fileSystemExists || !synthPresetStoragePath(objectId, path, pathLength)) {
    return false;
  }
  File file = LittleFS.open(path, "r");
  SynthPresetFileHeaderBase header = {};
  if (!file || file.read(reinterpret_cast<uint8_t*>(&header), sizeof(header)) != sizeof(header)
      || strncmp(header.magic, "HSP", 3) != 0 || header.version != SYNTH_PRESET_FILE_VERSION) {
    return false;
  }
  offset = sizeof(header) + sizeof(SynthPresetSlot);
  if (file.size() <= offset) {
    return false;
  }
  length = file.size() - offset;
  return true;
}

uint16_t synthPresetCatalogSamplerCount() {
  uint16_t count = 0;
  auto visit = [&](const SynthPresetCatalogEntry& entry) {
    if (synthPresetCatalogEntryIsSampler(entry)) {
      ++count;
    }
    return true;
  };
  visitSynthPresetCatalogWith(visit);
  return count;
}

bool readSynthPresetFileByObjectId(const uint8_t* objectId, SynthPresetSlot& preset) {
  if (!objectId || !fileSystemExists) {
    return false;
  }
  return readCanonicalPresetFile(objectId, 0, preset, false);
}

void clearSynthPresetCatalog() {
  catalog = CatalogState{};
  catalogFolders.clear();
  bumpGeneration();
}

void loadSynthPresetCatalog() {
  clearSynthPresetCatalog();
  if (!fileSystemExists) {
    reportStorageHealthIssue(SYNTH_PRESET_STORAGE_ROOT, "filesystem unavailable");
    sendToLog("File system not available. Using an empty synth preset library.");
    return;
  }
  const char* failure = nullptr;
  bool loaded = loadIndexState(failure);
  if (loaded) {
    sendToLog("Synth presets loaded from index (" + std::to_string(catalogFolders.total()) + ").");
    return;
  }
  if (!LittleFS.exists(SYNTH_PRESET_STORAGE_ROOT)) {
    reportStorageHealthIssue(SYNTH_PRESET_STORAGE_ROOT, "missing");
    sendToLog("Synth preset directory not found. Using an empty synth preset library.");
    return;
  }
  // A missing index is expected after a firmware-only update. Invalid and
  // interrupted indexes are reported. Either way, boot does not rewrite it.
  if (strcmp(failure, "missing") != 0) {
    reportStorageHealthIssue(SYNTH_PRESET_INDEX_ROOT, failure);
  }
  enterScanMode();
  sendToLog("Synth preset index " + std::string(failure) + "; scanning "
            + std::to_string(catalog.scanCount) + " preset files.");
}

bool synthPresetCatalogIndexed() {
  return catalog.indexed;
}

uint16_t synthPresetCatalogHandleLimit() {
  return catalog.indexed ? static_cast<uint16_t>(FOLDER_SLOTS * SYNTH_PRESET_HANDLE_STRIDE) : catalog.scanCount;
}

uint16_t synthPresetCatalogCount() {
  return catalog.indexed ? catalogFolders.total() : catalog.scanCount;
}

uint32_t synthPresetCatalogGeneration() {
  return catalog.generation;
}

bool readSynthPresetCatalogEntry(uint16_t handle, SynthPresetCatalogEntry& entry) {
  if (!fileSystemExists || handle >= synthPresetCatalogHandleLimit()) {
    return false;
  }
  if (catalog.indexed) {
    const uint8_t slot = static_cast<uint8_t>(handle / SYNTH_PRESET_HANDLE_STRIDE);
    const uint16_t position = handle % SYNTH_PRESET_HANDLE_STRIDE;
    if (!catalogFolders.used(slot) || position >= catalogFolders.counts[slot]) {
      return false;
    }
    char path[32] = {};
    folderFilePath(slot, path, sizeof(path));
    File file = LittleFS.open(path, "r");
    uint8_t bytes[SynthPresetIndex::kRecordBytes];
    Record record;
    bool ok = file
              && file.seek(SynthPresetIndex::kHeaderBytes + position * SynthPresetIndex::kRecordBytes)
              && readExact(file, bytes, sizeof(bytes))
              && SynthPresetIndex::decodeRecord(bytes, record, slot);
    if (file) {
      file.close();
    }
    if (!ok) {
      reportIndexReadFailure(path);
      return false;
    }
    entryFromRecord(record, slot, static_cast<uint8_t>(position), entry);
    return true;
  }
  bool found = false;
  forEachCanonicalPresetFile([&](uint16_t position, const uint8_t* id) {
    if (position != handle) {
      return true;
    }
    SynthPresetSlot preset = {};
    if (readCanonicalPresetFile(id, handle, preset, false)) {
      entryFromPreset(preset, handle, entry);
      found = true;
    }
    return false;
  });
  return found;
}

bool visitSynthPresetCatalogFrom(const char* folderPath, uint16_t skip,
                                 SynthPresetCatalogVisitor visitor, void* context) {
  if (!fileSystemExists || !visitor) {
    return false;
  }
  char normalized[SYNTH_PRESET_FOLDER_LENGTH] = {};
  if (folderPath) {
    snprintf(normalized, sizeof(normalized), "%s", folderPath);
    normalizeSynthPresetFolderPath(normalized, sizeof(normalized));
  }
  if (catalog.indexed) {
    int onlySlot = folderPath ? catalogFolders.find(normalized) : -1;
    if (folderPath && onlySlot < 0) {
      return true;
    }
    bool keepGoing = true;
    for (uint8_t slot = 0; keepGoing && slot < FOLDER_SLOTS; ++slot) {
      if ((onlySlot >= 0 && slot != onlySlot) || !catalogFolders.used(slot)) {
        continue;
      }
      // Whole folders before the first wanted record are skipped unopened.
      if (catalogFolders.counts[slot] <= skip) {
        skip = static_cast<uint16_t>(skip - catalogFolders.counts[slot]);
        continue;
      }
      bool ok = forEachFolderRecord(slot, [&](uint8_t position, const Record& record) {
        SynthPresetCatalogEntry entry;
        entryFromRecord(record, slot, position, entry);
        keepGoing = visitor(context, entry);
        return keepGoing;
      }, static_cast<uint8_t>(skip));
      skip = 0;
      if (!ok) {
        return false;
      }
    }
    return true;
  }
  return forEachCanonicalPresetFile([&](uint16_t position, const uint8_t* id) {
    if (position >= catalog.scanCount) {
      return false;
    }
    SynthPresetSlot preset = {};
    if (!readCanonicalPresetFile(id, position, preset, false)
        || (folderPath && strncmp(preset.folderPath, normalized, sizeof(normalized)) != 0)) {
      return true;
    }
    if (skip > 0) {
      --skip;
      return true;
    }
    SynthPresetCatalogEntry entry;
    entryFromPreset(preset, position, entry);
    return visitor(context, entry);
  });
}

bool visitSynthPresetCatalog(SynthPresetCatalogVisitor visitor, void* context) {
  return visitSynthPresetCatalogFrom(nullptr, 0, visitor, context);
}

bool visitSynthPresetCatalogFolder(const char* folderPath, SynthPresetCatalogVisitor visitor, void* context) {
  return folderPath && visitSynthPresetCatalogFrom(folderPath, 0, visitor, context);
}

uint16_t synthPresetCatalogMatchCount(const char* folderPath) {
  if (catalog.indexed) {
    if (!folderPath) {
      return catalogFolders.total();
    }
    char normalized[SYNTH_PRESET_FOLDER_LENGTH] = {};
    snprintf(normalized, sizeof(normalized), "%s", folderPath);
    normalizeSynthPresetFolderPath(normalized, sizeof(normalized));
    int slot = catalogFolders.find(normalized);
    return slot < 0 ? 0 : catalogFolders.counts[slot];
  }
  uint16_t count = 0;
  auto each = [&](const SynthPresetCatalogEntry&) {
    ++count;
    return true;
  };
  visitSynthPresetCatalogFrom(folderPath, 0,
    [](void* context, const SynthPresetCatalogEntry& entry) {
      return (*static_cast<decltype(each)*>(context))(entry);
    }, &each);
  return count;
}

void visitSynthPresetCatalogFolderPaths(SynthPresetFolderPathVisitor visitor, void* context) {
  if (!fileSystemExists || !visitor) {
    return;
  }
  if (catalog.indexed) {
    for (uint8_t slot = 0; slot < FOLDER_SLOTS; ++slot) {
      if (catalogFolders.used(slot) && catalogFolders.counts[slot] > 0) {
        visitor(context, catalogFolders.paths[slot]);
      }
    }
    return;
  }
  auto each = [&](const SynthPresetCatalogEntry& entry) {
    visitor(context, entry.folderPath);
    return true;
  };
  visitSynthPresetCatalogWith(each);
}

bool findSynthPresetCatalogHandle(const uint8_t* objectId, uint16_t& handle) {
  if (!objectId || objectIdIsEmpty(objectId) || !fileSystemExists) {
    return false;
  }
  bool found = false;
  if (catalog.indexed) {
    for (uint8_t slot = 0; !found && slot < FOLDER_SLOTS; ++slot) {
      forEachFolderRecord(slot, [&](uint8_t position, const Record& record) {
        if (memcmp(record.id, objectId, SYNTH_PRESET_OBJECT_ID_LENGTH) != 0) {
          return true;
        }
        handle = handleFor(slot, position);
        found = true;
        return false;
      });
    }
    return found;
  }
  // Scan mode: file names are object ids, so no preset file needs opening.
  forEachCanonicalPresetFile([&](uint16_t position, const uint8_t* id) {
    if (position >= catalog.scanCount) {
      return false;
    }
    if (memcmp(id, objectId, SYNTH_PRESET_OBJECT_ID_LENGTH) != 0) {
      return true;
    }
    handle = position;
    found = true;
    return false;
  });
  return found;
}

bool ensureSynthPresetCatalogIndexed(bool userInitiated) {
  if (catalog.indexed) {
    return true;
  }
  if (!fileSystemExists || (!userInitiated && catalog.automaticRebuildFailed)) {
    return false;
  }
  beginFlashSafeWrite();
  bool ok = rebuildIndexFromDirectory();
  if (!ok) {
    sendToLog("Error: Unable to index synth presets; scanning preset files.");
    enterScanMode();
    catalog.automaticRebuildFailed = true;
  }
  endFlashSafeWrite();
  return ok;
}

SynthPresetStoreResult storeSynthPresetInCatalog(uint16_t handle,
                                                 const SynthPresetSlot& preset,
                                                 uint16_t& storedHandle,
                                                 const SynthPresetInstrumentSource* instrument) {
  if (!fileSystemExists) {
    reportStorageHealthIssue(SYNTH_PRESET_STORAGE_ROOT, "filesystem unavailable");
    return SynthPresetStoreResult::StorageError;
  }
  if (!ensureSynthPresetCatalogIndexed(true)) {
    return SynthPresetStoreResult::StorageError;
  }
  uint16_t existing = 0;
  const bool replacing = findSynthPresetCatalogHandle(preset.objectId, existing);
  if (handle != SYNTH_PRESET_CATALOG_NEW_HANDLE && (!replacing || existing != handle)) {
    return SynthPresetStoreResult::HandleMismatch;
  }
  if (!replacing && synthPresetCatalogCount() >= SYNTH_PRESET_MAX_COUNT) {
    return SynthPresetStoreResult::LibraryFull;
  }
  // A sampler sound keeps the instrument already in its file unless given one.
  static char keptPath[SYNTH_PRESET_STORAGE_PATH_LENGTH];  // Core 0 only
  SynthPresetInstrumentSource kept;
  const bool sampler = preset.samplerName[0] != '\0';
  if (!sampler) {
    instrument = nullptr;
  } else if (!instrument) {
    if (!synthPresetInstrumentRange(preset.objectId, keptPath, sizeof(keptPath), kept.offset, kept.length)) {
      return SynthPresetStoreResult::MissingInstrument;
    }
    kept.path = keptPath;
    instrument = &kept;
  }
  if (sampler) {
    SynthPresetCatalogEntry previous;
    const bool wasSampler = replacing && readSynthPresetCatalogEntry(existing, previous)
                            && synthPresetCatalogEntryIsSampler(previous);
    if (!wasSampler && synthPresetCatalogSamplerCount() >= SYNTH_PRESET_MAX_SAMPLER_COUNT) {
      return SynthPresetStoreResult::SamplerLimit;
    }
  }
  const int oldSlot = replacing ? existing / SYNTH_PRESET_HANDLE_STRIDE : -1;
  const uint8_t oldPosition = static_cast<uint8_t>(existing % SYNTH_PRESET_HANDLE_STRIDE);
  int targetSlot = catalogFolders.find(preset.folderPath);
  const bool moving = replacing && targetSlot != oldSlot;
  // Limits are checked before anything is written.
  if (targetSlot >= 0 && (!replacing || moving)
      && catalogFolders.counts[targetSlot] >= SYNTH_PRESET_FOLDER_MAX_PRESETS) {
    return SynthPresetStoreResult::FolderFull;
  }
  const bool oldFolderEmpties = moving && catalogFolders.counts[oldSlot] == 1;
  if (targetSlot < 0 && catalogFolders.firstFree() < 0 && !oldFolderEmpties) {
    return SynthPresetStoreResult::TooManyFolders;
  }
  Record record;
  recordFromPreset(preset, record);

  beginFlashSafeWrite();
  bool ok = markPending();
  const bool changed = ok;
  ok = ok && writeSynthPresetFileAtomic(preset, instrument);
  if (ok && replacing && !moving) {
    ok = editFolderFile(static_cast<uint8_t>(oldSlot), FolderEdit::Replace, oldPosition, &record);
    storedHandle = existing;
  } else if (ok) {
    bool tableChanged = false;
    if (moving) {
      ok = editFolderFile(static_cast<uint8_t>(oldSlot), FolderEdit::Remove, oldPosition, nullptr);
      if (ok && catalogFolders.counts[oldSlot] == 0) {
        catalogFolders.release(static_cast<uint8_t>(oldSlot));
        tableChanged = true;
      }
    }
    if (ok && targetSlot < 0) {
      targetSlot = catalogFolders.findOrAdd(preset.folderPath);
      tableChanged = true;
      ok = targetSlot >= 0;
    }
    if (ok) {
      const uint8_t position = catalogFolders.counts[targetSlot];
      ok = editFolderFile(static_cast<uint8_t>(targetSlot), FolderEdit::Append, 0, &record);
      storedHandle = handleFor(static_cast<uint8_t>(targetSlot), position);
    }
    ok = ok && (!tableChanged || writeTable());
  }
  if (ok) {
    clearPending();
    bumpGeneration();
  } else if (changed) {
    abandonIndexAfterFailedEdit();
  }
  endFlashSafeWrite();
  return ok ? SynthPresetStoreResult::Stored : SynthPresetStoreResult::StorageError;
}

bool removeSynthPresetFromCatalog(uint16_t handle) {
  if (!fileSystemExists || !ensureSynthPresetCatalogIndexed(true)) {
    return false;
  }
  SynthPresetCatalogEntry entry;
  char path[SYNTH_PRESET_STORAGE_PATH_LENGTH] = {};
  if (!readSynthPresetCatalogEntry(handle, entry)
      || !synthPresetStoragePath(entry.objectId, path, sizeof(path))) {
    return false;
  }
  const uint8_t slot = static_cast<uint8_t>(handle / SYNTH_PRESET_HANDLE_STRIDE);
  const uint8_t position = static_cast<uint8_t>(handle % SYNTH_PRESET_HANDLE_STRIDE);
  beginFlashSafeWrite();
  if (!markPending()) {
    endFlashSafeWrite();
    return false;
  }
  if (!LittleFS.remove(path)) {
    reportStorageHealthIssue(path, "delete failed");
    sendToLog("Error: Unable to delete synth preset " + std::string(path) + ".");
    clearPending();
    endFlashSafeWrite();
    return false;
  }
  bool ok = editFolderFile(slot, FolderEdit::Remove, position, nullptr);
  if (ok && catalogFolders.counts[slot] == 0) {
    catalogFolders.release(slot);
    ok = writeTable();
  }
  if (ok) {
    clearPending();
    bumpGeneration();
  } else {
    abandonIndexAfterFailedEdit();
  }
  endFlashSafeWrite();
  return true;
}

const char* synthPresetStoreResultMessage(SynthPresetStoreResult result) {
  switch (result) {
    case SynthPresetStoreResult::Stored: return "Saved";
    case SynthPresetStoreResult::LibraryFull: return "Synth preset library is full.";
    case SynthPresetStoreResult::FolderFull: return "Synth preset folder is full.";
    case SynthPresetStoreResult::TooManyFolders: return "Too many synth preset folders.";
    case SynthPresetStoreResult::HandleMismatch: return "Synth preset handle does not match its object id.";
    case SynthPresetStoreResult::SamplerLimit: return "The library already holds 128 sampler sounds.";
    case SynthPresetStoreResult::MissingInstrument: return "The sampler sound has no instrument.";
    case SynthPresetStoreResult::StorageError: return "Unable to save the synth preset.";
  }
  return "Unable to save the synth preset.";
}
