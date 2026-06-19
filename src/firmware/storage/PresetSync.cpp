#include "../FirmwareModule.h"
#include "../app/DiagnosticsTiming.h"
#include "../app/PlatformCommon.h"
#include "../app/RuntimeDefaults.h"
#include "../menu/GeometryMenu.h"
#include "../menu/MenuAndDisplay.h"
#include "../menu/SynthPresetMenu.h"
#include "../menu/SynthWavetableMenu.h"
#include "../midi/DelegatedControl.h"
#include "../synth/SynthAudio.h"
#include "PresetSync.h"
#include "Settings.h"
#include "SynthPresetStorage.h"
#include "SynthWavetableStorage.h"

void presetSyncHandleHello(uint16_t transactionId, const uint8_t* payload, size_t payloadLength) {
  if (payloadLength != 6) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_HELLO_REQ, PRESET_SYNC_ERROR_BAD_LENGTH);
    return;
  }
  std::vector<uint8_t> response;
  response.push_back(PRESET_SYNC_MAJOR);
  response.push_back(PRESET_SYNC_MINOR);
  presetSyncAppendU14(response, 128);
  presetSyncAppendU28(response,
                      PRESET_SYNC_CAP_SYNTH_PRESET
                      | PRESET_SYNC_CAP_USER_TUNING
                      | PRESET_SYNC_CAP_USER_LAYOUT
                      | PRESET_SYNC_CAP_USER_SCALE
                      | PRESET_SYNC_CAP_SCALE_COLOR_MAP
                      | PRESET_SYNC_CAP_EXPLICIT_BUTTON_MAP
                      | PRESET_SYNC_CAP_DRY_RUN
                      | PRESET_SYNC_CAP_DELETE_USER_OBJECT
                      | PRESET_SYNC_CAP_SYNTH_WAVETABLE
                      | PRESET_SYNC_CAP_LIVE_SYNTH_PARAM);
  presetSyncAppendU28(response, PRESET_SYNC_MAX_RAW_OBJECT_BYTES);
  response.push_back(CURRENT_SETTINGS_VERSION);
  response.push_back(SYNTH_PRESET_SCHEMA_VERSION);
  response.push_back(PROFILE_COUNT);
  presetSyncAppendU14(response, SYNTH_PRESET_MAX_COUNT);
  response.push_back(GEOMETRY_OBJECT_MAX_COUNT);
  response.push_back(GEOMETRY_OBJECT_MAX_COUNT);
  response.push_back(GEOMETRY_OBJECT_MAX_COUNT);
  response.push_back(GEOMETRY_OBJECT_MAX_COUNT);
  response.push_back(Hardware_Version & 0x7F);
  presetSyncSendFrame(PRESET_SYNC_MSG_HELLO_RESP, transactionId, response);
}

void presetSyncAppendAscii(std::vector<uint8_t>& output, const char* text, size_t maxLength) {
  size_t length = boundedCStringLength(text, maxLength);
  output.push_back(std::min<size_t>(length, 127));
  for (size_t i = 0; i < length && i < 127; ++i) {
    uint8_t value = static_cast<uint8_t>(text[i]);
    output.push_back(value <= 0x7F ? value : '?');
  }
}

void presetSyncHandleObjectList(uint16_t transactionId, const uint8_t* payload, size_t payloadLength) {
  if (payloadLength < 5) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_OBJECT_LIST_REQ, PRESET_SYNC_ERROR_BAD_LENGTH);
    return;
  }
  uint8_t objectType = payload[0];
  if (objectType != PRESET_SYNC_OBJECT_TYPE_ALL && !isPresetSyncSupportedObjectType(objectType)) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_OBJECT_LIST_REQ, PRESET_SYNC_ERROR_BAD_OBJECT_TYPE);
    return;
  }
  uint16_t pageIndex = presetSyncDecodeU14(payload + 1);
  uint8_t requestedPageSize = payload[3];
  uint8_t folderLength = payload[4];
  if (payloadLength != static_cast<size_t>(5 + folderLength)) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_OBJECT_LIST_REQ, PRESET_SYNC_ERROR_BAD_LENGTH);
    return;
  }

  char folderFilter[SYNTH_PRESET_FOLDER_LENGTH] = {};
  if (folderLength > 0) {
    copyPresetSyncText(folderFilter, sizeof(folderFilter), payload + 5, folderLength);
  }

  struct PresetSyncListHandle {
    uint8_t objectType;
    uint16_t handle;
  };

  std::vector<PresetSyncListHandle> handles;
  auto includeSynthPreset = [&]() {
    char normalizedFolderFilter[SYNTH_PRESET_FOLDER_LENGTH] = {};
    if (folderFilter[0]) {
      snprintf(normalizedFolderFilter, sizeof(normalizedFolderFilter), "%s", folderFilter);
      normalizeSynthPresetFolderPath(normalizedFolderFilter, sizeof(normalizedFolderFilter));
    }
    for (size_t i = 0; i < synthPresets.size(); ++i) {
      if (!synthPresets[i].valid) {
        continue;
      }
      if (normalizedFolderFilter[0]
          && strncmp(synthPresets[i].folderPath, normalizedFolderFilter, sizeof(synthPresets[i].folderPath)) != 0) {
        continue;
      }
      handles.push_back({ PRESET_SYNC_OBJECT_TYPE_SYNTH_PRESET, static_cast<uint16_t>(i) });
    }
  };
  auto includeSynthWavetable = [&]() {
    char normalizedFolderFilter[SYNTH_WAVETABLE_FOLDER_LENGTH] = {};
    if (folderFilter[0]) {
      snprintf(normalizedFolderFilter, sizeof(normalizedFolderFilter), "%s", folderFilter);
      normalizeSynthWavetableFolderPath(normalizedFolderFilter, sizeof(normalizedFolderFilter));
    }
    for (size_t i = 0; i < synthWavetables.size(); ++i) {
      if (!synthWavetables[i].valid) {
        continue;
      }
      if (normalizedFolderFilter[0]
          && strncmp(synthWavetables[i].folderPath, normalizedFolderFilter, sizeof(synthWavetables[i].folderPath)) != 0) {
        continue;
      }
      handles.push_back({ PRESET_SYNC_OBJECT_TYPE_SYNTH_WAVETABLE, static_cast<uint16_t>(i) });
    }
  };
  auto includeGeometryObjects = [&](uint8_t geometryType) {
    for (size_t i = 0; i < geometryObjects.size(); ++i) {
      if (!geometryObjects[i].valid || geometryObjects[i].objectType != geometryType) {
        continue;
      }
      if (folderFilter[0]
          && strncmp(geometryObjects[i].folderPath, folderFilter, sizeof(geometryObjects[i].folderPath)) != 0) {
        continue;
      }
      handles.push_back({ geometryType, static_cast<uint16_t>(i) });
    }
  };

  if (objectType == PRESET_SYNC_OBJECT_TYPE_ALL || objectType == PRESET_SYNC_OBJECT_TYPE_SYNTH_PRESET) {
    includeSynthPreset();
  }
  if (objectType == PRESET_SYNC_OBJECT_TYPE_ALL || objectType == PRESET_SYNC_OBJECT_TYPE_USER_TUNING) {
    includeGeometryObjects(PRESET_SYNC_OBJECT_TYPE_USER_TUNING);
  }
  if (objectType == PRESET_SYNC_OBJECT_TYPE_ALL || objectType == PRESET_SYNC_OBJECT_TYPE_USER_LAYOUT) {
    includeGeometryObjects(PRESET_SYNC_OBJECT_TYPE_USER_LAYOUT);
  }
  if (objectType == PRESET_SYNC_OBJECT_TYPE_ALL || objectType == PRESET_SYNC_OBJECT_TYPE_SCALE_COLOR_MAP) {
    includeGeometryObjects(PRESET_SYNC_OBJECT_TYPE_SCALE_COLOR_MAP);
  }
  if (objectType == PRESET_SYNC_OBJECT_TYPE_ALL || objectType == PRESET_SYNC_OBJECT_TYPE_EXPLICIT_BUTTON_MAP) {
    includeGeometryObjects(PRESET_SYNC_OBJECT_TYPE_EXPLICIT_BUTTON_MAP);
  }
  if (objectType == PRESET_SYNC_OBJECT_TYPE_ALL || objectType == PRESET_SYNC_OBJECT_TYPE_USER_SCALE) {
    includeGeometryObjects(PRESET_SYNC_OBJECT_TYPE_USER_SCALE);
  }
  if (objectType == PRESET_SYNC_OBJECT_TYPE_ALL || objectType == PRESET_SYNC_OBJECT_TYPE_SYNTH_WAVETABLE) {
    includeSynthWavetable();
  }

  uint8_t pageSize = requestedPageSize == 0 ? 4 : std::min<uint8_t>(requestedPageSize, 4);
  uint16_t pageCount = std::max<uint16_t>(1, (handles.size() + pageSize - 1) / pageSize);
  size_t start = static_cast<size_t>(pageIndex) * pageSize;
  size_t end = std::min(handles.size(), start + pageSize);

  std::vector<uint8_t> response;
  response.push_back(objectType);
  presetSyncAppendU14(response, pageIndex);
  presetSyncAppendU14(response, pageCount);
  response.push_back((start < handles.size()) ? static_cast<uint8_t>(end - start) : 0);
  auto appendRecord = [&](uint8_t recordObjectType,
                          uint16_t handle,
                          uint8_t flags,
                          uint8_t schemaVersion,
                          uint8_t schemaMinor,
                          const uint8_t* objectId,
                          size_t objectIdLength,
                          const char* folderPath,
                          size_t folderPathLength,
                          const char* name,
                          size_t nameLength) {
    response.push_back(recordObjectType);
    presetSyncAppendU14(response, handle);
    response.push_back(flags);
    response.push_back(schemaVersion);
    response.push_back(schemaMinor);
    std::vector<uint8_t> packedObjectId;
    presetSyncPack8To7(objectId, objectIdLength, packedObjectId);
    response.push_back(packedObjectId.size());
    response.insert(response.end(), packedObjectId.begin(), packedObjectId.end());
    presetSyncAppendAscii(response, folderPath, folderPathLength);
    presetSyncAppendAscii(response, name, nameLength);
  };
  if (start < handles.size()) {
    for (size_t listIndex = start; listIndex < end; ++listIndex) {
      PresetSyncListHandle listHandle = handles[listIndex];
      uint16_t handle = listHandle.handle;
      if (listHandle.objectType == PRESET_SYNC_OBJECT_TYPE_SYNTH_PRESET) {
        SynthPresetSlot& preset = synthPresets[handle];
        normalizeSynthPresetMetadata(preset, static_cast<uint8_t>(handle));
        appendRecord(PRESET_SYNC_OBJECT_TYPE_SYNTH_PRESET,
                     handle,
                     0x01,
                     1,
                     0,
                     preset.objectId,
                     sizeof(preset.objectId),
                     preset.folderPath,
                     sizeof(preset.folderPath),
                     preset.name,
                     sizeof(preset.name));
      } else if (listHandle.objectType == PRESET_SYNC_OBJECT_TYPE_SYNTH_WAVETABLE) {
        SynthWavetableSlot& wavetable = synthWavetables[handle];
        normalizeSynthWavetableMetadata(wavetable);
        appendRecord(PRESET_SYNC_OBJECT_TYPE_SYNTH_WAVETABLE,
                     handle,
                     0x01,
                     1,
                     0,
                     wavetable.objectId,
                     sizeof(wavetable.objectId),
                     wavetable.folderPath,
                     sizeof(wavetable.folderPath),
                     wavetable.name,
                     sizeof(wavetable.name));
      } else if (handle < geometryObjects.size() && geometryObjects[handle].valid) {
        GeometryObjectSlot& object = geometryObjects[handle];
        appendRecord(object.objectType,
                     handle,
                     0x01,
                     object.schemaMajor,
                     object.schemaMinor,
                     object.objectId,
                     sizeof(object.objectId),
                     object.folderPath,
                     sizeof(object.folderPath),
                     object.name,
                     sizeof(object.name));
      }
    }
  }
  presetSyncSendFrame(PRESET_SYNC_MSG_OBJECT_LIST_RESP, transactionId, response);
}

uint16_t presetSyncAllocateTransferId() {
  uint16_t current = presetSyncNextTransferId;
  ++presetSyncNextTransferId;
  if (presetSyncNextTransferId == 0 || presetSyncNextTransferId > PRESET_SYNC_NEW_OBJECT_HANDLE) {
    presetSyncNextTransferId = 1;
  }
  return current;
}

uint32_t presetSyncCrc32Update(uint32_t crc, const uint8_t* data, size_t length) {
  for (size_t i = 0; i < length; ++i) {
    crc ^= data[i];
    for (int bit = 0; bit < 8; ++bit) {
      crc = (crc >> 1) ^ (0xEDB88320 & -(crc & 1));
    }
  }
  return crc;
}

uint32_t presetSyncCrc32Finish(uint32_t crc) {
  return ~crc;
}

size_t presetSyncWavetableSampleTlvChunkLength(size_t sampleLength, size_t sampleOffset) {
  return std::min(PRESET_SYNC_WAVETABLE_SAMPLE_TLV_CHUNK_BYTES, sampleLength - sampleOffset);
}

size_t presetSyncWavetableSampleTlvStreamLength(size_t sampleLength) {
  size_t length = 0;
  for (size_t sampleOffset = 0; sampleOffset < sampleLength;) {
    size_t chunkLength = presetSyncWavetableSampleTlvChunkLength(sampleLength, sampleOffset);
    length += 3 + chunkLength;
    sampleOffset += chunkLength;
  }
  return length;
}

bool presetSyncComputeStreamedWavetableCrc(const std::vector<uint8_t>& objectPrefix,
                                           const char* samplePath,
                                           size_t sampleLength,
                                           uint32_t& objectCrc32) {
  uint32_t crc = presetSyncCrc32Update(0xFFFFFFFF, objectPrefix.data(), objectPrefix.size());
  File f = LittleFS.open(samplePath, "r");
  if (!f) {
    return false;
  }

  uint8_t buffer[128];
  for (size_t sampleOffset = 0; sampleOffset < sampleLength;) {
    size_t chunkLength = presetSyncWavetableSampleTlvChunkLength(sampleLength, sampleOffset);
    uint8_t header[3] = {
      PRESET_SYNC_TLV_WAVETABLE_SAMPLES,
      static_cast<uint8_t>(chunkLength & 0xFF),
      static_cast<uint8_t>((chunkLength >> 8) & 0xFF)
    };
    crc = presetSyncCrc32Update(crc, header, sizeof(header));

    size_t remaining = chunkLength;
    while (remaining > 0) {
      size_t readLength = std::min<size_t>(sizeof(buffer), remaining);
      size_t bytesRead = f.read(buffer, readLength);
      if (bytesRead != readLength) {
        f.close();
        return false;
      }
      crc = presetSyncCrc32Update(crc, buffer, readLength);
      remaining -= readLength;
    }
    sampleOffset += chunkLength;
  }
  f.close();
  objectCrc32 = presetSyncCrc32Finish(crc);
  return true;
}

bool presetSyncReadStreamedWavetableSampleTlvBytes(size_t streamOffset, uint8_t* output, size_t length) {
  size_t copied = 0;
  while (copied < length) {
    size_t localOffset = streamOffset + copied;
    size_t sampleOffset = 0;
    size_t chunkLength = 0;
    while (sampleOffset < presetSyncReadTransfer.streamSampleLength) {
      chunkLength = presetSyncWavetableSampleTlvChunkLength(presetSyncReadTransfer.streamSampleLength, sampleOffset);
      size_t segmentLength = 3 + chunkLength;
      if (localOffset < segmentLength) {
        break;
      }
      localOffset -= segmentLength;
      sampleOffset += chunkLength;
    }
    if (sampleOffset >= presetSyncReadTransfer.streamSampleLength) {
      return false;
    }

    if (localOffset < 3) {
      uint8_t header[3] = {
        PRESET_SYNC_TLV_WAVETABLE_SAMPLES,
        static_cast<uint8_t>(chunkLength & 0xFF),
        static_cast<uint8_t>((chunkLength >> 8) & 0xFF)
      };
      size_t copyLength = std::min<size_t>(length - copied, 3 - localOffset);
      memcpy(output + copied, header + localOffset, copyLength);
      copied += copyLength;
      continue;
    }

    size_t chunkDataOffset = localOffset - 3;
    size_t copyLength = std::min(length - copied, chunkLength - chunkDataOffset);
    if (!readSynthWavetableSampleFileRange(presetSyncReadTransfer.streamSamplePath,
                                           static_cast<uint32_t>(sampleOffset + chunkDataOffset),
                                           output + copied,
                                           copyLength)) {
      return false;
    }
    copied += copyLength;
  }
  return true;
}

bool presetSyncReadTransferBytes(uint32_t offset, uint8_t* output, size_t length) {
  if (length == 0) {
    return true;
  }
  if (output == nullptr || offset + length > presetSyncReadTransfer.rawByteLength) {
    return false;
  }
  if (!presetSyncReadTransfer.streamSynthWavetableSamples) {
    if (offset + length > presetSyncReadTransfer.rawData.size()) {
      return false;
    }
    memcpy(output, presetSyncReadTransfer.rawData.data() + offset, length);
    return true;
  }

  const size_t prefixLength = presetSyncReadTransfer.rawData.size();
  size_t copied = 0;
  if (offset < prefixLength) {
    size_t prefixCopyLength = std::min<size_t>(length, prefixLength - offset);
    memcpy(output, presetSyncReadTransfer.rawData.data() + offset, prefixCopyLength);
    copied += prefixCopyLength;
  }
  if (copied >= length) {
    return true;
  }

  size_t sampleStreamOffset = offset + copied - prefixLength;
  return presetSyncReadStreamedWavetableSampleTlvBytes(sampleStreamOffset,
                                                       output + copied,
                                                       length - copied);
}

bool presetSyncCreateWriteTempFile(PresetSyncWriteTransfer& transfer) {
  if (!fileSystemExists) {
    return false;
  }
  LittleFS.remove(PRESET_SYNC_WRITE_RAW_TEMP_FILE_PATH);
  File f = LittleFS.open(PRESET_SYNC_WRITE_RAW_TEMP_FILE_PATH, "w");
  if (!f) {
    return false;
  }
  f.close();
  transfer.streamRawToFile = true;
  snprintf(transfer.streamRawPath,
           sizeof(transfer.streamRawPath),
           "%s",
           PRESET_SYNC_WRITE_RAW_TEMP_FILE_PATH);
  return true;
}

bool presetSyncAppendWriteTempFile(const PresetSyncWriteTransfer& transfer, const uint8_t* data, size_t length) {
  if (!transfer.streamRawPath[0]) {
    return false;
  }
  File f = LittleFS.open(transfer.streamRawPath, "a");
  if (!f) {
    return false;
  }
  size_t written = f.write(data, length);
  f.close();
  return written == length;
}

void presetSyncSendReadBegin() {
  std::vector<uint8_t> begin;
  begin.push_back(presetSyncReadTransfer.objectType);
  presetSyncAppendU14(begin, presetSyncReadTransfer.handle);
  presetSyncAppendU14(begin, presetSyncReadTransfer.transferId);
  begin.push_back(presetSyncReadTransfer.schemaMajor);
  begin.push_back(presetSyncReadTransfer.schemaMinor);
  presetSyncAppendU28(begin, presetSyncReadTransfer.rawByteLength);
  presetSyncAppendU35FromU32(begin, presetSyncReadTransfer.objectCrc32);
  presetSyncAppendU14(begin, PRESET_SYNC_RAW_CHUNK_SIZE);
  begin.push_back(0);
  presetSyncSendFrame(PRESET_SYNC_MSG_READ_BEGIN, presetSyncReadTransfer.transactionId, begin);
}

void presetSyncSendReadEnd() {
  std::vector<uint8_t> endPayload;
  presetSyncAppendU14(endPayload, presetSyncReadTransfer.transferId);
  presetSyncAppendU21(endPayload, presetSyncReadTransfer.nextChunkIndex);
  presetSyncReadTransfer.endSent = true;
  presetSyncSendFrame(PRESET_SYNC_MSG_TRANSFER_END, presetSyncReadTransfer.transactionId, endPayload);
}

void presetSyncSendNextReadChunk() {
  if (!presetSyncReadTransfer.active) {
    return;
  }
  if (presetSyncReadTransfer.sentBytes >= presetSyncReadTransfer.rawByteLength) {
    presetSyncSendReadEnd();
    return;
  }

  size_t offset = presetSyncReadTransfer.sentBytes;
  size_t chunkLength = std::min<size_t>(PRESET_SYNC_RAW_CHUNK_SIZE, presetSyncReadTransfer.rawByteLength - offset);
  uint8_t rawChunk[PRESET_SYNC_RAW_CHUNK_SIZE] = {};
  if (!presetSyncReadTransferBytes(offset, rawChunk, chunkLength)) {
    uint16_t transactionId = presetSyncReadTransfer.transactionId;
    sendToLog("Preset-sync read failed while streaming wavetable samples.");
    presetSyncCancelReadTransfer();
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_DATA_CHUNK, PRESET_SYNC_ERROR_OBJECT_MISSING);
    return;
  }

  std::vector<uint8_t> chunk;
  chunk.reserve(12 + ((chunkLength + 6) / 7) * 8);
  presetSyncAppendU14(chunk, presetSyncReadTransfer.transferId);
  presetSyncAppendU21(chunk, presetSyncReadTransfer.nextChunkIndex);
  presetSyncAppendU28(chunk, offset);
  presetSyncAppendU14(chunk, chunkLength);
  chunk.push_back(presetSyncChunkChecksum(rawChunk, chunkLength));
  presetSyncPack8To7(rawChunk, chunkLength, chunk);
  presetSyncSendFrame(PRESET_SYNC_MSG_DATA_CHUNK, presetSyncReadTransfer.transactionId, chunk);
  presetSyncReadTransfer.sentBytes += chunkLength;
  ++presetSyncReadTransfer.nextChunkIndex;
}

void presetSyncSendRawObject(uint16_t transactionId, uint8_t objectType, uint16_t handle, uint8_t schemaMajor, uint8_t schemaMinor, const std::vector<uint8_t>& raw) {
  presetSyncReadTransfer = PresetSyncReadTransfer{};
  presetSyncReadTransfer.active = true;
  presetSyncReadTransfer.objectType = objectType;
  presetSyncReadTransfer.handle = handle;
  presetSyncReadTransfer.transactionId = transactionId;
  presetSyncReadTransfer.transferId = presetSyncAllocateTransferId();
  presetSyncReadTransfer.schemaMajor = schemaMajor;
  presetSyncReadTransfer.schemaMinor = schemaMinor;
  presetSyncReadTransfer.rawByteLength = raw.size();
  presetSyncReadTransfer.objectCrc32 = crc32(raw.data(), raw.size());
  presetSyncReadTransfer.rawData = raw;
  presetSyncSendReadBegin();
}

void presetSyncSendStreamedSynthWavetableObject(uint16_t transactionId,
                                                uint16_t handle,
                                                const SynthWavetableSlot& wavetable) {
  char samplePath[SYNTH_WAVETABLE_SAMPLE_PATH_LENGTH] = {};
  if (!resolveSynthWavetableSampleFilePath(wavetable, samplePath, sizeof(samplePath))) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_READ_REQ, PRESET_SYNC_ERROR_OBJECT_MISSING);
    return;
  }

  size_t sampleLength = synthWavetableSampleFileLength(samplePath);
  if (!isSupportedSynthWavetableSampleLength(sampleLength)) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_READ_REQ, PRESET_SYNC_ERROR_BAD_LENGTH);
    return;
  }

  std::vector<uint8_t> objectPrefix = buildSynthWavetableObjectPrefix(wavetable, sampleLength);
  uint32_t rawByteLength =
    static_cast<uint32_t>(objectPrefix.size() + presetSyncWavetableSampleTlvStreamLength(sampleLength));
  if (rawByteLength > PRESET_SYNC_MAX_SYNTH_WAVETABLE_BYTES) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_READ_REQ, PRESET_SYNC_ERROR_BAD_LENGTH);
    return;
  }

  uint32_t objectCrc32 = 0;
  if (!presetSyncComputeStreamedWavetableCrc(objectPrefix, samplePath, sampleLength, objectCrc32)) {
    sendToLog("Incomplete wavetable sample file for " + std::string(wavetable.name));
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_READ_REQ, PRESET_SYNC_ERROR_OBJECT_MISSING);
    return;
  }

  presetSyncReadTransfer = PresetSyncReadTransfer{};
  presetSyncReadTransfer.active = true;
  presetSyncReadTransfer.streamSynthWavetableSamples = true;
  presetSyncReadTransfer.objectType = PRESET_SYNC_OBJECT_TYPE_SYNTH_WAVETABLE;
  presetSyncReadTransfer.handle = handle;
  presetSyncReadTransfer.transactionId = transactionId;
  presetSyncReadTransfer.transferId = presetSyncAllocateTransferId();
  presetSyncReadTransfer.schemaMajor = 1;
  presetSyncReadTransfer.schemaMinor = sampleLength == SYNTH_WAVETABLE_MIP_SAMPLE_BYTES ? 2 : 0;
  presetSyncReadTransfer.rawByteLength = rawByteLength;
  presetSyncReadTransfer.objectCrc32 = objectCrc32;
  snprintf(presetSyncReadTransfer.streamSamplePath,
           sizeof(presetSyncReadTransfer.streamSamplePath),
           "%s",
           samplePath);
  presetSyncReadTransfer.streamSampleLength = sampleLength;
  presetSyncReadTransfer.rawData = objectPrefix;
  presetSyncSendReadBegin();
}

void presetSyncHandleReadRequest(uint16_t transactionId, const uint8_t* payload, size_t payloadLength) {
  if (payloadLength != 4) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_READ_REQ, PRESET_SYNC_ERROR_BAD_LENGTH);
    return;
  }
  if (presetSyncReadTransfer.active || presetSyncWriteTransfer.active) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_READ_REQ, PRESET_SYNC_ERROR_BUSY);
    return;
  }
  uint8_t objectType = payload[0];
  if (!isPresetSyncSupportedObjectType(objectType)) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_READ_REQ, PRESET_SYNC_ERROR_BAD_OBJECT_TYPE);
    return;
  }
  uint16_t handle = presetSyncDecodeU14(payload + 1);
  if (isPresetSyncGeometryObjectType(objectType)) {
    if (handle >= geometryObjects.size()
        || !geometryObjects[handle].valid
        || geometryObjects[handle].objectType != objectType) {
      presetSyncSendNack(transactionId, PRESET_SYNC_MSG_READ_REQ, PRESET_SYNC_ERROR_OBJECT_MISSING);
      return;
    }
    presetSyncSendRawObject(transactionId,
                            objectType,
                            handle,
                            geometryObjects[handle].schemaMajor,
                            geometryObjects[handle].schemaMinor,
                            geometryObjects[handle].body);
    return;
  }
  if (objectType == PRESET_SYNC_OBJECT_TYPE_SYNTH_WAVETABLE) {
    if (handle >= synthWavetables.size() || !synthWavetables[handle].valid) {
      presetSyncSendNack(transactionId, PRESET_SYNC_MSG_READ_REQ, PRESET_SYNC_ERROR_OBJECT_MISSING);
      return;
    }
    normalizeSynthWavetableMetadata(synthWavetables[handle]);
    presetSyncSendStreamedSynthWavetableObject(transactionId, handle, synthWavetables[handle]);
    return;
  }

  if (handle == PRESET_SYNC_CURRENT_SYNTH_PRESET_HANDLE) {
    SynthPresetSlot currentPreset = buildCurrentSynthPresetObject();
    presetSyncSendRawObject(transactionId, PRESET_SYNC_OBJECT_TYPE_SYNTH_PRESET, handle, 1, 0, buildSynthPresetObjectBody(currentPreset));
    return;
  }
  if (handle >= synthPresets.size() || !synthPresets[handle].valid) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_READ_REQ, PRESET_SYNC_ERROR_OBJECT_MISSING);
    return;
  }
  normalizeSynthPresetMetadata(synthPresets[handle], handle);
  presetSyncSendRawObject(transactionId, PRESET_SYNC_OBJECT_TYPE_SYNTH_PRESET, handle, 1, 0, buildSynthPresetObjectBody(synthPresets[handle]));
}

void presetSyncHandleAck(uint16_t transactionId, const uint8_t* payload, size_t payloadLength) {
  if (payloadLength != 6 || !presetSyncReadTransfer.active || transactionId != presetSyncReadTransfer.transactionId) {
    return;
  }

  uint8_t ackedMessage = payload[0];
  uint32_t nextChunkIndex = presetSyncDecodeU21(payload + 2);
  switch (ackedMessage) {
    case PRESET_SYNC_MSG_READ_BEGIN:
      if (presetSyncReadTransfer.nextChunkIndex == 0 && presetSyncReadTransfer.sentBytes == 0) {
        presetSyncSendNextReadChunk();
      }
      break;
    case PRESET_SYNC_MSG_DATA_CHUNK:
      if (!presetSyncReadTransfer.endSent && nextChunkIndex == presetSyncReadTransfer.nextChunkIndex) {
        presetSyncSendNextReadChunk();
      }
      break;
    case PRESET_SYNC_MSG_TRANSFER_END:
      presetSyncCancelReadTransfer();
      break;
    default:
      break;
  }
}

void presetSyncHandleNack(uint16_t transactionId, const uint8_t* payload, size_t payloadLength) {
  if (payloadLength != 6 || !presetSyncReadTransfer.active || transactionId != presetSyncReadTransfer.transactionId) {
    return;
  }
  uint8_t failedMessage = payload[0];
  if (failedMessage == PRESET_SYNC_MSG_READ_BEGIN
      || failedMessage == PRESET_SYNC_MSG_DATA_CHUNK
      || failedMessage == PRESET_SYNC_MSG_TRANSFER_END) {
    sendToLog("Preset-sync read transfer aborted by host NACK.");
    presetSyncCancelReadTransfer();
  }
}

void presetSyncHandleWriteBegin(uint16_t transactionId, const uint8_t* payload, size_t payloadLength) {
  if (payloadLength != 19) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_WRITE_BEGIN, PRESET_SYNC_ERROR_BAD_LENGTH);
    return;
  }
  if (presetSyncWriteTransfer.active || presetSyncReadTransfer.active) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_WRITE_BEGIN, PRESET_SYNC_ERROR_BUSY);
    return;
  }
  uint8_t objectType = payload[0];
  size_t maxRawObjectBytes = presetSyncMaxRawObjectBytesForType(objectType);
  if (maxRawObjectBytes == 0) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_WRITE_BEGIN, PRESET_SYNC_ERROR_BAD_OBJECT_TYPE);
    return;
  }

  uint32_t rawByteLength = presetSyncDecodeU28(payload + 7);
  if (rawByteLength == 0 || rawByteLength > maxRawObjectBytes) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_WRITE_BEGIN, PRESET_SYNC_ERROR_BAD_LENGTH);
    return;
  }
  if (payload[5] != 1) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_WRITE_BEGIN, PRESET_SYNC_ERROR_SCHEMA_MISMATCH);
    return;
  }

  presetSyncWriteTransfer = PresetSyncWriteTransfer{};
  presetSyncWriteTransfer.active = true;
  presetSyncWriteTransfer.objectType = objectType;
  presetSyncWriteTransfer.handle = presetSyncDecodeU14(payload + 1);
  presetSyncWriteTransfer.transferId = presetSyncDecodeU14(payload + 3);
  presetSyncWriteTransfer.schemaMajor = payload[5];
  presetSyncWriteTransfer.schemaMinor = payload[6];
  presetSyncWriteTransfer.rawByteLength = rawByteLength;
  presetSyncWriteTransfer.objectCrc32 = presetSyncDecodeU35ToU32(payload + 11);
  presetSyncWriteTransfer.rawChunkSize = presetSyncDecodeU14(payload + 16);
  presetSyncWriteTransfer.writeFlags = payload[18];
  presetSyncWriteTransfer.receivedCrc32 = 0xFFFFFFFFu;
  if (objectType == PRESET_SYNC_OBJECT_TYPE_SYNTH_WAVETABLE) {
    if (!presetSyncCreateWriteTempFile(presetSyncWriteTransfer)) {
      presetSyncCancelWriteTransfer();
      presetSyncSendNack(transactionId, PRESET_SYNC_MSG_WRITE_BEGIN, PRESET_SYNC_ERROR_STORAGE_FULL);
      return;
    }
  } else {
    presetSyncWriteTransfer.rawData.assign(rawByteLength, 0);
  }
  presetSyncSendAck(transactionId, PRESET_SYNC_MSG_WRITE_BEGIN);
}

void presetSyncHandleDataChunk(uint16_t transactionId, const uint8_t* payload, size_t payloadLength) {
  if (payloadLength < 12) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_DATA_CHUNK, PRESET_SYNC_ERROR_BAD_LENGTH);
    return;
  }
  if (!presetSyncWriteTransfer.active) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_DATA_CHUNK, PRESET_SYNC_ERROR_UNEXPECTED_CHUNK);
    return;
  }
  uint16_t transferId = presetSyncDecodeU14(payload);
  uint32_t chunkIndex = presetSyncDecodeU21(payload + 2);
  uint32_t rawOffset = presetSyncDecodeU28(payload + 5);
  uint16_t rawLength = presetSyncDecodeU14(payload + 9);
  uint8_t checksum = payload[11];
  if (transferId != presetSyncWriteTransfer.transferId
      || chunkIndex != presetSyncWriteTransfer.expectedChunkIndex
      || rawOffset != presetSyncWriteTransfer.receivedBytes
      || rawOffset + rawLength > presetSyncWriteTransfer.rawByteLength) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_DATA_CHUNK, PRESET_SYNC_ERROR_UNEXPECTED_CHUNK, presetSyncWriteTransfer.expectedChunkIndex);
    return;
  }

  std::vector<uint8_t> raw;
  if (!presetSyncUnpack8To7(payload + 12, payloadLength - 12, rawLength, raw)) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_DATA_CHUNK, PRESET_SYNC_ERROR_BAD_LENGTH, presetSyncWriteTransfer.expectedChunkIndex);
    return;
  }
  if (presetSyncChunkChecksum(raw.data(), raw.size()) != checksum) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_DATA_CHUNK, PRESET_SYNC_ERROR_BAD_CHECKSUM, presetSyncWriteTransfer.expectedChunkIndex);
    return;
  }

  if (presetSyncWriteTransfer.streamRawToFile) {
    if (!presetSyncAppendWriteTempFile(presetSyncWriteTransfer, raw.data(), raw.size())) {
      presetSyncCancelWriteTransfer();
      presetSyncSendNack(transactionId, PRESET_SYNC_MSG_DATA_CHUNK, PRESET_SYNC_ERROR_STORAGE_FULL);
      return;
    }
  } else {
    memcpy(presetSyncWriteTransfer.rawData.data() + rawOffset, raw.data(), raw.size());
  }
  presetSyncWriteTransfer.receivedCrc32 =
    presetSyncCrc32Update(presetSyncWriteTransfer.receivedCrc32, raw.data(), raw.size());
  presetSyncWriteTransfer.receivedBytes += raw.size();
  ++presetSyncWriteTransfer.expectedChunkIndex;
  presetSyncSendAck(transactionId, PRESET_SYNC_MSG_DATA_CHUNK, presetSyncWriteTransfer.expectedChunkIndex);
}

void presetSyncHandleTransferEnd(uint16_t transactionId, const uint8_t* payload, size_t payloadLength) {
  if (payloadLength != 5) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_TRANSFER_END, PRESET_SYNC_ERROR_BAD_LENGTH);
    return;
  }
  if (!presetSyncWriteTransfer.active) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_TRANSFER_END, PRESET_SYNC_ERROR_UNEXPECTED_CHUNK);
    return;
  }
  uint16_t transferId = presetSyncDecodeU14(payload);
  uint32_t finalChunkCount = presetSyncDecodeU21(payload + 2);
  if (transferId != presetSyncWriteTransfer.transferId
      || finalChunkCount != presetSyncWriteTransfer.expectedChunkIndex
      || presetSyncWriteTransfer.receivedBytes != presetSyncWriteTransfer.rawByteLength) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_TRANSFER_END, PRESET_SYNC_ERROR_UNEXPECTED_CHUNK, presetSyncWriteTransfer.expectedChunkIndex);
    return;
  }
  presetSyncWriteTransfer.ended = true;
  presetSyncSendAck(transactionId, PRESET_SYNC_MSG_TRANSFER_END);
}

void presetSyncHandleWriteCommit(uint16_t transactionId, const uint8_t* payload, size_t payloadLength) {
  if (payloadLength != 12) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_WRITE_COMMIT, PRESET_SYNC_ERROR_BAD_LENGTH);
    return;
  }
  if (!presetSyncWriteTransfer.active || !presetSyncWriteTransfer.ended) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_WRITE_COMMIT, PRESET_SYNC_ERROR_UNEXPECTED_CHUNK);
    return;
  }
  uint16_t transferId = presetSyncDecodeU14(payload);
  uint32_t rawByteLength = presetSyncDecodeU28(payload + 2);
  uint32_t objectCrc32 = presetSyncDecodeU35ToU32(payload + 6);
  uint8_t commitFlags = payload[11];
  if (transferId != presetSyncWriteTransfer.transferId
      || rawByteLength != presetSyncWriteTransfer.rawByteLength
      || objectCrc32 != presetSyncWriteTransfer.objectCrc32) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_WRITE_COMMIT, PRESET_SYNC_ERROR_UNEXPECTED_CHUNK);
    return;
  }
  uint32_t computedCrc = presetSyncWriteTransfer.streamRawToFile
    ? presetSyncCrc32Finish(presetSyncWriteTransfer.receivedCrc32)
    : crc32(presetSyncWriteTransfer.rawData.data(), presetSyncWriteTransfer.rawData.size());
  if (computedCrc != objectCrc32) {
    presetSyncCancelWriteTransfer();
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_WRITE_COMMIT, PRESET_SYNC_ERROR_BAD_CRC);
    return;
  }

  std::string parseError;
  if (presetSyncWriteTransfer.objectType == PRESET_SYNC_OBJECT_TYPE_SYNTH_PRESET) {
    SynthPresetSlot parsedPreset;
    if (!parseSynthPresetObjectBody(presetSyncWriteTransfer.rawData, parsedPreset, parseError)) {
      sendToLog("Preset sync rejected synth preset: " + parseError);
      presetSyncCancelWriteTransfer();
      presetSyncSendNack(transactionId, PRESET_SYNC_MSG_WRITE_COMMIT, PRESET_SYNC_ERROR_VALIDATION_FAILED);
      return;
    }

    if (!(commitFlags & PRESET_SYNC_WRITE_DRY_RUN)) {
      if (commitFlags & PRESET_SYNC_WRITE_APPLY_TO_RUNTIME) {
        applySynthPresetRuntimeOnly(parsedPreset);
      }
      if (commitFlags & PRESET_SYNC_WRITE_SAVE_TO_FLASH) {
        int slotIndex = chooseSynthPresetWriteSlot(presetSyncWriteTransfer.handle, parsedPreset);
        if (slotIndex < 0) {
          presetSyncCancelWriteTransfer();
          presetSyncSendNack(transactionId, PRESET_SYNC_MSG_WRITE_COMMIT, PRESET_SYNC_ERROR_STORAGE_FULL);
          return;
        }
        if (static_cast<size_t>(slotIndex) == synthPresets.size()) {
          synthPresets.push_back(parsedPreset);
        } else {
          synthPresets[slotIndex] = parsedPreset;
        }
        normalizeSynthPresetMetadata(synthPresets[slotIndex], static_cast<uint8_t>(slotIndex));
        flashSafeSaveSynthPresets();
        requestSynthPresetMenuRebuild();
        if (commitFlags & PRESET_SYNC_WRITE_APPLY_TO_RUNTIME) {
          flashSafeSaveCurrentSynthWavetableReference();
        }
      }
    }
  } else if (presetSyncWriteTransfer.objectType == PRESET_SYNC_OBJECT_TYPE_SYNTH_WAVETABLE) {
    ParsedSynthWavetableObject parsedWavetable;
    bool parsed = presetSyncWriteTransfer.streamRawToFile
      ? parseSynthWavetableObjectFile(presetSyncWriteTransfer.streamRawPath,
                                      parsedWavetable,
                                      PRESET_SYNC_WAVETABLE_SAMPLE_TEMP_FILE_PATH,
                                      parseError)
      : parseSynthWavetableObjectBody(presetSyncWriteTransfer.rawData, parsedWavetable, parseError);
    if (!parsed) {
      sendToLog("Preset sync rejected synth wavetable: " + parseError);
      presetSyncCancelWriteTransfer();
      presetSyncSendNack(transactionId, PRESET_SYNC_MSG_WRITE_COMMIT, PRESET_SYNC_ERROR_VALIDATION_FAILED);
      return;
    }

    if (!(commitFlags & PRESET_SYNC_WRITE_DRY_RUN)) {
      if (commitFlags & PRESET_SYNC_WRITE_SAVE_TO_FLASH) {
        flashWriteInProgress.store(true, std::memory_order_release);
        delayMicroseconds(AUDIO_DMA_BUFFER_MICROS * 2);
        bool saved = false;
        if (parsedWavetable.sawSamples) {
          saved = presetSyncWriteTransfer.streamRawToFile
            ? saveParsedSynthWavetableSampleFile(parsedWavetable, PRESET_SYNC_WAVETABLE_SAMPLE_TEMP_FILE_PATH)
            : saveParsedSynthWavetable(parsedWavetable);
        } else {
          saved = updateSynthWavetableMetadata(presetSyncWriteTransfer.handle, parsedWavetable);
        }
        flashWriteInProgress.store(false, std::memory_order_release);
        if (!saved) {
          presetSyncCancelWriteTransfer();
          presetSyncSendNack(transactionId,
                             PRESET_SYNC_MSG_WRITE_COMMIT,
                             parsedWavetable.sawSamples ? PRESET_SYNC_ERROR_STORAGE_FULL : PRESET_SYNC_ERROR_VALIDATION_FAILED);
          return;
        }
      }
      if ((commitFlags & PRESET_SYNC_WRITE_APPLY_TO_RUNTIME) && parsedWavetable.sawSamples) {
        SynthWavetableSlot runtimeWavetable = {};
        runtimeWavetable.valid = 1;
        if (parsedWavetable.sawObjectId) {
          memcpy(runtimeWavetable.objectId, parsedWavetable.objectId, sizeof(runtimeWavetable.objectId));
        }
        snprintf(runtimeWavetable.name, sizeof(runtimeWavetable.name), "%s", parsedWavetable.name);
        snprintf(runtimeWavetable.folderPath, sizeof(runtimeWavetable.folderPath), "%s", parsedWavetable.folderPath);
        normalizeSynthWavetableMetadata(runtimeWavetable, parsedWavetable.samples, parsedWavetable.sampleLength);
        bool applied = presetSyncWriteTransfer.streamRawToFile
          ? applyParsedSynthWavetableFileToRuntime(runtimeWavetable,
                                                   PRESET_SYNC_WAVETABLE_SAMPLE_TEMP_FILE_PATH,
                                                   parsedWavetable.sampleLength)
          : (applyParsedSynthWavetableToRuntime(runtimeWavetable,
                                                parsedWavetable.samples,
                                                parsedWavetable.sampleLength),
             true);
        if (!applied) {
          presetSyncCancelWriteTransfer();
          presetSyncSendNack(transactionId, PRESET_SYNC_MSG_WRITE_COMMIT, PRESET_SYNC_ERROR_VALIDATION_FAILED);
          return;
        }
        if (commitFlags & PRESET_SYNC_WRITE_SAVE_TO_FLASH) {
          flashSafeSaveCurrentSynthWavetableReference();
        }
      }
    }
  } else if (isPresetSyncGeometryObjectType(presetSyncWriteTransfer.objectType)) {
    GeometryObjectSlot parsedObject;
    if (!parseGeometryObjectBody(presetSyncWriteTransfer.rawData, parsedObject, parseError)
        || parsedObject.objectType != presetSyncWriteTransfer.objectType) {
      sendToLog("Preset sync rejected geometry object: " + parseError);
      presetSyncCancelWriteTransfer();
      presetSyncSendNack(transactionId, PRESET_SYNC_MSG_WRITE_COMMIT, PRESET_SYNC_ERROR_VALIDATION_FAILED);
      return;
    }

    if (!(commitFlags & PRESET_SYNC_WRITE_DRY_RUN)
        && (commitFlags & PRESET_SYNC_WRITE_APPLY_TO_RUNTIME)
        && !applyGeometryObjectToRuntime(parsedObject)) {
      presetSyncCancelWriteTransfer();
      presetSyncSendNack(transactionId, PRESET_SYNC_MSG_WRITE_COMMIT, PRESET_SYNC_ERROR_VALIDATION_FAILED);
      return;
    }

    if (!(commitFlags & PRESET_SYNC_WRITE_DRY_RUN)
        && (commitFlags & PRESET_SYNC_WRITE_SAVE_TO_FLASH)) {
      int slotIndex = chooseGeometryObjectWriteSlot(presetSyncWriteTransfer.handle, parsedObject);
      if (slotIndex < 0) {
        presetSyncCancelWriteTransfer();
        presetSyncSendNack(transactionId, PRESET_SYNC_MSG_WRITE_COMMIT, PRESET_SYNC_ERROR_STORAGE_FULL);
        return;
      }
      if (static_cast<size_t>(slotIndex) == geometryObjects.size()) {
        geometryObjects.push_back(parsedObject);
      } else {
        geometryObjects[slotIndex] = parsedObject;
      }
      flashSafeSaveGeometryObjects();
      requestUserGeometryMenuRebuild();
    }
  } else {
    presetSyncCancelWriteTransfer();
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_WRITE_COMMIT, PRESET_SYNC_ERROR_BAD_OBJECT_TYPE);
    return;
  }

  presetSyncCancelWriteTransfer();
  presetSyncSendAck(transactionId, PRESET_SYNC_MSG_WRITE_COMMIT);
}

void presetSyncHandleTransferAbort(uint16_t transactionId, const uint8_t* payload, size_t payloadLength) {
  if (payloadLength != 3) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_TRANSFER_ABORT, PRESET_SYNC_ERROR_BAD_LENGTH);
    return;
  }
  uint16_t transferId = presetSyncDecodeU14(payload);
  bool matched = false;
  if (presetSyncWriteTransfer.active && presetSyncWriteTransfer.transferId == transferId) {
    presetSyncCancelWriteTransfer();
    matched = true;
  }
  if (presetSyncReadTransfer.active && presetSyncReadTransfer.transferId == transferId) {
    presetSyncReadTransfer = PresetSyncReadTransfer{};
    matched = true;
  }
  if (!matched) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_TRANSFER_ABORT, PRESET_SYNC_ERROR_UNEXPECTED_CHUNK);
    return;
  }
  presetSyncSendAck(transactionId, PRESET_SYNC_MSG_TRANSFER_ABORT);
}

void presetSyncHandleDelete(uint16_t transactionId, const uint8_t* payload, size_t payloadLength) {
  if (payloadLength != 4) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_DELETE_REQ, PRESET_SYNC_ERROR_BAD_LENGTH);
    return;
  }
  uint8_t objectType = payload[0];
  if (!isPresetSyncSupportedObjectType(objectType)) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_DELETE_REQ, PRESET_SYNC_ERROR_BAD_OBJECT_TYPE);
    return;
  }
  uint16_t handle = presetSyncDecodeU14(payload + 1);
  uint8_t deleteFlags = payload[3];
  if (objectType == PRESET_SYNC_OBJECT_TYPE_SYNTH_PRESET) {
    if (handle >= synthPresets.size() || !synthPresets[handle].valid) {
      presetSyncSendNack(transactionId, PRESET_SYNC_MSG_DELETE_REQ, PRESET_SYNC_ERROR_OBJECT_MISSING);
      return;
    }
    if (!(deleteFlags & 0x01)) {
      synthPresets.erase(synthPresets.begin() + handle);
      flashSafeSaveSynthPresets();
      requestSynthPresetMenuRebuild();
    }
  } else if (isPresetSyncGeometryObjectType(objectType)) {
    if (handle >= geometryObjects.size()
        || !geometryObjects[handle].valid
        || geometryObjects[handle].objectType != objectType) {
      presetSyncSendNack(transactionId, PRESET_SYNC_MSG_DELETE_REQ, PRESET_SYNC_ERROR_OBJECT_MISSING);
      return;
    }
    if (!(deleteFlags & 0x01)) {
      geometryObjects.erase(geometryObjects.begin() + handle);
      flashSafeSaveGeometryObjects();
      requestUserGeometryMenuRebuild();
    }
  } else {
    if (handle >= synthWavetables.size() || !synthWavetables[handle].valid) {
      presetSyncSendNack(transactionId, PRESET_SYNC_MSG_DELETE_REQ, PRESET_SYNC_ERROR_OBJECT_MISSING);
      return;
    }
    if (!(deleteFlags & 0x01)) {
      bool deletedCurrent =
        strncmp(currentSynthWavetableName, synthWavetables[handle].name, sizeof(currentSynthWavetableName)) == 0
        && strncmp(currentSynthWavetableFolderPath,
                   synthWavetables[handle].folderPath,
                   sizeof(currentSynthWavetableFolderPath)) == 0;
      removeSynthWavetableSampleFiles(synthWavetables[handle]);
      synthWavetables.erase(synthWavetables.begin() + handle);
      flashSafeSaveSynthWavetables();
      requestSynthWavetableMenuRebuild();
      if (deletedCurrent) {
        selectFallbackSynthWavetable();
        loadSelectedSynthWavetable();
        markSettingsDirty();
      }
    }
  }
  presetSyncSendAck(transactionId, PRESET_SYNC_MSG_DELETE_REQ);
}

bool processPresetSyncSysEx(const uint8_t* data, const unsigned int len) {
  if (len < 9 || data[0] != 0xF0 || data[len - 1] != 0xF7 || data[1] != 0x7D || data[2] != PRESET_SYNC_FAMILY) {
    return false;
  }
  uint8_t major = data[3];
  uint8_t message = data[5];
  uint16_t transactionId = presetSyncDecodeU14(data + 6);
  const uint8_t* payload = data + 8;
  size_t payloadLength = len - 9;

  if (!presetSyncPayloadIsSevenBit(payload, payloadLength)) {
    presetSyncSendNack(transactionId, message, PRESET_SYNC_ERROR_BAD_LENGTH);
    return true;
  }
  if (major != PRESET_SYNC_MAJOR) {
    presetSyncSendNack(transactionId, message, PRESET_SYNC_ERROR_UNSUPPORTED_PROTOCOL);
    return true;
  }

  switch (message) {
    case PRESET_SYNC_MSG_HELLO_REQ:
      presetSyncHandleHello(transactionId, payload, payloadLength);
      break;
    case PRESET_SYNC_MSG_OBJECT_LIST_REQ:
      presetSyncHandleObjectList(transactionId, payload, payloadLength);
      break;
    case PRESET_SYNC_MSG_READ_REQ:
      notePresetSyncTransferActivity(message);
      presetSyncHandleReadRequest(transactionId, payload, payloadLength);
      break;
    case PRESET_SYNC_MSG_WRITE_BEGIN:
      notePresetSyncTransferActivity(message);
      presetSyncHandleWriteBegin(transactionId, payload, payloadLength);
      break;
    case PRESET_SYNC_MSG_DATA_CHUNK:
      notePresetSyncTransferActivity(message);
      presetSyncHandleDataChunk(transactionId, payload, payloadLength);
      break;
    case PRESET_SYNC_MSG_TRANSFER_END:
      notePresetSyncTransferActivity(message);
      presetSyncHandleTransferEnd(transactionId, payload, payloadLength);
      break;
    case PRESET_SYNC_MSG_WRITE_COMMIT:
      notePresetSyncTransferActivity(message);
      presetSyncHandleWriteCommit(transactionId, payload, payloadLength);
      break;
    case PRESET_SYNC_MSG_TRANSFER_ABORT:
      notePresetSyncTransferActivity(message);
      presetSyncHandleTransferAbort(transactionId, payload, payloadLength);
      break;
    case PRESET_SYNC_MSG_DELETE_REQ:
      presetSyncHandleDelete(transactionId, payload, payloadLength);
      break;
    case PRESET_SYNC_MSG_SYNTH_PARAM_SET:
      presetSyncHandleSynthParamSet(transactionId, payload, payloadLength);
      break;
    case PRESET_SYNC_MSG_ACK:
      if (presetSyncReadTransfer.active || presetSyncWriteTransfer.active) {
        notePresetSyncTransferActivity(message);
      }
      presetSyncHandleAck(transactionId, payload, payloadLength);
      break;
    case PRESET_SYNC_MSG_NACK:
      if (presetSyncReadTransfer.active || presetSyncWriteTransfer.active) {
        notePresetSyncTransferActivity(message);
      }
      presetSyncHandleNack(transactionId, payload, payloadLength);
      break;
    default:
      presetSyncSendNack(transactionId, message, PRESET_SYNC_ERROR_UNKNOWN_MESSAGE);
      break;
  }
  return true;
}
