#include "../FirmwareModule.h"
#include "../app/DiagnosticsTiming.h"
#include "../app/RuntimeDefaults.h"
#include "../hardware/GridState.h"
#include "../hardware/LedRender.h"
#include "../model/PitchAssignment.h"
#include "../model/ScalePalettePreset.h"
#include "BuiltinGeometry.h"
#include "PresetSync.h"
#include "Settings.h"
#include "SynthPresetStorage.h"

bool isPresetSyncGeometryObjectType(uint8_t objectType);
void load_geometry_objects();

namespace {

char userGeometryRuntimeTuningNameStorage[GEOMETRY_OBJECT_NAME_LENGTH] = "User Tuning";
char userGeometryRuntimeLayoutNameStorage[GEOMETRY_OBJECT_NAME_LENGTH] = "User Layout";
char userGeometryRuntimeScaleNameStorage[GEOMETRY_OBJECT_NAME_LENGTH] = "User Scale";
constexpr char GEOMETRY_OBJECT_CATALOG_FILE_PATH[] = "/layouts.dat";
constexpr char GEOMETRY_OBJECT_CATALOG_TEMP_FILE_PATH[] = "/layouts.tmp";
GeometryObjectSlot pendingGeometrySaveObject;
bool pendingGeometrySaveObjectValid = false;

void copyRuntimeGeometryName(char* storage, size_t storageLength, const char* name) {
  snprintf(storage, storageLength, "%s", name && name[0] ? name : "Geometry");
}

void copyGeometryIndexEntryFromObject(GeometryObjectIndexEntry& entry,
                                      const GeometryObjectSlot& object,
                                      uint32_t storageOffset = 0,
                                      uint32_t bodyLength = 0) {
  entry.valid = object.valid;
  entry.objectType = object.objectType;
  entry.schemaMajor = object.schemaMajor;
  entry.schemaMinor = object.schemaMinor;
  memcpy(entry.objectId, object.objectId, sizeof(entry.objectId));
  snprintf(entry.name, sizeof(entry.name), "%s", object.name);
  snprintf(entry.folderPath, sizeof(entry.folderPath), "%s", object.folderPath);
  entry.storageOffset = storageOffset;
  entry.bodyLength = bodyLength;
}

bool geometryIndexEntryMatchesObject(const GeometryObjectIndexEntry& entry, const GeometryObjectSlot& object) {
  return entry.valid
         && object.valid
         && entry.objectType == object.objectType
         && memcmp(entry.objectId, object.objectId, sizeof(entry.objectId)) == 0;
}

bool writeGeometryBytes(File& f, const uint8_t* data, size_t length, uint32_t& crc) {
  if (length == 0) {
    return true;
  }
  if (f.write(data, length) != length) {
    return false;
  }
  crc = crc32Update(crc, data, length);
  return true;
}

bool writeGeometryByte(File& f, uint8_t value, uint32_t& crc) {
  return writeGeometryBytes(f, &value, 1, crc);
}

bool writeGeometryU32(File& f, uint32_t value, uint32_t& crc) {
  uint8_t bytes[4] = {
    static_cast<uint8_t>(value & 0xFF),
    static_cast<uint8_t>((value >> 8) & 0xFF),
    static_cast<uint8_t>((value >> 16) & 0xFF),
    static_cast<uint8_t>((value >> 24) & 0xFF)
  };
  return writeGeometryBytes(f, bytes, sizeof(bytes), crc);
}

bool readGeometryObjectBody(const GeometryObjectIndexEntry& entry, std::vector<uint8_t>& body) {
  body.clear();
  if (!fileSystemExists || !entry.valid || entry.bodyLength == 0 || entry.bodyLength > GEOMETRY_OBJECT_MAX_RAW_BYTES) {
    return false;
  }
  File f = LittleFS.open(GEOMETRY_OBJECT_CATALOG_FILE_PATH, "r");
  if (!f || !f.seek(entry.storageOffset)) {
    if (f) {
      f.close();
    }
    return false;
  }
  body.assign(entry.bodyLength, 0);
  size_t bytesRead = f.read(body.data(), body.size());
  f.close();
  if (bytesRead != body.size()) {
    body.clear();
    return false;
  }
  return true;
}

bool writeGeometryObjectRecord(File& f, const GeometryObjectSlot& object, uint32_t& crc) {
  if (!object.valid || !isPresetSyncGeometryObjectType(object.objectType) || object.body.empty()) {
    return true;
  }
  size_t nameLength = std::min<size_t>(boundedCStringLength(object.name, sizeof(object.name)), 255);
  size_t folderLength = std::min<size_t>(boundedCStringLength(object.folderPath, sizeof(object.folderPath)), 255);
  return writeGeometryByte(f, object.objectType, crc)
         && writeGeometryByte(f, object.schemaMajor, crc)
         && writeGeometryByte(f, object.schemaMinor, crc)
         && writeGeometryByte(f, 0, crc)
         && writeGeometryBytes(f, object.objectId, sizeof(object.objectId), crc)
         && writeGeometryByte(f, static_cast<uint8_t>(nameLength), crc)
         && writeGeometryBytes(f, reinterpret_cast<const uint8_t*>(object.name), nameLength, crc)
         && writeGeometryByte(f, static_cast<uint8_t>(folderLength), crc)
         && writeGeometryBytes(f, reinterpret_cast<const uint8_t*>(object.folderPath), folderLength, crc)
         && writeGeometryU32(f, static_cast<uint32_t>(object.body.size()), crc)
         && writeGeometryBytes(f, object.body.data(), object.body.size(), crc);
}

} // namespace

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

void save_geometry_objects() {
  if (!fileSystemExists) {
    sendToLog("File system not available.");
    return;
  }
  GeometryObjectFileHeader header = {};
  header.magic[0] = 'L'; header.magic[1] = 'Y'; header.magic[2] = 'T';
  header.version = GEOMETRY_OBJECT_FILE_VERSION;
  header.count = static_cast<uint16_t>(geometryObjects.size());

  LittleFS.remove(GEOMETRY_OBJECT_CATALOG_TEMP_FILE_PATH);
  File f = LittleFS.open(GEOMETRY_OBJECT_CATALOG_TEMP_FILE_PATH, "w");
  if (!f) {
    sendToLog("Error: Unable to open /layouts.tmp for writing.");
    return;
  }
  f.write(reinterpret_cast<uint8_t*>(&header), sizeof(header));

  uint32_t crc = crc32Begin();
  for (size_t i = 0; i < geometryObjects.size(); ++i) {
    GeometryObjectSlot object = {};
    bool usePending = pendingGeometrySaveObjectValid
                      && geometryIndexEntryMatchesObject(geometryObjects[i], pendingGeometrySaveObject);
    if (usePending) {
      object = pendingGeometrySaveObject;
    } else {
      object.valid = geometryObjects[i].valid;
      object.objectType = geometryObjects[i].objectType;
      object.schemaMajor = geometryObjects[i].schemaMajor;
      object.schemaMinor = geometryObjects[i].schemaMinor;
      memcpy(object.objectId, geometryObjects[i].objectId, sizeof(object.objectId));
      snprintf(object.name, sizeof(object.name), "%s", geometryObjects[i].name);
      snprintf(object.folderPath, sizeof(object.folderPath), "%s", geometryObjects[i].folderPath);
      if (!readGeometryObjectBody(geometryObjects[i], object.body)) {
        continue;
      }
    }
    if (!writeGeometryObjectRecord(f, object, crc)) {
      f.close();
      pendingGeometrySaveObjectValid = false;
      LittleFS.remove(GEOMETRY_OBJECT_CATALOG_TEMP_FILE_PATH);
      sendToLog("Error: Incomplete geometry catalog write.");
      return;
    }
  }
  header.crc32 = crc32Finish(crc);
  if (!f.seek(0)
      || f.write(reinterpret_cast<uint8_t*>(&header), sizeof(header)) != sizeof(header)) {
    f.close();
    pendingGeometrySaveObjectValid = false;
    LittleFS.remove(GEOMETRY_OBJECT_CATALOG_TEMP_FILE_PATH);
    sendToLog("Error: Incomplete geometry catalog header write.");
    return;
  }
  f.close();
  pendingGeometrySaveObjectValid = false;
  LittleFS.remove(GEOMETRY_OBJECT_CATALOG_FILE_PATH);
  if (!LittleFS.rename(GEOMETRY_OBJECT_CATALOG_TEMP_FILE_PATH, GEOMETRY_OBJECT_CATALOG_FILE_PATH)) {
    LittleFS.remove(GEOMETRY_OBJECT_CATALOG_TEMP_FILE_PATH);
    sendToLog("Error: Unable to replace /layouts.dat.");
    return;
  }
  load_geometry_objects();
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
  File f = LittleFS.open(GEOMETRY_OBJECT_CATALOG_FILE_PATH, "r");
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
  uint32_t crc = crc32Begin();
  uint8_t crcBuffer[128] = {};
  size_t remaining = dataSize;
  while (remaining > 0) {
    size_t chunkLength = std::min(sizeof(crcBuffer), remaining);
    size_t bytesRead = f.read(crcBuffer, chunkLength);
    if (bytesRead != chunkLength) {
      sendToLog("Warning: Geometry catalog data incomplete. Starting with empty layout objects.");
      geometryObjects.clear();
      f.close();
      return;
    }
    crc = crc32Update(crc, crcBuffer, chunkLength);
    remaining -= chunkLength;
  }
  if (crc32Finish(crc) != header.crc32) {
    sendToLog("Geometry catalog CRC32 mismatch. Starting with empty layout objects.");
    geometryObjects.clear();
    f.close();
    return;
  }

  if (!f.seek(sizeof(header))) {
    f.close();
    return;
  }
  size_t cursor = 0;
  while (cursor < dataSize && geometryObjects.size() < GEOMETRY_OBJECT_MAX_COUNT) {
    if (cursor + 20 > dataSize) {
      sendToLog("Warning: Geometry catalog record truncated.");
      geometryObjects.clear();
      f.close();
      return;
    }
    GeometryObjectIndexEntry object = {};
    object.valid = 1;
    uint8_t fixedHeader[20] = {};
    if (f.read(fixedHeader, sizeof(fixedHeader)) != sizeof(fixedHeader)) {
      sendToLog("Warning: Geometry catalog record truncated.");
      geometryObjects.clear();
      f.close();
      return;
    }
    object.objectType = fixedHeader[0];
    object.schemaMajor = fixedHeader[1];
    object.schemaMinor = fixedHeader[2];
    memcpy(object.objectId, fixedHeader + 4, sizeof(object.objectId));
    cursor += sizeof(fixedHeader);

    uint8_t nameLength = 0;
    if (f.read(&nameLength, 1) != 1) {
      sendToLog("Warning: Geometry catalog name truncated.");
      geometryObjects.clear();
      f.close();
      return;
    }
    ++cursor;
    if (cursor + nameLength > dataSize) {
      sendToLog("Warning: Geometry catalog name truncated.");
      geometryObjects.clear();
      f.close();
      return;
    }
    uint8_t textBuffer[GEOMETRY_OBJECT_NAME_LENGTH] = {};
    size_t nameCopyLength = std::min<size_t>(nameLength, sizeof(textBuffer));
    if (nameCopyLength > 0 && f.read(textBuffer, nameCopyLength) != nameCopyLength) {
      sendToLog("Warning: Geometry catalog name truncated.");
      geometryObjects.clear();
      f.close();
      return;
    }
    copyPresetSyncText(object.name, sizeof(object.name), textBuffer, nameCopyLength);
    if (nameLength > nameCopyLength && !f.seek(f.position() + (nameLength - nameCopyLength))) {
      geometryObjects.clear();
      f.close();
      return;
    }
    cursor += nameLength;

    uint8_t folderLength = 0;
    if (f.read(&folderLength, 1) != 1) {
      sendToLog("Warning: Geometry catalog folder truncated.");
      geometryObjects.clear();
      f.close();
      return;
    }
    ++cursor;
    if (cursor + folderLength > dataSize) {
      sendToLog("Warning: Geometry catalog folder truncated.");
      geometryObjects.clear();
      f.close();
      return;
    }
    uint8_t folderBuffer[GEOMETRY_OBJECT_FOLDER_LENGTH] = {};
    size_t folderCopyLength = std::min<size_t>(folderLength, sizeof(folderBuffer));
    if (folderCopyLength > 0 && f.read(folderBuffer, folderCopyLength) != folderCopyLength) {
      sendToLog("Warning: Geometry catalog folder truncated.");
      geometryObjects.clear();
      f.close();
      return;
    }
    copyPresetSyncText(object.folderPath, sizeof(object.folderPath), folderBuffer, folderCopyLength);
    if (folderLength > folderCopyLength && !f.seek(f.position() + (folderLength - folderCopyLength))) {
      geometryObjects.clear();
      f.close();
      return;
    }
    cursor += folderLength;

    uint8_t bodyLengthBytes[4] = {};
    if (f.read(bodyLengthBytes, sizeof(bodyLengthBytes)) != sizeof(bodyLengthBytes)) {
      sendToLog("Warning: Geometry catalog body truncated.");
      geometryObjects.clear();
      f.close();
      return;
    }
    object.bodyLength = static_cast<uint32_t>(bodyLengthBytes[0])
                        | (static_cast<uint32_t>(bodyLengthBytes[1]) << 8)
                        | (static_cast<uint32_t>(bodyLengthBytes[2]) << 16)
                        | (static_cast<uint32_t>(bodyLengthBytes[3]) << 24);
    cursor += sizeof(bodyLengthBytes);
    if (object.bodyLength == 0
        || object.bodyLength > GEOMETRY_OBJECT_MAX_RAW_BYTES
        || cursor + object.bodyLength > dataSize) {
      sendToLog("Warning: Geometry catalog body truncated.");
      geometryObjects.clear();
      f.close();
      return;
    }
    object.storageOffset = f.position();
    if (!f.seek(object.storageOffset + object.bodyLength)) {
      sendToLog("Warning: Geometry catalog body truncated.");
      geometryObjects.clear();
      f.close();
      return;
    }
    cursor += object.bodyLength;

    if (isPresetSyncGeometryObjectType(object.objectType)) {
      geometryObjects.push_back(object);
    }
  }
  f.close();
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
  if (isBuiltinGeometryHandle(handle)) {
    return -1;
  }
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

bool writeGeometryObjectToCatalogSlot(uint16_t slotIndex, const GeometryObjectSlot& object) {
  if (slotIndex > geometryObjects.size()
      || (slotIndex == geometryObjects.size() && geometryObjects.size() >= GEOMETRY_OBJECT_MAX_COUNT)) {
    sendToLog("Geometry object library is full.");
    return false;
  }
  if (!object.valid || object.body.empty() || object.body.size() > GEOMETRY_OBJECT_MAX_RAW_BYTES) {
    sendToLog("Geometry object write rejected: invalid object body.");
    return false;
  }
  GeometryObjectIndexEntry metadata = {};
  copyGeometryIndexEntryFromObject(metadata, object, 0, static_cast<uint32_t>(object.body.size()));
  if (slotIndex == geometryObjects.size()) {
    if (!geometryObjects.push_back(metadata)) {
      sendToLog("Geometry object library is full.");
      return false;
    }
  } else {
    geometryObjects[slotIndex] = metadata;
  }
  pendingGeometrySaveObject = object;
  pendingGeometrySaveObjectValid = true;
  flashSafeSaveGeometryObjects();
  return true;
}

bool geometryObjectForHandle(uint16_t handle, GeometryObjectSlot& object) {
  if (isBuiltinGeometryHandle(handle)) {
    return buildBuiltinGeometryObject(handle, object);
  }
  if (handle >= geometryObjects.size() || !geometryObjects[handle].valid) {
    return false;
  }
  const GeometryObjectIndexEntry& entry = geometryObjects[handle];
  std::vector<uint8_t> body;
  if (!readGeometryObjectBody(entry, body)) {
    return false;
  }
  GeometryObjectSlot parsed;
  std::string parseError;
  if (!parseGeometryObjectBody(body, parsed, parseError)
      || parsed.objectType != entry.objectType
      || parsed.schemaMajor != entry.schemaMajor
      || parsed.schemaMinor != entry.schemaMinor
      || memcmp(parsed.objectId, entry.objectId, sizeof(entry.objectId)) != 0) {
    sendToLog("Geometry object read rejected: " + parseError);
    return false;
  }
  object = parsed;
  return true;
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

bool readRuntimeCentsTable(const GeometryObjectSlot& object,
                           uint16_t cycleLength,
                           int32_t& periodMilliCents,
                           int32_t* destination) {
  if (cycleLength == 0 || cycleLength > MAX_SCALE_DIVISIONS) {
    return false;
  }

  const uint8_t* centsTable = nullptr;
  uint16_t centsTableLength = 0;
  if (!presetSyncFindTlv(object.body, PRESET_SYNC_TLV_TUNING_CENTS_TABLE, centsTable, centsTableLength)
      || centsTableLength != static_cast<uint16_t>(cycleLength * sizeof(int32_t))) {
    return false;
  }

  uint32_t periodFromTlv = 0;
  bool sawPeriod = presetSyncFindTlvU32LE(object.body, PRESET_SYNC_TLV_TUNING_PERIOD_MILLI_CENTS, periodFromTlv);
  if (sawPeriod && periodFromTlv > static_cast<uint32_t>(std::numeric_limits<int32_t>::max())) {
    return false;
  }

  int32_t previousMilliCents = 0;
  for (uint16_t degree = 0; degree < cycleLength; ++degree) {
    int32_t milliCents = presetSyncReadI32LE(centsTable + (degree * sizeof(int32_t)));
    if (milliCents <= previousMilliCents) {
      return false;
    }
    if (destination) {
      destination[degree] = milliCents;
    }
    previousMilliCents = milliCents;
  }

  periodMilliCents = sawPeriod ? static_cast<int32_t>(periodFromTlv) : previousMilliCents;
  return periodMilliCents > 0 && previousMilliCents == periodMilliCents;
}

bool geometryObjectReferencesObjectId(const GeometryObjectSlot& object, uint8_t tag, uint8_t objectType, const uint8_t* objectId) {
  const uint8_t* value = nullptr;
  uint16_t length = 0;
  if (!object.valid || !objectId || !presetSyncFindTlv(object.body, tag, value, length) || length < 19) {
    return false;
  }
  return value[0] == objectType && memcmp(value + 3, objectId, GEOMETRY_OBJECT_ID_LENGTH) == 0;
}

bool geometryObjectRuntimeTuningSupported(const GeometryObjectSlot& object) {
  uint8_t tuningKind = 0;
  uint16_t cycleLength = 0;
  if (!object.valid
      || object.objectType != PRESET_SYNC_OBJECT_TYPE_USER_TUNING
      || !presetSyncFindTlvU8(object.body, PRESET_SYNC_TLV_TUNING_KIND, tuningKind)
      || !presetSyncFindTlvU16LE(object.body, PRESET_SYNC_TLV_TUNING_EDO_DIVISIONS, cycleLength)) {
    return false;
  }
  if (cycleLength == 0 || cycleLength > MAX_SCALE_DIVISIONS) {
    return false;
  }
  if (tuningKind == PRESET_SYNC_USER_TUNING_KIND_EDO
      || tuningKind == PRESET_SYNC_USER_TUNING_KIND_EQUAL_STEP) {
    return true;
  }
  if (tuningKind == PRESET_SYNC_USER_TUNING_KIND_CENTS_LIST) {
    int32_t periodMilliCents = 0;
    return readRuntimeCentsTable(object, cycleLength, periodMilliCents, nullptr);
  }
  return false;
}

int findFirstGeometryObjectReferencing(uint8_t objectType, uint8_t referenceTag, uint8_t referenceObjectType, const uint8_t* referenceObjectId) {
  for (size_t i = 0; i < builtinGeometryObjectCount(); ++i) {
    BuiltinGeometryMetadata metadata;
    GeometryObjectSlot object;
    if (builtinGeometryMetadataByOrdinal(i, metadata)
        && metadata.objectType == objectType
        && buildBuiltinGeometryObject(metadata.handle, object)
        && geometryObjectReferencesObjectId(object, referenceTag, referenceObjectType, referenceObjectId)) {
      return metadata.handle;
    }
  }

  for (size_t i = 0; i < geometryObjects.size(); ++i) {
    const GeometryObjectIndexEntry& object = geometryObjects[i];
    GeometryObjectSlot fullObject;
    if (object.valid
        && object.objectType == objectType
        && geometryObjectForHandle(static_cast<uint16_t>(i), fullObject)
        && geometryObjectReferencesObjectId(fullObject, referenceTag, referenceObjectType, referenceObjectId)) {
      return static_cast<int>(i);
    }
  }
  return -1;
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
  userGeometryRuntimeTuningObjectSelected = false;
  userGeometryRuntimeLayoutObjectSelected = false;
  memset(userGeometryRuntimeTuningObjectId, 0, sizeof(userGeometryRuntimeTuningObjectId));
  memset(userGeometryRuntimeLayoutObjectId, 0, sizeof(userGeometryRuntimeLayoutObjectId));
  userGeometryRuntimeCentsTableActive = false;
  userGeometryRuntimeCentsTableLength = 0;
  memset(userGeometryRuntimeCentsTableMilliCents, 0, sizeof(userGeometryRuntimeCentsTableMilliCents));
  userGeometryRuntimePeriodMilliCents = 1200000;
  userGeometryRuntimeReferenceMidiNote = 69;
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
  uint8_t referenceMidiNote = 69;
  uint32_t referenceMilliHz = 440000;
  if (!presetSyncFindTlvU8(object.body, PRESET_SYNC_TLV_TUNING_KIND, tuningKind)
      || !presetSyncFindTlvU16LE(object.body, PRESET_SYNC_TLV_TUNING_EDO_DIVISIONS, cycleLength)) {
    sendToLog("Geometry runtime tuning apply rejected: missing tuning kind or cycle length.");
    return false;
  }
  if (tuningKind != PRESET_SYNC_USER_TUNING_KIND_EDO
      && tuningKind != PRESET_SYNC_USER_TUNING_KIND_CENTS_LIST
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
  presetSyncFindTlvU8(object.body, PRESET_SYNC_TLV_TUNING_REFERENCE_MIDI_NOTE, referenceMidiNote);
  presetSyncFindTlvU32LE(object.body, PRESET_SYNC_TLV_TUNING_REFERENCE_MILLI_HZ, referenceMilliHz);
  if (referenceMidiNote > 127) {
    sendToLog("Geometry runtime tuning apply rejected: reference MIDI note is invalid.");
    return false;
  }
  if (referenceMilliHz == 0 || periodMilliCents == 0
      || periodMilliCents > static_cast<uint32_t>(std::numeric_limits<int32_t>::max())) {
    sendToLog("Geometry runtime tuning apply rejected: period or reference Hz is invalid.");
    return false;
  }

  bool centsTableActive = false;
  int32_t centsTablePeriod = static_cast<int32_t>(periodMilliCents);
  int32_t parsedCentsTable[MAX_SCALE_DIVISIONS] = {};
  if (tuningKind == PRESET_SYNC_USER_TUNING_KIND_CENTS_LIST) {
    if (!readRuntimeCentsTable(object, cycleLength, centsTablePeriod, parsedCentsTable)) {
      sendToLog("Geometry runtime tuning apply rejected: cents table is invalid.");
      return false;
    }
    periodMilliCents = static_cast<uint32_t>(centsTablePeriod);
    stepMilliCents = periodMilliCents / cycleLength;
    centsTableActive = true;
  } else {
    if (stepMilliCents == 0) {
      stepMilliCents = periodMilliCents / cycleLength;
    }
    if (stepMilliCents == 0) {
      sendToLog("Geometry runtime tuning apply rejected: step size is invalid.");
      return false;
    }
  }

  copyRuntimeGeometryName(userGeometryRuntimeTuningNameStorage, sizeof(userGeometryRuntimeTuningNameStorage), object.name);
  userGeometryRuntimeTuning.name = userGeometryRuntimeTuningNameStorage;
  userGeometryRuntimeTuning.cycleLength = static_cast<byte>(cycleLength);
  userGeometryRuntimeTuning.stepSize = static_cast<float>(stepMilliCents) / 1000.0f;
  memcpy(userGeometryRuntimeTuningObjectId, object.objectId, sizeof(userGeometryRuntimeTuningObjectId));
  userGeometryRuntimeTuningObjectSelected = true;
  userGeometryRuntimeLayoutObjectSelected = false;
  userGeometryRuntimeCentsTableActive = centsTableActive;
  userGeometryRuntimeCentsTableLength = centsTableActive ? cycleLength : 0;
  memset(userGeometryRuntimeCentsTableMilliCents, 0, sizeof(userGeometryRuntimeCentsTableMilliCents));
  if (centsTableActive) {
    memcpy(userGeometryRuntimeCentsTableMilliCents, parsedCentsTable, cycleLength * sizeof(parsedCentsTable[0]));
  }
  userGeometryRuntimePeriodMilliCents = static_cast<int32_t>(periodMilliCents);
  userGeometryRuntimeReferenceMidiNote = referenceMidiNote;
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

  copyRuntimeGeometryName(userGeometryRuntimeLayoutNameStorage, sizeof(userGeometryRuntimeLayoutNameStorage), object.name);
  userGeometryRuntimeLayout.name = userGeometryRuntimeLayoutNameStorage;
  userGeometryRuntimeLayout.isPortrait = portrait != 0;
  userGeometryRuntimeLayout.hexMiddleC = static_cast<byte>(centerButton);
  userGeometryRuntimeLayout.acrossSteps = static_cast<int8_t>(acrossSteps);
  userGeometryRuntimeLayout.dnLeftSteps = static_cast<int8_t>(downLeftSteps);
  userGeometryRuntimeLayout.tuning = current.tuningIndex;
  memcpy(userGeometryRuntimeLayoutObjectId, object.objectId, sizeof(userGeometryRuntimeLayoutObjectId));
  userGeometryRuntimeLayoutObjectSelected = true;
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

  copyRuntimeGeometryName(userGeometryRuntimeScaleNameStorage, sizeof(userGeometryRuntimeScaleNameStorage), object.name);
  userGeometryRuntimeScale.name = userGeometryRuntimeScaleNameStorage;
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
  uint8_t defaultColorMode = CUSTOM_COLOR_MODE;
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
  presetSyncFindTlvU8(object.body, PRESET_SYNC_TLV_SCALE_COLOR_DEFAULT_COLOR_MODE, defaultColorMode);
  if (defaultColorMode > DIATONIC_COLOR_MODE) {
    defaultColorMode = CUSTOM_COLOR_MODE;
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
  colorMode = defaultColorMode;
  settings[static_cast<uint8_t>(SettingKey::ColorMode)] = colorMode;
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

bool loadUserGeometryBundleFromTuningSlot(uint16_t tuningIndex) {
  GeometryObjectSlot tuningObject;
  if (!geometryObjectForHandle(tuningIndex, tuningObject)) {
    sendToLog("User geometry menu load rejected: tuning handle is out of range.");
    return false;
  }
  if (!geometryObjectRuntimeTuningSupported(tuningObject)) {
    sendToLog("User geometry menu load rejected: tuning is not runtime-compatible.");
    return false;
  }

  clearUserGeometryRuntimeSelection();
  userGeometryRuntimeLayout = { "User Layout", false, 65, 1, -2, TUNING_12EDO };
  userGeometryRuntimeScale = { "User Scale", TUNING_12EDO, { 0 } };
  if (!applyUserGeometryRuntimeTuning(tuningObject)) {
    return false;
  }

  int layoutIndex = findFirstGeometryObjectReferencing(
    PRESET_SYNC_OBJECT_TYPE_USER_LAYOUT,
    PRESET_SYNC_TLV_LAYOUT_TUNING_REF,
    PRESET_SYNC_OBJECT_TYPE_USER_TUNING,
    tuningObject.objectId
  );
  GeometryObjectSlot layoutObject;
  bool sawLayoutObject = false;
  if (layoutIndex >= 0) {
    sawLayoutObject = geometryObjectForHandle(static_cast<uint16_t>(layoutIndex), layoutObject);
    if (!sawLayoutObject || !applyUserGeometryRuntimeLayout(layoutObject)) {
      return false;
    }
  }

  int scaleIndex = findFirstGeometryObjectReferencing(
    PRESET_SYNC_OBJECT_TYPE_USER_SCALE,
    PRESET_SYNC_TLV_USER_SCALE_TUNING_REF,
    PRESET_SYNC_OBJECT_TYPE_USER_TUNING,
    tuningObject.objectId
  );
  if (scaleIndex >= 0) {
    GeometryObjectSlot scaleObject;
    if (!geometryObjectForHandle(static_cast<uint16_t>(scaleIndex), scaleObject)
        || !applyUserGeometryRuntimeScale(scaleObject)) {
      return false;
    }
  }

  int colorMapIndex = findFirstGeometryObjectReferencing(
    PRESET_SYNC_OBJECT_TYPE_SCALE_COLOR_MAP,
    PRESET_SYNC_TLV_SCALE_COLOR_TUNING_REF,
    PRESET_SYNC_OBJECT_TYPE_USER_TUNING,
    tuningObject.objectId
  );
  if (colorMapIndex >= 0) {
    GeometryObjectSlot colorMapObject;
    if (!geometryObjectForHandle(static_cast<uint16_t>(colorMapIndex), colorMapObject)
        || !applyUserGeometryRuntimeColorMap(colorMapObject)) {
      return false;
    }
  }

  int buttonMapIndex = -1;
  if (sawLayoutObject) {
    buttonMapIndex = findFirstGeometryObjectReferencing(
      PRESET_SYNC_OBJECT_TYPE_EXPLICIT_BUTTON_MAP,
      PRESET_SYNC_TLV_BUTTON_MAP_LAYOUT_REF,
      PRESET_SYNC_OBJECT_TYPE_USER_LAYOUT,
      layoutObject.objectId
    );
  }
  if (buttonMapIndex < 0) {
    buttonMapIndex = findFirstGeometryObjectReferencing(
      PRESET_SYNC_OBJECT_TYPE_EXPLICIT_BUTTON_MAP,
      PRESET_SYNC_TLV_BUTTON_MAP_TUNING_REF,
      PRESET_SYNC_OBJECT_TYPE_USER_TUNING,
      tuningObject.objectId
    );
  }
  if (buttonMapIndex >= 0) {
    GeometryObjectSlot buttonMapObject;
    if (!geometryObjectForHandle(static_cast<uint16_t>(buttonMapIndex), buttonMapObject)
        || !applyUserGeometryRuntimeExplicitButtonMap(buttonMapObject)) {
      return false;
    }
  }

  sendToLog("Loaded user geometry " + std::string(tuningObject.name) + " from menu.");
  return true;
}
