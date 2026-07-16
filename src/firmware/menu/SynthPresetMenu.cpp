#include "../FirmwareModule.h"
#include "CommandWheelOverlay.h"
#include "MenuFolderUtils.h"
#include "MenuAndDisplay.h"
#include "SynthPresetMenu.h"
#include "VirtualListMenu.h"
#include "../storage/SynthPresetStorage.h"

namespace {
enum class SynthPresetMenuMode : uint8_t {
  Save,
  Load
};

enum class SynthPresetMenuReturn : uint8_t {
  Main,
  SynthEditor
};

enum class SynthPresetMenuRowKind : uint8_t {
  Action,
  Folder,
  Preset
};

struct SynthPresetMenuRow {
  SynthPresetMenuRowKind kind = SynthPresetMenuRowKind::Preset;
  uint16_t index = 0;
};

constexpr uint16_t SYNTH_PRESET_MENU_MAX_ROWS = 1 + SYNTH_PRESET_MAX_COUNT + SYNTH_PRESET_MAX_COUNT;

SynthPresetMenuMode activeSynthPresetMenuMode = SynthPresetMenuMode::Load;
SynthPresetMenuReturn activeSynthPresetMenuReturn = SynthPresetMenuReturn::SynthEditor;
SynthPresetMenuRow synthPresetMenuRows[SYNTH_PRESET_MENU_MAX_ROWS] = {};
uint16_t synthPresetMenuRowCount = 0;
bool synthPresetMenuRebuildPending = false;
char synthPresetMenuCurrentFolder[SYNTH_PRESET_FOLDER_LENGTH] = "/";
char synthPresetMenuBreadcrumbBuffer[SYNTH_PRESET_MENU_LABEL_LENGTH] = "/";

const char* synthPresetMenuTitle() {
  return activeSynthPresetMenuMode == SynthPresetMenuMode::Save ? "Save Preset" : "Load Preset";
}

const char* synthPresetMenuEmptyLabel() {
  return activeSynthPresetMenuMode == SynthPresetMenuMode::Save ? "No Presets" : "Blank";
}

uint16_t synthPresetVirtualCount(void*) {
  return synthPresetMenuRowCount;
}

void formatSynthPresetMenuLabel(uint16_t presetIndex, char* output, size_t outputLength) {
  if (outputLength == 0) {
    return;
  }
  output[0] = '\0';
  if (presetIndex >= synthPresets.size()) {
    return;
  }

  const SynthPresetIndexEntry& preset = synthPresets[presetIndex];
  if (menuFolderEntryBelongsToCurrentFolder(preset.folderPath, synthPresetMenuCurrentFolder)) {
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

const SynthPresetIndexEntry* synthPresetForRow(const SynthPresetMenuRow& row) {
  if (row.index >= synthPresets.size()) {
    return nullptr;
  }
  return &synthPresets[row.index];
}

bool synthPresetFolderRowPath(const SynthPresetMenuRow& row, char* output, size_t outputLength) {
  const SynthPresetIndexEntry* preset = synthPresetForRow(row);
  return preset
         && menuFolderImmediateChildPath(preset->folderPath, synthPresetMenuCurrentFolder, output, outputLength);
}

bool synthPresetFolderAlreadyListed(const char* childFolderPath) {
  char existing[SYNTH_PRESET_FOLDER_LENGTH] = {};
  for (uint16_t i = 0; i < synthPresetMenuRowCount; ++i) {
    if (synthPresetMenuRows[i].kind == SynthPresetMenuRowKind::Folder
        && synthPresetFolderRowPath(synthPresetMenuRows[i], existing, sizeof(existing))
        && menuFolderEquals(existing, childFolderPath)) {
      return true;
    }
  }
  return false;
}

bool synthPresetRowIsCurrent(const SynthPresetMenuRow& row) {
  if (activeSynthPresetMenuMode != SynthPresetMenuMode::Load
      || row.kind != SynthPresetMenuRowKind::Preset) {
    return false;
  }
  uint16_t presetIndex = 0;
  return currentSynthPresetCatalogIndex(presetIndex) && row.index == presetIndex;
}

bool findCurrentSynthPresetRow(uint16_t& index) {
  for (uint16_t i = 0; i < synthPresetMenuRowCount; ++i) {
    if (synthPresetRowIsCurrent(synthPresetMenuRows[i])) {
      index = i;
      return true;
    }
  }
  return false;
}

void appendSynthPresetMenuRow(SynthPresetMenuRowKind kind, uint16_t index) {
  if (synthPresetMenuRowCount >= SYNTH_PRESET_MENU_MAX_ROWS) {
    return;
  }
  synthPresetMenuRows[synthPresetMenuRowCount++] = { kind, index };
}

void updateSynthPresetMenuHeader() {
  synthPresetFolderBreadcrumb(synthPresetMenuCurrentFolder,
                              synthPresetMenuBreadcrumbBuffer,
                              sizeof(synthPresetMenuBreadcrumbBuffer));
}

void rebuildSynthPresetVirtualList() {
  compactSynthPresets();
  synthPresetMenuRowCount = 0;
  appendSynthPresetMenuRow(SynthPresetMenuRowKind::Action, 0);

  char childFolder[SYNTH_PRESET_FOLDER_LENGTH] = {};
  for (size_t i = 0; i < synthPresets.size(); ++i) {
    const SynthPresetIndexEntry& preset = synthPresets[i];
    if (menuFolderImmediateChildPath(preset.folderPath,
                                     synthPresetMenuCurrentFolder,
                                     childFolder,
                                     sizeof(childFolder))
        && !synthPresetFolderAlreadyListed(childFolder)) {
      appendSynthPresetMenuRow(SynthPresetMenuRowKind::Folder, static_cast<uint16_t>(i));
    }
  }

  for (size_t i = 0; i < synthPresets.size(); ++i) {
    if (menuFolderEntryBelongsToCurrentFolder(synthPresets[i].folderPath, synthPresetMenuCurrentFolder)) {
      appendSynthPresetMenuRow(SynthPresetMenuRowKind::Preset, static_cast<uint16_t>(i));
    }
  }
  updateSynthPresetMenuHeader();
}

bool synthPresetVirtualLabel(void*, uint16_t index, char* output, size_t outputLength) {
  if (outputLength == 0) {
    return false;
  }
  output[0] = '\0';
  if (index >= synthPresetMenuRowCount) {
    return false;
  }
  const SynthPresetMenuRow& row = synthPresetMenuRows[index];
  switch (row.kind) {
    case SynthPresetMenuRowKind::Action:
      snprintf(output,
               outputLength,
               "%s",
               activeSynthPresetMenuMode == SynthPresetMenuMode::Save ? "New Preset" : "Blank");
      return true;
    case SynthPresetMenuRowKind::Folder:
      {
        char folderPath[SYNTH_PRESET_FOLDER_LENGTH] = {};
        if (!synthPresetFolderRowPath(row, folderPath, sizeof(folderPath))) {
          return false;
        }
        synthPresetFolderLabel(folderPath, output, outputLength);
        return output[0] != '\0';
      }
    case SynthPresetMenuRowKind::Preset:
      formatSynthPresetMenuLabel(row.index, output, outputLength);
      return output[0] != '\0';
  }
  return false;
}

VirtualListMenuRowType synthPresetVirtualRowType(void*, uint16_t index) {
  if (index >= synthPresetMenuRowCount) {
    return VirtualListMenuRowType::Button;
  }
  return synthPresetMenuRows[index].kind == SynthPresetMenuRowKind::Folder
           ? VirtualListMenuRowType::Link
           : VirtualListMenuRowType::Button;
}

bool synthPresetVirtualIsCurrent(void*, uint16_t index) {
  return index < synthPresetMenuRowCount
         && synthPresetRowIsCurrent(synthPresetMenuRows[index]);
}

bool synthPresetVirtualInitialSelection(void*, uint16_t* index) {
  if (!index) {
    return false;
  }
  return findCurrentSynthPresetRow(*index);
}

void returnFromSynthPresetMenu() {
  deactivateVirtualListMenu();
  if (activeSynthPresetMenuReturn == SynthPresetMenuReturn::Main) {
    menuHome();
  } else {
    menuSynthOptionsHome();
  }
}

void synthPresetVirtualSelect(void*, uint16_t index) {
  if (index >= synthPresetMenuRowCount) {
    returnFromSynthPresetMenu();
    return;
  }

  const SynthPresetMenuRow& row = synthPresetMenuRows[index];
  if (row.kind == SynthPresetMenuRowKind::Folder) {
    char childFolder[SYNTH_PRESET_FOLDER_LENGTH] = {};
    if (synthPresetFolderRowPath(row, childFolder, sizeof(childFolder))) {
      snprintf(synthPresetMenuCurrentFolder, sizeof(synthPresetMenuCurrentFolder), "%s", childFolder);
      rebuildSynthPresetVirtualList();
      resetVirtualListMenuSelection();
    }
    return;
  }

  if (activeSynthPresetMenuMode == SynthPresetMenuMode::Save) {
    if (row.kind == SynthPresetMenuRowKind::Action) {
      saveSynthPresetAsNew(synthPresetMenuCurrentFolder);
    } else {
      saveSynthPresetToSlot(row.index);
    }
    requestSynthPresetMenuRebuild();
  } else if (row.kind == SynthPresetMenuRowKind::Action) {
    loadBlankSynthPreset();
  } else {
    loadSynthPresetFromSlot(row.index);
  }
  returnFromSynthPresetMenu();
}

bool synthPresetVirtualBack(void*) {
  if (menuFolderIsRoot(synthPresetMenuCurrentFolder)) {
    return false;
  }
  menuFolderParentPath(synthPresetMenuCurrentFolder,
                       synthPresetMenuCurrentFolder,
                       sizeof(synthPresetMenuCurrentFolder));
  rebuildSynthPresetVirtualList();
  resetVirtualListMenuSelection();
  return true;
}

void synthPresetVirtualClose(void*) {
  returnFromSynthPresetMenu();
}

void openSynthPresetMenu(SynthPresetMenuMode mode, SynthPresetMenuReturn destination) {
  activeSynthPresetMenuMode = mode;
  activeSynthPresetMenuReturn = destination;
  snprintf(synthPresetMenuCurrentFolder, sizeof(synthPresetMenuCurrentFolder), "%s", SYNTH_PRESET_ROOT_FOLDER);
  rebuildSynthPresetVirtualList();
  VirtualListMenuProvider provider;
  provider.title = synthPresetMenuTitle();
  provider.breadcrumb = synthPresetMenuBreadcrumbBuffer;
  provider.getCount = synthPresetVirtualCount;
  provider.getLabel = synthPresetVirtualLabel;
  provider.getRowType = synthPresetVirtualRowType;
  provider.isCurrent = synthPresetVirtualIsCurrent;
  provider.getInitialSelection = synthPresetVirtualInitialSelection;
  provider.select = synthPresetVirtualSelect;
  provider.back = synthPresetVirtualBack;
  provider.close = synthPresetVirtualClose;
  provider.emptyLabel = synthPresetMenuEmptyLabel();
  openVirtualListMenu(provider);
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

void synthPresetFolderBreadcrumb(const char* folderPath, char* output, size_t outputLength) {
  if (outputLength == 0) {
    return;
  }
  output[0] = '\0';
  if (menuFolderIsRoot(folderPath)) {
    snprintf(output, outputLength, "/");
    return;
  }

  const char* path = folderPath;
  while (path && path[0] == '/') {
    ++path;
  }
  if (!path || !path[0]) {
    snprintf(output, outputLength, "/");
    return;
  }

  if (outputLength < 2) {
    return;
  }
  output[0] = '/';
  output[1] = '\0';
  decodeSynthPresetFolderComponent(path, output + 1, outputLength - 1);
}

void openMainSynthPresetLoadMenu() {
  openSynthPresetMenu(SynthPresetMenuMode::Load, SynthPresetMenuReturn::Main);
}

void openSynthPresetLoadMenu() {
  openSynthPresetMenu(SynthPresetMenuMode::Load, SynthPresetMenuReturn::SynthEditor);
}

void openSynthPresetSaveMenu() {
  openSynthPresetMenu(SynthPresetMenuMode::Save, SynthPresetMenuReturn::SynthEditor);
}

void rebuildSynthPresetMenuItems() {
  if (virtualListMenuIsActive()) {
    rebuildSynthPresetVirtualList();
    redrawVirtualListMenu();
  }
}

void requestSynthPresetMenuRebuild() {
  synthPresetMenuRebuildPending = true;
}

void serviceSynthPresetMenuRebuild() {
  if (!synthPresetMenuRebuildPending) {
    return;
  }
  synthPresetMenuRebuildPending = false;
  rebuildSynthPresetMenuItems();
  if (menu.getCurrentMenuPage() == &menuPageSynth) {
    dismissCommandWheelOverlay();
    menu.drawMenu();
  }
}

void createSynthPresetMenuItems() {
  rebuildSynthPresetMenuItems();
}
