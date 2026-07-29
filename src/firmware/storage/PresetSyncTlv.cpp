#include "PresetSync.h"

bool presetSyncFindTlv(const std::vector<uint8_t>& body,
                       uint8_t wantedTag,
                       const uint8_t*& value,
                       uint16_t& length) {
  if (body.size() < 8) {
    return false;
  }
  size_t cursor = 8;
  while (cursor < body.size()) {
    if (cursor + 3 > body.size()) {
      return false;
    }
    uint8_t tag = body[cursor++];
    uint16_t tlvLength = presetSyncReadU16LE(body.data() + cursor);
    cursor += 2;
    if (cursor + tlvLength > body.size()) {
      return false;
    }
    if (tag == wantedTag) {
      value = body.data() + cursor;
      length = tlvLength;
      return true;
    }
    cursor += tlvLength;
  }
  return false;
}

bool presetSyncFindTlvU8(const std::vector<uint8_t>& body,
                         uint8_t tag,
                         uint8_t& result) {
  const uint8_t* value = nullptr;
  uint16_t length = 0;
  if (!presetSyncFindTlv(body, tag, value, length) || length != 1) {
    return false;
  }
  result = value[0];
  return true;
}

bool presetSyncFindTlvU16LE(const std::vector<uint8_t>& body,
                            uint8_t tag,
                            uint16_t& result) {
  const uint8_t* value = nullptr;
  uint16_t length = 0;
  if (!presetSyncFindTlv(body, tag, value, length) || length != 2) {
    return false;
  }
  result = presetSyncReadU16LE(value);
  return true;
}

bool presetSyncFindTlvI16LE(const std::vector<uint8_t>& body,
                            uint8_t tag,
                            int16_t& result) {
  const uint8_t* value = nullptr;
  uint16_t length = 0;
  if (!presetSyncFindTlv(body, tag, value, length) || length != 2) {
    return false;
  }
  result = presetSyncReadI16LE(value);
  return true;
}

bool presetSyncFindTlvI32LE(const std::vector<uint8_t>& body,
                            uint8_t tag,
                            int32_t& result) {
  const uint8_t* value = nullptr;
  uint16_t length = 0;
  if (!presetSyncFindTlv(body, tag, value, length) || length != 4) {
    return false;
  }
  result = presetSyncReadI32LE(value);
  return true;
}

bool presetSyncFindTlvFloat32LE(const std::vector<uint8_t>& body,
                                uint8_t tag,
                                float& result) {
  const uint8_t* value = nullptr;
  uint16_t length = 0;
  if (!presetSyncFindTlv(body, tag, value, length)
      || length != sizeof(float)) {
    return false;
  }
  result = presetSyncReadFloat32LE(value);
  return std::isfinite(result);
}
