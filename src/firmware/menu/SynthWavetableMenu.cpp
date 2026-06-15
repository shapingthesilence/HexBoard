#include "../FirmwareModule.h"
#include "../synth/BuiltinWavetables.h"
#include "../app/RuntimeDefaults.h"
#include "../storage/Settings.h"
#include "../storage/SynthWavetableStorage.h"
#include "../synth/SynthAudio.h"
#include "MenuAndDisplay.h"
#include "SynthPresetMenu.h"
#include "SynthWavetableMenu.h"

char currentSynthWavetableMenuLabel[SYNTH_WAVETABLE_MENU_LABEL_LENGTH] = "WT:Basic";

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
