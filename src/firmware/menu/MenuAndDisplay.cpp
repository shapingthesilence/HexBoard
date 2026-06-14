#if HEXBOARD_FIRMWARE_UNITY

#include "../FirmwareModule.h"
#include "PlayedNotesOverlay.h"

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
#define MENU_PAGE_SCREEN_TOP_OFFSET 10
#define MENU_VALUES_LEFT_OFFSET 78
#define CONTRAST_AWAKE 63
#define CONTRAST_SCREENSAVER 1
// Create an instance of the U8g2 graphics library.
U8G2_SH1107_SEEED_128X128_F_HW_I2C u8g2(U8G2_R2, /* reset=*/U8X8_PIN_NONE);
// Create menu object of class GEM_u8g2. Supply its constructor with reference to u8g2 object we created earlier
GEM_u8g2 menu(
  u8g2, GEM_POINTER_ROW, GEM_ITEMS_COUNT_AUTO,
  MENU_ITEM_HEIGHT, MENU_PAGE_SCREEN_TOP_OFFSET, MENU_VALUES_LEFT_OFFSET);
bool screenSaverOn = 0;
bool audioMenuItemInserted = false;
bool headphoneVolumeMenuItemInserted = false;
uint64_t screenTime = 0;                         // GFX timer to count if screensaver should go on
const uint64_t screenSaverTimeout = (1u << 25);  // 2^25 microseconds ~ 33 seconds

void wakeDelegatedControlScreenForInput() {
  screenTime = 0;
  if (screenSaverOn) {
    screenSaverOn = 0;
    u8g2.setContrast(CONTRAST_AWAKE);
  }
  delegatedDisplayDirty = true;
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
  if (!delegatedControl) {
    return;
  }
  if (delegatedDisplayWakeRequested) {
    wakeDelegatedControlScreenForInput();
    delegatedDisplayWakeRequested = false;
  }
  if (screenSaverOn || !delegatedDisplayDirty) {
    return;
  }

  noteOverlayVisible = false;
  noteBadgeVisible = false;
  noteOverlayTemporaryWake = false;
  noteOverlayWokeDisplayFromSleep = false;
  noteBadgeText[0] = '\0';

  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_6x13_tf);
  drawCenteredDelegatedText("Delegated", 24);
  drawCenteredDelegatedText("Control Mode", 40);
  drawCenteredDelegatedText(delegatedAppName, 66);
  drawCenteredDelegatedText("Hold encoder", 106);
  drawCenteredDelegatedText("5 sec to exit", 122);
  u8g2.sendBuffer();
  delegatedDisplayDirty = false;
}

void restoreMenuAfterDelegatedControl() {
  if (!delegatedReturnToMenuRequested) {
    return;
  }
  delegatedReturnToMenuRequested = false;
  if (!screenSaverOn) {
    menu.drawMenu();
  }
}

void drawPresetSyncTransferScreen() {
  if (!presetSyncTransferScreenVisible) {
    presetSyncTransferScreenWokeDisplayFromSleep = screenSaverOn;
    presetSyncTransferSavedScreenTime = screenTime;
  }
  if (screenSaverOn) {
    screenSaverOn = 0;
    u8g2.setContrast(CONTRAST_AWAKE);
  }
  noteOverlayVisible = false;
  noteBadgeVisible = false;
  noteOverlayTemporaryWake = false;
  noteOverlayWokeDisplayFromSleep = false;

  char frameText[28];
  char messageText[18];
  snprintf(frameText, sizeof(frameText), "Frames: %lu", static_cast<unsigned long>(presetSyncTransferFrameCount));
  snprintf(messageText, sizeof(messageText), "Msg: 0x%02X", presetSyncTransferLastMessage);

  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_6x13_tf);
  u8g2.drawStr(8, 18, "MIDI SysEx");
  u8g2.drawStr(8, 34, "Transfer");
  u8g2.drawStr(8, 58, "Preset sync active");
  u8g2.drawStr(8, 76, frameText);
  u8g2.drawStr(8, 94, messageText);
  u8g2.drawStr(8, 116, "Please wait...");
  u8g2.sendBuffer();
  presetSyncTransferScreenVisible = true;
}

void closePresetSyncTransferScreen() {
  if (!presetSyncTransferScreenVisible) {
    return;
  }
  presetSyncTransferScreenVisible = false;
  screenTime = presetSyncTransferSavedScreenTime;
  if (presetSyncTransferScreenWokeDisplayFromSleep || screenTime > screenSaverTimeout) {
    screenSaverOn = 1;
    u8g2.setContrast(CONTRAST_SCREENSAVER);
    u8g2.clear();
  } else if (delegatedControl) {
    delegatedDisplayDirty = true;
    drawDelegatedControlScreen();
  } else {
    menu.drawMenu();
  }
  presetSyncTransferScreenWokeDisplayFromSleep = false;
  presetSyncTransferSavedScreenTime = 0;
}

bool servicePresetSyncTransfer() {
  if (!presetSyncTransferActive) {
    return false;
  }

  drawPresetSyncTransferScreen();
  bool pausedMainLoop = false;
  while (presetSyncTransferActive) {
    pausedMainLoop = true;
    bool processed = processIncomingMIDI();
    uint64_t now = readClock();
    if (now >= presetSyncTransferDeadline) {
      sendToLog("Preset-sync SysEx transfer window timed out.");
      presetSyncCancelReadTransfer();
      presetSyncCancelWriteTransfer();
      presetSyncTransferActive = false;
      break;
    }
    if ((now - presetSyncTransferLastActivity) >= PRESET_SYNC_TRANSFER_IDLE_MICROS) {
      if (presetSyncReadTransfer.active || presetSyncWriteTransfer.active) {
        delayMicroseconds(100);
        continue;
      } else {
        presetSyncTransferActive = false;
        break;
      }
    }
    if (!processed) {
      delayMicroseconds(100);
    }
  }

  if (!presetSyncTransferActive) {
    closePresetSyncTransferScreen();
  }
  return pausedMainLoop;
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
GEMPage menuPageMain("HexBoard MIDI Controller");
GEMPage menuPageTuning("Tuning", menuPageMain);
GEMItem menuGotoTuning("Tuning", menuPageTuning);
GEMPage menuPageLayout("Layout", menuPageMain);
GEMItem menuGotoLayout("Layout", menuPageLayout);
GEMPage menuPageScales("Scales", menuPageMain);
GEMItem menuGotoScales("Scales", menuPageScales);
GEMPage menuPageColors("Color Options", menuPageMain);
GEMItem menuGotoColors("Color Options", menuPageColors);
GEMPage menuPageSynth("Synth Options", menuPageMain);
GEMItem menuGotoSynth("Synth Options", menuPageSynth);
GEMPage menuPageSynthWavetableLoad("Wavetables", menuPageSynth);
char currentSynthWavetableMenuLabel[SYNTH_WAVETABLE_MENU_LABEL_LENGTH] = "WT:Basic";
GEMItem menuGotoSynthWavetableLoad(currentSynthWavetableMenuLabel, menuPageSynthWavetableLoad);
GEMPage menuPageSynthLfo("LFO", menuPageSynth);
GEMItem menuGotoSynthLfo("LFO", menuPageSynthLfo);
GEMPage menuPageSynthFx1("FX Env 1", menuPageSynth);
GEMItem menuGotoSynthFx1("FX Env 1", menuPageSynthFx1);
GEMPage menuPageSynthFx2("FX Env 2", menuPageSynth);
GEMItem menuGotoSynthFx2("FX Env 2", menuPageSynthFx2);
GEMPage menuPageSynthPresetSave("Save Preset", menuPageSynth);
GEMItem menuGotoSynthPresetSave("Save Preset", menuPageSynthPresetSave);
GEMPage menuPageSynthPresetLoad("Load Preset", menuPageSynth);
GEMItem menuGotoSynthPresetLoad("Load Preset", menuPageSynthPresetLoad);
GEMPage menuPageMIDI("MIDI Options", menuPageMain);
GEMItem menuGotoMIDI("MIDI Options", menuPageMIDI);
GEMPage menuPageControl("Control Wheel", menuPageMain);
GEMItem menuGotoControl("Control Wheel", menuPageControl);
GEMPage menuPageAdvanced("Advanced", menuPageMain);
GEMItem menuGotoAdvanced("Advanced", menuPageAdvanced);
GEMPage menuPageSave("Save Profiles", menuPageMain);
GEMItem menuGotoSave("Save", menuPageSave);
GEMPage menuPageLoad("Load Profiles", menuPageMain);
GEMItem menuGotoLoad("Load", menuPageLoad);
GEMPage menuPageReboot("Ready to flash firmware!");

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
void rebootToBootloader();
/*
    These GEMItems are read-only display items.
    They do not change any variable or run any procedure.
  */
GEMItem menuItemVersion("Firmware 1.4 alpha");
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
void updateTuningMenuVisibility();
void tuningIntonationModeChanged();
extern bool settingsDirty;

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

struct SynthPresetMenuAction {
  uint16_t presetIndex = 0;
  bool createNew = false;
  char folderPath[SYNTH_PRESET_FOLDER_LENGTH] = {};
};

void saveSynthPresetMenu(GEMCallbackData callbackData) {
  SynthPresetMenuAction* action = reinterpret_cast<SynthPresetMenuAction*>(callbackData.valPointer);
  if (action) {
    if (action->createNew) {
      saveSynthPresetAsNew(action->folderPath);
    } else {
      saveSynthPresetToSlot(action->presetIndex);
    }
  }
  menuSynthOptionsHome();
  requestSynthPresetMenuRebuild();
}

void loadSynthPresetMenu(GEMCallbackData callbackData) {
  SynthPresetMenuAction* action = reinterpret_cast<SynthPresetMenuAction*>(callbackData.valPointer);
  if (action) {
    loadSynthPresetFromSlot(action->presetIndex);
  }
  menuSynthOptionsHome();
}

void loadBlankSynthPresetMenu(GEMCallbackData callbackData) {
  (void)callbackData;
  loadBlankSynthPreset();
  menuSynthOptionsHome();
}

/*
    Tunings, layouts, scales, and keys are defined
    earlier in this code. We should not have to
    manually type in menu objects for those
    pre-loaded values. Instead, we will use routines to
    construct menu items automatically.

    These lines are forward declarations for
    the menu objects we will make later.
    This allocates space in memory with
    enough size to procedurally fill
    the objects based on the contents of
    the pre-loaded tuning/layout/etc. definitions
    we defined above.
  */
GEMItem* menuItemTuning[TUNINGCOUNT];
GEMItem* menuItemLayout[layoutCount];
GEMItem* menuItemScales[scaleCount];
GEMSelect* selectKey[TUNINGCOUNT];
GEMItem* menuItemKeys[TUNINGCOUNT];
GEMItem* menuItemSaveProfile[PROFILE_COUNT];
GEMItem* menuItemLoadProfile[PROFILE_COUNT];
GEMItem* menuItemLoadSynthPresetBlank;
char saveProfileLabels[PROFILE_COUNT][24];
char loadProfileLabels[PROFILE_COUNT][24];

struct SynthPresetMenuFolderNode {
  char path[SYNTH_PRESET_FOLDER_LENGTH] = {};
  char label[SYNTH_PRESET_MENU_LABEL_LENGTH] = {};
  GEMPage* savePage = nullptr;
  GEMPage* loadPage = nullptr;
};

std::vector<GEMItem*> synthPresetMenuItems;
std::vector<GEMPage*> synthPresetMenuPages;
std::vector<SynthPresetMenuAction*> synthPresetMenuActions;
std::vector<SynthPresetMenuFolderNode*> synthPresetMenuFolders;
std::vector<char*> synthPresetMenuLabels;
bool synthPresetMenuRebuildPending = false;

char* cloneSynthPresetMenuText(const char* text) {
  size_t length = strlen(text);
  char* copy = new char[length + 1];
  memcpy(copy, text, length + 1);
  synthPresetMenuLabels.push_back(copy);
  return copy;
}

SynthPresetMenuAction* createSynthPresetMenuAction(uint16_t presetIndex, bool createNew, const char* folderPath) {
  SynthPresetMenuAction* action = new SynthPresetMenuAction{};
  action->presetIndex = presetIndex;
  action->createNew = createNew;
  snprintf(action->folderPath, sizeof(action->folderPath), "%s", folderPath && folderPath[0] ? folderPath : SYNTH_PRESET_ROOT_FOLDER);
  normalizeSynthPresetFolderPath(action->folderPath, sizeof(action->folderPath));
  synthPresetMenuActions.push_back(action);
  return action;
}

void addSynthPresetMenuButton(GEMPage& page, const char* label, void (*callback)(GEMCallbackData), SynthPresetMenuAction* action) {
  GEMItem* item = new GEMItem(cloneSynthPresetMenuText(label), callback, reinterpret_cast<void*>(action));
  synthPresetMenuItems.push_back(item);
  page.addMenuItem(*item);
}

void addSynthPresetNewMenuButton(GEMPage& page, const char* folderPath) {
  addSynthPresetMenuButton(
    page,
    "New Preset",
    saveSynthPresetMenu,
    createSynthPresetMenuAction(0, true, folderPath)
  );
}

SynthPresetMenuFolderNode* findSynthPresetMenuFolder(const char* folderPath) {
  for (SynthPresetMenuFolderNode* folder : synthPresetMenuFolders) {
    if (strncmp(folder->path, folderPath, sizeof(folder->path)) == 0) {
      return folder;
    }
  }
  return nullptr;
}

void parentSynthPresetFolderPath(const char* folderPath, char* output, size_t outputLength) {
  if (outputLength == 0) {
    return;
  }
  const char* slash = strrchr(folderPath, '/');
  if (!slash) {
    snprintf(output, outputLength, "%s", SYNTH_PRESET_ROOT_FOLDER);
  } else {
    size_t length = std::min(static_cast<size_t>(slash - folderPath), outputLength - 1);
    memcpy(output, folderPath, length);
    output[length] = '\0';
    normalizeSynthPresetFolderPath(output, outputLength);
  }
}

int decodeSynthPresetFolderHex(char value) {
  if (value >= '0' && value <= '9') {
    return value - '0';
  }
  if (value >= 'a' && value <= 'f') {
    return value - 'a' + 10;
  }
  if (value >= 'A' && value <= 'F') {
    return value - 'A' + 10;
  }
  return -1;
}

void decodeSynthPresetFolderComponent(const char* input, char* output, size_t outputLength) {
  if (outputLength == 0) {
    return;
  }

  size_t outputIndex = 0;
  for (size_t i = 0; input && input[i] != '\0' && outputIndex + 1 < outputLength; ++i) {
    if (input[i] == '%' && input[i + 1] != '\0' && input[i + 2] != '\0') {
      int high = decodeSynthPresetFolderHex(input[i + 1]);
      int low = decodeSynthPresetFolderHex(input[i + 2]);
      if (high >= 0 && low >= 0) {
        char decoded = static_cast<char>((high << 4) | low);
        if (decoded == '/' || decoded == '\\' || decoded == '%') {
          output[outputIndex++] = decoded;
          i += 2;
          continue;
        }
      }
    }
    output[outputIndex++] = input[i];
  }
  output[outputIndex] = '\0';
}

void synthPresetFolderLabel(const char* folderPath, char* output, size_t outputLength) {
  if (outputLength == 0) {
    return;
  }
  const char* slash = strrchr(folderPath, '/');
  const char* labelStart = slash ? slash + 1 : folderPath;
  if (!labelStart[0]) {
    snprintf(output, outputLength, "Root");
    return;
  }
  decodeSynthPresetFolderComponent(labelStart, output, outputLength);
}

SynthPresetMenuFolderNode* ensureSynthPresetMenuFolder(const char* folderPath) {
  char normalized[SYNTH_PRESET_FOLDER_LENGTH] = {};
  snprintf(normalized, sizeof(normalized), "%s", folderPath && folderPath[0] ? folderPath : SYNTH_PRESET_ROOT_FOLDER);
  normalizeSynthPresetFolderPath(normalized, sizeof(normalized));
  if (strcmp(normalized, SYNTH_PRESET_ROOT_FOLDER) == 0) {
    return nullptr;
  }

  SynthPresetMenuFolderNode* existing = findSynthPresetMenuFolder(normalized);
  if (existing) {
    return existing;
  }

  char parentPath[SYNTH_PRESET_FOLDER_LENGTH] = {};
  parentSynthPresetFolderPath(normalized, parentPath, sizeof(parentPath));
  SynthPresetMenuFolderNode* parent = ensureSynthPresetMenuFolder(parentPath);
  GEMPage& saveParent = parent ? *parent->savePage : menuPageSynthPresetSave;
  GEMPage& loadParent = parent ? *parent->loadPage : menuPageSynthPresetLoad;

  SynthPresetMenuFolderNode* folder = new SynthPresetMenuFolderNode{};
  snprintf(folder->path, sizeof(folder->path), "%s", normalized);
  synthPresetFolderLabel(normalized, folder->label, sizeof(folder->label));
  folder->savePage = new GEMPage(folder->label, saveParent);
  folder->loadPage = new GEMPage(folder->label, loadParent);
  synthPresetMenuPages.push_back(folder->savePage);
  synthPresetMenuPages.push_back(folder->loadPage);
  synthPresetMenuFolders.push_back(folder);

  GEMItem* saveGoto = new GEMItem(folder->label, *folder->savePage);
  GEMItem* loadGoto = new GEMItem(folder->label, *folder->loadPage);
  synthPresetMenuItems.push_back(saveGoto);
  synthPresetMenuItems.push_back(loadGoto);
  saveParent.addMenuItem(*saveGoto);
  loadParent.addMenuItem(*loadGoto);
  addSynthPresetNewMenuButton(*folder->savePage, folder->path);
  return folder;
}

void clearSynthPresetMenuItems() {
  for (GEMItem* item : synthPresetMenuItems) {
    item->remove();
    delete item;
  }
  synthPresetMenuItems.clear();
  menuItemLoadSynthPresetBlank = nullptr;

  for (GEMPage* page : synthPresetMenuPages) {
    delete page;
  }
  synthPresetMenuPages.clear();

  for (SynthPresetMenuAction* action : synthPresetMenuActions) {
    delete action;
  }
  synthPresetMenuActions.clear();

  for (SynthPresetMenuFolderNode* folder : synthPresetMenuFolders) {
    delete folder;
  }
  synthPresetMenuFolders.clear();

  for (char* label : synthPresetMenuLabels) {
    delete[] label;
  }
  synthPresetMenuLabels.clear();
}

bool synthPresetMenuOwnsPage(GEMPage* page) {
  if (page == &menuPageSynthPresetSave || page == &menuPageSynthPresetLoad) {
    return true;
  }
  for (GEMPage* ownedPage : synthPresetMenuPages) {
    if (page == ownedPage) {
      return true;
    }
  }
  return false;
}

void requestSynthPresetMenuRebuild() {
  synthPresetMenuRebuildPending = true;
}

GEMPage& synthPresetSavePageForFolder(const char* folderPath) {
  SynthPresetMenuFolderNode* folder = ensureSynthPresetMenuFolder(folderPath);
  return folder ? *folder->savePage : menuPageSynthPresetSave;
}

GEMPage& synthPresetLoadPageForFolder(const char* folderPath) {
  SynthPresetMenuFolderNode* folder = ensureSynthPresetMenuFolder(folderPath);
  return folder ? *folder->loadPage : menuPageSynthPresetLoad;
}

void rebuildSynthPresetMenuItems() {
  clearSynthPresetMenuItems();

  addSynthPresetNewMenuButton(menuPageSynthPresetSave, SYNTH_PRESET_ROOT_FOLDER);
  menuItemLoadSynthPresetBlank = new GEMItem("Blank", loadBlankSynthPresetMenu);
  synthPresetMenuItems.push_back(menuItemLoadSynthPresetBlank);
  menuPageSynthPresetLoad.addMenuItem(*menuItemLoadSynthPresetBlank);

  compactSynthPresets();
  for (size_t i = 0; i < synthPresets.size(); ++i) {
    SynthPresetSlot& preset = synthPresets[i];
    GEMPage& savePage = synthPresetSavePageForFolder(preset.folderPath);
    GEMPage& loadPage = synthPresetLoadPageForFolder(preset.folderPath);
    addSynthPresetMenuButton(
      savePage,
      preset.name,
      saveSynthPresetMenu,
      createSynthPresetMenuAction(static_cast<uint16_t>(i), false, preset.folderPath)
    );
    addSynthPresetMenuButton(
      loadPage,
      preset.name,
      loadSynthPresetMenu,
      createSynthPresetMenuAction(static_cast<uint16_t>(i), false, preset.folderPath)
    );
  }
}

void serviceSynthPresetMenuRebuild() {
  if (!synthPresetMenuRebuildPending) {
    return;
  }
  synthPresetMenuRebuildPending = false;
  if (synthPresetMenuOwnsPage(menu.getCurrentMenuPage())) {
    menu.setMenuPageCurrent(menuPageSynth);
  }
  rebuildSynthPresetMenuItems();
  if (menu.getCurrentMenuPage() == &menuPageSynth) {
    menu.drawMenu();
  }
}

struct SynthWavetableMenuAction {
  bool builtIn = false;
  uint16_t wavetableIndex = 0;
};

struct SynthWavetableMenuFolderNode {
  char path[SYNTH_WAVETABLE_FOLDER_LENGTH] = {};
  char label[SYNTH_WAVETABLE_MENU_LABEL_LENGTH] = {};
  GEMPage* loadPage = nullptr;
};

std::vector<GEMItem*> synthWavetableMenuItems;
std::vector<GEMPage*> synthWavetableMenuPages;
std::vector<SynthWavetableMenuAction*> synthWavetableMenuActions;
std::vector<SynthWavetableMenuFolderNode*> synthWavetableMenuFolders;
std::vector<char*> synthWavetableMenuLabels;
bool synthWavetableMenuRebuildPending = false;

void updateCurrentSynthWavetableMenuLabel() {
  const char* name = loadedSynthWavetableName[0] ? loadedSynthWavetableName : currentSynthWavetableName;
  const char* folder = loadedSynthWavetableFolderPath[0] ? loadedSynthWavetableFolderPath : currentSynthWavetableFolderPath;
  if (!name || !name[0]) {
    name = SYNTH_WAVETABLE_BASIC_NAME;
  }
  if (!folder || !folder[0]
      || strcmp(folder, SYNTH_WAVETABLE_BUILTIN_FOLDER) == 0
      || strcmp(folder, SYNTH_WAVETABLE_ROOT_FOLDER) == 0) {
    snprintf(currentSynthWavetableMenuLabel, sizeof(currentSynthWavetableMenuLabel), "WT:%s", name);
  } else {
    snprintf(currentSynthWavetableMenuLabel,
             sizeof(currentSynthWavetableMenuLabel),
             "WT:%s/%s",
             folder,
             name);
  }
}

char* cloneSynthWavetableMenuText(const char* text) {
  size_t length = strlen(text);
  char* copy = new char[length + 1];
  memcpy(copy, text, length + 1);
  synthWavetableMenuLabels.push_back(copy);
  return copy;
}

SynthWavetableMenuAction* createSynthWavetableMenuAction(bool builtIn, uint16_t wavetableIndex) {
  SynthWavetableMenuAction* action = new SynthWavetableMenuAction{};
  action->builtIn = builtIn;
  action->wavetableIndex = wavetableIndex;
  synthWavetableMenuActions.push_back(action);
  return action;
}

void loadSynthWavetableMenu(GEMCallbackData callbackData) {
  SynthWavetableMenuAction* action = reinterpret_cast<SynthWavetableMenuAction*>(callbackData.valPointer);
  bool selected = false;
  if (action && action->builtIn) {
    const BuiltinSynthWavetableDefinition* wavetable = synthBuiltinWavetableAt(action->wavetableIndex);
    if (wavetable) {
      setCurrentSynthWavetableReference(wavetable->folderPath, wavetable->name);
      selected = true;
    }
  } else if (action && action->wavetableIndex < synthWavetables.size() && synthWavetables[action->wavetableIndex].valid) {
    SynthWavetableSlot& wavetable = synthWavetables[action->wavetableIndex];
    setCurrentSynthWavetableReference(wavetable.folderPath, wavetable.name);
    selected = true;
  }

  if (selected) {
    currWave = WAVEFORM_BASIC_WAVETABLE;
    settings[static_cast<uint8_t>(SettingKey::Waveform)] = WAVEFORM_BASIC_WAVETABLE;
    loadSelectedSynthWavetable();
    updateCurrentSynthWavetableMenuLabel();
    flashSafeSaveCurrentSynthWavetableReference();
    markSettingsDirty();
  }
  menuSynthOptionsHome();
}

void addSynthWavetableMenuButton(GEMPage& page, const char* label, SynthWavetableMenuAction* action) {
  GEMItem* item = new GEMItem(cloneSynthWavetableMenuText(label), loadSynthWavetableMenu, reinterpret_cast<void*>(action));
  synthWavetableMenuItems.push_back(item);
  page.addMenuItem(*item);
}

SynthWavetableMenuFolderNode* findSynthWavetableMenuFolder(const char* folderPath) {
  for (SynthWavetableMenuFolderNode* folder : synthWavetableMenuFolders) {
    if (strncmp(folder->path, folderPath, sizeof(folder->path)) == 0) {
      return folder;
    }
  }
  return nullptr;
}

void parentSynthWavetableFolderPath(const char* folderPath, char* output, size_t outputLength) {
  if (outputLength == 0) {
    return;
  }
  const char* slash = strrchr(folderPath, '/');
  if (!slash) {
    snprintf(output, outputLength, "%s", SYNTH_WAVETABLE_ROOT_FOLDER);
  } else {
    size_t length = std::min(static_cast<size_t>(slash - folderPath), outputLength - 1);
    memcpy(output, folderPath, length);
    output[length] = '\0';
    normalizeSynthWavetableFolderPath(output, outputLength);
  }
}

void synthWavetableFolderLabel(const char* folderPath, char* output, size_t outputLength) {
  synthPresetFolderLabel(folderPath, output, outputLength);
}

SynthWavetableMenuFolderNode* ensureSynthWavetableMenuFolder(const char* folderPath) {
  char normalized[SYNTH_WAVETABLE_FOLDER_LENGTH] = {};
  snprintf(normalized, sizeof(normalized), "%s", folderPath && folderPath[0] ? folderPath : SYNTH_WAVETABLE_ROOT_FOLDER);
  normalizeSynthWavetableFolderPath(normalized, sizeof(normalized));
  if (strcmp(normalized, SYNTH_WAVETABLE_ROOT_FOLDER) == 0) {
    return nullptr;
  }

  SynthWavetableMenuFolderNode* existing = findSynthWavetableMenuFolder(normalized);
  if (existing) {
    return existing;
  }

  char parentPath[SYNTH_WAVETABLE_FOLDER_LENGTH] = {};
  parentSynthWavetableFolderPath(normalized, parentPath, sizeof(parentPath));
  SynthWavetableMenuFolderNode* parent = ensureSynthWavetableMenuFolder(parentPath);
  GEMPage& loadParent = parent ? *parent->loadPage : menuPageSynthWavetableLoad;

  SynthWavetableMenuFolderNode* folder = new SynthWavetableMenuFolderNode{};
  snprintf(folder->path, sizeof(folder->path), "%s", normalized);
  synthWavetableFolderLabel(normalized, folder->label, sizeof(folder->label));
  folder->loadPage = new GEMPage(folder->label, loadParent);
  synthWavetableMenuPages.push_back(folder->loadPage);
  synthWavetableMenuFolders.push_back(folder);

  GEMItem* loadGoto = new GEMItem(folder->label, *folder->loadPage);
  synthWavetableMenuItems.push_back(loadGoto);
  loadParent.addMenuItem(*loadGoto);
  return folder;
}

void clearSynthWavetableMenuItems() {
  for (GEMItem* item : synthWavetableMenuItems) {
    item->remove();
    delete item;
  }
  synthWavetableMenuItems.clear();

  for (GEMPage* page : synthWavetableMenuPages) {
    delete page;
  }
  synthWavetableMenuPages.clear();

  for (SynthWavetableMenuAction* action : synthWavetableMenuActions) {
    delete action;
  }
  synthWavetableMenuActions.clear();

  for (SynthWavetableMenuFolderNode* folder : synthWavetableMenuFolders) {
    delete folder;
  }
  synthWavetableMenuFolders.clear();

  for (char* label : synthWavetableMenuLabels) {
    delete[] label;
  }
  synthWavetableMenuLabels.clear();
}

bool synthWavetableMenuOwnsPage(GEMPage* page) {
  if (page == &menuPageSynthWavetableLoad) {
    return true;
  }
  for (GEMPage* ownedPage : synthWavetableMenuPages) {
    if (page == ownedPage) {
      return true;
    }
  }
  return false;
}

void requestSynthWavetableMenuRebuild() {
  synthWavetableMenuRebuildPending = true;
}

GEMPage& synthWavetableLoadPageForFolder(const char* folderPath) {
  SynthWavetableMenuFolderNode* folder = ensureSynthWavetableMenuFolder(folderPath);
  return folder ? *folder->loadPage : menuPageSynthWavetableLoad;
}

void rebuildSynthWavetableMenuItems() {
  clearSynthWavetableMenuItems();
  updateCurrentSynthWavetableMenuLabel();

  for (size_t i = 0; i < synthBuiltinWavetableCount(); ++i) {
    const BuiltinSynthWavetableDefinition* wavetable = synthBuiltinWavetableAt(i);
    if (!wavetable) {
      continue;
    }
    GEMPage& loadPage = synthWavetableLoadPageForFolder(wavetable->folderPath);
    addSynthWavetableMenuButton(loadPage,
                                wavetable->name,
                                createSynthWavetableMenuAction(true, static_cast<uint16_t>(i)));
  }

  compactSynthWavetables();
  for (size_t i = 0; i < synthWavetables.size(); ++i) {
    SynthWavetableSlot& wavetable = synthWavetables[i];
    if (!wavetable.valid) {
      continue;
    }
    GEMPage& loadPage = synthWavetableLoadPageForFolder(wavetable.folderPath);
    addSynthWavetableMenuButton(loadPage,
                                wavetable.name,
                                createSynthWavetableMenuAction(false, static_cast<uint16_t>(i)));
  }
}

void createSynthWavetableMenuItems() {
  rebuildSynthWavetableMenuItems();
}

void serviceSynthWavetableMenuRebuild() {
  if (!synthWavetableMenuRebuildPending) {
    return;
  }
  synthWavetableMenuRebuildPending = false;
  updateCurrentSynthWavetableMenuLabel();
  if (synthWavetableMenuOwnsPage(menu.getCurrentMenuPage())) {
    menu.setMenuPageCurrent(menuPageSynth);
  }
  rebuildSynthWavetableMenuItems();
  if (menu.getCurrentMenuPage() == &menuPageSynth) {
    menu.drawMenu();
  }
}
/*
    We are now creating some GEMItems that let you
    1) select a value from a list of options,
    2) update a given variable based on what was chosen,
    3) if necessary, run a procedure as well once the value's chosen.

    The list of options is in the form of a 2-d array.
    There are A arrays, one for each option.
    Each is 2 entries long. First entry is the label
    for that choice, second entry is the value associated.

    These arrays go into a typedef that depends on the type of the variable
    being selected (i.e. Byte for small positive integers; Int for
    sign-dependent and large integers).

    Then that typeDef goes into a GEMSelect object, with parameters
    equal to the number of entries in the array, and the storage size of one element
    in the array. The GEMSelect object is basically just a pointer to the
    array of choices. The GEMItem then takes the GEMSelect pointer as a parameter.

    The fact that GEM expects pointers and references makes it tricky
    to work with if you are new to C++.
  */
// SETTINGS STEP 4 - Now add the menu item starting with a callback as below.
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

// For "Invert Encoder" which is a bool tick box.
// We want to store its value persistently in the RotaryInvert setting.
// Create a global variable that reflects its current state.
bool rotaryInvert = settingEnabled(SettingKey::RotaryInvert);
// Create a PersistentCallbackInfo instance for this setting.
PersistentCallbackInfo callbackInfoRotary = {
  static_cast<uint8_t>(SettingKey::RotaryInvert),
  reinterpret_cast<void*>(&rotaryInvert),
  nullptr,
  nullptr
};
GEMItem menuItemRotary("Invert Encoder", rotaryInvert, universalSaveCallback, reinterpret_cast<void*>(&callbackInfoRotary));

PersistentCallbackInfo callbackInfoDebug = {
  static_cast<uint8_t>(SettingKey::Debug),
  reinterpret_cast<void*>(&debugMessages),
  nullptr,
  nullptr
};
GEMItem menuItemDebug("Serial Debug", debugMessages, universalSaveCallback, reinterpret_cast<void*>(&callbackInfoDebug));

void isrProfileMenuCallback(GEMCallbackData /*callbackData*/) {
  if (isrProfileMenuEnabled) {
    startISRProfileCapture();
  } else {
    stopISRProfileCaptureAndLog();
  }
}
GEMItem menuItemISRProfile("ISR Profile", isrProfileMenuEnabled, isrProfileMenuCallback);

PersistentCallbackInfo callbackInfoDisplayPlayedNotes = {
  static_cast<uint8_t>(SettingKey::DisplayPlayedNotes),
  reinterpret_cast<void*>(&displayPlayedNotes),
  nullptr,
  onToggleDisplayPlayedNotes
};
GEMItem menuItemDisplayPlayedNotes("DisplayNotes", displayPlayedNotes, universalSaveCallback, reinterpret_cast<void*>(&callbackInfoDisplayPlayedNotes));

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
PersistentCallbackInfo callbackInfoHeadphoneVolumeCap = {
  static_cast<uint8_t>(SettingKey::HeadphoneVolumeCap),
  reinterpret_cast<void*>(&headphoneVolumeCap),
  nullptr,
  nullptr
};
GEMItem menuItemHeadphoneVolumeCap("HP Vol Cap", headphoneVolumeCap, selectHeadphoneVolumeCap, universalSaveCallback,
                                   reinterpret_cast<void*>(&callbackInfoHeadphoneVolumeCap));
void previewHeadphoneVolumeCap(GEMPreviewCallbackData previewData) {
  headphoneVolumeCap = previewData.previewValByte;
}

SelectOptionByte optionByteSynthOutputSmoothing[] = {
  { "Off", SYNTH_OUTPUT_SMOOTHING_OFF },
  { "1", 1 },
  { "2", 2 },
  { "3", 3 },
  { "4", 4 },
  { "5", 5 },
  { "6", 6 },
  { "7", 7 },
  { "8", SYNTH_OUTPUT_SMOOTHING_MAX }
};
GEMSelect selectSynthOutputSmoothing(sizeof(optionByteSynthOutputSmoothing) / sizeof(SelectOptionByte), optionByteSynthOutputSmoothing);
PersistentCallbackInfo callbackInfoSynthOutputSmoothing = {
  static_cast<uint8_t>(SettingKey::SynthOutputSmoothing),
  reinterpret_cast<void*>(&synthOutputSmoothing),
  nullptr,
  nullptr
};
GEMItem menuItemSynthOutputSmoothing("Out Smooth", synthOutputSmoothing, selectSynthOutputSmoothing, universalSaveCallback,
                                     reinterpret_cast<void*>(&callbackInfoSynthOutputSmoothing));
void previewSynthOutputSmoothing(GEMPreviewCallbackData previewData) {
  synthOutputSmoothing = previewData.previewValByte;
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
  syncAudioDestinationToRuntime
};
GEMItem menuItemAudioD("Buzzer", synthBuzzerEnabled, universalSaveCallback,
                       reinterpret_cast<void*>(&callbackInfoAudioDest));

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
GEMItem mirrorLeftRightGEMItem("Mirror Ver.", mirrorLeftRight, universalSaveCallback,
                                reinterpret_cast<void*>(&callbackInfoMirrorLR));

PersistentCallbackInfo callbackInfoMirrorUD = {
  static_cast<uint8_t>(SettingKey::MirrorUpDown),
  reinterpret_cast<void*>(&mirrorUpDown),
  nullptr,
  updateLayoutAndRotate
};
GEMItem mirrorUpDownGEMItem("Mirror Hor.", mirrorUpDown, universalSaveCallback,
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

SelectOptionByte optionByteColor[] = { { "Rainbow", RAINBOW_MODE }, { "Diatonic", DIATONIC_COLOR_MODE }, { "Alt", ALTERNATE_COLOR_MODE }, { "Fifths", RAINBOW_OF_FIFTHS_MODE }, { "Piano", PIANO_COLOR_MODE }, { "Alt Piano", PIANO_ALT_COLOR_MODE }, { "Filament", PIANO_INCANDESCENT_COLOR_MODE }, { "Tiered", TIERED_COLOR_MODE } };
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
  { "BasicTb", WAVEFORM_BASIC_WAVETABLE },
  { "UserTbl", WAVEFORM_USER_WAVETABLE }
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
  { "1", 0 },
  { "2", 4 },
  { "3", 8 },
  { "4", 12 },
  { "5", 16 },
  { "6", 20 },
  { "7", 25 },
  { "8", 29 },
  { "9", 33 },
  { "10", 37 },
  { "11", 41 },
  { "12", 45 },
  { "13", 49 },
  { "14", 53 },
  { "15", 57 },
  { "16", 61 },
  { "17", 66 },
  { "18", 70 },
  { "19", 74 },
  { "20", 78 },
  { "21", 82 },
  { "22", 86 },
  { "23", 90 },
  { "24", 94 },
  { "25", 98 },
  { "26", 102 },
  { "27", 107 },
  { "28", 111 },
  { "29", 115 },
  { "30", 119 },
  { "31", 123 },
  { "32", 127 }
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
  { "12 Hz", 11 }
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
  { "Square", SYNTH_LFO_WAVE_SQUARE }
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
  { "Off", SYNTH_FX_AMOUNT_OFF },
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

GEMItem menuItemEnvelopeAttack("Amp Atk", envelopeAttackIndex, selectEnvelopeAttack, universalSaveCallback,
                               reinterpret_cast<void*>(&callbackInfoEnvelopeAttack));
void previewEnvelopeAttack(GEMPreviewCallbackData previewData) {
  envelopeAttackIndex = previewData.previewValByte;
  updateEnvelopeParamsFromSettings();
}
GEMItem menuItemEnvelopeHold("Amp Hold", envelopeHoldIndex, selectEnvelopeHold, universalSaveCallback,
                             reinterpret_cast<void*>(&callbackInfoEnvelopeHold));
void previewEnvelopeHold(GEMPreviewCallbackData previewData) {
  envelopeHoldIndex = previewData.previewValByte;
  updateEnvelopeParamsFromSettings();
}
GEMItem menuItemEnvelopeDecay("Amp Dec", envelopeDecayIndex, selectEnvelopeDecay, universalSaveCallback,
                              reinterpret_cast<void*>(&callbackInfoEnvelopeDecay));
void previewEnvelopeDecay(GEMPreviewCallbackData previewData) {
  envelopeDecayIndex = previewData.previewValByte;
  updateEnvelopeParamsFromSettings();
}
GEMItem menuItemEnvelopeSustain("Amp Sus", envelopeSustainLevel, selectEnvelopeSustain, universalSaveCallback,
                                reinterpret_cast<void*>(&callbackInfoEnvelopeSustain));
void previewEnvelopeSustain(GEMPreviewCallbackData previewData) {
  envelopeSustainLevel = previewData.previewValByte;
  updateEnvelopeParamsFromSettings();
}
GEMItem menuItemEnvelopeRelease("Amp Rel", envelopeReleaseIndex, selectEnvelopeRelease, universalSaveCallback,
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

void updateTuningMenuVisibility() {
  byte currentIndex = menuPageTuning.getCurrentMenuItemIndex();

  menuItemSelectDynamicJIRatioTable.hide(!useDynamicJustIntonation);
  menuItemSetJI_BPM.hide(!useJustIntonationBPM);
  menuItemSetJI_BPM_Multiplier.hide(!useJustIntonationBPM);

  byte itemCount = menuPageTuning.getItemsCount();
  if (itemCount > 0) {
    if (currentIndex >= itemCount) {
      currentIndex = itemCount - 1;
    }
    menuPageTuning.setCurrentMenuItemIndex(currentIndex);
  }
}

void tuningIntonationModeChanged() {
  updateTuningMenuVisibility();
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

// --------------------------------------------------------
// SETTINGS STEP 3 - Callback to sync settings variables on power-up
// --------------------------------------------------------
void syncSettingsToRuntime() {
  debugMessages = settingEnabled(SettingKey::Debug);
  rotaryInvert = settingEnabled(SettingKey::RotaryInvert);
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
  transposeSteps = decodeBiasedSetting(SettingKey::CurrentTransposeSteps);
  current.transpose = transposeSteps;
  current.keyStepsFromA = decodeBiasedSetting(SettingKey::CurrentKeyStepsFromA);
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

  playbackMode = normalizeSynthPlaybackMode(settingValue(SettingKey::PlaybackMode));
  settings[static_cast<uint8_t>(SettingKey::PlaybackMode)] = playbackMode;
  currWave = settingValue(SettingKey::Waveform);
  synthWavetablePosition = settingValue(SettingKey::SynthWavetablePosition);
  if (!currentSynthWavetableReferenceValid) {
    selectCompatibilitySynthWavetableForLegacyWaveform(currWave, true);
    settings[static_cast<uint8_t>(SettingKey::SynthWavetablePosition)] = synthWavetablePosition;
  }
  loadSelectedSynthWavetable();
  updateCurrentSynthWavetableMenuLabel();
  synthDrive = settingValue(SettingKey::SynthDrive);
  if (synthDrive > SYNTH_DRIVE_DIRTY) {
    synthDrive = SYNTH_DRIVE_OFF;
  }
  synthModTarget = settingValue(SettingKey::SynthModTarget);
  synthModAmount = settingValue(SettingKey::SynthModAmount);
  synthVibratoSpeed = settingValue(SettingKey::SynthVibratoSpeed);
  synthLfoTarget = settingValue(SettingKey::SynthLfoTarget);
  synthLfoAmount = settingValue(SettingKey::SynthLfoAmount);
  synthLfoWave = settingValue(SettingKey::SynthLfoWave);
  synthLfoSpeed = settingValue(SettingKey::SynthLfoSpeed);
  synthBuzzerEnabled = decodeStoredBuzzerEnabled(settingValue(SettingKey::AudioDestination));
  syncAudioDestinationToRuntime();
  headphoneVolumeCap = settingValue(SettingKey::HeadphoneVolumeCap);
  if (headphoneVolumeCap > HEADPHONE_VOLUME_CAP_FULL) {
    headphoneVolumeCap = HEADPHONE_VOLUME_CAP_FULL;
  }
  synthOutputSmoothing = settingValue(SettingKey::SynthOutputSmoothing);
  if (synthOutputSmoothing > SYNTH_OUTPUT_SMOOTHING_MAX) {
    synthOutputSmoothing = SYNTH_OUTPUT_SMOOTHING_OFF;
  }
  arpeggiatorDivision = settingValue(SettingKey::ArpeggiatorDivision);
  if (arpeggiatorDivision == 0) {
    arpeggiatorDivision = 1;
  }
  arpeggiatorDirection = settingValue(SettingKey::ArpeggiatorDirection);
  updateArpeggiatorDirection();
  synthBPM = settingValue(SettingKey::SynthBPM);
  if (synthBPM == 0) {
    synthBPM = 1;
  }
  synthPortamentoTimeIndex = settingValue(SettingKey::SynthPortamentoTimeIndex);
  updateSynthPortamentoSettings();
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
  updateTuningMenuVisibility();
  envelopeAttackIndex = settingValue(SettingKey::EnvelopeAttackIndex);
  envelopeHoldIndex = settingValue(SettingKey::EnvelopeHoldIndex);
  envelopeDecayIndex = settingValue(SettingKey::EnvelopeDecayIndex);
  envelopeSustainLevel = settingValue(SettingKey::EnvelopeSustainLevel);
  envelopeReleaseIndex = settingValue(SettingKey::EnvelopeReleaseIndex);
  effectEnvelopeAttackIndex[0] = settingValue(SettingKey::EffectEnvelopeAttackIndex);
  effectEnvelopeHoldIndex[0] = settingValue(SettingKey::EffectEnvelopeHoldIndex);
  effectEnvelopeDecayIndex[0] = settingValue(SettingKey::EffectEnvelopeDecayIndex);
  effectEnvelopeSustainLevel[0] = settingValue(SettingKey::EffectEnvelopeSustainLevel);
  effectEnvelopeReleaseIndex[0] = settingValue(SettingKey::EffectEnvelopeReleaseIndex);
  effectEnvelopeTarget[0] = settingValue(SettingKey::EffectEnvelopeTarget);
  effectEnvelopeAmount[0] = settingValue(SettingKey::EffectEnvelopeAmount);
  effectEnvelopeTarget[1] = settingValue(SettingKey::EffectEnvelope2Target);
  effectEnvelopeAmount[1] = settingValue(SettingKey::EffectEnvelope2Amount);
  effectEnvelopeAttackIndex[1] = settingValue(SettingKey::EffectEnvelope2AttackIndex);
  effectEnvelopeHoldIndex[1] = settingValue(SettingKey::EffectEnvelope2HoldIndex);
  effectEnvelopeDecayIndex[1] = settingValue(SettingKey::EffectEnvelope2DecayIndex);
  effectEnvelopeSustainLevel[1] = settingValue(SettingKey::EffectEnvelope2SustainLevel);
  effectEnvelopeReleaseIndex[1] = settingValue(SettingKey::EffectEnvelope2ReleaseIndex);
  bootAnimationEnabled = settingEnabled(SettingKey::BootAnimationEnabled);
  displayPlayedNotes = settingEnabled(SettingKey::DisplayPlayedNotes);
  updateSynthModulationParams();
  updateEnvelopeParamsFromSettings();
  updateEffectEnvelopeParamsFromSettings();
  updateArpeggiatorTiming();
  updateSynthMenuVisibility();

  // Now *apply* them to the engine/UI:
  refreshMenuChoicesForCurrentTuning();
  rebuildRuntimeStateFromCurrentSelection();
  if (programChange > 0) {
    sendProgramChange();
  }
  menuHome();                    // Refresh main screen to match rotation
}

// Call this procedure to return to the main menu
void menuHome() {
  menu.setMenuPageCurrent(menuPageMain);
  menu.drawMenu();
}

void menuSynthOptionsHome() {
  menu.setMenuPageCurrent(menuPageSynth);
  menu.drawMenu();
}

void refreshMenuChoicesForCurrentTuning() {
  showOnlyValidLayoutChoices();
  showOnlyValidScaleChoices();
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

void rebootToBootloader() {
  menu.setMenuPageCurrent(menuPageReboot);
  menu.drawMenu();
  strip.clear();
  strip.show();
  rp2040.rebootToBootloader();
}
/*
    This procedure sets each layout menu item to be either
    visible if that layout is available in the current tuning,
    or hidden if not.

    It should run once after the layout menu items are
    generated, and then once any time the tuning changes.
  */
void showOnlyValidLayoutChoices() {
  for (byte L = 0; L < layoutCount; L++) {
    menuItemLayout[L]->hide((layoutOptions[L].tuning != current.tuningIndex));
  }
  sendToLog("menu: Layout choices were updated.");
}
/*
    This procedure sets each scale menu item to be either
    visible if that scale is available in the current tuning,
    or hidden if not.

    It should run once after the scale menu items are
    generated, and then once any time the tuning changes.
  */
void showOnlyValidScaleChoices() {
  for (int S = 0; S < scaleCount; S++) {
    menuItemScales[S]->hide((scaleOptions[S].tuning != current.tuningIndex) && (scaleOptions[S].tuning != ALL_TUNINGS));
  }
  sendToLog("menu: Scale choices were updated.");
}
/*
    This procedure sets each key spinner menu item to be either
    visible if the key names correspond to the current tuning,
    or hidden if not.

    It should run once after the key selectors are
    generated, and then once any time the tuning changes.
  */
void showOnlyValidKeyChoices() {
  for (int T = 0; T < TUNINGCOUNT; T++) {
    menuItemKeys[T]->hide((T != current.tuningIndex));
  }
  sendToLog("menu: Key choices were updated.");
}

void updateLayoutAndRotate() {
  applyLayout();
  applyDeviceDisplayRotation();
}

void loadDeviceRotationFromCurrentLayout() {
  deviceRotation = defaultDeviceRotationForLayout(current.layout().isPortrait);
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
    This procedure is run when a layout is selected via the menu.
    It sets the current layout to the selected value.
    If it's different from the previous one, then
    re-apply the layout to the grid. In any case, go to the
    main menu when done.
  */
void changeLayout(GEMCallbackData callbackData) {
  byte selection = callbackData.valByte;
  bool hadUserGeometryRuntime = userGeometryRuntimeActive;
  if (hadUserGeometryRuntime) {
    clearUserGeometryRuntimeSelection();
    current.keyStepsFromA = current.tuning().spanCtoA();
    settings[static_cast<uint8_t>(SettingKey::CurrentKeyStepsFromA)] = uint8_t(current.keyStepsFromA + 128);
  }
  if (selection != current.layoutIndex || hadUserGeometryRuntime) {
    current.layoutIndex = selection;
    settings[static_cast<uint8_t>(SettingKey::CurrentLayout)] = selection;
    loadDeviceRotationFromCurrentLayout();
    markSettingsDirty();
    updateLayoutAndRotate();
  }
  menuHome();
}
/*
    This procedure is run when a scale is selected via the menu.
    It sets the current scale to the selected value.
    If it's different from the previous one, then
    re-apply the scale to the grid. In any case, go to the
    main menu when done.
  */
void changeScale(GEMCallbackData callbackData) {  // when you change the scale via the menu
  int selection = callbackData.valInt;
  bool hadUserGeometryRuntime = userGeometryRuntimeActive;
  if (hadUserGeometryRuntime) {
    clearUserGeometryRuntimeSelection();
    current.keyStepsFromA = current.tuning().spanCtoA();
    settings[static_cast<uint8_t>(SettingKey::CurrentKeyStepsFromA)] = uint8_t(current.keyStepsFromA + 128);
  }
  if (selection != current.scaleIndex || hadUserGeometryRuntime) {
    current.scaleIndex = selection;
    settings[static_cast<uint8_t>(SettingKey::CurrentScale)] = selection;
    applyScale();
  }
  menuHome();
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
  // 1) Save to flash (biased by +128):
  settings[static_cast<uint8_t>(SettingKey::CurrentKeyStepsFromA)] = uint8_t(current.keyStepsFromA + 128);
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
/*
    This procedure is run when the tuning is changed via the menu.
    It affects almost everything in the program, so
    quite a few items are reset, refreshed, and redone
    when the tuning changes.
  */
void changeTuning(GEMCallbackData callbackData) {
  byte selection = callbackData.valByte;
  bool hadUserGeometryRuntime = userGeometryRuntimeActive;
  if (hadUserGeometryRuntime) {
    clearUserGeometryRuntimeSelection();
  }
  if (selection != current.tuningIndex || hadUserGeometryRuntime) {
    // 1) Update runtime state
    current.tuningIndex = selection;
    current.layoutIndex = current.layoutsBegin();         // reset layout to first in list
    current.scaleIndex = 0;                               // reset scale to "no scale"
    current.keyStepsFromA = current.tuning().spanCtoA();  // reset key to C
    // 2) Copy and save all values to settings
    settings[static_cast<uint8_t>(SettingKey::CurrentTuning)]        = current.tuningIndex;
    settings[static_cast<uint8_t>(SettingKey::CurrentLayout)]        = current.layoutIndex;
    settings[static_cast<uint8_t>(SettingKey::CurrentScale)]         = current.scaleIndex;
    // bias the signed keyStepsFromA by +128
    settings[static_cast<uint8_t>(SettingKey::CurrentKeyStepsFromA)] = uint8_t(current.keyStepsFromA + 128);
    loadDeviceRotationFromCurrentLayout();
    markSettingsDirty();                                  // auto‑save (after debounce)
    // 3) Apply all values
    refreshMenuChoicesForCurrentTuning();                 // change list of choices in GEM Menu
    rebuildRuntimeStateFromCurrentSelection();
  }
  menuHome();
}
/*
    The procedure below builds menu items for tuning,
    layout, scales, and keys based on what's preloaded.
    We already declared arrays of menu item objects earlier.
    Now we cycle through those arrays, and create GEMItem objects for
    each index. What's nice about doing this in an array is,
    we do not have to assign a variable name to each object; we just
    refer to it by its index in the array.

    The constructor "new GEMItem" is populated with the different
    variables in the preset objects we defined earlier.
    Then the menu item is added to the associated page.
    The item must be entered with the asterisk operator
    because an array index technically returns an address in memory
    pointing to the object; the addMenuItem procedure wants
    the contents of that item, which is what the * beforehand does.
  */
void createTuningMenuItems() {
  for (byte T = 0; T < TUNINGCOUNT; T++) {
    menuItemTuning[T] = new GEMItem(tuningOptions[T].name.c_str(), changeTuning, T);
    menuPageTuning.addMenuItem(*menuItemTuning[T]);
  }
}
void createLayoutMenuItems() {
  for (byte L = 0; L < layoutCount; L++) {  // create pointers to all layouts
    menuItemLayout[L] = new GEMItem(layoutOptions[L].name.c_str(), changeLayout, L);
    menuPageLayout.addMenuItem(*menuItemLayout[L]);
  }
  showOnlyValidLayoutChoices();
}
void previewKey(GEMPreviewCallbackData previewData);
void createKeyMenuItems() {
  for (byte T = 0; T < TUNINGCOUNT; T++) {
    selectKey[T] = new GEMSelect(tuningOptions[T].cycleLength, tuningOptions[T].keyChoices);
    menuItemKeys[T] = new GEMItem("Key", current.keyStepsFromA, *selectKey[T], changeKey);
    menuItemKeys[T]->setPreviewCallback(previewKey);
    menuPageScales.addMenuItem(*menuItemKeys[T]);
  }
  showOnlyValidKeyChoices();
}
void previewKey(GEMPreviewCallbackData previewData) {
  current.keyStepsFromA = previewData.previewValInt;
  applyScale();
}
void createScaleMenuItems() {
  for (int S = 0; S < scaleCount; S++) {  // create pointers to all scale items, filter them as you go
    menuItemScales[S] = new GEMItem(scaleOptions[S].name.c_str(), changeScale, S);
    menuPageScales.addMenuItem(*menuItemScales[S]);
  }
  showOnlyValidScaleChoices();
}

void createProfileMenuItems() {
  for (uint8_t i = 0; i < PROFILE_COUNT; ++i) {
    if (i == 0) {
      snprintf(saveProfileLabels[i], sizeof(saveProfileLabels[i]), "Boot/Auto-Save Slot");
    } else {
      snprintf(saveProfileLabels[i], sizeof(saveProfileLabels[i]), "Slot %u", static_cast<unsigned>(i));
    }
    menuItemSaveProfile[i] = new GEMItem(saveProfileLabels[i], saveProfileMenu, i);
    menuPageSave.addMenuItem(*menuItemSaveProfile[i]);
  }
  for (uint8_t i = 0; i < PROFILE_COUNT; ++i) {
    if (i == 0) {
      snprintf(loadProfileLabels[i], sizeof(loadProfileLabels[i]), "Boot/Auto-Save Slot");
    } else {
      snprintf(loadProfileLabels[i], sizeof(loadProfileLabels[i]), "Slot %u", static_cast<unsigned>(i));
    }
    menuItemLoadProfile[i] = new GEMItem(loadProfileLabels[i], loadProfileMenu, i);
    menuPageLoad.addMenuItem(*menuItemLoadProfile[i]);
  }
}

void createSynthPresetMenuItems() {
  rebuildSynthPresetMenuItems();
}

void setupTuningMenuPage() {
  menuPageMain.addMenuItem(menuGotoTuning);
  createTuningMenuItems();
  menuPageTuning.addMenuItem(menuItemToggleDynamicJI);
  menuPageTuning.addMenuItem(menuItemSelectDynamicJIRatioTable);
  menuPageTuning.addMenuItem(menuItemToggleJI_BPM);
  menuPageTuning.addMenuItem(menuItemSetJI_BPM);
  menuPageTuning.addMenuItem(menuItemSetJI_BPM_Multiplier);
  updateTuningMenuVisibility();
}

void setupLayoutMenuPage() {
  menuPageMain.addMenuItem(menuGotoLayout);
  createLayoutMenuItems();
  menuPageLayout.addMenuItem(mirrorLeftRightGEMItem);
  menuPageLayout.addMenuItem(mirrorUpDownGEMItem);
  menuPageLayout.addMenuItem(menuItemSelectLayoutRotation);
  menuPageLayout.addMenuItem(menuItemSelectDeviceRotation);
}

void setupScalesMenuPage() {
  menuPageMain.addMenuItem(menuGotoScales);
  createKeyMenuItems();
  menuPageScales.addMenuItem(menuItemScaleLock);
  createScaleMenuItems();
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

void setupSynthMenuPage() {
  menuPageMain.addMenuItem(menuGotoSynth);
  menuPageSynth.addMenuItem(menuItemPlayback);
  // menuItemAudioD added here for hardware V1.2
  addPreviewMenuItem(menuPageSynth, menuItemArpSpeed, previewArpSpeed);
  addPreviewMenuItem(menuPageSynth, menuItemArpDirection, previewArpDirection);
  addPreviewMenuItem(menuPageSynth, menuItemPortamentoTime, previewPortamentoTime);
  updateCurrentSynthWavetableMenuLabel();
  menuPageSynth.addMenuItem(menuGotoSynthWavetableLoad);
  addPreviewMenuItem(menuPageSynth, menuItemSynthWavetablePosition, previewSynthWavetablePosition);
  addPreviewMenuItem(menuPageSynth, menuItemSynthDrive, previewSynthDrive);
  addPreviewMenuItem(menuPageSynth, menuItemSynthOutputSmoothing, previewSynthOutputSmoothing);
  addPreviewMenuItem(menuPageSynth, menuItemSynthModTarget, previewSynthModTarget);
  addPreviewMenuItem(menuPageSynth, menuItemSynthModAmount, previewSynthModAmount);
  addPreviewMenuItem(menuPageSynth, menuItemSynthVibratoSpeed, previewSynthVibratoSpeed);
  addPreviewMenuItem(menuPageSynth, menuItemEnvelopeAttack, previewEnvelopeAttack);
  addPreviewMenuItem(menuPageSynth, menuItemEnvelopeHold, previewEnvelopeHold);
  addPreviewMenuItem(menuPageSynth, menuItemEnvelopeDecay, previewEnvelopeDecay);
  addPreviewMenuItem(menuPageSynth, menuItemEnvelopeSustain, previewEnvelopeSustain);
  addPreviewMenuItem(menuPageSynth, menuItemEnvelopeRelease, previewEnvelopeRelease);
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
  addPreviewMenuItem(menuPageSynth, menuItemSynthBPM, previewSynthBPM);
  addPreviewMenuItem(menuPageSynth, menuItemMetronomeMode, previewMetronomeMode);
  addPreviewMenuItem(menuPageSynth, menuItemMetronomeSignature, previewMetronomeSignature);
  menuPageSynth.addMenuItem(menuGotoSynthPresetSave);
  menuPageSynth.addMenuItem(menuGotoSynthPresetLoad);
  createSynthWavetableMenuItems();
  createSynthPresetMenuItems();
  updateSynthMenuVisibility();
}

void setupMidiMenuPage() {
  menuPageMain.addMenuItem(menuGotoMIDI);
  menuPageMIDI.addMenuItem(menuItemSelectMIDIChannel);
  menuPageMIDI.addMenuItem(menuItemSelectMPEMode);
  menuPageMIDI.addMenuItem(menuItemMPEpitchBend);
  menuPageMIDI.addMenuItem(menuItemSelectMPELowChannel);
  menuPageMIDI.addMenuItem(menuItemSelectMPEHighChannel);
  menuPageMIDI.addMenuItem(menuItemToggleMPELowPriority);
  menuPageMIDI.addMenuItem(menuItemToggleExtraMPE);
  menuPageMIDI.addMenuItem(menuItemSelectCC74value);
  menuPageMIDI.addMenuItem(menuItemRolandMT32);
  menuPageMIDI.addMenuItem(menuItemGeneralMidi);
}

void setupControlMenuPage() {
  menuPageMain.addMenuItem(menuGotoControl);
  addPreviewMenuItem(menuPageControl, menuItemVelSpeed, previewVelSpeed);
  addPreviewMenuItem(menuPageControl, menuItemPBSpeed, previewPBSpeed);
  addPreviewMenuItem(menuPageControl, menuItemModSpeed, previewModSpeed);
  addPreviewMenuItem(menuPageControl, menuItemPBBehave, previewPBBehave);
  addPreviewMenuItem(menuPageControl, menuItemModBehave, previewModBehave);
  addPreviewMenuItem(menuPageMain, menuItemTransposeSteps, previewTranspose);
}

void setupProfileMenuPages() {
  menuPageMain.addMenuItem(menuGotoSave);
  menuPageSave.addMenuItem(menuItemAutoSave);
  menuPageMain.addMenuItem(menuGotoLoad);
  createProfileMenuItems();
}

void setupAdvancedMenuPage() {
  menuPageMain.addMenuItem(menuGotoAdvanced);
  menuPageAdvanced.addMenuItem(menuItemVersion);
  menuPageAdvanced.addMenuItem(menuItemHardware);
  menuPageAdvanced.addMenuItem(menuItemRotary);
  menuPageAdvanced.addMenuItem(menuItemShiftColor);
  menuPageAdvanced.addMenuItem(menuItemDisplayPlayedNotes);
  menuPageAdvanced.addMenuItem(menuItemBootAnimation);
  // menuPageAdvanced.addMenuItem(menuItemWheelAlt); // not sure why we have this, so I'm hiding it for now
  menuPageAdvanced.addMenuItem(menuItemResetDefaults);
  menuPageAdvanced.addMenuItem(menuItemUSBBootloader);
  menuPageAdvanced.addMenuItem(menuItemDebug);
  menuPageAdvanced.addMenuItem(menuItemISRProfile);
  addPreviewMenuItem(menuPageAdvanced, menuItemLedTest, previewLedTest);
}

void setupMenu() {
  initTransposeOptions();
  menu.setSplashDelay(0);
  menu.init();
  menu.invertKeysDuringEdit(true);  // Invert rotary direction when editing a value
  /*
      addMenuItem procedure adds that GEM object to the given page.
      The menu items appear in the order they are added.
      To change the order of the menu, change the order in the code below.
    */
  setupTuningMenuPage();
  setupLayoutMenuPage();
  setupScalesMenuPage();
  setupColorsMenuPage();
  setupSynthMenuPage();
  setupMidiMenuPage();
  setupControlMenuPage();
  setupProfileMenuPages();
  setupAdvancedMenuPage();
}
void setupGFX() {
  u8g2.begin();                      // Menu and graphics setup
  u8g2.setBusClock(1000000);         // Speed up display
  u8g2.setContrast(CONTRAST_AWAKE);  // Set contrast
  sendToLog("U8G2 graphics initialized.");
}
void screenSaver() {
  if (noteOverlayTemporaryWake) {
    if (screenSaverOn) {
      screenSaverOn = 0;
      u8g2.setContrast(CONTRAST_AWAKE);
    }
    return;
  }

  if (screenTime <= screenSaverTimeout) {
    screenTime = screenTime + lapTime;
    if (screenSaverOn) {
      screenSaverOn = 0;
      u8g2.setContrast(CONTRAST_AWAKE);
    }
  } else {
    if (!screenSaverOn) {
      screenSaverOn = 1;
      u8g2.setContrast(CONTRAST_SCREENSAVER);
      u8g2.clear();
    }
  }
}
#endif  // HEXBOARD_FIRMWARE_UNITY
