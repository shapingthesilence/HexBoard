#include "../FirmwareModule.h"
#include "CommandWheelOverlay.h"
#include "MenuFolderUtils.h"
#include "MenuAndDisplay.h"
#include "SynthPresetMenu.h"
#include "VirtualListMenu.h"
#include "../app/DiagnosticsTiming.h"
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

// The open folder is copied into these fixed buffers on entry, so scrolling
// never touches flash and RAM does not grow with the library.
constexpr uint8_t SYNTH_PRESET_MENU_MAX_SUBFOLDERS = 24;

struct SynthPresetMenuPreset {
  uint16_t handle = 0;
  char name[SYNTH_PRESET_MENU_NAME_LENGTH] = {};
};

SynthPresetMenuMode activeSynthPresetMenuMode = SynthPresetMenuMode::Load;
SynthPresetMenuReturn activeSynthPresetMenuReturn = SynthPresetMenuReturn::SynthEditor;
SynthPresetMenuPreset synthPresetMenuPresets[SYNTH_PRESET_FOLDER_MAX_PRESETS] = {};
char synthPresetMenuSubfolders[SYNTH_PRESET_MENU_MAX_SUBFOLDERS][SYNTH_PRESET_FOLDER_LENGTH] = {};
uint8_t synthPresetMenuPresetCount = 0;
uint8_t synthPresetMenuSubfolderCount = 0;
uint16_t synthPresetMenuHiddenCount = 0;
bool synthPresetMenuRebuildPending = false;
char synthPresetMenuCurrentFolder[SYNTH_PRESET_FOLDER_LENGTH] = "/";
// The Favorites view lists favorite presets from every folder.
bool synthPresetMenuShowingFavorites = false;
// The list menu reads these through pointers, so they can change in place.
char synthPresetMenuTitleText[16] = "Load Preset";
char synthPresetMenuEmptyText[16] = "Blank";

// Rows: Favorites (Load, root only), action, subfolders, presets, then an
// optional "more" notice. The Favorites view has only presets.
enum class SynthPresetMenuRowKind : uint8_t {
  Favorites,
  Action,
  Folder,
  Preset,
  Hidden
};

void updateSynthPresetMenuText() {
  const bool save = activeSynthPresetMenuMode == SynthPresetMenuMode::Save;
  snprintf(synthPresetMenuTitleText, sizeof(synthPresetMenuTitleText), "%s",
           save ? "Save Preset" : (synthPresetMenuShowingFavorites ? "Favorites" : "Load Preset"));
  snprintf(synthPresetMenuEmptyText, sizeof(synthPresetMenuEmptyText), "%s",
           save ? "No Presets" : (synthPresetMenuShowingFavorites ? "No Favorites" : "Blank"));
}

bool synthPresetMenuHasFavoritesRow() {
  return activeSynthPresetMenuMode == SynthPresetMenuMode::Load
         && !synthPresetMenuShowingFavorites
         && menuFolderIsRoot(synthPresetMenuCurrentFolder);
}

uint16_t synthPresetVirtualCount(void*) {
  const uint16_t items = static_cast<uint16_t>(synthPresetMenuPresetCount + (synthPresetMenuHiddenCount > 0 ? 1 : 0));
  if (synthPresetMenuShowingFavorites) {
    return items;
  }
  return static_cast<uint16_t>((synthPresetMenuHasFavoritesRow() ? 1 : 0) + 1
                               + synthPresetMenuSubfolderCount + items);
}

SynthPresetMenuRowKind synthPresetRowKind(uint16_t index, uint16_t& itemIndex) {
  itemIndex = 0;
  if (synthPresetMenuShowingFavorites) {
    itemIndex = index;
    return index < synthPresetMenuPresetCount ? SynthPresetMenuRowKind::Preset : SynthPresetMenuRowKind::Hidden;
  }
  if (synthPresetMenuHasFavoritesRow()) {
    if (index == 0) {
      return SynthPresetMenuRowKind::Favorites;
    }
    --index;
  }
  if (index == 0) {
    return SynthPresetMenuRowKind::Action;
  }
  itemIndex = static_cast<uint16_t>(index - 1);
  if (itemIndex < synthPresetMenuSubfolderCount) {
    return SynthPresetMenuRowKind::Folder;
  }
  itemIndex = static_cast<uint16_t>(itemIndex - synthPresetMenuSubfolderCount);
  if (itemIndex < synthPresetMenuPresetCount) {
    return SynthPresetMenuRowKind::Preset;
  }
  return SynthPresetMenuRowKind::Hidden;
}

bool synthPresetMenuHasSubfolder(const char* folderPath) {
  for (uint8_t i = 0; i < synthPresetMenuSubfolderCount; ++i) {
    if (menuFolderEquals(synthPresetMenuSubfolders[i], folderPath)) {
      return true;
    }
  }
  return false;
}

void rebuildSynthPresetVirtualList() {
  synthPresetMenuPresetCount = 0;
  synthPresetMenuSubfolderCount = 0;
  synthPresetMenuHiddenCount = 0;
  updateSynthPresetMenuText();
  auto addPreset = [&](const SynthPresetCatalogEntry& entry) {
    if (synthPresetMenuPresetCount < SYNTH_PRESET_FOLDER_MAX_PRESETS) {
      SynthPresetMenuPreset& row = synthPresetMenuPresets[synthPresetMenuPresetCount++];
      row.handle = entry.handle;
      snprintf(row.name, sizeof(row.name), "%s", entry.name);
    } else if (synthPresetMenuHiddenCount < 0xFFFFu) {
      ++synthPresetMenuHiddenCount;
    }
    return true;
  };
  if (synthPresetMenuShowingFavorites) {
    auto addFavorite = [&](const SynthPresetCatalogEntry& entry) {
      return (entry.flags & SYNTH_PRESET_CATALOG_FLAG_FAVORITE) == 0 || addPreset(entry);
    };
    visitSynthPresetCatalogWith(addFavorite);
    return;
  }
  bool subfoldersOverflowed = false;
  // Subfolders come from the resident folder table; presets from one folder file.
  auto addSubfolder = [&](const char* folderPath) {
    char childFolder[SYNTH_PRESET_FOLDER_LENGTH] = {};
    if (!menuFolderImmediateChildPath(folderPath, synthPresetMenuCurrentFolder, childFolder, sizeof(childFolder))
        || synthPresetMenuHasSubfolder(childFolder)) {
      return;
    }
    if (synthPresetMenuSubfolderCount < SYNTH_PRESET_MENU_MAX_SUBFOLDERS) {
      snprintf(synthPresetMenuSubfolders[synthPresetMenuSubfolderCount++],
               SYNTH_PRESET_FOLDER_LENGTH,
               "%s",
               childFolder);
    } else {
      subfoldersOverflowed = true;
    }
  };
  visitSynthPresetCatalogFolderPathsWith(addSubfolder);
  visitSynthPresetCatalogFolderWith(synthPresetMenuCurrentFolder, addPreset);
  if (synthPresetMenuHiddenCount > 0 || subfoldersOverflowed) {
    sendToLog("Synth preset folder " + std::string(synthPresetMenuCurrentFolder)
              + " has more entries than the browser shows.");
  }
}

bool synthPresetVirtualLabel(void*, uint16_t index, char* output, size_t outputLength) {
  if (outputLength == 0) {
    return false;
  }
  output[0] = '\0';
  uint16_t itemIndex = 0;
  switch (synthPresetRowKind(index, itemIndex)) {
    case SynthPresetMenuRowKind::Favorites:
      snprintf(output, outputLength, "Favorites");
      return true;
    case SynthPresetMenuRowKind::Action:
      snprintf(output,
               outputLength,
               "%s",
               activeSynthPresetMenuMode == SynthPresetMenuMode::Save ? "New Preset" : "Blank");
      return true;
    case SynthPresetMenuRowKind::Folder:
      synthPresetFolderLabel(synthPresetMenuSubfolders[itemIndex], output, outputLength);
      return output[0] != '\0';
    case SynthPresetMenuRowKind::Preset:
      snprintf(output, outputLength, "%s", synthPresetMenuPresets[itemIndex].name);
      return output[0] != '\0';
    case SynthPresetMenuRowKind::Hidden:
      snprintf(output, outputLength, "+%u more in Sync", static_cast<unsigned>(synthPresetMenuHiddenCount));
      return true;
  }
  return false;
}

VirtualListMenuRowType synthPresetVirtualRowType(void*, uint16_t index) {
  uint16_t itemIndex = 0;
  switch (synthPresetRowKind(index, itemIndex)) {
    case SynthPresetMenuRowKind::Favorites:
    case SynthPresetMenuRowKind::Folder:
      return VirtualListMenuRowType::Link;
    case SynthPresetMenuRowKind::Hidden:
      return VirtualListMenuRowType::Label;
    default:
      return VirtualListMenuRowType::Button;
  }
}

bool synthPresetVirtualIsCurrent(void*, uint16_t index) {
  uint16_t itemIndex = 0;
  uint16_t currentHandle = 0;
  return activeSynthPresetMenuMode == SynthPresetMenuMode::Load
         && synthPresetRowKind(index, itemIndex) == SynthPresetMenuRowKind::Preset
         && currentSynthPresetCatalogIndex(currentHandle)
         && synthPresetMenuPresets[itemIndex].handle == currentHandle;
}

bool synthPresetVirtualInitialSelection(void*, uint16_t* index) {
  if (!index) {
    return false;
  }
  const uint16_t count = synthPresetVirtualCount(nullptr);
  for (uint16_t i = 0; i < count; ++i) {
    if (synthPresetVirtualIsCurrent(nullptr, i)) {
      *index = i;
      return true;
    }
  }
  return false;
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
  uint16_t itemIndex = 0;
  const SynthPresetMenuRowKind kind = synthPresetRowKind(index, itemIndex);
  if (kind == SynthPresetMenuRowKind::Hidden) {
    return;
  }
  if (kind == SynthPresetMenuRowKind::Favorites) {
    synthPresetMenuShowingFavorites = true;
    rebuildSynthPresetVirtualList();
    resetVirtualListMenuSelection();
    return;
  }
  if (kind == SynthPresetMenuRowKind::Folder) {
    snprintf(synthPresetMenuCurrentFolder,
             sizeof(synthPresetMenuCurrentFolder),
             "%s",
             synthPresetMenuSubfolders[itemIndex]);
    rebuildSynthPresetVirtualList();
    resetVirtualListMenuSelection();
    return;
  }

  if (activeSynthPresetMenuMode == SynthPresetMenuMode::Save) {
    if (kind == SynthPresetMenuRowKind::Action) {
      saveSynthPresetAsNew(synthPresetMenuCurrentFolder);
    } else {
      saveSynthPresetToSlot(synthPresetMenuPresets[itemIndex].handle);
    }
    requestSynthPresetMenuRebuild();
  } else if (kind == SynthPresetMenuRowKind::Action) {
    loadBlankSynthPreset();
  } else {
    loadSynthPresetFromSlot(synthPresetMenuPresets[itemIndex].handle);
  }
  returnFromSynthPresetMenu();
}

bool synthPresetVirtualBack(void*) {
  if (synthPresetMenuShowingFavorites) {
    synthPresetMenuShowingFavorites = false;
    rebuildSynthPresetVirtualList();
    resetVirtualListMenuSelection();
    return true;
  }
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
  // After a firmware-only update, build the index on first use. This writes
  // flash once and then makes every folder load a single sequential read.
  ensureSynthPresetCatalogIndexed(false);
  snprintf(synthPresetMenuCurrentFolder, sizeof(synthPresetMenuCurrentFolder), "%s", SYNTH_PRESET_ROOT_FOLDER);
  synthPresetMenuShowingFavorites = false;
  rebuildSynthPresetVirtualList();
  VirtualListMenuProvider provider;
  provider.title = synthPresetMenuTitleText;
  provider.getCount = synthPresetVirtualCount;
  provider.getLabel = synthPresetVirtualLabel;
  provider.getRowType = synthPresetVirtualRowType;
  provider.isCurrent = synthPresetVirtualIsCurrent;
  provider.getInitialSelection = synthPresetVirtualInitialSelection;
  provider.select = synthPresetVirtualSelect;
  provider.back = synthPresetVirtualBack;
  provider.close = synthPresetVirtualClose;
  provider.emptyLabel = synthPresetMenuEmptyText;
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
