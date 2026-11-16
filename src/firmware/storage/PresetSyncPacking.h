#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

void presetSyncPack8To7(const uint8_t* raw, size_t rawLength, std::vector<uint8_t>& packed);
// Reject malformed lengths and non-seven-bit data before allocating output.
bool presetSyncUnpack8To7(const uint8_t* packed, size_t packedLength, size_t rawLength,
                         std::vector<uint8_t>& raw);
