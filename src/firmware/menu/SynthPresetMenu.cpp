#include "../FirmwareModule.h"
#include "SynthPresetMenu.h"
#include "MenuAndDisplay.h"
#include "../storage/SynthPresetStorage.h"

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

GEMItem* menuItemLoadSynthPresetBlank;

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


void createSynthPresetMenuItems() {
  rebuildSynthPresetMenuItems();
}
