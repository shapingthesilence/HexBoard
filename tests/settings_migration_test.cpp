#include "../src/firmware/storage/SettingsMigration.h"
#include <array>
#include <cassert>

int main() {
  static_assert(persistedSettingsWidth(32) == 57);
  static_assert(persistedSettingsWidth(33) == 60);
  static_assert(persistedSettingsWidth(31) == 0);
  static_assert(persistedSettingsWidth(34) == 60);
  static_assert(persistedSettingsWidth(35) == 60);
  static_assert(persistedSettingsWidth(36) == 61);
  static_assert(persistedSettingsWidth(37) == 0);
  for (uint8_t version : {32,33,34,35,36}) {
    const size_t width = persistedSettingsWidth(version);
    std::array<uint8_t, 9 * 61> source{};
    std::array<uint8_t, 9 * 61 + 2> destination{};
    destination.front()=0xa5; destination.back()=0x5a;
    for(size_t profile=0;profile<9;++profile) {
      for(size_t key=0;key<width;++key) source[profile*width+key]=(profile*31+key)&255;
      destination[1+profile*61+57]=0; destination[1+profile*61+58]=232;
      destination[1+profile*61+59]=16; destination[1+profile*61+60]=255;
    }
    expandPersistedSettings(destination.data()+1,61,source.data(),width,9);
    for(size_t profile=0;profile<9;++profile) {
      for(size_t key=0;key<width;++key) assert(destination[1+profile*61+key]==source[profile*width+key]);
      if(width<61) assert(destination[1+profile*61+60]==255);
      if(width==57) {assert(destination[1+profile*61+57]==0);assert(destination[1+profile*61+58]==232);assert(destination[1+profile*61+59]==16);}
    }
    assert(destination.front()==0xa5 && destination.back()==0x5a);
  }
  static_assert(persistedSynthPresetWidth(11) == 212);
  static_assert(persistedSynthPresetWidth(12) == 213);
  static_assert(persistedSynthPresetWidth(10) == 0);
  static_assert(persistedSynthPresetWidth(13) == 0);
  for (size_t width : {size_t(212), size_t(213)}) {
    std::array<uint8_t, 213> source{};
    std::array<uint8_t, 215> destination{};
    for (size_t i = 0; i < source.size(); ++i) source[i] = (i * 7) & 255;
    destination.front() = 0xa5; destination.back() = 0x5a;
    assert(expandPersistedSynthPreset(destination.data() + 1, 213, source.data(), width, 100));
    for (size_t i = 0; i < width; ++i) assert(destination[i + 1] == source[i]);
    if (width == 212) assert(destination[213] == 100);
    assert(destination.front() == 0xa5 && destination.back() == 0x5a);
    assert(expandPersistedSynthPreset(source.data(), 213, source.data(), width, 100));
    if (width == 212) assert(source[212] == 100);
    assert(!expandPersistedSynthPreset(destination.data(), 213, source.data(), 211, 100));
  }

}
