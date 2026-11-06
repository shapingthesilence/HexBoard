#pragma once

#include "../FirmwareModule.h"
#include "PersistentDataModels.h"

// The synth preset catalog: preset files under /presets/<bucket>/ plus the
// per-folder index in /preset_index (SynthPresetIndexCodec.h). Only the folder
// table lives in RAM; listings stream from the folder index files.
//
// Handles are slot x SYNTH_PRESET_HANDLE_STRIDE + position. Saving keeps
// existing handles; deleting or moving a preset shifts later handles in its
// folder only.
//
// Without a valid index (missing, invalid, or a change was interrupted), the
// catalog runs in directory-scan mode: handles are positions among preset
// files and every lookup opens preset files. Boot never writes; the index is
// rebuilt on first use after boot and before every catalog write. A rebuild
// also moves preset files from the old flat /presets layout into buckets.

constexpr char SYNTH_PRESET_STORAGE_ROOT[] = "/presets";
constexpr char SYNTH_PRESET_FILE_EXTENSION[] = ".hsp";
constexpr size_t SYNTH_PRESET_STORAGE_PATH_LENGTH = 64;
constexpr char SYNTH_PRESET_INDEX_ROOT[] = "/preset_index";
constexpr char SYNTH_PRESET_INDEX_TABLE_PATH[] = "/preset_index/folders.hpf";
constexpr char SYNTH_PRESET_INDEX_PENDING_PATH[] = "/preset_index/pending";
constexpr uint16_t SYNTH_PRESET_HANDLE_STRIDE = 256;
constexpr uint16_t SYNTH_PRESET_CATALOG_NEW_HANDLE = 0xFFFFu;

struct SynthPresetCatalogEntry {
  uint16_t handle = 0;
  uint8_t flags = 0;
  uint8_t objectId[SYNTH_PRESET_OBJECT_ID_LENGTH] = {};
  char name[SYNTH_PRESET_NAME_LENGTH] = {};
  char folderPath[SYNTH_PRESET_FOLDER_LENGTH] = {};
};

// Return false to stop visiting.
using SynthPresetCatalogVisitor = bool (*)(void* context, const SynthPresetCatalogEntry& entry);
using SynthPresetFolderPathVisitor = void (*)(void* context, const char* folderPath);

enum class SynthPresetStoreResult : uint8_t {
  Stored,
  LibraryFull,
  FolderFull,
  TooManyFolders,
  HandleMismatch,
  StorageError
};

void loadSynthPresetCatalog();
void clearSynthPresetCatalog();
bool synthPresetCatalogIndexed();
// Handles are below this limit; not every handle below it is used.
uint16_t synthPresetCatalogHandleLimit();
uint16_t synthPresetCatalogCount();
// Changes whenever any handle, name or folder may have changed.
uint32_t synthPresetCatalogGeneration();

bool readSynthPresetCatalogEntry(uint16_t handle, SynthPresetCatalogEntry& entry);
bool findSynthPresetCatalogHandle(const uint8_t* objectId, uint16_t& handle);
bool visitSynthPresetCatalog(SynthPresetCatalogVisitor visitor, void* context);
// Presets directly in one folder, in handle order.
bool visitSynthPresetCatalogFolder(const char* folderPath, SynthPresetCatalogVisitor visitor, void* context);
// Starts after `skip` matching presets; folderPath nullptr matches every preset.
// With an index, whole folders before the start are skipped without reading.
bool visitSynthPresetCatalogFrom(const char* folderPath, uint16_t skip,
                                 SynthPresetCatalogVisitor visitor, void* context);
uint16_t synthPresetCatalogMatchCount(const char* folderPath);
// Every folder path that holds presets. In scan mode a path may repeat.
void visitSynthPresetCatalogFolderPaths(SynthPresetFolderPathVisitor visitor, void* context);

// Rebuilds a missing or interrupted index. Automatic attempts (userInitiated
// false) stop after one failure until the next boot; writes always retry.
bool ensureSynthPresetCatalogIndexed(bool userInitiated);

// Writes the preset file and updates the index. With
// SYNTH_PRESET_CATALOG_NEW_HANDLE, an existing preset with the same object id
// is replaced; otherwise the preset is appended to its folder.
SynthPresetStoreResult storeSynthPresetInCatalog(uint16_t handle,
                                                 const SynthPresetSlot& preset,
                                                 uint16_t& storedHandle);
bool removeSynthPresetFromCatalog(uint16_t handle);

bool synthPresetStoragePath(const uint8_t* objectId, char* output, size_t outputLength);
bool readSynthPresetPayload(File& file, SynthPresetSlot& preset);
bool readSynthPresetFileByObjectId(const uint8_t* objectId, SynthPresetSlot& preset);
const char* synthPresetStoreResultMessage(SynthPresetStoreResult result);

template <typename Visit>
bool visitSynthPresetCatalogWith(Visit& visit) {
  return visitSynthPresetCatalog(
    [](void* context, const SynthPresetCatalogEntry& entry) {
      return (*static_cast<Visit*>(context))(entry);
    },
    &visit);
}

template <typename Visit>
bool visitSynthPresetCatalogFolderWith(const char* folderPath, Visit& visit) {
  return visitSynthPresetCatalogFolder(
    folderPath,
    [](void* context, const SynthPresetCatalogEntry& entry) {
      return (*static_cast<Visit*>(context))(entry);
    },
    &visit);
}

template <typename Visit>
void visitSynthPresetCatalogFolderPathsWith(Visit& visit) {
  visitSynthPresetCatalogFolderPaths(
    [](void* context, const char* folderPath) { (*static_cast<Visit*>(context))(folderPath); },
    &visit);
}
