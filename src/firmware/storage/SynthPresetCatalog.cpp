#include "../FirmwareModule.h"
#include "../app/DiagnosticsTiming.h"
#include "Settings.h"
#include "StorageHealth.h"
#include "SynthPresetCatalog.h"
#include "SynthPresetIndexCodec.h"
#include "SynthPresetStorage.h"

namespace {
using SynthPresetIndex::Header;
using SynthPresetIndex::Record;

constexpr size_t RECORDS_PER_READ = 8;

struct CatalogState {
  bool indexed = false;
  bool automaticRebuildFailed = false;
  uint16_t count = 0;            // records (indexed) or canonical files (scan)
  uint16_t directoryCount = 0;
  uint32_t directoryHash = 0;
  uint32_t generation = 1;
};

CatalogState catalog;
// The only resident catalog data: distinct folder paths of indexed records.
SynthPresetIndex::FolderTable<SYNTH_PRESET_FOLDER_MAX_COUNT> catalogFolders;

void bumpGeneration() {
  ++catalog.generation;
}

void enterScanMode(uint16_t directoryCount, uint32_t directoryHash) {
  catalog.indexed = false;
  catalog.directoryCount = directoryCount;
  catalog.directoryHash = directoryHash;
  catalog.count = std::min<uint16_t>(directoryCount, SYNTH_PRESET_MAX_COUNT);
  catalogFolders.clear();
  bumpGeneration();
}

// --- Preset files ---------------------------------------------------------

bool objectIdIsEmpty(const uint8_t* objectId) {
  for (size_t i = 0; i < SYNTH_PRESET_OBJECT_ID_LENGTH; ++i) {
    if (objectId[i] != 0) {
      return false;
    }
  }
  return true;
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

bool writeSynthPresetFileAtomic(const SynthPresetSlot& preset) {
  char path[SYNTH_PRESET_STORAGE_PATH_LENGTH] = {};
  char tempPath[SYNTH_PRESET_STORAGE_PATH_LENGTH] = {};
  if (!synthPresetStoragePath(preset.objectId, path, sizeof(path))) {
    return false;
  }
  snprintf(tempPath, sizeof(tempPath), "%s.tmp", path);
  SynthPresetFileHeaderBase header = {};
  header.magic[0] = 'H'; header.magic[1] = 'S'; header.magic[2] = 'P';
  header.version = SYNTH_PRESET_FILE_VERSION;
  header.crc32 = crc32(reinterpret_cast<const uint8_t*>(&preset), sizeof(preset));

  File existing = LittleFS.open(path, "r");
  if (existing && existing.size() == sizeof(header) + sizeof(preset)) {
    SynthPresetFileHeaderBase existingHeader = {};
    bool unchanged = existing.read(reinterpret_cast<uint8_t*>(&existingHeader), sizeof(existingHeader)) == sizeof(existingHeader)
                     && existingHeader.version == header.version
                     && existingHeader.crc32 == header.crc32;
    existing.close();
    if (unchanged) {
      return true;
    }
  } else if (existing) {
    existing.close();
  }

  if (!LittleFS.exists(SYNTH_PRESET_STORAGE_ROOT) && !LittleFS.mkdir(SYNTH_PRESET_STORAGE_ROOT)) {
    reportStorageHealthIssue(SYNTH_PRESET_STORAGE_ROOT, "create failed");
    sendToLog("Error: Unable to create /presets.");
    return false;
  }
  LittleFS.remove(tempPath);
  File output = LittleFS.open(tempPath, "w");
  bool ok = output
            && output.write(reinterpret_cast<uint8_t*>(&header), sizeof(header)) == sizeof(header)
            && output.write(reinterpret_cast<const uint8_t*>(&preset), sizeof(preset)) == sizeof(preset);
  if (output) {
    output.close();
  }
  if (!ok || !LittleFS.rename(tempPath, path)) {
    LittleFS.remove(tempPath);
    reportStorageHealthIssue(path, "write failed");
    sendToLog("Error: Unable to atomically save synth preset " + std::string(path) + ".");
    return false;
  }
  return true;
}

void entryFromPreset(const SynthPresetSlot& preset, uint16_t handle, SynthPresetCatalogEntry& entry) {
  entry = SynthPresetCatalogEntry{};
  entry.handle = handle;
  entry.flags = preset.favorite ? SynthPresetIndex::kFlagFavorite : 0;
  memcpy(entry.objectId, preset.objectId, sizeof(entry.objectId));
  snprintf(entry.name, sizeof(entry.name), "%s", preset.name);
  snprintf(entry.folderPath, sizeof(entry.folderPath), "%s", preset.folderPath);
}

// Reads and validates the preset stored under a canonical file name.
bool readCanonicalPresetFile(const uint8_t* fileId, uint16_t handle, SynthPresetSlot& preset, bool report) {
  char path[SYNTH_PRESET_STORAGE_PATH_LENGTH] = {};
  if (!synthPresetStoragePath(fileId, path, sizeof(path))) {
    return false;
  }
  if (!readSynthPresetFile(path, preset)) {
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

// --- Directory listing ----------------------------------------------------

// Visits canonical preset file names in directory order. Returns false when
// the directory is missing.
template <typename Visit>
bool forEachCanonicalPresetFile(Visit visit) {
  if (!LittleFS.exists(SYNTH_PRESET_STORAGE_ROOT)) {
    return false;
  }
  Dir directory = LittleFS.openDir(SYNTH_PRESET_STORAGE_ROOT);
  uint16_t position = 0;
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
      break;
    }
    if (position < 0xFFFFu) {
      ++position;
    }
  }
  return true;
}

bool describePresetDirectory(uint16_t& count, uint32_t& hash) {
  uint32_t total = 0;
  uint32_t sum = 0;
  bool present = forEachCanonicalPresetFile([&](uint16_t, const uint8_t* id) {
    ++total;
    sum += SynthPresetIndex::idHash(id);
    return true;
  });
  count = static_cast<uint16_t>(std::min<uint32_t>(total, 0xFFFFu));
  hash = sum;
  return present;
}

// --- Index reads ----------------------------------------------------------

bool readExact(File& file, uint8_t* data, size_t length) {
  return file.read(data, length) == length;
}

bool openIndexAt(File& file, size_t offset) {
  file = LittleFS.open(SYNTH_PRESET_INDEX_FILE_PATH, "r");
  if (!file) {
    return false;
  }
  if (!file.seek(offset)) {
    file.close();
    return false;
  }
  return true;
}

void entryFromRecord(const Record& record, uint16_t handle, SynthPresetCatalogEntry& entry) {
  entry = SynthPresetCatalogEntry{};
  entry.handle = handle;
  entry.flags = record.flags;
  memcpy(entry.objectId, record.id, sizeof(entry.objectId));
  memcpy(entry.name, record.name, sizeof(entry.name));
  entry.name[sizeof(entry.name) - 1] = '\0';
  snprintf(entry.folderPath, sizeof(entry.folderPath), "%s", catalogFolders.paths[record.folder]);
}

void reportIndexReadFailure() {
  reportStorageHealthIssue(SYNTH_PRESET_INDEX_FILE_PATH, "read failed");
  sendToLog("Error: Synth preset index read failed.");
}

// Streams records [0, count) of the index in handle order. folderBound is
// the folder count of the index on disk; a write in progress may already
// have compacted the resident table.
template <typename Visit>
bool forEachIndexRecord(Visit visit, uint8_t folderBound) {
  if (catalog.count == 0) {
    return true;
  }
  File file;
  if (!openIndexAt(file, SynthPresetIndex::recordOffset(0))) {
    reportIndexReadFailure();
    return false;
  }
  uint8_t buffer[RECORDS_PER_READ * SynthPresetIndex::kRecordBytes];
  bool ok = true;
  for (uint16_t base = 0; base < catalog.count && ok;) {
    size_t batch = std::min<size_t>(RECORDS_PER_READ, catalog.count - base);
    if (!readExact(file, buffer, batch * SynthPresetIndex::kRecordBytes)) {
      ok = false;
      break;
    }
    for (size_t i = 0; i < batch; ++i) {
      Record record;
      if (!SynthPresetIndex::decodeRecord(buffer + i * SynthPresetIndex::kRecordBytes,
                                          record,
                                          folderBound)) {
        ok = false;
        break;
      }
      if (!visit(static_cast<uint16_t>(base + i), record)) {
        file.close();
        return true;
      }
    }
    base = static_cast<uint16_t>(base + batch);
  }
  file.close();
  if (!ok) {
    reportIndexReadFailure();
  }
  return ok;
}

template <typename Visit>
bool forEachIndexRecord(Visit visit) {
  return forEachIndexRecord(visit, catalogFolders.count);
}

// Validates the whole index against the current preset directory, and loads
// its folder table. Leaves the catalog in scan mode on any mismatch.
bool loadIndexState(uint16_t directoryCount, uint32_t directoryHash, const char*& failure) {
  failure = "missing";
  File file = LittleFS.open(SYNTH_PRESET_INDEX_FILE_PATH, "r");
  if (!file) {
    return false;
  }
  failure = "invalid";
  uint8_t headerBytes[SynthPresetIndex::kHeaderBytes] = {};
  Header header;
  if (!readExact(file, headerBytes, sizeof(headerBytes))
      || !SynthPresetIndex::decodeHeader(headerBytes, header, SYNTH_PRESET_MAX_COUNT, SYNTH_PRESET_FOLDER_MAX_COUNT)
      || file.size() != SynthPresetIndex::fileBytes(header.count, header.folderCount)) {
    file.close();
    return false;
  }

  uint32_t crc = SynthPresetIndex::crcBegin();
  uint8_t buffer[RECORDS_PER_READ * SynthPresetIndex::kRecordBytes];
  for (uint16_t base = 0; base < header.count;) {
    size_t batch = std::min<size_t>(RECORDS_PER_READ, header.count - base);
    size_t length = batch * SynthPresetIndex::kRecordBytes;
    if (!readExact(file, buffer, length)) {
      file.close();
      return false;
    }
    for (size_t i = 0; i < batch; ++i) {
      Record record;
      if (!SynthPresetIndex::decodeRecord(buffer + i * SynthPresetIndex::kRecordBytes, record, header.folderCount)) {
        file.close();
        return false;
      }
    }
    crc = SynthPresetIndex::crcUpdate(crc, buffer, length);
    base = static_cast<uint16_t>(base + batch);
  }

  catalogFolders.clear();
  for (uint8_t slot = 0; slot < header.folderCount; ++slot) {
    uint8_t folderBytes[SynthPresetIndex::kFolderBytes] = {};
    if (!readExact(file, folderBytes, sizeof(folderBytes))
        || !SynthPresetIndex::decodeFolder(folderBytes, catalogFolders.paths[slot])) {
      file.close();
      catalogFolders.clear();
      return false;
    }
    crc = SynthPresetIndex::crcUpdate(crc, folderBytes, sizeof(folderBytes));
    catalogFolders.count = static_cast<uint8_t>(slot + 1);
  }
  file.close();
  crc = SynthPresetIndex::crcFinish(SynthPresetIndex::crcUpdate(crc, headerBytes, 16));
  if (crc != header.crc) {
    catalogFolders.clear();
    return false;
  }
  if (header.directoryCount != directoryCount || header.directoryHash != directoryHash) {
    failure = "stale";
    catalogFolders.clear();
    return false;
  }
  catalog.indexed = true;
  catalog.count = header.count;
  catalog.directoryCount = directoryCount;
  catalog.directoryHash = directoryHash;
  bumpGeneration();
  return true;
}

// Reloads the resident state from the index on disk after a failed write.
void reloadAfterFailedWrite() {
  uint16_t directoryCount = 0;
  uint32_t directoryHash = 0;
  describePresetDirectory(directoryCount, directoryHash);
  const char* failure = nullptr;
  if (!loadIndexState(directoryCount, directoryHash, failure)) {
    enterScanMode(directoryCount, directoryHash);
  }
}

// --- Index writes ---------------------------------------------------------

struct IndexWriter {
  File file;
  uint32_t crc = SynthPresetIndex::crcBegin();
  uint16_t records = 0;
  bool ok = false;

  bool begin() {
    LittleFS.remove(SYNTH_PRESET_INDEX_TEMP_FILE_PATH);
    file = LittleFS.open(SYNTH_PRESET_INDEX_TEMP_FILE_PATH, "w");
    uint8_t placeholder[SynthPresetIndex::kHeaderBytes] = {};
    ok = file && file.write(placeholder, sizeof(placeholder)) == sizeof(placeholder);
    return ok;
  }

  bool writeBytes(const uint8_t* data, size_t length) {
    ok = ok && file.write(data, length) == length;
    crc = SynthPresetIndex::crcUpdate(crc, data, length);
    return ok;
  }

  bool writeRecord(const Record& record) {
    uint8_t bytes[SynthPresetIndex::kRecordBytes];
    SynthPresetIndex::encodeRecord(record, bytes);
    ++records;
    return writeBytes(bytes, sizeof(bytes));
  }

  // Writes the folder table and header, then replaces the live index.
  bool finish(uint16_t directoryCount, uint32_t directoryHash) {
    for (uint8_t slot = 0; slot < catalogFolders.count && ok; ++slot) {
      uint8_t bytes[SynthPresetIndex::kFolderBytes];
      SynthPresetIndex::encodeFolder(catalogFolders.paths[slot], bytes);
      writeBytes(bytes, sizeof(bytes));
    }
    Header header;
    header.count = records;
    header.folderCount = catalogFolders.count;
    header.directoryCount = directoryCount;
    header.directoryHash = directoryHash;
    uint8_t headerBytes[SynthPresetIndex::kHeaderBytes];
    SynthPresetIndex::encodeHeader(header, headerBytes);
    header.crc = SynthPresetIndex::crcFinish(SynthPresetIndex::crcUpdate(crc, headerBytes, 16));
    SynthPresetIndex::encodeHeader(header, headerBytes);
    ok = ok && file.seek(0) && file.write(headerBytes, sizeof(headerBytes)) == sizeof(headerBytes);
    if (file) {
      file.close();
    }
    if (!ok || !LittleFS.rename(SYNTH_PRESET_INDEX_TEMP_FILE_PATH, SYNTH_PRESET_INDEX_FILE_PATH)) {
      LittleFS.remove(SYNTH_PRESET_INDEX_TEMP_FILE_PATH);
      reportStorageHealthIssue(SYNTH_PRESET_INDEX_FILE_PATH, "write failed");
      sendToLog("Error: Unable to save the synth preset index.");
      return false;
    }
    catalog.indexed = true;
    catalog.count = records;
    catalog.directoryCount = directoryCount;
    catalog.directoryHash = directoryHash;
    bumpGeneration();
    return true;
  }

  void abandon() {
    if (file) {
      file.close();
    }
    LittleFS.remove(SYNTH_PRESET_INDEX_TEMP_FILE_PATH);
  }
};

bool recordFromPreset(const SynthPresetSlot& preset, Record& record) {
  record = Record{};
  memcpy(record.id, preset.objectId, sizeof(record.id));
  snprintf(record.name, sizeof(record.name), "%s", preset.name);
  int slot = catalogFolders.findOrAdd(preset.folderPath);
  if (slot < 0) {
    return false;
  }
  record.folder = static_cast<uint8_t>(slot);
  record.flags = preset.favorite ? SynthPresetIndex::kFlagFavorite : 0;
  return true;
}

// Builds a new index from every valid canonical preset file.
bool rebuildIndexFromDirectory() {
  uint16_t directoryCount = 0;
  uint32_t directoryHash = 0;
  if (!describePresetDirectory(directoryCount, directoryHash)) {
    directoryCount = 0;
    directoryHash = 0;
  }
  catalogFolders.clear();
  IndexWriter writer;
  if (!writer.begin()) {
    writer.abandon();
    reportStorageHealthIssue(SYNTH_PRESET_INDEX_TEMP_FILE_PATH, "create failed");
    reloadAfterFailedWrite();
    return false;
  }
  bool limitReported = false;
  forEachCanonicalPresetFile([&](uint16_t, const uint8_t* id) {
    if (writer.records >= SYNTH_PRESET_MAX_COUNT) {
      if (!limitReported) {
        reportStorageHealthIssue(SYNTH_PRESET_STORAGE_ROOT, "too many files");
        sendToLog("Warning: Synth preset directory exceeds its preset limit.");
        limitReported = true;
      }
      return false;
    }
    SynthPresetSlot preset = {};
    if (!readCanonicalPresetFile(id, writer.records, preset, true)) {
      return true;
    }
    Record record;
    if (!recordFromPreset(preset, record)) {
      char path[SYNTH_PRESET_STORAGE_PATH_LENGTH] = {};
      synthPresetStoragePath(id, path, sizeof(path));
      reportStorageHealthIssue(path, "too many folders");
      return true;
    }
    return writer.writeRecord(record);
  });
  if (!writer.ok || !writer.finish(directoryCount, directoryHash)) {
    writer.abandon();
    reloadAfterFailedWrite();
    return false;
  }
  sendToLog("Indexed synth presets (" + std::to_string(catalog.count) + ").");
  return true;
}

enum class IndexEdit : uint8_t { Replace, Append, Remove };

// Rewrites the index with one record replaced, appended or removed. Unused
// folders are dropped. The caller has already changed the preset file.
SynthPresetStoreResult rewriteIndex(IndexEdit edit, uint16_t handle, const SynthPresetSlot* preset,
                                    uint16_t directoryCount, uint32_t directoryHash) {
  // Pass 1: folder usage without the edited record.
  uint16_t usage[SYNTH_PRESET_FOLDER_MAX_COUNT] = {};
  uint8_t editedOldFolder = 0xFF;
  bool readOk = forEachIndexRecord([&](uint16_t recordHandle, const Record& record) {
    if (edit != IndexEdit::Append && recordHandle == handle) {
      editedOldFolder = record.folder;
    } else {
      ++usage[record.folder];
    }
    return true;
  });
  if (!readOk) {
    return SynthPresetStoreResult::StorageError;
  }

  // Compact the folder table in place; remap old slots to new ones.
  const uint8_t diskFolderCount = catalogFolders.count;
  uint8_t remap[SYNTH_PRESET_FOLDER_MAX_COUNT] = {};
  uint8_t kept = 0;
  int targetOldSlot = preset ? catalogFolders.find(preset->folderPath) : -1;
  for (uint8_t slot = 0; slot < catalogFolders.count; ++slot) {
    if (usage[slot] == 0 && static_cast<int>(slot) != targetOldSlot) {
      remap[slot] = 0xFF;
      continue;
    }
    if (kept != slot) {
      memcpy(catalogFolders.paths[kept], catalogFolders.paths[slot], SynthPresetIndex::kFolderBytes);
    }
    remap[slot] = kept++;
  }
  catalogFolders.count = kept;

  Record editedRecord;
  if (preset) {
    if (targetOldSlot >= 0) {
      uint16_t presetsInFolder = usage[targetOldSlot];
      bool entering = edit == IndexEdit::Append || editedOldFolder != static_cast<uint8_t>(targetOldSlot);
      if (entering && presetsInFolder >= SYNTH_PRESET_FOLDER_MAX_PRESETS) {
        reloadAfterFailedWrite();
        return SynthPresetStoreResult::FolderFull;
      }
    }
    if (!recordFromPreset(*preset, editedRecord)) {
      reloadAfterFailedWrite();
      return SynthPresetStoreResult::TooManyFolders;
    }
  }

  IndexWriter writer;
  if (!writer.begin()) {
    writer.abandon();
    reloadAfterFailedWrite();
    return SynthPresetStoreResult::StorageError;
  }
  readOk = forEachIndexRecord([&](uint16_t recordHandle, const Record& record) {
    if (recordHandle == handle && edit == IndexEdit::Remove) {
      return true;
    }
    if (recordHandle == handle && edit == IndexEdit::Replace) {
      return writer.writeRecord(editedRecord);
    }
    Record copy = record;
    copy.folder = remap[record.folder];
    return copy.folder != 0xFF && writer.writeRecord(copy);
  }, diskFolderCount);
  if (readOk && edit == IndexEdit::Append) {
    writer.writeRecord(editedRecord);
  }
  if (!readOk || !writer.ok || !writer.finish(directoryCount, directoryHash)) {
    writer.abandon();
    reloadAfterFailedWrite();
    return SynthPresetStoreResult::StorageError;
  }
  return SynthPresetStoreResult::Stored;
}

// Checks folder limits for a store without changing anything, so a rejected
// preset never reaches its file.
SynthPresetStoreResult preflightStore(bool replacing, uint16_t handle, const SynthPresetSlot& preset) {
  uint16_t usage[SYNTH_PRESET_FOLDER_MAX_COUNT] = {};
  uint8_t editedOldFolder = 0xFF;
  bool readOk = forEachIndexRecord([&](uint16_t recordHandle, const Record& record) {
    if (replacing && recordHandle == handle) {
      editedOldFolder = record.folder;
    } else {
      ++usage[record.folder];
    }
    return true;
  });
  if (!readOk) {
    return SynthPresetStoreResult::StorageError;
  }
  int target = catalogFolders.find(preset.folderPath);
  if (target >= 0) {
    bool entering = !replacing || editedOldFolder != static_cast<uint8_t>(target);
    return entering && usage[target] >= SYNTH_PRESET_FOLDER_MAX_PRESETS
             ? SynthPresetStoreResult::FolderFull
             : SynthPresetStoreResult::Stored;
  }
  uint8_t usedFolders = 0;
  for (uint8_t slot = 0; slot < catalogFolders.count; ++slot) {
    usedFolders += usage[slot] > 0 ? 1 : 0;
  }
  return usedFolders >= SYNTH_PRESET_FOLDER_MAX_COUNT
           ? SynthPresetStoreResult::TooManyFolders
           : SynthPresetStoreResult::Stored;
}

// A preset file changed but its index edit failed. Remove the index so every
// later read (and the next boot) scans the files, until a rebuild succeeds.
void dropIndexAfterFailedEdit() {
  LittleFS.remove(SYNTH_PRESET_INDEX_FILE_PATH);
  uint16_t directoryCount = 0;
  uint32_t directoryHash = 0;
  describePresetDirectory(directoryCount, directoryHash);
  enterScanMode(directoryCount, directoryHash);
}

bool directoryContains(const uint8_t* objectId) {
  char path[SYNTH_PRESET_STORAGE_PATH_LENGTH] = {};
  return synthPresetStoragePath(objectId, path, sizeof(path)) && LittleFS.exists(path);
}
}  // namespace

// --- Public API -----------------------------------------------------------

bool synthPresetStoragePath(const uint8_t* objectId, char* output, size_t outputLength) {
  if (!objectId || !output || outputLength < 47) {
    return false;
  }
  size_t cursor = snprintf(output, outputLength, "%s/", SYNTH_PRESET_STORAGE_ROOT);
  constexpr char HEX_DIGITS[] = "0123456789ABCDEF";
  for (size_t i = 0; i < SYNTH_PRESET_OBJECT_ID_LENGTH; ++i) {
    if (cursor + 2 >= outputLength) {
      output[0] = '\0';
      return false;
    }
    output[cursor++] = HEX_DIGITS[objectId[i] >> 4];
    output[cursor++] = HEX_DIGITS[objectId[i] & 0x0F];
  }
  snprintf(output + cursor, outputLength - cursor, "%s", SYNTH_PRESET_FILE_EXTENSION);
  return true;
}

bool readSynthPresetPayload(File& file, SynthPresetSlot& preset) {
  SynthPresetFileHeaderBase header = {};
  if (file.read(reinterpret_cast<uint8_t*>(&header), sizeof(header)) != sizeof(header)
      || strncmp(header.magic, "HSP", 3) != 0) return false;
  const size_t width = persistedSynthPresetWidth(header.version);
  if (width == 0 || width > sizeof(preset)) return false;
  if (file.size() != sizeof(header) + width
      || file.read(reinterpret_cast<uint8_t*>(&preset), width) != width
      || !preset.valid
      || header.crc32 != crc32(reinterpret_cast<const uint8_t*>(&preset), width)) return false;
  return expandPersistedSynthPreset(reinterpret_cast<uint8_t*>(&preset), sizeof(preset),
      reinterpret_cast<const uint8_t*>(&preset), width,
      factoryDefaults[static_cast<uint8_t>(SettingKey::ArpeggiatorNoteLength)]);
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
  uint16_t directoryCount = 0;
  uint32_t directoryHash = 0;
  if (!describePresetDirectory(directoryCount, directoryHash)) {
    reportStorageHealthIssue(SYNTH_PRESET_STORAGE_ROOT, "missing");
    sendToLog("Synth preset directory not found. Using an empty synth preset library.");
    return;
  }
  const char* failure = nullptr;
  if (loadIndexState(directoryCount, directoryHash, failure)) {
    sendToLog("Synth presets loaded from index (" + std::to_string(catalog.count) + ").");
    return;
  }
  // A missing index is expected after a firmware-only update. Invalid and
  // stale indexes are reported. Either way, boot does not rewrite it.
  if (strcmp(failure, "missing") != 0) {
    reportStorageHealthIssue(SYNTH_PRESET_INDEX_FILE_PATH, failure);
  }
  if (directoryCount > SYNTH_PRESET_MAX_COUNT) {
    reportStorageHealthIssue(SYNTH_PRESET_STORAGE_ROOT, "too many files");
  }
  enterScanMode(directoryCount, directoryHash);
  sendToLog("Synth preset index " + std::string(failure) + "; scanning "
            + std::to_string(catalog.count) + " preset files.");
}

bool synthPresetCatalogIndexed() {
  return catalog.indexed;
}

uint16_t synthPresetCatalogHandleLimit() {
  return catalog.count;
}

uint16_t synthPresetCatalogCount() {
  return catalog.count;
}

uint32_t synthPresetCatalogGeneration() {
  return catalog.generation;
}

bool readSynthPresetCatalogEntry(uint16_t handle, SynthPresetCatalogEntry& entry) {
  if (!fileSystemExists || handle >= catalog.count) {
    return false;
  }
  if (catalog.indexed) {
    File file;
    uint8_t bytes[SynthPresetIndex::kRecordBytes];
    Record record;
    if (!openIndexAt(file, SynthPresetIndex::recordOffset(handle))) {
      reportIndexReadFailure();
      return false;
    }
    bool ok = readExact(file, bytes, sizeof(bytes))
              && SynthPresetIndex::decodeRecord(bytes, record, catalogFolders.count);
    file.close();
    if (!ok) {
      reportIndexReadFailure();
      return false;
    }
    entryFromRecord(record, handle, entry);
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

bool visitSynthPresetCatalog(SynthPresetCatalogVisitor visitor, void* context) {
  if (!fileSystemExists || !visitor) {
    return false;
  }
  if (catalog.indexed) {
    return forEachIndexRecord([&](uint16_t handle, const Record& record) {
      SynthPresetCatalogEntry entry;
      entryFromRecord(record, handle, entry);
      return visitor(context, entry);
    });
  }
  return forEachCanonicalPresetFile([&](uint16_t position, const uint8_t* id) {
    if (position >= catalog.count) {
      return false;
    }
    SynthPresetSlot preset = {};
    if (!readCanonicalPresetFile(id, position, preset, false)) {
      return true;
    }
    SynthPresetCatalogEntry entry;
    entryFromPreset(preset, position, entry);
    return visitor(context, entry);
  });
}

bool findSynthPresetCatalogHandle(const uint8_t* objectId, uint16_t& handle) {
  if (!objectId || objectIdIsEmpty(objectId) || !fileSystemExists) {
    return false;
  }
  bool found = false;
  if (catalog.indexed) {
    forEachIndexRecord([&](uint16_t recordHandle, const Record& record) {
      if (memcmp(record.id, objectId, SYNTH_PRESET_OBJECT_ID_LENGTH) != 0) {
        return true;
      }
      handle = recordHandle;
      found = true;
      return false;
    });
    return found;
  }
  // Scan mode: file names are object ids, so no preset file needs opening.
  forEachCanonicalPresetFile([&](uint16_t position, const uint8_t* id) {
    if (position >= catalog.count) {
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
  endFlashSafeWrite();
  if (!ok) {
    catalog.automaticRebuildFailed = true;
  }
  return ok;
}

SynthPresetStoreResult storeSynthPresetInCatalog(uint16_t handle,
                                                 const SynthPresetSlot& preset,
                                                 uint16_t& storedHandle) {
  if (!fileSystemExists) {
    reportStorageHealthIssue(SYNTH_PRESET_STORAGE_ROOT, "filesystem unavailable");
    return SynthPresetStoreResult::StorageError;
  }
  if (!ensureSynthPresetCatalogIndexed(true)) {
    return SynthPresetStoreResult::StorageError;
  }
  uint16_t existing = 0;
  bool replacing = findSynthPresetCatalogHandle(preset.objectId, existing);
  if (handle != SYNTH_PRESET_CATALOG_NEW_HANDLE && (!replacing || existing != handle)) {
    return SynthPresetStoreResult::HandleMismatch;
  }
  if (!replacing && catalog.count >= SYNTH_PRESET_MAX_COUNT) {
    return SynthPresetStoreResult::LibraryFull;
  }
  SynthPresetStoreResult preflight = preflightStore(replacing, existing, preset);
  if (preflight != SynthPresetStoreResult::Stored) {
    return preflight;
  }

  beginFlashSafeWrite();
  const bool fileExisted = directoryContains(preset.objectId);
  SynthPresetStoreResult result = SynthPresetStoreResult::StorageError;
  if (writeSynthPresetFileAtomic(preset)) {
    uint16_t directoryCount = catalog.directoryCount;
    uint32_t directoryHash = catalog.directoryHash;
    if (!fileExisted) {
      ++directoryCount;
      directoryHash += SynthPresetIndex::idHash(preset.objectId);
    }
    result = rewriteIndex(replacing ? IndexEdit::Replace : IndexEdit::Append,
                          replacing ? existing : catalog.count,
                          &preset,
                          directoryCount,
                          directoryHash);
    if (result == SynthPresetStoreResult::Stored) {
      storedHandle = replacing ? existing : static_cast<uint16_t>(catalog.count - 1);
    } else {
      dropIndexAfterFailedEdit();
    }
  }
  endFlashSafeWrite();
  return result;
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
  beginFlashSafeWrite();
  bool ok = LittleFS.remove(path);
  if (!ok) {
    reportStorageHealthIssue(path, "delete failed");
    sendToLog("Error: Unable to delete synth preset " + std::string(path) + ".");
  } else {
    uint16_t directoryCount = catalog.directoryCount > 0 ? catalog.directoryCount - 1 : 0;
    uint32_t directoryHash = catalog.directoryHash - SynthPresetIndex::idHash(entry.objectId);
    if (rewriteIndex(IndexEdit::Remove, handle, nullptr, directoryCount, directoryHash)
        != SynthPresetStoreResult::Stored) {
      dropIndexAfterFailedEdit();
    }
  }
  endFlashSafeWrite();
  return ok;
}

const char* synthPresetStoreResultMessage(SynthPresetStoreResult result) {
  switch (result) {
    case SynthPresetStoreResult::Stored: return "Saved";
    case SynthPresetStoreResult::LibraryFull: return "Synth preset library is full.";
    case SynthPresetStoreResult::FolderFull: return "Synth preset folder is full.";
    case SynthPresetStoreResult::TooManyFolders: return "Too many synth preset folders.";
    case SynthPresetStoreResult::HandleMismatch: return "Synth preset handle does not match its object id.";
    case SynthPresetStoreResult::StorageError: return "Unable to save the synth preset.";
  }
  return "Unable to save the synth preset.";
}
