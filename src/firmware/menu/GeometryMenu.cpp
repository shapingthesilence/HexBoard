#include "../FirmwareModule.h"
#include "CommandWheelOverlay.h"
#include "GeometryMenu.h"
#include "MenuFolderUtils.h"
#include "MenuAndDisplay.h"
#include "SynthPresetMenu.h"
#include "VirtualListMenu.h"
#include "../app/DiagnosticsTiming.h"
#include "../app/RuntimeDefaults.h"
#include "../model/ScalePalettePreset.h"
#include "../hardware/GridState.h"
#include "../midi/MidiRouting.h"
#include "../model/PitchAssignment.h"
#include "../storage/BuiltinGeometry.h"
#include "../storage/PresetSync.h"
#include "../storage/Settings.h"

namespace {
enum class UserGeometryMenuKind : uint8_t {
  Tuning,
  Layout,
  Scale
};

constexpr uint16_t USER_GEOMETRY_MENU_INVALID_HANDLE = 0xFFFFu;
constexpr uint16_t USER_GEOMETRY_MENU_MAX_ENTRIES =
  (GEOMETRY_BUNDLE_MAX_COUNT * 2u) + GEOMETRY_LAYOUT_SCALE_MAX_COUNT + 8u;

enum class UserGeometryMenuRowKind : uint8_t {
  Folder,
  Item
};

struct UserGeometryMenuRow {
  UserGeometryMenuRowKind kind = UserGeometryMenuRowKind::Item;
  uint16_t handle = USER_GEOMETRY_MENU_INVALID_HANDLE;
};

struct SelectedGeometryMenuEntry {
  uint8_t objectType = 0;
  uint8_t objectId[GEOMETRY_OBJECT_ID_LENGTH] = {};
  uint16_t handle = USER_GEOMETRY_MENU_INVALID_HANDLE;
  char name[GEOMETRY_OBJECT_NAME_LENGTH] = {};
};

constexpr uint8_t SELECTED_GEOMETRY_MENU_CACHE_CAPACITY = GEOMETRY_LAYOUT_SCALE_MAX_COUNT * 2u;

UserGeometryMenuRow userGeometryVirtualRows[USER_GEOMETRY_MENU_MAX_ENTRIES] = {};
uint16_t userGeometryVirtualCount = 0;
UserGeometryMenuKind userGeometryVirtualKind = UserGeometryMenuKind::Tuning;
bool userGeometryMenuRebuildPending = false;
bool userGeometryMenuOverflowLogged = false;
char userGeometryMenuCurrentFolder[GEOMETRY_OBJECT_FOLDER_LENGTH] = "/";
SelectedGeometryMenuEntry selectedGeometryMenuCache[SELECTED_GEOMETRY_MENU_CACHE_CAPACITY] = {};
uint8_t selectedGeometryMenuCacheCount = 0;
uint8_t selectedGeometryMenuCacheTuningId[GEOMETRY_OBJECT_ID_LENGTH] = {};
bool selectedGeometryMenuCacheValid = false;
// Bumped on every rebuild, so a highlighted row is told apart across folders.
uint16_t userGeometryMenuGeneration = 0;

const char* userGeometryMenuTitle(UserGeometryMenuKind kind) {
  switch (kind) {
    case UserGeometryMenuKind::Tuning:
      return "Tuning";
    case UserGeometryMenuKind::Layout:
      return "Layout";
    case UserGeometryMenuKind::Scale:
      return "Scales";
  }
  return "Geometry";
}

const char* emptyUserGeometryLabel(UserGeometryMenuKind kind) {
  switch (kind) {
    case UserGeometryMenuKind::Tuning:
      return "No Tunings";
    case UserGeometryMenuKind::Layout:
      return userGeometryRuntime.tuningObjectSelected ? "No Layouts" : "Select Tuning";
    case UserGeometryMenuKind::Scale:
      return userGeometryRuntime.tuningObjectSelected ? "No Scales" : "Select Tuning";
  }
  return "No Geometry";
}

bool appendUserGeometryHandle(uint16_t handle) {
  if (userGeometryVirtualCount >= USER_GEOMETRY_MENU_MAX_ENTRIES) {
    if (!userGeometryMenuOverflowLogged) {
      sendToLog("User geometry menu truncated: too many entries.");
      userGeometryMenuOverflowLogged = true;
    }
    return false;
  }
  userGeometryVirtualRows[userGeometryVirtualCount++] = { UserGeometryMenuRowKind::Item, handle };
  return true;
}

bool appendUserGeometryFolder(uint16_t handle) {
  if (userGeometryVirtualCount >= USER_GEOMETRY_MENU_MAX_ENTRIES) {
    if (!userGeometryMenuOverflowLogged) {
      sendToLog("User geometry menu truncated: too many entries.");
      userGeometryMenuOverflowLogged = true;
    }
    return false;
  }
  userGeometryVirtualRows[userGeometryVirtualCount++] = { UserGeometryMenuRowKind::Folder, handle };
  return true;
}

int findFirstUserGeometryObjectReferencing(uint8_t objectType,
                                           uint8_t referenceTag,
                                           uint8_t referenceObjectType,
                                           const uint8_t* referenceObjectId) {
  const GeometryBundleIndexEntry* bundle = nullptr;
  if (!userGeometryRuntime.tuningObjectSelected
      || !geometryBundleForTuningObjectId(userGeometryRuntime.tuningObjectId, bundle)) {
    return -1;
  }
  GeometryCatalogReader reader;
  if (!beginGeometryBundleRead(*bundle, reader)) {
    return -1;
  }
  uint16_t handle = 0;
  GeometryObjectIndexEntry object;
  while (readNextGeometryObjectMetadata(reader, handle, object)) {
    GeometryObjectSlot fullObject;
    if (object.objectType == objectType
        && geometryObjectForMetadata(object, fullObject)
        && geometryObjectReferencesObjectId(fullObject, referenceTag, referenceObjectType, referenceObjectId)) {
      endGeometryCatalogRead(reader);
      return static_cast<int>(handle);
    }
  }
  endGeometryCatalogRead(reader);
  return -1;
}

bool applyLinkedButtonMapForCurrentUserLayout() {
  if (!userGeometryRuntime.tuningObjectSelected) {
    return true;
  }

  int buttonMapIndex = -1;
  if (userGeometryRuntime.layoutObjectSelected) {
    buttonMapIndex = findFirstUserGeometryObjectReferencing(
      PRESET_SYNC_OBJECT_TYPE_EXPLICIT_BUTTON_MAP,
      PRESET_SYNC_TLV_BUTTON_MAP_LAYOUT_REF,
      PRESET_SYNC_OBJECT_TYPE_USER_LAYOUT,
      userGeometryRuntime.layoutObjectId
    );
  }
  if (buttonMapIndex < 0 && !userGeometryRuntime.layoutObjectSelected) {
    buttonMapIndex = findFirstUserGeometryObjectReferencing(
      PRESET_SYNC_OBJECT_TYPE_EXPLICIT_BUTTON_MAP,
      PRESET_SYNC_TLV_BUTTON_MAP_TUNING_REF,
      PRESET_SYNC_OBJECT_TYPE_USER_TUNING,
      userGeometryRuntime.tuningObjectId
    );
  }
  if (buttonMapIndex < 0) {
    return true;
  }
  GeometryObjectSlot buttonMapObject;
  return geometryObjectForHandle(static_cast<uint16_t>(buttonMapIndex), buttonMapObject)
         && applyGeometryObjectToRuntime(buttonMapObject);
}

bool loadUserGeometryLayoutFromSlot(uint16_t objectIndex) {
  GeometryObjectSlot object;
  if (!geometryObjectForHandle(objectIndex, object)
      || object.objectType != PRESET_SYNC_OBJECT_TYPE_USER_LAYOUT) {
    sendToLog("User geometry layout menu load rejected: object is missing.");
    return false;
  }
  return applyGeometryObjectToRuntime(object)
         && applyLinkedButtonMapForCurrentUserLayout();
}

bool loadUserGeometryScaleFromSlot(uint16_t objectIndex) {
  GeometryObjectSlot object;
  if (!geometryObjectForHandle(objectIndex, object)
      || object.objectType != PRESET_SYNC_OBJECT_TYPE_USER_SCALE) {
    sendToLog("User geometry scale menu load rejected: object is missing.");
    return false;
  }
  return applyGeometryObjectToRuntime(object);
}

bool prepareBuiltinGeometrySelection(uint16_t handle) {
  uint8_t objectType = 0;
  uint8_t tuningIndex = 0;
  uint16_t optionIndex = 0;
  if (!builtinGeometrySelectionForHandle(handle, objectType, tuningIndex, optionIndex)) {
    return false;
  }
  switch (objectType) {
    case PRESET_SYNC_OBJECT_TYPE_USER_TUNING:
      current.tuningIndex = tuningIndex;
      current.layoutIndex = current.layoutsBegin();
      current.scaleIndex = 0;
      break;
    case PRESET_SYNC_OBJECT_TYPE_USER_LAYOUT:
      current.layoutIndex = optionIndex;
      break;
    case PRESET_SYNC_OBJECT_TYPE_USER_SCALE:
      current.scaleIndex = optionIndex;
      break;
    default:
      break;
  }
  return true;
}

void persistBuiltinGeometrySelection(uint16_t handle) {
  uint8_t objectType = 0;
  uint8_t tuningIndex = 0;
  uint16_t optionIndex = 0;
  if (!builtinGeometrySelectionForHandle(handle, objectType, tuningIndex, optionIndex)) {
    return;
  }

  switch (objectType) {
    case PRESET_SYNC_OBJECT_TYPE_USER_TUNING:
      settings[static_cast<uint8_t>(SettingKey::CurrentTuning)] = current.tuningIndex;
      settings[static_cast<uint8_t>(SettingKey::CurrentLayout)] = current.layoutIndex;
      settings[static_cast<uint8_t>(SettingKey::CurrentScale)] = current.scaleIndex;
      storeCurrentKeyStepsInSettings(current.keyStepsFromA);
      break;
    case PRESET_SYNC_OBJECT_TYPE_USER_LAYOUT:
      settings[static_cast<uint8_t>(SettingKey::CurrentLayout)] = current.layoutIndex;
      break;
    case PRESET_SYNC_OBJECT_TYPE_USER_SCALE:
      settings[static_cast<uint8_t>(SettingKey::CurrentScale)] = current.scaleIndex;
      break;
    default:
      return;
  }
  markSettingsDirty();
}

void invalidateSelectedGeometryMenuCache() {
  selectedGeometryMenuCacheCount = 0;
  selectedGeometryMenuCacheValid = false;
  memset(selectedGeometryMenuCacheTuningId, 0, sizeof(selectedGeometryMenuCacheTuningId));
}

const SelectedGeometryMenuEntry* selectedGeometryMenuEntryForHandle(uint16_t handle) {
  for (uint8_t index = 0; index < selectedGeometryMenuCacheCount; ++index) {
    if (selectedGeometryMenuCache[index].handle == handle) {
      return &selectedGeometryMenuCache[index];
    }
  }
  return nullptr;
}

bool ensureSelectedGeometryMenuCache() {
  if (!userGeometryRuntime.tuningObjectSelected) {
    invalidateSelectedGeometryMenuCache();
    return false;
  }
  if (selectedGeometryMenuCacheValid
      && memcmp(selectedGeometryMenuCacheTuningId,
                userGeometryRuntime.tuningObjectId,
                GEOMETRY_OBJECT_ID_LENGTH) == 0) {
    return true;
  }

  invalidateSelectedGeometryMenuCache();
  const GeometryBundleIndexEntry* bundle = nullptr;
  if (!geometryBundleForTuningObjectId(userGeometryRuntime.tuningObjectId, bundle)) {
    return false;
  }
  GeometryCatalogReader reader;
  if (!beginGeometryBundleRead(*bundle, reader)) {
    return false;
  }
  uint8_t layoutCount = 0;
  uint8_t scaleCount = 0;
  uint16_t handle = 0;
  GeometryObjectIndexEntry object;
  while (readNextGeometryObjectMetadata(reader, handle, object)) {
    uint8_t* typeCount = nullptr;
    if (object.objectType == PRESET_SYNC_OBJECT_TYPE_USER_LAYOUT) {
      typeCount = &layoutCount;
    } else if (object.objectType == PRESET_SYNC_OBJECT_TYPE_USER_SCALE) {
      typeCount = &scaleCount;
    }
    if (!typeCount || *typeCount >= GEOMETRY_LAYOUT_SCALE_MAX_COUNT
        || selectedGeometryMenuCacheCount >= SELECTED_GEOMETRY_MENU_CACHE_CAPACITY) {
      continue;
    }
    SelectedGeometryMenuEntry& cached = selectedGeometryMenuCache[selectedGeometryMenuCacheCount++];
    cached.objectType = object.objectType;
    cached.handle = handle;
    memcpy(cached.objectId, object.objectId, sizeof(cached.objectId));
    snprintf(cached.name, sizeof(cached.name), "%s", object.name);
    ++(*typeCount);
  }
  endGeometryCatalogRead(reader);
  memcpy(selectedGeometryMenuCacheTuningId,
         userGeometryRuntime.tuningObjectId,
         sizeof(selectedGeometryMenuCacheTuningId));
  selectedGeometryMenuCacheValid = true;
  return true;
}

bool builtinTuningMatchesCurrentRuntime(uint8_t tuningIndex) {
  if (!userGeometryRuntime.tuningObjectSelected) {
    return false;
  }
  uint16_t tuningHandle = 0;
  BuiltinGeometryMetadata tuningMetadata;
  return builtinGeometryHandleForTuning(tuningIndex, tuningHandle)
         && builtinGeometryMetadataByHandle(tuningHandle, tuningMetadata)
         && memcmp(tuningMetadata.objectId,
                   userGeometryRuntime.tuningObjectId,
                   GEOMETRY_OBJECT_ID_LENGTH) == 0;
}

bool includeBuiltinGeometryMetadataInMenu(UserGeometryMenuKind kind, const BuiltinGeometryMetadata& metadata) {
  switch (kind) {
    case UserGeometryMenuKind::Tuning:
      return metadata.objectType == PRESET_SYNC_OBJECT_TYPE_USER_TUNING;
    case UserGeometryMenuKind::Layout:
      return metadata.objectType == PRESET_SYNC_OBJECT_TYPE_USER_LAYOUT
             && builtinTuningMatchesCurrentRuntime(metadata.sourceTuningIndex);
    case UserGeometryMenuKind::Scale:
      return metadata.objectType == PRESET_SYNC_OBJECT_TYPE_USER_SCALE
             && builtinTuningMatchesCurrentRuntime(metadata.sourceTuningIndex);
  }
  return false;
}

bool geometryHandleMatchesObjectId(uint16_t handle, const uint8_t* objectId) {
  if (isBuiltinGeometryHandle(handle)) {
    BuiltinGeometryMetadata metadata;
    return builtinGeometryMetadataByHandle(handle, metadata)
           && memcmp(metadata.objectId, objectId, GEOMETRY_OBJECT_ID_LENGTH) == 0;
  }
  const GeometryBundleIndexEntry* bundle = nullptr;
  if (geometryBundleForTuningHandle(handle, bundle)) {
    return memcmp(bundle->tuningObjectId, objectId, GEOMETRY_OBJECT_ID_LENGTH) == 0;
  }
  const SelectedGeometryMenuEntry* cached = selectedGeometryMenuEntryForHandle(handle);
  return cached
         && memcmp(cached->objectId, objectId, GEOMETRY_OBJECT_ID_LENGTH) == 0;
}

bool userGeometryHandleIsCurrent(UserGeometryMenuKind kind, uint16_t handle) {
  if (handle == USER_GEOMETRY_MENU_INVALID_HANDLE) {
    return false;
  }
  // During an audition the diamond stays on the chosen item.
  if (const GeometryProfileReference* chosen = geometryAuditionCommittedReference()) {
    switch (kind) {
      case UserGeometryMenuKind::Tuning:
        return (chosen->flags & GEOMETRY_PROFILE_HAS_TUNING) && geometryHandleMatchesObjectId(handle, chosen->tuningObjectId);
      case UserGeometryMenuKind::Layout:
        return (chosen->flags & GEOMETRY_PROFILE_HAS_LAYOUT) && geometryHandleMatchesObjectId(handle, chosen->layoutObjectId);
      case UserGeometryMenuKind::Scale:
        return (chosen->flags & GEOMETRY_PROFILE_HAS_SCALE) && geometryHandleMatchesObjectId(handle, chosen->scaleObjectId);
    }
    return false;
  }
  switch (kind) {
    case UserGeometryMenuKind::Tuning:
      return userGeometryRuntime.tuningObjectSelected
             && geometryHandleMatchesObjectId(handle, userGeometryRuntime.tuningObjectId);
    case UserGeometryMenuKind::Layout:
      return userGeometryRuntime.layoutObjectSelected
             && geometryHandleMatchesObjectId(handle, userGeometryRuntime.layoutObjectId);
    case UserGeometryMenuKind::Scale:
      return userGeometryRuntime.scaleObjectSelected
             && geometryHandleMatchesObjectId(handle, userGeometryRuntime.scaleObjectId);
  }
  return false;
}

bool findCurrentUserGeometryRow(uint16_t& index) {
  for (uint16_t i = 0; i < userGeometryVirtualCount; ++i) {
    const UserGeometryMenuRow& row = userGeometryVirtualRows[i];
    if (row.kind == UserGeometryMenuRowKind::Item
        && userGeometryHandleIsCurrent(userGeometryVirtualKind, row.handle)) {
      index = i;
      return true;
    }
  }
  return false;
}

bool userGeometryFolderRowPath(const UserGeometryMenuRow& row, char* output, size_t outputLength) {
  const GeometryBundleIndexEntry* bundle = nullptr;
  return geometryBundleForTuningHandle(row.handle, bundle)
         && menuFolderImmediateChildPath(bundle->folderPath,
                                         userGeometryMenuCurrentFolder,
                                         output,
                                         outputLength);
}

bool userGeometryFolderAlreadyListed(const char* childFolderPath) {
  char existing[GEOMETRY_OBJECT_FOLDER_LENGTH] = {};
  for (uint16_t i = 0; i < userGeometryVirtualCount; ++i) {
    if (userGeometryVirtualRows[i].kind == UserGeometryMenuRowKind::Folder
        && userGeometryFolderRowPath(userGeometryVirtualRows[i], existing, sizeof(existing))
        && menuFolderEquals(existing, childFolderPath)) {
      return true;
    }
  }
  return false;
}

bool showScaleEntry(const SelectedGeometryMenuEntry& entry){
 if(strcmp(entry.name,"None"))return true;
 for(uint8_t i=0;i<selectedGeometryMenuCacheCount;++i)if(selectedGeometryMenuCache[i].objectType==PRESET_SYNC_OBJECT_TYPE_USER_SCALE&&!strcmp(selectedGeometryMenuCache[i].name,"All Notes"))return false;
 return true; // A legacy bundle with only None is shown as All Notes.
}

void rebuildUserGeometryVirtualList(UserGeometryMenuKind kind) {
  ++userGeometryMenuGeneration;
  userGeometryVirtualKind = kind;
  userGeometryVirtualCount = 0;
  userGeometryMenuOverflowLogged = false;

  if (geometryFallbackRequired()
      && (kind != UserGeometryMenuKind::Tuning || menuFolderIsRoot(userGeometryMenuCurrentFolder))) {
    for (size_t i = 0; i < builtinGeometryObjectCount(); ++i) {
      BuiltinGeometryMetadata metadata;
      if (builtinGeometryMetadataByOrdinal(i, metadata)
          && includeBuiltinGeometryMetadataInMenu(kind, metadata)
          && (kind!=UserGeometryMenuKind::Scale||strcmp(metadata.name,"None"))) {
        appendUserGeometryHandle(metadata.handle);
      }
    }
  }

  if (kind == UserGeometryMenuKind::Tuning) {
    char childFolder[GEOMETRY_OBJECT_FOLDER_LENGTH] = {};
    for (const GeometryBundleIndexEntry& bundle : geometryBundles) {
      if (menuFolderImmediateChildPath(bundle.folderPath,
                                       userGeometryMenuCurrentFolder,
                                       childFolder,
                                       sizeof(childFolder))
          && !userGeometryFolderAlreadyListed(childFolder)) {
        appendUserGeometryFolder(bundle.firstHandle);
      }
    }
    for (const GeometryBundleIndexEntry& bundle : geometryBundles) {
      if (menuFolderEntryBelongsToCurrentFolder(bundle.folderPath,
                                                userGeometryMenuCurrentFolder)) {
        appendUserGeometryHandle(bundle.firstHandle);
      }
    }
    return;
  }

  if (!ensureSelectedGeometryMenuCache()) {
    return;
  }
  uint8_t wantedType = kind == UserGeometryMenuKind::Layout
                         ? PRESET_SYNC_OBJECT_TYPE_USER_LAYOUT
                         : PRESET_SYNC_OBJECT_TYPE_USER_SCALE;
  for (uint8_t index = 0; index < selectedGeometryMenuCacheCount; ++index) {
    if (selectedGeometryMenuCache[index].objectType == wantedType
        && (kind!=UserGeometryMenuKind::Scale||showScaleEntry(selectedGeometryMenuCache[index]))) {
      appendUserGeometryHandle(selectedGeometryMenuCache[index].handle);
    }
  }
}

// Control rows sit above the items: Key and Scale Lock in Scales,
// Intonation at the root of Tuning, and Orientation in Layout.
uint16_t userGeometryControlRowCount() {
  switch (userGeometryVirtualKind) {
    case UserGeometryMenuKind::Scale:
      return 2;
    case UserGeometryMenuKind::Layout:
      return 1;
    case UserGeometryMenuKind::Tuning:
      return menuFolderIsRoot(userGeometryMenuCurrentFolder) ? 1 : 0;
  }
  return 0;
}

// Maps a list row to its item row; false for a control row.
bool userGeometryItemIndex(uint16_t row, uint16_t& index) {
  const uint16_t controls = userGeometryControlRowCount();
  if (row < controls) {
    return false;
  }
  index = static_cast<uint16_t>(row - controls);
  return index < userGeometryVirtualCount;
}

// Set when returning from Intonation or Orientation, so the list opens on
// the row that led there.
bool userGeometryOpenOnControlRow = false;

const char* intonationSummary() {
  if (useDynamicJustIntonation && useJustIntonationBPM) return "Dyn+BPM";
  if (useDynamicJustIntonation) return "Dyn JI";
  if (useJustIntonationBPM) return "BPM JI";
  return "Fixed";
}

const char* orientationSummary() {
  const bool rotated = layoutRotation % 6 != 0;
  const bool flipped = mirrorLeftRight || mirrorUpDown;
  if (rotated && flipped) return "Rot+Flp";
  if (rotated) return "Rotated";
  if (flipped) return "Flipped";
  return "Normal";
}

uint16_t userGeometryVirtualCountProvider(void*) {
  return static_cast<uint16_t>(userGeometryVirtualCount + userGeometryControlRowCount());
}

bool userGeometryVirtualLabelProvider(void*, uint16_t index, char* output, size_t outputLength) {
  if (outputLength == 0) {
    return false;
  }
  output[0] = '\0';
  const uint16_t controls = userGeometryControlRowCount();
  if (index < controls) {
    const char* label = "Orientation";
    if (userGeometryVirtualKind == UserGeometryMenuKind::Scale) {
      label = index == 0 ? "Key" : "Scale Lock";
    } else if (userGeometryVirtualKind == UserGeometryMenuKind::Tuning) {
      label = "Intonation";
    }
    snprintf(output, outputLength, "%s", label);
    return true;
  }
  index = static_cast<uint16_t>(index - controls);
  if (index >= userGeometryVirtualCount) {
    return false;
  }

  const UserGeometryMenuRow& row = userGeometryVirtualRows[index];
  if (row.kind == UserGeometryMenuRowKind::Folder) {
    char folderPath[GEOMETRY_OBJECT_FOLDER_LENGTH] = {};
    if (!userGeometryFolderRowPath(row, folderPath, sizeof(folderPath))) {
      return false;
    }
    synthPresetFolderLabel(folderPath, output, outputLength);
    return output[0] != '\0';
  }

  uint16_t handle = row.handle;
  if (isBuiltinGeometryHandle(handle)) {
    BuiltinGeometryMetadata metadata;
    if (!builtinGeometryMetadataByHandle(handle, metadata)) {
      return false;
    }
    snprintf(output, outputLength, "%s", metadata.name);
    return true;
  }

  const GeometryBundleIndexEntry* bundle = nullptr;
  if (geometryBundleForTuningHandle(handle, bundle)) {
    snprintf(output, outputLength, "%s", bundle->tuningName);
    return true;
  }
  const SelectedGeometryMenuEntry* cached = selectedGeometryMenuEntryForHandle(handle);
  if (!cached) return false;
  snprintf(output, outputLength, "%s", userGeometryVirtualKind==UserGeometryMenuKind::Scale&&!strcmp(cached->name,"None")?"All Notes":cached->name);
  return true;
}

VirtualListMenuRowType userGeometryVirtualRowType(void*, uint16_t index) {
  const uint16_t controls = userGeometryControlRowCount();
  if (index < controls) {
    if (userGeometryVirtualKind == UserGeometryMenuKind::Scale) {
      return index == 0 ? VirtualListMenuRowType::Value : VirtualListMenuRowType::Checkbox;
    }
    return VirtualListMenuRowType::Link;
  }
  index = static_cast<uint16_t>(index - controls);
  if (index >= userGeometryVirtualCount) {
    return VirtualListMenuRowType::Button;
  }
  return userGeometryVirtualRows[index].kind == UserGeometryMenuRowKind::Folder
           ? VirtualListMenuRowType::Link
           : VirtualListMenuRowType::Button;
}

bool userGeometryVirtualIsCurrent(void*, uint16_t row) {
  uint16_t index = 0;
  if (!userGeometryItemIndex(row, index)
      || userGeometryVirtualRows[index].kind != UserGeometryMenuRowKind::Item) {
    return false;
  }
  return userGeometryHandleIsCurrent(userGeometryVirtualKind, userGeometryVirtualRows[index].handle);
}

// Set while a tuning, layout or scale auditioned from the list is playing.
bool geometryAuditionStartedFromMenu = false;
UserGeometryMenuKind geometryAuditionedKind = UserGeometryMenuKind::Tuning;
uint16_t geometryAuditionedHandle = USER_GEOMETRY_MENU_INVALID_HANDLE;

bool userGeometryVirtualIsAuditioning(void*, uint16_t row) {
  if (!geometryAuditionStartedFromMenu || geometryAuditionedKind != userGeometryVirtualKind) return false;
  uint16_t index = 0;
  return userGeometryItemIndex(row, index)
         && userGeometryVirtualRows[index].kind == UserGeometryMenuRowKind::Item
         && userGeometryVirtualRows[index].handle == geometryAuditionedHandle;
}

bool userGeometryVirtualInitialSelection(void*, uint16_t* index) {
  if (!index) {
    return false;
  }
  if (userGeometryOpenOnControlRow || userGeometryVirtualKind == UserGeometryMenuKind::Scale) {
    userGeometryOpenOnControlRow = false;
    *index = 0;
    return true;
  }
  uint16_t row = 0;
  if (!findCurrentUserGeometryRow(row)) {
    return false;
  }
  *index = static_cast<uint16_t>(row + userGeometryControlRowCount());
  return true;
}

void loadUserGeometryHandle(UserGeometryMenuKind kind, uint16_t handle) {
  if (handle == USER_GEOMETRY_MENU_INVALID_HANDLE) {
    redrawVirtualListMenu();
    return;
  }
  commitGeometryAudition();

  bool builtinSelection = prepareBuiltinGeometrySelection(handle);
  bool loaded = false;
  switch (kind) {
    case UserGeometryMenuKind::Tuning:
      loaded = loadUserGeometryBundleFromTuningSlot(handle);
      requestUserGeometryMenuRebuild();
      if (loaded) {
        ensureSelectedGeometryMenuCache();
      }
      break;
    case UserGeometryMenuKind::Layout:
      loaded = loadUserGeometryLayoutFromSlot(handle);
      break;
    case UserGeometryMenuKind::Scale:
      loaded = loadUserGeometryScaleFromSlot(handle);
      break;
  }
  if (loaded) {
    if (builtinSelection) {
      persistBuiltinGeometrySelection(handle);
    }
    markSettingsDirty();
    refreshMenuChoicesForCurrentTuning();
    loadDeviceRotationFromCurrentLayout();
    applyDeviceDisplayRotation();
  }
  deactivateVirtualListMenu();
  menuHome();
}

void openGeometrySettingsMenu(UserGeometryMenuKind owner);

void userGeometryVirtualSelect(void*, uint16_t index) {
  const uint16_t controls = userGeometryControlRowCount();
  if (index < controls) {
    if (userGeometryVirtualKind == UserGeometryMenuKind::Scale) {
      if (index == 1) {
        scaleLock = !scaleLock;
        settings[static_cast<uint8_t>(SettingKey::ScaleLock)] = scaleLock;
        markSettingsDirty();
        redrawVirtualListMenu();
      }
      return;
    }
    openGeometrySettingsMenu(userGeometryVirtualKind);
    return;
  }
  index = static_cast<uint16_t>(index - controls);
  if (index >= userGeometryVirtualCount) {
    redrawVirtualListMenu();
    return;
  }
  const UserGeometryMenuRow& row = userGeometryVirtualRows[index];
  if (row.kind == UserGeometryMenuRowKind::Folder) {
    char childFolder[GEOMETRY_OBJECT_FOLDER_LENGTH] = {};
    if (userGeometryFolderRowPath(row, childFolder, sizeof(childFolder))) {
      snprintf(userGeometryMenuCurrentFolder, sizeof(userGeometryMenuCurrentFolder), "%s", childFolder);
      rebuildUserGeometryVirtualList(userGeometryVirtualKind);
      resetVirtualListMenuSelection();
    }
    return;
  }
  loadUserGeometryHandle(userGeometryVirtualKind, row.handle);
}

bool userGeometryVirtualBack(void*) {
  if (userGeometryVirtualKind != UserGeometryMenuKind::Tuning
      || menuFolderIsRoot(userGeometryMenuCurrentFolder)) {
    return false;
  }
  menuFolderParentPath(userGeometryMenuCurrentFolder,
                       userGeometryMenuCurrentFolder,
                       sizeof(userGeometryMenuCurrentFolder));
  rebuildUserGeometryVirtualList(userGeometryVirtualKind);
  resetVirtualListMenuSelection();
  return true;
}

void userGeometryVirtualClose(void*) {
  menuHome();
}

bool userGeometryControlIsChecked(void*, uint16_t index) {
  return userGeometryVirtualKind == UserGeometryMenuKind::Scale && index == 1 && scaleLock;
}

bool userGeometryControlValue(void*, uint16_t index, char* output, size_t outputLength) {
  if (index >= userGeometryControlRowCount()) return false;
  switch (userGeometryVirtualKind) {
    case UserGeometryMenuKind::Scale:
      if (index != 0) return false;
      formatTuningDegreeLabel(current.tuning(),
                             static_cast<uint16_t>(userGeometryRuntime.active
                               ? current.keyStepsFromA
                               : current.keyStepsFromA - current.tuning().spanCtoA()),
                             output, outputLength);
      return true;
    case UserGeometryMenuKind::Tuning:
      snprintf(output, outputLength, "%s", intonationSummary());
      return true;
    case UserGeometryMenuKind::Layout:
      snprintf(output, outputLength, "%s", orientationSummary());
      return true;
  }
  return false;
}

void adjustScaleControl(void*, uint16_t index, int delta) {
  if (userGeometryVirtualKind != UserGeometryMenuKind::Scale || index != 0) return;
  if (!current.tuning().cycleLength) return;
  current.keyStepsFromA += delta;
  showOnlyValidKeyChoices();
  storeCurrentKeyStepsInSettings(current.keyStepsFromA);
  applyScale();
  markSettingsDirty();
}

void openUserGeometryMenu(UserGeometryMenuKind kind) {
  snprintf(userGeometryMenuCurrentFolder,
           sizeof(userGeometryMenuCurrentFolder),
           "%s",
           SYNTH_PRESET_ROOT_FOLDER);
  rebuildUserGeometryVirtualList(kind);
  VirtualListMenuProvider provider;
  provider.title = userGeometryMenuTitle(kind);
  provider.getCount = userGeometryVirtualCountProvider;
  provider.getLabel = userGeometryVirtualLabelProvider;
  provider.getRowType = userGeometryVirtualRowType;
  provider.isCurrent = userGeometryVirtualIsCurrent;
  provider.isAuditioning = userGeometryVirtualIsAuditioning;
  provider.auditionIcon = virtualListTryingDiamondBits;
  provider.getInitialSelection = userGeometryVirtualInitialSelection;
  provider.select = userGeometryVirtualSelect;
  provider.back = userGeometryVirtualBack;
  provider.close = userGeometryVirtualClose;
  provider.emptyLabel = emptyUserGeometryLabel(kind);
  provider.isChecked = userGeometryControlIsChecked;
  provider.getValue = userGeometryControlValue;
  if (kind == UserGeometryMenuKind::Scale) {
    provider.adjust = adjustScaleControl;
  }
  openVirtualListMenu(provider);
}

// Intonation (from Tuning) and Orientation (from Layout) hold profile
// settings. They apply to every tuning and layout and are never part of one,
// except Device Rot, which choosing a layout sets to that layout's default.
enum class GeometrySettingRow : uint8_t {
  DynamicJI,
  JITable,
  BPMSync,
  BPMMultiplier,
  Tempo,
  Rotation,
  DeviceRotation,
  FlipLeftRight,
  FlipUpDown
};

constexpr uint8_t GEOMETRY_SETTING_ROW_CAPACITY = 5;
GeometrySettingRow geometrySettingRows[GEOMETRY_SETTING_ROW_CAPACITY] = {};
uint8_t geometrySettingRowCount = 0;
UserGeometryMenuKind geometrySettingsOwner = UserGeometryMenuKind::Tuning;

constexpr byte DYNAMIC_JI_RATIO_TABLES[] = {
  DYNAMIC_JI_RATIO_TABLE_3_LIMIT, DYNAMIC_JI_RATIO_TABLE_5_LIMIT, DYNAMIC_JI_RATIO_TABLE_7_LIMIT,
  DYNAMIC_JI_RATIO_TABLE_11_LIMIT, DYNAMIC_JI_RATIO_TABLE_13_LIMIT, DYNAMIC_JI_RATIO_TABLE_17_LIMIT,
  DYNAMIC_JI_RATIO_TABLE_19_LIMIT, DYNAMIC_JI_RATIO_TABLE_23_LIMIT, DYNAMIC_JI_RATIO_TABLE_29_LIMIT,
  DYNAMIC_JI_RATIO_TABLE_31_LIMIT, DYNAMIC_JI_RATIO_TABLE_37_LIMIT, DYNAMIC_JI_RATIO_TABLE_41_LIMIT
};
constexpr uint8_t DYNAMIC_JI_RATIO_TABLE_COUNT = sizeof(DYNAMIC_JI_RATIO_TABLES);

// Dependent rows appear only while their switch is on.
void rebuildGeometrySettingRows() {
  geometrySettingRowCount = 0;
  auto add = [](GeometrySettingRow row) { geometrySettingRows[geometrySettingRowCount++] = row; };
  if (geometrySettingsOwner == UserGeometryMenuKind::Tuning) {
    add(GeometrySettingRow::DynamicJI);
    if (useDynamicJustIntonation) add(GeometrySettingRow::JITable);
    add(GeometrySettingRow::BPMSync);
    if (useJustIntonationBPM) {
      add(GeometrySettingRow::BPMMultiplier);
      add(GeometrySettingRow::Tempo);
    }
  } else {
    add(GeometrySettingRow::Rotation);
    add(GeometrySettingRow::DeviceRotation);
    add(GeometrySettingRow::FlipLeftRight);
    add(GeometrySettingRow::FlipUpDown);
  }
}

bool geometrySettingRowAt(uint16_t index, GeometrySettingRow& row) {
  if (index >= geometrySettingRowCount) return false;
  row = geometrySettingRows[index];
  return true;
}

void storeGeometryProfileSetting(SettingKey key, uint8_t value) {
  settings[static_cast<uint8_t>(key)] = value;
  markSettingsDirty();
}

uint16_t geometrySettingsCount(void*) {
  return geometrySettingRowCount;
}

bool geometrySettingsLabel(void*, uint16_t index, char* output, size_t outputLength) {
  GeometrySettingRow row;
  if (outputLength == 0 || !geometrySettingRowAt(index, row)) return false;
  const char* label = "";
  switch (row) {
    case GeometrySettingRow::DynamicJI: label = "Dynamic JI"; break;
    case GeometrySettingRow::JITable: label = "JI Table"; break;
    case GeometrySettingRow::BPMSync: label = "BPM Sync"; break;
    case GeometrySettingRow::BPMMultiplier: label = "BPM Mult"; break;
    case GeometrySettingRow::Tempo: label = "Sound Tempo"; break;
    case GeometrySettingRow::Rotation: label = "Layout Rot"; break;
    case GeometrySettingRow::DeviceRotation: label = "Device Rot"; break;
    case GeometrySettingRow::FlipLeftRight: label = "Flip L/R"; break;
    case GeometrySettingRow::FlipUpDown: label = "Flip U/D"; break;
  }
  snprintf(output, outputLength, "%s", label);
  return true;
}

VirtualListMenuRowType geometrySettingsRowType(void*, uint16_t index) {
  GeometrySettingRow row;
  if (!geometrySettingRowAt(index, row)) return VirtualListMenuRowType::Label;
  switch (row) {
    case GeometrySettingRow::JITable:
    case GeometrySettingRow::BPMMultiplier:
    case GeometrySettingRow::Rotation:
    case GeometrySettingRow::DeviceRotation:
      return VirtualListMenuRowType::Value;
    case GeometrySettingRow::Tempo:
      return VirtualListMenuRowType::Label;
    default:
      return VirtualListMenuRowType::Checkbox;
  }
}

bool geometrySettingsChecked(void*, uint16_t index) {
  GeometrySettingRow row;
  if (!geometrySettingRowAt(index, row)) return false;
  switch (row) {
    case GeometrySettingRow::DynamicJI: return useDynamicJustIntonation;
    case GeometrySettingRow::BPMSync: return useJustIntonationBPM;
    case GeometrySettingRow::FlipLeftRight: return mirrorLeftRight;
    case GeometrySettingRow::FlipUpDown: return mirrorUpDown;
    default: return false;
  }
}

bool geometrySettingsValue(void*, uint16_t index, char* output, size_t outputLength) {
  GeometrySettingRow row;
  if (!geometrySettingRowAt(index, row)) return false;
  switch (row) {
    case GeometrySettingRow::JITable:
      snprintf(output, outputLength, "%uLimit", static_cast<unsigned>(dynamicJIRatioTable));
      return true;
    case GeometrySettingRow::BPMMultiplier:
      snprintf(output, outputLength, "%u", static_cast<unsigned>(justIntonationBPM_Multiplier));
      return true;
    case GeometrySettingRow::Tempo:
      snprintf(output, outputLength, "%u", static_cast<unsigned>(synthBPM));
      return true;
    case GeometrySettingRow::Rotation:
      snprintf(output, outputLength, "%u Deg", static_cast<unsigned>((layoutRotation % 6) * 60));
      return true;
    case GeometrySettingRow::DeviceRotation:
      snprintf(output, outputLength, "%u Deg", static_cast<unsigned>((deviceRotation % 4) * 90));
      return true;
    default:
      return false;
  }
}

void geometrySettingsSelect(void*, uint16_t index) {
  GeometrySettingRow row;
  if (geometrySettingRowAt(index, row)) {
    switch (row) {
      case GeometrySettingRow::DynamicJI:
        useDynamicJustIntonation = !useDynamicJustIntonation;
        storeGeometryProfileSetting(SettingKey::DynamicJI, useDynamicJustIntonation);
        refreshMidiRouting();
        break;
      case GeometrySettingRow::BPMSync:
        useJustIntonationBPM = !useJustIntonationBPM;
        storeGeometryProfileSetting(SettingKey::JustIntonationBPMSync, useJustIntonationBPM);
        refreshMidiRouting();
        break;
      case GeometrySettingRow::FlipLeftRight:
        mirrorLeftRight = !mirrorLeftRight;
        storeGeometryProfileSetting(SettingKey::MirrorLeftRight, mirrorLeftRight);
        updateLayoutAndRotate();
        break;
      case GeometrySettingRow::FlipUpDown:
        mirrorUpDown = !mirrorUpDown;
        storeGeometryProfileSetting(SettingKey::MirrorUpDown, mirrorUpDown);
        updateLayoutAndRotate();
        break;
      default:
        break;
    }
  }
  rebuildGeometrySettingRows();
  redrawVirtualListMenu();
}

void geometrySettingsAdjust(void*, uint16_t index, int delta) {
  GeometrySettingRow row;
  if (!geometrySettingRowAt(index, row) || delta == 0) return;
  const int step = delta > 0 ? 1 : -1;
  switch (row) {
    case GeometrySettingRow::JITable: {
      uint8_t position = DYNAMIC_JI_RATIO_TABLE_COUNT - 1;
      for (uint8_t i = 0; i < DYNAMIC_JI_RATIO_TABLE_COUNT; ++i) {
        if (DYNAMIC_JI_RATIO_TABLES[i] == dynamicJIRatioTable) position = i;
      }
      position = static_cast<uint8_t>((position + DYNAMIC_JI_RATIO_TABLE_COUNT + step) % DYNAMIC_JI_RATIO_TABLE_COUNT);
      dynamicJIRatioTable = DYNAMIC_JI_RATIO_TABLES[position];
      storeGeometryProfileSetting(SettingKey::DynamicJIRatioTable, dynamicJIRatioTable);
      refreshMidiRouting();
      break;
    }
    case GeometrySettingRow::BPMMultiplier: {
      // 1 to 255, wrapping like the other spinners.
      const int next = justIntonationBPM_Multiplier + step;
      justIntonationBPM_Multiplier = static_cast<byte>(next < 1 ? 255 : (next > 255 ? 1 : next));
      storeGeometryProfileSetting(SettingKey::BPMMultiplier, justIntonationBPM_Multiplier);
      break;
    }
    case GeometrySettingRow::Rotation:
      layoutRotation = static_cast<byte>((layoutRotation % 6 + 6 + step) % 6);
      storeGeometryProfileSetting(SettingKey::LayoutRotation, layoutRotation);
      updateLayoutAndRotate();
      break;
    case GeometrySettingRow::DeviceRotation:
      // Turns the screen and grid together; the keys keep their pitches.
      deviceRotation = static_cast<byte>((deviceRotation % 4 + 4 + step) % 4);
      storeGeometryProfileSetting(SettingKey::DeviceRotation, deviceRotation);
      applyDeviceDisplayRotation();
      break;
    default:
      break;
  }
}

bool geometrySettingsBack(void*) {
  userGeometryOpenOnControlRow = true;
  openUserGeometryMenu(geometrySettingsOwner);
  return true;
}

void geometrySettingsClose(void*) {
  menuHome();
}

void openGeometrySettingsMenu(UserGeometryMenuKind owner) {
  geometrySettingsOwner = owner;
  rebuildGeometrySettingRows();
  VirtualListMenuProvider provider;
  provider.title = owner == UserGeometryMenuKind::Tuning ? "Intonation" : "Orientation";
  provider.getCount = geometrySettingsCount;
  provider.getLabel = geometrySettingsLabel;
  provider.getRowType = geometrySettingsRowType;
  provider.isChecked = geometrySettingsChecked;
  provider.getValue = geometrySettingsValue;
  provider.select = geometrySettingsSelect;
  provider.adjust = geometrySettingsAdjust;
  provider.back = geometrySettingsBack;
  provider.close = geometrySettingsClose;
  openVirtualListMenu(provider);
}

// Resting on a tuning, layout or scale for 200 ms auditions it: it plays,
// but is not chosen or saved. Leaving the list without choosing returns to
// the chosen item; choosing loads it as usual.
constexpr uint32_t USER_GEOMETRY_AUDITION_DELAY_MS = 200;
constexpr uint32_t USER_GEOMETRY_AUDITION_NO_ROW = 0xFFFFFFFFu;
uint32_t geometryAuditionWatchedRow = USER_GEOMETRY_AUDITION_NO_ROW;
uint32_t geometryAuditionRowSinceMs = 0;
bool geometryAuditionRowMoved = false;
bool geometryAuditionRowDone = false;

void finishUserGeometryAudition() {
  if (!geometryAuditionStartedFromMenu) return;
  geometryAuditionStartedFromMenu = false;
  if (restoreGeometryAuditionCommitted()) {
    refreshMenuChoicesForCurrentTuning();
    updateLayoutAndRotate();
    requestUserGeometryMenuRebuild();
    refreshVirtualListLauncherLabels();
  }
}

void auditionUserGeometryHandle(UserGeometryMenuKind kind, uint16_t handle) {
  beginGeometryAudition();
  prepareBuiltinGeometrySelection(handle);
  // Browsing keeps the screen's orientation; choosing a layout applies its rotation.
  const byte heldDeviceRotation = deviceRotation;
  bool loaded = false;
  switch (kind) {
    case UserGeometryMenuKind::Tuning:
      loaded = loadUserGeometryBundleFromTuningSlot(handle);
      break;
    case UserGeometryMenuKind::Layout:
      loaded = loadUserGeometryLayoutFromSlot(handle);
      break;
    case UserGeometryMenuKind::Scale:
      loaded = loadUserGeometryScaleFromSlot(handle);
      break;
  }
  if (loaded) refreshMenuChoicesForCurrentTuning();
  if (deviceRotation != heldDeviceRotation) {
    deviceRotation = heldDeviceRotation;
    settings[static_cast<uint8_t>(SettingKey::DeviceRotation)] = deviceRotation;
    updateLayoutAndRotate();
  }
  markGeometryAuditionPlayed();
  geometryAuditionStartedFromMenu = true;
  geometryAuditionedKind = kind;
  geometryAuditionedHandle = handle;
  redrawVirtualListMenu();
}

void auditionHighlightedUserGeometryRow(uint16_t row) {
  if (row == VIRTUAL_LIST_MENU_NO_ROW) return;
  uint16_t index = 0;
  if (!userGeometryItemIndex(row, index)  // A control row is never auditioned.
      || userGeometryVirtualRows[index].kind != UserGeometryMenuRowKind::Item) return;
  // The diamond marks the chosen item; resting on it returns to it.
  if (userGeometryVirtualIsCurrent(nullptr, row)) {
    finishUserGeometryAudition();
    redrawVirtualListMenu();
    return;
  }
  auditionUserGeometryHandle(userGeometryVirtualKind, userGeometryVirtualRows[index].handle);
}
}  // namespace

void serviceUserGeometryMenuAudition() {
  uint16_t row = VIRTUAL_LIST_MENU_NO_ROW;
  if (!virtualListMenuHighlightedRow(userGeometryVirtualCountProvider, row)) {
    geometryAuditionWatchedRow = USER_GEOMETRY_AUDITION_NO_ROW;
    geometryAuditionRowMoved = false;
    finishUserGeometryAudition();
    return;
  }
  const uint32_t watched = (uint32_t(userGeometryMenuGeneration) << 16) | row;
  const uint32_t now = millis();
  if (watched != geometryAuditionWatchedRow) {
    // The row highlighted on opening is the chosen item; wait for a move.
    geometryAuditionRowMoved = geometryAuditionWatchedRow != USER_GEOMETRY_AUDITION_NO_ROW;
    geometryAuditionWatchedRow = watched;
    geometryAuditionRowSinceMs = now;
    geometryAuditionRowDone = false;
    return;
  }
  if (!geometryAuditionRowMoved || geometryAuditionRowDone
      || now - geometryAuditionRowSinceMs < USER_GEOMETRY_AUDITION_DELAY_MS) {
    return;
  }
  geometryAuditionRowDone = true;
  auditionHighlightedUserGeometryRow(row);
}

void openUserGeometryTuningMenu() {
  openUserGeometryMenu(UserGeometryMenuKind::Tuning);
}

void openUserGeometryLayoutMenu() {
  openUserGeometryMenu(UserGeometryMenuKind::Layout);
}

void openUserGeometryScaleMenu() {
  openUserGeometryMenu(UserGeometryMenuKind::Scale);
}

void requestUserGeometryMenuRebuild() {
  invalidateSelectedGeometryMenuCache();
  userGeometryMenuRebuildPending = true;
}

void rebuildUserGeometryMenuItems() {
  if (virtualListMenuIsActive()) {
    rebuildUserGeometryVirtualList(userGeometryVirtualKind);
    redrawVirtualListMenu();
  }
}

void serviceUserGeometryMenuRebuild() {
  if (!userGeometryMenuRebuildPending) {
    return;
  }
  userGeometryMenuRebuildPending = false;
  if (virtualListMenuIsActive()) {
    rebuildUserGeometryVirtualList(userGeometryVirtualKind);
    redrawVirtualListMenu();
  } else if (menu.getCurrentMenuPage() == &menuPageMain) {
    dismissCommandWheelOverlay();
    menu.drawMenu();
  }
}

void createUserGeometryMenuItems() {
}
