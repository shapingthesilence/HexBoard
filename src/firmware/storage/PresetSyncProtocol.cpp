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
constexpr uint8_t PRESET_SYNC_MSG_SYNTH_PARAM_SET = 0x2A;

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
constexpr uint8_t PRESET_SYNC_TLV_TUNING_KIND = 0x20;
constexpr uint8_t PRESET_SYNC_TLV_TUNING_EDO_DIVISIONS = 0x21;
constexpr uint8_t PRESET_SYNC_TLV_TUNING_PERIOD_MILLI_CENTS = 0x22;
constexpr uint8_t PRESET_SYNC_TLV_TUNING_STEP_MILLI_CENTS = 0x23;
constexpr uint8_t PRESET_SYNC_TLV_TUNING_REFERENCE_MIDI_NOTE = 0x24;
constexpr uint8_t PRESET_SYNC_TLV_TUNING_REFERENCE_MILLI_HZ = 0x25;
constexpr uint8_t PRESET_SYNC_TLV_TUNING_KEY_LABELS = 0x28;
constexpr uint8_t PRESET_SYNC_TLV_LAYOUT_KIND = 0x20;
constexpr uint8_t PRESET_SYNC_TLV_LAYOUT_CENTER_BUTTON = 0x22;
constexpr uint8_t PRESET_SYNC_TLV_LAYOUT_ACROSS_STEPS = 0x23;
constexpr uint8_t PRESET_SYNC_TLV_LAYOUT_DOWN_LEFT_STEPS = 0x24;
constexpr uint8_t PRESET_SYNC_TLV_LAYOUT_PORTRAIT = 0x25;
constexpr uint8_t PRESET_SYNC_TLV_SCALE_COLOR_CYCLE_LENGTH = 0x21;
constexpr uint8_t PRESET_SYNC_TLV_SCALE_COLOR_DEGREE_COLORS = 0x23;
constexpr uint8_t PRESET_SYNC_TLV_USER_SCALE_CYCLE_LENGTH = 0x21;
constexpr uint8_t PRESET_SYNC_TLV_USER_SCALE_INCLUDED_DEGREES = 0x24;
constexpr uint8_t PRESET_SYNC_TLV_BUTTON_MAP_RECORD_FORMAT = 0x22;
constexpr uint8_t PRESET_SYNC_TLV_BUTTON_MAP_RECORDS = 0x23;

constexpr uint8_t PRESET_SYNC_USER_TUNING_KIND_EDO = 1;
constexpr uint8_t PRESET_SYNC_USER_TUNING_KIND_EQUAL_STEP = 4;
constexpr uint8_t PRESET_SYNC_BUTTON_MAP_ROLE_UNUSED = 0;
constexpr uint8_t PRESET_SYNC_BUTTON_MAP_ROLE_NOTE = 1;
constexpr uint8_t PRESET_SYNC_BUTTON_MAP_ROLE_COMMAND = 2;
constexpr uint8_t PRESET_SYNC_BUTTON_MAP_COLOR_NONE = 0;
constexpr uint8_t PRESET_SYNC_BUTTON_MAP_RECORD_SIZE = 13;

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
constexpr uint32_t PRESET_SYNC_CAP_LIVE_SYNTH_PARAM = 1u << 12;

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

uint16_t presetSyncReadU16LE(const uint8_t* bytes) {
  return static_cast<uint16_t>(bytes[0])
         | (static_cast<uint16_t>(bytes[1]) << 8);
}

int16_t presetSyncReadI16LE(const uint8_t* bytes) {
  return static_cast<int16_t>(presetSyncReadU16LE(bytes));
}

uint32_t presetSyncReadU32LE(const uint8_t* bytes) {
  return static_cast<uint32_t>(bytes[0])
         | (static_cast<uint32_t>(bytes[1]) << 8)
         | (static_cast<uint32_t>(bytes[2]) << 16)
         | (static_cast<uint32_t>(bytes[3]) << 24);
}

int32_t presetSyncReadI32LE(const uint8_t* bytes) {
  return static_cast<int32_t>(presetSyncReadU32LE(bytes));
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

void copyPresetSyncText(char* destination, size_t destinationLength, const uint8_t* source, size_t sourceLength) {
  if (destinationLength == 0) {
    return;
  }
  size_t copyLength = std::min(destinationLength - 1, sourceLength);
  memcpy(destination, source, copyLength);
  destination[copyLength] = '\0';
}


#endif  // HEXBOARD_FIRMWARE_UNITY
