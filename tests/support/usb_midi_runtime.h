#pragma once

#include <array>
#include <cassert>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <vector>

using byte = uint8_t;
constexpr byte MIDI_CHANNEL_MAX = 16;
inline bool isValidMidiChannel(byte channel) { return channel >= 1 && channel <= 16; }
#define sendToLog(message) do {} while (0)

struct TestUsb {
  bool mutex = false;
  void setManufacturer(const char*) {}
  void setProduct(const char*) {}
};
inline TestUsb USB;
inline bool mutex_try_enter(bool* locked, void*) {
  if (*locked) return false;
  *locked = true;
  return true;
}
inline void mutex_exit(bool* locked) { *locked = false; }

struct TestMidiUsb {
  bool online = true;
  size_t slots = 0;
  size_t attempts = 0;
  std::vector<std::array<uint8_t, 4>> sent;
  bool connected() { return online; }
  bool writePacket(const uint8_t* packet) {
    ++attempts;
    if (slots == 0) return false;
    --slots;
    sent.push_back({packet[0], packet[1], packet[2], packet[3]});
    return true;
  }
  size_t available() { return 0; }
  int read() { return -1; }
  size_t write(uint8_t) { return 1; }
  void setName(const char*) {}
  void begin() {}
};
inline TestMidiUsb MidiUSB;

struct TestSerial {
  void begin(uint32_t) {}
  size_t write(uint8_t) { return 1; }
  size_t write(const uint8_t*, size_t length) { return length; }
};
inline TestSerial Serial1;
inline size_t clockReads = 0;
inline size_t waits = 0;
inline uint64_t readClock() { return ++clockReads; }
inline void delayMicroseconds(uint32_t) { ++waits; }
inline void tud_task() {}
