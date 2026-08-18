#include "../FirmwareModule.h"
#include "../app/DiagnosticsTiming.h"
#include "../app/PlatformCommon.h"
#include "../app/RuntimeDefaults.h"
#include "../hardware/GridState.h"
#include "../hardware/LedRender.h"
#include "../midi/MidiInput.h"
#include "../midi/MidiRouting.h"
#include "../midi/MidiTransport.h"
#include "../model/PitchAssignment.h"
#include "../storage/BuiltinGeometry.h"
#include "../storage/PresetSync.h"
#include "../storage/Settings.h"
#include "../storage/StorageHealth.h"
#include "../storage/SynthPresetStorage.h"
#include "../storage/SynthWavetableStorage.h"
#include "../sequencer/SequencerLightSettings.h"
#include "../sequencer/SequencerMode.h"
#include "../sequencer/SequencerPlaybackSettings.h"
#include "../synth/SynthAudio.h"
#include "CommandWheelOverlay.h"
#include "DisplayRefreshPolicy.h"
#include "GeometryMenu.h"
#include "MenuAndDisplay.h"
#include "PlayedNotesOverlay.h"
#include "SynthPresetMenu.h"
#include "SynthWavetableMenu.h"
#include "VirtualListMenu.h"

// @menu
/*
    This section of the code handles the
    dot matrix screen and, most importantly,
    the menu system display and controls.

    The following library is used: documentation
    is also available here.
      https://github.com/Spirik/GEM
  */
#define GEM_DISABLE_GLCD  // this line is needed to get the B&W display to work
/*
    The GEM menu library accepts initialization
    values to set the width of various components
    of the menu display, as below.
  */
#define MENU_ITEM_HEIGHT 10
#define MENU_PAGE_SCREEN_TOP_OFFSET 18
#define MENU_HEADER_DIVIDER_Y (MENU_PAGE_SCREEN_TOP_OFFSET - 3)
#define MENU_VALUES_LEFT_OFFSET 78
// Create an instance of the U8g2 graphics library with a coalescing DMA-backed
// framebuffer transport.
HexBoardDisplay u8g2(U8G2_R2, /* reset=*/U8X8_PIN_NONE);
// Create menu object of class GEM_u8g2. Supply its constructor with reference to u8g2 object we created earlier
GEM_u8g2 menu(
  u8g2, GEM_POINTER_ROW, GEM_ITEMS_COUNT_AUTO,
  MENU_ITEM_HEIGHT, MENU_PAGE_SCREEN_TOP_OFFSET, MENU_VALUES_LEFT_OFFSET);
bool screenSaverOn = 0;
bool audioMenuItemInserted = false;
uint64_t screenTime = 0;                         // GFX timer to count if screensaver should go on
const uint64_t screenSaverTimeout = (1u << 25);  // 2^25 microseconds ~ 33 seconds
bool flashSaveScreenVisible = false;
bool flashSaveScreenWokeDisplayFromSleep = false;
bool flashSaveScreenClosePending = false;
uint64_t flashSaveSavedScreenTime = 0;
uint64_t flashSaveScreenVisibleUntil = 0;
constexpr uint64_t FLASH_SAVE_SCREEN_MAX_VISIBLE_MICROS = 700000ULL;
bool missingWavetableNoticeVisible = false;
bool missingWavetableNoticeWokeDisplayFromSleep = false;
uint64_t missingWavetableNoticeSavedScreenTime = 0;
uint64_t missingWavetableNoticeVisibleUntil = 0;
constexpr uint64_t MISSING_WAVETABLE_NOTICE_MICROS = 2000000ULL;

constexpr uint8_t VIRTUAL_LIST_LAUNCHER_VISIBLE_CHARS = 19;
constexpr uint64_t VIRTUAL_LIST_LAUNCHER_SCROLL_START_DELAY_MICROS = 1500000ULL;
constexpr uint64_t VIRTUAL_LIST_LAUNCHER_SCROLL_END_DELAY_MICROS = 1000000ULL;
constexpr uint64_t VIRTUAL_LIST_LAUNCHER_SCROLL_INTERVAL_MICROS = 250000ULL;

GEMPage* virtualListLauncherFocusedPage = nullptr;
GEMItem* virtualListLauncherFocusedItem = nullptr;
uint64_t virtualListLauncherFocusStartMicros = 0;
uint16_t virtualListLauncherScrollOffset = 0;
bool virtualListLauncherScrollApplied = false;
char virtualListLauncherValueBuffer[SYNTH_WAVETABLE_MENU_LABEL_LENGTH] = {};

constexpr uint8_t MODAL_SCREEN_FOOTER_BASELINE = 112;
uint8_t presetSyncDisplayedObjectType = 0xFF;
uint8_t presetSyncDisplayedDirection = 0;
uint8_t presetSyncDisplayedProgress = 0xFF;
uint16_t presetSyncDisplayedTransferId = 0;
uint32_t presetSyncDisplayedCompletedBytes = UINT32_MAX;
uint64_t presetSyncDisplayLastRefreshAt = 0;

void drawCenteredMenuHeaderTitle(const char* title) {
  if (!title) {
    title = "";
  }
  u8g2.setFont(GEM_FONT_BIG);
  const int titleWidth = u8g2.getStrWidth(title);
  const int centeredX = (static_cast<int>(u8g2.getDisplayWidth()) - titleWidth) / 2;
  u8g2.drawStr(centeredX > 0 ? centeredX : 0, 0, title);
}

void wakeDisplayFromScreensaver() {
  if (!screenSaverOn) {
    return;
  }
  screenSaverOn = false;
  u8g2.setPowerSave(0);
  u8g2.setContrast(CONTRAST_AWAKE);
}

void enterDisplayScreensaver() {
  screenSaverOn = true;
  u8g2.setContrast(CONTRAST_SCREENSAVER);
  u8g2.clearBuffer();
  u8g2.setPowerSave(1);
}

void wakeDelegatedControlScreenForInput() {
  screenTime = 0;
  wakeDisplayFromScreensaver();
  delegatedControlState.displayDirty = true;
}

void drawCenteredDelegatedText(const char* text, int y) {
  int textWidth = u8g2.getStrWidth(text);
  int x = (u8g2.getDisplayWidth() - textWidth) / 2;
  if (x < 0) {
    x = 0;
  }
  u8g2.drawStr(x, y, text);
}

void drawDelegatedControlScreen() {
  if (!delegatedControlState.active) {
    return;
  }
  if (delegatedControlState.displayWakeRequested) {
    wakeDelegatedControlScreenForInput();
    delegatedControlState.displayWakeRequested = false;
  }
  if (screenSaverOn || !delegatedControlState.displayDirty) {
    return;
  }

  dismissCommandWheelOverlay();
  noteOverlayVisible = false;
  noteBadgeVisible = false;
  noteOverlayTemporaryWake = false;
  noteOverlayWokeDisplayFromSleep = false;
  noteBadgeText[0] = '\0';

  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_6x13_tf);
  char delegatedAppName[DELEGATED_APP_NAME_MAX + 1] = {};
  for (size_t i = 0; i < sizeof(delegatedAppName); ++i) {
    delegatedAppName[i] = delegatedControlState.appName[i].load(std::memory_order_relaxed);
    if (delegatedAppName[i] == '\0') {
      break;
    }
  }
  delegatedAppName[DELEGATED_APP_NAME_MAX] = '\0';
  drawCenteredDelegatedText("Delegated", 20);
  drawCenteredDelegatedText("Control Mode", 36);
  drawCenteredDelegatedText(delegatedAppName, 62);
  drawCenteredDelegatedText("Hold encoder", 94);
  drawCenteredDelegatedText("5 sec to exit", MODAL_SCREEN_FOOTER_BASELINE);
  u8g2.sendBuffer();
  delegatedControlState.displayDirty = false;
}

void restoreInteractiveMenuDisplay() {
  dismissCommandWheelOverlay();
  if (virtualListMenuIsActive()) {
    redrawVirtualListMenu();
  } else {
    menu.drawMenu();
  }
}

void restoreMenuAfterDelegatedControl() {
  if (!delegatedControlState.returnToMenuRequested) {
    return;
  }
  delegatedControlState.returnToMenuRequested = false;
  if (!screenSaverOn) {
    restoreInteractiveMenuDisplay();
  }
}

const char* presetSyncTransferObjectLabel(uint8_t objectType) {
  switch (objectType) {
    case PRESET_SYNC_OBJECT_TYPE_SYNTH_PRESET:
      return "Synth preset";
    case PRESET_SYNC_OBJECT_TYPE_SYNTH_WAVETABLE:
      return "Wavetable";
    case PRESET_SYNC_OBJECT_TYPE_GEOMETRY_BUNDLE:
      return "Tuning bundle";
    case PRESET_SYNC_OBJECT_TYPE_GEOMETRY_ORDER:
      return "Geometry order";
    case PRESET_SYNC_OBJECT_TYPE_USER_TUNING:
      return "Tuning";
    case PRESET_SYNC_OBJECT_TYPE_USER_LAYOUT:
      return "Layout";
    case PRESET_SYNC_OBJECT_TYPE_USER_SCALE:
      return "Scale";
    case PRESET_SYNC_OBJECT_TYPE_SCALE_COLOR_MAP:
      return "Color map";
    case PRESET_SYNC_OBJECT_TYPE_EXPLICIT_BUTTON_MAP:
      return "Button map";
    default:
      return "Object";
  }
}

void resetPresetSyncTransferDisplayState() {
  presetSyncDisplayedObjectType = 0xFF;
  presetSyncDisplayedDirection = 0;
  presetSyncDisplayedProgress = 0xFF;
  presetSyncDisplayedTransferId = 0;
  presetSyncDisplayedCompletedBytes = UINT32_MAX;
  presetSyncDisplayLastRefreshAt = 0;
}

void drawPresetSyncTransferScreen(bool forceRedraw = false) {
  dismissCommandWheelOverlay();
  if (!presetSyncTransferScreenVisible) {
    presetSyncTransferScreenWokeDisplayFromSleep = screenSaverOn;
    presetSyncTransferSavedScreenTime = screenTime;
  }
  wakeDisplayFromScreensaver();
  noteOverlayVisible = false;
  noteBadgeVisible = false;
  noteOverlayTemporaryWake = false;
  noteOverlayWokeDisplayFromSleep = false;

  uint8_t objectType = 0;
  uint8_t direction = 0;
  uint16_t transferId = 0;
  uint32_t completedBytes = 0;
  uint32_t totalBytes = 0;
  if (presetSyncWriteTransfer.active) {
    objectType = presetSyncWriteTransfer.objectType;
    direction = 1;
    transferId = presetSyncWriteTransfer.transferId;
    completedBytes = presetSyncWriteTransfer.receivedBytes;
    totalBytes = presetSyncWriteTransfer.rawByteLength;
  } else if (presetSyncReadTransfer.active) {
    objectType = presetSyncReadTransfer.objectType;
    direction = 2;
    transferId = presetSyncReadTransfer.transferId;
    completedBytes = presetSyncReadTransfer.sentBytes;
    totalBytes = presetSyncReadTransfer.rawByteLength;
  }

  if (direction != 0 && totalBytes > 0) {
    const uint64_t now = readClock();
    uint8_t progress = static_cast<uint8_t>(std::min<uint64_t>(
      100,
      (static_cast<uint64_t>(completedBytes) * 100) / totalBytes));
    bool sameTransfer = presetSyncTransferScreenVisible
                        && objectType == presetSyncDisplayedObjectType
                        && direction == presetSyncDisplayedDirection
                        && transferId == presetSyncDisplayedTransferId;
    bool stateChanged = progress != presetSyncDisplayedProgress
                        || completedBytes != presetSyncDisplayedCompletedBytes;
    if (!forceRedraw
        && sameTransfer
        && (!stateChanged
            || (progress < 100
                && !displayRefreshDue(now, presetSyncDisplayLastRefreshAt)))) {
      return;
    }

    presetSyncDisplayedObjectType = objectType;
    presetSyncDisplayedDirection = direction;
    presetSyncDisplayedProgress = progress;
    presetSyncDisplayedTransferId = transferId;
    presetSyncDisplayedCompletedBytes = completedBytes;
    presetSyncDisplayLastRefreshAt = now;

    char titleText[28] = {};
    char progressText[8] = {};
    char byteText[28] = {};
    snprintf(titleText,
             sizeof(titleText),
             "%s %s",
             presetSyncTransferObjectLabel(objectType),
             direction == 1 ? "upload" : "download");
    snprintf(progressText, sizeof(progressText), "%u%%", progress);
    snprintf(byteText,
             sizeof(byteText),
             "%lu / %lu bytes",
             static_cast<unsigned long>(completedBytes),
             static_cast<unsigned long>(totalBytes));

    constexpr uint8_t barX = 8;
    constexpr uint8_t barY = 43;
    constexpr uint8_t barWidth = 112;
    constexpr uint8_t barHeight = 14;
    constexpr uint8_t barInnerWidth = barWidth - 4;
    uint8_t fillWidth = static_cast<uint8_t>(
      (static_cast<uint16_t>(barInnerWidth) * progress) / 100);

    u8g2.clearBuffer();
    u8g2.setFont(u8g2_font_6x13_tf);
    drawCenteredDelegatedText("MIDI SysEx", 15);
    drawCenteredDelegatedText(titleText, 31);
    u8g2.drawFrame(barX, barY, barWidth, barHeight);
    if (fillWidth > 0) {
      u8g2.drawBox(barX + 2, barY + 2, fillWidth, barHeight - 4);
    }
    drawCenteredDelegatedText(progressText, 73);
    drawCenteredDelegatedText(byteText, 91);
    drawCenteredDelegatedText("Please wait...", MODAL_SCREEN_FOOTER_BASELINE);
    // Preset-sync owns the UI while active, so drain the selected snapshot as
    // one bounded presentation instead of exposing it page-by-page over many
    // transfer-service iterations.
    u8g2.sendBufferAndWait();
    presetSyncTransferScreenVisible = true;
    return;
  }

  if (!forceRedraw && presetSyncTransferScreenVisible && presetSyncDisplayedDirection != 0) {
    return;
  }
  if (!forceRedraw
      && presetSyncTransferScreenVisible
      && presetSyncDisplayedDirection == 0
      && presetSyncDisplayedProgress == 0) {
    return;
  }
  presetSyncDisplayedDirection = 0;
  presetSyncDisplayedProgress = 0;

  char frameText[28];
  char messageText[18];
  snprintf(frameText, sizeof(frameText), "Frames: %lu", static_cast<unsigned long>(presetSyncTransferFrameCount));
  snprintf(messageText, sizeof(messageText), "Msg: 0x%02X", presetSyncTransferLastMessage);

  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_6x13_tf);
  u8g2.drawStr(8, 16, "MIDI SysEx");
  u8g2.drawStr(8, 32, "Transfer");
  u8g2.drawStr(8, 54, "Preset sync active");
  u8g2.drawStr(8, 72, frameText);
  u8g2.drawStr(8, 90, messageText);
  u8g2.drawStr(8, MODAL_SCREEN_FOOTER_BASELINE, "Please wait...");
  u8g2.sendBufferAndWait();
  presetSyncTransferScreenVisible = true;
}

void closePresetSyncTransferScreen() {
  if (!presetSyncTransferScreenVisible) {
    return;
  }
  presetSyncTransferScreenVisible = false;
  resetPresetSyncTransferDisplayState();
  screenTime = presetSyncTransferSavedScreenTime;
  if (presetSyncTransferScreenWokeDisplayFromSleep || screenTime > screenSaverTimeout) {
    enterDisplayScreensaver();
  } else if (delegatedControlState.active) {
    delegatedControlState.displayDirty = true;
    drawDelegatedControlScreen();
  } else {
    restoreInteractiveMenuDisplay();
  }
  presetSyncTransferScreenWokeDisplayFromSleep = false;
  presetSyncTransferSavedScreenTime = 0;
}

void showFlashSaveScreen() {
  dismissCommandWheelOverlay();
  if (!flashSaveScreenVisible) {
    flashSaveScreenWokeDisplayFromSleep = screenSaverOn;
    flashSaveSavedScreenTime = screenTime;
  }
  flashSaveScreenVisibleUntil = readClock() + FLASH_SAVE_SCREEN_MAX_VISIBLE_MICROS;
  flashSaveScreenClosePending = false;
  wakeDisplayFromScreensaver();
  noteOverlayVisible = false;
  noteBadgeVisible = false;
  noteOverlayTemporaryWake = false;
  noteOverlayWokeDisplayFromSleep = false;

  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_7x14B_tf);
  const char* saveLine = "Saving to flash.";
  const char* muteLine = "Audio muted.";
  int16_t saveX = static_cast<int16_t>((128 - u8g2.getStrWidth(saveLine)) / 2);
  int16_t muteX = static_cast<int16_t>((128 - u8g2.getStrWidth(muteLine)) / 2);
  u8g2.drawStr(saveX > 0 ? saveX : 0, 54, saveLine);
  u8g2.drawStr(muteX > 0 ? muteX : 0, 82, muteLine);
  u8g2.sendBuffer();
  flashSaveScreenVisible = true;
}

static void closeFlashSaveScreenNow() {
  if (!flashSaveScreenVisible) {
    return;
  }
  flashSaveScreenVisible = false;
  flashSaveScreenClosePending = false;
  screenTime = flashSaveSavedScreenTime;
  if (flashSaveScreenWokeDisplayFromSleep || screenTime > screenSaverTimeout) {
    enterDisplayScreensaver();
  } else if (presetSyncTransferActive) {
    drawPresetSyncTransferScreen(true);
  } else if (delegatedControlState.active) {
    delegatedControlState.displayDirty = true;
    drawDelegatedControlScreen();
  } else {
    restoreInteractiveMenuDisplay();
  }
  flashSaveScreenWokeDisplayFromSleep = false;
  flashSaveSavedScreenTime = 0;
  flashSaveScreenVisibleUntil = 0;
}

void closeFlashSaveScreen() {
  if (!flashSaveScreenVisible) {
    return;
  }
  if (readClock() < flashSaveScreenVisibleUntil) {
    flashSaveScreenClosePending = true;
    return;
  }
  closeFlashSaveScreenNow();
}

void dismissFlashSaveScreenForMenuInput() {
  if (!flashSaveScreenVisible) {
    return;
  }
  flashSaveScreenVisible = false;
  flashSaveScreenClosePending = false;
  flashSaveScreenWokeDisplayFromSleep = false;
  flashSaveSavedScreenTime = 0;
  flashSaveScreenVisibleUntil = 0;
}

void serviceFlashSaveScreen() {
  if (flashSaveScreenVisible && flashSaveScreenClosePending && readClock() >= flashSaveScreenVisibleUntil) {
    closeFlashSaveScreenNow();
  }
}

void showMissingWavetableNotice(const char* wavetableName) {
  dismissFlashSaveScreenForMenuInput();
  dismissCommandWheelOverlay();
  missingWavetableNoticeWokeDisplayFromSleep = screenSaverOn;
  missingWavetableNoticeSavedScreenTime = screenTime;
  missingWavetableNoticeVisibleUntil = readClock() + MISSING_WAVETABLE_NOTICE_MICROS;
  wakeDisplayFromScreensaver();
  noteOverlayVisible = false;
  noteBadgeVisible = false;
  noteOverlayTemporaryWake = false;
  noteOverlayWokeDisplayFromSleep = false;

  const char* name = wavetableName && wavetableName[0] ? wavetableName : "Unknown";
  size_t nameLength = strnlen(name, SYNTH_WAVETABLE_NAME_LENGTH - 1);
  char firstNameLine[22] = {};
  char secondNameLine[18] = {};
  if (nameLength <= 18) {
    snprintf(firstNameLine, sizeof(firstNameLine), "\"%s\"", name);
  } else {
    snprintf(firstNameLine, sizeof(firstNameLine), "\"%.*s", 18, name);
    snprintf(secondNameLine, sizeof(secondNameLine), "%.*s\"", 13, name + 18);
  }

  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_6x13_tf);
  drawCenteredDelegatedText("Upload wavetable", 17);
  drawCenteredDelegatedText(firstNameLine, secondNameLine[0] ? 39 : 46);
  if (secondNameLine[0]) {
    drawCenteredDelegatedText(secondNameLine, 56);
  }
  drawCenteredDelegatedText("with HexBoard Sync", 80);
  drawCenteredDelegatedText("Using Basic Shapes", 104);
  u8g2.sendBuffer();
  missingWavetableNoticeVisible = true;
}

bool serviceMissingWavetableNotice() {
  if (!missingWavetableNoticeVisible) {
    return false;
  }
  if (readClock() < missingWavetableNoticeVisibleUntil) {
    return true;
  }

  missingWavetableNoticeVisible = false;
  missingWavetableNoticeVisibleUntil = 0;
  screenTime = missingWavetableNoticeSavedScreenTime;
  if (missingWavetableNoticeWokeDisplayFromSleep || screenTime > screenSaverTimeout) {
    enterDisplayScreensaver();
  } else if (delegatedControlState.active) {
    delegatedControlState.displayDirty = true;
    drawDelegatedControlScreen();
  } else {
    restoreInteractiveMenuDisplay();
  }
  missingWavetableNoticeWokeDisplayFromSleep = false;
  missingWavetableNoticeSavedScreenTime = 0;
  return false;
}

bool servicePresetSyncTransfer() {
  if (!presetSyncTransferActive) {
    return false;
  }

  drawPresetSyncTransferScreen();
  if (processIncomingMIDI()) {
    drawPresetSyncTransferScreen();
  }

  uint64_t now = readClock();
  if (now >= presetSyncTransferDeadline) {
    sendToLog("Preset-sync SysEx transfer window timed out.");
    presetSyncCancelReadTransfer();
    presetSyncCancelWriteTransfer();
    presetSyncTransferActive = false;
  } else if ((now - presetSyncTransferLastActivity) >= PRESET_SYNC_TRANSFER_IDLE_MICROS
             && !presetSyncReadTransfer.active
             && !presetSyncWriteTransfer.active) {
    presetSyncTransferActive = false;
  }
  if (!presetSyncTransferActive) {
    closePresetSyncTransferScreen();
  }
  return presetSyncTransferActive;
}

/*
    Create menu page object of class GEMPage.
    Menu page holds menu items (GEMItem) and represents menu level.
    Menu can have multiple menu pages (linked to each other) with multiple menu items each.

    GEMPage constructor creates each page with the associated label.
    GEMItem constructor can create many different sorts of menu items.
    The items here are navigation links.
    The first parameter is the item label.
    The second parameter is the destination page when that item is selected.
  */
char mainTuningMenuLabel[40] = "Tuning";
char mainLayoutMenuLabel[40] = "Layout";
char mainScaleMenuLabel[40] = "Scale";
char mainSynthPresetMenuLabel[48] = "Synth:Current";
char synthPresetMenuLabel[48] = "Preset:Current";

GEMPage menuPageMain("HexBoard");
GEMPage menuPageTuning("Tuning", menuPageMain);
GEMItem menuGotoTuning(mainTuningMenuLabel, menuPageTuning);
GEMPage menuPageLayout("Layout", menuPageMain);
GEMItem menuGotoLayout(mainLayoutMenuLabel, menuPageLayout);
GEMPage menuPageScales("Scales", menuPageMain);
GEMItem menuGotoScales(mainScaleMenuLabel, menuPageScales);
GEMPage menuPageColors("Lights & Colors", menuPageMain);
GEMItem menuGotoColors("Lights & Colors", menuPageColors);
GEMPage menuPageEditor("Editor", menuPageMain);
GEMItem menuGotoEditor("Editor", menuPageEditor);
GEMPage menuPageSynth("Synth", menuPageEditor);
GEMItem menuGotoSynth("Synth", menuPageSynth);
GEMPage menuPageSynthWavetableLoad("Wavetables", menuPageSynth);
GEMItem menuGotoSynthWavetableLoad(currentSynthWavetableMenuLabel, menuPageSynthWavetableLoad);
GEMPage menuPageSynthAmpEnv("Amp Env", menuPageSynth);
GEMItem menuGotoSynthAmpEnv("Amp Env", menuPageSynthAmpEnv);
GEMPage menuPageSynthLfo("LFO", menuPageSynth);
GEMItem menuGotoSynthLfo("LFO", menuPageSynthLfo);
GEMPage menuPageSynthFx1("FX Env 1", menuPageSynth);
GEMItem menuGotoSynthFx1("FX Env 1", menuPageSynthFx1);
GEMPage menuPageSynthFx2("FX Env 2", menuPageSynth);
GEMItem menuGotoSynthFx2("FX Env 2", menuPageSynthFx2);
GEMPage menuPageSynthPresetSave("Save Preset", menuPageSynth);
GEMItem menuGotoSynthPresetSave("Save Preset", menuPageSynthPresetSave);
GEMPage menuPageMainSynthPresetLoad("Load Preset", menuPageMain);
GEMItem menuGotoMainSynthPresetLoad(mainSynthPresetMenuLabel, menuPageMainSynthPresetLoad);
GEMPage menuPageSynthPresetLoad("Load Preset", menuPageSynth);
GEMItem menuGotoSynthPresetLoad(synthPresetMenuLabel, menuPageSynthPresetLoad);
GEMPage menuPageOptions("Settings", menuPageMain);
GEMItem menuGotoOptions("Settings", menuPageOptions);
GEMPage menuPageAdvanced("Advanced", menuPageOptions);
GEMItem menuGotoAdvanced("Advanced", menuPageAdvanced);
GEMPage menuPageStorageStatus("Storage Status", menuPageAdvanced);
GEMItem menuGotoStorageStatus("Storage Status", menuPageStorageStatus);
GEMPage menuPageSerialDebug("Serial Debug", menuPageAdvanced);
GEMItem menuGotoSerialDebug("Serial Debug", menuPageSerialDebug);
GEMPage menuPageProfiles("Profiles", menuPageMain);
GEMItem menuGotoProfiles("Profiles", menuPageProfiles);

// --------------------------------------------------------
// Helper: Persistent Callback Info
// --------------------------------------------------------
// This helper struct is used to pass both the persistent setting's index
// and the pointer to the variable that is updated via the menu.
using PersistentValueReader = uint8_t (*)(void*);

struct PersistentCallbackInfo {
  uint8_t settingIndex;           // Corresponds to an index in the settings[] array
  void* variablePtr;              // Pointer to the runtime variable (e.g. a bool, byte, etc.)
  PersistentValueReader reader;   // Optional encoder to convert the runtime value to a byte for storage
  void (*postChange)();           // Optional hook invoked after the value is saved
};

// Helper encoders for settings that need translation before being stored.
uint8_t encodePbWheelSpeed(void* variablePtr) {
  int value = *reinterpret_cast<int*>(variablePtr);
  if (value <= 0) {
    return 10;  // Default to 2^10 (1024) if something unexpected happens.
  }
  uint8_t exponent = 0;
  while (value > 1) {
    value >>= 1;
    ++exponent;
  }
  if (exponent < 6) {
    exponent = 6;  // The minimum selectable PB speed is 2^6 (64).
  }
  return exponent;
}

uint8_t encodeMPELowestChannel(void* /*variablePtr*/) {
  clampMPEChannelRange();
  return mpeLowestChannel;
}

uint8_t encodeMPEHighestChannel(void* /*variablePtr*/) {
  clampMPEChannelRange();
  return mpeHighestChannel;
}


// --------------------------------------------------------
// Universal Callback for Persistent Menu Items
// --------------------------------------------------------
// This callback uses GEMCallbackData provided by the GEM library.
// (Do not redefine GEMCallbackData here.)
void universalSaveCallback(GEMCallbackData callbackData) {
  // Retrieve our persistent callback information from the callback union.
  // We stored a pointer to our PersistentCallbackInfo struct in valPointer.
  PersistentCallbackInfo* info = reinterpret_cast<PersistentCallbackInfo*>(callbackData.valPointer);

  // Read the new value from the linked variable.
  // Default behaviour assumes the value fits in a byte; a custom reader can override this.
  uint8_t newValue = info->reader ? info->reader(info->variablePtr)
                                  : *(reinterpret_cast<uint8_t*>(info->variablePtr));

  // Update the persistent settings array.
  settings[info->settingIndex] = newValue;
  sendToLog("Universal callback: Setting " + std::to_string(info->settingIndex) + " updated to " + std::to_string(newValue));

  // Mark the settings as dirty so auto-save occurs.
  markSettingsDirty();

  // Run any post-change hook tied to this setting.
  if (info->postChange) {
    info->postChange();
  }
}
/*
    We haven't written the code for some procedures,
    but the menu item needs to know the address
    of procedures it has to run when it's selected.
    So we forward-declare a placeholder for the
    procedure like this, so that the menu item
    can be built, and then later we will define
    this procedure in full.
  */
void changeTranspose();
void changeKey();
void rebootToBootloader();
/*
    These GEMItems are read-only display items.
    They do not change any variable or run any procedure.
  */
GEMItem menuItemVersion("Firmware 2.0 beta 3");
SelectOptionByte optionByteHardware[] = {
  { "V1.1", HARDWARE_UNKNOWN }, { "V1.1", HARDWARE_V1_1 }, { "V1.2", HARDWARE_V1_2 }
};
GEMSelect selectHardware(sizeof(optionByteHardware) / sizeof(SelectOptionByte), optionByteHardware);
GEMItem menuItemHardware("Hardware", Hardware_Version, selectHardware, GEM_READONLY);
/*
    These GEMItems runs a given procedure when you select them.
    We must declare or define that procedure first.
  */
GEMItem menuItemUSBBootloader("Update Firmware", rebootToBootloader);

void syncSettingsToRuntime();
void refreshMenuChoicesForCurrentTuning();
void rebuildRuntimeStateFromCurrentSelection();
void updateEditorMenuVisibility();
void updateMainMenuDynamicLabels();
void tuningIntonationModeChanged();
void updateSerialDebugMenuVisibility();
void serialDebugRuntimeChanged(GEMCallbackData callbackData);

void resetDefaultsMenuCallback() {
  applyFactoryDefaultsToSettings();
  flashSafeSave();
  syncSettingsToRuntime();
  settingsDirty = false;
  sendToLog("Factory defaults loaded from menu.");
}

GEMItem menuItemResetDefaults("Reset Defaults", resetDefaultsMenuCallback);

void saveProfileMenu(GEMCallbackData callbackData) {
  saveProfileToSlot(callbackData.valByte);
}

void loadProfileMenu(GEMCallbackData callbackData) {
  setActiveProfile(callbackData.valByte);
  menuHome();
}

class RuntimeKeySpinner : public GEMSpinner {
public:
  RuntimeKeySpinner()
    : GEMSpinner(GEMSpinnerBoundariesInt{ 1, -9, 2 }, GEM_LOOP) {}

  void setRange(int minimum, int maximum) {
    _boundaries.boundariesInt = { 1, minimum, maximum };
    _length = maximum - minimum + 1;
  }
};

class RuntimeKeySelect : public GEMSelect {
public:
  RuntimeKeySelect()
    : GEMSelect(1, static_cast<SelectOptionInt*>(nullptr)) {}

  void setOptions(byte length, SelectOptionInt* options) {
    _length = length;
    _options = options;
  }
};

RuntimeKeySpinner spinnerCurrentKey;
RuntimeKeySelect selectCurrentKey;
std::vector<SelectOptionInt> currentKeyChoices;
std::vector<std::array<char, TUNING_KEY_LABEL_LENGTH>> currentKeyChoiceLabels;
GEMItem menuItemMainKey("Key", current.keyStepsFromA, selectCurrentKey, changeKey);
GEMItem menuItemMainKeyNumeric("Key", current.keyStepsFromA, spinnerCurrentKey, changeKey);

template <typename T, size_t Capacity>
class StaticObjectPool {
public:
  template <typename... Args>
  T& construct(size_t index, Args&&... args) {
    return *new (&storage_[index]) T(std::forward<Args>(args)...);
  }

private:
  alignas(T) unsigned char storage_[Capacity][sizeof(T)] = {};
};

StaticObjectPool<GEMItem, PROFILE_COUNT> loadProfileItemPool;
StaticObjectPool<GEMItem, PROFILE_COUNT> saveProfileItemPool;
StaticObjectPool<GEMItem, 1> storageSummaryItemPool;
StaticObjectPool<GEMItem, STORAGE_HEALTH_MAX_ISSUES> storagePathItemPool;
StaticObjectPool<GEMItem, STORAGE_HEALTH_MAX_ISSUES> storageReasonItemPool;
GEMItem* menuItemSaveProfile[PROFILE_COUNT];
GEMItem* menuItemLoadProfile[PROFILE_COUNT];
GEMItem* menuItemStorageSummary = nullptr;
GEMItem* menuItemStorageIssuePath[STORAGE_HEALTH_MAX_ISSUES] = {};
GEMItem* menuItemStorageIssueReason[STORAGE_HEALTH_MAX_ISSUES] = {};
char storageStatusPathLabels[STORAGE_HEALTH_MAX_ISSUES][20] = {};
char storageStatusReasonLabels[STORAGE_HEALTH_MAX_ISSUES][20] = {};
char saveProfileLabels[PROFILE_COUNT][24];
char loadProfileLabels[PROFILE_COUNT][24];

// Persistent menu items bind a runtime value, choices, and save callback.
PersistentCallbackInfo callbackInfoMPE = {
  static_cast<uint8_t>(SettingKey::MPEpitchBend),
  reinterpret_cast<void*>(&MPEpitchBendSemis),
  nullptr,
  assignPitches
};
SelectOptionByte optionByteMPEpitchBend[] = { { "   1", 1 }, { "   2", 2 }, { "   12", 12 }, { "   24", 24 }, { "   48", 48 }, { "   96", 96 } };
GEMSelect selectMPEpitchBend(sizeof(optionByteMPEpitchBend) / sizeof(SelectOptionByte), optionByteMPEpitchBend);
GEMItem menuItemMPEpitchBend("MPE Bend", MPEpitchBendSemis, selectMPEpitchBend, universalSaveCallback,
                             reinterpret_cast<void*>(&callbackInfoMPE));

SelectOptionByte optionByteYesOrNo[] = { { "No", 0 }, { "Yes", 1 } };
GEMSelect selectYesOrNo(sizeof(optionByteYesOrNo) / sizeof(SelectOptionByte), optionByteYesOrNo);
PersistentCallbackInfo callbackInfoScaleLock = {
  static_cast<uint8_t>(SettingKey::ScaleLock),
  reinterpret_cast<void*>(&scaleLock),
  nullptr,
  nullptr
};
GEMItem menuItemScaleLock("Scale Lock", scaleLock, universalSaveCallback, reinterpret_cast<void*>(&callbackInfoScaleLock));
GEMItem menuItemMainScaleLock("Scale Lock", scaleLock, universalSaveCallback, reinterpret_cast<void*>(&callbackInfoScaleLock));

PersistentCallbackInfo callbackInfoShiftColor = {
  static_cast<uint8_t>(SettingKey::PaletteCenterOnKey),
  reinterpret_cast<void*>(&paletteBeginsAtKeyCenter),
  nullptr,
  setLEDcolorCodes
};
GEMItem menuItemShiftColor("ColorByKey", paletteBeginsAtKeyCenter, universalSaveCallback, reinterpret_cast<void*>(&callbackInfoShiftColor));

PersistentCallbackInfo callbackInfoWheelAlt = {
  static_cast<uint8_t>(SettingKey::WheelAltMode),
  reinterpret_cast<void*>(&wheelMode),
  nullptr,
  nullptr
};
GEMItem menuItemWheelAlt("Alt Wheel?", wheelMode, selectYesOrNo, universalSaveCallback,
                         reinterpret_cast<void*>(&callbackInfoWheelAlt));

// Create a PersistentCallbackInfo instance for this setting.
PersistentCallbackInfo callbackInfoAutoSave = {
  static_cast<uint8_t>(SettingKey::AutoSave),
  reinterpret_cast<void*>(&autoSave),
  nullptr,
  nullptr
};
// (The GEMItem constructor here accepts a linked value, callback, and our callback info.)
GEMItem menuItemAutoSave("Auto-Save", autoSave, universalSaveCallback, reinterpret_cast<void*>(&callbackInfoAutoSave));

// The persisted option reverses the detected hardware's normal direction.
// The decoder consumes the resulting effective direction.
bool rotaryInvert = false;
bool rotaryInvertPreference = settingEnabled(SettingKey::RotaryInvert);

void updateEffectiveRotaryInvert() {
  rotaryInvert = hardwareDefaultRotaryInvert() != rotaryInvertPreference;
}

PersistentCallbackInfo callbackInfoRotary = {
  static_cast<uint8_t>(SettingKey::RotaryInvert),
  reinterpret_cast<void*>(&rotaryInvertPreference),
  nullptr,
  updateEffectiveRotaryInvert
};
GEMItem menuItemRotary("Invert Encoder", rotaryInvertPreference, universalSaveCallback, reinterpret_cast<void*>(&callbackInfoRotary));

GEMItem menuItemSerialDebugEnabled("Enabled", serialDebugEnabled, serialDebugRuntimeChanged, static_cast<void*>(nullptr));
GEMItem menuItemSerialDebugGeneral("General Log", serialDebugGeneralMessages, serialDebugRuntimeChanged, static_cast<void*>(nullptr));
GEMItem menuItemSerialDebugHeap("Min Heap", serialDebugHeapMessages, serialDebugRuntimeChanged, static_cast<void*>(nullptr));
GEMItem menuItemSerialDebugAudio("Audio Stats", serialDebugAudioMessages, serialDebugRuntimeChanged, static_cast<void*>(nullptr));

void updateSerialDebugMenuVisibility() {
  bool showOptions = serialDebugEnabled;
  menuItemSerialDebugGeneral.hide(!showOptions);
  menuItemSerialDebugHeap.hide(!showOptions);
  menuItemSerialDebugAudio.hide(!showOptions);
}

void serialDebugRuntimeChanged(GEMCallbackData /*callbackData*/) {
  if (serialDebugEnabled) {
    resetSerialDebugMinFreeHeap();
    resetSerialDebugAudioStats();
  }
  updateSerialDebugRuntime();
  updateSerialDebugMenuVisibility();
  dismissCommandWheelOverlay();
  menu.drawMenu();
}

PersistentCallbackInfo callbackInfoDisplayPlayedNotes = {
  static_cast<uint8_t>(SettingKey::DisplayPlayedNotes),
  reinterpret_cast<void*>(&noteDisplayMode),
  nullptr,
  onToggleDisplayPlayedNotes
};
SelectOptionByte optionByteNoteDisplayMode[] = {
  { "Off", NOTE_DISPLAY_OFF },
  { "Label", NOTE_DISPLAY_LABEL },
  { "Number", NOTE_DISPLAY_NUMBER },
  { "MIDI", NOTE_DISPLAY_MIDI }
};
GEMSelect selectNoteDisplayMode(sizeof(optionByteNoteDisplayMode) / sizeof(SelectOptionByte), optionByteNoteDisplayMode);
GEMItem menuItemDisplayPlayedNotes("DisplayNotes", noteDisplayMode, selectNoteDisplayMode, universalSaveCallback, reinterpret_cast<void*>(&callbackInfoDisplayPlayedNotes));

PersistentCallbackInfo callbackInfoBootAnimation = {
  static_cast<uint8_t>(SettingKey::BootAnimationEnabled),
  reinterpret_cast<void*>(&bootAnimationEnabled),
  nullptr,
  nullptr
};
GEMItem menuItemBootAnimation("Boot Anim", bootAnimationEnabled, universalSaveCallback,
                              reinterpret_cast<void*>(&callbackInfoBootAnimation));

SelectOptionByte optionByteHeadphoneVolumeCap[] = {
  { "25%", 32 },
  { "30%", 38 },
  { "35%", 44 },
  { "40%", 51 },
  { "45%", 57 },
  { "50%", 64 },
  { "55%", 70 },
  { "60%", 76 },
  { "65%", 83 },
  { "70%", 89 },
  { "75%", 95 },
  { "80%", 102 },
  { "85%", 108 },
  { "90%", 114 },
  { "95%", 121 },
  { "100%", HEADPHONE_VOLUME_CAP_FULL }
};
GEMSelect selectHeadphoneVolumeCap(sizeof(optionByteHeadphoneVolumeCap) / sizeof(SelectOptionByte), optionByteHeadphoneVolumeCap);
byte activeSynthOutputVolumeCap = HEADPHONE_VOLUME_CAP_FULL;

byte normalizeSynthOutputVolumeCap(byte value) {
  return value > HEADPHONE_VOLUME_CAP_FULL ? HEADPHONE_VOLUME_CAP_FULL : value;
}

SettingKey activeSynthOutputVolumeSettingKey() {
  return runtimeAudioDestination(synthBuzzerEnabled) == AUDIO_PIEZO
           ? SettingKey::PiezoVolumeCap
           : SettingKey::HeadphoneVolumeCap;
}

void syncActiveSynthOutputVolumeMenuValue() {
  activeSynthOutputVolumeCap = activeSynthOutputVolumeSettingKey() == SettingKey::PiezoVolumeCap
                                 ? piezoVolumeCap
                                 : headphoneVolumeCap;
}

void applyActiveSynthOutputVolume(byte value) {
  value = normalizeSynthOutputVolumeCap(value);
  activeSynthOutputVolumeCap = value;
  if (activeSynthOutputVolumeSettingKey() == SettingKey::PiezoVolumeCap) {
    setPiezoVolumeCap(value);
  } else {
    setHeadphoneVolumeCap(value);
  }
}

void saveSynthOutputVolumeMenu(GEMCallbackData /*callbackData*/) {
  applyActiveSynthOutputVolume(activeSynthOutputVolumeCap);
  settings[static_cast<uint8_t>(activeSynthOutputVolumeSettingKey())] = activeSynthOutputVolumeCap;
  markSettingsDirty();
}

GEMItem menuItemSynthOutputVolume("Volume", activeSynthOutputVolumeCap, selectHeadphoneVolumeCap, saveSynthOutputVolumeMenu);
void previewSynthOutputVolume(GEMPreviewCallbackData previewData) {
  applyActiveSynthOutputVolume(previewData.previewValByte);
}

SelectOptionByte optionByteLedTest[] = {
  { "Off", LED_TEST_OFF },
  { "Red", LED_TEST_RED },
  { "Green", LED_TEST_GREEN },
  { "Blue", LED_TEST_BLUE },
  { "White", LED_TEST_WHITE }
};
GEMSelect selectLedTest(sizeof(optionByteLedTest) / sizeof(SelectOptionByte), optionByteLedTest);
void restoreLedTestFrame() {
  ledTestMode = LED_TEST_OFF;
  lightUpLEDs();
}
void ledTestMenuCallback(GEMCallbackData /*callbackData*/) {
  restoreLedTestFrame();
}
GEMItem menuItemLedTest("LED Test", ledTestMode, selectLedTest, ledTestMenuCallback);
void previewLedTest(GEMPreviewCallbackData previewData) {
  ledTestMode = (previewData.previewSelectNum < 0) ? LED_TEST_OFF : previewData.previewValByte;
  lightUpLEDs();
}

SelectOptionByte optionByteWheelType[] = { { "Springy", 0 }, { "Sticky", 1 } };
GEMSelect selectWheelType(sizeof(optionByteWheelType) / sizeof(SelectOptionByte), optionByteWheelType);
PersistentCallbackInfo callbackInfoPBSticky = {
  static_cast<uint8_t>(SettingKey::PBSticky),
  reinterpret_cast<void*>(&pbSticky),
  nullptr,
  nullptr
};
GEMItem menuItemPBBehave("Pitch Bend", pbSticky, selectWheelType, universalSaveCallback,
                         reinterpret_cast<void*>(&callbackInfoPBSticky));
void previewPBBehave(GEMPreviewCallbackData previewData) {
  pbSticky = previewData.previewValByte;
}

PersistentCallbackInfo callbackInfoModSticky = {
  static_cast<uint8_t>(SettingKey::ModSticky),
  reinterpret_cast<void*>(&modSticky),
  nullptr,
  nullptr
};
GEMItem menuItemModBehave("Mod Wheel", modSticky, selectWheelType, universalSaveCallback,
                          reinterpret_cast<void*>(&callbackInfoModSticky));
void previewModBehave(GEMPreviewCallbackData previewData) {
  modSticky = previewData.previewValByte;
}

SelectOptionByte optionBytePlayback[] = {
  { "Off", SYNTH_OFF },
  { "MonoRtg", SYNTH_MONO_RETRIGGER },
  { "MonoLeg", SYNTH_MONO_LEGATO },
  { "Arp'gio", SYNTH_ARPEGGIO },
  { "Poly", SYNTH_POLY }
};
GEMSelect selectPlayback(sizeof(optionBytePlayback) / sizeof(SelectOptionByte), optionBytePlayback);
PersistentCallbackInfo callbackInfoPlayback = {
  static_cast<uint8_t>(SettingKey::PlaybackMode),
  reinterpret_cast<void*>(&playbackMode),
  nullptr,
  playbackModeChanged
};
GEMItem menuItemPlayback("Synth Mode", playbackMode, selectPlayback, universalSaveCallback,
                         reinterpret_cast<void*>(&callbackInfoPlayback));

// Hardware V1.2-only
PersistentCallbackInfo callbackInfoAudioDest = {
  static_cast<uint8_t>(SettingKey::AudioDestination),
  reinterpret_cast<void*>(&synthBuzzerEnabled),
  nullptr,
  nullptr
};
void audioDestinationChanged(GEMCallbackData callbackData) {
  universalSaveCallback(callbackData);
  syncAudioDestinationToRuntime();
  syncActiveSynthOutputVolumeMenuValue();
}
GEMItem menuItemAudioD("Buzzer", synthBuzzerEnabled, audioDestinationChanged,
                       reinterpret_cast<void*>(&callbackInfoAudioDest));

void installHardwareSpecificMenuItems() {
  if (Hardware_Version == HARDWARE_V1_2) {
    if (!audioMenuItemInserted) {
      menuPageSynth.addMenuItem(menuItemAudioD, 2);
      audioMenuItemInserted = true;
    }
  }
}

////////////////////////////////////////////////////////////////

const GEMSpinnerBoundariesByte spinnerBoundariesBPM = { 1, 255, 1 };
GEMSpinner spinnerJustIntonationBPM(spinnerBoundariesBPM, GEM_LOOP);
GEMSpinner spinnerSynthBPM(spinnerBoundariesBPM, GEM_LOOP);
GEMSpinner spinnerBPM_MultiplierOfJI(spinnerBoundariesBPM, GEM_LOOP);

///////////////////////////////////////////////////////////////////

// Roland MT-32 mode (1987)
SelectOptionByte optionByteRolandMT32[] __in_flash("midi") = {
  // Blank
  { "None", 0 },
  // Piano
  { "APiano1", 1 },
  { "APiano2", 2 },
  { "APiano3", 3 },
  { "EPiano1", 4 },
  { "EPiano2", 5 },
  { "EPiano3", 6 },
  { "EPiano4", 7 },
  { "HonkyTonk", 8 },
  // Organ
  { "EOrgan1", 9 },
  { "EOrgan2", 10 },
  { "EOrgan3", 11 },
  { "EOrgan4", 12 },
  { "POrgan2", 13 },
  { "POrgan3", 14 },
  { "POrgan4", 15 },
  { "Accordion", 16 },
  // Keybrd
  { "Harpsi1", 17 },
  { "Harpsi2", 18 },
  { "Harpsi3", 19 },
  { "Clavi 1", 20 },
  { "Clavi 2", 21 },
  { "Clavi 3", 22 },
  { "Celesta", 23 },
  { "Celest2", 24 },
  // S Brass
  { "SBrass1", 25 },
  { "SBrass2", 26 },
  { "SBrass3", 27 },
  { "SBrass4", 28 },
  // SynBass
  { "SynBass", 29 },
  { "SynBas2", 30 },
  { "SynBas3", 31 },
  { "SynBas4", 32 },
  // Synth 1
  { "Fantasy", 33 },
  { "HarmoPan", 34 },
  { "Chorale", 35 },
  { "Glasses", 36 },
  { "Soundtrack", 37 },
  { "Atmosphere", 38 },
  { "WarmBell", 39 },
  { "FunnyVox", 40 },
  // Synth 2
  { "EchoBell", 41 },
  { "IceRain", 42 },
  { "Oboe2K1", 43 },
  { "EchoPan", 44 },
  { "Dr.Solo", 45 },
  { "SchoolDaze", 46 },
  { "BellSinger", 47 },
  { "SquareWave", 48 },
  // Strings
  { "StrSec1", 49 },
  { "StrSec2", 50 },
  { "StrSec3", 51 },
  { "Pizzicato", 52 },
  { "Violin1", 53 },
  { "Violin2", 54 },
  { "Cello 1", 55 },
  { "Cello 2", 56 },
  { "ContraBass", 57 },
  { "Harp  1", 58 },
  { "Harp  2", 59 },
  // Guitar
  { "Guitar1", 60 },
  { "Guitar2", 61 },
  { "EGuitr1", 62 },
  { "EGuitr2", 63 },
  { "Sitar", 64 },
  // Bass
  { "ABass 1", 65 },
  { "ABass 2", 66 },
  { "EBass 1", 67 },
  { "EBass 2", 68 },
  { "SlapBass", 69 },
  { "SlapBa2", 70 },
  { "Fretless", 71 },
  { "Fretle2", 72 },
  // Wind
  { "Flute 1", 73 },
  { "Flute 2", 74 },
  { "Piccolo", 75 },
  { "Piccol2", 76 },
  { "Recorder", 77 },
  { "PanPipes", 78 },
  { "Sax   1", 79 },
  { "Sax   2", 80 },
  { "Sax   3", 81 },
  { "Sax   4", 82 },
  { "Clarinet", 83 },
  { "Clarin2", 84 },
  { "Oboe", 85 },
  { "EnglHorn", 86 },
  { "Bassoon", 87 },
  { "Harmonica", 88 },
  // Brass
  { "Trumpet", 89 },
  { "Trumpe2", 90 },
  { "Trombone", 91 },
  { "Trombo2", 92 },
  { "FrHorn1", 93 },
  { "FrHorn2", 94 },
  { "Tuba", 95 },
  { "BrsSect", 96 },
  { "BrsSec2", 97 },
  // Mallet
  { "Vibe  1", 98 },
  { "Vibe  2", 99 },
  { "SynMallet", 100 },
  { "WindBell", 101 },
  { "Glock", 102 },
  { "TubeBell", 103 },
  { "XyloPhone", 104 },
  { "Marimba", 105 },
  // Special
  { "Koto", 106 },
  { "Sho", 107 },
  { "Shakuhachi", 108 },
  { "Whistle", 109 },
  { "Whistl2", 110 },
  { "BottleBlow", 111 },
  { "BreathPipe", 112 },
  // Percussion
  { "Timpani", 113 },
  { "MelTom", 114 },
  { "DeepSnare", 115 },
  { "ElPerc1", 116 },
  { "ElPerc2", 117 },
  { "Taiko", 118 },
  { "TaikoRim", 119 },
  { "Cymbal", 120 },
  { "Castanets", 121 },
  { "Triangle", 122 },
  // Effects
  { "OrchHit", 123 },
  { "Telephone", 124 },
  { "BirdTweet", 125 },
  { "1NoteJam", 126 },
  { "WaterBells", 127 },
  { "JungleTune", 128 },
};
GEMSelect selectRolandMT32(sizeof(optionByteRolandMT32) / sizeof(SelectOptionByte), optionByteRolandMT32);
PersistentCallbackInfo callbackInfoProgramChange = {
  static_cast<uint8_t>(SettingKey::ProgramChange),
  reinterpret_cast<void*>(&programChange),
  nullptr,
  sendProgramChange
};
GEMItem menuItemRolandMT32("RolandMT32", programChange, selectRolandMT32, universalSaveCallback,
                           reinterpret_cast<void*>(&callbackInfoProgramChange));

// General MIDI 1
SelectOptionByte optionByteGeneralMidi[] __in_flash("midi") = {
  // Blank
  { "None", 0 },
  // Piano
  { "Piano 1", 1 },
  { "Piano 2", 2 },
  { "Piano 3", 3 },
  { "HonkyTonk", 4 },
  { "EPiano1", 5 },
  { "EPiano2", 6 },
  { "HarpsiChord", 7 },
  { "Clavinet", 8 },
  // Chromatic Percussion
  { "Celesta", 9 },
  { "Glockenspiel", 10 },
  { "MusicBox", 11 },
  { "Vibraphone", 12 },
  { "Marimba", 13 },
  { "Xylophone", 14 },
  { "TubeBells", 15 },
  { "Dulcimer", 16 },
  // Organ
  { "Organ 1", 17 },
  { "Organ 2", 18 },
  { "Organ 3", 19 },
  { "ChurchOrgan", 20 },
  { "ReedOrgan", 21 },
  { "Accordion", 22 },
  { "Harmonica", 23 },
  { "Bandoneon", 24 },
  // Guitar
  { "AGtrNylon", 25 },
  { "AGtrSteel", 26 },
  { "EGtrJazz", 27 },
  { "EGtrClean", 28 },
  { "EGtrMuted", 29 },
  { "EGtrOverdrive", 30 },
  { "EGtrDistortion", 31 },
  { "EGtrHarmonics", 32 },
  // Bass
  { "ABass", 33 },
  { "EBasFinger", 34 },
  { "EBasPicked", 35 },
  { "EBasFretless", 36 },
  { "SlpBass1", 37 },
  { "SlpBas2", 38 },
  { "SynBas1", 39 },
  { "SynBas2", 40 },
  // Strings
  { "Violin", 41 },
  { "Viola", 42 },
  { "Cello", 43 },
  { "ContraBass", 44 },
  { "TremoloStrings", 45 },
  { "PizzicatoStrings", 46 },
  { "OrchHarp", 47 },
  { "Timpani", 48 },
  // Ensemble
  { "StrEns1", 49 },
  { "StrEns2", 50 },
  { "SynStr1", 51 },
  { "SynStr2", 52 },
  { "ChoirAahs", 53 },
  { "VoiceOohs", 54 },
  { "SynVoice", 55 },
  { "OrchHit", 56 },
  // Brass
  { "Trumpet", 57 },
  { "Trombone", 58 },
  { "Tuba", 59 },
  { "MutedTrumpet", 60 },
  { "FrenchHorn", 61 },
  { "BrassSection", 62 },
  { "SynBrs1", 63 },
  { "SynBrs2", 64 },
  // Reed
  { "Sop Sax", 65 },
  { "AltoSax", 66 },
  { "Ten Sax", 67 },
  { "BariSax", 68 },
  { "Oboe", 69 },
  { "EnglHorn", 70 },
  { "Bassoon", 71 },
  { "Clarinet", 72 },
  // Pipe
  { "Piccolo", 73 },
  { "Flute", 74 },
  { "Recorder", 75 },
  { "PanFlute", 76 },
  { "BlownBottle", 77 },
  { "Shakuhachi", 78 },
  { "Whistle", 79 },
  { "Ocarina", 80 },
  // Synth Lead
  { "Ld1Square", 81 },
  { "Ld2Sawtooth", 82 },
  { "Ld3Calliope", 83 },
  { "Ld4Chiff", 84 },
  { "Ld5Charang", 85 },
  { "Ld6Voice", 86 },
  { "Ld7Fifths", 87 },
  { "Ld8Bass&Lead", 88 },
  // Synth Pad
  { "Pd1NewAge", 89 },
  { "Pd2Warm", 90 },
  { "Pd3Polysynth", 91 },
  { "Pd4Choir", 92 },
  { "Pd5BowedGlass", 93 },
  { "Pd6Metallic", 94 },
  { "Pd7Halo", 95 },
  { "Pd8Sweep", 96 },
  // Synth Effects
  { "FX1Rain", 97 },
  { "FX2Soundtrack", 98 },
  { "FX3Crystal", 99 },
  { "FX4Atmosphere", 100 },
  { "FX5Bright", 101 },
  { "FX6Goblins", 102 },
  { "FX7Echoes", 103 },
  { "FX8SciFi)", 104 },
  // Ethnic
  { "Sitar", 105 },
  { "Banjo", 106 },
  { "Shamisen", 107 },
  { "Koto", 108 },
  { "Kalimba", 109 },
  { "BagPipe", 110 },
  { "Fiddle", 111 },
  { "Shanai", 112 },
  // Percussive
  { "TinkleBell", 113 },
  { "Cowbell", 114 },
  { "SteelDrums", 115 },
  { "WoodBlock", 116 },
  { "TaikoDrum", 117 },
  { "MeloTom", 118 },
  { "SynDrum", 119 },
  { "RevCymbal", 120 },
  // Sound Effects
  { "GtrFretNoise", 121 },
  { "BreathNoise", 122 },
  { "Seashore", 123 },
  { "BirdTweet", 124 },
  { "TelephoneRing", 125 },
  { "Helicopter", 126 },
  { "Applause", 127 },
  { "Gunshot", 128 },
};
GEMSelect selectGeneralMidi(sizeof(optionByteGeneralMidi) / sizeof(SelectOptionByte), optionByteGeneralMidi);
GEMItem menuItemGeneralMidi("GeneralMidi", programChange, selectGeneralMidi, universalSaveCallback,
                            reinterpret_cast<void*>(&callbackInfoProgramChange));


// Transpose spinner: generated programmatically instead of 255 hardcoded entries
constexpr uint16_t TRANSPOSE_COUNT = 255;
static char transposeLabels[TRANSPOSE_COUNT][5];
static SelectOptionInt optionIntTransposeSteps[TRANSPOSE_COUNT];
void initTransposeOptions() {
  for (int i = 0; i < TRANSPOSE_COUNT; ++i) {
    int val = i - 127;  // -127 to +127
    if (val == 0) {
      memcpy(transposeLabels[i], "+/-0", 5);
    } else if (val < -99) {
      snprintf(transposeLabels[i], 5, "%d", val);
    } else if (val < 0) {
      snprintf(transposeLabels[i], 5, "-%*d", 3, -val);
    } else if (val < 100) {
      snprintf(transposeLabels[i], 5, "+%*d", 3, val);
    } else {
      snprintf(transposeLabels[i], 5, "+%d", val);
    }
    optionIntTransposeSteps[i] = { transposeLabels[i], val };
  }
}
GEMSelect selectTransposeSteps(255, optionIntTransposeSteps);
GEMItem menuItemTransposeSteps("Transpose", transposeSteps, selectTransposeSteps, changeTranspose);
void previewTranspose(GEMPreviewCallbackData previewData) {
  transposeSteps = previewData.previewValInt;
  current.transpose = transposeSteps;
  assignPitches();
  updateSynthWithNewFreqs();
}

//////////////////////////////////////////////////////////////////////////////////////////////////////
// MIDI Channel selection
SelectOptionByte optionByteMIDIChannel[] = { { "   1", 1 }, { "   2", 2 }, { "   3", 3 }, { "   4", 4 }, { "   5", 5 }, { "   6", 6 }, { "   7", 7 }, { "   8", 8 }, { "   9", 9 }, { "   10", 10 }, { "   11", 11 }, { "   12", 12 }, { "   13", 13 }, { "   14", 14 }, { "   15", 15 }, { "   16", 16 } };
GEMSelect selectMIDIchannel(16, optionByteMIDIChannel);
PersistentCallbackInfo callbackInfoDefaultMIDIChannel = {
  static_cast<uint8_t>(SettingKey::DefaultMIDIChannel),
  reinterpret_cast<void*>(&defaultMidiChannel),
  nullptr,
  refreshMidiRouting
};
GEMItem menuItemSelectMIDIChannel("MIDI Channel", defaultMidiChannel, selectMIDIchannel, universalSaveCallback,
                                  reinterpret_cast<void*>(&callbackInfoDefaultMIDIChannel));

SelectOptionByte optionByteMPELowChannel[] = {
  { "   2", 2 }, { "   3", 3 }, { "   4", 4 }, { "   5", 5 }, { "   6", 6 },
  { "   7", 7 }, { "   8", 8 }, { "   9", 9 }, { "   10", 10 }, { "   11", 11 },
  { "   12", 12 }, { "   13", 13 }, { "   14", 14 }, { "   15", 15 }, { "   16", 16 }
};
GEMSelect selectMPELowChannel(sizeof(optionByteMPELowChannel) / sizeof(SelectOptionByte), optionByteMPELowChannel);
PersistentCallbackInfo callbackInfoMPELowChannel = {
  static_cast<uint8_t>(SettingKey::MPELowestChannel),
  reinterpret_cast<void*>(&mpeLowestChannel),
  encodeMPELowestChannel,
  resetTuningMIDI
};
GEMItem menuItemSelectMPELowChannel("MPE Low Ch", mpeLowestChannel, selectMPELowChannel, universalSaveCallback,
                                    reinterpret_cast<void*>(&callbackInfoMPELowChannel));

SelectOptionByte optionByteMPEHighChannel[] = {
  { "   2", 2 }, { "   3", 3 }, { "   4", 4 }, { "   5", 5 }, { "   6", 6 },
  { "   7", 7 }, { "   8", 8 }, { "   9", 9 }, { "   10", 10 }, { "   11", 11 },
  { "   12", 12 }, { "   13", 13 }, { "   14", 14 }, { "   15", 15 }, { "   16", 16 }
};
GEMSelect selectMPEHighChannel(sizeof(optionByteMPEHighChannel) / sizeof(SelectOptionByte), optionByteMPEHighChannel);
PersistentCallbackInfo callbackInfoMPEHighChannel = {
  static_cast<uint8_t>(SettingKey::MPEHighestChannel),
  reinterpret_cast<void*>(&mpeHighestChannel),
  encodeMPEHighestChannel,
  resetTuningMIDI
};
GEMItem menuItemSelectMPEHighChannel("MPE High Ch", mpeHighestChannel, selectMPEHighChannel, universalSaveCallback,
                                     reinterpret_cast<void*>(&callbackInfoMPEHighChannel));

PersistentCallbackInfo callbackInfoMPELowPriority = {
  static_cast<uint8_t>(SettingKey::MPELowPriority),
  reinterpret_cast<void*>(&mpeLowPriorityMode),
  nullptr,
  resetTuningMIDI
};
GEMItem menuItemToggleMPELowPriority("MPE Low Priority", mpeLowPriorityMode, universalSaveCallback,
                                     reinterpret_cast<void*>(&callbackInfoMPELowPriority));

// MIDI force MPE option toggle
SelectOptionByte optionByteMPEMode[] = {
  { "Auto", MPE_MODE_AUTO },
  { "Disable", MPE_MODE_DISABLE },
  { "Force", MPE_MODE_FORCE }
};
GEMSelect selectMPEMode(sizeof(optionByteMPEMode) / sizeof(SelectOptionByte), optionByteMPEMode);
PersistentCallbackInfo callbackInfoMPEMode = {
  static_cast<uint8_t>(SettingKey::MPEMode),
  reinterpret_cast<void*>(&mpeUserMode),
  nullptr,
  refreshMidiRouting
};
GEMItem menuItemSelectMPEMode("MPE Mode", mpeUserMode, selectMPEMode, universalSaveCallback,
                               reinterpret_cast<void*>(&callbackInfoMPEMode));

// Toggle additional MPE messages (CC74 + Channel Pressure)
PersistentCallbackInfo callbackInfoExtraMPE = {
  static_cast<uint8_t>(SettingKey::ExtraMPE),
  reinterpret_cast<void*>(&extraMPE),
  nullptr,
  nullptr
};
GEMItem menuItemToggleExtraMPE("Extra MPE", extraMPE, universalSaveCallback,
                               reinterpret_cast<void*>(&callbackInfoExtraMPE));

// MIDI Channel selection
const GEMSpinnerBoundariesByte spinnerBoundariesCC74Value = { 1, 0, 127 };
GEMSpinner spinnerCC74Value(spinnerBoundariesCC74Value, GEM_LOOP);
PersistentCallbackInfo callbackInfoCC74 = {
  static_cast<uint8_t>(SettingKey::CC74Value),
  reinterpret_cast<void*>(&CC74value),
  nullptr,
  nullptr
};
GEMItem menuItemSelectCC74value("CC 74 Value", CC74value, spinnerCC74Value, universalSaveCallback,
                                reinterpret_cast<void*>(&callbackInfoCC74));

// Layout rotation selection
SelectOptionByte optionByteLayoutRotation[] = { { "0 Deg", 0 }, { "60 Deg", 1 }, { "120 Deg", 2 }, { "180 Deg", 3 }, { "240 Deg", 4 }, { "300 Deg", 5 } };
GEMSelect selectLayoutRotation(6, optionByteLayoutRotation);
PersistentCallbackInfo callbackInfoLayoutRotation = {
  static_cast<uint8_t>(SettingKey::LayoutRotation),
  reinterpret_cast<void*>(&layoutRotation),
  nullptr,
  updateLayoutAndRotate
};
GEMItem menuItemSelectLayoutRotation("Layout Rot", layoutRotation, selectLayoutRotation, universalSaveCallback,
                                     reinterpret_cast<void*>(&callbackInfoLayoutRotation));

// Device/display rotation selection
SelectOptionByte optionByteDeviceRotation[] = { { "0 Deg", 0 }, { "90 Deg", 1 }, { "180 Deg", 2 }, { "270 Deg", 3 } };
GEMSelect selectDeviceRotation(sizeof(optionByteDeviceRotation) / sizeof(SelectOptionByte), optionByteDeviceRotation);
PersistentCallbackInfo callbackInfoDeviceRotation = {
  static_cast<uint8_t>(SettingKey::DeviceRotation),
  reinterpret_cast<void*>(&deviceRotation),
  nullptr,
  applyDeviceDisplayRotation
};
GEMItem menuItemSelectDeviceRotation("Device Rot", deviceRotation, selectDeviceRotation, universalSaveCallback,
                                     reinterpret_cast<void*>(&callbackInfoDeviceRotation));

// Layout mirroring toggles
PersistentCallbackInfo callbackInfoMirrorLR = {
  static_cast<uint8_t>(SettingKey::MirrorLeftRight),
  reinterpret_cast<void*>(&mirrorLeftRight),
  nullptr,
  updateLayoutAndRotate
};
GEMItem mirrorLeftRightGEMItem("Flip L/R", mirrorLeftRight, universalSaveCallback,
                                reinterpret_cast<void*>(&callbackInfoMirrorLR));

PersistentCallbackInfo callbackInfoMirrorUD = {
  static_cast<uint8_t>(SettingKey::MirrorUpDown),
  reinterpret_cast<void*>(&mirrorUpDown),
  nullptr,
  updateLayoutAndRotate
};
GEMItem mirrorUpDownGEMItem("Flip U/D", mirrorUpDown, universalSaveCallback,
                             reinterpret_cast<void*>(&callbackInfoMirrorUD));

// Dynamic just intonation toggles and parameters
PersistentCallbackInfo callbackInfoJustIntonationBPMSync = {
  static_cast<uint8_t>(SettingKey::JustIntonationBPMSync),
  reinterpret_cast<void*>(&useJustIntonationBPM),
  nullptr,
  tuningIntonationModeChanged
};
GEMItem menuItemToggleJI_BPM("JI BPM Sync", useJustIntonationBPM, universalSaveCallback,
                              reinterpret_cast<void*>(&callbackInfoJustIntonationBPMSync));

PersistentCallbackInfo callbackInfoBeatBPM = {
  static_cast<uint8_t>(SettingKey::BeatBPM),
  reinterpret_cast<void*>(&justIntonationBPM),
  nullptr,
  refreshMidiRouting
};
GEMItem menuItemSetJI_BPM("Beat BPM", justIntonationBPM, spinnerJustIntonationBPM, universalSaveCallback,
                          reinterpret_cast<void*>(&callbackInfoBeatBPM));

PersistentCallbackInfo callbackInfoBPM_Mult = {
  static_cast<uint8_t>(SettingKey::BPMMultiplier),
  reinterpret_cast<void*>(&justIntonationBPM_Multiplier),
  nullptr,
  refreshMidiRouting
};
GEMItem menuItemSetJI_BPM_Multiplier("BPM Mult.", justIntonationBPM_Multiplier, spinnerBPM_MultiplierOfJI, universalSaveCallback,
                                     reinterpret_cast<void*>(&callbackInfoBPM_Mult));

PersistentCallbackInfo callbackInfoDynamicJI = {
  static_cast<uint8_t>(SettingKey::DynamicJI),
  reinterpret_cast<void*>(&useDynamicJustIntonation),
  nullptr,
  tuningIntonationModeChanged
};
GEMItem menuItemToggleDynamicJI("Dynamic JI", useDynamicJustIntonation, universalSaveCallback,
                                reinterpret_cast<void*>(&callbackInfoDynamicJI));

SelectOptionByte optionByteDynamicJIRatioTable[] = {
  { "3Limit", DYNAMIC_JI_RATIO_TABLE_3_LIMIT },
  { "5Limit", DYNAMIC_JI_RATIO_TABLE_5_LIMIT },
  { "7Limit", DYNAMIC_JI_RATIO_TABLE_7_LIMIT },
  { "11Limit", DYNAMIC_JI_RATIO_TABLE_11_LIMIT },
  { "13Limit", DYNAMIC_JI_RATIO_TABLE_13_LIMIT },
  { "17Limit", DYNAMIC_JI_RATIO_TABLE_17_LIMIT },
  { "19Limit", DYNAMIC_JI_RATIO_TABLE_19_LIMIT },
  { "23Limit", DYNAMIC_JI_RATIO_TABLE_23_LIMIT },
  { "29Limit", DYNAMIC_JI_RATIO_TABLE_29_LIMIT },
  { "31Limit", DYNAMIC_JI_RATIO_TABLE_31_LIMIT },
  { "37Limit", DYNAMIC_JI_RATIO_TABLE_37_LIMIT },
  { "41Limit", DYNAMIC_JI_RATIO_TABLE_41_LIMIT }
};
GEMSelect selectDynamicJIRatioTable(sizeof(optionByteDynamicJIRatioTable) / sizeof(SelectOptionByte), optionByteDynamicJIRatioTable);
PersistentCallbackInfo callbackInfoDynamicJIRatioTable = {
  static_cast<uint8_t>(SettingKey::DynamicJIRatioTable),
  reinterpret_cast<void*>(&dynamicJIRatioTable),
  nullptr,
  refreshMidiRouting
};
GEMItem menuItemSelectDynamicJIRatioTable("JI Table", dynamicJIRatioTable, selectDynamicJIRatioTable, universalSaveCallback,
                                          reinterpret_cast<void*>(&callbackInfoDynamicJIRatioTable));

SelectOptionByte optionByteColor[] = { { "Rainbow", RAINBOW_MODE }, { "Diatonic", DIATONIC_COLOR_MODE }, { "Alt", ALTERNATE_COLOR_MODE }, { "Fifths", RAINBOW_OF_FIFTHS_MODE }, { "Piano", PIANO_COLOR_MODE }, { "Alt Piano", PIANO_ALT_COLOR_MODE }, { "Filament", PIANO_INCANDESCENT_COLOR_MODE }, { "Custom", CUSTOM_COLOR_MODE } };
GEMSelect selectColor(sizeof(optionByteColor) / sizeof(SelectOptionByte), optionByteColor);
PersistentCallbackInfo callbackInfoColorMode = {
  static_cast<uint8_t>(SettingKey::ColorMode),
  reinterpret_cast<void*>(&colorMode),
  nullptr,
  setLEDcolorCodes
};
GEMItem menuItemColor("Color Mode", colorMode, selectColor, universalSaveCallback,
                      reinterpret_cast<void*>(&callbackInfoColorMode));
void previewColor(GEMPreviewCallbackData previewData) {
  colorMode = previewData.previewValByte;
  // Refresh the LED display with the new colorMode value
  setLEDcolorCodes();
}


SelectOptionByte optionByteAnimate[] = {
  { "Off", ANIMATE_NONE },
  { "Button", ANIMATE_BUTTON },
  { "Octave", ANIMATE_OCTAVE },
  { "By Note", ANIMATE_BY_NOTE },
  { "Star", ANIMATE_STAR },
  { "Splash", ANIMATE_SPLASH },
  { "Orbit", ANIMATE_ORBIT },
  { "Beams", ANIMATE_BEAMS },
  { "rSplash", ANIMATE_SPLASH_REVERSE },
  { "rStar", ANIMATE_STAR_REVERSE },
  { "MIDI In", ANIMATE_MIDI_IN }
};
GEMSelect selectAnimate(sizeof(optionByteAnimate) / sizeof(SelectOptionByte), optionByteAnimate);
PersistentCallbackInfo callbackInfoAnimation = {
  static_cast<uint8_t>(SettingKey::AnimationType),
  reinterpret_cast<void*>(&animationType),
  nullptr,
  nullptr
};
GEMItem menuItemAnimate("Animation", animationType, selectAnimate, universalSaveCallback,
                        reinterpret_cast<void*>(&callbackInfoAnimation));
void previewAnimate(GEMPreviewCallbackData previewData) {
  animationType = previewData.previewValByte;
}

SelectOptionByte optionByteRestLedLevel[] = {
  { "Off", 0 },
  { "Faint", 60 },
  { "Dim", 100 },
  { "Low", 160 },
  { "Normal", 255 }
};
GEMSelect selectRestLedLevel(sizeof(optionByteRestLedLevel) / sizeof(SelectOptionByte), optionByteRestLedLevel);
PersistentCallbackInfo callbackInfoRestLedLevel = {
  static_cast<uint8_t>(SettingKey::RestLedBrightness),
  reinterpret_cast<void*>(&ledRestBrightness),
  nullptr,
  setLEDcolorCodes
};
GEMItem menuItemRestLedLevel("Rest Bright", ledRestBrightness, selectRestLedLevel, universalSaveCallback,
                             reinterpret_cast<void*>(&callbackInfoRestLedLevel));
void previewRestLedLevel(GEMPreviewCallbackData previewData) {
  ledRestBrightness = previewData.previewValByte;
  setLEDcolorCodes();
}

SelectOptionByte optionByteDimLedLevel[] = {
  { "Off", 0 },
  { "Faint", 100 },
  { "Dim", 150 },
  { "Low", 200 },
  { "Normal", 255 }
};
GEMSelect selectDimLedLevel(sizeof(optionByteDimLedLevel) / sizeof(SelectOptionByte), optionByteDimLedLevel);
PersistentCallbackInfo callbackInfoDimLedLevel = {
  static_cast<uint8_t>(SettingKey::DimLedBrightness),
  reinterpret_cast<void*>(&ledDimBrightness),
  nullptr,
  setLEDcolorCodes
};
GEMItem menuItemDimLedLevel("Dim Bright", ledDimBrightness, selectDimLedLevel, universalSaveCallback,
                            reinterpret_cast<void*>(&callbackInfoDimLedLevel));
void previewDimLedLevel(GEMPreviewCallbackData previewData) {
  ledDimBrightness = previewData.previewValByte;
  setLEDcolorCodes();
}

SelectOptionByte optionByteBright[] = { { "Off", BRIGHT_OFF }, { "Dimmer", BRIGHT_DIMMER }, { "Dim", BRIGHT_DIM }, { "Low", BRIGHT_LOW }, { "Normal", BRIGHT_MID }, { "High", BRIGHT_HIGH }, { "THE SUN", BRIGHT_MAX } };
GEMSelect selectBright(sizeof(optionByteBright) / sizeof(SelectOptionByte), optionByteBright);
PersistentCallbackInfo callbackInfoBrightness = {
  static_cast<uint8_t>(SettingKey::GlobalBrightness),
  reinterpret_cast<void*>(&globalBrightness),
  nullptr,
  setLEDcolorCodes
};
GEMItem menuItemBright("Brightness", globalBrightness, selectBright, universalSaveCallback,
                       reinterpret_cast<void*>(&callbackInfoBrightness));
void previewBright(GEMPreviewCallbackData previewData) {
  globalBrightness = previewData.previewValByte;
  // Refresh the LED display with the new brightness value
  setLEDcolorCodes();
}

SelectOptionByte optionByteLedCurrentLimit[] = {
  { "250 mA", LED_CURRENT_LIMIT_250MA },
  { "500 mA", LED_CURRENT_LIMIT_500MA },
  { "750 mA", LED_CURRENT_LIMIT_750MA },
  { "1.0 A", LED_CURRENT_LIMIT_1000MA },
  { "1.5 A", LED_CURRENT_LIMIT_1500MA },
  { "2.0 A", LED_CURRENT_LIMIT_2000MA },
  { "3.0 A", LED_CURRENT_LIMIT_3000MA },
  { "Off", LED_CURRENT_LIMIT_OFF }
};
GEMSelect selectLedCurrentLimit(sizeof(optionByteLedCurrentLimit) / sizeof(SelectOptionByte), optionByteLedCurrentLimit);
PersistentCallbackInfo callbackInfoLedCurrentLimit = {
  static_cast<uint8_t>(SettingKey::LedCurrentLimitMode),
  reinterpret_cast<void*>(&ledCurrentLimitMode),
  nullptr,
  syncLedCurrentLimit
};
GEMItem menuItemLedCurrentLimit("LED Limit", ledCurrentLimitMode, selectLedCurrentLimit, universalSaveCallback,
                                reinterpret_cast<void*>(&callbackInfoLedCurrentLimit));
void previewLedCurrentLimit(GEMPreviewCallbackData previewData) {
  ledCurrentLimitMode = previewData.previewValByte;
  syncLedCurrentLimit();
}

SelectOptionByte optionByteWaveform[] = {
  { "Hybrid", WAVEFORM_HYBRID },
  { "Square", WAVEFORM_SQUARE },
  { "Saw", WAVEFORM_SAW },
  { "Triangl", WAVEFORM_TRIANGLE },
  { "Sine", WAVEFORM_SINE },
  { "Strings", WAVEFORM_STRINGS },
  { "Clrinet", WAVEFORM_CLARINET },
  { "MP", WAVEFORM_MP },
  { "BoxSaw", WAVEFORM_MP_BOX_SAW },
  { "FrndSqr", WAVEFORM_MP_FRIENDLY_SQUARE },
  { "Glassy", WAVEFORM_MP_GLASSY },
  { "Koolaid", WAVEFORM_MP_KOOLAID },
  { "Merv", WAVEFORM_MP_MERV },
  { "mBellsh", WAVEFORM_MP_M_BELLISH },
  { "Oval", WAVEFORM_MP_OVAL },
  { "PrttySh", WAVEFORM_MP_PRETTY_SHAPE },
  { "Qck808", WAVEFORM_MP_QUICK_808 },
  { "RichRpt", WAVEFORM_MP_RICH_REPEATER },
  { "RndTri", WAVEFORM_MP_ROUNDED_TRIANGLE },
  { "Stardew", WAVEFORM_MP_STARDEW },
  { "SyncTtn", WAVEFORM_MP_SYNC_THE_TITANIC },
  { "WrdWiz", WAVEFORM_MP_WEIRD_WIZARD },
  { "Woo", WAVEFORM_MP_WOO },
  { "BasicTb", WAVEFORM_BASIC_WAVETABLE }
};
GEMSelect selectWaveform(sizeof(optionByteWaveform) / sizeof(SelectOptionByte), optionByteWaveform);
PersistentCallbackInfo callbackInfoWaveform = {
  static_cast<uint8_t>(SettingKey::Waveform),
  reinterpret_cast<void*>(&currWave),
  nullptr,
  synthWaveformChanged
};
GEMItem menuItemWaveform("Waveform", currWave, selectWaveform, universalSaveCallback,
                         reinterpret_cast<void*>(&callbackInfoWaveform));
void previewWaveform(GEMPreviewCallbackData previewData) {
  currWave = previewData.previewValByte;
  synthWaveformChanged();
}

SelectOptionByte optionByteWavetablePosition[] = {
  { "1", SYNTH_WAVETABLE_FRAME_POSITION_AMOUNTS[0] },
  { "2", SYNTH_WAVETABLE_FRAME_POSITION_AMOUNTS[1] },
  { "3", SYNTH_WAVETABLE_FRAME_POSITION_AMOUNTS[2] },
  { "4", SYNTH_WAVETABLE_FRAME_POSITION_AMOUNTS[3] },
  { "5", SYNTH_WAVETABLE_FRAME_POSITION_AMOUNTS[4] },
  { "6", SYNTH_WAVETABLE_FRAME_POSITION_AMOUNTS[5] },
  { "7", SYNTH_WAVETABLE_FRAME_POSITION_AMOUNTS[6] },
  { "8", SYNTH_WAVETABLE_FRAME_POSITION_AMOUNTS[7] },
  { "9", SYNTH_WAVETABLE_FRAME_POSITION_AMOUNTS[8] },
  { "10", SYNTH_WAVETABLE_FRAME_POSITION_AMOUNTS[9] },
  { "11", SYNTH_WAVETABLE_FRAME_POSITION_AMOUNTS[10] },
  { "12", SYNTH_WAVETABLE_FRAME_POSITION_AMOUNTS[11] },
  { "13", SYNTH_WAVETABLE_FRAME_POSITION_AMOUNTS[12] },
  { "14", SYNTH_WAVETABLE_FRAME_POSITION_AMOUNTS[13] },
  { "15", SYNTH_WAVETABLE_FRAME_POSITION_AMOUNTS[14] },
  { "16", SYNTH_WAVETABLE_FRAME_POSITION_AMOUNTS[15] }
};
GEMSelect selectWavetablePosition(sizeof(optionByteWavetablePosition) / sizeof(SelectOptionByte), optionByteWavetablePosition);
PersistentCallbackInfo callbackInfoSynthWavetablePosition = {
  static_cast<uint8_t>(SettingKey::SynthWavetablePosition),
  reinterpret_cast<void*>(&synthWavetablePosition),
  nullptr,
  updateSynthModulationParams
};
GEMItem menuItemSynthWavetablePosition("WT Pos", synthWavetablePosition, selectWavetablePosition, universalSaveCallback,
                                       reinterpret_cast<void*>(&callbackInfoSynthWavetablePosition));
void previewSynthWavetablePosition(GEMPreviewCallbackData previewData) {
  synthWavetablePosition = previewData.previewValByte;
  updateSynthModulationParams();
}

SelectOptionByte optionByteSynthDrive[] = {
  { "Off", SYNTH_DRIVE_OFF },
  { "Warm", SYNTH_DRIVE_WARM },
  { "Edge", SYNTH_DRIVE_EDGE },
  { "Dirty", SYNTH_DRIVE_DIRTY }
};
GEMSelect selectSynthDrive(sizeof(optionByteSynthDrive) / sizeof(SelectOptionByte), optionByteSynthDrive);
PersistentCallbackInfo callbackInfoSynthDrive = {
  static_cast<uint8_t>(SettingKey::SynthDrive),
  reinterpret_cast<void*>(&synthDrive),
  nullptr,
  nullptr
};
GEMItem menuItemSynthDrive("Drive", synthDrive, selectSynthDrive, universalSaveCallback,
                           reinterpret_cast<void*>(&callbackInfoSynthDrive));
void previewSynthDrive(GEMPreviewCallbackData previewData) {
  synthDrive = previewData.previewValByte;
}

SelectOptionByte optionByteSynthModTarget[] = {
  { "Vibrato", SYNTH_MOD_TARGET_VIBRATO },
  { "Pitch", SYNTH_MOD_TARGET_PITCH },
  { "WT Pos", SYNTH_MOD_TARGET_WAVETABLE_POSITION },
  { "FoldWrp", SYNTH_MOD_TARGET_FOLD_WARP },
  { "DutyWrp", SYNTH_MOD_TARGET_DUTY_WARP },
  { "PolyWrp", SYNTH_MOD_TARGET_POLY_WARP }
};
GEMSelect selectSynthModTarget(sizeof(optionByteSynthModTarget) / sizeof(SelectOptionByte), optionByteSynthModTarget);
PersistentCallbackInfo callbackInfoSynthModTarget = {
  static_cast<uint8_t>(SettingKey::SynthModTarget),
  reinterpret_cast<void*>(&synthModTarget),
  nullptr,
  updateSynthModulationParams
};
GEMItem menuItemSynthModTarget("Wheel FX", synthModTarget, selectSynthModTarget, universalSaveCallback,
                               reinterpret_cast<void*>(&callbackInfoSynthModTarget));
void previewSynthModTarget(GEMPreviewCallbackData previewData) {
  synthModTarget = previewData.previewValByte;
  updateSynthModulationParams();
}

SelectOptionByte optionByteSynthModAmount[] = {
  { "Off", 0 },
  { "5%", 6 },
  { "10%", 13 },
  { "17%", 21 },
  { "25%", 32 },
  { "33%", 42 },
  { "42%", 53 },
  { "50%", 64 },
  { "58%", 74 },
  { "67%", 85 },
  { "75%", 95 },
  { "83%", 106 },
  { "92%", 116 },
  { "100%", SYNTH_MOD_AMOUNT_FULL }
};
GEMSelect selectSynthModAmount(sizeof(optionByteSynthModAmount) / sizeof(SelectOptionByte), optionByteSynthModAmount);
PersistentCallbackInfo callbackInfoSynthModAmount = {
  static_cast<uint8_t>(SettingKey::SynthModAmount),
  reinterpret_cast<void*>(&synthModAmount),
  nullptr,
  updateSynthModulationParams
};
GEMItem menuItemSynthModAmount("Wheel Amt", synthModAmount, selectSynthModAmount, universalSaveCallback,
                               reinterpret_cast<void*>(&callbackInfoSynthModAmount));
void previewSynthModAmount(GEMPreviewCallbackData previewData) {
  synthModAmount = previewData.previewValByte;
  updateSynthModulationParams();
}

SelectOptionByte optionByteSynthVibratoSpeed[] = {
  { "1 Hz", 0 },
  { "2 Hz", 1 },
  { "3 Hz", 2 },
  { "4 Hz", 3 },
  { "5 Hz", 4 },
  { "6 Hz", 5 },
  { "7 Hz", 6 },
  { "8 Hz", 7 },
  { "9 Hz", 8 },
  { "10 Hz", 9 },
  { "11 Hz", 10 },
  { "12 Hz", 11 },
  { "Noise", SYNTH_VIBRATO_SPEED_NOISE }
};
GEMSelect selectSynthVibratoSpeed(sizeof(optionByteSynthVibratoSpeed) / sizeof(SelectOptionByte), optionByteSynthVibratoSpeed);
PersistentCallbackInfo callbackInfoSynthVibratoSpeed = {
  static_cast<uint8_t>(SettingKey::SynthVibratoSpeed),
  reinterpret_cast<void*>(&synthVibratoSpeed),
  nullptr,
  updateSynthModulationParams
};
GEMItem menuItemSynthVibratoSpeed("Vib Speed", synthVibratoSpeed, selectSynthVibratoSpeed, universalSaveCallback,
                                  reinterpret_cast<void*>(&callbackInfoSynthVibratoSpeed));
void previewSynthVibratoSpeed(GEMPreviewCallbackData previewData) {
  synthVibratoSpeed = previewData.previewValByte;
  updateSynthModulationParams();
}

SelectOptionByte optionByteSynthLfoWave[] = {
  { "Sine", SYNTH_LFO_WAVE_SINE },
  { "Triangl", SYNTH_LFO_WAVE_TRIANGLE },
  { "Saw", SYNTH_LFO_WAVE_SAW },
  { "Square", SYNTH_LFO_WAVE_SQUARE },
  { "Noise", SYNTH_LFO_WAVE_NOISE },
  { "Smooth", SYNTH_LFO_WAVE_SMOOTH_NOISE }
};
GEMSelect selectSynthLfoWave(sizeof(optionByteSynthLfoWave) / sizeof(SelectOptionByte), optionByteSynthLfoWave);

SelectOptionByte optionByteSynthLfoSpeed[] = {
  { "0.05Hz", 0 },
  { "0.1Hz", 1 },
  { "0.2Hz", 2 },
  { "0.33Hz", 3 },
  { "0.5Hz", 4 },
  { "0.75Hz", 5 },
  { "1 Hz", 6 },
  { "1.25Hz", 7 },
  { "1.5Hz", 8 },
  { "2 Hz", 9 },
  { "2.5Hz", 10 },
  { "3 Hz", 11 },
  { "4 Hz", 12 },
  { "5 Hz", 13 },
  { "6 Hz", 14 },
  { "8 Hz", 15 },
  { "10 Hz", 16 },
  { "12 Hz", 17 },
  { "16 Hz", 18 },
  { "20 Hz", 19 }
};
GEMSelect selectSynthLfoSpeed(sizeof(optionByteSynthLfoSpeed) / sizeof(SelectOptionByte), optionByteSynthLfoSpeed);

PersistentCallbackInfo callbackInfoSynthLfoTarget = {
  static_cast<uint8_t>(SettingKey::SynthLfoTarget),
  reinterpret_cast<void*>(&synthLfoTarget),
  nullptr,
  updateSynthModulationParams
};
PersistentCallbackInfo callbackInfoSynthLfoAmount = {
  static_cast<uint8_t>(SettingKey::SynthLfoAmount),
  reinterpret_cast<void*>(&synthLfoAmount),
  nullptr,
  updateSynthModulationParams
};
PersistentCallbackInfo callbackInfoSynthLfoWave = {
  static_cast<uint8_t>(SettingKey::SynthLfoWave),
  reinterpret_cast<void*>(&synthLfoWave),
  nullptr,
  updateSynthModulationParams
};
PersistentCallbackInfo callbackInfoSynthLfoSpeed = {
  static_cast<uint8_t>(SettingKey::SynthLfoSpeed),
  reinterpret_cast<void*>(&synthLfoSpeed),
  nullptr,
  updateSynthModulationParams
};
GEMItem menuItemSynthLfoTarget("Target", synthLfoTarget, selectSynthModTarget, universalSaveCallback,
                               reinterpret_cast<void*>(&callbackInfoSynthLfoTarget));
void previewSynthLfoTarget(GEMPreviewCallbackData previewData) {
  synthLfoTarget = previewData.previewValByte;
  updateSynthModulationParams();
}
GEMItem menuItemSynthLfoWave("Wave", synthLfoWave, selectSynthLfoWave, universalSaveCallback,
                             reinterpret_cast<void*>(&callbackInfoSynthLfoWave));
void previewSynthLfoWave(GEMPreviewCallbackData previewData) {
  synthLfoWave = previewData.previewValByte;
  updateSynthModulationParams();
}
GEMItem menuItemSynthLfoSpeed("Speed", synthLfoSpeed, selectSynthLfoSpeed, universalSaveCallback,
                              reinterpret_cast<void*>(&callbackInfoSynthLfoSpeed));
void previewSynthLfoSpeed(GEMPreviewCallbackData previewData) {
  synthLfoSpeed = previewData.previewValByte;
  updateSynthModulationParams();
}

PersistentCallbackInfo callbackInfoSynthBPM = {
  static_cast<uint8_t>(SettingKey::SynthBPM),
  reinterpret_cast<void*>(&synthBPM),
  nullptr,
  updateArpeggiatorTiming
};
GEMItem menuItemSynthBPM("Tempo", synthBPM, spinnerSynthBPM, universalSaveCallback,
                         reinterpret_cast<void*>(&callbackInfoSynthBPM));
void previewSynthBPM(GEMPreviewCallbackData previewData) {
  synthBPM = previewData.previewValByte;
  updateArpeggiatorTiming();
}

SelectOptionByte optionByteMetronomeMode[] = {
  { "Off", METRONOME_MODE_OFF },
  { "Beep", METRONOME_MODE_BEEP },
  { "Bright", METRONOME_MODE_BRIGHTNESS },
  { "Side Btns", METRONOME_MODE_SIDE_BUTTONS }
};
GEMSelect selectMetronomeMode(sizeof(optionByteMetronomeMode) / sizeof(SelectOptionByte), optionByteMetronomeMode);
PersistentCallbackInfo callbackInfoMetronomeMode = {
  static_cast<uint8_t>(SettingKey::MetronomeMode),
  reinterpret_cast<void*>(&metronomeMode),
  nullptr,
  metronomeModeChanged
};
GEMItem menuItemMetronomeMode("Metronome", metronomeMode, selectMetronomeMode, universalSaveCallback,
                              reinterpret_cast<void*>(&callbackInfoMetronomeMode));
void previewMetronomeMode(GEMPreviewCallbackData previewData) {
  metronomeMode = previewData.previewValByte;
  metronomeModeChanged();
}

SelectOptionByte optionByteMetronomeSignature[] = {
  { "4/4", 0 },
  { "3/4", 1 },
  { "2/4", 2 },
  { "6/8", 3 },
  { "5/4", 4 },
  { "7/8", 5 },
  { "12/8", 6 }
};
GEMSelect selectMetronomeSignature(sizeof(optionByteMetronomeSignature) / sizeof(SelectOptionByte), optionByteMetronomeSignature);
PersistentCallbackInfo callbackInfoMetronomeSignature = {
  static_cast<uint8_t>(SettingKey::MetronomeSignature),
  reinterpret_cast<void*>(&metronomeSignatureIndex),
  nullptr,
  updateMetronomeTiming
};
GEMItem menuItemMetronomeSignature("Time Sig", metronomeSignatureIndex, selectMetronomeSignature, universalSaveCallback,
                                   reinterpret_cast<void*>(&callbackInfoMetronomeSignature));
void previewMetronomeSignature(GEMPreviewCallbackData previewData) {
  metronomeSignatureIndex = previewData.previewValByte;
  updateMetronomeTiming();
}

SelectOptionByte optionByteArpSpeed[] = {
  { "1/2", 2 },
  { "1/3", 3 },
  { "1/4", 4 },
  { "1/6", 6 },
  { "1/8", 8 },
  { "1/12", 12 },
  { "1/16", 16 },
  { "1/24", 24 },
  { "1/32", 32 }
};
GEMSelect selectArpSpeed(sizeof(optionByteArpSpeed) / sizeof(SelectOptionByte), optionByteArpSpeed);
PersistentCallbackInfo callbackInfoArpSpeed = {
  static_cast<uint8_t>(SettingKey::ArpeggiatorDivision),
  reinterpret_cast<void*>(&arpeggiatorDivision),
  nullptr,
  updateArpeggiatorTiming
};
GEMItem menuItemArpSpeed("Arp Speed", arpeggiatorDivision, selectArpSpeed, universalSaveCallback,
                         reinterpret_cast<void*>(&callbackInfoArpSpeed));
void previewArpSpeed(GEMPreviewCallbackData previewData) {
  arpeggiatorDivision = previewData.previewValByte;
  updateArpeggiatorTiming();
}

SelectOptionByte optionByteArpDirection[] = {
  { "Up", ARP_DIRECTION_UP },
  { "Down", ARP_DIRECTION_DOWN },
  { "Played", ARP_DIRECTION_ORDER_PLAYED },
  { "RevPlay", ARP_DIRECTION_REVERSE_PLAYED },
  { "UpDown", ARP_DIRECTION_UP_DOWN },
  { "DownUp", ARP_DIRECTION_DOWN_UP },
  { "Random", ARP_DIRECTION_RANDOM }
};
GEMSelect selectArpDirection(sizeof(optionByteArpDirection) / sizeof(SelectOptionByte), optionByteArpDirection);
PersistentCallbackInfo callbackInfoArpDirection = {
  static_cast<uint8_t>(SettingKey::ArpeggiatorDirection),
  reinterpret_cast<void*>(&arpeggiatorDirection),
  nullptr,
  updateArpeggiatorDirection
};
GEMItem menuItemArpDirection("Arp Dir", arpeggiatorDirection, selectArpDirection, universalSaveCallback,
                             reinterpret_cast<void*>(&callbackInfoArpDirection));
void previewArpDirection(GEMPreviewCallbackData previewData) {
  arpeggiatorDirection = previewData.previewValByte;
  updateArpeggiatorDirection();
}

SelectOptionByte optionByteEnvelopeTimes[] = {
  { "0 ms", 0 },
  { "5 ms", 1 },
  { "10 ms", 2 },
  { "15 ms", 3 },
  { "20 ms", 4 },
  { "30 ms", 5 },
  { "50 ms", 6 },
  { "75 ms", 7 },
  { "100 ms", 8 },
  { "150 ms", 9 },
  { "200 ms", 10 },
  { "300 ms", 11 },
  { "500 ms", 12 },
  { "750 ms", 13 },
  { "1 s", 14 },
  { "1.5 s", 15 },
  { "2 s", 16 },
  { "2.5 s", 17 },
  { "3 s", 18 },
  { "4 s", 19 }
};
SelectOptionByte optionByteSustain[] = {
  { "0%", 0 },
  { "10%", 13 },
  { "25%", 32 },
  { "50%", 64 },
  { "75%", 96 },
  { "100%", 127 }
};

GEMSelect selectEnvelopeAttack(sizeof(optionByteEnvelopeTimes) / sizeof(SelectOptionByte), optionByteEnvelopeTimes);
GEMSelect selectEnvelopeHold(sizeof(optionByteEnvelopeTimes) / sizeof(SelectOptionByte), optionByteEnvelopeTimes);
GEMSelect selectEnvelopeDecay(sizeof(optionByteEnvelopeTimes) / sizeof(SelectOptionByte), optionByteEnvelopeTimes);
GEMSelect selectEnvelopeRelease(sizeof(optionByteEnvelopeTimes) / sizeof(SelectOptionByte), optionByteEnvelopeTimes);
GEMSelect selectPortamentoTime(sizeof(optionByteEnvelopeTimes) / sizeof(SelectOptionByte), optionByteEnvelopeTimes);
GEMSelect selectEnvelopeSustain(sizeof(optionByteSustain) / sizeof(SelectOptionByte), optionByteSustain);

PersistentCallbackInfo callbackInfoPortamentoTime = {
  static_cast<uint8_t>(SettingKey::SynthPortamentoTimeIndex),
  reinterpret_cast<void*>(&synthPortamentoTimeIndex),
  nullptr,
  updateSynthPortamentoSettings
};

PersistentCallbackInfo callbackInfoEnvelopeAttack = {
  static_cast<uint8_t>(SettingKey::EnvelopeAttackIndex),
  reinterpret_cast<void*>(&envelopeAttackIndex),
  nullptr,
  updateEnvelopeParamsFromSettings
};
PersistentCallbackInfo callbackInfoEnvelopeHold = {
  static_cast<uint8_t>(SettingKey::EnvelopeHoldIndex),
  reinterpret_cast<void*>(&envelopeHoldIndex),
  nullptr,
  updateEnvelopeParamsFromSettings
};
PersistentCallbackInfo callbackInfoEnvelopeDecay = {
  static_cast<uint8_t>(SettingKey::EnvelopeDecayIndex),
  reinterpret_cast<void*>(&envelopeDecayIndex),
  nullptr,
  updateEnvelopeParamsFromSettings
};
PersistentCallbackInfo callbackInfoEnvelopeSustain = {
  static_cast<uint8_t>(SettingKey::EnvelopeSustainLevel),
  reinterpret_cast<void*>(&envelopeSustainLevel),
  nullptr,
  updateEnvelopeParamsFromSettings
};
PersistentCallbackInfo callbackInfoEnvelopeRelease = {
  static_cast<uint8_t>(SettingKey::EnvelopeReleaseIndex),
  reinterpret_cast<void*>(&envelopeReleaseIndex),
  nullptr,
  updateEnvelopeParamsFromSettings
};
SelectOptionByte optionByteSynthFxAmount[] = {
  { "-100%", 0 },
  { "-92%", 11 },
  { "-83%", 21 },
  { "-75%", 32 },
  { "-67%", 42 },
  { "-58%", 53 },
  { "-50%", 64 },
  { "-42%", 74 },
  { "-33%", 85 },
  { "-25%", 95 },
  { "-17%", 106 },
  { "-10%", 114 },
  { "-5%", 121 },
  { "-4%", 122 },
  { "-3%", 123 },
  { "-2%", 124 },
  { "-1%", 126 },
  { "Off", SYNTH_FX_AMOUNT_OFF },
  { "+1%", 128 },
  { "+2%", 130 },
  { "+3%", 131 },
  { "+4%", 132 },
  { "+5%", 133 },
  { "+10%", 140 },
  { "+17%", 148 },
  { "+25%", 159 },
  { "+33%", 169 },
  { "+42%", 180 },
  { "+50%", 191 },
  { "+58%", 201 },
  { "+67%", 212 },
  { "+75%", 222 },
  { "+83%", 233 },
  { "+92%", 243 },
  { "+100%", SYNTH_FX_AMOUNT_FULL }
};
GEMSelect selectSynthFxAmount(sizeof(optionByteSynthFxAmount) / sizeof(SelectOptionByte), optionByteSynthFxAmount);

GEMItem menuItemSynthLfoAmount("Amount", synthLfoAmount, selectSynthFxAmount, universalSaveCallback,
                               reinterpret_cast<void*>(&callbackInfoSynthLfoAmount));
void previewSynthLfoAmount(GEMPreviewCallbackData previewData) {
  synthLfoAmount = previewData.previewValByte;
  updateSynthModulationParams();
}

void updateSynthFxEnvelopeSettings() {
  updateSynthModulationParams();
  updateEffectEnvelopeParamsFromSettings();
}

PersistentCallbackInfo callbackInfoEffectEnvelopeTarget = {
  static_cast<uint8_t>(SettingKey::EffectEnvelopeTarget),
  reinterpret_cast<void*>(&effectEnvelopeTarget[0]),
  nullptr,
  updateSynthFxEnvelopeSettings
};
PersistentCallbackInfo callbackInfoEffectEnvelopeAmount = {
  static_cast<uint8_t>(SettingKey::EffectEnvelopeAmount),
  reinterpret_cast<void*>(&effectEnvelopeAmount[0]),
  nullptr,
  updateSynthFxEnvelopeSettings
};
PersistentCallbackInfo callbackInfoEffectEnvelopeAttack = {
  static_cast<uint8_t>(SettingKey::EffectEnvelopeAttackIndex),
  reinterpret_cast<void*>(&effectEnvelopeAttackIndex[0]),
  nullptr,
  updateEffectEnvelopeParamsFromSettings
};
PersistentCallbackInfo callbackInfoEffectEnvelopeHold = {
  static_cast<uint8_t>(SettingKey::EffectEnvelopeHoldIndex),
  reinterpret_cast<void*>(&effectEnvelopeHoldIndex[0]),
  nullptr,
  updateEffectEnvelopeParamsFromSettings
};
PersistentCallbackInfo callbackInfoEffectEnvelopeDecay = {
  static_cast<uint8_t>(SettingKey::EffectEnvelopeDecayIndex),
  reinterpret_cast<void*>(&effectEnvelopeDecayIndex[0]),
  nullptr,
  updateEffectEnvelopeParamsFromSettings
};
PersistentCallbackInfo callbackInfoEffectEnvelopeSustain = {
  static_cast<uint8_t>(SettingKey::EffectEnvelopeSustainLevel),
  reinterpret_cast<void*>(&effectEnvelopeSustainLevel[0]),
  nullptr,
  updateEffectEnvelopeParamsFromSettings
};
PersistentCallbackInfo callbackInfoEffectEnvelopeRelease = {
  static_cast<uint8_t>(SettingKey::EffectEnvelopeReleaseIndex),
  reinterpret_cast<void*>(&effectEnvelopeReleaseIndex[0]),
  nullptr,
  updateEffectEnvelopeParamsFromSettings
};
PersistentCallbackInfo callbackInfoEffectEnvelope2Target = {
  static_cast<uint8_t>(SettingKey::EffectEnvelope2Target),
  reinterpret_cast<void*>(&effectEnvelopeTarget[1]),
  nullptr,
  updateSynthFxEnvelopeSettings
};
PersistentCallbackInfo callbackInfoEffectEnvelope2Amount = {
  static_cast<uint8_t>(SettingKey::EffectEnvelope2Amount),
  reinterpret_cast<void*>(&effectEnvelopeAmount[1]),
  nullptr,
  updateSynthFxEnvelopeSettings
};
PersistentCallbackInfo callbackInfoEffectEnvelope2Attack = {
  static_cast<uint8_t>(SettingKey::EffectEnvelope2AttackIndex),
  reinterpret_cast<void*>(&effectEnvelopeAttackIndex[1]),
  nullptr,
  updateEffectEnvelopeParamsFromSettings
};
PersistentCallbackInfo callbackInfoEffectEnvelope2Hold = {
  static_cast<uint8_t>(SettingKey::EffectEnvelope2HoldIndex),
  reinterpret_cast<void*>(&effectEnvelopeHoldIndex[1]),
  nullptr,
  updateEffectEnvelopeParamsFromSettings
};
PersistentCallbackInfo callbackInfoEffectEnvelope2Decay = {
  static_cast<uint8_t>(SettingKey::EffectEnvelope2DecayIndex),
  reinterpret_cast<void*>(&effectEnvelopeDecayIndex[1]),
  nullptr,
  updateEffectEnvelopeParamsFromSettings
};
PersistentCallbackInfo callbackInfoEffectEnvelope2Sustain = {
  static_cast<uint8_t>(SettingKey::EffectEnvelope2SustainLevel),
  reinterpret_cast<void*>(&effectEnvelopeSustainLevel[1]),
  nullptr,
  updateEffectEnvelopeParamsFromSettings
};
PersistentCallbackInfo callbackInfoEffectEnvelope2Release = {
  static_cast<uint8_t>(SettingKey::EffectEnvelope2ReleaseIndex),
  reinterpret_cast<void*>(&effectEnvelopeReleaseIndex[1]),
  nullptr,
  updateEffectEnvelopeParamsFromSettings
};

GEMItem menuItemPortamentoTime("Porta", synthPortamentoTimeIndex, selectPortamentoTime, universalSaveCallback,
                               reinterpret_cast<void*>(&callbackInfoPortamentoTime));
void previewPortamentoTime(GEMPreviewCallbackData previewData) {
  synthPortamentoTimeIndex = previewData.previewValByte;
  updateSynthPortamentoSettings();
}

GEMItem menuItemEnvelopeAttack("Attack", envelopeAttackIndex, selectEnvelopeAttack, universalSaveCallback,
                               reinterpret_cast<void*>(&callbackInfoEnvelopeAttack));
void previewEnvelopeAttack(GEMPreviewCallbackData previewData) {
  envelopeAttackIndex = previewData.previewValByte;
  updateEnvelopeParamsFromSettings();
}
GEMItem menuItemEnvelopeHold("Hold", envelopeHoldIndex, selectEnvelopeHold, universalSaveCallback,
                             reinterpret_cast<void*>(&callbackInfoEnvelopeHold));
void previewEnvelopeHold(GEMPreviewCallbackData previewData) {
  envelopeHoldIndex = previewData.previewValByte;
  updateEnvelopeParamsFromSettings();
}
GEMItem menuItemEnvelopeDecay("Decay", envelopeDecayIndex, selectEnvelopeDecay, universalSaveCallback,
                              reinterpret_cast<void*>(&callbackInfoEnvelopeDecay));
void previewEnvelopeDecay(GEMPreviewCallbackData previewData) {
  envelopeDecayIndex = previewData.previewValByte;
  updateEnvelopeParamsFromSettings();
}
GEMItem menuItemEnvelopeSustain("Sustain", envelopeSustainLevel, selectEnvelopeSustain, universalSaveCallback,
                                reinterpret_cast<void*>(&callbackInfoEnvelopeSustain));
void previewEnvelopeSustain(GEMPreviewCallbackData previewData) {
  envelopeSustainLevel = previewData.previewValByte;
  updateEnvelopeParamsFromSettings();
}
GEMItem menuItemEnvelopeRelease("Release", envelopeReleaseIndex, selectEnvelopeRelease, universalSaveCallback,
                                reinterpret_cast<void*>(&callbackInfoEnvelopeRelease));
void previewEnvelopeRelease(GEMPreviewCallbackData previewData) {
  envelopeReleaseIndex = previewData.previewValByte;
  updateEnvelopeParamsFromSettings();
}
GEMItem menuItemEffectEnvelopeTarget("Target", effectEnvelopeTarget[0], selectSynthModTarget, universalSaveCallback,
                                     reinterpret_cast<void*>(&callbackInfoEffectEnvelopeTarget));
void previewEffectEnvelopeTarget(GEMPreviewCallbackData previewData) {
  effectEnvelopeTarget[0] = previewData.previewValByte;
  updateSynthFxEnvelopeSettings();
}
GEMItem menuItemEffectEnvelopeAmount("Amount", effectEnvelopeAmount[0], selectSynthFxAmount, universalSaveCallback,
                                     reinterpret_cast<void*>(&callbackInfoEffectEnvelopeAmount));
void previewEffectEnvelopeAmount(GEMPreviewCallbackData previewData) {
  effectEnvelopeAmount[0] = previewData.previewValByte;
  updateSynthFxEnvelopeSettings();
}
GEMItem menuItemEffectEnvelopeAttack("Attack", effectEnvelopeAttackIndex[0], selectEnvelopeAttack, universalSaveCallback,
                                     reinterpret_cast<void*>(&callbackInfoEffectEnvelopeAttack));
void previewEffectEnvelopeAttack(GEMPreviewCallbackData previewData) {
  effectEnvelopeAttackIndex[0] = previewData.previewValByte;
  updateEffectEnvelopeParamsFromSettings();
}
GEMItem menuItemEffectEnvelopeHold("Hold", effectEnvelopeHoldIndex[0], selectEnvelopeHold, universalSaveCallback,
                                   reinterpret_cast<void*>(&callbackInfoEffectEnvelopeHold));
void previewEffectEnvelopeHold(GEMPreviewCallbackData previewData) {
  effectEnvelopeHoldIndex[0] = previewData.previewValByte;
  updateEffectEnvelopeParamsFromSettings();
}
GEMItem menuItemEffectEnvelopeDecay("Decay", effectEnvelopeDecayIndex[0], selectEnvelopeDecay, universalSaveCallback,
                                    reinterpret_cast<void*>(&callbackInfoEffectEnvelopeDecay));
void previewEffectEnvelopeDecay(GEMPreviewCallbackData previewData) {
  effectEnvelopeDecayIndex[0] = previewData.previewValByte;
  updateEffectEnvelopeParamsFromSettings();
}
GEMItem menuItemEffectEnvelopeSustain("Sustain", effectEnvelopeSustainLevel[0], selectEnvelopeSustain, universalSaveCallback,
                                      reinterpret_cast<void*>(&callbackInfoEffectEnvelopeSustain));
void previewEffectEnvelopeSustain(GEMPreviewCallbackData previewData) {
  effectEnvelopeSustainLevel[0] = previewData.previewValByte;
  updateEffectEnvelopeParamsFromSettings();
}
GEMItem menuItemEffectEnvelopeRelease("Release", effectEnvelopeReleaseIndex[0], selectEnvelopeRelease, universalSaveCallback,
                                      reinterpret_cast<void*>(&callbackInfoEffectEnvelopeRelease));
void previewEffectEnvelopeRelease(GEMPreviewCallbackData previewData) {
  effectEnvelopeReleaseIndex[0] = previewData.previewValByte;
  updateEffectEnvelopeParamsFromSettings();
}
GEMItem menuItemEffectEnvelope2Target("Target", effectEnvelopeTarget[1], selectSynthModTarget, universalSaveCallback,
                                      reinterpret_cast<void*>(&callbackInfoEffectEnvelope2Target));
void previewEffectEnvelope2Target(GEMPreviewCallbackData previewData) {
  effectEnvelopeTarget[1] = previewData.previewValByte;
  updateSynthFxEnvelopeSettings();
}
GEMItem menuItemEffectEnvelope2Amount("Amount", effectEnvelopeAmount[1], selectSynthFxAmount, universalSaveCallback,
                                      reinterpret_cast<void*>(&callbackInfoEffectEnvelope2Amount));
void previewEffectEnvelope2Amount(GEMPreviewCallbackData previewData) {
  effectEnvelopeAmount[1] = previewData.previewValByte;
  updateSynthFxEnvelopeSettings();
}
GEMItem menuItemEffectEnvelope2Attack("Attack", effectEnvelopeAttackIndex[1], selectEnvelopeAttack, universalSaveCallback,
                                      reinterpret_cast<void*>(&callbackInfoEffectEnvelope2Attack));
void previewEffectEnvelope2Attack(GEMPreviewCallbackData previewData) {
  effectEnvelopeAttackIndex[1] = previewData.previewValByte;
  updateEffectEnvelopeParamsFromSettings();
}
GEMItem menuItemEffectEnvelope2Hold("Hold", effectEnvelopeHoldIndex[1], selectEnvelopeHold, universalSaveCallback,
                                    reinterpret_cast<void*>(&callbackInfoEffectEnvelope2Hold));
void previewEffectEnvelope2Hold(GEMPreviewCallbackData previewData) {
  effectEnvelopeHoldIndex[1] = previewData.previewValByte;
  updateEffectEnvelopeParamsFromSettings();
}
GEMItem menuItemEffectEnvelope2Decay("Decay", effectEnvelopeDecayIndex[1], selectEnvelopeDecay, universalSaveCallback,
                                     reinterpret_cast<void*>(&callbackInfoEffectEnvelope2Decay));
void previewEffectEnvelope2Decay(GEMPreviewCallbackData previewData) {
  effectEnvelopeDecayIndex[1] = previewData.previewValByte;
  updateEffectEnvelopeParamsFromSettings();
}
GEMItem menuItemEffectEnvelope2Sustain("Sustain", effectEnvelopeSustainLevel[1], selectEnvelopeSustain, universalSaveCallback,
                                       reinterpret_cast<void*>(&callbackInfoEffectEnvelope2Sustain));
void previewEffectEnvelope2Sustain(GEMPreviewCallbackData previewData) {
  effectEnvelopeSustainLevel[1] = previewData.previewValByte;
  updateEffectEnvelopeParamsFromSettings();
}
GEMItem menuItemEffectEnvelope2Release("Release", effectEnvelopeReleaseIndex[1], selectEnvelopeRelease, universalSaveCallback,
                                       reinterpret_cast<void*>(&callbackInfoEffectEnvelope2Release));
void previewEffectEnvelope2Release(GEMPreviewCallbackData previewData) {
  effectEnvelopeReleaseIndex[1] = previewData.previewValByte;
  updateEffectEnvelopeParamsFromSettings();
}

SelectOptionInt optionIntModWheel[] = { { "TooSlow", 0 }, { "Turtle", 1 }, { "Slow", 2 }, { "Medium", 4 }, { "Fast", 8 }, { "Cheetah", 16 }, { "VeryFast", 32 }, { "Instant", 127 } };
GEMSelect selectModSpeed(sizeof(optionIntModWheel) / sizeof(SelectOptionInt), optionIntModWheel);
PersistentCallbackInfo callbackInfoModSpeed = {
  static_cast<uint8_t>(SettingKey::ModWheelSpeed),
  reinterpret_cast<void*>(&modWheelSpeed),
  nullptr,
  nullptr
};
GEMItem menuItemModSpeed("Mod Wheel", modWheelSpeed, selectModSpeed, universalSaveCallback,
                         reinterpret_cast<void*>(&callbackInfoModSpeed));
void previewModSpeed(GEMPreviewCallbackData previewData) {
  modWheelSpeed = previewData.previewValInt;
}

PersistentCallbackInfo callbackInfoVelSpeed = {
  static_cast<uint8_t>(SettingKey::VelWheelSpeed),
  reinterpret_cast<void*>(&velWheelSpeed),
  nullptr,
  nullptr
};
GEMItem menuItemVelSpeed("Vel Wheel", velWheelSpeed, selectModSpeed, universalSaveCallback,
                         reinterpret_cast<void*>(&callbackInfoVelSpeed));
void previewVelSpeed(GEMPreviewCallbackData previewData) {
  velWheelSpeed = previewData.previewValInt;
}

SelectOptionInt optionIntPBWheel[] = { { "TooSlow", 64 }, { "Turtle", 128 }, { "Slow", 256 }, { "Medium", 512 }, { "Fast", 1024 }, { "Cheetah", 2048 }, { "VeryFast", 4096 }, { "Instant", 16384 } };
GEMSelect selectPBSpeed(sizeof(optionIntPBWheel) / sizeof(SelectOptionInt), optionIntPBWheel);
PersistentCallbackInfo callbackInfoPBSpeed = {
  static_cast<uint8_t>(SettingKey::PBWheelSpeed),
  reinterpret_cast<void*>(&pbWheelSpeed),
  encodePbWheelSpeed,
  nullptr
};
GEMItem menuItemPBSpeed("PB Wheel", pbWheelSpeed, selectPBSpeed, universalSaveCallback,
                        reinterpret_cast<void*>(&callbackInfoPBSpeed));
void previewPBSpeed(GEMPreviewCallbackData previewData) {
  pbWheelSpeed = previewData.previewValInt;
}

void updateSynthMenuVisibility() {
  menuItemPortamentoTime.hide(!isMonoPlaybackMode(playbackMode));
  bool arpSelected = playbackMode == SYNTH_ARPEGGIO;
  menuItemArpSpeed.hide(!arpSelected);
  menuItemArpDirection.hide(!arpSelected);
}

void playbackModeChanged() {
  playbackMode = normalizeSynthPlaybackMode(playbackMode);
  resetSynthFreqs();
  updateSynthMenuVisibility();
}

void updateEditorMenuVisibility() {
  byte currentIndex = menuPageEditor.getCurrentMenuItemIndex();

  menuItemSelectDynamicJIRatioTable.hide(!useDynamicJustIntonation);
  menuItemSetJI_BPM.hide(!useJustIntonationBPM);
  menuItemSetJI_BPM_Multiplier.hide(!useJustIntonationBPM);

  byte itemCount = menuPageEditor.getItemsCount();
  if (itemCount > 0) {
    if (currentIndex >= itemCount) {
      currentIndex = itemCount - 1;
    }
    menuPageEditor.setCurrentMenuItemIndex(currentIndex);
  }
}

void tuningIntonationModeChanged() {
  updateEditorMenuVisibility();
  refreshMidiRouting();
}

byte normalizeDynamicJIRatioTable(byte value) {
  switch (value) {
    case DYNAMIC_JI_RATIO_TABLE_3_LIMIT:
    case DYNAMIC_JI_RATIO_TABLE_5_LIMIT:
    case DYNAMIC_JI_RATIO_TABLE_7_LIMIT:
    case DYNAMIC_JI_RATIO_TABLE_11_LIMIT:
    case DYNAMIC_JI_RATIO_TABLE_13_LIMIT:
    case DYNAMIC_JI_RATIO_TABLE_17_LIMIT:
    case DYNAMIC_JI_RATIO_TABLE_19_LIMIT:
    case DYNAMIC_JI_RATIO_TABLE_23_LIMIT:
    case DYNAMIC_JI_RATIO_TABLE_29_LIMIT:
    case DYNAMIC_JI_RATIO_TABLE_31_LIMIT:
    case DYNAMIC_JI_RATIO_TABLE_37_LIMIT:
    case DYNAMIC_JI_RATIO_TABLE_41_LIMIT:
      return value;
    default:
      return DYNAMIC_JI_RATIO_TABLE_41_LIMIT;
  }
}

void applyGeometryRuntimeFromStorage() {
  int savedKeyStepsFromA = current.keyStepsFromA;
  if (!loadGeometryRuntimeForProfile(activeProfileIndex)) {
    clearUserGeometryRuntimeSelection();
    return;
  }
  current.keyStepsFromA = savedKeyStepsFromA;
  applyScale();
}

void syncSettingsToRuntime() {
  rotaryInvertPreference = settingEnabled(SettingKey::RotaryInvert);
  updateEffectiveRotaryInvert();
  autoSave = settingEnabled(SettingKey::AutoSave);
  MPEpitchBendSemis = settingValue(SettingKey::MPEpitchBend);
  mpeUserMode = settingValue(SettingKey::MPEMode);
  if (mpeUserMode > MPE_MODE_FORCE) {
    mpeUserMode = MPE_MODE_AUTO;
  }
  extraMPE = settingEnabled(SettingKey::ExtraMPE);
  mpeLowestChannel = settingValue(SettingKey::MPELowestChannel);
  mpeHighestChannel = settingValue(SettingKey::MPEHighestChannel);
  mpeLowPriorityMode = settingEnabled(SettingKey::MPELowPriority);
  clampMPEChannelRange();
  defaultMidiChannel = settingValue(SettingKey::DefaultMIDIChannel);
  if (!isValidMidiChannel(defaultMidiChannel)) {
    defaultMidiChannel = MIDI_CHANNEL_MIN;
  }
  CC74value = settingValue(SettingKey::CC74Value);
  current.tuningIndex = settingValue(SettingKey::CurrentTuning);
  current.layoutIndex = settingValue(SettingKey::CurrentLayout);
  current.scaleIndex = settingValue(SettingKey::CurrentScale);
  if (current.tuningIndex >= TUNINGCOUNT) {
    current.tuningIndex = TUNING_12EDO;
  }
  if (current.layoutIndex >= layoutCount) {
    current.layoutIndex = 0;
  }
  if (current.scaleIndex >= scaleCount) {
    current.scaleIndex = 0;
  }
  transposeSteps = decodeBiasedSetting(SettingKey::CurrentTransposeSteps);
  current.transpose = transposeSteps;
  current.keyStepsFromA = loadCurrentKeyStepsFromSettings();
  layoutRotation = settingValue(SettingKey::LayoutRotation) % 6;
  deviceRotation = settingValue(SettingKey::DeviceRotation) % 4;
  mirrorLeftRight = settingEnabled(SettingKey::MirrorLeftRight);
  mirrorUpDown = settingEnabled(SettingKey::MirrorUpDown);
  scaleLock = settingEnabled(SettingKey::ScaleLock);
  perceptual = true;
  paletteBeginsAtKeyCenter = settingEnabled(SettingKey::PaletteCenterOnKey);
  wheelMode = settingEnabled(SettingKey::WheelAltMode);
  pbSticky = settingEnabled(SettingKey::PBSticky);
  modSticky = settingEnabled(SettingKey::ModSticky);

  {
    uint8_t exponent = settingValue(SettingKey::PBWheelSpeed);
    if (exponent < 6) exponent = 6;
    if (exponent > 14) exponent = 14;
    pbWheelSpeed = 1 << exponent;
  }
  modWheelSpeed = settingValue(SettingKey::ModWheelSpeed);
  if (modWheelSpeed > 127) modWheelSpeed = 127;
  velWheelSpeed = settingValue(SettingKey::VelWheelSpeed);
  if (velWheelSpeed > 127) velWheelSpeed = 127;

  syncSynthSettingsToRuntime();
  synthBuzzerEnabled = decodeStoredBuzzerEnabled(settingValue(SettingKey::AudioDestination));
  syncAudioDestinationToRuntime();
  setHeadphoneVolumeCap(normalizeSynthOutputVolumeCap(settingValue(SettingKey::HeadphoneVolumeCap)));
  setPiezoVolumeCap(normalizeSynthOutputVolumeCap(settingValue(SettingKey::PiezoVolumeCap)));
  settings[static_cast<uint8_t>(SettingKey::HeadphoneVolumeCap)] = headphoneVolumeCap;
  settings[static_cast<uint8_t>(SettingKey::PiezoVolumeCap)] = piezoVolumeCap;
  syncActiveSynthOutputVolumeMenuValue();
  metronomeMode = settingValue(SettingKey::MetronomeMode);
  metronomeSignatureIndex = settingValue(SettingKey::MetronomeSignature);
  colorMode = settingValue(SettingKey::ColorMode);
  ledRestBrightness = settingValue(SettingKey::RestLedBrightness);
  ledDimBrightness = settingValue(SettingKey::DimLedBrightness);
  globalBrightness = settingValue(SettingKey::GlobalBrightness);
  ledCurrentLimitMode = settingValue(SettingKey::LedCurrentLimitMode);
  syncLedCurrentLimit();
  animationType = settingValue(SettingKey::AnimationType);
  programChange = settingValue(SettingKey::ProgramChange);

  useJustIntonationBPM = settingEnabled(SettingKey::JustIntonationBPMSync);
  justIntonationBPM = settingValue(SettingKey::BeatBPM);
  justIntonationBPM_Multiplier = settingValue(SettingKey::BPMMultiplier);
  useDynamicJustIntonation = settingEnabled(SettingKey::DynamicJI);
  dynamicJIRatioTable = normalizeDynamicJIRatioTable(settingValue(SettingKey::DynamicJIRatioTable));
  updateEditorMenuVisibility();
  bootAnimationEnabled = settingEnabled(SettingKey::BootAnimationEnabled);
  noteDisplayMode = normalizeNoteDisplayMode(settingValue(SettingKey::DisplayPlayedNotes));
  settings[static_cast<uint8_t>(SettingKey::DisplayPlayedNotes)] = noteDisplayMode;
  sequencer::applyLightSettingsFromProfile();
  sequencer::applyPlaybackPreferencesFromProfile();

  // Now *apply* them to the engine/UI:
  applyGeometryRuntimeFromStorage();
  refreshMenuChoicesForCurrentTuning();
  rebuildUserGeometryMenuItems();
  rebuildRuntimeStateFromCurrentSelection();
  if (programChange > 0) {
    sendProgramChange();
  }
  menuHome();                    // Refresh main screen to match rotation
}

void updateMainMenuDynamicLabels() {
  snprintf(mainTuningMenuLabel,
           sizeof(mainTuningMenuLabel),
           "Tuning:%s",
           current.tuning().name ? current.tuning().name : "Current");
  snprintf(mainLayoutMenuLabel,
           sizeof(mainLayoutMenuLabel),
           "Layout:%s",
           current.layout().name ? current.layout().name : "Current");
  snprintf(mainScaleMenuLabel,
           sizeof(mainScaleMenuLabel),
           "Scale:%s",
           current.scale().name ? current.scale().name : "Current");
  snprintf(mainSynthPresetMenuLabel,
           sizeof(mainSynthPresetMenuLabel),
           "Synth:%s%s",
           currentSynthPresetRuntimeModified() ? "*" : "",
           currentSynthPresetDisplayName());
  snprintf(synthPresetMenuLabel,
           sizeof(synthPresetMenuLabel),
           "Preset:%s%s",
           currentSynthPresetRuntimeModified() ? "*" : "",
           currentSynthPresetDisplayName());
}

void restoreVirtualListLauncherLabels() {
  updateMainMenuDynamicLabels();
  updateCurrentSynthWavetableMenuLabel();
}

bool virtualListLauncherLabelParts(GEMItem* item,
                                   char*& label,
                                   size_t& labelLength,
                                   const char*& prefix,
                                   const char*& value) {
  label = nullptr;
  labelLength = 0;
  prefix = "";
  value = "";

  if (item == &menuGotoTuning) {
    label = mainTuningMenuLabel;
    labelLength = sizeof(mainTuningMenuLabel);
    prefix = "Tuning:";
    value = current.tuning().name ? current.tuning().name : "Current";
  } else if (item == &menuGotoLayout) {
    label = mainLayoutMenuLabel;
    labelLength = sizeof(mainLayoutMenuLabel);
    prefix = "Layout:";
    value = current.layout().name ? current.layout().name : "Current";
  } else if (item == &menuGotoScales) {
    label = mainScaleMenuLabel;
    labelLength = sizeof(mainScaleMenuLabel);
    prefix = "Scale:";
    value = current.scale().name ? current.scale().name : "Current";
  } else if (item == &menuGotoMainSynthPresetLoad) {
    label = mainSynthPresetMenuLabel;
    labelLength = sizeof(mainSynthPresetMenuLabel);
    prefix = currentSynthPresetRuntimeModified() ? "Synth:*" : "Synth:";
    value = currentSynthPresetDisplayName();
  } else if (item == &menuGotoSynthPresetLoad) {
    label = synthPresetMenuLabel;
    labelLength = sizeof(synthPresetMenuLabel);
    prefix = currentSynthPresetRuntimeModified() ? "Preset:*" : "Preset:";
    value = currentSynthPresetDisplayName();
  } else if (item == &menuGotoSynthWavetableLoad) {
    label = currentSynthWavetableMenuLabel;
    labelLength = sizeof(currentSynthWavetableMenuLabel);
    prefix = "WT:";
    const char* name = loadedSynthWavetableName[0] ? loadedSynthWavetableName : currentSynthWavetableName;
    const char* folder = loadedSynthWavetableFolderPath[0] ? loadedSynthWavetableFolderPath : currentSynthWavetableFolderPath;
    if (!name || !name[0]) {
      name = SYNTH_WAVETABLE_BASIC_NAME;
    }
    if (!folder || !folder[0]
        || strcmp(folder, SYNTH_WAVETABLE_BUILTIN_FOLDER) == 0
        || strcmp(folder, SYNTH_WAVETABLE_ROOT_FOLDER) == 0) {
      snprintf(virtualListLauncherValueBuffer, sizeof(virtualListLauncherValueBuffer), "%s", name);
    } else {
      char folderLabel[SYNTH_WAVETABLE_MENU_LABEL_LENGTH] = {};
      synthPresetFolderLabel(folder, folderLabel, sizeof(folderLabel));
      snprintf(virtualListLauncherValueBuffer,
               sizeof(virtualListLauncherValueBuffer),
               "%s/%s",
               folderLabel,
               name);
    }
    value = virtualListLauncherValueBuffer;
  } else {
    return false;
  }
  return label && labelLength > 0 && value;
}

uint8_t launcherValueWindowLength(const char* prefix) {
  size_t prefixLength = strlen(prefix);
  if (prefixLength >= VIRTUAL_LIST_LAUNCHER_VISIBLE_CHARS) {
    return 0;
  }
  return static_cast<uint8_t>(VIRTUAL_LIST_LAUNCHER_VISIBLE_CHARS - prefixLength);
}

void writeVirtualListLauncherLabel(char* label,
                                   size_t labelLength,
                                   const char* prefix,
                                   const char* value,
                                   uint16_t offset) {
  if (!label || labelLength == 0) {
    return;
  }
  label[0] = '\0';

  uint8_t windowLength = launcherValueWindowLength(prefix);
  if (windowLength == 0) {
    snprintf(label, labelLength, "%.*s", VIRTUAL_LIST_LAUNCHER_VISIBLE_CHARS, prefix);
    return;
  }

  char visibleValue[VIRTUAL_LIST_LAUNCHER_VISIBLE_CHARS + 1] = {};
  size_t valueLength = strlen(value);
  if (valueLength <= windowLength) {
    snprintf(visibleValue, sizeof(visibleValue), "%s", value);
  } else {
    for (uint8_t i = 0; i < windowLength && offset + i < valueLength; ++i) {
      visibleValue[i] = value[offset + i];
    }
    visibleValue[windowLength] = '\0';
  }
  snprintf(label, labelLength, "%s%s", prefix, visibleValue);
}

void resetVirtualListLauncherScrollTracking(bool restoreLabels) {
  if (restoreLabels && virtualListLauncherScrollApplied) {
    restoreVirtualListLauncherLabels();
  }
  virtualListLauncherFocusedPage = nullptr;
  virtualListLauncherFocusedItem = nullptr;
  virtualListLauncherFocusStartMicros = 0;
  virtualListLauncherScrollOffset = 0;
  virtualListLauncherScrollApplied = false;
}

void redrawMenuAfterVirtualListLauncherScroll() {
  menu.drawMenu();
  if (!noteBadgeVisible) {
    noteOverlayDirty = true;
  }
}

void serviceVirtualListLauncherLabelScroll() {
  if (virtualListMenuIsActive()
      || delegatedControlState.active
      || presetSyncTransferActive
      || flashSaveScreenVisible
      || commandWheelOverlayActive()
      || noteBadgeVisible
      || noteOverlayVisible
      || screenSaverOn) {
    resetVirtualListLauncherScrollTracking(true);
    return;
  }

  GEMPage* currentPage = menu.getCurrentMenuPage();
  GEMItem* currentItem = currentPage ? currentPage->getCurrentMenuItem() : nullptr;
  bool focusChanged = currentPage != virtualListLauncherFocusedPage
                      || currentItem != virtualListLauncherFocusedItem;
  bool needsRedraw = false;
  if (focusChanged) {
    if (virtualListLauncherScrollApplied) {
      restoreVirtualListLauncherLabels();
      needsRedraw = true;
    }
    virtualListLauncherFocusedPage = currentPage;
    virtualListLauncherFocusedItem = currentItem;
    virtualListLauncherFocusStartMicros = runTime;
    virtualListLauncherScrollOffset = 0;
    virtualListLauncherScrollApplied = false;
  }

  char* label = nullptr;
  size_t labelLength = 0;
  const char* prefix = "";
  const char* value = "";
  if (!virtualListLauncherLabelParts(currentItem, label, labelLength, prefix, value)) {
    if (needsRedraw) {
      redrawMenuAfterVirtualListLauncherScroll();
    }
    return;
  }

  uint8_t windowLength = launcherValueWindowLength(prefix);
  size_t valueLength = strlen(value);
  if (windowLength == 0 || valueLength <= windowLength) {
    if (needsRedraw) {
      redrawMenuAfterVirtualListLauncherScroll();
    }
    return;
  }

  uint16_t maxOffset = static_cast<uint16_t>(valueLength - windowLength);
  uint64_t scrollDuration = static_cast<uint64_t>(maxOffset) * VIRTUAL_LIST_LAUNCHER_SCROLL_INTERVAL_MICROS;
  uint64_t cycleLength = VIRTUAL_LIST_LAUNCHER_SCROLL_START_DELAY_MICROS
                         + scrollDuration
                         + VIRTUAL_LIST_LAUNCHER_SCROLL_END_DELAY_MICROS;
  uint64_t cycleElapsed = (runTime - virtualListLauncherFocusStartMicros) % cycleLength;
  uint16_t nextOffset = 0;
  if (cycleElapsed < VIRTUAL_LIST_LAUNCHER_SCROLL_START_DELAY_MICROS) {
    nextOffset = 0;
  } else if (cycleElapsed < VIRTUAL_LIST_LAUNCHER_SCROLL_START_DELAY_MICROS + scrollDuration) {
    uint64_t scrollElapsed = cycleElapsed - VIRTUAL_LIST_LAUNCHER_SCROLL_START_DELAY_MICROS;
    nextOffset = static_cast<uint16_t>(
      std::min<uint64_t>((scrollElapsed / VIRTUAL_LIST_LAUNCHER_SCROLL_INTERVAL_MICROS) + 1, maxOffset)
    );
  } else {
    nextOffset = maxOffset;
  }
  if (nextOffset == 0 && !virtualListLauncherScrollApplied) {
    if (needsRedraw) {
      redrawMenuAfterVirtualListLauncherScroll();
    }
    return;
  }
  if (!virtualListLauncherScrollApplied || nextOffset != virtualListLauncherScrollOffset) {
    writeVirtualListLauncherLabel(label, labelLength, prefix, value, nextOffset);
    virtualListLauncherScrollOffset = nextOffset;
    virtualListLauncherScrollApplied = true;
    redrawMenuAfterVirtualListLauncherScroll();
  } else if (needsRedraw) {
    redrawMenuAfterVirtualListLauncherScroll();
  }
}

// Call this procedure to return to the main menu
void menuHome() {
  deactivateVirtualListMenu();
  resetVirtualListLauncherScrollTracking(false);
  restoreVirtualListLauncherLabels();
  menu.setMenuPageCurrent(menuPageMain);
  dismissCommandWheelOverlay();
  menu.drawMenu();
}

void menuSynthOptionsHome() {
  deactivateVirtualListMenu();
  resetVirtualListLauncherScrollTracking(false);
  restoreVirtualListLauncherLabels();
  menu.setMenuPageCurrent(menuPageSynth);
  dismissCommandWheelOverlay();
  menu.drawMenu();
}

bool handleVirtualListLauncherKey(byte keyCode) {
  if (keyCode != GEM_KEY_OK && keyCode != GEM_KEY_RIGHT) {
    return false;
  }

  GEMPage* currentPage = menu.getCurrentMenuPage();
  if (!currentPage) {
    return false;
  }

  GEMItem* currentItem = currentPage->getCurrentMenuItem();
  if (currentItem == &menuGotoTuning) {
    openUserGeometryTuningMenu();
  } else if (currentItem == &menuGotoLayout) {
    openUserGeometryLayoutMenu();
  } else if (currentItem == &menuGotoScales) {
    openUserGeometryScaleMenu();
  } else if (currentItem == &menuGotoMainSynthPresetLoad) {
    openMainSynthPresetLoadMenu();
  } else if (currentItem == &menuGotoSynthPresetLoad) {
    openSynthPresetLoadMenu();
  } else if (currentItem == &menuGotoSynthPresetSave) {
    openSynthPresetSaveMenu();
  } else if (currentItem == &menuGotoSynthWavetableLoad) {
    openSynthWavetableLoadMenu();
  } else {
    return false;
  }
  return true;
}

void refreshMenuChoicesForCurrentTuning() {
  showOnlyValidKeyChoices();
}

void rebuildRuntimeStateFromCurrentSelection() {
  updateLayoutAndRotate();
  refreshMidiRouting();
  resetSynthFreqs();
}

void addPreviewMenuItem(GEMPage& page, GEMItem& item, void (*previewCallback)(GEMPreviewCallbackData)) {
  page.addMenuItem(item);
  item.setPreviewCallback(previewCallback);
}

void drawCenteredBootloaderLine(uint8_t y, const char* text, bool bold) {
  u8g2.setFont(bold ? u8g2_font_7x14B_tf : u8g2_font_6x13_tf);
  int16_t x = static_cast<int16_t>((128 - u8g2.getStrWidth(text)) / 2);
  u8g2.drawStr(x > 0 ? x : 0, y, text);
}

void drawBootloaderInstructionLine(uint8_t y,
                                   const char* before,
                                   const char* boldText,
                                   const char* after) {
  u8g2.setFont(u8g2_font_6x13_tf);
  uint16_t beforeWidth = u8g2.getStrWidth(before);
  uint16_t afterWidth = u8g2.getStrWidth(after);
  u8g2.setFont(u8g2_font_6x13B_tf);
  uint16_t boldWidth = u8g2.getStrWidth(boldText);
  int16_t x = static_cast<int16_t>((128 - (beforeWidth + boldWidth + afterWidth)) / 2);
  if (x < 0) {
    x = 0;
  }
  u8g2.setFont(u8g2_font_6x13_tf);
  u8g2.drawStr(x, y, before);
  x += beforeWidth;
  u8g2.setFont(u8g2_font_6x13B_tf);
  u8g2.drawStr(x, y, boldText);
  x += boldWidth;
  u8g2.setFont(u8g2_font_6x13_tf);
  u8g2.drawStr(x, y, after);
}

void drawBootloaderReadyScreen() {
  wakeDisplayFromScreensaver();
  noteOverlayVisible = false;
  noteBadgeVisible = false;
  noteOverlayTemporaryWake = false;
  noteOverlayWokeDisplayFromSleep = false;

  u8g2.clearBuffer();
  drawCenteredBootloaderLine(22, "Ready to update!", true);
  drawBootloaderInstructionLine(52, "Copy the ", ".uf2", " file");
  drawBootloaderInstructionLine(76, "to the ", "RPI-RP2", " drive");
  drawCenteredBootloaderLine(100, "on your computer.", false);
  // This is the one transition where the framebuffer must reach the panel
  // before control leaves the firmware permanently.
  u8g2.sendBufferAndWait();
}

void rebootToBootloader() {
  dismissCommandWheelOverlay();
  drawBootloaderReadyScreen();
  clearLEDs();
  rp2040.rebootToBootloader();
}
/*
    This procedure sets each key spinner menu item to be either
    visible if the key names correspond to the current tuning,
    or hidden if not.

    It should run once after the key selectors are
    generated, and then once any time the tuning changes.
  */
void showOnlyValidKeyChoices() {
  const tuningDef& tuning = current.tuning();
  uint16_t cycleLength = tuning.cycleLength;
  if (cycleLength == 0 || cycleLength > MAX_SCALE_DIVISIONS) {
    cycleLength = 1;
  }
  int minimum = userGeometryRuntime.active ? 0 : tuning.spanCtoA();
  int maximum = minimum + cycleLength - 1;
  while (current.keyStepsFromA < minimum) {
    current.keyStepsFromA += cycleLength;
  }
  while (current.keyStepsFromA > maximum) {
    current.keyStepsFromA -= cycleLength;
  }
  spinnerCurrentKey.setRange(minimum, maximum);
  bool useLabelSelector = cycleLength <= UINT8_MAX;
  if (useLabelSelector) {
    currentKeyChoices.resize(cycleLength);
    currentKeyChoiceLabels.resize(cycleLength);
    for (uint16_t degree = 0; degree < cycleLength; ++degree) {
      formatTuningDegreeLabel(tuning,
                              degree,
                              currentKeyChoiceLabels[degree].data(),
                              currentKeyChoiceLabels[degree].size());
      currentKeyChoices[degree] = {
        currentKeyChoiceLabels[degree].data(),
        userGeometryRuntime.active ? static_cast<int>(degree) : minimum + static_cast<int>(degree)
      };
    }
    selectCurrentKey.setOptions(static_cast<byte>(cycleLength), currentKeyChoices.data());
  } else {
    std::vector<SelectOptionInt>().swap(currentKeyChoices);
    std::vector<std::array<char, TUNING_KEY_LABEL_LENGTH>>().swap(currentKeyChoiceLabels);
  }
  menuItemMainKey.hide(!useLabelSelector);
  menuItemMainKeyNumeric.hide(useLabelSelector);
  sendToLog("menu: Key choices were updated.");
}

void updateLayoutAndRotate() {
  applyLayout();
  applyDeviceDisplayRotation();
}

void loadDeviceRotationFromCurrentLayout() {
  deviceRotation = userGeometryRuntime.active && userGeometryRuntime.layoutObjectSelected
    ? userGeometryRuntime.deviceRotation % 4
    : current.layout().deviceRotation % 4;
  settings[static_cast<uint8_t>(SettingKey::DeviceRotation)] = deviceRotation;
}

void applyDeviceDisplayRotation() {
  switch (displayRotationFromDeviceRotation(deviceRotation)) {
    case 0:
      u8g2.setDisplayRotation(U8G2_R0);
      break;
    case 1:
      u8g2.setDisplayRotation(U8G2_R1);
      break;
    case 2:
      u8g2.setDisplayRotation(U8G2_R2);
      break;
    default:
      u8g2.setDisplayRotation(U8G2_R3);
      break;
  }
}
/*
    This procedure is run when the key is changed via the menu.
    A key change results in a shift in the location of the
    scale notes relative to the grid.
    In this program, the only thing that occurs is that
    the scale is reapplied to the grid.
    The menu does not go home because the intent is to stay
    on the scale/key screen.
  */
void changeKey() {  // when you change the key via the menu
  // 1) Save the signed 16-bit tuning-relative key offset:
  storeCurrentKeyStepsInSettings(current.keyStepsFromA);
  markSettingsDirty();
  // 2) Apply it:
  applyScale();
}
/*
    This procedure was declared already and is being defined now.
    It's run when the transposition is changed via the menu.
    It sets the current transposition to the selected value.
    The effect of transposition is to change the sounded
    notes but not the layout or display.
    The procedure to re-assign pitches is therefore called.
    The menu doesn't change because the transpose is a spinner select.
  */
void changeTranspose() {  // when you change the transpose via the menu
  // 1) Save to flash (biased by +128):
  settings[static_cast<uint8_t>(SettingKey::CurrentTransposeSteps)] = uint8_t(transposeSteps + 128);
  markSettingsDirty();
  // 2) Apply it:
  current.transpose = transposeSteps;
  assignPitches();
  updateSynthWithNewFreqs();
}

void previewKey(GEMPreviewCallbackData previewData);
void createKeyMenuItems() {
  menuItemMainKey.setPreviewCallback(previewKey);
  menuItemMainKeyNumeric.setPreviewCallback(previewKey);
  menuPageMain.addMenuItem(menuItemMainKey);
  menuPageMain.addMenuItem(menuItemMainKeyNumeric);
  showOnlyValidKeyChoices();
}
void previewKey(GEMPreviewCallbackData previewData) {
  current.keyStepsFromA = previewData.previewValInt;
  applyScale();
}

void createProfileMenuItems() {
  for (uint8_t i = 0; i < PROFILE_COUNT; ++i) {
    if (i == 0) {
      snprintf(loadProfileLabels[i], sizeof(loadProfileLabels[i]), "Load Boot/Auto-Save");
    } else {
      snprintf(loadProfileLabels[i], sizeof(loadProfileLabels[i]), "Load Slot %u", static_cast<unsigned>(i));
    }
    menuItemLoadProfile[i] = &loadProfileItemPool.construct(
      i, loadProfileLabels[i], loadProfileMenu, i);
    menuPageProfiles.addMenuItem(*menuItemLoadProfile[i]);
  }
  for (uint8_t i = 0; i < PROFILE_COUNT; ++i) {
    if (i == 0) {
      snprintf(saveProfileLabels[i], sizeof(saveProfileLabels[i]), "Save Boot/Auto-Save");
    } else {
      snprintf(saveProfileLabels[i], sizeof(saveProfileLabels[i]), "Save Slot %u", static_cast<unsigned>(i));
    }
    menuItemSaveProfile[i] = &saveProfileItemPool.construct(
      i, saveProfileLabels[i], saveProfileMenu, i);
    menuPageProfiles.addMenuItem(*menuItemSaveProfile[i]);
  }
}

void setupTuningMenuPage() {
  menuPageMain.addMenuItem(menuGotoTuning);
}

void setupLayoutMenuPage() {
  menuPageMain.addMenuItem(menuGotoLayout);
}

void setupScalesMenuPage() {
  menuPageMain.addMenuItem(menuGotoScales);
  menuPageMain.addMenuItem(menuItemMainScaleLock);
}

void setupColorsMenuPage() {
  menuPageMain.addMenuItem(menuGotoColors);
  addPreviewMenuItem(menuPageColors, menuItemColor, previewColor);
  addPreviewMenuItem(menuPageColors, menuItemBright, previewBright);
  addPreviewMenuItem(menuPageColors, menuItemLedCurrentLimit, previewLedCurrentLimit);
  addPreviewMenuItem(menuPageColors, menuItemAnimate, previewAnimate);
  addPreviewMenuItem(menuPageColors, menuItemRestLedLevel, previewRestLedLevel);
  addPreviewMenuItem(menuPageColors, menuItemDimLedLevel, previewDimLedLevel);
}

void setupEditorMenuPage() {
  menuPageMain.addMenuItem(menuGotoEditor);
  menuPageEditor.addMenuItem(menuGotoSynth);
  menuPageEditor.addMenuItem(menuItemToggleDynamicJI);
  menuPageEditor.addMenuItem(menuItemSelectDynamicJIRatioTable);
  menuPageEditor.addMenuItem(menuItemToggleJI_BPM);
  menuPageEditor.addMenuItem(menuItemSetJI_BPM);
  menuPageEditor.addMenuItem(menuItemSetJI_BPM_Multiplier);
  menuPageEditor.addMenuItem(menuItemSelectLayoutRotation);
  menuPageEditor.addMenuItem(mirrorLeftRightGEMItem);
  menuPageEditor.addMenuItem(mirrorUpDownGEMItem);
  menuPageEditor.addMenuItem(menuItemSelectDeviceRotation);
  updateEditorMenuVisibility();
}

void setupSynthMenuPage() {
  menuPageSynth.addMenuItem(menuItemPlayback);
  addPreviewMenuItem(menuPageSynth, menuItemSynthOutputVolume, previewSynthOutputVolume);
  // menuItemAudioD added here for hardware V1.2
  addPreviewMenuItem(menuPageSynth, menuItemArpSpeed, previewArpSpeed);
  addPreviewMenuItem(menuPageSynth, menuItemArpDirection, previewArpDirection);
  addPreviewMenuItem(menuPageSynth, menuItemPortamentoTime, previewPortamentoTime);
  updateCurrentSynthWavetableMenuLabel();
  menuPageSynth.addMenuItem(menuGotoSynthWavetableLoad);
  addPreviewMenuItem(menuPageSynth, menuItemSynthWavetablePosition, previewSynthWavetablePosition);
  addPreviewMenuItem(menuPageSynth, menuItemSynthDrive, previewSynthDrive);
  menuPageSynth.addMenuItem(menuGotoSynthAmpEnv);
  addPreviewMenuItem(menuPageSynthAmpEnv, menuItemEnvelopeAttack, previewEnvelopeAttack);
  addPreviewMenuItem(menuPageSynthAmpEnv, menuItemEnvelopeHold, previewEnvelopeHold);
  addPreviewMenuItem(menuPageSynthAmpEnv, menuItemEnvelopeDecay, previewEnvelopeDecay);
  addPreviewMenuItem(menuPageSynthAmpEnv, menuItemEnvelopeSustain, previewEnvelopeSustain);
  addPreviewMenuItem(menuPageSynthAmpEnv, menuItemEnvelopeRelease, previewEnvelopeRelease);
  menuPageSynth.addMenuItem(menuGotoSynthFx1);
  addPreviewMenuItem(menuPageSynthFx1, menuItemEffectEnvelopeTarget, previewEffectEnvelopeTarget);
  addPreviewMenuItem(menuPageSynthFx1, menuItemEffectEnvelopeAmount, previewEffectEnvelopeAmount);
  addPreviewMenuItem(menuPageSynthFx1, menuItemEffectEnvelopeAttack, previewEffectEnvelopeAttack);
  addPreviewMenuItem(menuPageSynthFx1, menuItemEffectEnvelopeHold, previewEffectEnvelopeHold);
  addPreviewMenuItem(menuPageSynthFx1, menuItemEffectEnvelopeDecay, previewEffectEnvelopeDecay);
  addPreviewMenuItem(menuPageSynthFx1, menuItemEffectEnvelopeSustain, previewEffectEnvelopeSustain);
  addPreviewMenuItem(menuPageSynthFx1, menuItemEffectEnvelopeRelease, previewEffectEnvelopeRelease);
  menuPageSynth.addMenuItem(menuGotoSynthFx2);
  addPreviewMenuItem(menuPageSynthFx2, menuItemEffectEnvelope2Target, previewEffectEnvelope2Target);
  addPreviewMenuItem(menuPageSynthFx2, menuItemEffectEnvelope2Amount, previewEffectEnvelope2Amount);
  addPreviewMenuItem(menuPageSynthFx2, menuItemEffectEnvelope2Attack, previewEffectEnvelope2Attack);
  addPreviewMenuItem(menuPageSynthFx2, menuItemEffectEnvelope2Hold, previewEffectEnvelope2Hold);
  addPreviewMenuItem(menuPageSynthFx2, menuItemEffectEnvelope2Decay, previewEffectEnvelope2Decay);
  addPreviewMenuItem(menuPageSynthFx2, menuItemEffectEnvelope2Sustain, previewEffectEnvelope2Sustain);
  addPreviewMenuItem(menuPageSynthFx2, menuItemEffectEnvelope2Release, previewEffectEnvelope2Release);
  menuPageSynth.addMenuItem(menuGotoSynthLfo);
  addPreviewMenuItem(menuPageSynthLfo, menuItemSynthLfoTarget, previewSynthLfoTarget);
  addPreviewMenuItem(menuPageSynthLfo, menuItemSynthLfoAmount, previewSynthLfoAmount);
  addPreviewMenuItem(menuPageSynthLfo, menuItemSynthLfoWave, previewSynthLfoWave);
  addPreviewMenuItem(menuPageSynthLfo, menuItemSynthLfoSpeed, previewSynthLfoSpeed);
  addPreviewMenuItem(menuPageSynth, menuItemSynthModTarget, previewSynthModTarget);
  addPreviewMenuItem(menuPageSynth, menuItemSynthModAmount, previewSynthModAmount);
  addPreviewMenuItem(menuPageSynth, menuItemSynthVibratoSpeed, previewSynthVibratoSpeed);
  addPreviewMenuItem(menuPageSynth, menuItemSynthBPM, previewSynthBPM);
  addPreviewMenuItem(menuPageSynth, menuItemMetronomeMode, previewMetronomeMode);
  addPreviewMenuItem(menuPageSynth, menuItemMetronomeSignature, previewMetronomeSignature);
  menuPageSynth.addMenuItem(menuGotoSynthPresetLoad);
  menuPageSynth.addMenuItem(menuGotoSynthPresetSave);
  createSynthWavetableMenuItems();
  createSynthPresetMenuItems();
  updateSynthMenuVisibility();
}

void setupMidiMenuPage() {
  menuPageOptions.addMenuItem(menuItemSelectMIDIChannel);
  menuPageOptions.addMenuItem(menuItemSelectMPEMode);
  menuPageOptions.addMenuItem(menuItemMPEpitchBend);
  menuPageOptions.addMenuItem(menuItemSelectMPELowChannel);
  menuPageOptions.addMenuItem(menuItemSelectMPEHighChannel);
  menuPageOptions.addMenuItem(menuItemToggleMPELowPriority);
  menuPageOptions.addMenuItem(menuItemToggleExtraMPE);
  menuPageOptions.addMenuItem(menuItemSelectCC74value);
  menuPageOptions.addMenuItem(menuItemRolandMT32);
  menuPageOptions.addMenuItem(menuItemGeneralMidi);
}

void setupControlMenuPage() {
  addPreviewMenuItem(menuPageOptions, menuItemVelSpeed, previewVelSpeed);
  addPreviewMenuItem(menuPageOptions, menuItemPBSpeed, previewPBSpeed);
  addPreviewMenuItem(menuPageOptions, menuItemModSpeed, previewModSpeed);
  addPreviewMenuItem(menuPageOptions, menuItemPBBehave, previewPBBehave);
  addPreviewMenuItem(menuPageOptions, menuItemModBehave, previewModBehave);
}

void setupProfileMenuPages() {
  menuPageMain.addMenuItem(menuGotoProfiles);
  menuPageProfiles.addMenuItem(menuItemAutoSave);
  createProfileMenuItems();
}

void setupSerialDebugMenuPage() {
  menuPageSerialDebug.addMenuItem(menuItemSerialDebugEnabled);
  menuPageSerialDebug.addMenuItem(menuItemSerialDebugGeneral);
  menuPageSerialDebug.addMenuItem(menuItemSerialDebugHeap);
  menuPageSerialDebug.addMenuItem(menuItemSerialDebugAudio);
  updateSerialDebugMenuVisibility();
}

void formatStorageStatusPath(uint8_t issueIndex) {
  const char* path = storageHealthIssuePath(issueIndex);
  size_t length = strlen(path);
  if (length < sizeof(storageStatusPathLabels[issueIndex])) {
    snprintf(storageStatusPathLabels[issueIndex],
             sizeof(storageStatusPathLabels[issueIndex]),
             "%s",
             path);
    return;
  }
  const char* basename = strrchr(path, '/');
  basename = basename && basename[1] ? basename + 1 : path;
  size_t basenameLength = strlen(basename);
  if (basenameLength < sizeof(storageStatusPathLabels[issueIndex])) {
    snprintf(storageStatusPathLabels[issueIndex],
             sizeof(storageStatusPathLabels[issueIndex]),
             "%s",
             basename);
    return;
  }
  snprintf(storageStatusPathLabels[issueIndex],
           sizeof(storageStatusPathLabels[issueIndex]),
           "%.8s...%s",
           basename,
           basename + basenameLength - 8);
}

void populateStorageStatusMenuPage() {
  menuItemStorageSummary = &storageSummaryItemPool.construct(0, storageHealthSummaryLabel());
  menuPageStorageStatus.addMenuItem(*menuItemStorageSummary);
  for (uint8_t index = 0; index < storageHealthIssueCount(); ++index) {
    formatStorageStatusPath(index);
    snprintf(storageStatusReasonLabels[index],
             sizeof(storageStatusReasonLabels[index]),
             "  %s",
             storageHealthIssueReason(index));
    menuItemStorageIssuePath[index] = &storagePathItemPool.construct(
      index, storageStatusPathLabels[index]);
    menuItemStorageIssueReason[index] = &storageReasonItemPool.construct(
      index, storageStatusReasonLabels[index]);
    menuPageStorageStatus.addMenuItem(*menuItemStorageIssuePath[index]);
    menuPageStorageStatus.addMenuItem(*menuItemStorageIssueReason[index]);
  }
}

void setupAdvancedMenuPage() {
  menuPageOptions.addMenuItem(menuItemShiftColor);
  menuPageOptions.addMenuItem(menuItemDisplayPlayedNotes);
  menuPageOptions.addMenuItem(menuGotoAdvanced);
  menuPageAdvanced.addMenuItem(menuItemVersion);
  menuPageAdvanced.addMenuItem(menuItemHardware);
  menuPageAdvanced.addMenuItem(menuItemRotary);
  menuPageAdvanced.addMenuItem(menuItemBootAnimation);
  menuPageAdvanced.addMenuItem(menuGotoStorageStatus);
  // menuPageAdvanced.addMenuItem(menuItemWheelAlt); // not sure why we have this, so I'm hiding it for now
  menuPageAdvanced.addMenuItem(menuItemResetDefaults);
  menuPageAdvanced.addMenuItem(menuItemUSBBootloader);
  menuPageAdvanced.addMenuItem(menuGotoSerialDebug);
  addPreviewMenuItem(menuPageAdvanced, menuItemLedTest, previewLedTest);
}

void setupMainSynthPresetLoadMenuItem() {
  menuPageMain.addMenuItem(menuGotoMainSynthPresetLoad);
}

void setupOptionsMenuPage() {
  menuPageMain.addMenuItem(menuGotoOptions);
}

void setupTransposeMenuItem() {
  addPreviewMenuItem(menuPageMain, menuItemTransposeSteps, previewTranspose);
}

void drawMenuFrameOverlays() {
  GEMAppearance* appearance = menu.getCurrentAppearance();
  if (appearance && appearance->menuPageScreenTopOffset == MENU_PAGE_SCREEN_TOP_OFFSET) {
    GEMPage* currentPage = menu.getCurrentMenuPage();
    u8g2.setDrawColor(0);
    u8g2.drawBox(0, 0, u8g2.getDisplayWidth(), MENU_HEADER_DIVIDER_Y);
    u8g2.setDrawColor(1);
    drawCenteredMenuHeaderTitle(currentPage ? currentPage->getTitle() : "");
    u8g2.drawHLine(0, MENU_HEADER_DIVIDER_Y, u8g2.getDisplayWidth());
  }
  drawSequencerMenuFilenameHeader();
  drawPlayedNoteBadgeOnMenuFrame();
}

void setupMenu() {
  initTransposeOptions();
  updateMainMenuDynamicLabels();
  menu.setSplashDelay(0);
  menu.setFontSmall(GEM_FONT_BIG, 6, 12);
  menu.init();
  u8g2.enableAsyncTransfers();
  menu.setDrawMenuCallback(drawMenuFrameOverlays);
  menu.invertKeysDuringEdit(true);  // Invert rotary direction when editing a value
  /*
      addMenuItem procedure adds that GEM object to the given page.
      The menu items appear in the order they are added.
      To change the order of the menu, change the order in the code below.
    */
  setupTuningMenuPage();
  setupLayoutMenuPage();
  createKeyMenuItems();
  setupScalesMenuPage();
  createUserGeometryMenuItems();
  setupMainSynthPresetLoadMenuItem();
  setupColorsMenuPage();
  setupTransposeMenuItem();
  setupEditorMenuPage();
  setupMidiMenuPage();
  setupControlMenuPage();
  setupSerialDebugMenuPage();
  setupAdvancedMenuPage();
  setupProfileMenuPages();
  setupSynthMenuPage();
  setupSequencerMenu();
  setupOptionsMenuPage();
}
void setupGFX() {
  u8g2.begin();                      // Menu and graphics setup
  u8g2.setBusClock(1000000);         // Speed up display
  u8g2.setPowerSave(0);
  u8g2.setContrast(CONTRAST_AWAKE);  // Set contrast
  sendToLog("U8G2 graphics initialized.");
}
void screenSaver() {
  bool temporaryDisplayWake = noteOverlayTemporaryWake || commandWheelOverlayTemporaryWakeActive();
  if (temporaryDisplayWake) {
    if (screenTime <= screenSaverTimeout) {
      screenTime = screenTime + lapTime;
    }
    wakeDisplayFromScreensaver();
    return;
  }

  if (screenTime <= screenSaverTimeout) {
    screenTime = screenTime + lapTime;
    wakeDisplayFromScreensaver();
  } else {
    if (!screenSaverOn) {
      bool commandOverlayWasActive = commandWheelOverlayActive();
      if (commandOverlayWasActive && wakePlayedNotesOverlayForHeldNotes()) {
        dismissCommandWheelOverlay();
        return;
      }
      dismissCommandWheelOverlay();
      enterDisplayScreensaver();
    }
  }
}
