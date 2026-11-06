#pragma once

#include "../FirmwareModule.h"
#include "PersistentDataModels.h"

// The synth preset catalog: preset files in /presets plus the HPI index
// (SynthPresetIndexCodec.h). Only the folder table lives in RAM; listings and
// lookups stream from the index. Handles are index positions: appends keep
// existing handles, deletes shift later handles down.
//
// Without a valid index (missing, stale or invalid), the catalog runs in
// directory-scan mode, where handles are positions among the canonical preset
// file names and every lookup opens preset files. Boot never writes the index;
// it is rebuilt on first use after boot and on every catalog write.

constexpr char SYNTH_PRESET_STORAGE_ROOT[] = "/presets";
constexpr char SYNTH_PRESET_FILE_EXTENSION[] = ".hsp";
constexpr size_t SYNTH_PRESET_STORAGE_PATH_LENGTH = 64;
constexpr char SYNTH_PRESET_INDEX_FILE_PATH[] = "/synth_preset_index.dat";
constexpr char SYNTH_PRESET_INDEX_TEMP_FILE_PATH[] = "/synth_preset_index.tmp";
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
// Handles are below this limit. In scan mode some handles may be invalid files.
uint16_t synthPresetCatalogHandleLimit();
uint16_t synthPresetCatalogCount();
// Changes whenever any handle, name or folder may have changed.
uint32_t synthPresetCatalogGeneration();

bool readSynthPresetCatalogEntry(uint16_t handle, SynthPresetCatalogEntry& entry);
bool findSynthPresetCatalogHandle(const uint8_t* objectId, uint16_t& handle);
bool visitSynthPresetCatalog(SynthPresetCatalogVisitor visitor, void* context);

// Rebuilds a missing or stale index. Automatic attempts (userInitiated false)
// stop after one failure until the next boot; writes always retry.
bool ensureSynthPresetCatalogIndexed(bool userInitiated);

// Writes the preset file and updates the index. With
// SYNTH_PRESET_CATALOG_NEW_HANDLE, an existing preset with the same object id
// is replaced; otherwise the preset is appended.
SynthPresetStoreResult storeSynthPresetInCatalog(uint16_t handle,
                                                 const SynthPresetSlot& preset,
                                                 uint16_t& storedHandle);
bool removeSynthPresetFromCatalog(uint16_t handle);

bool synthPresetStoragePath(const uint8_t* objectId, char* output, size_t outputLength);
bool readSynthPresetPayload(File& file, SynthPresetSlot& preset);
bool readSynthPresetFileByObjectId(const uint8_t* objectId, SynthPresetSlot& preset);
const char* synthPresetStoreResultMessage(SynthPresetStoreResult result);

// Visits with a capturing lambda: visit(entry) returns false to stop.
template <typename Visit>
bool visitSynthPresetCatalogWith(Visit& visit) {
  return visitSynthPresetCatalog(
    [](void* context, const SynthPresetCatalogEntry& entry) {
      return (*static_cast<Visit*>(context))(entry);
    },
    &visit);
}
