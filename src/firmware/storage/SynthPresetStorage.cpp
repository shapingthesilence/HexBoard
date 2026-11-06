#include "../FirmwareModule.h"
#include "../app/DiagnosticsTiming.h"
#include "../app/RuntimeDefaults.h"
#include "../menu/MenuAndDisplay.h"
#include "../synth/SynthAudio.h"
#include "../synth/SynthDefaults.h"
#include "Settings.h"
#include "StorageHealth.h"
#include "SynthPresetCatalog.h"
#include "SynthPresetStorage.h"
#include "SynthWavetableStorage.h"

namespace {
constexpr uint16_t CURRENT_SYNTH_PRESET_NONE = 0xFFFFu;

uint16_t currentSynthPresetIndex = CURRENT_SYNTH_PRESET_NONE;
uint8_t currentSynthPresetObjectId[SYNTH_PRESET_OBJECT_ID_LENGTH] = {};
char currentSynthPresetName[SYNTH_PRESET_NAME_LENGTH] = "Current";
bool currentSynthPresetIsBlank = false;
// Catalog generation that currentSynthPresetIndex was last checked against.
uint32_t currentSynthPresetCatalogGeneration = 0;
SynthPresetSlot currentSynthPresetLoadedSlot = {};
bool currentSynthPresetLoadedSlotValid = false;
SynthPresetSlot pendingSynthProfileDraft = {};
SynthProfileReference pendingSynthProfileReference = {};
uint8_t pendingSynthProfileIndex = DEFAULT_PROFILE_INDEX;
bool pendingSynthProfileStateValid = false;

bool objectIdIsEmpty(const uint8_t* objectId, size_t objectIdLength) {
  for (size_t i = 0; i < objectIdLength; ++i) {
    if (objectId[i] != 0) {
      return false;
    }
  }
  return true;
}

void forgetCurrentSynthPreset(const char* name, bool blank) {
  currentSynthPresetIndex = CURRENT_SYNTH_PRESET_NONE;
  memset(currentSynthPresetObjectId, 0, sizeof(currentSynthPresetObjectId));
  snprintf(currentSynthPresetName, sizeof(currentSynthPresetName), "%s", name);
  currentSynthPresetIsBlank = blank;
  currentSynthPresetLoadedSlotValid = false;
}

// True while the tracked preset is still in the catalog. Its handle and name
// are refreshed only after the catalog changes.
bool currentSynthPresetTracked() {
  if (objectIdIsEmpty(currentSynthPresetObjectId, sizeof(currentSynthPresetObjectId))) {
    return false;
  }
  const uint32_t generation = synthPresetCatalogGeneration();
  if (currentSynthPresetCatalogGeneration == generation) {
    return currentSynthPresetIndex != CURRENT_SYNTH_PRESET_NONE;
  }
  currentSynthPresetCatalogGeneration = generation;
  uint16_t handle = 0;
  SynthPresetCatalogEntry entry;
  if (findSynthPresetCatalogHandle(currentSynthPresetObjectId, handle)
      && readSynthPresetCatalogEntry(handle, entry)) {
    currentSynthPresetIndex = handle;
    snprintf(currentSynthPresetName, sizeof(currentSynthPresetName), "%s", entry.name);
    return true;
  }
  forgetCurrentSynthPreset("Current", false);
  return false;
}

void trackCurrentSynthPreset(uint16_t handle, const SynthPresetSlot& preset) {
  currentSynthPresetIndex = handle;
  memcpy(currentSynthPresetObjectId, preset.objectId, sizeof(currentSynthPresetObjectId));
  snprintf(currentSynthPresetName, sizeof(currentSynthPresetName), "%s", preset.name);
  currentSynthPresetIsBlank = false;
  currentSynthPresetLoadedSlot = preset;
  currentSynthPresetLoadedSlotValid = true;
  currentSynthPresetCatalogGeneration = synthPresetCatalogGeneration();
}

void trackBlankSynthPreset() {
  forgetCurrentSynthPreset("Blank", true);
}

bool trackCurrentSynthPresetObjectId(const uint8_t* objectId) {
  uint16_t handle = 0;
  SynthPresetSlot preset = {};
  if (!objectId
      || !findSynthPresetCatalogHandle(objectId, handle)
      || !readSynthPresetFromCatalog(handle, preset)) {
    return false;
  }
  trackCurrentSynthPreset(handle, preset);
  return true;
}

}  // namespace

void generateSynthPresetObjectId(SynthPresetSlot& preset, uint16_t fallbackIndex) {
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
  mixByte(static_cast<uint8_t>(fallbackIndex));
  if (fallbackIndex > 0xFFu) {
    mixByte(static_cast<uint8_t>(fallbackIndex >> 8));
  }

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

void normalizeSynthPresetWavetableReference(SynthPresetSlot& preset) {
  preset.wavetableName[sizeof(preset.wavetableName) - 1] = '\0';
  preset.wavetableFolderPath[sizeof(preset.wavetableFolderPath) - 1] = '\0';
  if (!preset.wavetableName[0]) {
    snprintf(preset.wavetableFolderPath,
             sizeof(preset.wavetableFolderPath),
             "%s",
             SYNTH_WAVETABLE_BUILTIN_FOLDER);
    snprintf(preset.wavetableName,
             sizeof(preset.wavetableName),
             "%s",
             SYNTH_WAVETABLE_BASIC_NAME);
    setSynthPresetValueForKey(preset,
                              SettingKey::SynthWavetablePosition,
                              SYNTH_WAVETABLE_POSITION_DEFAULT);
  }
  if (!preset.wavetableFolderPath[0]) {
    snprintf(preset.wavetableFolderPath, sizeof(preset.wavetableFolderPath), "%s", SYNTH_WAVETABLE_BUILTIN_FOLDER);
  }
  normalizeSynthWavetableFolderPath(preset.wavetableFolderPath, sizeof(preset.wavetableFolderPath));
}

void normalizeSynthPresetMetadata(SynthPresetSlot& preset, uint16_t fallbackIndex) {
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

void normalizeSynthPresetValues(SynthPresetSlot& preset) {
  for (size_t i = 0; i < synthPresetKeys.size(); ++i) {
    if (synthPresetKeys[i] == SettingKey::PlaybackMode) {
      preset.values[i] = normalizeSynthPlaybackMode(preset.values[i]);
    } else if (synthPresetKeys[i] == SettingKey::ArpeggiatorNoteLength) {
      preset.values[i] = constrain(preset.values[i], 1, 100);
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
    case SettingKey::ArpeggiatorNoteLength: return arpeggiatorNoteLength;
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
  // Wavetable names are globally unique; folders are organization metadata.
  // Loading resolves that metadata (for example, Built In to /Built In)
  // without changing the selected source or modifying the patch.
  return strncmp(currentSynthWavetableName, preset.wavetableName, sizeof(preset.wavetableName)) == 0;
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
  return strcmp(currentSynthWavetableName, SYNTH_WAVETABLE_BASIC_NAME) == 0;
}

const char* currentSynthPresetDisplayName() {
  if (!currentSynthPresetIsBlank) {
    currentSynthPresetTracked();
  }
  return currentSynthPresetName[0] ? currentSynthPresetName : "Current";
}

bool currentSynthPresetRuntimeModified() {
  if (currentSynthPresetIsBlank) {
    return !currentRuntimeMatchesBlankSynthPreset();
  }
  if (!currentSynthPresetTracked()) {
    return false;
  }
  if (!currentSynthPresetLoadedSlotValid
      || memcmp(currentSynthPresetLoadedSlot.objectId,
                currentSynthPresetObjectId,
                sizeof(currentSynthPresetLoadedSlot.objectId)) != 0) {
    currentSynthPresetLoadedSlotValid =
      readSynthPresetFileByObjectId(currentSynthPresetObjectId, currentSynthPresetLoadedSlot);
  }
  return currentSynthPresetLoadedSlotValid
    ? !currentRuntimeMatchesSynthPresetValues(currentSynthPresetLoadedSlot)
    : false;
}

bool currentSynthPresetCatalogIndex(uint16_t& presetIndex) {
  if (currentSynthPresetIsBlank || !currentSynthPresetTracked()) {
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
  sendToLog("Loaded blank synth preset.");
}

namespace {
bool synthPresetHeaderBaseValid(const SynthPresetFileHeaderBase& header) {
  return strncmp(header.magic, "HSP", 3) == 0
         && header.version == SYNTH_PRESET_FILE_VERSION;
}

void synthProfileDraftPath(uint8_t profileIndex, char* output, size_t outputLength) {
  snprintf(output, outputLength, "/.synth_profile_%u.hsp", static_cast<unsigned>(profileIndex));
}

bool readSynthProfileDraft(uint8_t profileIndex, SynthPresetSlot& preset) {
  char path[32] = {};
  synthProfileDraftPath(profileIndex, path, sizeof(path));
  File f = LittleFS.open(path, "r");
  if (!f) {
    return false;
  }
  bool ok = readSynthPresetPayload(f, preset);
  f.close();
  return ok;
}

bool writeSynthProfileDraftAtomic(uint8_t profileIndex, const SynthPresetSlot& preset) {
  char path[32] = {};
  char tempPath[36] = {};
  synthProfileDraftPath(profileIndex, path, sizeof(path));
  snprintf(tempPath, sizeof(tempPath), "%s.tmp", path);
  SynthPresetFileHeaderBase header = {};
  header.magic[0] = 'H'; header.magic[1] = 'S'; header.magic[2] = 'P';
  header.version = SYNTH_PRESET_FILE_VERSION;
  header.crc32 = crc32(reinterpret_cast<const uint8_t*>(&preset), sizeof(preset));

  File existing = LittleFS.open(path, "r");
  if (existing && existing.size() == sizeof(header) + sizeof(preset)) {
    SynthPresetFileHeaderBase existingHeader = {};
    SynthPresetSlot existingPreset = {};
    bool unchanged =
      existing.read(reinterpret_cast<uint8_t*>(&existingHeader), sizeof(existingHeader)) == sizeof(existingHeader)
      && existing.read(reinterpret_cast<uint8_t*>(&existingPreset), sizeof(existingPreset)) == sizeof(existingPreset)
      && synthPresetHeaderBaseValid(existingHeader)
      && existingHeader.crc32 == header.crc32
      && crc32(reinterpret_cast<const uint8_t*>(&existingPreset), sizeof(existingPreset)) == existingHeader.crc32
      && memcmp(&existingPreset, &preset, sizeof(preset)) == 0;
    existing.close();
    if (unchanged) {
      return true;
    }
  } else if (existing) {
    existing.close();
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
    sendToLog("Error: Unable to atomically save synth profile draft " + std::string(path) + ".");
    return false;
  }
  return true;
}
}  // namespace

void queueCurrentSynthStateForProfile(uint8_t profileIndex) {
  if (profileIndex >= PROFILE_COUNT) {
    return;
  }
  SynthProfileReference reference = {};
  bool modified = currentSynthPresetRuntimeModified();
  const bool tracked = !currentSynthPresetIsBlank && currentSynthPresetTracked();

  if (!modified && currentSynthPresetIsBlank) {
    reference.flags = SYNTH_PROFILE_REFERENCE_BLANK;
  } else if (!modified && tracked) {
    reference.flags = SYNTH_PROFILE_REFERENCE_CATALOG;
    memcpy(reference.objectId, currentSynthPresetObjectId, sizeof(reference.objectId));
  } else {
    reference.flags = SYNTH_PROFILE_REFERENCE_DRAFT;
    if (currentSynthPresetIsBlank) {
      reference.flags |= SYNTH_PROFILE_REFERENCE_BLANK;
    } else if (tracked) {
      reference.flags |= SYNTH_PROFILE_REFERENCE_CATALOG;
      memcpy(reference.objectId, currentSynthPresetObjectId, sizeof(reference.objectId));
    }
    pendingSynthProfileDraft = SynthPresetSlot{};
    captureCurrentSynthPreset(pendingSynthProfileDraft);
    snprintf(pendingSynthProfileDraft.name,
             sizeof(pendingSynthProfileDraft.name),
             "Profile %u Draft",
             static_cast<unsigned>(profileIndex + 1));
    snprintf(pendingSynthProfileDraft.folderPath, sizeof(pendingSynthProfileDraft.folderPath), "/");
  }
  pendingSynthProfileReference = reference;
  pendingSynthProfileIndex = profileIndex;
  pendingSynthProfileStateValid = true;
}

bool persistPendingSynthProfileDrafts() {
  if (!pendingSynthProfileStateValid) {
    return true;
  }
  if ((pendingSynthProfileReference.flags & SYNTH_PROFILE_REFERENCE_DRAFT) != 0
      && !writeSynthProfileDraftAtomic(pendingSynthProfileIndex, pendingSynthProfileDraft)) {
    return false;
  }
  synthProfileReferences[pendingSynthProfileIndex] = pendingSynthProfileReference;
  pendingSynthProfileStateValid = false;
  return true;
}

bool restoreSynthStateForProfile(uint8_t profileIndex) {
  if (profileIndex >= PROFILE_COUNT) {
    return false;
  }
  const SynthProfileReference& reference = synthProfileReferences[profileIndex];
  const bool draft = (reference.flags & SYNTH_PROFILE_REFERENCE_DRAFT) != 0;
  const bool catalog = (reference.flags & SYNTH_PROFILE_REFERENCE_CATALOG) != 0;
  const bool blank = (reference.flags & SYNTH_PROFILE_REFERENCE_BLANK) != 0;
  if (catalog && blank) {
    sendToLog("Invalid synth profile reference. Using Blank.");
    applyBlankSynthPresetToSettings();
    trackBlankSynthPreset();
    return false;
  }

  if (draft) {
    SynthPresetSlot preset = {};
    if (!readSynthProfileDraft(profileIndex, preset)) {
      char path[32] = {};
      synthProfileDraftPath(profileIndex, path, sizeof(path));
      reportStorageHealthIssue(path, "missing or invalid draft");
      sendToLog("Synth profile draft is missing or invalid. Using Blank.");
      applyBlankSynthPresetToSettings();
      trackBlankSynthPreset();
      return false;
    }
    normalizeSynthPresetValues(preset);
    applySynthPresetToSettings(preset);
    if (catalog && trackCurrentSynthPresetObjectId(reference.objectId)) {
      return true;
    }
    if (blank) {
      trackBlankSynthPreset();
    } else {
      forgetCurrentSynthPreset("Current", false);
    }
    return true;
  }

  if (catalog) {
    uint16_t presetIndex = 0;
    SynthPresetSlot preset = {};
    if (findSynthPresetCatalogHandle(reference.objectId, presetIndex)
        && readSynthPresetFromCatalog(presetIndex, preset)) {
      applySynthPresetToSettings(preset);
      trackCurrentSynthPreset(presetIndex, preset);
      return true;
    }
    sendToLog("Synth profile preset is unavailable. Using Blank.");
  }
  applyBlankSynthPresetToSettings();
  trackBlankSynthPreset();
  return blank;
}

bool readSynthPresetFromCatalog(uint16_t presetIndex, SynthPresetSlot& preset) {
  SynthPresetCatalogEntry entry;
  return readSynthPresetCatalogEntry(presetIndex, entry)
         && readSynthPresetFileByObjectId(entry.objectId, preset);
}

void load_synth_presets() {
  currentSynthPresetLoadedSlotValid = false;
  loadSynthPresetCatalog();
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

void flashSafeSaveSynthWavetables() {
  flashSafeWrite(save_synth_wavetables);
}

void saveSynthPresetToSlot(uint16_t presetIndex) {
  SynthPresetSlot preset = {};
  if (!readSynthPresetFromCatalog(presetIndex, preset)) {
    sendToLog("Synth preset file is missing or invalid.");
    return;
  }
  captureCurrentSynthPreset(preset);
  normalizeSynthPresetMetadata(preset, presetIndex);
  uint16_t storedHandle = 0;
  SynthPresetStoreResult result = storeSynthPresetInCatalog(presetIndex, preset, storedHandle);
  if (result != SynthPresetStoreResult::Stored) {
    sendToLog(synthPresetStoreResultMessage(result));
    return;
  }
  trackCurrentSynthPreset(storedHandle, preset);
  sendToLog("Saved synth preset " + std::string(preset.name));
}

void saveSynthPresetAsNew(const char* folderPath) {
  if (!ensureSynthPresetCatalogIndexed(true)) {
    sendToLog(synthPresetStoreResultMessage(SynthPresetStoreResult::StorageError));
    return;
  }
  const uint16_t count = synthPresetCatalogCount();
  if (count >= SYNTH_PRESET_MAX_COUNT) {
    sendToLog(synthPresetStoreResultMessage(SynthPresetStoreResult::LibraryFull));
    return;
  }
  SynthPresetSlot preset = {};
  captureCurrentSynthPreset(preset);
  snprintf(preset.name, sizeof(preset.name), "Preset %u", static_cast<unsigned>(count + 1));
  snprintf(preset.folderPath, sizeof(preset.folderPath), "%s", folderPath && folderPath[0] ? folderPath : SYNTH_PRESET_ROOT_FOLDER);
  normalizeSynthPresetMetadata(preset, count);
  // A new preset must not reuse another preset's id (and file).
  uint16_t existing = 0;
  uint16_t salt = count;
  while (findSynthPresetCatalogHandle(preset.objectId, existing)) {
    if (salt - count >= 8) {
      sendToLog(synthPresetStoreResultMessage(SynthPresetStoreResult::StorageError));
      return;
    }
    generateSynthPresetObjectId(preset, ++salt);
  }
  uint16_t storedHandle = 0;
  SynthPresetStoreResult result =
    storeSynthPresetInCatalog(SYNTH_PRESET_CATALOG_NEW_HANDLE, preset, storedHandle);
  if (result != SynthPresetStoreResult::Stored) {
    sendToLog(synthPresetStoreResultMessage(result));
    return;
  }
  trackCurrentSynthPreset(storedHandle, preset);
  sendToLog("Saved new synth preset " + std::string(preset.name));
}

bool writeSynthPresetToCatalogSlot(uint16_t presetIndex, const SynthPresetSlot& preset) {
  SynthPresetSlot normalized = preset;
  normalizeSynthPresetValues(normalized);
  normalizeSynthPresetMetadata(normalized,
                               presetIndex == SYNTH_PRESET_CATALOG_NEW_HANDLE
                                 ? synthPresetCatalogCount()
                                 : presetIndex);
  uint16_t storedHandle = 0;
  SynthPresetStoreResult result = storeSynthPresetInCatalog(presetIndex, normalized, storedHandle);
  if (result != SynthPresetStoreResult::Stored) {
    sendToLog(synthPresetStoreResultMessage(result));
    return false;
  }
  return true;
}

bool deleteSynthPresetFromCatalog(uint16_t presetIndex) {
  if (!removeSynthPresetFromCatalog(presetIndex)) {
    return false;
  }
  currentSynthPresetTracked();
  return true;
}

void loadSynthPresetFromSlot(uint16_t presetIndex) {
  SynthPresetSlot preset = {};
  if (!readSynthPresetFromCatalog(presetIndex, preset)) {
    sendToLog("Synth preset record is missing.");
    return;
  }
  bool missingWavetable = !synthWavetableNameIsAvailable(preset.wavetableName);
  char missingWavetableName[SYNTH_WAVETABLE_NAME_LENGTH] = {};
  if (missingWavetable) {
    snprintf(missingWavetableName, sizeof(missingWavetableName), "%s", preset.wavetableName);
  }
  applySynthPresetToSettings(preset);
  markSettingsDirty();
  trackCurrentSynthPreset(presetIndex, preset);
  syncSynthSettingsToRuntime();
  if (missingWavetable) {
    showMissingWavetableNotice(missingWavetableName);
  }
  sendToLog("Loaded synth preset " + std::string(preset.name));
}
