#include "../FirmwareModule.h"
#include "GeometryMenu.h"
#include "MenuAndDisplay.h"
#include "SynthPresetMenu.h"
#include "../app/DiagnosticsTiming.h"
#include "../hardware/GridState.h"
#include "../model/PitchAssignment.h"
#include "../storage/BuiltinGeometry.h"
#include "../storage/PresetSync.h"
#include "../storage/Settings.h"
#include "../storage/SynthPresetStorage.h"

namespace {
enum class UserGeometryMenuKind : uint8_t {
  Tuning,
  Layout,
  Scale
};

constexpr uint8_t USER_GEOMETRY_MENU_VISIBLE_SLOTS = 10;
constexpr uint16_t USER_GEOMETRY_MENU_INVALID_HANDLE = 0xFFFFu;

struct UserGeometryMenuAction {
  UserGeometryMenuKind kind = UserGeometryMenuKind::Tuning;
  uint16_t objectIndex = USER_GEOMETRY_MENU_INVALID_HANDLE;
};

void loadUserGeometryMenu(GEMCallbackData callbackData);

struct UserGeometryMenuSlotItem {
  char label[SYNTH_PRESET_MENU_LABEL_LENGTH] = {};
  UserGeometryMenuAction action = {};
  GEMItem item;

  UserGeometryMenuSlotItem()
    : item(label, loadUserGeometryMenu, reinterpret_cast<void*>(&action)) {}
};

struct UserGeometryMenuEntry {
  bool valid = false;
  bool builtin = false;
  uint16_t handle = USER_GEOMETRY_MENU_INVALID_HANDLE;
  GeometryObjectSlot object = {};
};

UserGeometryMenuSlotItem userGeometrySlots[USER_GEOMETRY_MENU_VISIBLE_SLOTS];

bool userGeometryBrowserAttached = false;
bool userGeometryMenuRebuildPending = false;
UserGeometryMenuKind userGeometryBrowserKind = UserGeometryMenuKind::Tuning;
uint16_t userGeometryBrowserEntryCount = 0;
uint8_t userGeometryBrowserVisibleCount = 0;
byte userGeometryBrowserLastItemIndex = 0;
uint16_t userGeometryTuningPageStart = 0;
uint16_t userGeometryLayoutPageStart = 0;
uint16_t userGeometryScalePageStart = 0;

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

bool userGeometryMenuOwnsKindPage(GEMPage* page, UserGeometryMenuKind& kind) {
  if (page == &menuPageTuning) {
    kind = UserGeometryMenuKind::Tuning;
    return true;
  }
  if (page == &menuPageLayout) {
    kind = UserGeometryMenuKind::Layout;
    return true;
  }
  if (page == &menuPageScales) {
    kind = UserGeometryMenuKind::Scale;
    return true;
  }
  return false;
}

uint16_t& userGeometryPageStart(UserGeometryMenuKind kind) {
  switch (kind) {
    case UserGeometryMenuKind::Tuning:
      return userGeometryTuningPageStart;
    case UserGeometryMenuKind::Layout:
      return userGeometryLayoutPageStart;
    case UserGeometryMenuKind::Scale:
      return userGeometryScalePageStart;
  }
  return userGeometryTuningPageStart;
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

bool userGeometryObjectBelongsToCurrentTuning(const GeometryObjectSlot& object, uint8_t referenceTag) {
  return userGeometryRuntimeTuningObjectSelected
         && geometryObjectReferencesObjectId(
           object,
           referenceTag,
           PRESET_SYNC_OBJECT_TYPE_USER_TUNING,
           userGeometryRuntimeTuningObjectId
         );
}

bool includeGeometryObjectInMenu(UserGeometryMenuKind kind, const GeometryObjectSlot& object) {
  switch (kind) {
    case UserGeometryMenuKind::Tuning:
      return geometryObjectRuntimeTuningSupported(object);
    case UserGeometryMenuKind::Layout:
      return object.objectType == PRESET_SYNC_OBJECT_TYPE_USER_LAYOUT
             && userGeometryObjectBelongsToCurrentTuning(object, PRESET_SYNC_TLV_LAYOUT_TUNING_REF);
    case UserGeometryMenuKind::Scale:
      return object.objectType == PRESET_SYNC_OBJECT_TYPE_USER_SCALE
             && userGeometryObjectBelongsToCurrentTuning(object, PRESET_SYNC_TLV_USER_SCALE_TUNING_REF);
  }
  return false;
}

bool geometryMenuEntryForOrdinal(UserGeometryMenuKind kind, uint16_t ordinal, UserGeometryMenuEntry& entry) {
  uint16_t candidateIndex = 0;
  for (size_t i = 0; i < builtinGeometryObjectCount(); ++i) {
    BuiltinGeometryMetadata metadata;
    GeometryObjectSlot object;
    if (builtinGeometryMetadataByOrdinal(i, metadata)
        && buildBuiltinGeometryObject(metadata.handle, object)
        && includeGeometryObjectInMenu(kind, object)) {
      if (candidateIndex == ordinal) {
        entry.valid = true;
        entry.builtin = true;
        entry.handle = metadata.handle;
        entry.object = object;
        return true;
      }
      ++candidateIndex;
    }
  }

  for (size_t i = 0; i < geometryObjects.size(); ++i) {
    GeometryObjectSlot& object = geometryObjects[i];
    if (object.valid && includeGeometryObjectInMenu(kind, object)) {
      if (candidateIndex == ordinal) {
        entry.valid = true;
        entry.builtin = false;
        entry.handle = static_cast<uint16_t>(i);
        entry.object = object;
        return true;
      }
      ++candidateIndex;
    }
  }

  entry = {};
  return false;
}

uint16_t userGeometryMenuEntryCount(UserGeometryMenuKind kind) {
  uint16_t count = 0;
  UserGeometryMenuEntry entry;
  while (geometryMenuEntryForOrdinal(kind, count, entry)) {
    ++count;
  }
  return count;
}

uint16_t userGeometryMenuLastPageStart(uint16_t entryCount) {
  if (entryCount <= USER_GEOMETRY_MENU_VISIBLE_SLOTS) {
    return 0;
  }
  return static_cast<uint16_t>(((entryCount - 1) / USER_GEOMETRY_MENU_VISIBLE_SLOTS) * USER_GEOMETRY_MENU_VISIBLE_SLOTS);
}

void clampUserGeometryMenuPageStart(UserGeometryMenuKind kind, uint16_t entryCount) {
  uint16_t& pageStart = userGeometryPageStart(kind);
  uint16_t lastPageStart = userGeometryMenuLastPageStart(entryCount);
  if (pageStart > lastPageStart) {
    pageStart = lastPageStart;
  }
}

void formatUserGeometryMenuLabel(const UserGeometryMenuEntry& entry,
                                 uint16_t ordinal,
                                 char* output,
                                 size_t outputLength) {
  if (outputLength == 0) {
    return;
  }
  output[0] = '\0';
  if (!entry.valid) {
    return;
  }

  const char* folderPath = entry.object.folderPath;
  bool showFolder = !entry.builtin
                    && folderPath[0]
                    && strcmp(folderPath, SYNTH_PRESET_ROOT_FOLDER) != 0
                    && strcmp(folderPath, SYNTH_WAVETABLE_BUILTIN_FOLDER) != 0;
  if (!showFolder) {
    snprintf(output, outputLength, "%u %s", static_cast<unsigned>(ordinal + 1), entry.object.name);
    return;
  }

  char folderLabel[SYNTH_PRESET_MENU_LABEL_LENGTH] = {};
  synthPresetFolderLabel(folderPath, folderLabel, sizeof(folderLabel));
  snprintf(output,
           outputLength,
           "%u %s/%s",
           static_cast<unsigned>(ordinal + 1),
           folderLabel,
           entry.object.name);
}

void updateUserGeometryMenuPage(UserGeometryMenuKind kind) {
  userGeometryBrowserKind = kind;
  userGeometryBrowserEntryCount = userGeometryMenuEntryCount(kind);
  clampUserGeometryMenuPageStart(kind, userGeometryBrowserEntryCount);
  uint16_t pageStart = userGeometryPageStart(kind);
  userGeometryBrowserVisibleCount = 0;

  if (userGeometryBrowserEntryCount == 0) {
    snprintf(userGeometrySlots[0].label, sizeof(userGeometrySlots[0].label), "%s", emptyUserGeometryLabel(kind));
    userGeometrySlots[0].action.kind = kind;
    userGeometrySlots[0].action.objectIndex = USER_GEOMETRY_MENU_INVALID_HANDLE;
    userGeometrySlots[0].item.setTitle(userGeometrySlots[0].label);
    userGeometrySlots[0].item.hide(false);
    for (uint8_t i = 1; i < USER_GEOMETRY_MENU_VISIBLE_SLOTS; ++i) {
      userGeometrySlots[i].label[0] = '\0';
      userGeometrySlots[i].action.kind = kind;
      userGeometrySlots[i].action.objectIndex = USER_GEOMETRY_MENU_INVALID_HANDLE;
      userGeometrySlots[i].item.setTitle(userGeometrySlots[i].label);
      userGeometrySlots[i].item.hide(true);
    }
    return;
  }

  for (uint8_t i = 0; i < USER_GEOMETRY_MENU_VISIBLE_SLOTS; ++i) {
    uint16_t ordinal = static_cast<uint16_t>(pageStart + i);
    UserGeometryMenuEntry entry;
    bool visible = geometryMenuEntryForOrdinal(kind, ordinal, entry);
    userGeometrySlots[i].action.kind = kind;
    if (visible) {
      formatUserGeometryMenuLabel(entry, ordinal, userGeometrySlots[i].label, sizeof(userGeometrySlots[i].label));
      userGeometrySlots[i].action.objectIndex = entry.handle;
    } else {
      userGeometrySlots[i].label[0] = '\0';
      userGeometrySlots[i].action.objectIndex = USER_GEOMETRY_MENU_INVALID_HANDLE;
    }
    if (visible) {
      ++userGeometryBrowserVisibleCount;
    }
    userGeometrySlots[i].item.setTitle(userGeometrySlots[i].label);
    userGeometrySlots[i].item.hide(!visible);
  }
}

void detachUserGeometryBrowserItems() {
  if (!userGeometryBrowserAttached) {
    return;
  }
  for (uint8_t i = 0; i < USER_GEOMETRY_MENU_VISIBLE_SLOTS; ++i) {
    userGeometrySlots[i].item.remove();
  }
  userGeometryBrowserAttached = false;
}

void attachUserGeometryBrowserItems(UserGeometryMenuKind kind) {
  detachUserGeometryBrowserItems();
  GEMPage& page = userGeometryRootPage(kind);
  for (uint8_t i = 0; i < USER_GEOMETRY_MENU_VISIBLE_SLOTS; ++i) {
    page.addMenuItem(userGeometrySlots[i].item);
  }
  userGeometryBrowserAttached = true;
  userGeometryBrowserKind = kind;
}

void openUserGeometryMenu(UserGeometryMenuKind kind) {
  userGeometryPageStart(kind) = 0;
  attachUserGeometryBrowserItems(kind);
  updateUserGeometryMenuPage(kind);
  userGeometryBrowserLastItemIndex = userGeometryBrowserEntryCount > 0 ? 1 : 0;
  userGeometryRootPage(kind).setCurrentMenuItemIndex(userGeometryBrowserLastItemIndex);
  menu.setMenuPageCurrent(userGeometryRootPage(kind));
  menu.drawMenu();
}

void loadUserGeometryMenu(GEMCallbackData callbackData) {
  UserGeometryMenuAction* action = reinterpret_cast<UserGeometryMenuAction*>(callbackData.valPointer);
  if (!action || action->objectIndex == USER_GEOMETRY_MENU_INVALID_HANDLE) {
    menu.drawMenu();
    return;
  }

  bool builtinSelection = prepareBuiltinGeometrySelection(action->objectIndex);
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
    if (builtinSelection) {
      persistBuiltinGeometrySelection(action->objectIndex);
    }
    loadDeviceRotationFromCurrentLayout();
    applyDeviceDisplayRotation();
  }
  menuHome();
}

void serviceUserGeometryBrowserScroll() {
  UserGeometryMenuKind kind;
  GEMPage* currentPage = menu.getCurrentMenuPage();
  if (!userGeometryBrowserAttached || !userGeometryMenuOwnsKindPage(currentPage, kind)) {
    userGeometryBrowserLastItemIndex = 0;
    return;
  }

  uint16_t entryCount = userGeometryBrowserEntryCount;
  if (entryCount <= USER_GEOMETRY_MENU_VISIBLE_SLOTS) {
    userGeometryBrowserLastItemIndex = userGeometryRootPage(kind).getCurrentMenuItemIndex();
    return;
  }

  GEMPage& page = userGeometryRootPage(kind);
  byte currentIndex = page.getCurrentMenuItemIndex();
  uint16_t& pageStart = userGeometryPageStart(kind);
  bool shifted = false;

  if (currentIndex == 0
      && userGeometryBrowserLastItemIndex == userGeometryBrowserVisibleCount
      && pageStart + userGeometryBrowserVisibleCount < entryCount) {
    pageStart = static_cast<uint16_t>(pageStart + USER_GEOMETRY_MENU_VISIBLE_SLOTS);
    updateUserGeometryMenuPage(kind);
    currentIndex = userGeometryBrowserVisibleCount > 0 ? 1 : 0;
    page.setCurrentMenuItemIndex(currentIndex);
    shifted = true;
  } else if (currentIndex == 0
             && userGeometryBrowserLastItemIndex == 1
             && pageStart > 0) {
    pageStart = pageStart > USER_GEOMETRY_MENU_VISIBLE_SLOTS
                  ? static_cast<uint16_t>(pageStart - USER_GEOMETRY_MENU_VISIBLE_SLOTS)
                  : 0;
    updateUserGeometryMenuPage(kind);
    currentIndex = userGeometryBrowserVisibleCount;
    page.setCurrentMenuItemIndex(currentIndex);
    shifted = true;
  }

  if (shifted) {
    menu.drawMenu();
  }
  userGeometryBrowserLastItemIndex = currentIndex;
}

}  // namespace

bool handleUserGeometryMenuKey(byte keyCode) {
  if (keyCode != GEM_KEY_UP && keyCode != GEM_KEY_DOWN) {
    return false;
  }

  UserGeometryMenuKind kind;
  GEMPage* currentPage = menu.getCurrentMenuPage();
  if (!userGeometryBrowserAttached || !userGeometryMenuOwnsKindPage(currentPage, kind)) {
    return false;
  }
  if (userGeometryBrowserEntryCount <= USER_GEOMETRY_MENU_VISIBLE_SLOTS) {
    return false;
  }

  GEMPage& page = userGeometryRootPage(kind);
  byte currentIndex = page.getCurrentMenuItemIndex();
  uint16_t& pageStart = userGeometryPageStart(kind);

  if (keyCode == GEM_KEY_DOWN
      && currentIndex == userGeometryBrowserVisibleCount
      && pageStart + userGeometryBrowserVisibleCount < userGeometryBrowserEntryCount) {
    pageStart = static_cast<uint16_t>(pageStart + USER_GEOMETRY_MENU_VISIBLE_SLOTS);
    updateUserGeometryMenuPage(kind);
    userGeometryBrowserLastItemIndex = userGeometryBrowserVisibleCount > 0 ? 1 : 0;
    page.setCurrentMenuItemIndex(userGeometryBrowserLastItemIndex);
    menu.drawMenu();
    return true;
  }

  if (keyCode == GEM_KEY_UP && currentIndex == 1 && pageStart > 0) {
    pageStart = pageStart > USER_GEOMETRY_MENU_VISIBLE_SLOTS
                  ? static_cast<uint16_t>(pageStart - USER_GEOMETRY_MENU_VISIBLE_SLOTS)
                  : 0;
    updateUserGeometryMenuPage(kind);
    userGeometryBrowserLastItemIndex = userGeometryBrowserVisibleCount;
    page.setCurrentMenuItemIndex(userGeometryBrowserLastItemIndex);
    menu.drawMenu();
    return true;
  }

  return false;
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
  userGeometryMenuRebuildPending = true;
}

void rebuildUserGeometryMenuItems() {
  updateUserGeometryMenuPage(userGeometryBrowserKind);
}

void serviceUserGeometryMenuRebuild() {
  serviceUserGeometryBrowserScroll();
  if (!userGeometryMenuRebuildPending) {
    return;
  }
  userGeometryMenuRebuildPending = false;
  UserGeometryMenuKind pageKind;
  if (userGeometryMenuOwnsKindPage(menu.getCurrentMenuPage(), pageKind)) {
    attachUserGeometryBrowserItems(pageKind);
    updateUserGeometryMenuPage(pageKind);
    userGeometryBrowserLastItemIndex = userGeometryBrowserEntryCount > 0 ? 1 : 0;
    userGeometryRootPage(pageKind).setCurrentMenuItemIndex(userGeometryBrowserLastItemIndex);
    menu.drawMenu();
  } else if (menu.getCurrentMenuPage() == &menuPageMain) {
    menu.drawMenu();
  }
}

void createUserGeometryMenuItems() {
  rebuildUserGeometryMenuItems();
}
