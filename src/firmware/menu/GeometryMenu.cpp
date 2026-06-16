#include "../FirmwareModule.h"
#include "GeometryMenu.h"
#include "MenuAndDisplay.h"
#include "SynthPresetMenu.h"
#include "../app/DiagnosticsTiming.h"
#include "../hardware/GridState.h"
#include "../model/PitchAssignment.h"
#include "../storage/PresetSync.h"
#include "../storage/SynthPresetStorage.h"

enum class UserGeometryMenuKind : uint8_t {
  Tuning,
  Layout,
  Scale
};

struct UserGeometryMenuAction {
  UserGeometryMenuKind kind = UserGeometryMenuKind::Tuning;
  uint16_t objectIndex = 0;
};

struct UserGeometryMenuFolderNode {
  UserGeometryMenuKind kind = UserGeometryMenuKind::Tuning;
  char path[GEOMETRY_OBJECT_FOLDER_LENGTH] = {};
  char label[SYNTH_PRESET_MENU_LABEL_LENGTH] = {};
  GEMPage* page = nullptr;
};

std::vector<GEMItem*> userGeometryMenuItems;
std::vector<GEMPage*> userGeometryMenuPages;
std::vector<UserGeometryMenuAction*> userGeometryMenuActions;
std::vector<UserGeometryMenuFolderNode*> userGeometryMenuFolders;
std::vector<char*> userGeometryMenuLabels;
GEMSelect* userGeometryKeySelect = nullptr;
bool userGeometryMenuRebuildPending = false;

GEMPage& userGeometryRootPage(UserGeometryMenuKind kind) {
  switch (kind) {
    case UserGeometryMenuKind::Tuning:
      return menuPageTuning;
    case UserGeometryMenuKind::Layout:
      return menuPageLayout;
    case UserGeometryMenuKind::Scale:
      return menuPageScales;
  }
  return menuPageTuning;
}

const char* emptyUserGeometryLabel(UserGeometryMenuKind kind) {
  switch (kind) {
    case UserGeometryMenuKind::Tuning:
      return "No User Tunings";
    case UserGeometryMenuKind::Layout:
      return userGeometryRuntimeTuningObjectSelected ? "No User Layouts" : "Select Tuning";
    case UserGeometryMenuKind::Scale:
      return userGeometryRuntimeTuningObjectSelected ? "No User Scales" : "Select Tuning";
  }
  return "No User Geometry";
}

char* cloneUserGeometryMenuText(const char* text) {
  size_t length = strlen(text);
  char* copy = new char[length + 1];
  memcpy(copy, text, length + 1);
  userGeometryMenuLabels.push_back(copy);
  return copy;
}

UserGeometryMenuAction* createUserGeometryMenuAction(UserGeometryMenuKind kind, uint16_t objectIndex) {
  UserGeometryMenuAction* action = new UserGeometryMenuAction{};
  action->kind = kind;
  action->objectIndex = objectIndex;
  userGeometryMenuActions.push_back(action);
  return action;
}

int findFirstUserGeometryObjectReferencing(uint8_t objectType,
                                           uint8_t referenceTag,
                                           uint8_t referenceObjectType,
                                           const uint8_t* referenceObjectId) {
  for (size_t i = 0; i < geometryObjects.size(); ++i) {
    const GeometryObjectSlot& object = geometryObjects[i];
    if (object.valid
        && object.objectType == objectType
        && geometryObjectReferencesObjectId(object, referenceTag, referenceObjectType, referenceObjectId)) {
      return static_cast<int>(i);
    }
  }
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
  if (buttonMapIndex < 0) {
    buttonMapIndex = findFirstUserGeometryObjectReferencing(
      PRESET_SYNC_OBJECT_TYPE_EXPLICIT_BUTTON_MAP,
      PRESET_SYNC_TLV_BUTTON_MAP_TUNING_REF,
      PRESET_SYNC_OBJECT_TYPE_USER_TUNING,
      userGeometryRuntimeTuningObjectId
    );
  }
  return buttonMapIndex < 0 || applyGeometryObjectToRuntime(geometryObjects[buttonMapIndex]);
}

bool loadUserGeometryLayoutFromSlot(uint16_t objectIndex) {
  if (objectIndex >= geometryObjects.size()
      || !geometryObjects[objectIndex].valid
      || geometryObjects[objectIndex].objectType != PRESET_SYNC_OBJECT_TYPE_USER_LAYOUT) {
    sendToLog("User geometry layout menu load rejected: object is missing.");
    return false;
  }
  return applyGeometryObjectToRuntime(geometryObjects[objectIndex])
         && applyLinkedButtonMapForCurrentUserLayout();
}

bool loadUserGeometryScaleFromSlot(uint16_t objectIndex) {
  if (objectIndex >= geometryObjects.size()
      || !geometryObjects[objectIndex].valid
      || geometryObjects[objectIndex].objectType != PRESET_SYNC_OBJECT_TYPE_USER_SCALE) {
    sendToLog("User geometry scale menu load rejected: object is missing.");
    return false;
  }
  return applyGeometryObjectToRuntime(geometryObjects[objectIndex]);
}

void loadUserGeometryMenu(GEMCallbackData callbackData) {
  UserGeometryMenuAction* action = reinterpret_cast<UserGeometryMenuAction*>(callbackData.valPointer);
  if (!action) {
    menuHome();
    return;
  }

  bool loaded = false;
  switch (action->kind) {
    case UserGeometryMenuKind::Tuning:
      loaded = loadUserGeometryBundleFromTuningSlot(action->objectIndex);
      requestUserGeometryMenuRebuild();
      break;
    case UserGeometryMenuKind::Layout:
      loaded = loadUserGeometryLayoutFromSlot(action->objectIndex);
      break;
    case UserGeometryMenuKind::Scale:
      loaded = loadUserGeometryScaleFromSlot(action->objectIndex);
      break;
  }
  if (loaded) {
    loadDeviceRotationFromCurrentLayout();
    applyDeviceDisplayRotation();
  }
  menuHome();
}

void addUserGeometryMenuButton(GEMPage& page, const char* label, UserGeometryMenuAction* action) {
  GEMItem* item = new GEMItem(cloneUserGeometryMenuText(label), loadUserGeometryMenu, reinterpret_cast<void*>(action));
  userGeometryMenuItems.push_back(item);
  page.addMenuItem(*item);
}

UserGeometryMenuFolderNode* findUserGeometryMenuFolder(UserGeometryMenuKind kind, const char* folderPath) {
  for (UserGeometryMenuFolderNode* folder : userGeometryMenuFolders) {
    if (folder->kind == kind && strncmp(folder->path, folderPath, sizeof(folder->path)) == 0) {
      return folder;
    }
  }
  return nullptr;
}

void parentUserGeometryFolderPath(const char* folderPath, char* output, size_t outputLength) {
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

UserGeometryMenuFolderNode* ensureUserGeometryMenuFolder(UserGeometryMenuKind kind, const char* folderPath) {
  char normalized[GEOMETRY_OBJECT_FOLDER_LENGTH] = {};
  snprintf(normalized, sizeof(normalized), "%s", folderPath && folderPath[0] ? folderPath : SYNTH_PRESET_ROOT_FOLDER);
  normalizeSynthPresetFolderPath(normalized, sizeof(normalized));
  if (strcmp(normalized, SYNTH_PRESET_ROOT_FOLDER) == 0) {
    return nullptr;
  }

  UserGeometryMenuFolderNode* existing = findUserGeometryMenuFolder(kind, normalized);
  if (existing) {
    return existing;
  }

  char parentPath[GEOMETRY_OBJECT_FOLDER_LENGTH] = {};
  parentUserGeometryFolderPath(normalized, parentPath, sizeof(parentPath));
  UserGeometryMenuFolderNode* parent = ensureUserGeometryMenuFolder(kind, parentPath);
  GEMPage& parentPage = parent ? *parent->page : userGeometryRootPage(kind);

  UserGeometryMenuFolderNode* folder = new UserGeometryMenuFolderNode{};
  folder->kind = kind;
  snprintf(folder->path, sizeof(folder->path), "%s", normalized);
  synthPresetFolderLabel(normalized, folder->label, sizeof(folder->label));
  folder->page = new GEMPage(folder->label, parentPage);
  userGeometryMenuPages.push_back(folder->page);
  userGeometryMenuFolders.push_back(folder);

  GEMItem* gotoItem = new GEMItem(folder->label, *folder->page);
  userGeometryMenuItems.push_back(gotoItem);
  parentPage.addMenuItem(*gotoItem);
  return folder;
}

GEMPage& userGeometryPageForFolder(UserGeometryMenuKind kind, const char* folderPath) {
  UserGeometryMenuFolderNode* folder = ensureUserGeometryMenuFolder(kind, folderPath);
  return folder ? *folder->page : userGeometryRootPage(kind);
}

bool userGeometryObjectBelongsToCurrentTuning(const GeometryObjectSlot& object, uint8_t referenceTag) {
  return userGeometryRuntimeTuningObjectSelected
         && geometryObjectReferencesObjectId(
           object,
           referenceTag,
           PRESET_SYNC_OBJECT_TYPE_USER_TUNING,
           userGeometryRuntimeTuningObjectId
         );
}

void changeUserGeometryKey() {
  applyScale();
}

void previewUserGeometryKey(GEMPreviewCallbackData previewData) {
  current.keyStepsFromA = previewData.previewValInt;
  applyScale();
}

void addUserGeometryKeyMenuItem() {
  if (!userGeometryRuntimeActive || !userGeometryRuntimeTuningObjectSelected) {
    return;
  }
  userGeometryKeySelect = new GEMSelect(userGeometryRuntimeTuning.cycleLength, userGeometryRuntimeTuning.keyChoices);
  GEMItem* keyItem = new GEMItem("Key", current.keyStepsFromA, *userGeometryKeySelect, changeUserGeometryKey);
  keyItem->setPreviewCallback(previewUserGeometryKey);
  userGeometryMenuItems.push_back(keyItem);
  menuPageScales.addMenuItem(*keyItem);
}

void addEmptyUserGeometryMenuItem(UserGeometryMenuKind kind) {
  GEMItem* emptyItem = new GEMItem(cloneUserGeometryMenuText(emptyUserGeometryLabel(kind)));
  userGeometryMenuItems.push_back(emptyItem);
  userGeometryRootPage(kind).addMenuItem(*emptyItem);
}

void addUserGeometryObjectsForKind(UserGeometryMenuKind kind) {
  uint16_t addedCount = 0;
  for (size_t i = 0; i < geometryObjects.size(); ++i) {
    GeometryObjectSlot& object = geometryObjects[i];
    if (!object.valid) {
      continue;
    }

    bool include = false;
    switch (kind) {
      case UserGeometryMenuKind::Tuning:
        include = geometryObjectRuntimeTuningSupported(object);
        break;
      case UserGeometryMenuKind::Layout:
        include = object.objectType == PRESET_SYNC_OBJECT_TYPE_USER_LAYOUT
                  && userGeometryObjectBelongsToCurrentTuning(object, PRESET_SYNC_TLV_LAYOUT_TUNING_REF);
        break;
      case UserGeometryMenuKind::Scale:
        include = object.objectType == PRESET_SYNC_OBJECT_TYPE_USER_SCALE
                  && userGeometryObjectBelongsToCurrentTuning(object, PRESET_SYNC_TLV_USER_SCALE_TUNING_REF);
        break;
    }
    if (!include) {
      continue;
    }

    GEMPage& page = userGeometryPageForFolder(kind, object.folderPath);
    addUserGeometryMenuButton(page, object.name, createUserGeometryMenuAction(kind, static_cast<uint16_t>(i)));
    ++addedCount;
  }

  if (addedCount == 0) {
    addEmptyUserGeometryMenuItem(kind);
  }
}

void clearUserGeometryMenuItems() {
  for (GEMItem* item : userGeometryMenuItems) {
    item->remove();
    delete item;
  }
  userGeometryMenuItems.clear();

  for (GEMPage* page : userGeometryMenuPages) {
    delete page;
  }
  userGeometryMenuPages.clear();

  for (UserGeometryMenuAction* action : userGeometryMenuActions) {
    delete action;
  }
  userGeometryMenuActions.clear();

  for (UserGeometryMenuFolderNode* folder : userGeometryMenuFolders) {
    delete folder;
  }
  userGeometryMenuFolders.clear();

  for (char* label : userGeometryMenuLabels) {
    delete[] label;
  }
  userGeometryMenuLabels.clear();

  delete userGeometryKeySelect;
  userGeometryKeySelect = nullptr;
}

bool userGeometryMenuOwnsPage(GEMPage* page) {
  if (page == &menuPageTuning || page == &menuPageLayout || page == &menuPageScales) {
    return true;
  }
  for (GEMPage* ownedPage : userGeometryMenuPages) {
    if (page == ownedPage) {
      return true;
    }
  }
  return false;
}

void requestUserGeometryMenuRebuild() {
  userGeometryMenuRebuildPending = true;
}

void rebuildUserGeometryMenuItems() {
  clearUserGeometryMenuItems();
  addUserGeometryObjectsForKind(UserGeometryMenuKind::Tuning);
  addUserGeometryObjectsForKind(UserGeometryMenuKind::Layout);
  addUserGeometryKeyMenuItem();
  addUserGeometryObjectsForKind(UserGeometryMenuKind::Scale);
}

void serviceUserGeometryMenuRebuild() {
  if (!userGeometryMenuRebuildPending) {
    return;
  }
  userGeometryMenuRebuildPending = false;
  if (userGeometryMenuOwnsPage(menu.getCurrentMenuPage())) {
    menuHome();
  }
  rebuildUserGeometryMenuItems();
  if (menu.getCurrentMenuPage() == &menuPageMain) {
    menu.drawMenu();
  }
}

void createUserGeometryMenuItems() {
  rebuildUserGeometryMenuItems();
}
