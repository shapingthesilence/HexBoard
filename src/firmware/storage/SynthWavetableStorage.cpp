#if HEXBOARD_FIRMWARE_UNITY

#include "../FirmwareModule.h"

uint32_t currentSynthWavetableReferenceCrc(const CurrentSynthWavetableReferenceFile& reference) {
  uint8_t bytes[sizeof(reference.name) + sizeof(reference.folderPath)] = {};
  memcpy(bytes, reference.name, sizeof(reference.name));
  memcpy(bytes + sizeof(reference.name), reference.folderPath, sizeof(reference.folderPath));
  return crc32(bytes, sizeof(bytes));
}

void saveCurrentSynthWavetableReference() {
  if (!fileSystemExists || !currentSynthWavetableReferenceValid) {
    return;
  }
  CurrentSynthWavetableReferenceFile reference = {};
  reference.magic[0] = 'C'; reference.magic[1] = 'W'; reference.magic[2] = 'T';
  reference.version = CURRENT_SYNTH_WAVETABLE_REFERENCE_VERSION;
  snprintf(reference.name, sizeof(reference.name), "%s", currentSynthWavetableName);
  snprintf(reference.folderPath, sizeof(reference.folderPath), "%s", currentSynthWavetableFolderPath);
  normalizeSynthWavetableFolderPath(reference.folderPath, sizeof(reference.folderPath));
  reference.crc32 = currentSynthWavetableReferenceCrc(reference);

  File f = LittleFS.open(CURRENT_SYNTH_WAVETABLE_REFERENCE_FILE_PATH, "w");
  if (!f) {
    sendToLog("Error: Unable to open /current_wavetable.dat for writing.");
    return;
  }
  size_t written = f.write(reinterpret_cast<uint8_t*>(&reference), sizeof(reference));
  f.close();
  if (written != sizeof(reference)) {
    sendToLog("Error: Incomplete current wavetable reference write.");
  }
}

bool loadCurrentSynthWavetableReference() {
  if (!fileSystemExists) {
    return false;
  }
  File f = LittleFS.open(CURRENT_SYNTH_WAVETABLE_REFERENCE_FILE_PATH, "r");
  if (!f) {
    return false;
  }
  CurrentSynthWavetableReferenceFile reference = {};
  size_t bytesRead = f.read(reinterpret_cast<uint8_t*>(&reference), sizeof(reference));
  f.close();
  if (bytesRead != sizeof(reference)
      || strncmp(reference.magic, "CWT", 3) != 0
      || reference.version != CURRENT_SYNTH_WAVETABLE_REFERENCE_VERSION
      || currentSynthWavetableReferenceCrc(reference) != reference.crc32
      || !reference.name[0]) {
    sendToLog("Invalid current wavetable reference. Using settings fallback.");
    return false;
  }
  reference.name[sizeof(reference.name) - 1] = '\0';
  reference.folderPath[sizeof(reference.folderPath) - 1] = '\0';
  normalizeSynthWavetableFolderPath(reference.folderPath, sizeof(reference.folderPath));
  normalizeSynthWavetableBuiltInFolderAlias(reference.folderPath, sizeof(reference.folderPath));
  setCurrentSynthWavetableReference(reference.folderPath, reference.name);
  sendToLog("Current wavetable reference loaded.");
  return true;
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
  setCurrentSynthWavetableReference("/User", "UserTbl");
  currWave = WAVEFORM_BASIC_WAVETABLE;
  settings[static_cast<uint8_t>(SettingKey::Waveform)] = WAVEFORM_BASIC_WAVETABLE;
  loadedSynthWaveform = currWave;
  snprintf(loadedSynthWavetableName, sizeof(loadedSynthWavetableName), "%s", currentSynthWavetableName);
  snprintf(loadedSynthWavetableFolderPath, sizeof(loadedSynthWavetableFolderPath), "%s", currentSynthWavetableFolderPath);
  resetSynthRenderCaches();
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

constexpr char SYNTH_WAVETABLE_CATALOG_FILE_PATH[] = "/synth_wavetables.dat";

void applyDefaultSynthWavetables() {
  synthWavetables.clear();
  synthWavetables.reserve(8);
}

void synthWavetableObjectIdToSamplePath(const uint8_t* objectId, char* output, size_t outputLength) {
  static constexpr char hex[] = "0123456789ABCDEF";
  if (outputLength == 0) {
    return;
  }
  size_t index = 0;
  const char prefix[] = "/wt_";
  for (size_t i = 0; prefix[i] != '\0' && index + 1 < outputLength; ++i) {
    output[index++] = prefix[i];
  }
  for (size_t i = 0; i < 8 && index + 2 < outputLength; ++i) {
    output[index++] = hex[(objectId[i] >> 4) & 0x0F];
    output[index++] = hex[objectId[i] & 0x0F];
  }
  if (index + 5 < outputLength) {
    output[index++] = '.';
    output[index++] = 'w';
    output[index++] = 't';
    output[index++] = 'b';
  }
  output[index] = '\0';
}

void synthWavetableObjectIdToLegacySamplePath(const uint8_t* objectId, char* output, size_t outputLength) {
  static constexpr char hex[] = "0123456789ABCDEF";
  if (outputLength == 0) {
    return;
  }
  size_t index = 0;
  const char prefix[] = "/wt_";
  for (size_t i = 0; prefix[i] != '\0' && index + 1 < outputLength; ++i) {
    output[index++] = prefix[i];
  }
  for (size_t i = 0; i < SYNTH_WAVETABLE_OBJECT_ID_LENGTH && index + 2 < outputLength; ++i) {
    output[index++] = hex[(objectId[i] >> 4) & 0x0F];
    output[index++] = hex[objectId[i] & 0x0F];
  }
  if (index + 5 < outputLength) {
    output[index++] = '.';
    output[index++] = 'w';
    output[index++] = 't';
    output[index++] = 'b';
  }
  output[index] = '\0';
}

void removeSynthWavetableSampleFiles(const SynthWavetableSlot& wavetable) {
  if (wavetable.samplePath[0]) {
    LittleFS.remove(wavetable.samplePath);
  }
  char legacySamplePath[SYNTH_WAVETABLE_SAMPLE_PATH_LENGTH] = {};
  synthWavetableObjectIdToLegacySamplePath(wavetable.objectId, legacySamplePath, sizeof(legacySamplePath));
  if (legacySamplePath[0] && strcmp(legacySamplePath, wavetable.samplePath) != 0) {
    LittleFS.remove(legacySamplePath);
  }
}

bool synthWavetableSampleFileExists(const SynthWavetableSlot& wavetable) {
  File f = LittleFS.open(wavetable.samplePath, "r");
  if (f) {
    f.close();
    return true;
  }
  char legacySamplePath[SYNTH_WAVETABLE_SAMPLE_PATH_LENGTH] = {};
  synthWavetableObjectIdToLegacySamplePath(wavetable.objectId, legacySamplePath, sizeof(legacySamplePath));
  if (legacySamplePath[0] && strcmp(legacySamplePath, wavetable.samplePath) != 0) {
    f = LittleFS.open(legacySamplePath, "r");
    if (f) {
      f.close();
      return true;
    }
  }
  return false;
}

void pruneMissingSynthWavetables() {
  size_t before = synthWavetables.size();
  synthWavetables.erase(
    std::remove_if(synthWavetables.begin(), synthWavetables.end(), [](const SynthWavetableSlot& wavetable) {
      return !wavetable.valid || !synthWavetableSampleFileExists(wavetable);
    }),
    synthWavetables.end()
  );
  if (synthWavetables.size() != before) {
    sendToLog("Removed missing synth wavetable catalog entries.");
  }
}

bool synthWavetableObjectIdIsEmpty(const SynthWavetableSlot& wavetable) {
  for (uint8_t byteValue : wavetable.objectId) {
    if (byteValue != 0) {
      return false;
    }
  }
  return true;
}

void generateSynthWavetableObjectId(SynthWavetableSlot& wavetable, const uint8_t* samples) {
  uint32_t hash = 2166136261u;
  auto mixByte = [&](uint8_t value) {
    hash ^= value;
    hash *= 16777619u;
  };
  for (const char* p = "wavetable:"; *p; ++p) {
    mixByte(static_cast<uint8_t>(*p));
  }
  for (const char* p = wavetable.folderPath; *p; ++p) {
    mixByte(static_cast<uint8_t>(*p));
  }
  mixByte(':');
  for (const char* p = wavetable.name; *p; ++p) {
    mixByte(static_cast<uint8_t>(*p));
  }
  if (samples) {
    uint32_t sampleCrc = crc32(samples, SYNTH_WAVETABLE_SAMPLE_BYTES);
    for (uint8_t shift = 0; shift < 32; shift += 8) {
      mixByte(static_cast<uint8_t>((sampleCrc >> shift) & 0xFF));
    }
  }
  for (size_t i = 0; i < sizeof(wavetable.objectId); ++i) {
    hash ^= static_cast<uint8_t>(i * 17u);
    hash *= 16777619u;
    wavetable.objectId[i] = static_cast<uint8_t>((hash >> ((i % 4) * 8)) & 0xFF);
  }
}

void normalizeSynthWavetableMetadata(SynthWavetableSlot& wavetable, const uint8_t* samples = nullptr) {
  if (!wavetable.name[0]) {
    snprintf(wavetable.name, sizeof(wavetable.name), "Wavetable");
  }
  if (!wavetable.folderPath[0]) {
    snprintf(wavetable.folderPath, sizeof(wavetable.folderPath), "%s", SYNTH_WAVETABLE_ROOT_FOLDER);
  }
  wavetable.name[sizeof(wavetable.name) - 1] = '\0';
  wavetable.folderPath[sizeof(wavetable.folderPath) - 1] = '\0';
  normalizeSynthWavetableFolderPath(wavetable.folderPath, sizeof(wavetable.folderPath));
  if (synthWavetableObjectIdIsEmpty(wavetable)) {
    generateSynthWavetableObjectId(wavetable, samples);
  }
  synthWavetableObjectIdToSamplePath(wavetable.objectId, wavetable.samplePath, sizeof(wavetable.samplePath));
}

void compactSynthWavetables() {
  synthWavetables.erase(
    std::remove_if(synthWavetables.begin(), synthWavetables.end(), [](const SynthWavetableSlot& wavetable) {
      return !wavetable.valid;
    }),
    synthWavetables.end()
  );
  if (synthWavetables.size() > SYNTH_WAVETABLE_MAX_COUNT) {
    synthWavetables.resize(SYNTH_WAVETABLE_MAX_COUNT);
  }
  for (SynthWavetableSlot& wavetable : synthWavetables) {
    normalizeSynthWavetableMetadata(wavetable);
  }
}

uint32_t synthWavetableCatalogCrc(const SynthWavetableSlot* wavetables, size_t wavetableCount) {
  return crc32(reinterpret_cast<const uint8_t*>(wavetables), sizeof(SynthWavetableSlot) * wavetableCount);
}

void save_synth_wavetables() {
  if (!fileSystemExists) {
    sendToLog("File system not available.");
    return;
  }
  compactSynthWavetables();
  File f = LittleFS.open(SYNTH_WAVETABLE_CATALOG_FILE_PATH, "w");
  if (!f) {
    sendToLog("Error: Unable to open /synth_wavetables.dat for writing.");
    return;
  }
  SynthWavetableFileHeader header;
  header.magic[0] = 'S'; header.magic[1] = 'Y'; header.magic[2] = 'W';
  header.version = SYNTH_WAVETABLE_FILE_VERSION;
  header.count = static_cast<uint16_t>(synthWavetables.size());
  header.reserved = 0;
  header.crc32 = synthWavetableCatalogCrc(synthWavetables.data(), synthWavetables.size());
  f.write(reinterpret_cast<uint8_t*>(&header), sizeof(header));
  if (!synthWavetables.empty()) {
    f.write(reinterpret_cast<uint8_t*>(synthWavetables.data()), sizeof(SynthWavetableSlot) * synthWavetables.size());
  }
  f.close();
  sendToLog("Synth wavetables saved (" + std::to_string(synthWavetables.size()) + ").");
}

void load_synth_wavetables() {
  applyDefaultSynthWavetables();
  if (!fileSystemExists) {
    sendToLog("File system not available. Using built-in wavetables.");
    return;
  }
  File f = LittleFS.open(SYNTH_WAVETABLE_CATALOG_FILE_PATH, "r");
  if (!f) {
    sendToLog("Synth wavetable catalog not found. Using built-in wavetables.");
    return;
  }
  SynthWavetableFileHeader header;
  if (f.readBytes(reinterpret_cast<char*>(&header), sizeof(header)) != sizeof(header)) {
    sendToLog("Error: Failed to read synth wavetable catalog header.");
    f.close();
    applyDefaultSynthWavetables();
    return;
  }
  if (strncmp(header.magic, "SYW", 3) != 0 || header.version != SYNTH_WAVETABLE_FILE_VERSION
      || header.count > SYNTH_WAVETABLE_MAX_COUNT) {
    sendToLog("Invalid synth wavetable catalog. Using built-in wavetables.");
    f.close();
    applyDefaultSynthWavetables();
    return;
  }
  std::vector<SynthWavetableSlot> loaded(header.count);
  size_t dataSize = sizeof(SynthWavetableSlot) * loaded.size();
  size_t bytesRead = dataSize == 0 ? 0 : f.read(reinterpret_cast<uint8_t*>(loaded.data()), dataSize);
  f.close();
  if (bytesRead != dataSize) {
    sendToLog("Warning: Synth wavetable catalog incomplete. Using built-in wavetables.");
    applyDefaultSynthWavetables();
    return;
  }
  if (synthWavetableCatalogCrc(loaded.data(), loaded.size()) != header.crc32) {
    sendToLog("Synth wavetable catalog CRC32 mismatch. Using built-in wavetables.");
    applyDefaultSynthWavetables();
    return;
  }
  synthWavetables.clear();
  synthWavetables.reserve(loaded.size());
  for (SynthWavetableSlot& wavetable : loaded) {
    if (!wavetable.valid) {
      continue;
    }
    normalizeSynthWavetableMetadata(wavetable);
    if (!synthWavetableSampleFileExists(wavetable)) {
      sendToLog("Skipping wavetable with missing sample file: " + std::string(wavetable.name));
      continue;
    }
    synthWavetables.push_back(wavetable);
  }
}

int findSynthWavetableByObjectId(const uint8_t* objectId) {
  for (size_t i = 0; i < synthWavetables.size(); ++i) {
    if (synthWavetables[i].valid
        && memcmp(synthWavetables[i].objectId, objectId, SYNTH_WAVETABLE_OBJECT_ID_LENGTH) == 0) {
      return static_cast<int>(i);
    }
  }
  return -1;
}

int findSynthWavetableByFolderAndName(const char* folderPath, const char* name) {
  char normalizedFolder[SYNTH_WAVETABLE_FOLDER_LENGTH] = {};
  snprintf(normalizedFolder, sizeof(normalizedFolder), "%s", folderPath && folderPath[0] ? folderPath : SYNTH_WAVETABLE_ROOT_FOLDER);
  normalizeSynthWavetableFolderPath(normalizedFolder, sizeof(normalizedFolder));
  for (size_t i = 0; i < synthWavetables.size(); ++i) {
    if (synthWavetables[i].valid
        && strcmp(synthWavetables[i].folderPath, normalizedFolder) == 0
        && strcmp(synthWavetables[i].name, name) == 0) {
      return static_cast<int>(i);
    }
  }
  return -1;
}

int chooseSynthWavetableWriteSlot(const SynthWavetableSlot& wavetable) {
  int existing = findSynthWavetableByObjectId(wavetable.objectId);
  if (existing >= 0) {
    return existing;
  }
  existing = findSynthWavetableByFolderAndName(wavetable.folderPath, wavetable.name);
  if (existing >= 0) {
    return existing;
  }
  if (synthWavetables.size() < SYNTH_WAVETABLE_MAX_COUNT) {
    return static_cast<int>(synthWavetables.size());
  }
  return -1;
}

bool writeSynthWavetableSampleFile(const SynthWavetableSlot& wavetable, const uint8_t* samples) {
  File f = LittleFS.open(wavetable.samplePath, "w");
  if (!f) {
    sendToLog("Error: Unable to open wavetable sample file " + std::string(wavetable.samplePath) + ".");
    return false;
  }
  size_t written = f.write(samples, SYNTH_WAVETABLE_SAMPLE_BYTES);
  f.close();
  if (written != SYNTH_WAVETABLE_SAMPLE_BYTES) {
    sendToLog("Error: Incomplete wavetable sample file write.");
    return false;
  }
  return true;
}

bool loadSynthWavetableFromCatalog(const char* folderPath, const char* name) {
  int index = findSynthWavetableByFolderAndName(folderPath, name);
  if (index < 0) {
    return false;
  }
  SynthWavetableSlot& wavetable = synthWavetables[index];
  File f = LittleFS.open(wavetable.samplePath, "r");
  if (!f) {
    char legacySamplePath[SYNTH_WAVETABLE_SAMPLE_PATH_LENGTH] = {};
    synthWavetableObjectIdToLegacySamplePath(wavetable.objectId, legacySamplePath, sizeof(legacySamplePath));
    if (legacySamplePath[0] && strcmp(legacySamplePath, wavetable.samplePath) != 0) {
      f = LittleFS.open(legacySamplePath, "r");
    }
    if (!f) {
      sendToLog("Missing wavetable sample file for " + std::string(wavetable.name));
      return false;
    }
    sendToLog("Loaded legacy wavetable sample path for " + std::string(wavetable.name));
  }
  size_t bytesRead = f.read(&activeSynthWaveTable[0][0], SYNTH_WAVETABLE_SAMPLE_BYTES);
  f.close();
  if (bytesRead != SYNTH_WAVETABLE_SAMPLE_BYTES) {
    sendToLog("Incomplete wavetable sample file for " + std::string(wavetable.name));
    return false;
  }
  setActiveSynthWaveFrameCount(SYNTH_WAVETABLE_FRAME_COUNT);
  return true;
}
#endif  // HEXBOARD_FIRMWARE_UNITY
