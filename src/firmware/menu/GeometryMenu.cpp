#include "../FirmwareModule.h"
#include "CommandWheelOverlay.h"
#include "GeometryMenu.h"
#include "MenuFolderUtils.h"
#include "MenuAndDisplay.h"
#include "SynthPresetMenu.h"
#include "VirtualListMenu.h"
#include "../app/DiagnosticsTiming.h"
#include "../hardware/GridState.h"
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
      return userGeometryRuntimeTuningObjectSelected ? "No Layouts" : "Select Tuning";
    case UserGeometryMenuKind::Scale:
      return userGeometryRuntimeTuningObjectSelected ? "No Scales" : "Select Tuning";
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
  if (!userGeometryRuntimeTuningObjectSelected
      || !geometryBundleForTuningObjectId(userGeometryRuntimeTuningObjectId, bundle)) {
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
  if (!userGeometryRuntimeTuningObjectSelected) {
    return true;
  }

  int buttonMapIndex = -1;
  if (userGeometryRuntimeLayoutObjectSelected) {
    buttonMapIndex = findFirstUserGeometryObjectReferencing(
      PRESET_SYNC_OBJECT_TYPE_EXPLICIT_BUTTON_MAP,
      PRESET_SYNC_TLV_BUTTON_MAP_LAYOUT_REF,
      PRESET_SYNC_OBJECT_TYPE_USER_LAYOUT,
      userGeometryRuntimeLayoutObjectId
    );
  }
  if (buttonMapIndex < 0 && !userGeometryRuntimeLayoutObjectSelected) {
    buttonMapIndex = findFirstUserGeometryObjectReferencing(
      PRESET_SYNC_OBJECT_TYPE_EXPLICIT_BUTTON_MAP,
      PRESET_SYNC_TLV_BUTTON_MAP_TUNING_REF,
      PRESET_SYNC_OBJECT_TYPE_USER_TUNING,
      userGeometryRuntimeTuningObjectId
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
      settings[static_cast<uint8_t>(SettingKey::CurrentKeyStepsFromA)] = uint8_t(current.keyStepsFromA + 128);
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
  if (!userGeometryRuntimeTuningObjectSelected) {
    invalidateSelectedGeometryMenuCache();
    return false;
  }
  if (selectedGeometryMenuCacheValid
      && memcmp(selectedGeometryMenuCacheTuningId,
                userGeometryRuntimeTuningObjectId,
                GEOMETRY_OBJECT_ID_LENGTH) == 0) {
    return true;
  }

  invalidateSelectedGeometryMenuCache();
  const GeometryBundleIndexEntry* bundle = nullptr;
  if (!geometryBundleForTuningObjectId(userGeometryRuntimeTuningObjectId, bundle)) {
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
         userGeometryRuntimeTuningObjectId,
         sizeof(selectedGeometryMenuCacheTuningId));
  selectedGeometryMenuCacheValid = true;
  return true;
}

bool builtinTuningMatchesCurrentRuntime(uint8_t legacyTuningIndex) {
  if (!userGeometryRuntimeTuningObjectSelected) {
    return false;
  }
  uint16_t tuningHandle = 0;
  BuiltinGeometryMetadata tuningMetadata;
  return builtinGeometryHandleForLegacyTuning(legacyTuningIndex, tuningHandle)
         && builtinGeometryMetadataByHandle(tuningHandle, tuningMetadata)
         && memcmp(tuningMetadata.objectId,
                   userGeometryRuntimeTuningObjectId,
                   GEOMETRY_OBJECT_ID_LENGTH) == 0;
}

bool includeBuiltinGeometryMetadataInMenu(UserGeometryMenuKind kind, const BuiltinGeometryMetadata& metadata) {
  switch (kind) {
    case UserGeometryMenuKind::Tuning:
      return metadata.objectType == PRESET_SYNC_OBJECT_TYPE_USER_TUNING;
    case UserGeometryMenuKind::Layout:
      return metadata.objectType == PRESET_SYNC_OBJECT_TYPE_USER_LAYOUT
             && builtinTuningMatchesCurrentRuntime(metadata.legacyTuningIndex);
    case UserGeometryMenuKind::Scale:
      return metadata.objectType == PRESET_SYNC_OBJECT_TYPE_USER_SCALE
             && builtinTuningMatchesCurrentRuntime(metadata.legacyTuningIndex);
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
  switch (kind) {
    case UserGeometryMenuKind::Tuning:
      return userGeometryRuntimeTuningObjectSelected
             && geometryHandleMatchesObjectId(handle, userGeometryRuntimeTuningObjectId);
    case UserGeometryMenuKind::Layout:
      return userGeometryRuntimeLayoutObjectSelected
             && geometryHandleMatchesObjectId(handle, userGeometryRuntimeLayoutObjectId);
    case UserGeometryMenuKind::Scale:
      return userGeometryRuntimeScaleObjectSelected
             && geometryHandleMatchesObjectId(handle, userGeometryRuntimeScaleObjectId);
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

void rebuildUserGeometryVirtualList(UserGeometryMenuKind kind) {
  userGeometryVirtualKind = kind;
  userGeometryVirtualCount = 0;
  userGeometryMenuOverflowLogged = false;

  if (geometryFallbackRequired()
      && (kind != UserGeometryMenuKind::Tuning || menuFolderIsRoot(userGeometryMenuCurrentFolder))) {
    for (size_t i = 0; i < builtinGeometryObjectCount(); ++i) {
      BuiltinGeometryMetadata metadata;
      if (builtinGeometryMetadataByOrdinal(i, metadata)
          && includeBuiltinGeometryMetadataInMenu(kind, metadata)) {
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
    if (selectedGeometryMenuCache[index].objectType == wantedType) {
      appendUserGeometryHandle(selectedGeometryMenuCache[index].handle);
    }
  }
}

uint16_t userGeometryVirtualCountProvider(void*) {
  return userGeometryVirtualCount;
}

bool userGeometryVirtualLabelProvider(void*, uint16_t index, char* output, size_t outputLength) {
  if (outputLength == 0) {
    return false;
  }
  output[0] = '\0';
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
  snprintf(output, outputLength, "%s", cached->name);
  return true;
}

VirtualListMenuRowType userGeometryVirtualRowType(void*, uint16_t index) {
  if (index >= userGeometryVirtualCount) {
    return VirtualListMenuRowType::Button;
  }
  return userGeometryVirtualRows[index].kind == UserGeometryMenuRowKind::Folder
           ? VirtualListMenuRowType::Link
           : VirtualListMenuRowType::Button;
}

bool userGeometryVirtualIsCurrent(void*, uint16_t index) {
  if (index >= userGeometryVirtualCount
      || userGeometryVirtualRows[index].kind != UserGeometryMenuRowKind::Item) {
    return false;
  }
  return userGeometryHandleIsCurrent(userGeometryVirtualKind, userGeometryVirtualRows[index].handle);
}

bool userGeometryVirtualInitialSelection(void*, uint16_t* index) {
  if (!index) {
    return false;
  }
  return findCurrentUserGeometryRow(*index);
}

void loadUserGeometryHandle(UserGeometryMenuKind kind, uint16_t handle) {
  if (handle == USER_GEOMETRY_MENU_INVALID_HANDLE) {
    redrawVirtualListMenu();
    return;
  }

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

void userGeometryVirtualSelect(void*, uint16_t index) {
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
  provider.getInitialSelection = userGeometryVirtualInitialSelection;
  provider.select = userGeometryVirtualSelect;
  provider.back = userGeometryVirtualBack;
  provider.close = userGeometryVirtualClose;
  provider.emptyLabel = emptyUserGeometryLabel(kind);
  openVirtualListMenu(provider);
}

}  // namespace

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
