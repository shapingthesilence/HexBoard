#include "../src/firmware/storage/PresetSyncPacking.h"
#include <cassert>
#include <limits>
#include <random>

int main() {
  std::mt19937 random(0x48425331);
  // Cover group boundaries, every byte value, and all parser-sized bodies.
  for (size_t length = 0; length <= 1024; ++length) {
    std::vector<uint8_t> input(length), packed, output;
    for (size_t i = 0; i < length; ++i) input[i] = (i + length) & 255;
    presetSyncPack8To7(input.data(), input.size(), packed);
    assert(packed.size() == length + (length + 6) / 7);
    assert(presetSyncUnpack8To7(packed.data(), packed.size(), length, output));
    assert(output == input);
    if (!packed.empty()) {
      assert(!presetSyncUnpack8To7(packed.data(), packed.size() - 1, length, output));
      packed.push_back(0);
      assert(!presetSyncUnpack8To7(packed.data(), packed.size(), length, output));
    }
  }
  // Invalid frames must not allocate, even with hostile declared lengths.
  for (size_t length : {size_t(16383), std::numeric_limits<size_t>::max()}) {
    std::vector<uint8_t> output;
    const uint8_t tiny[] = {0, 1};
    assert(!presetSyncUnpack8To7(tiny, sizeof(tiny), length, output));
    assert(output.capacity() == 0);
  }
  for (size_t trial = 0; trial < 100000; ++trial) {
    const size_t length = random() % 1025;
    std::vector<uint8_t> input(length), packed, output;
    for (auto& byte : input) byte = random() & 255;
    presetSyncPack8To7(input.data(), input.size(), packed);
    assert(presetSyncUnpack8To7(packed.data(), packed.size(), length, output));
    assert(input == output);
    if (!packed.empty()) {
      packed[random() % packed.size()] |= 0x80;
      std::vector<uint8_t> invalidOutput;
      assert(!presetSyncUnpack8To7(packed.data(), packed.size(), length, invalidOutput));
      assert(invalidOutput.capacity() == 0);
    }
  }
}
