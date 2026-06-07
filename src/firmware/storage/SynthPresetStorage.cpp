#if HEXBOARD_FIRMWARE_UNITY

#include "../FirmwareModule.h"

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

void migrateSynthPresetSlotV8(const SynthPresetSlotV8& legacyPreset, uint8_t index) {
  if (!legacyPreset.valid || synthPresets.size() >= SYNTH_PRESET_MAX_COUNT) {
    return;
  }
  SynthPresetSlot preset = {};
  preset.valid = legacyPreset.valid;
  preset.favorite = legacyPreset.favorite;
  memcpy(preset.objectId, legacyPreset.objectId, sizeof(preset.objectId));
  memcpy(preset.name, legacyPreset.name, sizeof(preset.name));
  memcpy(preset.folderPath, legacyPreset.folderPath, sizeof(preset.folderPath));
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
    } else if (header.version < 8) {
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
    } else {
      std::vector<SynthPresetSlotV8> legacyPresets(presetCountInFile);
      size_t presetDataSize = sizeof(SynthPresetSlotV8) * legacyPresets.size();
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
        migrateSynthPresetSlotV8(legacyPresets[i], static_cast<uint8_t>(i));
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
  setCurrentSynthWavetableReference(preset.wavetableFolderPath, preset.wavetableName);
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
  flashSafeSaveCurrentSynthWavetableReference();
  sendToLog("Loaded synth preset " + std::string(synthPresets[presetIndex].name));
}
#endif  // HEXBOARD_FIRMWARE_UNITY
