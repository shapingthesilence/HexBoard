#include "TypingKeyboard.h"
#include "TypingInput.h"
#include <USB.h>
#include <tusb-hid.h>
#include "../app/RuntimeDefaults.h"
#include "../hardware/GridScanRotary.h"
#include "../hardware/GridState.h"
#include "../hardware/LedRender.h"
#include "../menu/CommandWheelOverlay.h"
#include "../menu/MenuAndDisplay.h"
#include "../menu/VirtualListMenu.h"
#include "../midi/DelegatedControl.h"
#include "../midi/MidiTransport.h"
#include "../sequencer/SequencerMode.h"
#include "../storage/Settings.h"
#include "../synth/SynthAudio.h"

namespace {
bool active = false;
uint8_t keys[LED_COUNT][2] = {};
uint8_t colors[LED_COUNT][3] = {};
static_assert(LED_COUNT == typing::KeyCount, "Typing schema requires 140 keys");
typing::InputState input;
typing::Debouncer debouncer;
uint8_t animation = ANIMATE_BUTTON;
int selectedLayout = -1;
int selectedColors = -1;
uint8_t hidId = 0;
bool usbReadyLast = false;
bool usbRegistered = false;
// Modifiers followed by a bitmap for usages 0x04..0x73 (F24).
// Shared descriptor registry replaces the report ID on first local activation.
const uint8_t descriptor[] = {
  0x05,0x01, 0x09,0x06, 0xa1,0x01, 0x85,0x01,
  0x05,0x07, 0x19,0xe0, 0x29,0xe7, 0x15,0x00, 0x25,0x01,
  0x75,0x01, 0x95,0x08, 0x81,0x02,
  0x19,0x04, 0x29,0x73, 0x75,0x01, 0x95,0x70, 0x81,0x02, 0xc0
};
uint64_t pendingSince = 0;
bool suspendedForTransfer = false;
GEMPage* page = nullptr;

void setSetting(SettingKey key, uint8_t value) {
  settings[static_cast<uint8_t>(key)] = value;
  markSettingsDirty();
}

void toggleMode() {
  if (active) exitTypingMode();
  else {
    if (delegatedControlState.active) exitDelegatedControl();
    if (sequencerModeActive()) exitSequencerMode();
    panicStopOutput();
    setupTypingUsb();
    suppressHeldHexes();
    debouncer = typing::Debouncer{};
    active = true;
    dismissCommandWheelOverlay();
  }
  page->setTitle(active ? "Typing ON" : "Typing OFF");
  menu.setMenuPageCurrent(*page);
  wakeDisplayFromScreensaver();
  menu.drawMenu();
}

bool chooseColors = false;
uint16_t catalogCount(void*) {
  uint16_t count = 0;
  for (uint16_t i = 0; i < TYPING_PRESET_COUNT; ++i) if (typingPresetMetadata(i)) ++count;
  return count;
}
uint16_t slotAt(uint16_t row) {
  for (uint16_t i = 0; i < TYPING_PRESET_COUNT; ++i) if (typingPresetMetadata(i)) {
    if (!row--) return i;
  }
  return TYPING_PRESET_COUNT;
}
bool catalogLabel(void*, uint16_t row, char* label, size_t length) {
  const auto* entry = typingPresetMetadata(slotAt(row));
  if (!entry) return false;
  snprintf(label, length, "%s", entry->name);
  return true;
}
bool catalogCurrent(void*, uint16_t row) {
  return slotAt(row) == (chooseColors ? selectedColors : selectedLayout);
}
void selectCatalog(void*, uint16_t row) {
  auto slot = slotAt(row);
  TypingPreset preset;
  if (!readTypingPreset(slot, preset)) return;
  setSetting(chooseColors ? SettingKey::TypingColors : SettingKey::TypingLayout, slot);
  if (chooseColors) {
    memcpy(colors, preset.colors, sizeof(colors));
    selectedColors = slot;
  } else {
    releaseTypingKeys();
    memcpy(keys, preset.keys, sizeof(keys));
    selectedLayout = slot;
  }
  redrawVirtualListMenu();
}
void openCatalog(bool colorSelection) {
  chooseColors = colorSelection;
  VirtualListMenuProvider provider;
  provider.title = chooseColors ? "Typing Colors" : "Typing Layout";
  provider.getCount = catalogCount;
  provider.getLabel = catalogLabel;
  provider.isCurrent = catalogCurrent;
  provider.select = selectCatalog;
  provider.emptyLabel = "Add in web editor";
  openVirtualListMenu(provider);
}
void openLayouts() { openCatalog(false); }
void openColors() { openCatalog(true); }
void saveAnimation() { setSetting(SettingKey::TypingAnimation, animation); }
}

void setupTypingUsb() {
  if (usbRegistered) return;
  USB.disconnect();
  hidId = USB.registerHIDDevice(descriptor, sizeof(descriptor), 10, 0x0001);
  usbRegistered = true;
  USB.connect();
  releaseTypingKeys();
}

bool typingModeActive() { return active; }
bool typingKeyHeld(byte index) { return input.held(index); }
bool typingDebouncedPress(byte index, bool raw) { return debouncer.update(index, raw, time_us_32()); }
bool typingKeyAssigned(byte index) { return index < LED_COUNT && (keys[index][0] || keys[index][1]); }
uint8_t typingAnimation() { return animation; }

void releaseTypingKeys() {
  input.release();
  pendingSince = time_us_64();
  if (active) suppressHeldHexes();
}

void exitTypingMode() {
  if (!active) return;
  active = false;
  releaseTypingKeys();
  suppressHeldHexes();
  if (page) page->setTitle("Typing OFF");
}

void typingButtonEvent(byte index, bool pressed) {
  if (index >= LED_COUNT || !active) return;
  if (!input.pending()) pendingSince = time_us_64();
  if (!input.event(index, pressed, keys)) releaseTypingKeys();
}

void serviceTypingKeyboard() {
  if (!usbRegistered) return;
  if (presetSyncTransferActive && !suspendedForTransfer) releaseTypingKeys();
  suspendedForTransfer = presetSyncTransferActive;
  // No wait for USB readiness; preserve press/release order across endpoint polls.
  if (!mutex_try_enter(&USB.mutex, nullptr)) return;
  bool ready = tud_mounted() && !tud_suspended();
  if (ready != usbReadyLast) {
    releaseTypingKeys();
    usbReadyLast = ready;
  }
  if (input.pending() && time_us_64() - pendingSince > 250000) releaseTypingKeys();
  if (ready && input.pending() && tud_hid_ready()
      && tud_hid_report(USB.findHIDReportID(hidId), input.front().data(), sizeof(typing::Report))) {
    input.pop();
    pendingSince = time_us_64();
  }
  mutex_exit(&USB.mutex);
}

void syncTypingSettings() {
  releaseTypingKeys();
  memset(keys, 0, sizeof(keys));
  memset(colors, 0, sizeof(colors));
  selectedLayout = selectedColors = -1;
  TypingPreset preset;
  if (readTypingPreset(settingValue(SettingKey::TypingLayout), preset)) {
    memcpy(keys, preset.keys, sizeof(keys));
    selectedLayout = settingValue(SettingKey::TypingLayout);
  }
  if (readTypingPreset(settingValue(SettingKey::TypingColors), preset)) {
    memcpy(colors, preset.colors, sizeof(colors));
    selectedColors = settingValue(SettingKey::TypingColors);
  }
  animation = settingValue(SettingKey::TypingAnimation);
  if (!(animation <= 3 || (animation >= 6 && animation <= 8) || animation == 10)) animation = ANIMATE_BUTTON;
}

void applyTypingPreset(const TypingPreset& preset, int savedSlot) {
  releaseTypingKeys();
  memcpy(keys, preset.keys, sizeof(keys));
  memcpy(colors, preset.colors, sizeof(colors));
  animation = preset.animation;
  selectedLayout = selectedColors = savedSlot;
  if (savedSlot >= 0) {
    setSetting(SettingKey::TypingLayout, savedSlot);
    setSetting(SettingKey::TypingColors, savedSlot);
    setSetting(SettingKey::TypingAnimation, animation);
  }
}

uint32_t typingLedColor(byte index) {
  if (index >= LED_COUNT) return 0;
  bool highlight = animation != ANIMATE_NONE && (input.held(index) || h[index].animate);
  const uint8_t* rgb = colors[index];
  auto channel = [&](uint8_t c) -> uint8_t {
    if (highlight) c = c + (255 - c) / 2;
    else c = applyLEDLevel(c, ledRestBrightness);
    // Match musical LEDs: resting level first, global brightness before gamma.
    return static_cast<uint16_t>(c) * globalBrightness / 255u;
  };
  return gammaLEDcode((uint32_t(channel(rgb[0])) << 16) | (uint32_t(channel(rgb[1])) << 8) | channel(rgb[2]));
}

void setupTypingMenu(GEMPage& advanced) {
  static GEMPage typingPage("Typing OFF", advanced);
  page = &typingPage;
  static GEMItem link("Typing Keyboard", typingPage);
  static GEMItem toggle("Music / Typing", toggleMode);
  static GEMItem layouts("Layout", openLayouts);
  static GEMItem colorItem("Colors", openColors);
  static SelectOptionByte options[] = {
    {"None", ANIMATE_NONE}, {"Button", ANIMATE_BUTTON}, {"Star", ANIMATE_STAR},
    {"Splash", ANIMATE_SPLASH}, {"Orbit", ANIMATE_ORBIT}, {"Beams", ANIMATE_BEAMS},
    {"Rev Splash", ANIMATE_SPLASH_REVERSE}, {"Rev Star", ANIMATE_STAR_REVERSE}
  };
  static GEMSelect select(sizeof(options) / sizeof(options[0]), options);
  static GEMItem animationItem("Animation", animation, select, saveAnimation);
  typingPage.addMenuItem(toggle);
  typingPage.addMenuItem(layouts);
  typingPage.addMenuItem(colorItem);
  typingPage.addMenuItem(animationItem);
  advanced.addMenuItem(link);
}
