#include "../src/firmware/storage/SettingsMigration.h"
#include <array>
#include <cassert>

int main() {
  static_assert(persistedSettingsWidth(32) == 57);
  static_assert(persistedSettingsWidth(33) == 60);
  static_assert(persistedSettingsWidth(31) == 0);
  static_assert(persistedSettingsWidth(34) == 0);
  for (size_t sourceWidth : {size_t(57), size_t(60)}) {
    std::array<uint8_t, 9 * 60> source{};
    std::array<uint8_t, 9 * 60 + 2> destination{};
    destination.front() = 0xa5;
    destination.back() = 0x5a;
    for (size_t profile = 0; profile < 9; ++profile) {
      for (size_t key = 0; key < sourceWidth; ++key)
        source[profile * sourceWidth + key] = (profile * 31 + key) & 255;
      destination[1 + profile * 60 + 57] = 0; // dithering off
      destination[1 + profile * 60 + 58] = 232; // 4328us
      destination[1 + profile * 60 + 59] = 16;
    }
    expandPersistedSettings(destination.data() + 1, 60, source.data(), sourceWidth, 9);
    for (size_t profile = 0; profile < 9; ++profile) {
      for (size_t key = 0; key < sourceWidth; ++key)
        assert(destination[1 + profile * 60 + key] == source[profile * sourceWidth + key]);
      if (sourceWidth == 57) {
        assert(destination[1 + profile * 60 + 57] == 0);
        assert(destination[1 + profile * 60 + 58] == 232);
        assert(destination[1 + profile * 60 + 59] == 16);
      }
    }
    assert(destination.front() == 0xa5 && destination.back() == 0x5a);
  }
}
