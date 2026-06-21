#include "../FirmwareModule.h"
#include "MenuFolderUtils.h"
#include "MenuAndDisplay.h"
#include "SynthPresetMenu.h"
#include "SynthWavetableMenu.h"
#include "VirtualListMenu.h"
#include "../app/RuntimeDefaults.h"
#include "../storage/Settings.h"
#include "../synth/BuiltinWavetables.h"
#include "../synth/SynthAudio.h"
#include "../storage/SynthWavetableStorage.h"

char currentSynthWavetableMenuLabel[SYNTH_WAVETABLE_MENU_LABEL_LENGTH] = "WT:Basic";

namespace {
enum class SynthWavetableMenuRowKind : uint8_t {
  Folder,
  BuiltIn,
  User
};

struct SynthWavetableMenuRow {
  SynthWavetableMenuRowKind kind = SynthWavetableMenuRowKind::User;
  uint16_t index = 0;
};

constexpr uint16_t SYNTH_WAVETABLE_MENU_MAX_ROWS =
  SYNTH_WAVETABLE_MAX_COUNT + SYNTH_WAVETABLE_MAX_COUNT + 32;

bool synthWavetableMenuRebuildPending = false;
SynthWavetableMenuRow synthWavetableMenuRows[SYNTH_WAVETABLE_MENU_MAX_ROWS] = {};
uint16_t synthWavetableMenuRowCount = 0;
char synthWavetableMenuCurrentFolder[SYNTH_WAVETABLE_FOLDER_LENGTH] = "/";
char synthWavetableMenuTitleBuffer[SYNTH_WAVETABLE_MENU_LABEL_LENGTH] = "Wavetables";

uint16_t synthWavetableVirtualCount(void*) {
  return synthWavetableMenuRowCount;
}

const SynthWavetableSlot* userSynthWavetableForRow(const SynthWavetableMenuRow& row) {
  if (row.index >= synthWavetables.size() || !synthWavetables[row.index].valid) {
    return nullptr;
  }
  return &synthWavetables[row.index];
}

void formatSynthWavetableMenuLabel(const SynthWavetableSlot& wavetable, char* output, size_t outputLength) {
  if (outputLength == 0) {
    return;
  }
  output[0] = '\0';
  if (menuFolderEntryBelongsToCurrentFolder(wavetable.folderPath, synthWavetableMenuCurrentFolder)
      || strcmp(wavetable.folderPath, SYNTH_WAVETABLE_BUILTIN_FOLDER) == 0) {
    snprintf(output, outputLength, "%s", wavetable.name);
    return;
  }

  char folderLabel[SYNTH_WAVETABLE_MENU_LABEL_LENGTH] = {};
  synthPresetFolderLabel(wavetable.folderPath, folderLabel, sizeof(folderLabel));
  snprintf(output, outputLength, "%s/%s", folderLabel, wavetable.name);
}

bool synthWavetableFolderRowPath(const SynthWavetableMenuRow& row, char* output, size_t outputLength) {
  const SynthWavetableSlot* wavetable = userSynthWavetableForRow(row);
  return wavetable
         && menuFolderImmediateChildPath(wavetable->folderPath,
                                         synthWavetableMenuCurrentFolder,
                                         output,
                                         outputLength);
}

bool synthWavetableFolderAlreadyListed(const char* childFolderPath) {
  char existing[SYNTH_WAVETABLE_FOLDER_LENGTH] = {};
  for (uint16_t i = 0; i < synthWavetableMenuRowCount; ++i) {
    if (synthWavetableMenuRows[i].kind == SynthWavetableMenuRowKind::Folder
        && synthWavetableFolderRowPath(synthWavetableMenuRows[i], existing, sizeof(existing))
        && menuFolderEquals(existing, childFolderPath)) {
      return true;
    }
  }
  return false;
}

void appendSynthWavetableMenuRow(SynthWavetableMenuRowKind kind, uint16_t index) {
  if (synthWavetableMenuRowCount >= SYNTH_WAVETABLE_MENU_MAX_ROWS) {
    return;
  }
  synthWavetableMenuRows[synthWavetableMenuRowCount++] = { kind, index };
}

void updateSynthWavetableBrowserTitle() {
  if (menuFolderIsRoot(synthWavetableMenuCurrentFolder)) {
    snprintf(synthWavetableMenuTitleBuffer, sizeof(synthWavetableMenuTitleBuffer), "Wavetables");
    return;
  }
  synthPresetFolderLabel(synthWavetableMenuCurrentFolder,
                         synthWavetableMenuTitleBuffer,
                         sizeof(synthWavetableMenuTitleBuffer));
}

void rebuildSynthWavetableVirtualList() {
  compactSynthWavetables();
  synthWavetableMenuRowCount = 0;

  if (menuFolderIsRoot(synthWavetableMenuCurrentFolder)) {
    for (size_t i = 0; i < synthBuiltinWavetableCount(); ++i) {
      appendSynthWavetableMenuRow(SynthWavetableMenuRowKind::BuiltIn, static_cast<uint16_t>(i));
    }
  }

  char childFolder[SYNTH_WAVETABLE_FOLDER_LENGTH] = {};
  for (size_t i = 0; i < synthWavetables.size(); ++i) {
    const SynthWavetableSlot& wavetable = synthWavetables[i];
    if (wavetable.valid
        && menuFolderImmediateChildPath(wavetable.folderPath,
                                        synthWavetableMenuCurrentFolder,
                                        childFolder,
                                        sizeof(childFolder))
        && !synthWavetableFolderAlreadyListed(childFolder)) {
      appendSynthWavetableMenuRow(SynthWavetableMenuRowKind::Folder, static_cast<uint16_t>(i));
    }
  }

  for (size_t i = 0; i < synthWavetables.size(); ++i) {
    const SynthWavetableSlot& wavetable = synthWavetables[i];
    if (wavetable.valid
        && menuFolderEntryBelongsToCurrentFolder(wavetable.folderPath, synthWavetableMenuCurrentFolder)) {
      appendSynthWavetableMenuRow(SynthWavetableMenuRowKind::User, static_cast<uint16_t>(i));
    }
  }
  updateSynthWavetableBrowserTitle();
}

bool synthWavetableVirtualLabel(void*, uint16_t index, char* output, size_t outputLength) {
  if (outputLength == 0) {
    return false;
  }
  output[0] = '\0';
  if (index >= synthWavetableMenuRowCount) {
    return false;
  }

  const SynthWavetableMenuRow& row = synthWavetableMenuRows[index];
  switch (row.kind) {
    case SynthWavetableMenuRowKind::Folder:
      {
        char folderPath[SYNTH_WAVETABLE_FOLDER_LENGTH] = {};
        if (!synthWavetableFolderRowPath(row, folderPath, sizeof(folderPath))) {
          return false;
        }
        synthPresetFolderLabel(folderPath, output, outputLength);
        return output[0] != '\0';
      }
    case SynthWavetableMenuRowKind::BuiltIn:
      {
        const BuiltinSynthWavetableDefinition* wavetable = synthBuiltinWavetableAt(row.index);
        if (!wavetable) {
          return false;
        }
        snprintf(output, outputLength, "%s", wavetable->name);
        return true;
      }
    case SynthWavetableMenuRowKind::User:
      {
        const SynthWavetableSlot* wavetable = userSynthWavetableForRow(row);
        if (!wavetable) {
          return false;
        }
        formatSynthWavetableMenuLabel(*wavetable, output, outputLength);
        return output[0] != '\0';
      }
  }
  return false;
}

VirtualListMenuRowType synthWavetableVirtualRowType(void*, uint16_t index) {
  if (index >= synthWavetableMenuRowCount) {
    return VirtualListMenuRowType::Button;
  }
  return synthWavetableMenuRows[index].kind == SynthWavetableMenuRowKind::Folder
           ? VirtualListMenuRowType::Link
           : VirtualListMenuRowType::Button;
}

void selectSynthWavetableByVirtualIndex(uint16_t index) {
  bool selected = false;
  if (index >= synthWavetableMenuRowCount) {
    return;
  }

  const SynthWavetableMenuRow& row = synthWavetableMenuRows[index];
  if (row.kind == SynthWavetableMenuRowKind::BuiltIn) {
    const BuiltinSynthWavetableDefinition* wavetable = synthBuiltinWavetableAt(row.index);
    selected = wavetable != nullptr;
    if (selected) {
      setCurrentSynthWavetableReference(wavetable->folderPath, wavetable->name);
    }
  } else if (row.kind == SynthWavetableMenuRowKind::User) {
    const SynthWavetableSlot* wavetable = userSynthWavetableForRow(row);
    selected = wavetable != nullptr;
    if (selected) {
      setCurrentSynthWavetableReference(wavetable->folderPath, wavetable->name);
    }
  }

  if (selected) {
    currWave = WAVEFORM_BASIC_WAVETABLE;
    settings[static_cast<uint8_t>(SettingKey::Waveform)] = WAVEFORM_BASIC_WAVETABLE;
    loadSelectedSynthWavetable();
    updateCurrentSynthWavetableMenuLabel();
    flashSafeSaveCurrentSynthWavetableReference();
    markSettingsDirty();
  }
}

void synthWavetableVirtualSelect(void*, uint16_t index) {
  if (index < synthWavetableMenuRowCount
      && synthWavetableMenuRows[index].kind == SynthWavetableMenuRowKind::Folder) {
    char childFolder[SYNTH_WAVETABLE_FOLDER_LENGTH] = {};
    if (synthWavetableFolderRowPath(synthWavetableMenuRows[index], childFolder, sizeof(childFolder))) {
      snprintf(synthWavetableMenuCurrentFolder, sizeof(synthWavetableMenuCurrentFolder), "%s", childFolder);
      rebuildSynthWavetableVirtualList();
      resetVirtualListMenuSelection();
    }
    return;
  }
  selectSynthWavetableByVirtualIndex(index);
  deactivateVirtualListMenu();
  menuSynthOptionsHome();
}

bool synthWavetableVirtualBack(void*) {
  if (menuFolderIsRoot(synthWavetableMenuCurrentFolder)) {
    return false;
  }
  menuFolderParentPath(synthWavetableMenuCurrentFolder,
                       synthWavetableMenuCurrentFolder,
                       sizeof(synthWavetableMenuCurrentFolder));
  rebuildSynthWavetableVirtualList();
  resetVirtualListMenuSelection();
  return true;
}

void synthWavetableVirtualClose(void*) {
  menuSynthOptionsHome();
}
}  // namespace

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
    char folderLabel[SYNTH_WAVETABLE_MENU_LABEL_LENGTH] = {};
    synthPresetFolderLabel(folder, folderLabel, sizeof(folderLabel));
    snprintf(currentSynthWavetableMenuLabel,
             sizeof(currentSynthWavetableMenuLabel),
             "WT:%s/%s",
             folderLabel,
             name);
  }
}

void openSynthWavetableLoadMenu() {
  snprintf(synthWavetableMenuCurrentFolder,
           sizeof(synthWavetableMenuCurrentFolder),
           "%s",
           SYNTH_WAVETABLE_ROOT_FOLDER);
  rebuildSynthWavetableVirtualList();
  updateCurrentSynthWavetableMenuLabel();
  VirtualListMenuProvider provider;
  provider.title = synthWavetableMenuTitleBuffer;
  provider.getCount = synthWavetableVirtualCount;
  provider.getLabel = synthWavetableVirtualLabel;
  provider.getRowType = synthWavetableVirtualRowType;
  provider.select = synthWavetableVirtualSelect;
  provider.back = synthWavetableVirtualBack;
  provider.close = synthWavetableVirtualClose;
  provider.emptyLabel = "No Wavetables";
  openVirtualListMenu(provider);
}

void requestSynthWavetableMenuRebuild() {
  synthWavetableMenuRebuildPending = true;
}

void rebuildSynthWavetableMenuItems() {
  if (virtualListMenuIsActive()) {
    rebuildSynthWavetableVirtualList();
  } else {
    compactSynthWavetables();
  }
  updateCurrentSynthWavetableMenuLabel();
  if (virtualListMenuIsActive()) {
    redrawVirtualListMenu();
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
  rebuildSynthWavetableMenuItems();
  if (menu.getCurrentMenuPage() == &menuPageSynth) {
    menu.drawMenu();
  }
}
