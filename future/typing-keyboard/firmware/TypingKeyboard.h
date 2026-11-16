#pragma once

#include "../FirmwareModule.h"
#include "../hardware/HardwareConfig.h"

constexpr uint8_t TYPING_PRESET_COUNT = 16;
constexpr size_t TYPING_PRESET_MAX_BYTES = 1024;
struct TypingPreset {
  char name[32] = {};
  uint8_t objectId[16] = {};
  uint8_t keys[LED_COUNT][2] = {}; // USB usage, additional modifier bits
  uint8_t colors[LED_COUNT][3] = {}; // RGB
  uint8_t animation = 0;
  uint8_t rotation = 0; // Intended clockwise quarter-turns; physical indices are unchanged.
};
struct TypingPresetMetadata {
  bool valid = false;
  char name[32] = {};
  uint8_t objectId[16] = {};
};
const TypingPresetMetadata* typingPresetMetadata(uint16_t slot);
bool parseTypingPreset(const std::vector<uint8_t>& body, TypingPreset& preset);
bool readTypingPreset(uint16_t slot, TypingPreset& preset, std::vector<uint8_t>* body = nullptr);
int saveTypingPreset(uint16_t handle, const TypingPreset& preset, const std::vector<uint8_t>& body);
bool deleteTypingPreset(uint16_t slot);
void loadTypingCatalog();
void syncTypingSettings();
void applyTypingPreset(const TypingPreset& preset, int savedSlot = -1);
void setupTypingUsb();
void setupTypingMenu(GEMPage& advanced);
bool typingModeActive();
void exitTypingMode();
void releaseTypingKeys();
void typingButtonEvent(byte index, bool pressed);
bool typingDebouncedPress(byte index, bool raw);
bool typingKeyHeld(byte index);
bool typingKeyAssigned(byte index);
uint8_t typingAnimation();
uint32_t typingLedColor(byte index);
void serviceTypingKeyboard();
