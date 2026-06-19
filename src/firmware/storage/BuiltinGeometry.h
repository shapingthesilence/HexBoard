#pragma once

#include "../FirmwareModule.h"
#include "PersistentDataModels.h"

constexpr uint16_t BUILTIN_GEOMETRY_HANDLE_BASE = 0x2000;
constexpr const char* BUILTIN_GEOMETRY_FOLDER = "/Built In";

struct BuiltinGeometryMetadata {
  uint8_t objectType = 0;
  uint16_t handle = 0;
  uint8_t legacyTuningIndex = 0;
  uint16_t legacyOptionIndex = 0;
  const char* name = "";
  const char* folderPath = BUILTIN_GEOMETRY_FOLDER;
  uint8_t objectId[GEOMETRY_OBJECT_ID_LENGTH] = {};
};

size_t builtinGeometryObjectCount();
bool isBuiltinGeometryHandle(uint16_t handle);
bool builtinGeometryMetadataByOrdinal(size_t ordinal, BuiltinGeometryMetadata& metadata);
bool builtinGeometryMetadataByHandle(uint16_t handle, BuiltinGeometryMetadata& metadata);
bool buildBuiltinGeometryObject(uint16_t handle, GeometryObjectSlot& object);
bool builtinGeometryHandleForLegacyTuning(uint8_t tuningIndex, uint16_t& handle);
bool builtinGeometryHandleForLegacyLayout(uint16_t layoutIndex, uint16_t& handle);
bool builtinGeometryHandleForLegacyScale(uint8_t tuningIndex, uint16_t scaleIndex, uint16_t& handle);
bool builtinGeometrySelectionForHandle(uint16_t handle,
                                       uint8_t& objectType,
                                       uint8_t& tuningIndex,
                                       uint16_t& optionIndex);
