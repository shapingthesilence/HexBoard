#include "SequencerFileMenu.h"

#include "../config/FeatureFlags.h"

#if HEXBOARD_ENABLE_SEQUENCER

#include <ctype.h>
#include <string.h>

#include "../app/DiagnosticsTiming.h"
#include "../app/RuntimeDefaults.h"
#include "../hardware/LedRender.h"
#include "../menu/CommandWheelOverlay.h"
#include "../menu/MenuAndDisplay.h"
#include "../menu/PlayedNotesOverlay.h"
#include "../menu/VirtualListMenu.h"
#include "../storage/Settings.h"
#include "../storage/SynthPresetStorage.h"
#include "SequencerManagedNotes.h"
#include "SequencerOverlay.h"
#include "SequencerStorage.h"
#include "SequencerTools.h"
#include "SequencerTransport.h"
#include "SequencerUsbBackup.h"

namespace sequencer {
namespace {

constexpr size_t kBrowserTitleLength = 20;
constexpr size_t kBrowserLabelLength = 28;
constexpr uint16_t kNoRowIndex = 0xFFFFu;
constexpr uint16_t kBrowserCacheRows = 8;
constexpr float kNamingBlueHue = 250.0f;
constexpr byte kNamingBlueValue = 211;

enum class BrowserMode : byte {
  None,
  Load,
  SaveNew,
  CreateFolder,
  Manage
};

enum class RowKind : byte {
  SaveHere,
  CreateHere,
  NewFolder,
  ThisFolder,
  Folder,
  File
};

enum class NamingTarget : byte {
  None,
  Sequence,
  Folder,
  RenameSequence,
  RenameFolder
};

enum class NamingAction : byte {
  InsertChar,
  Backspace,
  Cancel
};

struct BrowserRow {
  RowKind kind = RowKind::File;
  bool isFolder = false;
  char path[kSequencePathLength] = "";
  char label[kBrowserLabelLength] = "";
};

struct NamingKey {
  byte buttonIndex = 0;
  NamingAction action = NamingAction::InsertChar;
  char character = '\0';
};

const NamingKey kNamingKeys[] = {
  { 1, NamingAction::InsertChar, 'A' },
  { 2, NamingAction::InsertChar, 'B' },
  { 3, NamingAction::InsertChar, 'C' },
  { 4, NamingAction::InsertChar, 'D' },
  { 5, NamingAction::InsertChar, 'E' },
  { 6, NamingAction::InsertChar, 'F' },
  { 7, NamingAction::InsertChar, 'G' },
  { 8, NamingAction::InsertChar, 'H' },
  { 10, NamingAction::InsertChar, 'I' },
  { 11, NamingAction::InsertChar, 'J' },
  { 12, NamingAction::InsertChar, 'K' },
  { 13, NamingAction::InsertChar, 'L' },
  { 14, NamingAction::InsertChar, 'M' },
  { 15, NamingAction::InsertChar, 'N' },
  { 16, NamingAction::InsertChar, 'O' },
  { 17, NamingAction::InsertChar, 'P' },
  { 21, NamingAction::InsertChar, 'Q' },
  { 22, NamingAction::InsertChar, 'R' },
  { 23, NamingAction::InsertChar, 'S' },
  { 24, NamingAction::InsertChar, 'T' },
  { 25, NamingAction::InsertChar, 'U' },
  { 26, NamingAction::InsertChar, 'V' },
  { 27, NamingAction::InsertChar, 'W' },
  { 28, NamingAction::InsertChar, 'X' },
  { 30, NamingAction::InsertChar, 'Y' },
  { 31, NamingAction::InsertChar, 'Z' },
  { 32, NamingAction::InsertChar, ' ' },
  { 33, NamingAction::InsertChar, '-' },
  { 34, NamingAction::InsertChar, '1' },
  { 35, NamingAction::InsertChar, '2' },
  { 36, NamingAction::InsertChar, '3' },
  { 37, NamingAction::InsertChar, '4' },
  { 38, NamingAction::InsertChar, '5' },
  { 41, NamingAction::Backspace, '\0' },
  { 42, NamingAction::InsertChar, '6' },
  { 43, NamingAction::InsertChar, '7' },
  { 44, NamingAction::InsertChar, '8' },
  { 45, NamingAction::InsertChar, '9' },
  { 46, NamingAction::InsertChar, '0' },
  { 82, NamingAction::Cancel, '\0' }
};

GEMPage* g_sequencerPage = nullptr;
GEMPage* g_usbBackupPage = nullptr;
GEMPage* g_usbBackupExitPage = nullptr;
GEMPage* g_usbBackupStopPage = nullptr;
GEMPage* g_lastMenuPage = nullptr;
bool g_fileMenuInstalled = false;
bool g_fileUiActive = false;
BrowserMode g_browserMode = BrowserMode::None;
char g_browserPath[kSequencePathLength] = "";
char g_browserTitle[kBrowserTitleLength] = "Sequences";
char g_emptyLabel[kBrowserLabelLength] = "No Sequences";
char g_actionTargetPath[kSequencePathLength] = "";
bool g_actionTargetIsFolder = false;
char g_deleteTargetPath[kSequencePathLength] = "";
bool g_deleteTargetIsFolder = false;
char g_promptLineOne[kBrowserLabelLength] = "";
char g_promptLineTwo[kBrowserLabelLength] = "";
char g_promptLineThree[kBrowserLabelLength] = "";
char g_promptLineFour[kBrowserLabelLength] = "";
char g_usbBackupStatusLineOne[kBrowserLabelLength] = "USB Backup Off";
char g_usbBackupStatusLineTwo[kBrowserLabelLength] = "Host tool idle";
NamingTarget g_namingTarget = NamingTarget::None;
char g_namingBuffer[kSequenceNameLength + 1] = "";
byte g_namingLength = 0;
char g_renameSourcePath[kSequencePathLength] = "";
char g_namingErrorOne[20] = "";
char g_namingErrorTwo[20] = "";
bool g_browserCountsValid = false;
BrowserMode g_browserCountsMode = BrowserMode::None;
char g_browserCountsPath[kSequencePathLength] = "";
uint16_t g_cachedActionCount = 0;
uint16_t g_cachedFolderCount = 0;
uint16_t g_cachedFileCount = 0;
uint16_t g_cachedTotalCount = 0;
bool g_browserRowsValid = false;
BrowserMode g_browserRowsMode = BrowserMode::None;
char g_browserRowsPath[kSequencePathLength] = "";
uint16_t g_browserRowsFirstIndex = kNoRowIndex;
uint16_t g_browserRowsCount = 0;
BrowserRow g_browserRows[kBrowserCacheRows];

template <typename Operation>
bool runFlashSafeFileMenuWrite(Operation operation) {
  beginFlashSafeWrite();
  bool ok = operation();
  endFlashSafeWrite();
  return ok;
}

void openBrowser(BrowserMode mode);
void showBrowser();
void returnToSequencerMenu();
void openActionPage();
void actionRenameCallback();
void actionDeleteCallback();
void actionCancelCallback();
void confirmDeleteCallback();
void cancelDeleteCallback();
void promptCallback();
void usbBackupStatusCallback();
void startUsbBackupCallback();
void stopUsbBackupCallback();
void usbBackupPromptCallback();
void confirmUsbBackupExitCallback();
void cancelUsbBackupExitCallback();
void confirmUsbBackupStopCallback();
void cancelUsbBackupStopCallback();

void copyString(char* destination, size_t destinationLength, const char* source) {
  if (destinationLength == 0) {
    return;
  }
  if (source == nullptr) {
    destination[0] = '\0';
    return;
  }
  strncpy(destination, source, destinationLength - 1);
  destination[destinationLength - 1] = '\0';
}

bool appendString(char* destination, size_t destinationLength, const char* suffix) {
  const size_t used = strlen(destination);
  const size_t suffixLength = strlen(suffix);
  if (used + suffixLength >= destinationLength) {
    return false;
  }
  memcpy(destination + used, suffix, suffixLength + 1);
  return true;
}

bool safeBrowserPath(const char* path) {
  return path != nullptr && sequencePathIsSafeStoragePath(path) && !sequencePathIsFile(path);
}

bool entryNameIsHidden(const char* name) {
  return name == nullptr || name[0] == '\0' || name[0] == '.';
}

void formatEntryLabel(const char* path, bool isFolder, char* output, size_t outputLength) {
  extractSequenceDisplayName(path, output, outputLength);
  if (output[0] == '\0') {
    copyString(output, outputLength, isFolder ? "Folder" : "Sequence");
  }
  if (isFolder) {
    appendString(output, outputLength, "/");
  }
}

void folderDisplayName(const char* path, char* output, size_t outputLength) {
  if (sequencePathIsRoot(path)) {
    copyString(output, outputLength, "Sequences");
    return;
  }
  extractSequenceDisplayName(path, output, outputLength);
  if (output[0] == '\0') {
    copyString(output, outputLength, "Folder");
  }
}

bool browserIncludesFiles() {
  return g_browserMode == BrowserMode::Load || g_browserMode == BrowserMode::Manage;
}

void suggestNewSequenceName(char* output, size_t outputLength) {
  if (outputLength == 0) {
    return;
  }
  output[0] = '\0';

  for (unsigned number = 0; number <= 9999; ++number) {
    char candidate[kSequenceNameLength + 1] = "";
    char leaf[32] = "";
    char path[kSequencePathLength] = "";
    if (number == 0) {
      copyString(candidate, sizeof(candidate), "New");
    } else {
      snprintf(candidate, sizeof(candidate), "New %03u", number);
    }
    snprintf(leaf, sizeof(leaf), "%s%s", candidate, kSequenceFileExtension);
    joinSequencePath(g_browserPath, leaf, path, sizeof(path));
    if (!LittleFS.exists(path)) {
      copyString(output, outputLength, candidate);
      return;
    }
  }

  copyString(output, outputLength, "New");
}

uint16_t browserActionRowCount() {
  switch (g_browserMode) {
    case BrowserMode::SaveNew:
      return 2;
    case BrowserMode::CreateFolder:
      return 1;
    case BrowserMode::Manage:
      return sequencePathIsRoot(g_browserPath) ? 0 : 1;
    case BrowserMode::Load:
    case BrowserMode::None:
    default:
      return 0;
  }
}

void invalidateBrowserRowsCache() {
  g_browserRowsValid = false;
  g_browserRowsMode = BrowserMode::None;
  g_browserRowsPath[0] = '\0';
  g_browserRowsFirstIndex = kNoRowIndex;
  g_browserRowsCount = 0;
}

void invalidateBrowserCache() {
  g_browserCountsValid = false;
  g_browserCountsMode = BrowserMode::None;
  g_browserCountsPath[0] = '\0';
  g_cachedActionCount = 0;
  g_cachedFolderCount = 0;
  g_cachedFileCount = 0;
  g_cachedTotalCount = 0;
  invalidateBrowserRowsCache();
}

bool browserCacheMatches(BrowserMode cachedMode, const char* cachedPath) {
  return cachedMode == g_browserMode && strcmp(cachedPath, g_browserPath) == 0;
}

uint16_t minBrowserIndex(uint16_t lhs, uint16_t rhs) {
  return lhs < rhs ? lhs : rhs;
}

uint16_t maxBrowserIndex(uint16_t lhs, uint16_t rhs) {
  return lhs > rhs ? lhs : rhs;
}

bool actionRow(uint16_t index, BrowserRow& row) {
  if (g_browserMode == BrowserMode::SaveNew) {
    if (index == 0) {
      row.kind = RowKind::SaveHere;
      copyString(row.label, sizeof(row.label), "Save Here");
      return true;
    }
    if (index == 1) {
      row.kind = RowKind::NewFolder;
      row.isFolder = true;
      copyString(row.label, sizeof(row.label), "New Folder");
      return true;
    }
  } else if (g_browserMode == BrowserMode::CreateFolder) {
    if (index == 0) {
      row.kind = RowKind::CreateHere;
      row.isFolder = true;
      copyString(row.label, sizeof(row.label), "Create Here");
      return true;
    }
  } else if (g_browserMode == BrowserMode::Manage && !sequencePathIsRoot(g_browserPath)) {
    if (index == 0) {
      row.kind = RowKind::ThisFolder;
      row.isFolder = true;
      copyString(row.path, sizeof(row.path), g_browserPath);
      copyString(row.label, sizeof(row.label), "This Folder...");
      return true;
    }
  }
  return false;
}

bool scanDirectoryEntry(Dir& dir, BrowserRow& row) {
  row = BrowserRow{};
  const bool isFolder = dir.isDirectory();

  String entryName = dir.fileName();
  if (entryNameIsHidden(entryName.c_str())) {
    return false;
  }
  if (!isFolder && !sequencePathIsFile(entryName.c_str())) {
    return false;
  }

  joinSequencePath(g_browserPath, entryName.c_str(), row.path, sizeof(row.path));
  if (!sequencePathIsSafeStoragePath(row.path)) {
    return false;
  }
  row.kind = isFolder ? RowKind::Folder : RowKind::File;
  row.isFolder = isFolder;
  formatEntryLabel(row.path, isFolder, row.label, sizeof(row.label));
  return row.label[0] != '\0';
}

bool scanDirectoryEntry(bool wantFolder, Dir& dir, char* path, size_t pathLength, char* label, size_t labelLength) {
  BrowserRow row;
  if (!scanDirectoryEntry(dir, row) || row.isFolder != wantFolder) {
    return false;
  }
  copyString(path, pathLength, row.path);
  copyString(label, labelLength, row.label);
  return true;
}

void ensureBrowserCounts() {
  if (g_browserCountsValid && browserCacheMatches(g_browserCountsMode, g_browserCountsPath)) {
    return;
  }

  g_cachedActionCount = 0;
  g_cachedFolderCount = 0;
  g_cachedFileCount = 0;
  g_cachedTotalCount = 0;
  invalidateBrowserRowsCache();

  if (!fileSystemExists || !safeBrowserPath(g_browserPath)) {
    g_browserCountsValid = true;
    g_browserCountsMode = g_browserMode;
    copyString(g_browserCountsPath, sizeof(g_browserCountsPath), g_browserPath);
    return;
  }

  g_cachedActionCount = browserActionRowCount();
  Dir dir = LittleFS.openDir(g_browserPath);
  while (dir.next()) {
    BrowserRow row;
    if (!scanDirectoryEntry(dir, row)) {
      continue;
    }
    if (row.isFolder) {
      ++g_cachedFolderCount;
    } else if (browserIncludesFiles()) {
      ++g_cachedFileCount;
    }
  }

  g_cachedTotalCount =
    static_cast<uint16_t>(g_cachedActionCount + g_cachedFolderCount + g_cachedFileCount);
  g_browserCountsValid = true;
  g_browserCountsMode = g_browserMode;
  copyString(g_browserCountsPath, sizeof(g_browserCountsPath), g_browserPath);
}

int compareEntryKey(const char* label, const char* path, const char* otherLabel, const char* otherPath) {
  int labelCompare = compareSequenceNamesIgnoreCase(label, otherLabel);
  if (labelCompare != 0) {
    return labelCompare;
  }
  return strcmp(path, otherPath);
}

bool findSortedEntry(bool wantFolder, uint16_t rank, BrowserRow& row) {
  char previousLabel[kBrowserLabelLength] = "";
  char previousPath[kSequencePathLength] = "";
  bool havePrevious = false;

  for (uint16_t iteration = 0; iteration <= rank; ++iteration) {
    bool found = false;
    char bestLabel[kBrowserLabelLength] = "";
    char bestPath[kSequencePathLength] = "";

    Dir dir = LittleFS.openDir(g_browserPath);
    while (dir.next()) {
      char candidatePath[kSequencePathLength] = "";
      char candidateLabel[kBrowserLabelLength] = "";
      if (!scanDirectoryEntry(wantFolder,
                              dir,
                              candidatePath,
                              sizeof(candidatePath),
                              candidateLabel,
                              sizeof(candidateLabel))) {
        continue;
      }
      if (havePrevious &&
          compareEntryKey(candidateLabel, candidatePath, previousLabel, previousPath) <= 0) {
        continue;
      }
      if (!found || compareEntryKey(candidateLabel, candidatePath, bestLabel, bestPath) < 0) {
        copyString(bestLabel, sizeof(bestLabel), candidateLabel);
        copyString(bestPath, sizeof(bestPath), candidatePath);
        found = true;
      }
    }

    if (!found) {
      return false;
    }

    copyString(previousLabel, sizeof(previousLabel), bestLabel);
    copyString(previousPath, sizeof(previousPath), bestPath);
    havePrevious = true;
  }

  row.kind = wantFolder ? RowKind::Folder : RowKind::File;
  row.isFolder = wantFolder;
  copyString(row.path, sizeof(row.path), previousPath);
  copyString(row.label, sizeof(row.label), previousLabel);
  return true;
}

bool findNextSortedEntry(bool wantFolder,
                         bool havePrevious,
                         const char* previousLabel,
                         const char* previousPath,
                         BrowserRow& row) {
  bool found = false;
  BrowserRow best;

  Dir dir = LittleFS.openDir(g_browserPath);
  while (dir.next()) {
    BrowserRow candidate;
    if (!scanDirectoryEntry(dir, candidate) || candidate.isFolder != wantFolder) {
      continue;
    }
    if (havePrevious &&
        compareEntryKey(candidate.label, candidate.path, previousLabel, previousPath) <= 0) {
      continue;
    }
    if (!found || compareEntryKey(candidate.label, candidate.path, best.label, best.path) < 0) {
      best = candidate;
      found = true;
    }
  }

  if (!found) {
    return false;
  }
  row = best;
  return true;
}

void appendBrowserCacheRow(const BrowserRow& row) {
  if (g_browserRowsCount >= kBrowserCacheRows) {
    return;
  }
  g_browserRows[g_browserRowsCount++] = row;
}

void appendSortedRowsToBrowserCache(bool wantFolder, uint16_t firstRank, uint16_t rowCount) {
  BrowserRow previous;
  bool havePrevious = false;
  const uint16_t stopRank = static_cast<uint16_t>(firstRank + rowCount);

  for (uint16_t rank = 0; rank < stopRank; ++rank) {
    BrowserRow current;
    if (!findNextSortedEntry(wantFolder, havePrevious, previous.label, previous.path, current)) {
      return;
    }
    if (rank >= firstRank) {
      appendBrowserCacheRow(current);
    }
    previous = current;
    havePrevious = true;
  }
}

void populateBrowserRowsCache(uint16_t startIndex) {
  ensureBrowserCounts();
  invalidateBrowserRowsCache();

  g_browserRowsValid = true;
  g_browserRowsMode = g_browserMode;
  copyString(g_browserRowsPath, sizeof(g_browserRowsPath), g_browserPath);
  g_browserRowsFirstIndex = startIndex;

  if (startIndex >= g_cachedTotalCount) {
    return;
  }

  const uint16_t windowEnd =
    minBrowserIndex(static_cast<uint16_t>(startIndex + kBrowserCacheRows), g_cachedTotalCount);

  for (uint16_t index = startIndex;
       index < windowEnd && index < g_cachedActionCount && g_browserRowsCount < kBrowserCacheRows;
       ++index) {
    BrowserRow row;
    if (actionRow(index, row)) {
      appendBrowserCacheRow(row);
    }
  }

  const uint16_t folderStart = g_cachedActionCount;
  const uint16_t folderEnd = static_cast<uint16_t>(folderStart + g_cachedFolderCount);
  if (windowEnd > folderStart && startIndex < folderEnd && g_browserRowsCount < kBrowserCacheRows) {
    const uint16_t firstIndex = maxBrowserIndex(startIndex, folderStart);
    const uint16_t lastIndex = minBrowserIndex(windowEnd, folderEnd);
    appendSortedRowsToBrowserCache(true,
                                   static_cast<uint16_t>(firstIndex - folderStart),
                                   static_cast<uint16_t>(lastIndex - firstIndex));
  }

  const uint16_t fileStart = folderEnd;
  const uint16_t fileEnd = static_cast<uint16_t>(fileStart + g_cachedFileCount);
  if (windowEnd > fileStart && startIndex < fileEnd && g_browserRowsCount < kBrowserCacheRows) {
    const uint16_t firstIndex = maxBrowserIndex(startIndex, fileStart);
    const uint16_t lastIndex = minBrowserIndex(windowEnd, fileEnd);
    appendSortedRowsToBrowserCache(false,
                                   static_cast<uint16_t>(firstIndex - fileStart),
                                   static_cast<uint16_t>(lastIndex - firstIndex));
  }
}

bool browserRowsCacheCovers(uint16_t index) {
  return g_browserRowsValid && browserCacheMatches(g_browserRowsMode, g_browserRowsPath) &&
         index >= g_browserRowsFirstIndex &&
         index < static_cast<uint16_t>(g_browserRowsFirstIndex + g_browserRowsCount);
}

uint16_t browserRowCount(void*) {
  ensureBrowserCounts();
  return g_cachedTotalCount;
}

bool rowForIndex(uint16_t index, BrowserRow& row) {
  row = BrowserRow{};
  ensureBrowserCounts();
  if (index >= g_cachedTotalCount) {
    return false;
  }

  if (!browserRowsCacheCovers(index)) {
    populateBrowserRowsCache(index);
  }
  if (!browserRowsCacheCovers(index)) {
    return false;
  }

  row = g_browserRows[index - g_browserRowsFirstIndex];
  return true;
}

bool browserLabel(void*, uint16_t index, char* output, size_t outputLength) {
  if (outputLength == 0) {
    return false;
  }
  output[0] = '\0';

  BrowserRow row;
  if (!rowForIndex(index, row)) {
    return false;
  }
  copyString(output, outputLength, row.label);
  return output[0] != '\0';
}

VirtualListMenuRowType browserRowType(void*, uint16_t index) {
  BrowserRow row;
  if (!rowForIndex(index, row)) {
    return VirtualListMenuRowType::Button;
  }
  return row.kind == RowKind::Folder ? VirtualListMenuRowType::Link : VirtualListMenuRowType::Button;
}

void updateBrowserTitle() {
  switch (g_browserMode) {
    case BrowserMode::SaveNew:
      snprintf(g_browserTitle, sizeof(g_browserTitle), "Save Sequence");
      copyString(g_emptyLabel, sizeof(g_emptyLabel), "No Folders");
      break;
    case BrowserMode::CreateFolder:
      snprintf(g_browserTitle, sizeof(g_browserTitle), "Create Folder");
      copyString(g_emptyLabel, sizeof(g_emptyLabel), "No Folders");
      break;
    case BrowserMode::Manage:
      snprintf(g_browserTitle, sizeof(g_browserTitle), "Rename/Delete");
      copyString(g_emptyLabel, sizeof(g_emptyLabel), "No Files");
      break;
    case BrowserMode::Load:
    case BrowserMode::None:
    default:
      snprintf(g_browserTitle, sizeof(g_browserTitle), "Load Sequence");
      copyString(g_emptyLabel, sizeof(g_emptyLabel), "No Sequences");
      break;
  }
}

void setBrowserPath(const char* path) {
  if (path != nullptr && safeBrowserPath(path) && LittleFS.exists(path)) {
    copyString(g_browserPath, sizeof(g_browserPath), path);
  } else {
    copyString(g_browserPath, sizeof(g_browserPath), kSequenceStorageRoot);
  }
  invalidateBrowserCache();
}

void statusForPath(const char* lineOne, const char* path) {
  char label[20] = "";
  extractSequenceDisplayName(path, label, sizeof(label));
  if (label[0] == '\0') {
    folderDisplayName(path, label, sizeof(label));
  }
  showStatusToast(lineOne, label);
}

bool guardSequencerStorageForUsbBackup(const char* actionLineTwo) {
  if (!isUsbBackupActive()) {
    return true;
  }
  showStatusToast("USB Backup", actionLineTwo);
  return false;
}

void returnToSequencerMenu() {
  deactivateVirtualListMenu();
  g_fileUiActive = false;
  g_browserMode = BrowserMode::None;
  g_namingTarget = NamingTarget::None;
  invalidateBrowserCache();
  if (g_sequencerPage != nullptr) {
    menu.setMenuPageCurrent(*g_sequencerPage);
    dismissCommandWheelOverlay();
    menu.drawMenu();
  }
}

void showBrowser() {
  updateBrowserTitle();
  VirtualListMenuProvider provider;
  provider.title = g_browserTitle;
  provider.breadcrumb = g_browserPath;
  provider.getCount = browserRowCount;
  provider.getLabel = browserLabel;
  provider.getRowType = browserRowType;
  provider.select = [](void*, uint16_t index) {
    BrowserRow row;
    if (!rowForIndex(index, row)) {
      return;
    }

    if (row.kind == RowKind::SaveHere) {
      char suggestedName[kSequenceNameLength + 1] = "";
      suggestNewSequenceName(suggestedName, sizeof(suggestedName));
      g_namingTarget = NamingTarget::Sequence;
      copyString(g_namingBuffer, sizeof(g_namingBuffer), suggestedName);
      g_namingLength = static_cast<byte>(strlen(g_namingBuffer));
      g_renameSourcePath[0] = '\0';
      g_namingErrorOne[0] = '\0';
      g_namingErrorTwo[0] = '\0';
      resetOverlayState();
      return;
    }

    if (row.kind == RowKind::CreateHere || row.kind == RowKind::NewFolder) {
      char suggestedName[kSequenceNameLength + 1] = "";
      for (unsigned number = 1; number <= 9999; ++number) {
        char leaf[32] = "";
        char path[kSequencePathLength] = "";
        snprintf(leaf, sizeof(leaf), "Folder %03u", number);
        joinSequencePath(g_browserPath, leaf, path, sizeof(path));
        if (!LittleFS.exists(path)) {
          extractSequenceDisplayName(path, suggestedName, sizeof(suggestedName));
          break;
        }
      }
      if (suggestedName[0] == '\0') {
        copyString(suggestedName, sizeof(suggestedName), "FOLDER");
      }
      g_namingTarget = NamingTarget::Folder;
      copyString(g_namingBuffer, sizeof(g_namingBuffer), suggestedName);
      g_namingLength = static_cast<byte>(strlen(g_namingBuffer));
      g_renameSourcePath[0] = '\0';
      g_namingErrorOne[0] = '\0';
      g_namingErrorTwo[0] = '\0';
      resetOverlayState();
      return;
    }

    if (row.kind == RowKind::ThisFolder) {
      copyString(g_actionTargetPath, sizeof(g_actionTargetPath), row.path);
      g_actionTargetIsFolder = true;
      deactivateVirtualListMenu();
      openActionPage();
      return;
    }

    if (row.kind == RowKind::Folder) {
      setBrowserPath(row.path);
      updateBrowserTitle();
      resetVirtualListMenuSelection();
      return;
    }

    if (row.kind == RowKind::File && g_browserMode == BrowserMode::Load) {
      if (loadSequenceFromPath(row.path, true)) {
        returnToSequencerMenu();
        statusForPath("Loaded", row.path);
      } else {
        showStatusToast("Error Loading", "Read failed");
      }
      return;
    }

    if (row.kind == RowKind::File && g_browserMode == BrowserMode::Manage) {
      copyString(g_actionTargetPath, sizeof(g_actionTargetPath), row.path);
      g_actionTargetIsFolder = false;
      deactivateVirtualListMenu();
      openActionPage();
      return;
    }
  };
  provider.back = [](void*) -> bool {
    if (!sequencePathIsRoot(g_browserPath)) {
      char parent[kSequencePathLength] = "";
      extractSequenceParentPath(g_browserPath, parent, sizeof(parent));
      setBrowserPath(parent);
      updateBrowserTitle();
      resetVirtualListMenuSelection();
      return true;
    }
    return false;
  };
  provider.close = [](void*) {
    returnToSequencerMenu();
  };
  provider.emptyLabel = g_emptyLabel;
  openVirtualListMenu(provider);
}

void openBrowser(BrowserMode mode) {
  if (!guardSequencerStorageForUsbBackup("Stop session first")) {
    return;
  }
  if (!fileSystemExists || !ensureSequenceStorageRoot()) {
    showStatusToast("No Storage", "Flash unavailable");
    return;
  }

  g_fileUiActive = true;
  g_browserMode = mode;
  g_actionTargetPath[0] = '\0';
  g_deleteTargetPath[0] = '\0';
  g_renameSourcePath[0] = '\0';
  g_namingTarget = NamingTarget::None;

  char startPath[kSequencePathLength] = "";
  if (hasCurrentSequencePath()) {
    extractSequenceParentPath(currentSequencePath(), startPath, sizeof(startPath));
  } else {
    copyString(startPath, sizeof(startPath), kSequenceStorageRoot);
  }
  setBrowserPath(startPath);
  showBrowser();
}

void newSequenceCallback() {
  if (!guardSequencerStorageForUsbBackup("Stop session first")) {
    return;
  }
  newBlankSequence();
  returnToSequencerMenu();
  showStatusToast("New", "Blank sequence");
}

void saveSequenceCallback() {
  if (!guardSequencerStorageForUsbBackup("Stop session first")) {
    return;
  }
  if (hasCurrentSequencePath()) {
    const char* savedPath = currentSequencePath();
    if (saveSequenceToCurrentPath()) {
      returnToSequencerMenu();
      statusForPath("Saved", savedPath);
    } else {
      showStatusToast("Error Saving", "Flash failed");
    }
    return;
  }
  openBrowser(BrowserMode::SaveNew);
}

void saveNewCallback() {
  if (!guardSequencerStorageForUsbBackup("Stop session first")) {
    return;
  }
  openBrowser(BrowserMode::SaveNew);
}

void loadCallback() {
  if (!guardSequencerStorageForUsbBackup("Stop session first")) {
    return;
  }
  openBrowser(BrowserMode::Load);
}

void revertCallback() {
  if (!guardSequencerStorageForUsbBackup("Stop session first")) {
    return;
  }
  const bool hadPath = hasCurrentSequencePath();
  char path[kSequencePathLength] = "";
  if (hadPath) {
    copyString(path, sizeof(path), currentSequencePath());
  }
  if (revertSequence()) {
    returnToSequencerMenu();
    if (hadPath) {
      statusForPath("Reverted", path);
    } else {
      showStatusToast("Reverted", "Blank sequence");
    }
  } else {
    showStatusToast("Error Loading", "Read failed");
  }
}

void createFolderCallback() {
  if (!guardSequencerStorageForUsbBackup("Stop session first")) {
    return;
  }
  openBrowser(BrowserMode::CreateFolder);
}

void manageCallback() {
  if (!guardSequencerStorageForUsbBackup("Stop session first")) {
    return;
  }
  openBrowser(BrowserMode::Manage);
}

GEMPage& fileMenuPage(GEMPage& parentPage) {
  static GEMPage page("File Management", parentPage);
  return page;
}

GEMItem& fileMenuLink(GEMPage& parentPage) {
  static GEMItem item("File Management", fileMenuPage(parentPage));
  return item;
}

GEMItem& newItem() {
  static GEMItem item("New", newSequenceCallback);
  return item;
}

GEMItem& saveItem() {
  static GEMItem item("Save", saveSequenceCallback);
  return item;
}

GEMItem& saveNewItem() {
  static GEMItem item("Save New", saveNewCallback);
  return item;
}

GEMItem& loadItem() {
  static GEMItem item("Load", loadCallback);
  return item;
}

GEMItem& revertItem() {
  static GEMItem item("Revert", revertCallback);
  return item;
}

GEMItem& createFolderItem() {
  static GEMItem item("Create Folder", createFolderCallback);
  return item;
}

GEMItem& manageItem() {
  static GEMItem item("Rename/Delete", manageCallback);
  return item;
}

GEMPage& usbBackupPage(GEMPage& parentPage) {
  static GEMPage page("USB Backup", fileMenuPage(parentPage));
  return page;
}

GEMPage& usbBackupExitPage(GEMPage& parentPage) {
  static GEMPage page("Leave Backup?", usbBackupPage(parentPage));
  return page;
}

GEMPage& usbBackupStopPage(GEMPage& parentPage) {
  static GEMPage page("Stop Session?", usbBackupPage(parentPage));
  return page;
}

GEMItem& usbBackupLinkItem(GEMPage& parentPage) {
  static GEMItem item("USB Backup", usbBackupPage(parentPage));
  return item;
}

GEMItem& usbBackupStatusOneItem() {
  static GEMItem item(g_usbBackupStatusLineOne, usbBackupStatusCallback);
  return item;
}

GEMItem& usbBackupStatusTwoItem() {
  static GEMItem item(g_usbBackupStatusLineTwo, usbBackupStatusCallback);
  return item;
}

GEMItem& usbBackupStartItem() {
  static GEMItem item("Start Session", startUsbBackupCallback);
  return item;
}

GEMItem& usbBackupStopItem() {
  static GEMItem item("Stop Session", stopUsbBackupCallback);
  return item;
}

GEMItem& usbBackupExitPromptOneItem() {
  static GEMItem item("Leaving this page", usbBackupPromptCallback);
  return item;
}

GEMItem& usbBackupExitPromptTwoItem() {
  static GEMItem item("will close", usbBackupPromptCallback);
  return item;
}

GEMItem& usbBackupExitPromptThreeItem() {
  static GEMItem item("USB Backup.", usbBackupPromptCallback);
  return item;
}

GEMItem& usbBackupExitPromptFourItem() {
  static GEMItem item("Continue?", usbBackupPromptCallback);
  return item;
}

GEMItem& usbBackupExitYesItem() {
  static GEMItem item("Yes, Leave", confirmUsbBackupExitCallback);
  return item;
}

GEMItem& usbBackupExitNoItem() {
  static GEMItem item("No, Stay", cancelUsbBackupExitCallback);
  return item;
}

GEMItem& usbBackupStopPromptOneItem() {
  static GEMItem item("Stopping this", usbBackupPromptCallback);
  return item;
}

GEMItem& usbBackupStopPromptTwoItem() {
  static GEMItem item("session ends", usbBackupPromptCallback);
  return item;
}

GEMItem& usbBackupStopPromptThreeItem() {
  static GEMItem item("any transfer.", usbBackupPromptCallback);
  return item;
}

GEMItem& usbBackupStopPromptFourItem() {
  static GEMItem item("Continue?", usbBackupPromptCallback);
  return item;
}

GEMItem& usbBackupStopYesItem() {
  static GEMItem item("Yes, Stop", confirmUsbBackupStopCallback);
  return item;
}

GEMItem& usbBackupStopNoItem() {
  static GEMItem item("No, Stay", cancelUsbBackupStopCallback);
  return item;
}

GEMPage& actionPage() {
  static GEMPage page("File Action?");
  return page;
}

GEMItem& actionPromptOneItem() {
  static GEMItem item(g_promptLineOne, promptCallback);
  return item;
}

GEMItem& actionPromptTwoItem() {
  static GEMItem item(g_promptLineTwo, promptCallback);
  return item;
}

GEMItem& actionPromptThreeItem() {
  static GEMItem item(g_promptLineThree, promptCallback);
  return item;
}

GEMItem& actionPromptFourItem() {
  static GEMItem item(g_promptLineFour, promptCallback);
  return item;
}

GEMItem& actionRenameItem() {
  static GEMItem item("Rename", actionRenameCallback);
  return item;
}

GEMItem& actionDeleteItem() {
  static GEMItem item("Delete", actionDeleteCallback);
  return item;
}

GEMItem& actionCancelItem() {
  static GEMItem item("Cancel", actionCancelCallback);
  return item;
}

GEMPage& deletePage() {
  static GEMPage page("Delete File?");
  return page;
}

GEMItem& deletePromptOneItem() {
  static GEMItem item(g_promptLineOne, promptCallback);
  return item;
}

GEMItem& deletePromptTwoItem() {
  static GEMItem item(g_promptLineTwo, promptCallback);
  return item;
}

GEMItem& deletePromptThreeItem() {
  static GEMItem item(g_promptLineThree, promptCallback);
  return item;
}

GEMItem& deletePromptFourItem() {
  static GEMItem item(g_promptLineFour, promptCallback);
  return item;
}

GEMItem& deleteYesItem() {
  static GEMItem item("Yes, Delete", confirmDeleteCallback);
  return item;
}

GEMItem& deleteCancelItem() {
  static GEMItem item("Cancel", cancelDeleteCallback);
  return item;
}

void promptCallback() {
}

void refreshUsbBackupMenu(bool redrawMenu) {
  if (isUsbBackupActive()) {
    char statusLineOne[kBrowserLabelLength];
    char statusLineTwo[kBrowserLabelLength];
    getUsbBackupStatusLines(statusLineOne, sizeof(statusLineOne),
                            statusLineTwo, sizeof(statusLineTwo));
    copyString(g_usbBackupStatusLineOne, sizeof(g_usbBackupStatusLineOne), statusLineOne);
    copyString(g_usbBackupStatusLineTwo, sizeof(g_usbBackupStatusLineTwo), statusLineTwo);
    usbBackupStartItem().hide();
    usbBackupStopItem().show();
  } else {
    copyString(g_usbBackupStatusLineOne, sizeof(g_usbBackupStatusLineOne), "USB Backup Off");
    copyString(g_usbBackupStatusLineTwo, sizeof(g_usbBackupStatusLineTwo), "Host tool idle");
    usbBackupStartItem().show();
    usbBackupStopItem().hide();
  }

  usbBackupStatusOneItem().setTitle(g_usbBackupStatusLineOne);
  usbBackupStatusTwoItem().setTitle(g_usbBackupStatusLineTwo);

  if (redrawMenu && g_usbBackupPage != nullptr && menu.getCurrentMenuPage() == g_usbBackupPage) {
    dismissCommandWheelOverlay();
    menu.drawMenu();
  }
}

void usbBackupStatusCallback() {
}

void usbBackupPromptCallback() {
}

void startUsbBackupCallback() {
  if (enterUsbBackupMode()) {
    stopTransport();
    stopAllManagedNotes();
    resetOverlayState();
    showStatusToast("USB Backup", "Run host tool");
  } else {
    showStatusToast("USB Backup", "FS unavailable");
  }
  refreshUsbBackupMenu(true);
}

void stopUsbBackupCallback() {
  if (!isUsbBackupActive()) {
    exitUsbBackupMode();
    showStatusToast("USB Backup", "Session closed");
    refreshUsbBackupMenu(true);
    return;
  }

  if (g_usbBackupStopPage == nullptr) {
    return;
  }
  menu.setMenuPageCurrent(*g_usbBackupStopPage);
  dismissCommandWheelOverlay();
  menu.drawMenu();
  g_lastMenuPage = g_usbBackupStopPage;
}

void confirmUsbBackupExitCallback() {
  exitUsbBackupMode();
  if (g_usbBackupPage != nullptr) {
    refreshUsbBackupMenu(false);
  }
  if (g_sequencerPage != nullptr) {
    menu.setMenuPageCurrent(fileMenuPage(*g_sequencerPage));
    dismissCommandWheelOverlay();
    menu.drawMenu();
    g_lastMenuPage = &fileMenuPage(*g_sequencerPage);
  }
  showStatusToast("USB Backup", "Session closed");
}

void cancelUsbBackupExitCallback() {
  if (g_usbBackupPage == nullptr) {
    return;
  }
  menu.setMenuPageCurrent(*g_usbBackupPage);
  refreshUsbBackupMenu(false);
  dismissCommandWheelOverlay();
  menu.drawMenu();
  showStatusToast("USB Backup", "Session active");
  g_lastMenuPage = g_usbBackupPage;
}

void confirmUsbBackupStopCallback() {
  exitUsbBackupMode();
  if (g_usbBackupPage == nullptr) {
    return;
  }
  menu.setMenuPageCurrent(*g_usbBackupPage);
  refreshUsbBackupMenu(false);
  dismissCommandWheelOverlay();
  menu.drawMenu();
  showStatusToast("USB Backup", "Session closed");
  g_lastMenuPage = g_usbBackupPage;
}

void cancelUsbBackupStopCallback() {
  if (g_usbBackupPage == nullptr) {
    return;
  }
  menu.setMenuPageCurrent(*g_usbBackupPage);
  refreshUsbBackupMenu(false);
  dismissCommandWheelOverlay();
  menu.drawMenu();
  showStatusToast("USB Backup", "Session active");
  g_lastMenuPage = g_usbBackupPage;
}

void guardUsbBackupMenuExit() {
  if (g_usbBackupPage == nullptr ||
      g_usbBackupExitPage == nullptr ||
      g_usbBackupStopPage == nullptr) {
    return;
  }

  GEMPage* currentPage = menu.getCurrentMenuPage();
  if (g_lastMenuPage == g_usbBackupPage &&
      currentPage != g_usbBackupPage &&
      currentPage != g_usbBackupExitPage &&
      currentPage != g_usbBackupStopPage &&
      isUsbBackupActive()) {
    menu.setMenuPageCurrent(*g_usbBackupExitPage);
    dismissCommandWheelOverlay();
    menu.drawMenu();
    g_lastMenuPage = g_usbBackupExitPage;
    return;
  }
  g_lastMenuPage = currentPage;
}

void refreshActionPage() {
  char displayName[kBrowserLabelLength] = "";
  extractSequenceDisplayName(g_actionTargetPath, displayName, sizeof(displayName));
  if (displayName[0] == '\0') {
    copyString(displayName, sizeof(displayName), g_actionTargetIsFolder ? "Folder" : "File");
  }

  copyString(g_promptLineOne, sizeof(g_promptLineOne), g_actionTargetIsFolder ? "Folder:" : "File:");
  copyString(g_promptLineTwo, sizeof(g_promptLineTwo), displayName);
  copyString(g_promptLineThree, sizeof(g_promptLineThree), "");
  copyString(g_promptLineFour, sizeof(g_promptLineFour), "Choose action.");

  actionPromptOneItem().setTitle(g_promptLineOne);
  actionPromptTwoItem().setTitle(g_promptLineTwo);
  actionPromptThreeItem().setTitle(g_promptLineThree);
  actionPromptFourItem().setTitle(g_promptLineFour);
  actionPage().setTitle(g_actionTargetIsFolder ? "Folder Action?" : "File Action?");
}

void openActionPage() {
  refreshActionPage();
  g_fileUiActive = true;
  menu.setMenuPageCurrent(actionPage());
  actionPage().setCurrentMenuItemIndex(4);
  dismissCommandWheelOverlay();
  menu.drawMenu();
}

void actionRenameCallback() {
  if (g_actionTargetPath[0] == '\0') {
    showBrowser();
    return;
  }

  extractSequenceDisplayName(g_actionTargetPath, g_namingBuffer, sizeof(g_namingBuffer));
  g_namingLength = static_cast<byte>(strlen(g_namingBuffer));
  copyString(g_renameSourcePath, sizeof(g_renameSourcePath), g_actionTargetPath);
  g_namingTarget = g_actionTargetIsFolder ? NamingTarget::RenameFolder : NamingTarget::RenameSequence;
  g_actionTargetPath[0] = '\0';
  g_namingErrorOne[0] = '\0';
  g_namingErrorTwo[0] = '\0';
  resetOverlayState();
}

void actionDeleteCallback() {
  if (g_actionTargetPath[0] == '\0') {
    showBrowser();
    return;
  }

  copyString(g_deleteTargetPath, sizeof(g_deleteTargetPath), g_actionTargetPath);
  g_deleteTargetIsFolder = g_actionTargetIsFolder;
  g_actionTargetPath[0] = '\0';

  char displayName[kBrowserLabelLength] = "";
  extractSequenceDisplayName(g_deleteTargetPath, displayName, sizeof(displayName));
  if (displayName[0] == '\0') {
    copyString(displayName, sizeof(displayName), g_deleteTargetIsFolder ? "Folder" : "File");
  }

  copyString(g_promptLineOne, sizeof(g_promptLineOne), g_deleteTargetIsFolder ? "Delete folder:" : "Delete file:");
  copyString(g_promptLineTwo, sizeof(g_promptLineTwo), displayName);
  copyString(g_promptLineThree, sizeof(g_promptLineThree), "This cannot be");
  copyString(g_promptLineFour, sizeof(g_promptLineFour), "undone.");

  deletePromptOneItem().setTitle(g_promptLineOne);
  deletePromptTwoItem().setTitle(g_promptLineTwo);
  deletePromptThreeItem().setTitle(g_promptLineThree);
  deletePromptFourItem().setTitle(g_promptLineFour);
  deletePage().setTitle(g_deleteTargetIsFolder ? "Delete Folder?" : "Delete File?");
  menu.setMenuPageCurrent(deletePage());
  deletePage().setCurrentMenuItemIndex(4);
  dismissCommandWheelOverlay();
  menu.drawMenu();
}

void actionCancelCallback() {
  g_actionTargetPath[0] = '\0';
  g_actionTargetIsFolder = false;
  showBrowser();
}

bool deleteFolderRecursive(const char* folderPath) {
  if (!sequencePathIsSafeStoragePath(folderPath) || sequencePathIsRoot(folderPath) ||
      !LittleFS.exists(folderPath)) {
    return false;
  }

  while (true) {
    char childPath[kSequencePathLength] = "";
    bool childIsFolder = false;
    bool foundChild = false;

    Dir dir = LittleFS.openDir(folderPath);
    while (dir.next()) {
      String entryName = dir.fileName();
      if (entryNameIsHidden(entryName.c_str())) {
        continue;
      }
      joinSequencePath(folderPath, entryName.c_str(), childPath, sizeof(childPath));
      childIsFolder = dir.isDirectory();
      foundChild = true;
      break;
    }

    if (!foundChild) {
      break;
    }
    if (childIsFolder) {
      if (!deleteFolderRecursive(childPath)) {
        return false;
      }
    } else if (!LittleFS.remove(childPath)) {
      return false;
    }
  }

  return LittleFS.rmdir(folderPath);
}

void clearCurrentPathIfDeleted(const char* path, bool isFolder) {
  if (!hasCurrentSequencePath()) {
    return;
  }
  if ((isFolder && sequencePathIsWithinFolder(currentSequencePath(), path)) ||
      (!isFolder && strcmp(currentSequencePath(), path) == 0)) {
    clearCurrentSequencePath();
  }
}

void confirmDeleteCallback() {
  if (g_deleteTargetPath[0] == '\0') {
    cancelDeleteCallback();
    return;
  }

  char deletedPath[kSequencePathLength] = "";
  copyString(deletedPath, sizeof(deletedPath), g_deleteTargetPath);
  const bool deletedFolder = g_deleteTargetIsFolder;
  g_deleteTargetPath[0] = '\0';
  g_deleteTargetIsFolder = false;

  bool deleted = false;
  if (deletedFolder) {
    char parent[kSequencePathLength] = "";
    extractSequenceParentPath(deletedPath, parent, sizeof(parent));
    deleted = runFlashSafeFileMenuWrite([&]() {
      return deleteFolderRecursive(deletedPath);
    });
    if (deleted) {
      clearCurrentPathIfDeleted(deletedPath, true);
      setBrowserPath(parent);
    }
  } else {
    deleted = runFlashSafeFileMenuWrite([&]() {
      return LittleFS.remove(deletedPath);
    });
    if (deleted) {
      clearCurrentPathIfDeleted(deletedPath, false);
    }
  }

  if (deleted) {
    invalidateBrowserCache();
    showBrowser();
  } else {
    showBrowser();
  }
}

void cancelDeleteCallback() {
  g_deleteTargetPath[0] = '\0';
  g_deleteTargetIsFolder = false;
  showBrowser();
}

void setNamingError(const char* lineOne, const char* lineTwo) {
  copyString(g_namingErrorOne, sizeof(g_namingErrorOne), lineOne);
  copyString(g_namingErrorTwo, sizeof(g_namingErrorTwo), lineTwo);
}

void finishNamingToBrowser() {
  g_namingTarget = NamingTarget::None;
  g_namingBuffer[0] = '\0';
  g_namingLength = 0;
  g_renameSourcePath[0] = '\0';
  g_namingErrorOne[0] = '\0';
  g_namingErrorTwo[0] = '\0';
  invalidateBrowserCache();
  showBrowser();
}

bool commitNaming() {
  if (g_namingTarget == NamingTarget::None) {
    return false;
  }
  if (g_namingLength == 0) {
    setNamingError("Name Empty", "Enter a name");
    return true;
  }

  char targetPath[kSequencePathLength] = "";
  if (g_namingTarget == NamingTarget::Sequence || g_namingTarget == NamingTarget::RenameSequence) {
    char fileLeaf[32] = "";
    snprintf(fileLeaf, sizeof(fileLeaf), "%s%s", g_namingBuffer, kSequenceFileExtension);

    if (g_namingTarget == NamingTarget::RenameSequence) {
      char parent[kSequencePathLength] = "";
      extractSequenceParentPath(g_renameSourcePath, parent, sizeof(parent));
      joinSequencePath(parent, fileLeaf, targetPath, sizeof(targetPath));
      if (strcmp(targetPath, g_renameSourcePath) == 0) {
        finishNamingToBrowser();
        return true;
      }
      if (LittleFS.exists(targetPath)) {
        setNamingError("Name Exists", "Pick another");
        return true;
      }
      bool renamed = runFlashSafeFileMenuWrite([&]() {
        return LittleFS.rename(g_renameSourcePath, targetPath);
      });
      if (renamed) {
        if (hasCurrentSequencePath() && strcmp(currentSequencePath(), g_renameSourcePath) == 0) {
          setCurrentSequencePath(targetPath);
        }
        finishNamingToBrowser();
        return true;
      }
      setNamingError("Error Rename", "File failed");
      return true;
    }

    joinSequencePath(g_browserPath, fileLeaf, targetPath, sizeof(targetPath));
    if (LittleFS.exists(targetPath)) {
      setNamingError("Name Exists", "Pick another");
      return true;
    }
    if (saveSequenceToPath(targetPath)) {
      g_namingTarget = NamingTarget::None;
      invalidateBrowserCache();
      returnToSequencerMenu();
      statusForPath("Saved New", targetPath);
      return true;
    }
    setNamingError("Error Saving", "Save New failed");
    return true;
  }

  if (g_namingTarget == NamingTarget::RenameFolder) {
    char parent[kSequencePathLength] = "";
    extractSequenceParentPath(g_renameSourcePath, parent, sizeof(parent));
    joinSequencePath(parent, g_namingBuffer, targetPath, sizeof(targetPath));
    if (strcmp(targetPath, g_renameSourcePath) == 0) {
      finishNamingToBrowser();
      return true;
    }
    if (LittleFS.exists(targetPath)) {
      setNamingError("Name Exists", "Pick another");
      return true;
    }
    bool renamed = runFlashSafeFileMenuWrite([&]() {
      return LittleFS.rename(g_renameSourcePath, targetPath);
    });
    if (!renamed) {
      setNamingError("Error Rename", "Folder failed");
      return true;
    }
    if (hasCurrentSequencePath() && sequencePathIsWithinFolder(currentSequencePath(), g_renameSourcePath)) {
      char repaired[kSequencePathLength] = "";
      copyString(repaired, sizeof(repaired), targetPath);
      if (appendString(repaired, sizeof(repaired), currentSequencePath() + strlen(g_renameSourcePath))) {
        setCurrentSequencePath(repaired);
      }
    }
    setBrowserPath(targetPath);
    finishNamingToBrowser();
    return true;
  }

  joinSequencePath(g_browserPath, g_namingBuffer, targetPath, sizeof(targetPath));
  if (LittleFS.exists(targetPath)) {
    setNamingError("Name Exists", "Pick another");
    return true;
  }
  bool created = runFlashSafeFileMenuWrite([&]() {
    return LittleFS.mkdir(targetPath);
  });
  if (!created) {
    setNamingError("Error Folder", "Create failed");
    return true;
  }
  setBrowserPath(targetPath);
  finishNamingToBrowser();
  return true;
}

const NamingKey* namingKeyForButton(byte buttonIndex) {
  for (byte i = 0; i < sizeof(kNamingKeys) / sizeof(kNamingKeys[0]); ++i) {
    if (kNamingKeys[i].buttonIndex == buttonIndex) {
      return &kNamingKeys[i];
    }
  }
  return nullptr;
}

uint32_t namingBlueColor() {
  colorDef color = {
    kNamingBlueHue,
    SAT_VIVID,
    applyLEDLevel(kNamingBlueValue, ledRestBrightness)
  };
  return getLEDcode(color);
}

}  // namespace

void setupSequenceFileMenu(GEMPage& sequencerMenuPage) {
  if (g_fileMenuInstalled) {
    return;
  }

  g_sequencerPage = &sequencerMenuPage;
  GEMPage& page = fileMenuPage(sequencerMenuPage);
  page.addMenuItem(newItem());
  page.addMenuItem(saveItem());
  page.addMenuItem(saveNewItem());
  page.addMenuItem(loadItem());
  page.addMenuItem(revertItem());
  page.addMenuItem(createFolderItem());
  page.addMenuItem(manageItem());
  page.addMenuItem(usbBackupLinkItem(sequencerMenuPage));

  g_usbBackupPage = &usbBackupPage(sequencerMenuPage);
  g_usbBackupExitPage = &usbBackupExitPage(sequencerMenuPage);
  g_usbBackupStopPage = &usbBackupStopPage(sequencerMenuPage);
  g_usbBackupPage->addMenuItem(usbBackupStatusOneItem());
  g_usbBackupPage->addMenuItem(usbBackupStatusTwoItem());
  g_usbBackupPage->addMenuItem(usbBackupStartItem());
  g_usbBackupPage->addMenuItem(usbBackupStopItem());
  g_usbBackupExitPage->addMenuItem(usbBackupExitPromptOneItem());
  g_usbBackupExitPage->addMenuItem(usbBackupExitPromptTwoItem());
  g_usbBackupExitPage->addMenuItem(usbBackupExitPromptThreeItem());
  g_usbBackupExitPage->addMenuItem(usbBackupExitPromptFourItem());
  g_usbBackupExitPage->addMenuItem(usbBackupExitYesItem());
  g_usbBackupExitPage->addMenuItem(usbBackupExitNoItem());
  g_usbBackupStopPage->addMenuItem(usbBackupStopPromptOneItem());
  g_usbBackupStopPage->addMenuItem(usbBackupStopPromptTwoItem());
  g_usbBackupStopPage->addMenuItem(usbBackupStopPromptThreeItem());
  g_usbBackupStopPage->addMenuItem(usbBackupStopPromptFourItem());
  g_usbBackupStopPage->addMenuItem(usbBackupStopYesItem());
  g_usbBackupStopPage->addMenuItem(usbBackupStopNoItem());

  actionPage().addMenuItem(actionPromptOneItem());
  actionPage().addMenuItem(actionPromptTwoItem());
  actionPage().addMenuItem(actionPromptThreeItem());
  actionPage().addMenuItem(actionPromptFourItem());
  actionPage().addMenuItem(actionRenameItem());
  actionPage().addMenuItem(actionDeleteItem());
  actionPage().addMenuItem(actionCancelItem());

  deletePage().addMenuItem(deletePromptOneItem());
  deletePage().addMenuItem(deletePromptTwoItem());
  deletePage().addMenuItem(deletePromptThreeItem());
  deletePage().addMenuItem(deletePromptFourItem());
  deletePage().addMenuItem(deleteYesItem());
  deletePage().addMenuItem(deleteCancelItem());

  sequencerMenuPage.addMenuItem(fileMenuLink(sequencerMenuPage));
  refreshUsbBackupMenu(false);
  g_fileMenuInstalled = true;
}

bool fileWorkflowActive() {
  if (g_fileUiActive || g_namingTarget != NamingTarget::None || isUsbBackupActive()) {
    return true;
  }
  if (g_sequencerPage == nullptr) {
    return false;
  }

  GEMPage* currentPage = menu.getCurrentMenuPage();
  return currentPage == &fileMenuPage(*g_sequencerPage) ||
         currentPage == g_usbBackupPage ||
         currentPage == g_usbBackupExitPage ||
         currentPage == g_usbBackupStopPage;
}

bool fileNamingActive() {
  return g_namingTarget != NamingTarget::None;
}

void serviceSequenceFileMenu() {
  guardUsbBackupMenuExit();
  if (consumeUsbBackupUiRefreshRequested()) {
    refreshUsbBackupMenu(g_usbBackupPage != nullptr && menu.getCurrentMenuPage() == g_usbBackupPage);
  }
}

bool handleFileMenuButtonEvent(byte buttonIndex, bool pressed) {
  if (isUsbBackupActive()) {
    return true;
  }
  if (g_namingTarget == NamingTarget::None) {
    return g_fileUiActive;
  }
  if (!pressed) {
    return true;
  }

  const NamingKey* key = namingKeyForButton(buttonIndex);
  if (key == nullptr) {
    return true;
  }

  g_namingErrorOne[0] = '\0';
  g_namingErrorTwo[0] = '\0';
  if (key->action == NamingAction::InsertChar) {
    if (g_namingLength < kSequenceNameLength) {
      g_namingBuffer[g_namingLength++] = key->character;
      g_namingBuffer[g_namingLength] = '\0';
    }
  } else if (key->action == NamingAction::Backspace) {
    if (g_namingLength > 0) {
      g_namingBuffer[--g_namingLength] = '\0';
    }
  } else if (key->action == NamingAction::Cancel) {
    finishNamingToBrowser();
  }
  return true;
}

bool handleFileMenuRotaryTurn(int8_t direction) {
  (void)direction;
  return g_namingTarget != NamingTarget::None;
}

bool handleFileMenuEncoderClick() {
  return commitNaming();
}

void drawFileMenuOverlay() {
  if (g_namingTarget == NamingTarget::None) {
    return;
  }

  dismissCommandWheelOverlay();
  screenTime = 0;
  wakeDisplayFromScreensaver();

  char nameLine[kSequenceNameLength + 2] = "";
  copyString(nameLine, sizeof(nameLine), g_namingBuffer);
  const bool showCursor = ((runTime / 400000ULL) % 2ULL) == 0ULL;
  if (showCursor && g_namingLength < kSequenceNameLength) {
    nameLine[g_namingLength] = '_';
    nameLine[g_namingLength + 1] = '\0';
  }

  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_6x13_tf);
  u8g2.drawStr(4, 16, nameLine);

  u8g2.setFont(u8g2_font_5x8_tf);
  if (g_namingErrorOne[0] != '\0') {
    u8g2.drawStr(4, 32, g_namingErrorOne);
    u8g2.drawStr(4, 44, g_namingErrorTwo);
  } else {
    u8g2.drawStr(4, 36, "A B C D E F G H");
    u8g2.drawStr(4, 50, "I J K L M N O P");
    u8g2.drawStr(4, 64, "Q R S T U V W X");
    u8g2.drawStr(4, 78, "Y Z SPC - 1 2 3 4 5");
    u8g2.drawStr(4, 96, "<- 6 7 8 9 0 CANCEL");
  }
  u8g2.sendBuffer();
}

void renderFileMenuLedOverrides(FileMenuSetLedPixelFn setLedPixel) {
  if (setLedPixel == nullptr || g_namingTarget == NamingTarget::None) {
    return;
  }

  for (byte buttonIndex = 0; buttonIndex < LED_COUNT; ++buttonIndex) {
    setLedPixel(buttonIndex, 0);
  }
  const uint32_t blue = namingBlueColor();
  for (byte i = 0; i < sizeof(kNamingKeys) / sizeof(kNamingKeys[0]); ++i) {
    setLedPixel(kNamingKeys[i].buttonIndex, blue);
  }
}

}  // namespace sequencer

#else

namespace sequencer {

void setupSequenceFileMenu(GEMPage&) {}
bool fileWorkflowActive() { return false; }
bool fileNamingActive() { return false; }
void serviceSequenceFileMenu() {}
bool handleFileMenuButtonEvent(byte, bool) { return false; }
bool handleFileMenuRotaryTurn(int8_t) { return false; }
bool handleFileMenuEncoderClick() { return false; }
void drawFileMenuOverlay() {}
void renderFileMenuLedOverrides(FileMenuSetLedPixelFn) {}

}  // namespace sequencer

#endif
