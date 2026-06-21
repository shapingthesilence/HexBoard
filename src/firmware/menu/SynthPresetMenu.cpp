#include "../FirmwareModule.h"
#include "SynthPresetMenu.h"
#include "MenuAndDisplay.h"
#include "../storage/SynthPresetStorage.h"

namespace {
constexpr uint8_t SYNTH_PRESET_MENU_PAGE_SIZE = 5;

enum class SynthPresetMenuMode : uint8_t {
  Save,
  Load
};

struct SynthPresetMenuAction {
  uint16_t presetIndex = 0;
  int8_t pageDelta = 0;
  bool createNew = false;
  bool loadBlank = false;
  SynthPresetMenuMode mode = SynthPresetMenuMode::Save;
};

void saveSynthPresetMenu(GEMCallbackData callbackData);
void loadSynthPresetMenu(GEMCallbackData callbackData);
void pageSynthPresetMenu(GEMCallbackData callbackData);

struct SynthPresetMenuSlotItem {
  char label[SYNTH_PRESET_MENU_LABEL_LENGTH] = {};
  SynthPresetMenuAction action = {};
  GEMItem item;

  SynthPresetMenuSlotItem(void (*callback)(GEMCallbackData), SynthPresetMenuMode mode)
    : item(label, callback, reinterpret_cast<void*>(&action)) {
    action.mode = mode;
  }
};

char synthPresetSaveNewLabel[] = "New Preset";
char synthPresetLoadBlankLabel[] = "Blank";
char synthPresetPrevLabel[] = "Prev";
char synthPresetNextLabel[] = "Next";

SynthPresetMenuAction synthPresetSaveNewAction = {
  0,
  0,
  true,
  false,
  SynthPresetMenuMode::Save
};
SynthPresetMenuAction synthPresetLoadBlankAction = {
  0,
  0,
  false,
  true,
  SynthPresetMenuMode::Load
};
SynthPresetMenuAction synthPresetSavePrevAction = {
  0,
  -1,
  false,
  false,
  SynthPresetMenuMode::Save
};
SynthPresetMenuAction synthPresetSaveNextAction = {
  0,
  1,
  false,
  false,
  SynthPresetMenuMode::Save
};
SynthPresetMenuAction synthPresetLoadPrevAction = {
  0,
  -1,
  false,
  false,
  SynthPresetMenuMode::Load
};
SynthPresetMenuAction synthPresetLoadNextAction = {
  0,
  1,
  false,
  false,
  SynthPresetMenuMode::Load
};

GEMItem menuItemSaveSynthPresetNew(synthPresetSaveNewLabel,
                                   saveSynthPresetMenu,
                                   reinterpret_cast<void*>(&synthPresetSaveNewAction));
GEMItem menuItemLoadSynthPresetBlank(synthPresetLoadBlankLabel,
                                     loadSynthPresetMenu,
                                     reinterpret_cast<void*>(&synthPresetLoadBlankAction));
GEMItem menuItemSaveSynthPresetPrev(synthPresetPrevLabel,
                                    pageSynthPresetMenu,
                                    reinterpret_cast<void*>(&synthPresetSavePrevAction));
GEMItem menuItemSaveSynthPresetNext(synthPresetNextLabel,
                                    pageSynthPresetMenu,
                                    reinterpret_cast<void*>(&synthPresetSaveNextAction));
GEMItem menuItemLoadSynthPresetPrev(synthPresetPrevLabel,
                                    pageSynthPresetMenu,
                                    reinterpret_cast<void*>(&synthPresetLoadPrevAction));
GEMItem menuItemLoadSynthPresetNext(synthPresetNextLabel,
                                    pageSynthPresetMenu,
                                    reinterpret_cast<void*>(&synthPresetLoadNextAction));

SynthPresetMenuSlotItem synthPresetSaveSlots[SYNTH_PRESET_MENU_PAGE_SIZE] = {
  { saveSynthPresetMenu, SynthPresetMenuMode::Save },
  { saveSynthPresetMenu, SynthPresetMenuMode::Save },
  { saveSynthPresetMenu, SynthPresetMenuMode::Save },
  { saveSynthPresetMenu, SynthPresetMenuMode::Save },
  { saveSynthPresetMenu, SynthPresetMenuMode::Save }
};

SynthPresetMenuSlotItem synthPresetLoadSlots[SYNTH_PRESET_MENU_PAGE_SIZE] = {
  { loadSynthPresetMenu, SynthPresetMenuMode::Load },
  { loadSynthPresetMenu, SynthPresetMenuMode::Load },
  { loadSynthPresetMenu, SynthPresetMenuMode::Load },
  { loadSynthPresetMenu, SynthPresetMenuMode::Load },
  { loadSynthPresetMenu, SynthPresetMenuMode::Load }
};

bool synthPresetMenuItemsCreated = false;
bool synthPresetMenuRebuildPending = false;
uint16_t synthPresetSavePageStart = 0;
uint16_t synthPresetLoadPageStart = 0;

uint16_t synthPresetMenuLastPageStart() {
  size_t presetCount = synthPresets.size();
  if (presetCount <= SYNTH_PRESET_MENU_PAGE_SIZE) {
    return 0;
  }
  return static_cast<uint16_t>(((presetCount - 1) / SYNTH_PRESET_MENU_PAGE_SIZE) * SYNTH_PRESET_MENU_PAGE_SIZE);
}

void clampSynthPresetMenuPageStart(uint16_t& pageStart) {
  uint16_t lastPageStart = synthPresetMenuLastPageStart();
  if (pageStart > lastPageStart) {
    pageStart = lastPageStart;
  }
}

void formatSynthPresetMenuLabel(uint16_t presetIndex, char* output, size_t outputLength) {
  if (outputLength == 0) {
    return;
  }
  output[0] = '\0';
  if (presetIndex >= synthPresets.size()) {
    return;
  }

  SynthPresetSlot& preset = synthPresets[presetIndex];
  if (strcmp(preset.folderPath, SYNTH_PRESET_ROOT_FOLDER) == 0) {
    snprintf(output, outputLength, "%u %s", static_cast<unsigned>(presetIndex + 1), preset.name);
    return;
  }

  char folderLabel[SYNTH_PRESET_MENU_LABEL_LENGTH] = {};
  synthPresetFolderLabel(preset.folderPath, folderLabel, sizeof(folderLabel));
  snprintf(output,
           outputLength,
           "%u %s/%s",
           static_cast<unsigned>(presetIndex + 1),
           folderLabel,
           preset.name);
}

void updateSynthPresetMenuPage(SynthPresetMenuSlotItem* slots,
                               uint16_t pageStart,
                               GEMItem& prevItem,
                               GEMItem& nextItem) {
  bool hasPrevious = pageStart > 0;
  bool hasNext = pageStart + SYNTH_PRESET_MENU_PAGE_SIZE < synthPresets.size();
  prevItem.hide(!hasPrevious);
  nextItem.hide(!hasNext);

  for (uint8_t i = 0; i < SYNTH_PRESET_MENU_PAGE_SIZE; ++i) {
    uint16_t presetIndex = static_cast<uint16_t>(pageStart + i);
    bool visible = presetIndex < synthPresets.size();
    if (visible) {
      formatSynthPresetMenuLabel(presetIndex, slots[i].label, sizeof(slots[i].label));
      slots[i].action.presetIndex = presetIndex;
    } else {
      slots[i].label[0] = '\0';
      slots[i].action.presetIndex = 0;
    }
    slots[i].item.setTitle(slots[i].label);
    slots[i].item.hide(!visible);
  }
}

void updateSynthPresetMenuPages() {
  compactSynthPresets();
  clampSynthPresetMenuPageStart(synthPresetSavePageStart);
  clampSynthPresetMenuPageStart(synthPresetLoadPageStart);
  updateSynthPresetMenuPage(synthPresetSaveSlots,
                            synthPresetSavePageStart,
                            menuItemSaveSynthPresetPrev,
                            menuItemSaveSynthPresetNext);
  updateSynthPresetMenuPage(synthPresetLoadSlots,
                            synthPresetLoadPageStart,
                            menuItemLoadSynthPresetPrev,
                            menuItemLoadSynthPresetNext);
}

void saveSynthPresetMenu(GEMCallbackData callbackData) {
  SynthPresetMenuAction* action = reinterpret_cast<SynthPresetMenuAction*>(callbackData.valPointer);
  if (action) {
    if (action->createNew) {
      saveSynthPresetAsNew(SYNTH_PRESET_ROOT_FOLDER);
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
    if (action->loadBlank) {
      loadBlankSynthPreset();
    } else {
      loadSynthPresetFromSlot(action->presetIndex);
    }
  }
  menuSynthOptionsHome();
}

void pageSynthPresetMenu(GEMCallbackData callbackData) {
  SynthPresetMenuAction* action = reinterpret_cast<SynthPresetMenuAction*>(callbackData.valPointer);
  if (!action || action->pageDelta == 0) {
    return;
  }

  uint16_t& pageStart = action->mode == SynthPresetMenuMode::Save
    ? synthPresetSavePageStart
    : synthPresetLoadPageStart;
  if (action->pageDelta < 0) {
    pageStart = pageStart > SYNTH_PRESET_MENU_PAGE_SIZE
      ? static_cast<uint16_t>(pageStart - SYNTH_PRESET_MENU_PAGE_SIZE)
      : 0;
  } else if (pageStart + SYNTH_PRESET_MENU_PAGE_SIZE < synthPresets.size()) {
    pageStart = static_cast<uint16_t>(pageStart + SYNTH_PRESET_MENU_PAGE_SIZE);
  }

  updateSynthPresetMenuPages();
  menu.drawMenu();
}
}  // namespace

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

void rebuildSynthPresetMenuItems() {
  updateSynthPresetMenuPages();
}

void requestSynthPresetMenuRebuild() {
  synthPresetMenuRebuildPending = true;
}

void serviceSynthPresetMenuRebuild() {
  if (!synthPresetMenuRebuildPending) {
    return;
  }
  synthPresetMenuRebuildPending = false;
  if (menu.getCurrentMenuPage() == &menuPageSynthPresetSave
      || menu.getCurrentMenuPage() == &menuPageSynthPresetLoad) {
    menu.setMenuPageCurrent(menuPageSynth);
  }
  rebuildSynthPresetMenuItems();
  if (menu.getCurrentMenuPage() == &menuPageSynth) {
    menu.drawMenu();
  }
}

void createSynthPresetMenuItems() {
  if (!synthPresetMenuItemsCreated) {
    menuPageSynthPresetSave.addMenuItem(menuItemSaveSynthPresetNew);
    menuPageSynthPresetSave.addMenuItem(menuItemSaveSynthPresetPrev);
    menuPageSynthPresetSave.addMenuItem(menuItemSaveSynthPresetNext);
    for (uint8_t i = 0; i < SYNTH_PRESET_MENU_PAGE_SIZE; ++i) {
      menuPageSynthPresetSave.addMenuItem(synthPresetSaveSlots[i].item);
    }

    menuPageSynthPresetLoad.addMenuItem(menuItemLoadSynthPresetBlank);
    menuPageSynthPresetLoad.addMenuItem(menuItemLoadSynthPresetPrev);
    menuPageSynthPresetLoad.addMenuItem(menuItemLoadSynthPresetNext);
    for (uint8_t i = 0; i < SYNTH_PRESET_MENU_PAGE_SIZE; ++i) {
      menuPageSynthPresetLoad.addMenuItem(synthPresetLoadSlots[i].item);
    }
    synthPresetMenuItemsCreated = true;
  }
  rebuildSynthPresetMenuItems();
}
