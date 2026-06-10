#if HEXBOARD_FIRMWARE_UNITY

#include "../FirmwareModule.h"

constexpr uint8_t PRESET_SYNC_FAMILY = 0x10;
constexpr uint8_t PRESET_SYNC_MAJOR = 1;
constexpr uint8_t PRESET_SYNC_MINOR = 0;
constexpr uint16_t PRESET_SYNC_NEW_OBJECT_HANDLE = 0x3FFF;
constexpr uint16_t PRESET_SYNC_CURRENT_SYNTH_PRESET_HANDLE = PRESET_SYNC_NEW_OBJECT_HANDLE;
constexpr uint16_t PRESET_SYNC_RAW_CHUNK_SIZE = 64;
constexpr size_t PRESET_SYNC_MAX_SYNTH_PRESET_BYTES = 2048;
constexpr size_t PRESET_SYNC_MAX_SYNTH_WAVETABLE_BYTES = SYNTH_WAVETABLE_SAMPLE_BYTES + 256;
constexpr size_t PRESET_SYNC_MAX_RAW_OBJECT_BYTES = PRESET_SYNC_MAX_SYNTH_WAVETABLE_BYTES;

constexpr uint8_t PRESET_SYNC_MSG_HELLO_REQ = 0x01;
constexpr uint8_t PRESET_SYNC_MSG_HELLO_RESP = 0x02;
constexpr uint8_t PRESET_SYNC_MSG_ACK = 0x06;
constexpr uint8_t PRESET_SYNC_MSG_NACK = 0x07;
constexpr uint8_t PRESET_SYNC_MSG_OBJECT_LIST_REQ = 0x20;
constexpr uint8_t PRESET_SYNC_MSG_OBJECT_LIST_RESP = 0x21;
constexpr uint8_t PRESET_SYNC_MSG_READ_REQ = 0x22;
constexpr uint8_t PRESET_SYNC_MSG_READ_BEGIN = 0x23;
constexpr uint8_t PRESET_SYNC_MSG_WRITE_BEGIN = 0x24;
constexpr uint8_t PRESET_SYNC_MSG_DATA_CHUNK = 0x25;
constexpr uint8_t PRESET_SYNC_MSG_TRANSFER_END = 0x26;
constexpr uint8_t PRESET_SYNC_MSG_WRITE_COMMIT = 0x27;
constexpr uint8_t PRESET_SYNC_MSG_TRANSFER_ABORT = 0x28;
constexpr uint8_t PRESET_SYNC_MSG_DELETE_REQ = 0x29;

constexpr uint8_t PRESET_SYNC_OBJECT_TYPE_ALL = 0x00;
constexpr uint8_t PRESET_SYNC_OBJECT_TYPE_USER_TUNING = 0x03;
constexpr uint8_t PRESET_SYNC_OBJECT_TYPE_USER_LAYOUT = 0x04;
constexpr uint8_t PRESET_SYNC_OBJECT_TYPE_SCALE_COLOR_MAP = 0x05;
constexpr uint8_t PRESET_SYNC_OBJECT_TYPE_EXPLICIT_BUTTON_MAP = 0x06;
constexpr uint8_t PRESET_SYNC_OBJECT_TYPE_SYNTH_PRESET = 0x07;
constexpr uint8_t PRESET_SYNC_OBJECT_TYPE_USER_SCALE = 0x0A;
constexpr uint8_t PRESET_SYNC_OBJECT_TYPE_SYNTH_WAVETABLE = 0x0B;
constexpr uint8_t PRESET_SYNC_TLV_NAME = 0x01;
constexpr uint8_t PRESET_SYNC_TLV_OBJECT_ID = 0x02;
constexpr uint8_t PRESET_SYNC_TLV_SOURCE = 0x03;
constexpr uint8_t PRESET_SYNC_TLV_FOLDER_PATH = 0x06;
constexpr uint8_t PRESET_SYNC_TLV_SYNTH_SCHEMA_VERSION = 0x20;
constexpr uint8_t PRESET_SYNC_TLV_SYNTH_VALUES = 0x21;
constexpr uint8_t PRESET_SYNC_TLV_FAVORITE = 0x23;
constexpr uint8_t PRESET_SYNC_TLV_SYNTH_WAVETABLE_NAME = 0x26;
constexpr uint8_t PRESET_SYNC_TLV_SYNTH_WAVETABLE_FOLDER_PATH = 0x27;
constexpr uint8_t PRESET_SYNC_TLV_WAVETABLE_FRAME_COUNT = 0x30;
constexpr uint8_t PRESET_SYNC_TLV_WAVETABLE_SAMPLE_COUNT = 0x31;
constexpr uint8_t PRESET_SYNC_TLV_WAVETABLE_SAMPLES = 0x32;

constexpr uint8_t PRESET_SYNC_WRITE_APPLY_TO_RUNTIME = 0x01;
constexpr uint8_t PRESET_SYNC_WRITE_SAVE_TO_FLASH = 0x02;
constexpr uint8_t PRESET_SYNC_WRITE_DRY_RUN = 0x08;

constexpr uint32_t PRESET_SYNC_CAP_SYNTH_PRESET = 1u << 1;
constexpr uint32_t PRESET_SYNC_CAP_USER_TUNING = 1u << 2;
constexpr uint32_t PRESET_SYNC_CAP_USER_LAYOUT = 1u << 3;
constexpr uint32_t PRESET_SYNC_CAP_USER_SCALE = 1u << 4;
constexpr uint32_t PRESET_SYNC_CAP_SCALE_COLOR_MAP = 1u << 5;
constexpr uint32_t PRESET_SYNC_CAP_EXPLICIT_BUTTON_MAP = 1u << 6;
constexpr uint32_t PRESET_SYNC_CAP_DRY_RUN = 1u << 8;
constexpr uint32_t PRESET_SYNC_CAP_DELETE_USER_OBJECT = 1u << 9;
constexpr uint32_t PRESET_SYNC_CAP_SYNTH_WAVETABLE = 1u << 11;

constexpr uint8_t PRESET_SYNC_ERROR_UNSUPPORTED_PROTOCOL = 0x01;
constexpr uint8_t PRESET_SYNC_ERROR_UNKNOWN_MESSAGE = 0x02;
constexpr uint8_t PRESET_SYNC_ERROR_BAD_LENGTH = 0x03;
constexpr uint8_t PRESET_SYNC_ERROR_BAD_OBJECT_TYPE = 0x04;
constexpr uint8_t PRESET_SYNC_ERROR_BAD_CHECKSUM = 0x05;
constexpr uint8_t PRESET_SYNC_ERROR_BAD_CRC = 0x06;
constexpr uint8_t PRESET_SYNC_ERROR_UNEXPECTED_CHUNK = 0x07;
constexpr uint8_t PRESET_SYNC_ERROR_BUSY = 0x08;
constexpr uint8_t PRESET_SYNC_ERROR_STORAGE_FULL = 0x09;
constexpr uint8_t PRESET_SYNC_ERROR_OBJECT_MISSING = 0x0B;
constexpr uint8_t PRESET_SYNC_ERROR_SCHEMA_MISMATCH = 0x0C;
constexpr uint8_t PRESET_SYNC_ERROR_VALIDATION_FAILED = 0x0D;

struct PresetSyncWriteTransfer {
  bool active = false;
  bool ended = false;
  uint8_t objectType = 0;
  uint16_t handle = PRESET_SYNC_NEW_OBJECT_HANDLE;
  uint16_t transferId = 0;
  uint8_t schemaMajor = 0;
  uint8_t schemaMinor = 0;
  uint32_t rawByteLength = 0;
  uint32_t objectCrc32 = 0;
  uint16_t rawChunkSize = 0;
  uint8_t writeFlags = 0;
  uint32_t receivedBytes = 0;
  uint32_t expectedChunkIndex = 0;
  std::vector<uint8_t> rawData;
};

struct PresetSyncReadTransfer {
  bool active = false;
  bool endSent = false;
  uint8_t objectType = 0;
  uint16_t handle = PRESET_SYNC_NEW_OBJECT_HANDLE;
  uint16_t transactionId = 0;
  uint16_t transferId = 0;
  uint8_t schemaMajor = 0;
  uint8_t schemaMinor = 0;
  uint32_t objectCrc32 = 0;
  uint32_t sentBytes = 0;
  uint32_t nextChunkIndex = 0;
  std::vector<uint8_t> rawData;
};

PresetSyncWriteTransfer presetSyncWriteTransfer;
PresetSyncReadTransfer presetSyncReadTransfer;
uint16_t presetSyncNextTransferId = 1;

size_t boundedCStringLength(const char* text, size_t maxLength) {
  size_t length = 0;
  while (length < maxLength && text[length] != '\0') {
    ++length;
  }
  return length;
}

uint16_t presetSyncDecodeU14(const uint8_t* bytes) {
  return (static_cast<uint16_t>(bytes[0] & 0x7F) << 7) | (bytes[1] & 0x7F);
}

uint32_t presetSyncDecodeU21(const uint8_t* bytes) {
  return (static_cast<uint32_t>(bytes[0] & 0x7F) << 14)
         | (static_cast<uint32_t>(bytes[1] & 0x7F) << 7)
         | (bytes[2] & 0x7F);
}

uint32_t presetSyncDecodeU28(const uint8_t* bytes) {
  return (static_cast<uint32_t>(bytes[0] & 0x7F) << 21)
         | (static_cast<uint32_t>(bytes[1] & 0x7F) << 14)
         | (static_cast<uint32_t>(bytes[2] & 0x7F) << 7)
         | (bytes[3] & 0x7F);
}

uint32_t presetSyncDecodeU35ToU32(const uint8_t* bytes) {
  return ((static_cast<uint32_t>(bytes[0] & 0x0F) << 28)
          | (static_cast<uint32_t>(bytes[1] & 0x7F) << 21)
          | (static_cast<uint32_t>(bytes[2] & 0x7F) << 14)
          | (static_cast<uint32_t>(bytes[3] & 0x7F) << 7)
          | (bytes[4] & 0x7F));
}

void presetSyncAppendU14(std::vector<uint8_t>& output, uint16_t value) {
  output.push_back((value >> 7) & 0x7F);
  output.push_back(value & 0x7F);
}

void presetSyncAppendU21(std::vector<uint8_t>& output, uint32_t value) {
  output.push_back((value >> 14) & 0x7F);
  output.push_back((value >> 7) & 0x7F);
  output.push_back(value & 0x7F);
}

void presetSyncAppendU28(std::vector<uint8_t>& output, uint32_t value) {
  output.push_back((value >> 21) & 0x7F);
  output.push_back((value >> 14) & 0x7F);
  output.push_back((value >> 7) & 0x7F);
  output.push_back(value & 0x7F);
}

void presetSyncAppendU35FromU32(std::vector<uint8_t>& output, uint32_t value) {
  output.push_back((value >> 28) & 0x7F);
  output.push_back((value >> 21) & 0x7F);
  output.push_back((value >> 14) & 0x7F);
  output.push_back((value >> 7) & 0x7F);
  output.push_back(value & 0x7F);
}

bool presetSyncPayloadIsSevenBit(const uint8_t* payload, size_t length) {
  for (size_t i = 0; i < length; ++i) {
    if (payload[i] > 0x7F) {
      return false;
    }
  }
  return true;
}

void presetSyncSendFrame(uint8_t message, uint16_t transactionId, const std::vector<uint8_t>& payload) {
  std::vector<uint8_t> frame;
  frame.reserve(7 + payload.size());
  frame.push_back(0x7D);
  frame.push_back(PRESET_SYNC_FAMILY);
  frame.push_back(PRESET_SYNC_MAJOR);
  frame.push_back(PRESET_SYNC_MINOR);
  frame.push_back(message & 0x7F);
  presetSyncAppendU14(frame, transactionId);
  frame.insert(frame.end(), payload.begin(), payload.end());
  withMIDI([&](auto& M) { M.sendSysEx(frame.size(), frame.data()); });
}

void presetSyncSendAck(uint16_t transactionId, uint8_t ackedMessage, uint32_t nextChunkIndex = 0, uint8_t detail = 0) {
  std::vector<uint8_t> payload;
  payload.push_back(ackedMessage);
  payload.push_back(0);
  presetSyncAppendU21(payload, nextChunkIndex);
  payload.push_back(detail & 0x7F);
  presetSyncSendFrame(PRESET_SYNC_MSG_ACK, transactionId, payload);
}

void presetSyncSendNack(uint16_t transactionId, uint8_t failedMessage, uint8_t errorCode, uint32_t expectedChunkIndex = 0, uint8_t detail = 0) {
  std::vector<uint8_t> payload;
  payload.push_back(failedMessage);
  payload.push_back(errorCode);
  presetSyncAppendU21(payload, expectedChunkIndex);
  payload.push_back(detail & 0x7F);
  presetSyncSendFrame(PRESET_SYNC_MSG_NACK, transactionId, payload);
}

void presetSyncCancelReadTransfer() {
  presetSyncReadTransfer = PresetSyncReadTransfer{};
}

void presetSyncCancelWriteTransfer() {
  presetSyncWriteTransfer = PresetSyncWriteTransfer{};
}

uint8_t presetSyncChunkChecksum(const uint8_t* data, size_t length) {
  uint8_t sum = 0;
  for (size_t i = 0; i < length; ++i) {
    sum = (sum + data[i]) & 0x7F;
  }
  return sum;
}

void presetSyncPack8To7(const uint8_t* raw, size_t rawLength, std::vector<uint8_t>& packed) {
  for (size_t offset = 0; offset < rawLength; offset += 7) {
    size_t count = std::min<size_t>(7, rawLength - offset);
    uint8_t prefix = 0;
    size_t prefixIndex = packed.size();
    packed.push_back(0);
    for (size_t i = 0; i < count; ++i) {
      uint8_t value = raw[offset + i];
      if (value & 0x80) {
        prefix |= (1u << i);
      }
      packed.push_back(value & 0x7F);
    }
    packed[prefixIndex] = prefix;
  }
}

bool presetSyncUnpack8To7(const uint8_t* packed, size_t packedLength, size_t rawLength, std::vector<uint8_t>& raw) {
  raw.clear();
  raw.reserve(rawLength);
  size_t offset = 0;
  while (offset < packedLength && raw.size() < rawLength) {
    uint8_t prefix = packed[offset++];
    if (prefix > 0x7F) {
      return false;
    }
    size_t remainingRaw = rawLength - raw.size();
    size_t count = std::min<size_t>(7, remainingRaw);
    if (offset + count > packedLength) {
      return false;
    }
    for (size_t i = 0; i < count; ++i) {
      uint8_t low = packed[offset++];
      if (low > 0x7F) {
        return false;
      }
      raw.push_back(low | (((prefix >> i) & 0x01) << 7));
    }
  }
  return raw.size() == rawLength;
}

void presetSyncAppendTlv(std::vector<uint8_t>& body, uint8_t tag, const uint8_t* value, uint16_t length) {
  body.push_back(tag);
  body.push_back(length & 0xFF);
  body.push_back((length >> 8) & 0xFF);
  body.insert(body.end(), value, value + length);
}

void presetSyncAppendTextTlv(std::vector<uint8_t>& body, uint8_t tag, const char* text, size_t maxLength) {
  size_t length = boundedCStringLength(text, maxLength);
  presetSyncAppendTlv(body, tag, reinterpret_cast<const uint8_t*>(text), static_cast<uint16_t>(length));
}

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

void copyPresetSyncText(char* destination, size_t destinationLength, const uint8_t* source, size_t sourceLength) {
  if (destinationLength == 0) {
    return;
  }
  size_t copyLength = std::min(destinationLength - 1, sourceLength);
  memcpy(destination, source, copyLength);
  destination[copyLength] = '\0';
}

bool isPresetSyncGeometryObjectType(uint8_t objectType) {
  switch (objectType) {
    case PRESET_SYNC_OBJECT_TYPE_USER_TUNING:
    case PRESET_SYNC_OBJECT_TYPE_USER_LAYOUT:
    case PRESET_SYNC_OBJECT_TYPE_SCALE_COLOR_MAP:
    case PRESET_SYNC_OBJECT_TYPE_EXPLICIT_BUTTON_MAP:
    case PRESET_SYNC_OBJECT_TYPE_USER_SCALE:
      return true;
    default:
      return false;
  }
}

bool isPresetSyncSupportedObjectType(uint8_t objectType) {
  return objectType == PRESET_SYNC_OBJECT_TYPE_SYNTH_PRESET
         || objectType == PRESET_SYNC_OBJECT_TYPE_SYNTH_WAVETABLE
         || isPresetSyncGeometryObjectType(objectType);
}

void geometryCatalogAppendU32(std::vector<uint8_t>& output, uint32_t value) {
  output.push_back(value & 0xFF);
  output.push_back((value >> 8) & 0xFF);
  output.push_back((value >> 16) & 0xFF);
  output.push_back((value >> 24) & 0xFF);
}

bool geometryCatalogReadU32(const std::vector<uint8_t>& input, size_t& cursor, uint32_t& value) {
  if (cursor + 4 > input.size()) {
    return false;
  }
  value = static_cast<uint32_t>(input[cursor])
          | (static_cast<uint32_t>(input[cursor + 1]) << 8)
          | (static_cast<uint32_t>(input[cursor + 2]) << 16)
          | (static_cast<uint32_t>(input[cursor + 3]) << 24);
  cursor += 4;
  return true;
}

std::vector<uint8_t> serializeGeometryObjectsForStorage() {
  std::vector<uint8_t> data;
  for (const GeometryObjectSlot& object : geometryObjects) {
    if (!object.valid || !isPresetSyncGeometryObjectType(object.objectType) || object.body.empty()) {
      continue;
    }
    data.push_back(object.objectType);
    data.push_back(object.schemaMajor);
    data.push_back(object.schemaMinor);
    data.push_back(0);
    data.insert(data.end(), object.objectId, object.objectId + sizeof(object.objectId));
    size_t nameLength = std::min<size_t>(boundedCStringLength(object.name, sizeof(object.name)), 255);
    size_t folderLength = std::min<size_t>(boundedCStringLength(object.folderPath, sizeof(object.folderPath)), 255);
    data.push_back(nameLength);
    data.insert(data.end(), object.name, object.name + nameLength);
    data.push_back(folderLength);
    data.insert(data.end(), object.folderPath, object.folderPath + folderLength);
    geometryCatalogAppendU32(data, static_cast<uint32_t>(object.body.size()));
    data.insert(data.end(), object.body.begin(), object.body.end());
  }
  return data;
}

void save_geometry_objects() {
  if (!fileSystemExists) {
    sendToLog("File system not available.");
    return;
  }
  if (geometryObjects.size() > GEOMETRY_OBJECT_MAX_COUNT) {
    geometryObjects.resize(GEOMETRY_OBJECT_MAX_COUNT);
  }

  std::vector<uint8_t> data = serializeGeometryObjectsForStorage();
  GeometryObjectFileHeader header = {};
  header.magic[0] = 'L'; header.magic[1] = 'Y'; header.magic[2] = 'T';
  header.version = GEOMETRY_OBJECT_FILE_VERSION;
  header.count = static_cast<uint16_t>(geometryObjects.size());
  header.crc32 = data.empty() ? 0 : crc32(data.data(), data.size());

  File f = LittleFS.open("/layouts.dat", "w");
  if (!f) {
    sendToLog("Error: Unable to open /layouts.dat for writing.");
    return;
  }
  f.write(reinterpret_cast<uint8_t*>(&header), sizeof(header));
  if (!data.empty()) {
    f.write(data.data(), data.size());
  }
  f.close();
  sendToLog("Geometry objects saved (" + std::to_string(geometryObjects.size()) + ").");
}

void flashSafeSaveGeometryObjects() {
  flashSafeWrite(save_geometry_objects);
}

bool parseGeometryObjectBody(const std::vector<uint8_t>& body, GeometryObjectSlot& object, std::string& error) {
  if (body.size() < 8 || body[0] != 'H' || body[1] != 'B' || body[2] != 'S' || body[3] != '1') {
    error = "bad object magic";
    return false;
  }
  if (!isPresetSyncGeometryObjectType(body[4])) {
    error = "not geometry object";
    return false;
  }
  if (body[5] != 1) {
    error = "unsupported geometry object schema";
    return false;
  }

  GeometryObjectSlot parsed = {};
  parsed.valid = 1;
  parsed.objectType = body[4];
  parsed.schemaMajor = body[5];
  parsed.schemaMinor = body[6];
  parsed.body = body;

  bool sawName = false;
  bool sawObjectId = false;
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
        copyPresetSyncText(parsed.name, sizeof(parsed.name), value, length);
        sawName = parsed.name[0] != '\0';
        break;
      case PRESET_SYNC_TLV_OBJECT_ID:
        if (length != sizeof(parsed.objectId)) {
          error = "bad object id length";
          return false;
        }
        memcpy(parsed.objectId, value, sizeof(parsed.objectId));
        sawObjectId = true;
        break;
      case PRESET_SYNC_TLV_FOLDER_PATH:
        copyPresetSyncText(parsed.folderPath, sizeof(parsed.folderPath), value, length);
        break;
      default:
        break;
    }
    cursor += length;
  }

  if (!sawName || !sawObjectId) {
    error = "missing required geometry TLV";
    return false;
  }
  object = parsed;
  return true;
}

void load_geometry_objects() {
  geometryObjects.clear();
  if (!fileSystemExists) {
    sendToLog("File system not available. Using empty geometry catalog.");
    return;
  }
  File f = LittleFS.open("/layouts.dat", "r");
  if (!f) {
    sendToLog("Geometry catalog file not found. Starting with empty layout objects.");
    return;
  }
  GeometryObjectFileHeader header = {};
  if (f.readBytes(reinterpret_cast<char*>(&header), sizeof(header)) != sizeof(header)) {
    sendToLog("Error: Failed to read geometry catalog header.");
    f.close();
    return;
  }
  if (strncmp(header.magic, "LYT", 3) != 0 || header.version != GEOMETRY_OBJECT_FILE_VERSION
      || header.count > GEOMETRY_OBJECT_MAX_COUNT) {
    sendToLog("Invalid geometry catalog file. Starting with empty layout objects.");
    f.close();
    return;
  }

  size_t dataSize = f.size() > sizeof(header) ? f.size() - sizeof(header) : 0;
  std::vector<uint8_t> data(dataSize);
  size_t bytesRead = dataSize == 0 ? 0 : f.read(data.data(), data.size());
  f.close();
  if (bytesRead != dataSize) {
    sendToLog("Warning: Geometry catalog data incomplete. Starting with empty layout objects.");
    geometryObjects.clear();
    return;
  }
  uint32_t computed = data.empty() ? 0 : crc32(data.data(), data.size());
  if (computed != header.crc32) {
    sendToLog("Geometry catalog CRC32 mismatch. Starting with empty layout objects.");
    geometryObjects.clear();
    return;
  }

  size_t cursor = 0;
  while (cursor < data.size() && geometryObjects.size() < GEOMETRY_OBJECT_MAX_COUNT) {
    if (cursor + 20 > data.size()) {
      sendToLog("Warning: Geometry catalog record truncated.");
      geometryObjects.clear();
      return;
    }
    GeometryObjectSlot object = {};
    object.valid = 1;
    object.objectType = data[cursor++];
    object.schemaMajor = data[cursor++];
    object.schemaMinor = data[cursor++];
    ++cursor;
    memcpy(object.objectId, data.data() + cursor, sizeof(object.objectId));
    cursor += sizeof(object.objectId);

    uint8_t nameLength = data[cursor++];
    if (cursor + nameLength > data.size()) {
      sendToLog("Warning: Geometry catalog name truncated.");
      geometryObjects.clear();
      return;
    }
    copyPresetSyncText(object.name, sizeof(object.name), data.data() + cursor, nameLength);
    cursor += nameLength;

    uint8_t folderLength = data[cursor++];
    if (cursor + folderLength > data.size()) {
      sendToLog("Warning: Geometry catalog folder truncated.");
      geometryObjects.clear();
      return;
    }
    copyPresetSyncText(object.folderPath, sizeof(object.folderPath), data.data() + cursor, folderLength);
    cursor += folderLength;

    uint32_t bodyLength = 0;
    if (!geometryCatalogReadU32(data, cursor, bodyLength)
        || bodyLength == 0
        || bodyLength > GEOMETRY_OBJECT_MAX_RAW_BYTES
        || cursor + bodyLength > data.size()) {
      sendToLog("Warning: Geometry catalog body truncated.");
      geometryObjects.clear();
      return;
    }
    object.body.assign(data.begin() + cursor, data.begin() + cursor + bodyLength);
    cursor += bodyLength;

    GeometryObjectSlot validated;
    std::string parseError;
    if (parseGeometryObjectBody(object.body, validated, parseError)
        && validated.objectType == object.objectType
        && validated.schemaMajor == object.schemaMajor
        && validated.schemaMinor == object.schemaMinor
        && memcmp(validated.objectId, object.objectId, sizeof(object.objectId)) == 0) {
      geometryObjects.push_back(validated);
    }
  }
  sendToLog("Geometry objects loaded successfully (" + std::to_string(geometryObjects.size()) + ").");
}

int findGeometryObjectByTypeAndObjectId(uint8_t objectType, const uint8_t* objectId) {
  for (size_t i = 0; i < geometryObjects.size(); ++i) {
    if (geometryObjects[i].valid
        && geometryObjects[i].objectType == objectType
        && memcmp(geometryObjects[i].objectId, objectId, GEOMETRY_OBJECT_ID_LENGTH) == 0) {
      return static_cast<int>(i);
    }
  }
  return -1;
}

int chooseGeometryObjectWriteSlot(uint16_t handle, const GeometryObjectSlot& object) {
  if (handle != PRESET_SYNC_NEW_OBJECT_HANDLE
      && handle < geometryObjects.size()
      && geometryObjects[handle].objectType == object.objectType) {
    return handle;
  }
  int existing = findGeometryObjectByTypeAndObjectId(object.objectType, object.objectId);
  if (existing >= 0) {
    return existing;
  }
  if (geometryObjects.size() < GEOMETRY_OBJECT_MAX_COUNT) {
    return static_cast<int>(geometryObjects.size());
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

struct ParsedSynthWavetableObject {
  uint8_t objectId[SYNTH_WAVETABLE_OBJECT_ID_LENGTH] = {};
  char name[SYNTH_WAVETABLE_NAME_LENGTH] = {};
  char folderPath[SYNTH_WAVETABLE_FOLDER_LENGTH] = {};
  const uint8_t* samples = nullptr;
  uint16_t sampleLength = 0;
  bool sawObjectId = false;
  bool sawSamples = false;
};

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
      case PRESET_SYNC_TLV_WAVETABLE_SAMPLES:
        if (length != SYNTH_WAVETABLE_SAMPLE_BYTES) {
          error = "bad wavetable sample data length";
          return false;
        }
        wavetable.samples = value;
        wavetable.sampleLength = length;
        wavetable.sawSamples = true;
        sawSamples = true;
        break;
      default:
        break;
    }

    cursor += length;
  }

  if (sawSamples && (!sawFrameCount || !sawSampleCount || wavetable.samples == nullptr)) {
    error = "missing required wavetable sample metadata";
    return false;
  }
  if (!wavetable.name[0]) {
    error = "missing wavetable name";
    return false;
  }
  return true;
}

bool readSynthWavetableSampleFile(const SynthWavetableSlot& wavetable, std::vector<uint8_t>& samples) {
  samples.assign(SYNTH_WAVETABLE_SAMPLE_BYTES, 0);
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
    sendToLog("Read legacy wavetable sample path for " + std::string(wavetable.name));
  }
  size_t bytesRead = f.read(samples.data(), samples.size());
  f.close();
  if (bytesRead != samples.size()) {
    sendToLog("Incomplete wavetable sample file for " + std::string(wavetable.name));
    return false;
  }
  return true;
}

std::vector<uint8_t> buildSynthWavetableObjectBody(const SynthWavetableSlot& wavetable, const uint8_t* samples) {
  std::vector<uint8_t> body;
  body.reserve(PRESET_SYNC_MAX_SYNTH_WAVETABLE_BYTES);
  body.push_back('H');
  body.push_back('B');
  body.push_back('S');
  body.push_back('1');
  body.push_back(PRESET_SYNC_OBJECT_TYPE_SYNTH_WAVETABLE);
  body.push_back(1);
  body.push_back(0);
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
  presetSyncAppendTlv(body, PRESET_SYNC_TLV_WAVETABLE_SAMPLES, samples, SYNTH_WAVETABLE_SAMPLE_BYTES);
  return body;
}

void applyParsedSynthWavetableToRuntime(const SynthWavetableSlot& wavetable, const uint8_t* samples) {
  synthWaveTableLoadInProgress = true;
  memcpy(&activeSynthWaveTable[0][0], samples, SYNTH_WAVETABLE_SAMPLE_BYTES);
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
  normalizeSynthWavetableMetadata(wavetable, parsed.samples);
  pruneMissingSynthWavetables();

  int slotIndex = chooseSynthWavetableWriteSlot(wavetable);
  if (slotIndex < 0) {
    sendToLog("Synth wavetable library is full.");
    return false;
  }

  if (static_cast<size_t>(slotIndex) < synthWavetables.size()) {
    removeSynthWavetableSampleFiles(synthWavetables[slotIndex]);
  }
  if (!writeSynthWavetableSampleFile(wavetable, parsed.samples)) {
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
}

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
                      | PRESET_SYNC_CAP_SYNTH_WAVETABLE);
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

void presetSyncSendReadBegin() {
  std::vector<uint8_t> begin;
  begin.push_back(presetSyncReadTransfer.objectType);
  presetSyncAppendU14(begin, presetSyncReadTransfer.handle);
  presetSyncAppendU14(begin, presetSyncReadTransfer.transferId);
  begin.push_back(presetSyncReadTransfer.schemaMajor);
  begin.push_back(presetSyncReadTransfer.schemaMinor);
  presetSyncAppendU28(begin, presetSyncReadTransfer.rawData.size());
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
  if (presetSyncReadTransfer.sentBytes >= presetSyncReadTransfer.rawData.size()) {
    presetSyncSendReadEnd();
    return;
  }

  size_t offset = presetSyncReadTransfer.sentBytes;
  size_t chunkLength = std::min<size_t>(PRESET_SYNC_RAW_CHUNK_SIZE, presetSyncReadTransfer.rawData.size() - offset);
  std::vector<uint8_t> chunk;
  presetSyncAppendU14(chunk, presetSyncReadTransfer.transferId);
  presetSyncAppendU21(chunk, presetSyncReadTransfer.nextChunkIndex);
  presetSyncAppendU28(chunk, offset);
  presetSyncAppendU14(chunk, chunkLength);
  chunk.push_back(presetSyncChunkChecksum(presetSyncReadTransfer.rawData.data() + offset, chunkLength));
  presetSyncPack8To7(presetSyncReadTransfer.rawData.data() + offset, chunkLength, chunk);
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
  presetSyncReadTransfer.objectCrc32 = crc32(raw.data(), raw.size());
  presetSyncReadTransfer.rawData = raw;
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
    std::vector<uint8_t> samples;
    if (!readSynthWavetableSampleFile(synthWavetables[handle], samples)) {
      presetSyncSendNack(transactionId, PRESET_SYNC_MSG_READ_REQ, PRESET_SYNC_ERROR_OBJECT_MISSING);
      return;
    }
    presetSyncSendRawObject(transactionId,
                            PRESET_SYNC_OBJECT_TYPE_SYNTH_WAVETABLE,
                            handle,
                            1,
                            0,
                            buildSynthWavetableObjectBody(synthWavetables[handle], samples.data()));
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
  presetSyncWriteTransfer.rawData.assign(rawByteLength, 0);
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

  memcpy(presetSyncWriteTransfer.rawData.data() + rawOffset, raw.data(), raw.size());
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
  if (crc32(presetSyncWriteTransfer.rawData.data(), presetSyncWriteTransfer.rawData.size()) != objectCrc32) {
    presetSyncWriteTransfer = PresetSyncWriteTransfer{};
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_WRITE_COMMIT, PRESET_SYNC_ERROR_BAD_CRC);
    return;
  }

  std::string parseError;
  if (presetSyncWriteTransfer.objectType == PRESET_SYNC_OBJECT_TYPE_SYNTH_PRESET) {
    SynthPresetSlot parsedPreset;
    if (!parseSynthPresetObjectBody(presetSyncWriteTransfer.rawData, parsedPreset, parseError)) {
      sendToLog("Preset sync rejected synth preset: " + parseError);
      presetSyncWriteTransfer = PresetSyncWriteTransfer{};
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
          presetSyncWriteTransfer = PresetSyncWriteTransfer{};
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
    if (!parseSynthWavetableObjectBody(presetSyncWriteTransfer.rawData, parsedWavetable, parseError)) {
      sendToLog("Preset sync rejected synth wavetable: " + parseError);
      presetSyncWriteTransfer = PresetSyncWriteTransfer{};
      presetSyncSendNack(transactionId, PRESET_SYNC_MSG_WRITE_COMMIT, PRESET_SYNC_ERROR_VALIDATION_FAILED);
      return;
    }

    if (!(commitFlags & PRESET_SYNC_WRITE_DRY_RUN)) {
      if (commitFlags & PRESET_SYNC_WRITE_SAVE_TO_FLASH) {
        flashWriteInProgress.store(true, std::memory_order_release);
        delayMicroseconds(AUDIO_DMA_BUFFER_MICROS * 2);
        bool saved = parsedWavetable.sawSamples
          ? saveParsedSynthWavetable(parsedWavetable)
          : updateSynthWavetableMetadata(presetSyncWriteTransfer.handle, parsedWavetable);
        flashWriteInProgress.store(false, std::memory_order_release);
        if (!saved) {
          presetSyncWriteTransfer = PresetSyncWriteTransfer{};
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
        normalizeSynthWavetableMetadata(runtimeWavetable, parsedWavetable.samples);
        applyParsedSynthWavetableToRuntime(runtimeWavetable, parsedWavetable.samples);
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
      presetSyncWriteTransfer = PresetSyncWriteTransfer{};
      presetSyncSendNack(transactionId, PRESET_SYNC_MSG_WRITE_COMMIT, PRESET_SYNC_ERROR_VALIDATION_FAILED);
      return;
    }

    if ((commitFlags & PRESET_SYNC_WRITE_APPLY_TO_RUNTIME)
        && !(commitFlags & PRESET_SYNC_WRITE_DRY_RUN)) {
      sendToLog("Preset sync geometry runtime apply is not implemented yet.");
      presetSyncWriteTransfer = PresetSyncWriteTransfer{};
      presetSyncSendNack(transactionId, PRESET_SYNC_MSG_WRITE_COMMIT, PRESET_SYNC_ERROR_VALIDATION_FAILED);
      return;
    }

    if (!(commitFlags & PRESET_SYNC_WRITE_DRY_RUN)
        && (commitFlags & PRESET_SYNC_WRITE_SAVE_TO_FLASH)) {
      int slotIndex = chooseGeometryObjectWriteSlot(presetSyncWriteTransfer.handle, parsedObject);
      if (slotIndex < 0) {
        presetSyncWriteTransfer = PresetSyncWriteTransfer{};
        presetSyncSendNack(transactionId, PRESET_SYNC_MSG_WRITE_COMMIT, PRESET_SYNC_ERROR_STORAGE_FULL);
        return;
      }
      if (static_cast<size_t>(slotIndex) == geometryObjects.size()) {
        geometryObjects.push_back(parsedObject);
      } else {
        geometryObjects[slotIndex] = parsedObject;
      }
      flashSafeSaveGeometryObjects();
    }
  } else {
    presetSyncWriteTransfer = PresetSyncWriteTransfer{};
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_WRITE_COMMIT, PRESET_SYNC_ERROR_BAD_OBJECT_TYPE);
    return;
  }

  presetSyncWriteTransfer = PresetSyncWriteTransfer{};
  presetSyncSendAck(transactionId, PRESET_SYNC_MSG_WRITE_COMMIT);
}

void presetSyncHandleTransferAbort(uint16_t transactionId, const uint8_t* payload, size_t payloadLength) {
  (void)payload;
  if (payloadLength < 2) {
    presetSyncSendNack(transactionId, PRESET_SYNC_MSG_TRANSFER_ABORT, PRESET_SYNC_ERROR_BAD_LENGTH);
    return;
  }
  presetSyncWriteTransfer = PresetSyncWriteTransfer{};
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
  notePresetSyncTransferActivity(message);

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
      presetSyncHandleReadRequest(transactionId, payload, payloadLength);
      break;
    case PRESET_SYNC_MSG_WRITE_BEGIN:
      presetSyncHandleWriteBegin(transactionId, payload, payloadLength);
      break;
    case PRESET_SYNC_MSG_DATA_CHUNK:
      presetSyncHandleDataChunk(transactionId, payload, payloadLength);
      break;
    case PRESET_SYNC_MSG_TRANSFER_END:
      presetSyncHandleTransferEnd(transactionId, payload, payloadLength);
      break;
    case PRESET_SYNC_MSG_WRITE_COMMIT:
      presetSyncHandleWriteCommit(transactionId, payload, payloadLength);
      break;
    case PRESET_SYNC_MSG_TRANSFER_ABORT:
      presetSyncHandleTransferAbort(transactionId, payload, payloadLength);
      break;
    case PRESET_SYNC_MSG_DELETE_REQ:
      presetSyncHandleDelete(transactionId, payload, payloadLength);
      break;
    case PRESET_SYNC_MSG_ACK:
      presetSyncHandleAck(transactionId, payload, payloadLength);
      break;
    case PRESET_SYNC_MSG_NACK:
      presetSyncHandleNack(transactionId, payload, payloadLength);
      break;
    default:
      presetSyncSendNack(transactionId, message, PRESET_SYNC_ERROR_UNKNOWN_MESSAGE);
      break;
  }
  return true;
}
#endif  // HEXBOARD_FIRMWARE_UNITY
