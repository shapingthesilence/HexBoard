#include "../src/firmware/storage/SettingsMigration.h"
#include <algorithm>
#include <array>
#include <cassert>

int main() {
  static_assert(persistedSettingsWidth(32) == 57);
  static_assert(persistedSettingsWidth(33) == 60);
  static_assert(persistedSettingsWidth(31) == 0);
  static_assert(persistedSettingsWidth(34) == 60);
  static_assert(persistedSettingsWidth(35) == 60);
  static_assert(persistedSettingsWidth(36) == 61);
  static_assert(persistedSettingsWidth(37) == 60);
  static_assert(persistedSettingsWidth(38) == 0);
  static_assert(MAX_PERSISTED_SETTINGS_WIDTH == 61);
  constexpr size_t current = 60;
  for (uint8_t version : {32,33,34,35,36,37}) {
    const size_t width = persistedSettingsWidth(version);
    std::array<uint8_t, 9 * MAX_PERSISTED_SETTINGS_WIDTH> source{};
    std::array<uint8_t, 9 * current + 2> destination{};
    destination.front()=0xa5; destination.back()=0x5a;
    for(size_t profile=0;profile<9;++profile) {
      for(size_t key=0;key<width;++key) source[profile*width+key]=(profile*31+key)&255;
      destination[1+profile*current+57]=0; destination[1+profile*current+58]=232;
      destination[1+profile*current+59]=16;
    }
    expandPersistedSettings(destination.data()+1,current,source.data(),width,9);
    for(size_t profile=0;profile<9;++profile) {
      // Every shared byte survives; version 36's trailing sampler slot is dropped.
      for(size_t key=0;key<std::min(width,current);++key) assert(destination[1+profile*current+key]==source[profile*width+key]);
      if(width==57) {assert(destination[1+profile*current+57]==0);assert(destination[1+profile*current+58]==232);assert(destination[1+profile*current+59]==16);}
    }
    assert(destination.front()==0xa5 && destination.back()==0x5a);
  }
  static_assert(persistedSynthPresetWidth(11) == 212);
  static_assert(persistedSynthPresetWidth(12) == 213);
  static_assert(persistedSynthPresetWidth(13) == 246);
  static_assert(persistedSynthPresetWidth(10) == 0);
  static_assert(persistedSynthPresetWidth(14) == 0);
  for (size_t width : {size_t(212), size_t(213), size_t(246)}) {
    std::array<uint8_t, 246> source{};
    std::array<uint8_t, 248> destination{};
    for (size_t i = 0; i < source.size(); ++i) source[i] = (i * 7 + 1) & 255;
    destination.fill(0xee);
    destination.front() = 0xa5; destination.back() = 0x5a;
    assert(expandPersistedSynthPreset(destination.data() + 1, 246, source.data(), width, 100));
    for (size_t i = 0; i < width; ++i) assert(destination[i + 1] == source[i]);
    if (width == 212) assert(destination[213] == 100);
    // Older records become wavetable presets with no sampler name or overrides.
    if (width < 246) for (size_t i = 213; i < 246; ++i) assert(destination[i + 1] == 0);
    assert(destination.front() == 0xa5 && destination.back() == 0x5a);
    auto inPlace = source;
    assert(expandPersistedSynthPreset(inPlace.data(), 246, inPlace.data(), width, 100));
    if (width == 212) assert(inPlace[212] == 100);
    assert(!expandPersistedSynthPreset(destination.data(), 246, source.data(), 211, 100));
    assert(!expandPersistedSynthPreset(destination.data(), 213, source.data(), width, 100));
  }
}
