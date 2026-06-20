#pragma once

#include "../FirmwareModule.h"
#include "../hardware/HardwareConfig.h"

class PressedKeySet {
 public:
  bool add(byte key);
  bool remove(byte key);
  void clear();
  bool contains(byte key) const;
  uint8_t size() const;
  byte operator[](uint8_t ordinal) const;

 private:
  static constexpr uint8_t INVALID_INDEX = 0xFF;

  std::array<uint8_t, BTN_COUNT> nextKey = {};
  std::array<uint8_t, BTN_COUNT> prevKey = {};
  std::array<bool, BTN_COUNT> active = {};
  uint8_t count = 0;
  uint8_t head = INVALID_INDEX;
  uint8_t tail = INVALID_INDEX;
};

extern PressedKeySet pressedKeyIDs;

void syncDynamicJIRatioCandidates();
int16_t justIntonationRetune(byte x);
void prepareActiveMidiPitch(byte x);
