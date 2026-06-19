#include "../FirmwareModule.h"
#include "../app/DiagnosticsTiming.h"
#include "../app/RuntimeDefaults.h"
#include "../menu/MenuAndDisplay.h"
#include "../menu/SynthPresetMenu.h"
#include "../menu/SynthWavetableMenu.h"
#include "../synth/SynthAudio.h"
#include "../synth/SynthDefaults.h"
#include "PresetSync.h"
#include "Settings.h"
#include "SynthPresetStorage.h"
#include "SynthWavetableStorage.h"

std::vector<uint8_t> buildSynthPresetObjectBody(const SynthPresetSlot& preset) {
  std::vector<uint8_t> body;
  body.reserve(192);
  body.push_back('H');
  body.push_back('B');
  body.push_back('S');
  body.push_back('1');
  body.push_back(PRESET_SYNC_OBJECT_TYPE_SYNTH_PRESET);
  body.push_back(1);
  body.push_back(0);
  body.push_back(0);
  presetSyncAppendTextTlv(body, PRESET_SYNC_TLV_NAME, preset.name, sizeof(preset.name));
  presetSyncAppendTlv(body, PRESET_SYNC_TLV_OBJECT_ID, preset.objectId, sizeof(preset.objectId));
  static constexpr char source[] = "device";
  presetSyncAppendTlv(body, PRESET_SYNC_TLV_SOURCE, reinterpret_cast<const uint8_t*>(source), sizeof(source) - 1);
  presetSyncAppendTextTlv(body, PRESET_SYNC_TLV_FOLDER_PATH, preset.folderPath, sizeof(preset.folderPath));
  uint8_t schemaVersion = SYNTH_PRESET_SCHEMA_VERSION;
  presetSyncAppendTlv(body, PRESET_SYNC_TLV_SYNTH_SCHEMA_VERSION, &schemaVersion, 1);
  presetSyncAppendTextTlv(body,
                          PRESET_SYNC_TLV_SYNTH_WAVETABLE_FOLDER_PATH,
                          preset.wavetableFolderPath,
                          sizeof(preset.wavetableFolderPath));
  presetSyncAppendTextTlv(body,
                          PRESET_SYNC_TLV_SYNTH_WAVETABLE_NAME,
                          preset.wavetableName,
                          sizeof(preset.wavetableName));
  std::vector<uint8_t> values;
  values.reserve(SYNTH_PRESET_VALUE_COUNT * 2);
  for (size_t i = 0; i < synthPresetKeys.size(); ++i) {
    values.push_back(static_cast<uint8_t>(synthPresetKeys[i]));
    values.push_back(preset.values[i]);
  }
  presetSyncAppendTlv(body, PRESET_SYNC_TLV_SYNTH_VALUES, values.data(), static_cast<uint16_t>(values.size()));
  uint8_t favorite = preset.favorite ? 1 : 0;
  presetSyncAppendTlv(body, PRESET_SYNC_TLV_FAVORITE, &favorite, 1);
  return body;
}

int synthPresetKeyIndex(uint8_t settingKey) {
  for (size_t i = 0; i < synthPresetKeys.size(); ++i) {
    if (static_cast<uint8_t>(synthPresetKeys[i]) == settingKey) {
      return static_cast<int>(i);
    }
  }
  return -1;
}

bool parseSynthPresetObjectBody(const std::vector<uint8_t>& body, SynthPresetSlot& preset, std::string& error) {
  if (body.size() < 8 || body[0] != 'H' || body[1] != 'B' || body[2] != 'S' || body[3] != '1') {
    error = "bad object magic";
    return false;
  }
  if (body[4] != PRESET_SYNC_OBJECT_TYPE_SYNTH_PRESET) {
    error = "not synth preset";
    return false;
  }
  if (body[5] != 1) {
    error = "unsupported synth preset object schema";
    return false;
  }

  preset = SynthPresetSlot{};
  preset.valid = 1;
  snprintf(preset.folderPath, sizeof(preset.folderPath), "%s", SYNTH_PRESET_ROOT_FOLDER);
  for (size_t i = 0; i < synthPresetKeys.size(); ++i) {
    preset.values[i] = factoryDefaults[static_cast<uint8_t>(synthPresetKeys[i])];
  }

  bool sawName = false;
  bool sawObjectId = false;
  bool sawValues = false;
  size_t cursor = 8;
  while (cursor < body.size()) {
    if (cursor + 3 > body.size()) {
      error = "truncated TLV header";
      return false;
    }
    uint8_t tag = body[cursor++];
    uint16_t length = static_cast<uint16_t>(body[cursor]) | (static_cast<uint16_t>(body[cursor + 1]) << 8);
    cursor += 2;
    if (cursor + length > body.size()) {
      error = "truncated TLV value";
      return false;
    }
    const uint8_t* value = body.data() + cursor;

    switch (tag) {
      case PRESET_SYNC_TLV_NAME:
        copyPresetSyncText(preset.name, sizeof(preset.name), value, length);
        sawName = preset.name[0] != '\0';
        break;
      case PRESET_SYNC_TLV_OBJECT_ID:
        if (length != sizeof(preset.objectId)) {
          error = "bad object id length";
          return false;
        }
        memcpy(preset.objectId, value, sizeof(preset.objectId));
        sawObjectId = true;
        break;
      case PRESET_SYNC_TLV_FOLDER_PATH:
        copyPresetSyncText(preset.folderPath, sizeof(preset.folderPath), value, length);
        if (!preset.folderPath[0]) {
          snprintf(preset.folderPath, sizeof(preset.folderPath), "%s", SYNTH_PRESET_ROOT_FOLDER);
        }
        break;
      case PRESET_SYNC_TLV_SYNTH_VALUES:
        if ((length % 2) != 0) {
          error = "bad synth values length";
          return false;
        }
        for (uint16_t i = 0; i < length; i += 2) {
          int keyIndex = synthPresetKeyIndex(value[i]);
          if (keyIndex >= 0) {
            preset.values[keyIndex] = value[i + 1];
          }
        }
        sawValues = true;
        break;
      case PRESET_SYNC_TLV_SYNTH_SCHEMA_VERSION:
        if (length >= 1 && value[0] > SYNTH_PRESET_SCHEMA_VERSION) {
          error = "unsupported synth preset value schema";
          return false;
        }
        break;
      case PRESET_SYNC_TLV_FAVORITE:
        if (length >= 1) {
          preset.favorite = value[0] ? 1 : 0;
        }
        break;
      case PRESET_SYNC_TLV_SYNTH_WAVETABLE_NAME:
        copyPresetSyncText(preset.wavetableName, sizeof(preset.wavetableName), value, length);
        break;
      case PRESET_SYNC_TLV_SYNTH_WAVETABLE_FOLDER_PATH:
        copyPresetSyncText(preset.wavetableFolderPath, sizeof(preset.wavetableFolderPath), value, length);
        break;
      default:
        break;
    }

    cursor += length;
  }

  if (!sawName || !sawObjectId || !sawValues) {
    error = "missing required synth preset TLV";
    return false;
  }
  normalizeSynthPresetValues(preset);
  normalizeSynthPresetMetadata(preset, 0);
  return true;
}

bool parseSynthWavetableObjectBody(const std::vector<uint8_t>& body, ParsedSynthWavetableObject& wavetable, std::string& error) {
  if (body.size() < 8 || body[0] != 'H' || body[1] != 'B' || body[2] != 'S' || body[3] != '1') {
    error = "bad object magic";
    return false;
  }
  if (body[4] != PRESET_SYNC_OBJECT_TYPE_SYNTH_WAVETABLE) {
    error = "not synth wavetable";
    return false;
  }
  if (body[5] != 1) {
    error = "unsupported synth wavetable object schema";
    return false;
  }

  wavetable = ParsedSynthWavetableObject{};
  snprintf(wavetable.folderPath, sizeof(wavetable.folderPath), "%s", SYNTH_WAVETABLE_ROOT_FOLDER);
  bool sawFrameCount = false;
  bool sawSampleCount = false;
  bool sawSamples = false;
  size_t cursor = 8;
  while (cursor < body.size()) {
    if (cursor + 3 > body.size()) {
      error = "truncated TLV header";
      return false;
    }
    uint8_t tag = body[cursor++];
    uint16_t length = static_cast<uint16_t>(body[cursor]) | (static_cast<uint16_t>(body[cursor + 1]) << 8);
    cursor += 2;
    if (cursor + length > body.size()) {
      error = "truncated TLV value";
      return false;
    }
    const uint8_t* value = body.data() + cursor;

    switch (tag) {
      case PRESET_SYNC_TLV_NAME:
        copyPresetSyncText(wavetable.name, sizeof(wavetable.name), value, length);
        break;
      case PRESET_SYNC_TLV_OBJECT_ID:
        if (length != sizeof(wavetable.objectId)) {
          error = "bad object id length";
          return false;
        }
        memcpy(wavetable.objectId, value, sizeof(wavetable.objectId));
        wavetable.sawObjectId = true;
        break;
      case PRESET_SYNC_TLV_FOLDER_PATH:
        copyPresetSyncText(wavetable.folderPath, sizeof(wavetable.folderPath), value, length);
        if (!wavetable.folderPath[0]) {
          snprintf(wavetable.folderPath, sizeof(wavetable.folderPath), "%s", SYNTH_WAVETABLE_ROOT_FOLDER);
        }
        break;
      case PRESET_SYNC_TLV_WAVETABLE_FRAME_COUNT:
        if (length != 1 || value[0] != SYNTH_WAVETABLE_FRAME_COUNT) {
          error = "bad wavetable frame count";
          return false;
        }
        sawFrameCount = true;
        break;
      case PRESET_SYNC_TLV_WAVETABLE_SAMPLE_COUNT: {
        if (length != 2) {
          error = "bad wavetable sample count length";
          return false;
        }
        uint16_t sampleCount = static_cast<uint16_t>(value[0]) | (static_cast<uint16_t>(value[1]) << 8);
        if (sampleCount != SYNTH_WAVE_SAMPLE_COUNT) {
          error = "bad wavetable sample count";
          return false;
        }
        sawSampleCount = true;
        break;
      }
      case PRESET_SYNC_TLV_WAVETABLE_MIP_LEVELS:
        if (length != 1 || value[0] < 1 || value[0] > SYNTH_WAVETABLE_MIP_LEVEL_COUNT) {
          error = "bad wavetable mip level count";
          return false;
        }
        wavetable.mipLevelCount = value[0];
        break;
      case PRESET_SYNC_TLV_WAVETABLE_SAMPLES:
        if (length == 0 || wavetable.sampleBytes.size() + length > SYNTH_WAVETABLE_MIP_SAMPLE_BYTES) {
          error = "bad wavetable sample data length";
          return false;
        }
        wavetable.sampleBytes.insert(wavetable.sampleBytes.end(), value, value + length);
        wavetable.sawSamples = true;
        sawSamples = true;
        break;
      default:
        break;
    }

    cursor += length;
  }

  if (sawSamples && (!sawFrameCount || !sawSampleCount || wavetable.sampleBytes.empty())) {
    error = "missing required wavetable sample metadata";
    return false;
  }
  if (sawSamples) {
    wavetable.sampleLength = wavetable.sampleBytes.size();
    if (!isSupportedSynthWavetableSampleLength(wavetable.sampleLength)) {
      error = "bad wavetable sample data length";
      return false;
    }
    uint8_t expectedMipLevels = wavetable.sampleLength == SYNTH_WAVETABLE_MIP_SAMPLE_BYTES
      ? SYNTH_WAVETABLE_MIP_LEVEL_COUNT
      : 1;
    if (wavetable.mipLevelCount != expectedMipLevels) {
      error = "wavetable mip level count does not match sample data";
      return false;
    }
    wavetable.samples = wavetable.sampleBytes.data();
  }
  if (!wavetable.name[0]) {
    error = "missing wavetable name";
    return false;
  }
  return true;
}

bool presetSyncReadExact(File& f, uint8_t* output, size_t length) {
  return length == 0 || f.read(output, length) == length;
}

bool presetSyncSkipBytes(File& f, size_t length) {
  uint8_t discard[96];
  while (length > 0) {
    size_t chunkLength = std::min(sizeof(discard), length);
    if (!presetSyncReadExact(f, discard, chunkLength)) {
      return false;
    }
    length -= chunkLength;
  }
  return true;
}

bool presetSyncReadTextTlv(File& f, char* destination, size_t destinationLength, size_t sourceLength) {
  if (destinationLength == 0) {
    return presetSyncSkipBytes(f, sourceLength);
  }
  size_t copyLength = std::min(destinationLength - 1, sourceLength);
  if (!presetSyncReadExact(f, reinterpret_cast<uint8_t*>(destination), copyLength)) {
    return false;
  }
  destination[copyLength] = '\0';
  return presetSyncSkipBytes(f, sourceLength - copyLength);
}

bool presetSyncCopySampleTlv(File& input, File& output, size_t length) {
  uint8_t buffer[128];
  while (length > 0) {
    size_t chunkLength = std::min(sizeof(buffer), length);
    if (!presetSyncReadExact(input, buffer, chunkLength)) {
      return false;
    }
    if (output.write(buffer, chunkLength) != chunkLength) {
      return false;
    }
    length -= chunkLength;
  }
  return true;
}

bool validateParsedSynthWavetableObject(ParsedSynthWavetableObject& wavetable,
                                        bool sawFrameCount,
                                        bool sawSampleCount,
                                        std::string& error) {
  if (wavetable.sawSamples && (!sawFrameCount || !sawSampleCount || wavetable.sampleLength == 0)) {
    error = "missing required wavetable sample metadata";
    return false;
  }
  if (wavetable.sawSamples) {
    if (!isSupportedSynthWavetableSampleLength(wavetable.sampleLength)) {
      error = "bad wavetable sample data length";
      return false;
    }
    uint8_t expectedMipLevels = wavetable.sampleLength == SYNTH_WAVETABLE_MIP_SAMPLE_BYTES
      ? SYNTH_WAVETABLE_MIP_LEVEL_COUNT
      : 1;
    if (wavetable.mipLevelCount != expectedMipLevels) {
      error = "wavetable mip level count does not match sample data";
      return false;
    }
  }
  if (!wavetable.name[0]) {
    error = "missing wavetable name";
    return false;
  }
  return true;
}

bool parseSynthWavetableObjectFile(const char* bodyPath,
                                   ParsedSynthWavetableObject& wavetable,
                                   const char* sampleOutputPath,
                                   std::string& error) {
  if (!bodyPath || !bodyPath[0] || !sampleOutputPath || !sampleOutputPath[0]) {
    error = "missing wavetable temp file";
    return false;
  }

  File body = LittleFS.open(bodyPath, "r");
  if (!body) {
    error = "missing wavetable object temp file";
    return false;
  }

  wavetable = ParsedSynthWavetableObject{};
  snprintf(wavetable.folderPath, sizeof(wavetable.folderPath), "%s", SYNTH_WAVETABLE_ROOT_FOLDER);

  size_t bodySize = body.size();
  if (bodySize < 8) {
    error = "bad object magic";
    body.close();
    return false;
  }

  uint8_t header[8] = {};
  if (!presetSyncReadExact(body, header, sizeof(header))) {
    error = "bad object magic";
    body.close();
    return false;
  }
  if (header[0] != 'H' || header[1] != 'B' || header[2] != 'S' || header[3] != '1') {
    error = "bad object magic";
    body.close();
    return false;
  }
  if (header[4] != PRESET_SYNC_OBJECT_TYPE_SYNTH_WAVETABLE) {
    error = "not synth wavetable";
    body.close();
    return false;
  }
  if (header[5] != 1) {
    error = "unsupported synth wavetable object schema";
    body.close();
    return false;
  }

  LittleFS.remove(sampleOutputPath);
  File sampleOutput;
  bool sawFrameCount = false;
  bool sawSampleCount = false;
  size_t cursor = 8;
  while (cursor < bodySize) {
    if (cursor + 3 > bodySize) {
      error = "truncated TLV header";
      body.close();
      if (sampleOutput) {
        sampleOutput.close();
      }
      LittleFS.remove(sampleOutputPath);
      return false;
    }

    uint8_t tlvHeader[3] = {};
    if (!presetSyncReadExact(body, tlvHeader, sizeof(tlvHeader))) {
      error = "truncated TLV header";
      body.close();
      if (sampleOutput) {
        sampleOutput.close();
      }
      LittleFS.remove(sampleOutputPath);
      return false;
    }
    uint8_t tag = tlvHeader[0];
    uint16_t length = static_cast<uint16_t>(tlvHeader[1]) | (static_cast<uint16_t>(tlvHeader[2]) << 8);
    cursor += 3;
    if (cursor + length > bodySize) {
      error = "truncated TLV value";
      body.close();
      if (sampleOutput) {
        sampleOutput.close();
      }
      LittleFS.remove(sampleOutputPath);
      return false;
    }

    bool ok = true;
    switch (tag) {
      case PRESET_SYNC_TLV_NAME:
        ok = presetSyncReadTextTlv(body, wavetable.name, sizeof(wavetable.name), length);
        break;
      case PRESET_SYNC_TLV_OBJECT_ID:
        if (length != sizeof(wavetable.objectId)) {
          error = "bad object id length";
          ok = false;
          break;
        }
        ok = presetSyncReadExact(body, wavetable.objectId, sizeof(wavetable.objectId));
        wavetable.sawObjectId = ok;
        break;
      case PRESET_SYNC_TLV_FOLDER_PATH:
        ok = presetSyncReadTextTlv(body, wavetable.folderPath, sizeof(wavetable.folderPath), length);
        if (ok && !wavetable.folderPath[0]) {
          snprintf(wavetable.folderPath, sizeof(wavetable.folderPath), "%s", SYNTH_WAVETABLE_ROOT_FOLDER);
        }
        break;
      case PRESET_SYNC_TLV_WAVETABLE_FRAME_COUNT: {
        uint8_t value = 0;
        ok = length == 1 && presetSyncReadExact(body, &value, 1);
        if (ok && value != SYNTH_WAVETABLE_FRAME_COUNT) {
          error = "bad wavetable frame count";
          ok = false;
        }
        sawFrameCount = ok;
        break;
      }
      case PRESET_SYNC_TLV_WAVETABLE_SAMPLE_COUNT: {
        uint8_t value[2] = {};
        ok = length == sizeof(value) && presetSyncReadExact(body, value, sizeof(value));
        uint16_t sampleCount = static_cast<uint16_t>(value[0]) | (static_cast<uint16_t>(value[1]) << 8);
        if (ok && sampleCount != SYNTH_WAVE_SAMPLE_COUNT) {
          error = "bad wavetable sample count";
          ok = false;
        }
        sawSampleCount = ok;
        break;
      }
      case PRESET_SYNC_TLV_WAVETABLE_MIP_LEVELS: {
        uint8_t value = 0;
        ok = length == 1 && presetSyncReadExact(body, &value, 1);
        if (ok && (value < 1 || value > SYNTH_WAVETABLE_MIP_LEVEL_COUNT)) {
          error = "bad wavetable mip level count";
          ok = false;
        }
        if (ok) {
          wavetable.mipLevelCount = value;
        }
        break;
      }
      case PRESET_SYNC_TLV_WAVETABLE_SAMPLES:
        if (length == 0 || wavetable.sampleLength + length > SYNTH_WAVETABLE_MIP_SAMPLE_BYTES) {
          error = "bad wavetable sample data length";
          ok = false;
          break;
        }
        if (!sampleOutput) {
          sampleOutput = LittleFS.open(sampleOutputPath, "w");
          if (!sampleOutput) {
            error = "unable to open wavetable sample temp file";
            ok = false;
            break;
          }
        }
        ok = presetSyncCopySampleTlv(body, sampleOutput, length);
        if (ok) {
          wavetable.sampleLength += length;
          wavetable.sawSamples = true;
        }
        break;
      default:
        ok = presetSyncSkipBytes(body, length);
        break;
    }

    if (!ok) {
      if (error.empty()) {
        error = "truncated TLV value";
      }
      body.close();
      if (sampleOutput) {
        sampleOutput.close();
      }
      LittleFS.remove(sampleOutputPath);
      return false;
    }
    cursor += length;
  }

  body.close();
  if (sampleOutput) {
    sampleOutput.close();
  }

  if (!validateParsedSynthWavetableObject(wavetable, sawFrameCount, sawSampleCount, error)) {
    LittleFS.remove(sampleOutputPath);
    return false;
  }
  return true;
}

bool readSynthWavetableSampleFile(const SynthWavetableSlot& wavetable, std::vector<uint8_t>& samples) {
  char samplePath[SYNTH_WAVETABLE_SAMPLE_PATH_LENGTH] = {};
  if (!resolveSynthWavetableSampleFilePath(wavetable, samplePath, sizeof(samplePath))) {
    return false;
  }
  size_t sampleLength = synthWavetableSampleFileLength(samplePath);
  if (!isSupportedSynthWavetableSampleLength(sampleLength)) {
    sendToLog("Unsupported wavetable sample file length for " + std::string(wavetable.name));
    return false;
  }
  samples.assign(sampleLength, 0);
  if (!readSynthWavetableSampleFileRange(samplePath, 0, samples.data(), samples.size())) {
    sendToLog("Incomplete wavetable sample file for " + std::string(wavetable.name));
    return false;
  }
  return true;
}

std::vector<uint8_t> buildSynthWavetableObjectPrefix(const SynthWavetableSlot& wavetable, size_t sampleLength) {
  std::vector<uint8_t> body;
  body.reserve(256);
  body.push_back('H');
  body.push_back('B');
  body.push_back('S');
  body.push_back('1');
  body.push_back(PRESET_SYNC_OBJECT_TYPE_SYNTH_WAVETABLE);
  body.push_back(1);
  body.push_back(sampleLength == SYNTH_WAVETABLE_MIP_SAMPLE_BYTES ? 2 : 0);
  body.push_back(0);
  presetSyncAppendTextTlv(body, PRESET_SYNC_TLV_NAME, wavetable.name, sizeof(wavetable.name));
  presetSyncAppendTlv(body, PRESET_SYNC_TLV_OBJECT_ID, wavetable.objectId, sizeof(wavetable.objectId));
  const char source[] = "hexboard";
  presetSyncAppendTlv(body, PRESET_SYNC_TLV_SOURCE, reinterpret_cast<const uint8_t*>(source), sizeof(source) - 1);
  presetSyncAppendTextTlv(body, PRESET_SYNC_TLV_FOLDER_PATH, wavetable.folderPath, sizeof(wavetable.folderPath));
  uint8_t frameCount = SYNTH_WAVETABLE_FRAME_COUNT;
  uint8_t sampleCountBytes[2] = {
    static_cast<uint8_t>(SYNTH_WAVE_SAMPLE_COUNT & 0xFF),
    static_cast<uint8_t>((SYNTH_WAVE_SAMPLE_COUNT >> 8) & 0xFF)
  };
  presetSyncAppendTlv(body, PRESET_SYNC_TLV_WAVETABLE_FRAME_COUNT, &frameCount, 1);
  presetSyncAppendTlv(body, PRESET_SYNC_TLV_WAVETABLE_SAMPLE_COUNT, sampleCountBytes, sizeof(sampleCountBytes));
  uint8_t mipLevels = sampleLength == SYNTH_WAVETABLE_MIP_SAMPLE_BYTES ? SYNTH_WAVETABLE_MIP_LEVEL_COUNT : 1;
  presetSyncAppendTlv(body, PRESET_SYNC_TLV_WAVETABLE_MIP_LEVELS, &mipLevels, 1);
  return body;
}

std::vector<uint8_t> buildSynthWavetableObjectPrefix(const SynthWavetableSlot& wavetable) {
  return buildSynthWavetableObjectPrefix(wavetable, SYNTH_WAVETABLE_SAMPLE_BYTES);
}

std::vector<uint8_t> buildSynthWavetableObjectBody(const SynthWavetableSlot& wavetable, const uint8_t* samples, size_t sampleLength) {
  std::vector<uint8_t> body = buildSynthWavetableObjectPrefix(wavetable, sampleLength);
  body.reserve(PRESET_SYNC_MAX_SYNTH_WAVETABLE_BYTES);
  size_t offset = 0;
  while (offset < sampleLength) {
    size_t chunkLength = std::min(PRESET_SYNC_WAVETABLE_SAMPLE_TLV_CHUNK_BYTES, sampleLength - offset);
    presetSyncAppendTlv(body, PRESET_SYNC_TLV_WAVETABLE_SAMPLES, samples + offset, chunkLength);
    offset += chunkLength;
  }
  return body;
}

void applyParsedSynthWavetableToRuntime(const SynthWavetableSlot& wavetable, const uint8_t* samples, size_t sampleLength) {
  synthWaveTableLoadInProgress = true;
  loadActiveSynthWavetableSamples(samples, sampleLength);
  setActiveSynthWaveFrameCount(SYNTH_WAVETABLE_FRAME_COUNT);
  userSynthWavetableAvailable = true;
  setCurrentSynthWavetableReference(wavetable.folderPath, wavetable.name);
  currWave = WAVEFORM_BASIC_WAVETABLE;
  settings[static_cast<uint8_t>(SettingKey::Waveform)] = WAVEFORM_BASIC_WAVETABLE;
  loadedSynthWaveform = currWave;
  snprintf(loadedSynthWavetableName, sizeof(loadedSynthWavetableName), "%s", currentSynthWavetableName);
  snprintf(loadedSynthWavetableFolderPath, sizeof(loadedSynthWavetableFolderPath), "%s", currentSynthWavetableFolderPath);
  resetSynthRenderCaches();
  synthWaveTableLoadInProgress = false;
}

bool loadActiveSynthWavetableSamplesFromFile(const char* samplePath, size_t sampleLength) {
  if (!samplePath || !samplePath[0] || !isSupportedSynthWavetableSampleLength(sampleLength)) {
    return false;
  }
  File f = LittleFS.open(samplePath, "r");
  if (!f) {
    return false;
  }
  size_t bytesRead = f.read(&activeSynthWaveTable[0][0], SYNTH_WAVETABLE_SAMPLE_BYTES);
  if (bytesRead != SYNTH_WAVETABLE_SAMPLE_BYTES) {
    f.close();
    return false;
  }
  if (sampleLength == SYNTH_WAVETABLE_MIP_SAMPLE_BYTES) {
    size_t extraBytesRead = f.read(activeSynthWavetableMipExtraSamples, SYNTH_WAVETABLE_MIP_EXTRA_SAMPLE_BYTES);
    if (extraBytesRead != SYNTH_WAVETABLE_MIP_EXTRA_SAMPLE_BYTES) {
      f.close();
      return false;
    }
    setActiveSynthWavetableMipLevelCount(SYNTH_WAVETABLE_MIP_LEVEL_COUNT);
  } else {
    rebuildActiveSynthWavetableFixedMipsFromBase();
  }
  f.close();
  return true;
}

bool applyParsedSynthWavetableFileToRuntime(const SynthWavetableSlot& wavetable, const char* samplePath, size_t sampleLength) {
  synthWaveTableLoadInProgress = true;
  bool loaded = loadActiveSynthWavetableSamplesFromFile(samplePath, sampleLength);
  if (!loaded) {
    synthWaveTableLoadInProgress = false;
    return false;
  }
  setActiveSynthWaveFrameCount(SYNTH_WAVETABLE_FRAME_COUNT);
  userSynthWavetableAvailable = true;
  setCurrentSynthWavetableReference(wavetable.folderPath, wavetable.name);
  currWave = WAVEFORM_BASIC_WAVETABLE;
  settings[static_cast<uint8_t>(SettingKey::Waveform)] = WAVEFORM_BASIC_WAVETABLE;
  loadedSynthWaveform = currWave;
  snprintf(loadedSynthWavetableName, sizeof(loadedSynthWavetableName), "%s", currentSynthWavetableName);
  snprintf(loadedSynthWavetableFolderPath, sizeof(loadedSynthWavetableFolderPath), "%s", currentSynthWavetableFolderPath);
  resetSynthRenderCaches();
  synthWaveTableLoadInProgress = false;
  return true;
}

bool copySynthWavetableSampleFile(const char* sourcePath, const char* destinationPath, size_t sampleLength) {
  if (!sourcePath || !sourcePath[0] || !destinationPath || !destinationPath[0]
      || !isSupportedSynthWavetableSampleLength(sampleLength)) {
    return false;
  }
  File input = LittleFS.open(sourcePath, "r");
  if (!input) {
    return false;
  }
  File output = LittleFS.open(destinationPath, "w");
  if (!output) {
    input.close();
    return false;
  }
  uint8_t buffer[128];
  size_t remaining = sampleLength;
  bool ok = true;
  while (remaining > 0) {
    size_t chunkLength = std::min(sizeof(buffer), remaining);
    if (input.read(buffer, chunkLength) != chunkLength || output.write(buffer, chunkLength) != chunkLength) {
      ok = false;
      break;
    }
    remaining -= chunkLength;
  }
  input.close();
  output.close();
  if (!ok) {
    LittleFS.remove(destinationPath);
  }
  return ok;
}

bool saveParsedSynthWavetable(const ParsedSynthWavetableObject& parsed) {
  if (!fileSystemExists) {
    sendToLog("File system not available.");
    return false;
  }
  SynthWavetableSlot wavetable = {};
  wavetable.valid = 1;
  if (parsed.sawObjectId) {
    memcpy(wavetable.objectId, parsed.objectId, sizeof(wavetable.objectId));
  }
  snprintf(wavetable.name, sizeof(wavetable.name), "%s", parsed.name);
  snprintf(wavetable.folderPath, sizeof(wavetable.folderPath), "%s", parsed.folderPath);
  normalizeSynthWavetableMetadata(wavetable, parsed.samples, parsed.sampleLength);
  pruneMissingSynthWavetables();

  int slotIndex = chooseSynthWavetableWriteSlot(wavetable);
  if (slotIndex < 0) {
    sendToLog("Synth wavetable library is full.");
    return false;
  }

  if (static_cast<size_t>(slotIndex) < synthWavetables.size()) {
    removeSynthWavetableSampleFiles(synthWavetables[slotIndex]);
  }
  if (!writeSynthWavetableSampleFile(wavetable, parsed.samples, parsed.sampleLength)) {
    return false;
  }
  if (static_cast<size_t>(slotIndex) == synthWavetables.size()) {
    synthWavetables.push_back(wavetable);
  } else {
    synthWavetables[slotIndex] = wavetable;
  }
  save_synth_wavetables();
  requestSynthWavetableMenuRebuild();
  return true;
}

bool saveParsedSynthWavetableSampleFile(const ParsedSynthWavetableObject& parsed, const char* samplePath) {
  if (!fileSystemExists) {
    sendToLog("File system not available.");
    return false;
  }
  if (!parsed.sawSamples || !isSupportedSynthWavetableSampleLength(parsed.sampleLength)) {
    sendToLog("Error: Unsupported wavetable sample length.");
    return false;
  }

  SynthWavetableSlot wavetable = {};
  wavetable.valid = 1;
  if (parsed.sawObjectId) {
    memcpy(wavetable.objectId, parsed.objectId, sizeof(wavetable.objectId));
  }
  snprintf(wavetable.name, sizeof(wavetable.name), "%s", parsed.name);
  snprintf(wavetable.folderPath, sizeof(wavetable.folderPath), "%s", parsed.folderPath);
  normalizeSynthWavetableMetadata(wavetable, nullptr, parsed.sampleLength);
  pruneMissingSynthWavetables();

  int slotIndex = chooseSynthWavetableWriteSlot(wavetable);
  if (slotIndex < 0) {
    sendToLog("Synth wavetable library is full.");
    return false;
  }

  if (static_cast<size_t>(slotIndex) < synthWavetables.size()) {
    removeSynthWavetableSampleFiles(synthWavetables[slotIndex]);
  }
  if (!copySynthWavetableSampleFile(samplePath, wavetable.samplePath, parsed.sampleLength)) {
    sendToLog("Error: Incomplete wavetable sample file write.");
    return false;
  }
  if (static_cast<size_t>(slotIndex) == synthWavetables.size()) {
    synthWavetables.push_back(wavetable);
  } else {
    synthWavetables[slotIndex] = wavetable;
  }
  save_synth_wavetables();
  requestSynthWavetableMenuRebuild();
  return true;
}

bool updateSynthWavetableMetadata(uint16_t handle, const ParsedSynthWavetableObject& parsed) {
  if (!fileSystemExists) {
    sendToLog("File system not available.");
    return false;
  }
  if (handle >= synthWavetables.size() || !synthWavetables[handle].valid) {
    sendToLog("Synth wavetable metadata update target missing.");
    return false;
  }

  SynthWavetableSlot updated = synthWavetables[handle];
  if (parsed.sawObjectId
      && memcmp(updated.objectId, parsed.objectId, sizeof(updated.objectId)) != 0) {
    sendToLog("Synth wavetable metadata update object id mismatch.");
    return false;
  }
  snprintf(updated.name, sizeof(updated.name), "%s", parsed.name);
  snprintf(updated.folderPath, sizeof(updated.folderPath), "%s", parsed.folderPath);
  normalizeSynthWavetableMetadata(updated);

  int duplicate = findSynthWavetableByFolderAndName(updated.folderPath, updated.name);
  if (duplicate >= 0 && duplicate != static_cast<int>(handle)) {
    sendToLog("Synth wavetable metadata update duplicate name.");
    return false;
  }

  bool updatesCurrent =
    strncmp(currentSynthWavetableName, synthWavetables[handle].name, sizeof(currentSynthWavetableName)) == 0
    && strncmp(currentSynthWavetableFolderPath,
               synthWavetables[handle].folderPath,
               sizeof(currentSynthWavetableFolderPath)) == 0;

  synthWavetables[handle] = updated;
  save_synth_wavetables();
  requestSynthWavetableMenuRebuild();

  if (updatesCurrent) {
    setCurrentSynthWavetableReference(updated.folderPath, updated.name);
    saveCurrentSynthWavetableReference();
  }
  return true;
}

size_t presetSyncMaxRawObjectBytesForType(uint8_t objectType) {
  switch (objectType) {
    case PRESET_SYNC_OBJECT_TYPE_USER_TUNING:
    case PRESET_SYNC_OBJECT_TYPE_USER_LAYOUT:
    case PRESET_SYNC_OBJECT_TYPE_SCALE_COLOR_MAP:
    case PRESET_SYNC_OBJECT_TYPE_EXPLICIT_BUTTON_MAP:
    case PRESET_SYNC_OBJECT_TYPE_USER_SCALE:
      return GEOMETRY_OBJECT_MAX_RAW_BYTES;
    case PRESET_SYNC_OBJECT_TYPE_SYNTH_PRESET:
      return PRESET_SYNC_MAX_SYNTH_PRESET_BYTES;
    case PRESET_SYNC_OBJECT_TYPE_SYNTH_WAVETABLE:
      return PRESET_SYNC_MAX_SYNTH_WAVETABLE_BYTES;
    default:
      return 0;
  }
}

int findSynthPresetByObjectId(const uint8_t* objectId) {
  for (size_t i = 0; i < synthPresets.size(); ++i) {
    if (synthPresets[i].valid && memcmp(synthPresets[i].objectId, objectId, SYNTH_PRESET_OBJECT_ID_LENGTH) == 0) {
      return static_cast<int>(i);
    }
  }
  return -1;
}

int chooseSynthPresetWriteSlot(uint16_t handle, const SynthPresetSlot& preset) {
  if (handle != PRESET_SYNC_NEW_OBJECT_HANDLE && handle < synthPresets.size()) {
    return handle;
  }
  int existing = findSynthPresetByObjectId(preset.objectId);
  if (existing >= 0) {
    return existing;
  }
  if (synthPresets.size() < SYNTH_PRESET_MAX_COUNT) {
    return static_cast<int>(synthPresets.size());
  }
  return -1;
}

void applySynthPresetRuntimeOnly(const SynthPresetSlot& preset) {
  applySynthPresetToSettings(preset);
  syncSettingsToRuntime();
  markSettingsDirty();
}

bool isPresetSyncSynthSettingKey(SettingKey key) {
  for (SettingKey synthKey : synthPresetKeys) {
    if (synthKey == key) {
      return true;
    }
  }
  return false;
}

void applySynthSettingRuntimeOnly(SettingKey key, uint8_t value) {
  settings[static_cast<uint8_t>(key)] = value;
  switch (key) {
    case SettingKey::PlaybackMode:
      playbackMode = normalizeSynthPlaybackMode(value);
      settings[static_cast<uint8_t>(SettingKey::PlaybackMode)] = playbackMode;
      playbackModeChanged();
      break;
    case SettingKey::Waveform:
      currWave = value;
      synthWaveformChanged();
      break;
    case SettingKey::SynthDrive:
      synthDrive = value > SYNTH_DRIVE_DIRTY ? SYNTH_DRIVE_OFF : value;
      break;
    case SettingKey::SynthModTarget:
      synthModTarget = value;
      updateSynthModulationParams();
      break;
    case SettingKey::SynthModAmount:
      synthModAmount = value;
      updateSynthModulationParams();
      break;
    case SettingKey::SynthVibratoSpeed:
      synthVibratoSpeed = value;
      updateSynthModulationParams();
      break;
    case SettingKey::ArpeggiatorDivision:
      arpeggiatorDivision = value == 0 ? 1 : value;
      updateArpeggiatorTiming();
      break;
    case SettingKey::SynthBPM:
      synthBPM = value == 0 ? 1 : value;
      updateArpeggiatorTiming();
      updateMetronomeTiming();
      break;
    case SettingKey::EnvelopeAttackIndex:
      envelopeAttackIndex = value;
      updateEnvelopeParamsFromSettings();
      break;
    case SettingKey::EnvelopeHoldIndex:
      envelopeHoldIndex = value;
      updateEnvelopeParamsFromSettings();
      break;
    case SettingKey::EnvelopeDecayIndex:
      envelopeDecayIndex = value;
      updateEnvelopeParamsFromSettings();
      break;
    case SettingKey::EnvelopeSustainLevel:
      envelopeSustainLevel = value;
      updateEnvelopeParamsFromSettings();
      break;
    case SettingKey::EnvelopeReleaseIndex:
      envelopeReleaseIndex = value;
      updateEnvelopeParamsFromSettings();
      break;
    case SettingKey::EffectEnvelopeTarget:
      effectEnvelopeTarget[0] = value;
      updateSynthModulationParams();
      updateEffectEnvelopeParamsFromSettings(0);
      break;
    case SettingKey::EffectEnvelopeAmount:
      effectEnvelopeAmount[0] = value;
      updateSynthModulationParams();
      updateEffectEnvelopeParamsFromSettings(0);
      break;
    case SettingKey::EffectEnvelopeAttackIndex:
      effectEnvelopeAttackIndex[0] = value;
      updateEffectEnvelopeParamsFromSettings(0);
      break;
    case SettingKey::EffectEnvelopeHoldIndex:
      effectEnvelopeHoldIndex[0] = value;
      updateEffectEnvelopeParamsFromSettings(0);
      break;
    case SettingKey::EffectEnvelopeDecayIndex:
      effectEnvelopeDecayIndex[0] = value;
      updateEffectEnvelopeParamsFromSettings(0);
      break;
    case SettingKey::EffectEnvelopeSustainLevel:
      effectEnvelopeSustainLevel[0] = value;
      updateEffectEnvelopeParamsFromSettings(0);
      break;
    case SettingKey::EffectEnvelopeReleaseIndex:
      effectEnvelopeReleaseIndex[0] = value;
      updateEffectEnvelopeParamsFromSettings(0);
      break;
    case SettingKey::EffectEnvelope2Target:
      effectEnvelopeTarget[1] = value;
      updateSynthModulationParams();
      updateEffectEnvelopeParamsFromSettings(1);
      break;
    case SettingKey::EffectEnvelope2Amount:
      effectEnvelopeAmount[1] = value;
      updateSynthModulationParams();
      updateEffectEnvelopeParamsFromSettings(1);
      break;
    case SettingKey::EffectEnvelope2AttackIndex:
      effectEnvelopeAttackIndex[1] = value;
      updateEffectEnvelopeParamsFromSettings(1);
      break;
    case SettingKey::EffectEnvelope2HoldIndex:
      effectEnvelopeHoldIndex[1] = value;
      updateEffectEnvelopeParamsFromSettings(1);
      break;
    case SettingKey::EffectEnvelope2DecayIndex:
      effectEnvelopeDecayIndex[1] = value;
      updateEffectEnvelopeParamsFromSettings(1);
      break;
    case SettingKey::EffectEnvelope2SustainLevel:
      effectEnvelopeSustainLevel[1] = value;
      updateEffectEnvelopeParamsFromSettings(1);
      break;
    case SettingKey::EffectEnvelope2ReleaseIndex:
      effectEnvelopeReleaseIndex[1] = value;
      updateEffectEnvelopeParamsFromSettings(1);
      break;
    case SettingKey::SynthPortamentoTimeIndex:
      synthPortamentoTimeIndex = value;
      updateSynthPortamentoSettings();
      break;
    case SettingKey::ArpeggiatorDirection:
      arpeggiatorDirection = value;
      updateArpeggiatorDirection();
      break;
    case SettingKey::SynthWavetablePosition:
      synthWavetablePosition = value;
      updateSynthModulationParams();
      break;
    case SettingKey::SynthLfoTarget:
      synthLfoTarget = value;
      updateSynthModulationParams();
      break;
    case SettingKey::SynthLfoAmount:
      synthLfoAmount = value;
      updateSynthModulationParams();
      break;
    case SettingKey::SynthLfoWave:
      synthLfoWave = value;
      updateSynthModulationParams();
      break;
    case SettingKey::SynthLfoSpeed:
      synthLfoSpeed = value;
      updateSynthModulationParams();
      break;
    default:
      break;
  }
}

void presetSyncHandleSynthParamSet(uint16_t transactionId, const uint8_t* payload, size_t payloadLength) {
  if (payloadLength < 1 || ((payloadLength - 1) % 3) != 0) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_SYNTH_PARAM_SET, PRESET_SYNC_ERROR_BAD_LENGTH);
    return;
  }
  uint8_t recordCount = payload[0];
  if (recordCount == 0 || payloadLength != static_cast<size_t>(1 + recordCount * 3)) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_SYNTH_PARAM_SET, PRESET_SYNC_ERROR_BAD_LENGTH);
    return;
  }

  for (uint8_t i = 0; i < recordCount; ++i) {
    SettingKey key = static_cast<SettingKey>(payload[1 + i * 3]);
    if (!isPresetSyncSynthSettingKey(key) || payload[3 + i * 3] > 1) {
      presetSyncSendNack(transactionId, PRESET_SYNC_MSG_SYNTH_PARAM_SET, PRESET_SYNC_ERROR_VALIDATION_FAILED);
      return;
    }
  }

  for (uint8_t i = 0; i < recordCount; ++i) {
    SettingKey key = static_cast<SettingKey>(payload[1 + i * 3]);
    uint8_t value = payload[2 + i * 3] | (payload[3 + i * 3] << 7);
    applySynthSettingRuntimeOnly(key, value);
  }
  markSettingsDirty();
  presetSyncSendAck(transactionId, PRESET_SYNC_MSG_SYNTH_PARAM_SET);
}
