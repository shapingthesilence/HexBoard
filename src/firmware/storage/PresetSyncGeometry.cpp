#include "../FirmwareModule.h"
#include "../app/DiagnosticsTiming.h"
#include "../hardware/GridState.h"
#include "../hardware/LedRender.h"
#include "../model/PitchAssignment.h"
#include "../model/ScalePalettePreset.h"
#include "PresetSync.h"
#include "Settings.h"
#include "SynthPresetStorage.h"

bool isPresetSyncGeometryObjectType(uint8_t objectType) {
  switch (objectType) {
    case PRESET_SYNC_OBJECT_TYPE_USER_TUNING:
    case PRESET_SYNC_OBJECT_TYPE_USER_LAYOUT:
    case PRESET_SYNC_OBJECT_TYPE_SCALE_COLOR_MAP:
    case PRESET_SYNC_OBJECT_TYPE_EXPLICIT_BUTTON_MAP:
    case PRESET_SYNC_OBJECT_TYPE_USER_SCALE:
      return true;
    default:
      return false;
  }
}

bool isPresetSyncSupportedObjectType(uint8_t objectType) {
  return objectType == PRESET_SYNC_OBJECT_TYPE_SYNTH_PRESET
         || objectType == PRESET_SYNC_OBJECT_TYPE_SYNTH_WAVETABLE
         || isPresetSyncGeometryObjectType(objectType);
}

void geometryCatalogAppendU32(std::vector<uint8_t>& output, uint32_t value) {
  output.push_back(value & 0xFF);
  output.push_back((value >> 8) & 0xFF);
  output.push_back((value >> 16) & 0xFF);
  output.push_back((value >> 24) & 0xFF);
}

bool geometryCatalogReadU32(const std::vector<uint8_t>& input, size_t& cursor, uint32_t& value) {
  if (cursor + 4 > input.size()) {
    return false;
  }
  value = static_cast<uint32_t>(input[cursor])
          | (static_cast<uint32_t>(input[cursor + 1]) << 8)
          | (static_cast<uint32_t>(input[cursor + 2]) << 16)
          | (static_cast<uint32_t>(input[cursor + 3]) << 24);
  cursor += 4;
  return true;
}

std::vector<uint8_t> serializeGeometryObjectsForStorage() {
  std::vector<uint8_t> data;
  for (const GeometryObjectSlot& object : geometryObjects) {
    if (!object.valid || !isPresetSyncGeometryObjectType(object.objectType) || object.body.empty()) {
      continue;
    }
    data.push_back(object.objectType);
    data.push_back(object.schemaMajor);
    data.push_back(object.schemaMinor);
    data.push_back(0);
    data.insert(data.end(), object.objectId, object.objectId + sizeof(object.objectId));
    size_t nameLength = std::min<size_t>(boundedCStringLength(object.name, sizeof(object.name)), 255);
    size_t folderLength = std::min<size_t>(boundedCStringLength(object.folderPath, sizeof(object.folderPath)), 255);
    data.push_back(nameLength);
    data.insert(data.end(), object.name, object.name + nameLength);
    data.push_back(folderLength);
    data.insert(data.end(), object.folderPath, object.folderPath + folderLength);
    geometryCatalogAppendU32(data, static_cast<uint32_t>(object.body.size()));
    data.insert(data.end(), object.body.begin(), object.body.end());
  }
  return data;
}

void save_geometry_objects() {
  if (!fileSystemExists) {
    sendToLog("File system not available.");
    return;
  }
  if (geometryObjects.size() > GEOMETRY_OBJECT_MAX_COUNT) {
    geometryObjects.resize(GEOMETRY_OBJECT_MAX_COUNT);
  }

  std::vector<uint8_t> data = serializeGeometryObjectsForStorage();
  GeometryObjectFileHeader header = {};
  header.magic[0] = 'L'; header.magic[1] = 'Y'; header.magic[2] = 'T';
  header.version = GEOMETRY_OBJECT_FILE_VERSION;
  header.count = static_cast<uint16_t>(geometryObjects.size());
  header.crc32 = data.empty() ? 0 : crc32(data.data(), data.size());

  File f = LittleFS.open("/layouts.dat", "w");
  if (!f) {
    sendToLog("Error: Unable to open /layouts.dat for writing.");
    return;
  }
  f.write(reinterpret_cast<uint8_t*>(&header), sizeof(header));
  if (!data.empty()) {
    f.write(data.data(), data.size());
  }
  f.close();
  sendToLog("Geometry objects saved (" + std::to_string(geometryObjects.size()) + ").");
}

void flashSafeSaveGeometryObjects() {
  flashSafeWrite(save_geometry_objects);
}

bool parseGeometryObjectBody(const std::vector<uint8_t>& body, GeometryObjectSlot& object, std::string& error) {
  if (body.size() < 8 || body[0] != 'H' || body[1] != 'B' || body[2] != 'S' || body[3] != '1') {
    error = "bad object magic";
    return false;
  }
  if (!isPresetSyncGeometryObjectType(body[4])) {
    error = "not geometry object";
    return false;
  }
  if (body[5] != 1) {
    error = "unsupported geometry object schema";
    return false;
  }

  GeometryObjectSlot parsed = {};
  parsed.valid = 1;
  parsed.objectType = body[4];
  parsed.schemaMajor = body[5];
  parsed.schemaMinor = body[6];
  parsed.body = body;

  bool sawName = false;
  bool sawObjectId = false;
  size_t cursor = 8;
  while (cursor < body.size()) {
    if (cursor + 3 > body.size()) {
      error = "truncated TLV header";
      return false;
    }
    uint8_t tag = body[cursor++];
    uint16_t length = static_cast<uint16_t>(body[cursor]) | (static_cast<uint16_t>(body[cursor + 1]) << 8);
    cursor += 2;
    if (cursor + length > body.size()) {
      error = "truncated TLV value";
      return false;
    }
    const uint8_t* value = body.data() + cursor;
    switch (tag) {
      case PRESET_SYNC_TLV_NAME:
        copyPresetSyncText(parsed.name, sizeof(parsed.name), value, length);
        sawName = parsed.name[0] != '\0';
        break;
      case PRESET_SYNC_TLV_OBJECT_ID:
        if (length != sizeof(parsed.objectId)) {
          error = "bad object id length";
          return false;
        }
        memcpy(parsed.objectId, value, sizeof(parsed.objectId));
        sawObjectId = true;
        break;
      case PRESET_SYNC_TLV_FOLDER_PATH:
        copyPresetSyncText(parsed.folderPath, sizeof(parsed.folderPath), value, length);
        break;
      default:
        break;
    }
    cursor += length;
  }

  if (!sawName || !sawObjectId) {
    error = "missing required geometry TLV";
    return false;
  }
  object = parsed;
  return true;
}

void load_geometry_objects() {
  geometryObjects.clear();
  if (!fileSystemExists) {
    sendToLog("File system not available. Using empty geometry catalog.");
    return;
  }
  File f = LittleFS.open("/layouts.dat", "r");
  if (!f) {
    sendToLog("Geometry catalog file not found. Starting with empty layout objects.");
    return;
  }
  GeometryObjectFileHeader header = {};
  if (f.readBytes(reinterpret_cast<char*>(&header), sizeof(header)) != sizeof(header)) {
    sendToLog("Error: Failed to read geometry catalog header.");
    f.close();
    return;
  }
  if (strncmp(header.magic, "LYT", 3) != 0 || header.version != GEOMETRY_OBJECT_FILE_VERSION
      || header.count > GEOMETRY_OBJECT_MAX_COUNT) {
    sendToLog("Invalid geometry catalog file. Starting with empty layout objects.");
    f.close();
    return;
  }

  size_t dataSize = f.size() > sizeof(header) ? f.size() - sizeof(header) : 0;
  std::vector<uint8_t> data(dataSize);
  size_t bytesRead = dataSize == 0 ? 0 : f.read(data.data(), data.size());
  f.close();
  if (bytesRead != dataSize) {
    sendToLog("Warning: Geometry catalog data incomplete. Starting with empty layout objects.");
    geometryObjects.clear();
    return;
  }
  uint32_t computed = data.empty() ? 0 : crc32(data.data(), data.size());
  if (computed != header.crc32) {
    sendToLog("Geometry catalog CRC32 mismatch. Starting with empty layout objects.");
    geometryObjects.clear();
    return;
  }

  size_t cursor = 0;
  while (cursor < data.size() && geometryObjects.size() < GEOMETRY_OBJECT_MAX_COUNT) {
    if (cursor + 20 > data.size()) {
      sendToLog("Warning: Geometry catalog record truncated.");
      geometryObjects.clear();
      return;
    }
    GeometryObjectSlot object = {};
    object.valid = 1;
    object.objectType = data[cursor++];
    object.schemaMajor = data[cursor++];
    object.schemaMinor = data[cursor++];
    ++cursor;
    memcpy(object.objectId, data.data() + cursor, sizeof(object.objectId));
    cursor += sizeof(object.objectId);

    uint8_t nameLength = data[cursor++];
    if (cursor + nameLength > data.size()) {
      sendToLog("Warning: Geometry catalog name truncated.");
      geometryObjects.clear();
      return;
    }
    copyPresetSyncText(object.name, sizeof(object.name), data.data() + cursor, nameLength);
    cursor += nameLength;

    uint8_t folderLength = data[cursor++];
    if (cursor + folderLength > data.size()) {
      sendToLog("Warning: Geometry catalog folder truncated.");
      geometryObjects.clear();
      return;
    }
    copyPresetSyncText(object.folderPath, sizeof(object.folderPath), data.data() + cursor, folderLength);
    cursor += folderLength;

    uint32_t bodyLength = 0;
    if (!geometryCatalogReadU32(data, cursor, bodyLength)
        || bodyLength == 0
        || bodyLength > GEOMETRY_OBJECT_MAX_RAW_BYTES
        || cursor + bodyLength > data.size()) {
      sendToLog("Warning: Geometry catalog body truncated.");
      geometryObjects.clear();
      return;
    }
    object.body.assign(data.begin() + cursor, data.begin() + cursor + bodyLength);
    cursor += bodyLength;

    GeometryObjectSlot validated;
    std::string parseError;
    if (parseGeometryObjectBody(object.body, validated, parseError)
        && validated.objectType == object.objectType
        && validated.schemaMajor == object.schemaMajor
        && validated.schemaMinor == object.schemaMinor
        && memcmp(validated.objectId, object.objectId, sizeof(object.objectId)) == 0) {
      geometryObjects.push_back(validated);
    }
  }
  sendToLog("Geometry objects loaded successfully (" + std::to_string(geometryObjects.size()) + ").");
}

int findGeometryObjectByTypeAndObjectId(uint8_t objectType, const uint8_t* objectId) {
  for (size_t i = 0; i < geometryObjects.size(); ++i) {
    if (geometryObjects[i].valid
        && geometryObjects[i].objectType == objectType
        && memcmp(geometryObjects[i].objectId, objectId, GEOMETRY_OBJECT_ID_LENGTH) == 0) {
      return static_cast<int>(i);
    }
  }
  return -1;
}

int chooseGeometryObjectWriteSlot(uint16_t handle, const GeometryObjectSlot& object) {
  if (handle != PRESET_SYNC_NEW_OBJECT_HANDLE
      && handle < geometryObjects.size()
      && geometryObjects[handle].objectType == object.objectType) {
    return handle;
  }
  int existing = findGeometryObjectByTypeAndObjectId(object.objectType, object.objectId);
  if (existing >= 0) {
    return existing;
  }
  if (geometryObjects.size() < GEOMETRY_OBJECT_MAX_COUNT) {
    return static_cast<int>(geometryObjects.size());
  }
  return -1;
}

int userGeometryDefaultSpanCtoA(uint16_t cycleLength) {
  return -static_cast<int>((static_cast<uint32_t>(cycleLength) * 9u + 6u) / 12u);
}

bool presetSyncFindTlv(const std::vector<uint8_t>& body,
                       uint8_t wantedTag,
                       const uint8_t*& value,
                       uint16_t& length) {
  if (body.size() < 8) {
    return false;
  }
  size_t cursor = 8;
  while (cursor < body.size()) {
    if (cursor + 3 > body.size()) {
      return false;
    }
    uint8_t tag = body[cursor++];
    uint16_t tlvLength = presetSyncReadU16LE(body.data() + cursor);
    cursor += 2;
    if (cursor + tlvLength > body.size()) {
      return false;
    }
    if (tag == wantedTag) {
      value = body.data() + cursor;
      length = tlvLength;
      return true;
    }
    cursor += tlvLength;
  }
  return false;
}

bool presetSyncFindTlvU8(const std::vector<uint8_t>& body, uint8_t tag, uint8_t& result) {
  const uint8_t* value = nullptr;
  uint16_t length = 0;
  if (!presetSyncFindTlv(body, tag, value, length) || length != 1) {
    return false;
  }
  result = value[0];
  return true;
}

bool presetSyncFindTlvU16LE(const std::vector<uint8_t>& body, uint8_t tag, uint16_t& result) {
  const uint8_t* value = nullptr;
  uint16_t length = 0;
  if (!presetSyncFindTlv(body, tag, value, length) || length != 2) {
    return false;
  }
  result = presetSyncReadU16LE(value);
  return true;
}

bool presetSyncFindTlvI16LE(const std::vector<uint8_t>& body, uint8_t tag, int16_t& result) {
  const uint8_t* value = nullptr;
  uint16_t length = 0;
  if (!presetSyncFindTlv(body, tag, value, length) || length != 2) {
    return false;
  }
  result = presetSyncReadI16LE(value);
  return true;
}

bool presetSyncFindTlvU32LE(const std::vector<uint8_t>& body, uint8_t tag, uint32_t& result) {
  const uint8_t* value = nullptr;
  uint16_t length = 0;
  if (!presetSyncFindTlv(body, tag, value, length) || length != 4) {
    return false;
  }
  result = presetSyncReadU32LE(value);
  return true;
}

void clearUserGeometryButtonRuntimeOverrides() {
  for (byte i = 0; i < LED_COUNT; ++i) {
    userGeometryRuntimeButtonDisabled[i] = false;
    userGeometryRuntimeButtonRole[i] = PRESET_SYNC_BUTTON_MAP_ROLE_NOTE;
    userGeometryRuntimeButtonRoleOverride[i] = false;
    userGeometryRuntimeButtonNoteOverride[i] = false;
    userGeometryRuntimeButtonColorActive[i] = false;
    userGeometryRuntimeButtonStepsFromC[i] = 0;
    userGeometryRuntimeButtonColor[i] = { HUE_NONE, SAT_BW, VALUE_BLACK };
  }
}

void clearUserGeometryRuntimeSelection() {
  userGeometryRuntimeActive = false;
  userGeometryRuntimeScaleActive = false;
  userGeometryRuntimePaletteActive = false;
  userGeometryRuntimeReferenceHz = 440.0f;
  clearUserGeometryButtonRuntimeOverrides();
}

void setDefaultRuntimeKeyLabels(uint16_t cycleLength) {
  int spanCtoA = userGeometryDefaultSpanCtoA(cycleLength);
  for (uint16_t i = 0; i < MAX_SCALE_DIVISIONS; ++i) {
    snprintf(userGeometryRuntimeKeyLabelStorage[i], sizeof(userGeometryRuntimeKeyLabelStorage[i]), "%u", i);
    userGeometryRuntimeTuning.keyChoices[i].name = userGeometryRuntimeKeyLabelStorage[i];
    userGeometryRuntimeTuning.keyChoices[i].val_int = spanCtoA + static_cast<int>(i);
  }
}

bool applyRuntimeKeyLabels(const uint8_t* value, uint16_t length, uint16_t cycleLength) {
  size_t cursor = 0;
  uint16_t degree = 0;
  while (cursor < length && degree < cycleLength) {
    uint8_t labelLength = value[cursor++];
    if (cursor + labelLength > length) {
      return false;
    }
    copyPresetSyncText(userGeometryRuntimeKeyLabelStorage[degree],
                       sizeof(userGeometryRuntimeKeyLabelStorage[degree]),
                       value + cursor,
                       labelLength);
    cursor += labelLength;
    ++degree;
  }
  return cursor == length;
}

bool applyUserGeometryRuntimeTuning(const GeometryObjectSlot& object) {
  uint8_t tuningKind = 0;
  uint16_t cycleLength = 0;
  uint32_t periodMilliCents = 1200000;
  uint32_t stepMilliCents = 0;
  uint32_t referenceMilliHz = 440000;
  if (!presetSyncFindTlvU8(object.body, PRESET_SYNC_TLV_TUNING_KIND, tuningKind)
      || !presetSyncFindTlvU16LE(object.body, PRESET_SYNC_TLV_TUNING_EDO_DIVISIONS, cycleLength)) {
    sendToLog("Geometry runtime tuning apply rejected: missing tuning kind or cycle length.");
    return false;
  }
  if (tuningKind != PRESET_SYNC_USER_TUNING_KIND_EDO
      && tuningKind != PRESET_SYNC_USER_TUNING_KIND_EQUAL_STEP) {
    sendToLog("Geometry runtime tuning apply rejected: tuning kind needs full firmware tuning support.");
    return false;
  }
  if (cycleLength == 0 || cycleLength > MAX_SCALE_DIVISIONS) {
    sendToLog("Geometry runtime tuning apply rejected: cycle length is out of range.");
    return false;
  }
  presetSyncFindTlvU32LE(object.body, PRESET_SYNC_TLV_TUNING_PERIOD_MILLI_CENTS, periodMilliCents);
  presetSyncFindTlvU32LE(object.body, PRESET_SYNC_TLV_TUNING_STEP_MILLI_CENTS, stepMilliCents);
  presetSyncFindTlvU32LE(object.body, PRESET_SYNC_TLV_TUNING_REFERENCE_MILLI_HZ, referenceMilliHz);
  if (stepMilliCents == 0) {
    stepMilliCents = periodMilliCents / cycleLength;
  }
  if (stepMilliCents == 0 || referenceMilliHz == 0) {
    sendToLog("Geometry runtime tuning apply rejected: step size or reference Hz is invalid.");
    return false;
  }

  userGeometryRuntimeTuning.name = object.name;
  userGeometryRuntimeTuning.cycleLength = static_cast<byte>(cycleLength);
  userGeometryRuntimeTuning.stepSize = static_cast<float>(stepMilliCents) / 1000.0f;
  userGeometryRuntimeReferenceHz = static_cast<float>(referenceMilliHz) / 1000.0f;
  setDefaultRuntimeKeyLabels(cycleLength);

  const uint8_t* keyLabels = nullptr;
  uint16_t keyLabelsLength = 0;
  if (presetSyncFindTlv(object.body, PRESET_SYNC_TLV_TUNING_KEY_LABELS, keyLabels, keyLabelsLength)
      && !applyRuntimeKeyLabels(keyLabels, keyLabelsLength, cycleLength)) {
    sendToLog("Geometry runtime tuning apply rejected: key labels are truncated.");
    return false;
  }

  userGeometryRuntimeActive = true;
  userGeometryRuntimeScaleActive = false;
  userGeometryRuntimePaletteActive = false;
  clearUserGeometryButtonRuntimeOverrides();
  current.keyStepsFromA = userGeometryRuntimeTuning.spanCtoA();
  applyLayout();
  return true;
}

bool applyUserGeometryRuntimeLayout(const GeometryObjectSlot& object) {
  uint8_t layoutKind = 0;
  uint16_t centerButton = 0;
  int16_t acrossSteps = 0;
  int16_t downLeftSteps = 0;
  uint8_t portrait = 0;
  if (!presetSyncFindTlvU8(object.body, PRESET_SYNC_TLV_LAYOUT_KIND, layoutKind)
      || !presetSyncFindTlvU16LE(object.body, PRESET_SYNC_TLV_LAYOUT_CENTER_BUTTON, centerButton)
      || !presetSyncFindTlvI16LE(object.body, PRESET_SYNC_TLV_LAYOUT_ACROSS_STEPS, acrossSteps)
      || !presetSyncFindTlvI16LE(object.body, PRESET_SYNC_TLV_LAYOUT_DOWN_LEFT_STEPS, downLeftSteps)
      || !presetSyncFindTlvU8(object.body, PRESET_SYNC_TLV_LAYOUT_PORTRAIT, portrait)) {
    sendToLog("Geometry runtime layout apply rejected: missing vector layout fields.");
    return false;
  }
  if (layoutKind != 1 || centerButton >= LED_COUNT
      || acrossSteps < -128 || acrossSteps > 127
      || downLeftSteps < -128 || downLeftSteps > 127) {
    sendToLog("Geometry runtime layout apply rejected: vector layout field is out of range.");
    return false;
  }

  userGeometryRuntimeLayout.name = object.name;
  userGeometryRuntimeLayout.isPortrait = portrait != 0;
  userGeometryRuntimeLayout.hexMiddleC = static_cast<byte>(centerButton);
  userGeometryRuntimeLayout.acrossSteps = static_cast<int8_t>(acrossSteps);
  userGeometryRuntimeLayout.dnLeftSteps = static_cast<int8_t>(downLeftSteps);
  userGeometryRuntimeLayout.tuning = current.tuningIndex;
  userGeometryRuntimeActive = true;
  clearUserGeometryButtonRuntimeOverrides();
  applyLayout();
  return true;
}

bool applyUserGeometryRuntimeScale(const GeometryObjectSlot& object) {
  uint16_t cycleLength = 0;
  const uint8_t* includedDegrees = nullptr;
  uint16_t includedLength = 0;
  if (!presetSyncFindTlvU16LE(object.body, PRESET_SYNC_TLV_USER_SCALE_CYCLE_LENGTH, cycleLength)
      || !presetSyncFindTlv(object.body, PRESET_SYNC_TLV_USER_SCALE_INCLUDED_DEGREES, includedDegrees, includedLength)
      || (includedLength % 2) != 0) {
    sendToLog("Geometry runtime scale apply rejected: included degrees are invalid.");
    return false;
  }
  if (cycleLength == 0 || cycleLength > MAX_SCALE_DIVISIONS) {
    sendToLog("Geometry runtime scale apply rejected: cycle length is out of range.");
    return false;
  }

  bool included[MAX_SCALE_DIVISIONS] = {};
  included[0] = true;
  for (uint16_t offset = 0; offset < includedLength; offset += 2) {
    uint16_t degree = presetSyncReadU16LE(includedDegrees + offset);
    included[degree % cycleLength] = true;
  }

  uint8_t degrees[MAX_SCALE_DIVISIONS] = {};
  uint8_t degreeCount = 0;
  for (uint16_t degree = 0; degree < cycleLength; ++degree) {
    if (included[degree]) {
      degrees[degreeCount++] = static_cast<uint8_t>(degree);
    }
  }
  if (degreeCount == 0) {
    sendToLog("Geometry runtime scale apply rejected: no degrees were included.");
    return false;
  }

  userGeometryRuntimeScale.name = object.name;
  userGeometryRuntimeScale.tuning = current.tuningIndex;
  memset(userGeometryRuntimeScale.pattern, 0, sizeof(userGeometryRuntimeScale.pattern));
  for (uint8_t i = 0; i < degreeCount; ++i) {
    uint8_t currentDegree = degrees[i];
    uint8_t nextDegree = (i + 1 < degreeCount) ? degrees[i + 1] : static_cast<uint8_t>(degrees[0] + cycleLength);
    userGeometryRuntimeScale.pattern[i] = nextDegree - currentDegree;
  }
  userGeometryRuntimeScaleActive = true;
  userGeometryRuntimeActive = true;
  applyScale();
  return true;
}

bool applyUserGeometryRuntimeColorMap(const GeometryObjectSlot& object) {
  uint16_t cycleLength = 0;
  const uint8_t* degreeColors = nullptr;
  uint16_t degreeColorLength = 0;
  if (!presetSyncFindTlvU16LE(object.body, PRESET_SYNC_TLV_SCALE_COLOR_CYCLE_LENGTH, cycleLength)
      || !presetSyncFindTlv(object.body, PRESET_SYNC_TLV_SCALE_COLOR_DEGREE_COLORS, degreeColors, degreeColorLength)
      || (degreeColorLength % 6) != 0) {
    sendToLog("Geometry runtime color map apply rejected: degree colors are invalid.");
    return false;
  }
  if (cycleLength == 0 || cycleLength > MAX_SCALE_DIVISIONS) {
    sendToLog("Geometry runtime color map apply rejected: cycle length is out of range.");
    return false;
  }

  for (uint16_t degree = 0; degree < MAX_SCALE_DIVISIONS; ++degree) {
    userGeometryRuntimePalette.swatch[degree] = {
      360.0f * (static_cast<float>(degree % cycleLength) / static_cast<float>(cycleLength)),
      static_cast<byte>(degree == 0 ? SAT_BW : SAT_VIVID),
      static_cast<byte>(degree == 0 ? VALUE_NORMAL : VALUE_SHADE)
    };
    userGeometryRuntimePalette.colorNum[degree] = degree < cycleLength ? static_cast<byte>(degree + 1) : 1;
  }
  for (uint16_t offset = 0; offset < degreeColorLength; offset += 6) {
    uint16_t degree = presetSyncReadU16LE(degreeColors + offset);
    if (degree >= cycleLength) {
      continue;
    }
    uint16_t hueTenthDegrees = presetSyncReadU16LE(degreeColors + offset + 2);
    userGeometryRuntimePalette.swatch[degree] = {
      static_cast<float>(hueTenthDegrees) / 10.0f,
      degreeColors[offset + 4],
      degreeColors[offset + 5]
    };
    userGeometryRuntimePalette.colorNum[degree] = static_cast<byte>(degree + 1);
  }

  userGeometryRuntimePaletteActive = true;
  userGeometryRuntimeActive = true;
  setLEDcolorCodes();
  return true;
}

bool applyUserGeometryRuntimeExplicitButtonMap(const GeometryObjectSlot& object) {
  uint8_t recordFormat = 0;
  const uint8_t* records = nullptr;
  uint16_t recordsLength = 0;
  if (!presetSyncFindTlvU8(object.body, PRESET_SYNC_TLV_BUTTON_MAP_RECORD_FORMAT, recordFormat)
      || !presetSyncFindTlv(object.body, PRESET_SYNC_TLV_BUTTON_MAP_RECORDS, records, recordsLength)
      || recordFormat != 1
      || (recordsLength % PRESET_SYNC_BUTTON_MAP_RECORD_SIZE) != 0) {
    sendToLog("Geometry runtime button map apply rejected: button records are invalid.");
    return false;
  }

  clearUserGeometryButtonRuntimeOverrides();
  for (uint16_t offset = 0; offset < recordsLength; offset += PRESET_SYNC_BUTTON_MAP_RECORD_SIZE) {
    uint16_t buttonIndex = presetSyncReadU16LE(records + offset);
    if (buttonIndex >= LED_COUNT) {
      continue;
    }
    uint8_t role = records[offset + 2];
    if (role > PRESET_SYNC_BUTTON_MAP_ROLE_COMMAND) {
      role = PRESET_SYNC_BUTTON_MAP_ROLE_UNUSED;
    }
    userGeometryRuntimeButtonRoleOverride[buttonIndex] = true;
    userGeometryRuntimeButtonRole[buttonIndex] = role;
    userGeometryRuntimeButtonDisabled[buttonIndex] = role != PRESET_SYNC_BUTTON_MAP_ROLE_NOTE;
    if (role == PRESET_SYNC_BUTTON_MAP_ROLE_NOTE) {
      userGeometryRuntimeButtonNoteOverride[buttonIndex] = true;
      userGeometryRuntimeButtonStepsFromC[buttonIndex] = static_cast<int16_t>(presetSyncReadI32LE(records + offset + 3));
    }
    uint8_t colorMode = records[offset + 8];
    if (colorMode != PRESET_SYNC_BUTTON_MAP_COLOR_NONE) {
      uint16_t hueTenthDegrees = presetSyncReadU16LE(records + offset + 9);
      userGeometryRuntimeButtonColorActive[buttonIndex] = true;
      userGeometryRuntimeButtonColor[buttonIndex] = {
        static_cast<float>(hueTenthDegrees) / 10.0f,
        records[offset + 11],
        records[offset + 12]
      };
    }
  }

  userGeometryRuntimeActive = true;
  applyLayout();
  return true;
}

bool applyGeometryObjectToRuntime(const GeometryObjectSlot& object) {
  switch (object.objectType) {
    case PRESET_SYNC_OBJECT_TYPE_USER_TUNING:
      return applyUserGeometryRuntimeTuning(object);
    case PRESET_SYNC_OBJECT_TYPE_USER_LAYOUT:
      return applyUserGeometryRuntimeLayout(object);
    case PRESET_SYNC_OBJECT_TYPE_USER_SCALE:
      return applyUserGeometryRuntimeScale(object);
    case PRESET_SYNC_OBJECT_TYPE_SCALE_COLOR_MAP:
      return applyUserGeometryRuntimeColorMap(object);
    case PRESET_SYNC_OBJECT_TYPE_EXPLICIT_BUTTON_MAP:
      return applyUserGeometryRuntimeExplicitButtonMap(object);
    default:
      return false;
  }
}
