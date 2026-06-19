#include "../FirmwareModule.h"
#include "../model/Layout.h"
#include "../model/ScalePalettePreset.h"
#include "../tuning/Tuning.h"
#include "BuiltinGeometry.h"
#include "PresetSync.h"

namespace {

constexpr const char* BUILTIN_GEOMETRY_SOURCE = "factory";

size_t builtinScaleObjectCount() {
  return static_cast<size_t>(TUNINGCOUNT) + (scaleCount > 0 ? static_cast<size_t>(scaleCount - 1) : 0);
}

size_t layoutOrdinalBase() {
  return TUNINGCOUNT;
}

size_t scaleOrdinalBase() {
  return static_cast<size_t>(TUNINGCOUNT) + layoutCount;
}

uint32_t fnv1aUpdate(uint32_t hash, uint8_t value) {
  hash ^= value;
  return hash * 16777619u;
}

uint32_t fnv1aUpdateString(uint32_t hash, const char* text) {
  if (!text) {
    return fnv1aUpdate(hash, 0);
  }
  while (*text) {
    hash = fnv1aUpdate(hash, static_cast<uint8_t>(*text++));
  }
  return hash;
}

void fillBuiltinObjectId(uint8_t objectType,
                         uint8_t tuningIndex,
                         uint16_t optionIndex,
                         const char* name,
                         uint8_t* output) {
  uint32_t seeds[4] = { 2166136261u, 2166136261u ^ 0x9E3779B9u, 2166136261u ^ 0x85EBCA6Bu, 2166136261u ^ 0xC2B2AE35u };
  for (uint8_t part = 0; part < 4; ++part) {
    uint32_t hash = seeds[part];
    hash = fnv1aUpdateString(hash, "HexBoard factory geometry v1");
    hash = fnv1aUpdate(hash, objectType);
    hash = fnv1aUpdate(hash, tuningIndex);
    hash = fnv1aUpdate(hash, optionIndex & 0xFF);
    hash = fnv1aUpdate(hash, (optionIndex >> 8) & 0xFF);
    hash = fnv1aUpdateString(hash, name);
    output[(part * 4) + 0] = hash & 0xFF;
    output[(part * 4) + 1] = (hash >> 8) & 0xFF;
    output[(part * 4) + 2] = (hash >> 16) & 0xFF;
    output[(part * 4) + 3] = (hash >> 24) & 0xFF;
  }
}

void appendTextTlv(std::vector<uint8_t>& body, uint8_t tag, const char* text) {
  presetSyncAppendTextTlv(body, tag, text ? text : "", text ? strlen(text) : 0);
}

void appendU8Tlv(std::vector<uint8_t>& body, uint8_t tag, uint8_t value) {
  presetSyncAppendTlv(body, tag, &value, 1);
}

void appendU16Tlv(std::vector<uint8_t>& body, uint8_t tag, uint16_t value) {
  uint8_t bytes[2] = {
    static_cast<uint8_t>(value & 0xFF),
    static_cast<uint8_t>((value >> 8) & 0xFF)
  };
  presetSyncAppendTlv(body, tag, bytes, sizeof(bytes));
}

void appendI16Tlv(std::vector<uint8_t>& body, uint8_t tag, int16_t value) {
  appendU16Tlv(body, tag, static_cast<uint16_t>(value));
}

void appendU32Tlv(std::vector<uint8_t>& body, uint8_t tag, uint32_t value) {
  uint8_t bytes[4] = {
    static_cast<uint8_t>(value & 0xFF),
    static_cast<uint8_t>((value >> 8) & 0xFF),
    static_cast<uint8_t>((value >> 16) & 0xFF),
    static_cast<uint8_t>((value >> 24) & 0xFF)
  };
  presetSyncAppendTlv(body, tag, bytes, sizeof(bytes));
}

void appendObjectReferenceTlv(std::vector<uint8_t>& body,
                              uint8_t tag,
                              uint8_t objectType,
                              uint16_t handle,
                              const uint8_t* objectId) {
  uint8_t bytes[3 + GEOMETRY_OBJECT_ID_LENGTH] = {
    objectType,
    static_cast<uint8_t>(handle & 0xFF),
    static_cast<uint8_t>((handle >> 8) & 0xFF)
  };
  memcpy(bytes + 3, objectId, GEOMETRY_OBJECT_ID_LENGTH);
  presetSyncAppendTlv(body, tag, bytes, sizeof(bytes));
}

void appendCommonGeometryHeader(std::vector<uint8_t>& body,
                                const BuiltinGeometryMetadata& metadata) {
  body.push_back('H');
  body.push_back('B');
  body.push_back('S');
  body.push_back('1');
  body.push_back(metadata.objectType);
  body.push_back(1);
  body.push_back(0);
  body.push_back(0);
  appendTextTlv(body, PRESET_SYNC_TLV_NAME, metadata.name);
  presetSyncAppendTlv(body, PRESET_SYNC_TLV_OBJECT_ID, metadata.objectId, GEOMETRY_OBJECT_ID_LENGTH);
  appendTextTlv(body, PRESET_SYNC_TLV_SOURCE, BUILTIN_GEOMETRY_SOURCE);
  appendTextTlv(body, PRESET_SYNC_TLV_FOLDER_PATH, metadata.folderPath);
}

void appendBuiltinTuningBody(std::vector<uint8_t>& body, const BuiltinGeometryMetadata& metadata) {
  const tuningDef& tuning = tuningOptions[metadata.legacyTuningIndex];
  appendCommonGeometryHeader(body, metadata);
  appendU8Tlv(body, PRESET_SYNC_TLV_TUNING_KIND, PRESET_SYNC_USER_TUNING_KIND_EQUAL_STEP);
  appendU16Tlv(body, PRESET_SYNC_TLV_TUNING_EDO_DIVISIONS, tuning.cycleLength);
  uint32_t stepMilliCents = static_cast<uint32_t>(std::lround(tuning.stepSize * 1000.0f));
  appendU32Tlv(body, PRESET_SYNC_TLV_TUNING_PERIOD_MILLI_CENTS, stepMilliCents * tuning.cycleLength);
  appendU32Tlv(body, PRESET_SYNC_TLV_TUNING_STEP_MILLI_CENTS, stepMilliCents);
  appendU8Tlv(body, PRESET_SYNC_TLV_TUNING_REFERENCE_MIDI_NOTE, 69);
  appendU32Tlv(body, PRESET_SYNC_TLV_TUNING_REFERENCE_MILLI_HZ, 440000);

  std::vector<uint8_t> labels;
  labels.reserve(static_cast<size_t>(tuning.cycleLength) * 5);
  for (uint8_t i = 0; i < tuning.cycleLength; ++i) {
    const char* label = tuning.keyChoices[i].name ? tuning.keyChoices[i].name : "";
    size_t length = std::min<size_t>(strlen(label), 255);
    labels.push_back(static_cast<uint8_t>(length));
    labels.insert(labels.end(), label, label + length);
  }
  if (!labels.empty()) {
    presetSyncAppendTlv(body, PRESET_SYNC_TLV_TUNING_KEY_LABELS, labels.data(), static_cast<uint16_t>(labels.size()));
  }
}

void appendBuiltinLayoutBody(std::vector<uint8_t>& body, const BuiltinGeometryMetadata& metadata) {
  const layoutDef& layout = layoutOptions[metadata.legacyOptionIndex];
  BuiltinGeometryMetadata tuningMetadata;
  uint16_t tuningHandle = 0;
  builtinGeometryHandleForLegacyTuning(layout.tuning, tuningHandle);
  builtinGeometryMetadataByHandle(tuningHandle, tuningMetadata);

  appendCommonGeometryHeader(body, metadata);
  appendU8Tlv(body, PRESET_SYNC_TLV_LAYOUT_KIND, 1);
  appendObjectReferenceTlv(body,
                           PRESET_SYNC_TLV_LAYOUT_TUNING_REF,
                           PRESET_SYNC_OBJECT_TYPE_USER_TUNING,
                           tuningHandle,
                           tuningMetadata.objectId);
  appendU16Tlv(body, PRESET_SYNC_TLV_LAYOUT_CENTER_BUTTON, layout.hexMiddleC);
  appendI16Tlv(body, PRESET_SYNC_TLV_LAYOUT_ACROSS_STEPS, layout.acrossSteps);
  appendI16Tlv(body, PRESET_SYNC_TLV_LAYOUT_DOWN_LEFT_STEPS, layout.dnLeftSteps);
  appendU8Tlv(body, PRESET_SYNC_TLV_LAYOUT_PORTRAIT, layout.isPortrait ? 1 : 0);
}

void appendPatternDegrees(std::vector<uint8_t>& output, const uint8_t* pattern, uint16_t cycleLength) {
  uint16_t degree = 0;
  output.push_back(0);
  output.push_back(0);
  for (uint16_t i = 0; i < MAX_SCALE_DIVISIONS && pattern[i] != 0; ++i) {
    degree = static_cast<uint16_t>(degree + pattern[i]);
    if (degree >= cycleLength) {
      break;
    }
    output.push_back(static_cast<uint8_t>(degree & 0xFF));
    output.push_back(static_cast<uint8_t>((degree >> 8) & 0xFF));
  }
}

void appendAllDegrees(std::vector<uint8_t>& output, uint16_t cycleLength) {
  for (uint16_t degree = 0; degree < cycleLength; ++degree) {
    output.push_back(static_cast<uint8_t>(degree & 0xFF));
    output.push_back(static_cast<uint8_t>((degree >> 8) & 0xFF));
  }
}

void appendBuiltinScaleBody(std::vector<uint8_t>& body, const BuiltinGeometryMetadata& metadata) {
  BuiltinGeometryMetadata tuningMetadata;
  uint16_t tuningHandle = 0;
  builtinGeometryHandleForLegacyTuning(metadata.legacyTuningIndex, tuningHandle);
  builtinGeometryMetadataByHandle(tuningHandle, tuningMetadata);
  uint16_t cycleLength = tuningOptions[metadata.legacyTuningIndex].cycleLength;

  appendCommonGeometryHeader(body, metadata);
  appendObjectReferenceTlv(body,
                           PRESET_SYNC_TLV_USER_SCALE_TUNING_REF,
                           PRESET_SYNC_OBJECT_TYPE_USER_TUNING,
                           tuningHandle,
                           tuningMetadata.objectId);
  appendU16Tlv(body, PRESET_SYNC_TLV_USER_SCALE_CYCLE_LENGTH, cycleLength);
  appendU16Tlv(body, PRESET_SYNC_TLV_USER_SCALE_ROOT_DEGREE, 0);

  std::vector<uint8_t> includedDegrees;
  includedDegrees.reserve(static_cast<size_t>(cycleLength) * 2);
  if (metadata.legacyOptionIndex == 0) {
    appendAllDegrees(includedDegrees, cycleLength);
  } else {
    appendPatternDegrees(includedDegrees, scaleOptions[metadata.legacyOptionIndex].pattern, cycleLength);
  }
  presetSyncAppendTlv(body,
                      PRESET_SYNC_TLV_USER_SCALE_INCLUDED_DEGREES,
                      includedDegrees.data(),
                      static_cast<uint16_t>(includedDegrees.size()));
}

bool metadataForScaleOrdinal(size_t scaleOrdinal, BuiltinGeometryMetadata& metadata) {
  if (scaleOrdinal < TUNINGCOUNT) {
    metadata.objectType = PRESET_SYNC_OBJECT_TYPE_USER_SCALE;
    metadata.legacyTuningIndex = static_cast<uint8_t>(scaleOrdinal);
    metadata.legacyOptionIndex = 0;
    metadata.name = scaleOptions[0].name;
    return true;
  }

  size_t scaleIndex = scaleOrdinal - TUNINGCOUNT + 1;
  if (scaleIndex >= scaleCount) {
    return false;
  }
  metadata.objectType = PRESET_SYNC_OBJECT_TYPE_USER_SCALE;
  metadata.legacyTuningIndex = scaleOptions[scaleIndex].tuning;
  metadata.legacyOptionIndex = static_cast<uint16_t>(scaleIndex);
  metadata.name = scaleOptions[scaleIndex].name;
  return metadata.legacyTuningIndex < TUNINGCOUNT;
}

} // namespace

size_t builtinGeometryObjectCount() {
  return static_cast<size_t>(TUNINGCOUNT) + layoutCount + builtinScaleObjectCount();
}

bool isBuiltinGeometryHandle(uint16_t handle) {
  return handle >= BUILTIN_GEOMETRY_HANDLE_BASE
         && static_cast<size_t>(handle - BUILTIN_GEOMETRY_HANDLE_BASE) < builtinGeometryObjectCount();
}

bool builtinGeometryMetadataByOrdinal(size_t ordinal, BuiltinGeometryMetadata& metadata) {
  if (ordinal >= builtinGeometryObjectCount()) {
    return false;
  }
  metadata = BuiltinGeometryMetadata{};
  metadata.handle = static_cast<uint16_t>(BUILTIN_GEOMETRY_HANDLE_BASE + ordinal);
  metadata.folderPath = BUILTIN_GEOMETRY_FOLDER;

  if (ordinal < TUNINGCOUNT) {
    metadata.objectType = PRESET_SYNC_OBJECT_TYPE_USER_TUNING;
    metadata.legacyTuningIndex = static_cast<uint8_t>(ordinal);
    metadata.legacyOptionIndex = static_cast<uint16_t>(ordinal);
    metadata.name = tuningOptions[ordinal].name;
  } else if (ordinal < scaleOrdinalBase()) {
    size_t layoutIndex = ordinal - layoutOrdinalBase();
    metadata.objectType = PRESET_SYNC_OBJECT_TYPE_USER_LAYOUT;
    metadata.legacyTuningIndex = layoutOptions[layoutIndex].tuning;
    metadata.legacyOptionIndex = static_cast<uint16_t>(layoutIndex);
    metadata.name = layoutOptions[layoutIndex].name;
  } else if (!metadataForScaleOrdinal(ordinal - scaleOrdinalBase(), metadata)) {
    return false;
  }

  fillBuiltinObjectId(metadata.objectType,
                      metadata.legacyTuningIndex,
                      metadata.legacyOptionIndex,
                      metadata.name,
                      metadata.objectId);
  return true;
}

bool builtinGeometryMetadataByHandle(uint16_t handle, BuiltinGeometryMetadata& metadata) {
  if (!isBuiltinGeometryHandle(handle)) {
    return false;
  }
  return builtinGeometryMetadataByOrdinal(handle - BUILTIN_GEOMETRY_HANDLE_BASE, metadata);
}

bool buildBuiltinGeometryObject(uint16_t handle, GeometryObjectSlot& object) {
  BuiltinGeometryMetadata metadata;
  if (!builtinGeometryMetadataByHandle(handle, metadata)) {
    return false;
  }

  std::vector<uint8_t> body;
  switch (metadata.objectType) {
    case PRESET_SYNC_OBJECT_TYPE_USER_TUNING:
      appendBuiltinTuningBody(body, metadata);
      break;
    case PRESET_SYNC_OBJECT_TYPE_USER_LAYOUT:
      appendBuiltinLayoutBody(body, metadata);
      break;
    case PRESET_SYNC_OBJECT_TYPE_USER_SCALE:
      appendBuiltinScaleBody(body, metadata);
      break;
    default:
      return false;
  }

  object = GeometryObjectSlot{};
  object.valid = 1;
  object.objectType = metadata.objectType;
  object.schemaMajor = 1;
  object.schemaMinor = 0;
  memcpy(object.objectId, metadata.objectId, sizeof(object.objectId));
  snprintf(object.name, sizeof(object.name), "%s", metadata.name);
  snprintf(object.folderPath, sizeof(object.folderPath), "%s", metadata.folderPath);
  object.body = std::move(body);
  return true;
}

bool builtinGeometryHandleForLegacyTuning(uint8_t tuningIndex, uint16_t& handle) {
  if (tuningIndex >= TUNINGCOUNT) {
    return false;
  }
  handle = static_cast<uint16_t>(BUILTIN_GEOMETRY_HANDLE_BASE + tuningIndex);
  return true;
}

bool builtinGeometryHandleForLegacyLayout(uint16_t layoutIndex, uint16_t& handle) {
  if (layoutIndex >= layoutCount) {
    return false;
  }
  handle = static_cast<uint16_t>(BUILTIN_GEOMETRY_HANDLE_BASE + layoutOrdinalBase() + layoutIndex);
  return true;
}

bool builtinGeometryHandleForLegacyScale(uint8_t tuningIndex, uint16_t scaleIndex, uint16_t& handle) {
  if (tuningIndex >= TUNINGCOUNT || scaleIndex >= scaleCount) {
    return false;
  }
  if (scaleIndex == 0) {
    handle = static_cast<uint16_t>(BUILTIN_GEOMETRY_HANDLE_BASE + scaleOrdinalBase() + tuningIndex);
    return true;
  }
  if (scaleOptions[scaleIndex].tuning != tuningIndex) {
    return false;
  }
  handle = static_cast<uint16_t>(BUILTIN_GEOMETRY_HANDLE_BASE + scaleOrdinalBase() + TUNINGCOUNT + (scaleIndex - 1));
  return true;
}

bool builtinGeometrySelectionForHandle(uint16_t handle,
                                       uint8_t& objectType,
                                       uint8_t& tuningIndex,
                                       uint16_t& optionIndex) {
  BuiltinGeometryMetadata metadata;
  if (!builtinGeometryMetadataByHandle(handle, metadata)) {
    return false;
  }
  objectType = metadata.objectType;
  tuningIndex = metadata.legacyTuningIndex;
  optionIndex = metadata.legacyOptionIndex;
  return true;
}
