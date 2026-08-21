#pragma once

#include "../FirmwareModule.h"
#include "../hardware/HardwareConfig.h"

extern byte Hardware_Version;
extern volatile uint32_t audioDmaUnderrunCount;

struct MidiNoteHexIndexList {
  static constexpr size_t BYTE_COUNT = (LED_COUNT + 7) / 8;
  std::array<uint8_t, BYTE_COUNT> bits = {};

  void clear() {
    bits.fill(0);
  }

  bool push_back(uint8_t value) {
    if (value >= LED_COUNT) {
      return false;
    }
    bits[value / 8] |= static_cast<uint8_t>(1u << (value % 8));
    return true;
  }

};

extern std::array<MidiNoteHexIndexList, 128> midiNoteToHexIndices;

bool RAM_FUNC(isValidMidiChannel)(byte channel);
int RAM_FUNC(positiveMod)(int n, int d);
byte byteLerp(byte xOne, byte xTwo, float yOne, float yTwo, float y);
void RAM_FUNC(splitExtendedMidiNote)(int32_t midiIndex, int32_t& channelOffsetOut, byte& noteOut);
byte RAM_FUNC(wrapMidiChannel)(byte baseChannel, int32_t offset);
void RAM_FUNC(mapExtendedMidiNote)(int32_t midiIndex, byte baseChannel, byte& noteOut, byte& channelOut);
int32_t midiChannelOffset(int32_t midiIndex);
