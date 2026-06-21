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

uint16_t currentSynthPresetIndex = CURRENT_SYNTH_PRESET_NONE;
uint8_t currentSynthPresetObjectId[SYNTH_PRESET_OBJECT_ID_LENGTH] = {};
char currentSynthPresetName[SYNTH_PRESET_NAME_LENGTH] = "Current";
bool currentSynthPresetIsBlank = false;

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

const SynthPresetSlot* trackedCurrentSynthPresetSlot() {
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
  return nullptr;
}

void trackCurrentSynthPresetSlot(uint16_t presetIndex) {
  if (presetIndex >= synthPresets.size() || !synthPresets[presetIndex].valid) {
    currentSynthPresetIndex = CURRENT_SYNTH_PRESET_NONE;
    clearCurrentSynthPresetObjectId();
    snprintf(currentSynthPresetName, sizeof(currentSynthPresetName), "Current");
    currentSynthPresetIsBlank = false;
    return;
  }
  currentSynthPresetIndex = presetIndex;
  memcpy(currentSynthPresetObjectId, synthPresets[presetIndex].objectId, sizeof(currentSynthPresetObjectId));
  snprintf(currentSynthPresetName, sizeof(currentSynthPresetName), "%s", synthPresets[presetIndex].name);
  currentSynthPresetIsBlank = false;
}

void trackBlankSynthPreset() {
  currentSynthPresetIndex = CURRENT_SYNTH_PRESET_NONE;
  clearCurrentSynthPresetObjectId();
  snprintf(currentSynthPresetName, sizeof(currentSynthPresetName), "Blank");
  currentSynthPresetIsBlank = true;
}

void setFactorySynthPresetValue(SynthPresetSlot& preset, SettingKey key, uint8_t value) {
  for (size_t i = 0; i < synthPresetKeys.size(); ++i) {
    if (synthPresetKeys[i] == key) {
      preset.values[i] = value;
      return;
    }
  }
}

SynthPresetSlot makeFactorySynthPreset(const char* name,
                                       const char* folderPath,
                                       const char* wavetableName,
                                       const char* wavetableFolderPath,
                                       bool favorite) {
  SynthPresetSlot preset = {};
  preset.valid = 1;
  preset.favorite = favorite ? 1 : 0;
  snprintf(preset.name, sizeof(preset.name), "%s", name);
  snprintf(preset.folderPath, sizeof(preset.folderPath), "%s", folderPath);
  snprintf(preset.wavetableName, sizeof(preset.wavetableName), "%s", wavetableName);
  snprintf(preset.wavetableFolderPath, sizeof(preset.wavetableFolderPath), "%s", wavetableFolderPath);
  for (size_t i = 0; i < synthPresetKeys.size(); ++i) {
    preset.values[i] = factoryDefaults[static_cast<uint8_t>(synthPresetKeys[i])];
  }
  return preset;
}

void appendFactorySynthPreset(SynthPresetSlot preset) {
  normalizeSynthPresetValues(preset);
  normalizeSynthPresetMetadata(preset, static_cast<uint8_t>(synthPresets.size()));
  synthPresets.push_back(preset);
}
}  // namespace

void applyDefaultSynthPresets() {
  synthPresets.clear();

  SynthPresetSlot softStringPad = makeFactorySynthPreset("Soft String Pad",
                                                         SYNTH_PRESET_ROOT_FOLDER,
                                                         "Classic",
                                                         SYNTH_WAVETABLE_BUILTIN_FOLDER,
                                                         true);
  setFactorySynthPresetValue(softStringPad, SettingKey::PlaybackMode, SYNTH_POLY);
  setFactorySynthPresetValue(softStringPad, SettingKey::Waveform, WAVEFORM_BASIC_WAVETABLE);
  setFactorySynthPresetValue(softStringPad, SettingKey::SynthDrive, SYNTH_DRIVE_OFF);
  setFactorySynthPresetValue(softStringPad, SettingKey::SynthModTarget, SYNTH_MOD_TARGET_FOLD_WARP);
  setFactorySynthPresetValue(softStringPad, SettingKey::SynthModAmount, 127);
  setFactorySynthPresetValue(softStringPad, SettingKey::SynthVibratoSpeed, 5);
  setFactorySynthPresetValue(softStringPad, SettingKey::ArpeggiatorDivision, 32);
  setFactorySynthPresetValue(softStringPad, SettingKey::SynthBPM, 120);
  setFactorySynthPresetValue(softStringPad, SettingKey::EnvelopeAttackIndex, 12);
  setFactorySynthPresetValue(softStringPad, SettingKey::EnvelopeHoldIndex, 0);
  setFactorySynthPresetValue(softStringPad, SettingKey::EnvelopeDecayIndex, 14);
  setFactorySynthPresetValue(softStringPad, SettingKey::EnvelopeSustainLevel, 100);
  setFactorySynthPresetValue(softStringPad, SettingKey::EnvelopeReleaseIndex, 14);
  setFactorySynthPresetValue(softStringPad, SettingKey::EffectEnvelopeTarget, SYNTH_MOD_TARGET_VIBRATO);
  setFactorySynthPresetValue(softStringPad, SettingKey::EffectEnvelopeAmount, 254);
  setFactorySynthPresetValue(softStringPad, SettingKey::EffectEnvelope2Target, SYNTH_MOD_TARGET_PITCH);
  setFactorySynthPresetValue(softStringPad, SettingKey::EffectEnvelope2Amount, 254);
  setFactorySynthPresetValue(softStringPad, SettingKey::SynthPortamentoTimeIndex, 0);
  setFactorySynthPresetValue(softStringPad, SettingKey::ArpeggiatorDirection, 0);
  setFactorySynthPresetValue(softStringPad, SettingKey::SynthWavetablePosition, 0);
  setFactorySynthPresetValue(softStringPad, SettingKey::SynthLfoTarget, SYNTH_MOD_TARGET_FOLD_WARP);
  setFactorySynthPresetValue(softStringPad, SettingKey::SynthLfoAmount, 127);
  setFactorySynthPresetValue(softStringPad, SettingKey::SynthLfoWave, 0);
  setFactorySynthPresetValue(softStringPad, SettingKey::SynthLfoSpeed, 6);
  appendFactorySynthPreset(softStringPad);

  SynthPresetSlot brightMonoLead = makeFactorySynthPreset("Bright Mono Lead",
                                                          SYNTH_PRESET_ROOT_FOLDER,
                                                          SYNTH_WAVETABLE_BASIC_NAME,
                                                          SYNTH_WAVETABLE_BUILTIN_FOLDER,
                                                          false);
  setFactorySynthPresetValue(brightMonoLead, SettingKey::PlaybackMode, SYNTH_MONO_RETRIGGER);
  setFactorySynthPresetValue(brightMonoLead, SettingKey::Waveform, WAVEFORM_BASIC_WAVETABLE);
  setFactorySynthPresetValue(brightMonoLead, SettingKey::SynthDrive, SYNTH_DRIVE_EDGE);
  setFactorySynthPresetValue(brightMonoLead, SettingKey::SynthModTarget, SYNTH_MOD_TARGET_PITCH);
  setFactorySynthPresetValue(brightMonoLead, SettingKey::SynthModAmount, 100);
  setFactorySynthPresetValue(brightMonoLead, SettingKey::SynthVibratoSpeed, 4);
  setFactorySynthPresetValue(brightMonoLead, SettingKey::SynthPortamentoTimeIndex, 6);
  setFactorySynthPresetValue(brightMonoLead, SettingKey::SynthWavetablePosition, 85);
  setFactorySynthPresetValue(brightMonoLead, SettingKey::EnvelopeAttackIndex, 0);
  setFactorySynthPresetValue(brightMonoLead, SettingKey::EnvelopeHoldIndex, 0);
  setFactorySynthPresetValue(brightMonoLead, SettingKey::EnvelopeDecayIndex, 4);
  setFactorySynthPresetValue(brightMonoLead, SettingKey::EnvelopeSustainLevel, 110);
  setFactorySynthPresetValue(brightMonoLead, SettingKey::EnvelopeReleaseIndex, 5);
  setFactorySynthPresetValue(brightMonoLead, SettingKey::EffectEnvelopeTarget, SYNTH_MOD_TARGET_FOLD_WARP);
  setFactorySynthPresetValue(brightMonoLead, SettingKey::EffectEnvelopeAmount, 127);
  setFactorySynthPresetValue(brightMonoLead, SettingKey::EffectEnvelope2Target, SYNTH_MOD_TARGET_FOLD_WARP);
  setFactorySynthPresetValue(brightMonoLead, SettingKey::EffectEnvelope2Amount, 127);
  appendFactorySynthPreset(brightMonoLead);
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
    trackedCurrentSynthPresetSlot();
  }
  return currentSynthPresetName[0] ? currentSynthPresetName : "Current";
}

bool currentSynthPresetRuntimeModified() {
  if (currentSynthPresetIsBlank) {
    return !currentRuntimeMatchesBlankSynthPreset();
  }
  const SynthPresetSlot* preset = trackedCurrentSynthPresetSlot();
  return preset ? !currentRuntimeMatchesSynthPresetValues(*preset) : false;
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
  syncSynthSettingsToRuntime();
  trackBlankSynthPreset();
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
    normalizeSynthPresetMetadata(synthPresets[writeIndex], static_cast<uint8_t>(writeIndex));
    ++writeIndex;
  }
  synthPresets.resize(writeIndex);
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

  size_t presetDataSize = sizeof(SynthPresetSlot) * presetCountInFile;
  size_t bytesRead = presetDataSize == 0 ? 0 : f.read(reinterpret_cast<uint8_t*>(synthPresets.data()), presetDataSize);
  f.close();
  if (bytesRead != presetDataSize) {
    sendToLog("Warning: Synth preset data incomplete. Starting with empty preset slots.");
    applyDefaultSynthPresets();
    return;
  }
  uint32_t computed = synthPresetDataCrc(synthPresets.data(), presetCountInFile);
  if (computed != header.crc32) {
    sendToLog("Synth preset CRC32 mismatch. Starting with empty preset slots.");
    applyDefaultSynthPresets();
    return;
  }
  synthPresets.resize(presetCountInFile);
  size_t writeIndex = 0;
  for (size_t readIndex = 0; readIndex < synthPresets.size(); ++readIndex) {
    if (!synthPresets[readIndex].valid) {
      continue;
    }
    if (writeIndex != readIndex) {
      synthPresets[writeIndex] = synthPresets[readIndex];
    }
    normalizeSynthPresetValues(synthPresets[writeIndex]);
    normalizeSynthPresetMetadata(synthPresets[writeIndex], static_cast<uint8_t>(writeIndex));
    ++writeIndex;
  }
  synthPresets.resize(writeIndex);
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

namespace {
constexpr uint64_t FLASH_SAVE_AUDIO_MUTE_TIMEOUT_MICROS = 12000ULL;

void waitForAudioOutputMute(bool muted) {
  uint64_t start = readClock();
  while (!audioOutputMuteSettled(muted) && (readClock() - start) < FLASH_SAVE_AUDIO_MUTE_TIMEOUT_MICROS) {
    delayMicroseconds(AUDIO_DMA_BUFFER_MICROS);
  }
}
}  // namespace

// On the RP2040 flash writes disable ALL interrupts on BOTH cores, which
// starves buffer refills. Fade to silence first, then give the DMA path queued
// idle samples before the flash write freezes interrupt handling.
void beginFlashSafeWrite() {
  showFlashSaveScreen();
  setAudioOutputMuteTarget(true);
  waitForAudioOutputMute(true);
  flashWriteInProgress.store(true, std::memory_order_release);
  delayMicroseconds(AUDIO_DMA_BUFFER_MICROS * 2);
}

void endFlashSafeWrite() {
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
  trackCurrentSynthPresetSlot(presetIndex);
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
  if (!synthPresets.push_back(preset)) {
    sendToLog("Synth preset library is full.");
    return;
  }
  trackCurrentSynthPresetSlot(static_cast<uint16_t>(synthPresets.size() - 1));
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
  syncSynthSettingsToRuntime();
  flashSafeSaveCurrentSynthWavetableReference();
  trackCurrentSynthPresetSlot(presetIndex);
  sendToLog("Loaded synth preset " + std::string(synthPresets[presetIndex].name));
}
