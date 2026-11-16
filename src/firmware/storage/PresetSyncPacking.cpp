#include "PresetSyncPacking.h"
#include <algorithm>

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

bool presetSyncUnpack8To7(const uint8_t* packed, size_t packedLength, size_t rawLength,
                         std::vector<uint8_t>& raw) {
  raw.clear();
  // Compare by subtraction so even an untrusted SIZE_MAX cannot overflow.
  const size_t prefixCount = rawLength / 7 + (rawLength % 7 != 0);
  if (rawLength > packedLength || packedLength - rawLength != prefixCount) {
    return false;
  }
  for (size_t i = 0; i < packedLength; ++i) {
    if (packed[i] > 0x7F) return false;
  }
  raw.resize(rawLength);
  size_t offset = 0;
  for (size_t output = 0; output < rawLength;) {
    const uint8_t prefix = packed[offset++];
    const size_t count = std::min<size_t>(7, rawLength - output);
    for (size_t i = 0; i < count; ++i) {
      raw[output++] = packed[offset++] | (((prefix >> i) & 1u) << 7);
    }
  }
  return true;
}
