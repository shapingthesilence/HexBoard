#include "../FirmwareModule.h"
#include "../app/DiagnosticsTiming.h"
#include "../app/RuntimeDefaults.h"
#include "../hardware/GridState.h"
#include "../hardware/LedRender.h"
#include "../model/PitchAssignment.h"
#include "../model/ScalePalettePreset.h"
#include "../midi/NoteDispatch.h"
#include "../menu/MenuAndDisplay.h"
#include "BuiltinGeometry.h"
#include "PresetSync.h"
#include "Settings.h"
#include "SynthPresetStorage.h"

bool isPresetSyncGeometryObjectType(uint8_t objectType);
void load_geometry_objects();
int findGeometryObjectByTypeAndObjectId(uint8_t objectType, const uint8_t* objectId);

namespace {

char userGeometryRuntimeTuningNameStorage[GEOMETRY_OBJECT_NAME_LENGTH] = "User Tuning";
char userGeometryRuntimeLayoutNameStorage[GEOMETRY_OBJECT_NAME_LENGTH] = "User Layout";
char userGeometryRuntimeScaleNameStorage[GEOMETRY_OBJECT_NAME_LENGTH] = "User Scale";

void copyRuntimeGeometryName(char* storage, size_t storageLength, const char* name) {
  snprintf(storage, storageLength, "%s", name && name[0] ? name : "Geometry");
}

bool readGeometryObjectBody(const GeometryObjectIndexEntry& entry, std::vector<uint8_t>& body) {
  body.clear();
  if (!fileSystemExists || !entry.valid || entry.bodyLength == 0 || entry.bodyLength > GEOMETRY_OBJECT_MAX_RAW_BYTES) {
    return false;
  }
  File f = LittleFS.open(entry.storagePath, "r");
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

bool readGeometryText(File& file,
                      uint8_t storedLength,
                      char* destination,
                      size_t destinationLength) {
  if (destinationLength == 0) {
    return false;
  }
  destination[0] = '\0';
  size_t copyLength = std::min<size_t>(storedLength, destinationLength - 1);
  if (copyLength > 0
      && file.read(reinterpret_cast<uint8_t*>(destination), copyLength) != copyLength) {
    return false;
  }
  destination[copyLength] = '\0';
  size_t skippedLength = storedLength - copyLength;
  return skippedLength == 0 || file.seek(file.position() + skippedLength);
}

void clearGeometryCatalogState() {
  geometryBundles.clear();
  geometryCatalogObjectCount = 0;
}

bool pathHasGeometryBundleExtension(const char* path) {
  if (!path) return false;
  size_t length = strlen(path);
  size_t extensionLength = strlen(GEOMETRY_BUNDLE_FILE_EXTENSION);
  return length >= extensionLength
         && strcmp(path + length - extensionLength, GEOMETRY_BUNDLE_FILE_EXTENSION) == 0;
}

bool geometryObjectIdIsEmpty(const uint8_t* objectId) {
  for (size_t i = 0; i < GEOMETRY_OBJECT_ID_LENGTH; ++i) {
    if (objectId[i] != 0) return false;
  }
  return true;
}

bool geometryBundleStoragePath(const uint8_t* tuningObjectId, char* output, size_t outputLength) {
  if (!tuningObjectId || !output || outputLength < 48) return false;
  size_t cursor = snprintf(output, outputLength, "%s/", GEOMETRY_STORAGE_ROOT);
  constexpr char HEX_DIGITS[] = "0123456789ABCDEF";
  for (size_t i = 0; i < GEOMETRY_OBJECT_ID_LENGTH; ++i) {
    output[cursor++] = HEX_DIGITS[tuningObjectId[i] >> 4];
    output[cursor++] = HEX_DIGITS[tuningObjectId[i] & 0x0F];
  }
  snprintf(output + cursor, outputLength - cursor, "%s", GEOMETRY_BUNDLE_FILE_EXTENSION);
  return true;
}

bool readGeometryRecordMetadata(File& file,
                                const char* storagePath,
                                GeometryObjectIndexEntry& object) {
  object = {};
  object.valid = 1;
  object.recordOffset = file.position();
  snprintf(object.storagePath, sizeof(object.storagePath), "%s", storagePath);
  uint8_t fixedHeader[20] = {};
  if (file.read(fixedHeader, sizeof(fixedHeader)) != sizeof(fixedHeader)) return false;
  object.objectType = fixedHeader[0];
  object.schemaMajor = fixedHeader[1];
  object.schemaMinor = fixedHeader[2];
  memcpy(object.objectId, fixedHeader + 4, sizeof(object.objectId));
  if (!isPresetSyncGeometryObjectType(object.objectType)) return false;
  uint8_t nameLength = 0;
  uint8_t folderLength = 0;
  if (file.read(&nameLength, 1) != 1
      || !readGeometryText(file, nameLength, object.name, sizeof(object.name))
      || file.read(&folderLength, 1) != 1
      || !readGeometryText(file, folderLength, object.folderPath, sizeof(object.folderPath))) return false;
  uint8_t lengthBytes[4] = {};
  if (file.read(lengthBytes, sizeof(lengthBytes)) != sizeof(lengthBytes)) return false;
  object.bodyLength = static_cast<uint32_t>(lengthBytes[0])
                      | (static_cast<uint32_t>(lengthBytes[1]) << 8)
                      | (static_cast<uint32_t>(lengthBytes[2]) << 16)
                      | (static_cast<uint32_t>(lengthBytes[3]) << 24);
  object.storageOffset = file.position();
  if (object.bodyLength == 0 || object.bodyLength > GEOMETRY_OBJECT_MAX_RAW_BYTES
      || object.storageOffset + object.bodyLength > file.size()
      || !file.seek(object.storageOffset + object.bodyLength)) return false;
  object.recordLength = file.position() - object.recordOffset;
  return true;
}

bool geometryBundleHeaderValid(const GeometryObjectFileHeader& header) {
  return strncmp(header.magic, "HGB", 3) == 0
         && header.version == GEOMETRY_OBJECT_FILE_VERSION
         && header.count > 0
         && header.count <= GEOMETRY_BUNDLE_RECORD_MAX_COUNT;
}

bool validateGeometryBundleFile(const char* path,
                                GeometryBundleIndexEntry& bundle,
                                bool logFailure) {
  bundle = {};
  File file = LittleFS.open(path, "r");
  if (!file || file.size() < sizeof(GeometryObjectFileHeader)
      || file.size() > GEOMETRY_BUNDLE_MAX_RAW_BYTES) {
    if (file) file.close();
    if (logFailure) sendToLog("Invalid geometry bundle file " + std::string(path) + ": size.");
    return false;
  }
  GeometryObjectFileHeader header = {};
  if (file.read(reinterpret_cast<uint8_t*>(&header), sizeof(header)) != sizeof(header)
      || !geometryBundleHeaderValid(header)) {
    file.close();
    if (logFailure) sendToLog("Invalid geometry bundle file " + std::string(path) + ": header.");
    return false;
  }
  bundle.catalogOrder = header.catalogOrder;
  uint32_t crc = crc32Begin();
  uint8_t buffer[128] = {};
  while (file.available() > 0) {
    size_t chunk = std::min<size_t>(sizeof(buffer), file.available());
    if (file.read(buffer, chunk) != chunk) {
      file.close();
      return false;
    }
    crc = crc32Update(crc, buffer, chunk);
  }
  if (crc32Finish(crc) != header.crc32 || !file.seek(sizeof(header))) {
    file.close();
    if (logFailure) sendToLog("Invalid geometry bundle file " + std::string(path) + ": CRC.");
    return false;
  }
  uint8_t tuningCount = 0;
  uint8_t colorMapCount = 0;
  uint8_t rootTuningObjectId[GEOMETRY_OBJECT_ID_LENGTH] = {};
  std::vector<std::array<uint8_t, GEOMETRY_OBJECT_ID_LENGTH>> objectIds;
  objectIds.reserve(header.count);
  for (uint16_t index = 0; index < header.count; ++index) {
    GeometryObjectIndexEntry metadata;
    if (!readGeometryRecordMetadata(file, path, metadata)
        || geometryObjectIdIsEmpty(metadata.objectId)
        || (index == 0 && metadata.objectType != PRESET_SYNC_OBJECT_TYPE_USER_TUNING)) {
      file.close();
      if (logFailure) sendToLog("Invalid geometry bundle file " + std::string(path) + ": record envelope.");
      return false;
    }
    if (metadata.objectType == PRESET_SYNC_OBJECT_TYPE_USER_TUNING) {
      ++tuningCount;
      memcpy(rootTuningObjectId, metadata.objectId, GEOMETRY_OBJECT_ID_LENGTH);
      memcpy(bundle.tuningObjectId, metadata.objectId, GEOMETRY_OBJECT_ID_LENGTH);
      snprintf(bundle.tuningName, sizeof(bundle.tuningName), "%s", metadata.name);
      snprintf(bundle.folderPath, sizeof(bundle.folderPath), "%s", metadata.folderPath);
    }
    for (const auto& objectId : objectIds) {
      if (memcmp(objectId.data(), metadata.objectId, GEOMETRY_OBJECT_ID_LENGTH) == 0) {
        file.close();
        if (logFailure) sendToLog("Invalid geometry bundle file " + std::string(path) + ": duplicate object id.");
        return false;
      }
    }
    std::array<uint8_t, GEOMETRY_OBJECT_ID_LENGTH> objectId = {};
    memcpy(objectId.data(), metadata.objectId, GEOMETRY_OBJECT_ID_LENGTH);
    objectIds.push_back(objectId);
    GeometryObjectSlot parsed;
    if (!geometryObjectForMetadata(metadata, parsed)) {
      file.close();
      if (logFailure) sendToLog("Invalid geometry bundle file " + std::string(path) + ": object body.");
      return false;
    }
    if (metadata.objectType == PRESET_SYNC_OBJECT_TYPE_USER_TUNING
        && !geometryObjectRuntimeTuningSupported(parsed)) {
      file.close();
      if (logFailure) sendToLog("Invalid geometry bundle file " + std::string(path) + ": unsupported tuning.");
      return false;
    }
    uint8_t tuningReferenceTag = 0;
    switch (metadata.objectType) {
      case PRESET_SYNC_OBJECT_TYPE_USER_LAYOUT:
        tuningReferenceTag = PRESET_SYNC_TLV_LAYOUT_TUNING_REF;
        break;
      case PRESET_SYNC_OBJECT_TYPE_USER_SCALE:
        tuningReferenceTag = PRESET_SYNC_TLV_USER_SCALE_TUNING_REF;
        break;
      case PRESET_SYNC_OBJECT_TYPE_SCALE_COLOR_MAP:
        tuningReferenceTag = PRESET_SYNC_TLV_SCALE_COLOR_TUNING_REF;
        ++colorMapCount;
        break;
      case PRESET_SYNC_OBJECT_TYPE_EXPLICIT_BUTTON_MAP:
        tuningReferenceTag = PRESET_SYNC_TLV_BUTTON_MAP_TUNING_REF;
        break;
      default:
        break;
    }
    if (tuningReferenceTag != 0
        && !geometryObjectReferencesObjectId(parsed,
                                             tuningReferenceTag,
                                             PRESET_SYNC_OBJECT_TYPE_USER_TUNING,
                                             rootTuningObjectId)) {
      file.close();
      if (logFailure) sendToLog("Invalid geometry bundle file " + std::string(path) + ": foreign tuning reference.");
      return false;
    }
  }
  bool valid = tuningCount == 1 && colorMapCount <= 1 && file.position() == file.size();
  file.close();
  if (!valid && logFailure) sendToLog("Invalid geometry bundle file " + std::string(path) + ": bundle structure.");
  if (valid) bundle.recordCount = header.count;
  return valid;
}

bool geometryBundleIndexLess(const GeometryBundleIndexEntry& left,
                             const GeometryBundleIndexEntry& right) {
  const bool leftOrdered = left.catalogOrder != GEOMETRY_CATALOG_ORDER_UNSORTED;
  const bool rightOrdered = right.catalogOrder != GEOMETRY_CATALOG_ORDER_UNSORTED;
  if (leftOrdered != rightOrdered) return leftOrdered;
  if (leftOrdered && left.catalogOrder != right.catalogOrder) {
    return left.catalogOrder < right.catalogOrder;
  }
  int folderComparison = strcasecmp(left.folderPath, right.folderPath);
  if (folderComparison != 0) return folderComparison < 0;
  int nameComparison = strcasecmp(left.tuningName, right.tuningName);
  if (nameComparison != 0) return nameComparison < 0;
  return memcmp(left.tuningObjectId,
                right.tuningObjectId,
                GEOMETRY_OBJECT_ID_LENGTH) < 0;
}

void sortGeometryBundlesAndAssignHandles() {
  std::sort(geometryBundles.begin(), geometryBundles.end(), geometryBundleIndexLess);
  uint16_t firstHandle = 0;
  for (GeometryBundleIndexEntry& bundle : geometryBundles) {
    bundle.firstHandle = firstHandle;
    firstHandle += bundle.recordCount;
  }
}

bool applyGeometryOrderBytes(const uint8_t* data,
                             size_t length,
                             bool requireCompleteCatalog,
                             bool applyOrder = true) {
  if (!data || length < sizeof(GeometryOrderFileHeader)) return false;
  GeometryOrderFileHeader header = {};
  memcpy(&header, data, sizeof(header));
  size_t bodyLength = static_cast<size_t>(header.count) * GEOMETRY_OBJECT_ID_LENGTH;
  if (strncmp(header.magic, "HGO", 3) != 0
      || header.version != GEOMETRY_ORDER_FILE_VERSION
      || header.count > GEOMETRY_BUNDLE_MAX_COUNT
      || length != sizeof(header) + bodyLength
      || header.crc32 != crc32(data + sizeof(header), bodyLength)
      || (requireCompleteCatalog && header.count != geometryBundles.size())) {
    return false;
  }

  for (uint8_t left = 0; left < header.count; ++left) {
    const uint8_t* leftId = data + sizeof(header) + left * GEOMETRY_OBJECT_ID_LENGTH;
    for (uint8_t right = left + 1; right < header.count; ++right) {
      const uint8_t* rightId = data + sizeof(header) + right * GEOMETRY_OBJECT_ID_LENGTH;
      if (memcmp(leftId, rightId, GEOMETRY_OBJECT_ID_LENGTH) == 0) return false;
    }
    const GeometryBundleIndexEntry* bundle = nullptr;
    if (requireCompleteCatalog && !geometryBundleForTuningObjectId(leftId, bundle)) return false;
  }

  if (!applyOrder) return true;

  for (GeometryBundleIndexEntry& bundle : geometryBundles) {
    bundle.catalogOrder = GEOMETRY_CATALOG_ORDER_UNSORTED;
  }
  for (uint8_t order = 0; order < header.count; ++order) {
    const uint8_t* objectId = data + sizeof(header) + order * GEOMETRY_OBJECT_ID_LENGTH;
    for (GeometryBundleIndexEntry& bundle : geometryBundles) {
      if (memcmp(bundle.tuningObjectId, objectId, GEOMETRY_OBJECT_ID_LENGTH) == 0) {
        bundle.catalogOrder = order;
        break;
      }
    }
  }
  sortGeometryBundlesAndAssignHandles();
  return true;
}

bool loadGeometryCatalogOrder() {
  File file = LittleFS.open(GEOMETRY_ORDER_FILE_PATH, "r");
  if (!file || file.size() < sizeof(GeometryOrderFileHeader)
      || file.size() > PRESET_SYNC_MAX_GEOMETRY_ORDER_BYTES) {
    if (file) file.close();
    return false;
  }
  std::vector<uint8_t> raw(file.size(), 0);
  bool read = file.read(raw.data(), raw.size()) == raw.size();
  file.close();
  return read && applyGeometryOrderBytes(raw.data(), raw.size(), false);
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

bool beginGeometryCatalogRead(GeometryCatalogReader& reader) {
  endGeometryCatalogRead(reader);
  if (!fileSystemExists || geometryCatalogObjectCount == 0) {
    return false;
  }
  reader.count = geometryCatalogObjectCount;
  reader.nextHandle = 0;
  reader.nextBundleIndex = 0;
  return true;
}

bool beginGeometryBundleRead(const GeometryBundleIndexEntry& bundle,
                             GeometryCatalogReader& reader) {
  endGeometryCatalogRead(reader);
  if (!fileSystemExists || bundle.recordCount == 0
      || !geometryBundleStoragePath(bundle.tuningObjectId,
                                    reader.storagePath,
                                    sizeof(reader.storagePath))) {
    return false;
  }
  reader.file = LittleFS.open(reader.storagePath, "r");
  GeometryObjectFileHeader header = {};
  if (!reader.file
      || reader.file.read(reinterpret_cast<uint8_t*>(&header), sizeof(header)) != sizeof(header)
      || !geometryBundleHeaderValid(header)
      || header.count != bundle.recordCount) {
    endGeometryCatalogRead(reader);
    return false;
  }
  reader.nextHandle = bundle.firstHandle;
  reader.count = bundle.firstHandle + bundle.recordCount;
  reader.bundleRecordsRemaining = bundle.recordCount;
  reader.nextBundleIndex = geometryBundles.size();
  return true;
}

bool readNextGeometryObjectMetadata(GeometryCatalogReader& reader,
                                    uint16_t& handle,
                                    GeometryObjectIndexEntry& object) {
  if (reader.nextHandle >= reader.count) {
    return false;
  }
  while (!reader.file || reader.bundleRecordsRemaining == 0) {
    if (reader.file) reader.file.close();
    if (reader.nextBundleIndex >= geometryBundles.size()) {
      return false;
    }
    const GeometryBundleIndexEntry& bundle = geometryBundles[reader.nextBundleIndex++];
    if (!geometryBundleStoragePath(bundle.tuningObjectId,
                                   reader.storagePath,
                                   sizeof(reader.storagePath))) {
      return false;
    }
    reader.file = LittleFS.open(reader.storagePath, "r");
    GeometryObjectFileHeader header = {};
    if (!reader.file
        || reader.file.read(reinterpret_cast<uint8_t*>(&header), sizeof(header)) != sizeof(header)
        || !geometryBundleHeaderValid(header)
        || header.count != bundle.recordCount) {
      if (reader.file) reader.file.close();
      return false;
    }
    reader.bundleRecordsRemaining = bundle.recordCount;
  }
  if (!readGeometryRecordMetadata(reader.file, reader.storagePath, object)) return false;
  --reader.bundleRecordsRemaining;
  handle = reader.nextHandle++;
  return true;
}

void endGeometryCatalogRead(GeometryCatalogReader& reader) {
  if (reader.file) {
    reader.file.close();
  }
  reader.nextHandle = 0;
  reader.count = 0;
  reader.bundleRecordsRemaining = 0;
  reader.nextBundleIndex = 0;
  reader.storagePath[0] = '\0';
}

bool geometryObjectMetadataForHandle(uint16_t wantedHandle, GeometryObjectIndexEntry& object) {
  if (wantedHandle >= geometryCatalogObjectCount) {
    return false;
  }
  for (const GeometryBundleIndexEntry& bundle : geometryBundles) {
    uint32_t bundleEnd = static_cast<uint32_t>(bundle.firstHandle) + bundle.recordCount;
    if (wantedHandle < bundle.firstHandle || wantedHandle >= bundleEnd) {
      continue;
    }
    char path[GEOMETRY_STORAGE_PATH_LENGTH] = {};
    if (!geometryBundleStoragePath(bundle.tuningObjectId, path, sizeof(path))) return false;
    File file = LittleFS.open(path, "r");
    GeometryObjectFileHeader header = {};
    if (!file
        || file.read(reinterpret_cast<uint8_t*>(&header), sizeof(header)) != sizeof(header)
        || !geometryBundleHeaderValid(header)
        || header.count != bundle.recordCount) {
      if (file) file.close();
      return false;
    }
    uint16_t localHandle = wantedHandle - bundle.firstHandle;
    for (uint16_t index = 0; index <= localHandle; ++index) {
      if (!readGeometryRecordMetadata(file, path, object)) {
        file.close();
        return false;
      }
    }
    file.close();
    return true;
  }
  return false;
}

bool geometryBundleForTuningHandle(uint16_t tuningHandle,
                                   const GeometryBundleIndexEntry*& bundle) {
  for (const GeometryBundleIndexEntry& candidate : geometryBundles) {
    if (candidate.firstHandle == tuningHandle) {
      bundle = &candidate;
      return true;
    }
  }
  bundle = nullptr;
  return false;
}

bool geometryBundleForTuningObjectId(const uint8_t* tuningObjectId,
                                     const GeometryBundleIndexEntry*& bundle) {
  if (tuningObjectId) {
    for (const GeometryBundleIndexEntry& candidate : geometryBundles) {
      if (memcmp(candidate.tuningObjectId,
                 tuningObjectId,
                 GEOMETRY_OBJECT_ID_LENGTH) == 0) {
        bundle = &candidate;
        return true;
      }
    }
  }
  bundle = nullptr;
  return false;
}

bool parseGeometryObjectBody(std::vector<uint8_t> body, GeometryObjectSlot& object, std::string& error) {
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
  parsed.body = std::move(body);
  object = std::move(parsed);
  return true;
}

void load_geometry_objects() {
  clearGeometryCatalogState();
  if (!fileSystemExists) {
    sendToLog("File system not available. Using empty geometry catalog.");
    return;
  }
  File directory = LittleFS.open(GEOMETRY_STORAGE_ROOT, "r");
  if (!directory || !directory.isDirectory()) {
    if (directory) directory.close();
    sendToLog("Geometry bundle directory not found. Starting with an empty geometry library.");
    return;
  }
  File entry;
  while ((entry = directory.openNextFile())) {
    char path[GEOMETRY_STORAGE_PATH_LENGTH] = {};
    snprintf(path, sizeof(path), "%s", entry.fullName());
    bool candidate = !entry.isDirectory() && pathHasGeometryBundleExtension(path);
    entry.close();
    if (!candidate) continue;
    GeometryBundleIndexEntry bundle = {};
    if (!validateGeometryBundleFile(path, bundle, true)) continue;
    char canonicalPath[GEOMETRY_STORAGE_PATH_LENGTH] = {};
    if (!geometryBundleStoragePath(bundle.tuningObjectId, canonicalPath, sizeof(canonicalPath))
        || strcmp(path, canonicalPath) != 0) {
      sendToLog("Warning: Geometry bundle filename does not match its tuning object id: " + std::string(path));
      continue;
    }
    if (geometryBundles.size() >= GEOMETRY_BUNDLE_MAX_COUNT
        || geometryCatalogObjectCount + bundle.recordCount > GEOMETRY_OBJECT_MAX_COUNT) {
      sendToLog("Warning: Geometry library exceeds its bundle or record limit.");
      break;
    }
    geometryBundles.push_back(bundle);
    geometryCatalogObjectCount += bundle.recordCount;
  }
  directory.close();
  if (!loadGeometryCatalogOrder()) sortGeometryBundlesAndAssignHandles();
  sendToLog("Geometry bundles loaded successfully (" + std::to_string(geometryBundles.size()) + " bundles, "
            + std::to_string(geometryCatalogObjectCount) + " objects).");
}

bool installGeometryBundleFile(const char* stagedPath) {
  if (!fileSystemExists || !stagedPath || !stagedPath[0]) return false;
  GeometryBundleIndexEntry bundle = {};
  if (!validateGeometryBundleFile(stagedPath, bundle, true)) return false;
  char destination[GEOMETRY_STORAGE_PATH_LENGTH] = {};
  if (!geometryBundleStoragePath(bundle.tuningObjectId, destination, sizeof(destination))) return false;
  bool replacing = LittleFS.exists(destination);
  if (!replacing && geometryBundleCount() >= GEOMETRY_BUNDLE_MAX_COUNT) {
    sendToLog("Geometry bundle library is full.");
    return false;
  }
  if (!LittleFS.exists(GEOMETRY_STORAGE_ROOT) && !LittleFS.mkdir(GEOMETRY_STORAGE_ROOT)) {
    sendToLog("Error: Unable to create /geometry.");
    return false;
  }
  if (!LittleFS.rename(stagedPath, destination)) {
    sendToLog("Error: Unable to atomically install geometry bundle " + std::string(destination) + ".");
    return false;
  }
  load_geometry_objects();
  return findGeometryObjectByTypeAndObjectId(PRESET_SYNC_OBJECT_TYPE_USER_TUNING,
                                             bundle.tuningObjectId) >= 0;
}

bool saveGeometryCatalogOrder(const std::vector<uint8_t>& raw) {
  if (!fileSystemExists
      || !applyGeometryOrderBytes(raw.data(), raw.size(), true, false)) {
    return false;
  }

  File existing = LittleFS.open(GEOMETRY_ORDER_FILE_PATH, "r");
  if (existing && existing.size() == raw.size()) {
    std::vector<uint8_t> existingRaw(raw.size(), 0);
    bool unchanged = existing.read(existingRaw.data(), existingRaw.size()) == existingRaw.size()
                     && existingRaw == raw;
    existing.close();
    if (unchanged) return applyGeometryOrderBytes(raw.data(), raw.size(), true);
  } else if (existing) {
    existing.close();
  }

  LittleFS.remove(GEOMETRY_ORDER_TEMP_FILE_PATH);
  File output = LittleFS.open(GEOMETRY_ORDER_TEMP_FILE_PATH, "w");
  bool written = output && output.write(raw.data(), raw.size()) == raw.size();
  if (output) output.close();
  if (!written || !LittleFS.rename(GEOMETRY_ORDER_TEMP_FILE_PATH, GEOMETRY_ORDER_FILE_PATH)) {
    LittleFS.remove(GEOMETRY_ORDER_TEMP_FILE_PATH);
    return false;
  }
  return applyGeometryOrderBytes(raw.data(), raw.size(), true);
}

int findGeometryObjectByTypeAndObjectId(uint8_t objectType, const uint8_t* objectId) {
  GeometryCatalogReader reader;
  if (!beginGeometryCatalogRead(reader)) {
    return -1;
  }
  uint16_t handle = 0;
  GeometryObjectIndexEntry object;
  while (readNextGeometryObjectMetadata(reader, handle, object)) {
    if (object.objectType == objectType
        && memcmp(object.objectId, objectId, GEOMETRY_OBJECT_ID_LENGTH) == 0) {
      endGeometryCatalogRead(reader);
      return static_cast<int>(handle);
    }
  }
  endGeometryCatalogRead(reader);
  return -1;
}

size_t geometryBundleCount() {
  return geometryBundles.size();
}

bool deleteGeometryObjectFromCatalog(uint16_t handle) {
  GeometryObjectIndexEntry object;
  if (!geometryObjectMetadataForHandle(handle, object)
      || object.objectType != PRESET_SYNC_OBJECT_TYPE_USER_TUNING) {
    sendToLog("Geometry delete rejected: delete the bundle tuning root.");
    return false;
  }
  beginFlashSafeWrite();
  bool removed = LittleFS.remove(object.storagePath);
  endFlashSafeWrite();
  if (removed) load_geometry_objects();
  return removed;
}

bool geometryObjectForHandle(uint16_t handle, GeometryObjectSlot& object) {
  if (isBuiltinGeometryHandle(handle)) {
    return buildBuiltinGeometryObject(handle, object);
  }
  GeometryObjectIndexEntry entry;
  if (!geometryObjectMetadataForHandle(handle, entry)) {
    return false;
  }
  return geometryObjectForMetadata(entry, object);
}

bool geometryObjectForMetadata(const GeometryObjectIndexEntry& entry, GeometryObjectSlot& object) {
  std::vector<uint8_t> body;
  if (!readGeometryObjectBody(entry, body)) {
    return false;
  }
  GeometryObjectSlot parsed;
  std::string parseError;
  if (!parseGeometryObjectBody(std::move(body), parsed, parseError)
      || parsed.objectType != entry.objectType
      || parsed.schemaMajor != entry.schemaMajor
      || parsed.schemaMinor != entry.schemaMinor
      || memcmp(parsed.objectId, entry.objectId, sizeof(entry.objectId)) != 0) {
    sendToLog("Geometry object read rejected: " + parseError);
    return false;
  }
  object = std::move(parsed);
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

bool presetSyncFindTlvI32LE(const std::vector<uint8_t>& body, uint8_t tag, int32_t& result) {
  const uint8_t* value = nullptr;
  uint16_t length = 0;
  if (!presetSyncFindTlv(body, tag, value, length) || length != 4) {
    return false;
  }
  result = presetSyncReadI32LE(value);
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

bool presetSyncFindTlvFloat32LE(const std::vector<uint8_t>& body, uint8_t tag, float& result) {
  const uint8_t* value = nullptr;
  uint16_t length = 0;
  if (!presetSyncFindTlv(body, tag, value, length) || length != sizeof(float)) {
    return false;
  }
  result = presetSyncReadFloat32LE(value);
  return std::isfinite(result);
}

bool readRuntimeCentsTable(const GeometryObjectSlot& object,
                           uint16_t cycleLength,
                           float& periodCents,
                           float* destination) {
  if (cycleLength == 0 || cycleLength > MAX_SCALE_DIVISIONS) {
    return false;
  }

  const uint8_t* centsTable = nullptr;
  uint16_t centsTableLength = 0;
  bool floatTable = presetSyncFindTlv(
    object.body,
    PRESET_SYNC_TLV_TUNING_CENTS_TABLE_FLOAT32,
    centsTable,
    centsTableLength
  );
  if (!floatTable
      && !presetSyncFindTlv(object.body, PRESET_SYNC_TLV_TUNING_CENTS_TABLE, centsTable, centsTableLength)) {
    return false;
  }
  if (centsTableLength != static_cast<uint16_t>(cycleLength * sizeof(float))) {
    return false;
  }

  uint32_t periodFromTlv = 0;
  bool sawLegacyPeriod = presetSyncFindTlvU32LE(object.body, PRESET_SYNC_TLV_TUNING_PERIOD_MILLI_CENTS, periodFromTlv);
  float precisePeriod = 0.0f;
  bool sawPrecisePeriod = presetSyncFindTlvFloat32LE(
    object.body,
    PRESET_SYNC_TLV_TUNING_PERIOD_CENTS_FLOAT32,
    precisePeriod
  );

  float previousCents = 0.0f;
  for (uint16_t degree = 0; degree < cycleLength; ++degree) {
    float cents = floatTable
      ? presetSyncReadFloat32LE(centsTable + (degree * sizeof(float)))
      : static_cast<float>(presetSyncReadI32LE(centsTable + (degree * sizeof(int32_t)))) / 1000.0f;
    if (!std::isfinite(cents) || cents <= previousCents) {
      return false;
    }
    if (destination) {
      destination[degree] = cents;
    }
    previousCents = cents;
  }

  periodCents = sawPrecisePeriod
    ? precisePeriod
    : (sawLegacyPeriod ? static_cast<float>(periodFromTlv) / 1000.0f : previousCents);
  return periodCents > 0.0f && previousCents == periodCents;
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
    float periodCents = 0.0f;
    return readRuntimeCentsTable(object, cycleLength, periodCents, nullptr);
  }
  return false;
}

bool geometryFallbackRequired() {
  return geometryBundleCount() == 0;
}

bool loadDefaultGeometryRuntime() {
  if (fileSystemExists) {
    File referenceFile = LittleFS.open(DEFAULT_GEOMETRY_REFERENCE_FILE_PATH, "r");
    DefaultGeometryReferenceFile reference = {};
    bool validReference = referenceFile
                          && referenceFile.size() == sizeof(reference)
                          && referenceFile.read(reinterpret_cast<uint8_t*>(&reference), sizeof(reference)) == sizeof(reference);
    if (referenceFile) referenceFile.close();
    validReference = validReference
                     && strncmp(reference.magic, "DGE", 3) == 0
                     && reference.version == DEFAULT_GEOMETRY_REFERENCE_VERSION
                     && reference.crc32 == crc32(reference.tuningObjectId, sizeof(reference.tuningObjectId));
    if (validReference) {
      int handle = findGeometryObjectByTypeAndObjectId(PRESET_SYNC_OBJECT_TYPE_USER_TUNING,
                                                       reference.tuningObjectId);
      if (handle >= 0 && loadUserGeometryBundleFromTuningSlot(static_cast<uint16_t>(handle))) {
        return true;
      }
    }
  }
  GeometryCatalogReader reader;
  if (beginGeometryCatalogRead(reader)) {
    uint16_t handle = 0;
    GeometryObjectIndexEntry object;
    while (readNextGeometryObjectMetadata(reader, handle, object)) {
      if (object.objectType != PRESET_SYNC_OBJECT_TYPE_USER_TUNING) {
        continue;
      }
      if (loadUserGeometryBundleFromTuningSlot(handle)) {
        endGeometryCatalogRead(reader);
        return true;
      }
    }
    endGeometryCatalogRead(reader);
  }

  uint16_t rescueHandle = 0;
  return builtinGeometryHandleForLegacyTuning(TUNING_12EDO, rescueHandle)
         && loadUserGeometryBundleFromTuningSlot(rescueHandle);
}

int findFirstGeometryObjectReferencing(uint8_t objectType, uint8_t referenceTag, uint8_t referenceObjectType, const uint8_t* referenceObjectId) {
  if (geometryFallbackRequired()) {
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
  }

  const GeometryBundleIndexEntry* bundle = nullptr;
  if (referenceObjectType == PRESET_SYNC_OBJECT_TYPE_USER_TUNING) {
    geometryBundleForTuningObjectId(referenceObjectId, bundle);
  } else if (userGeometryRuntimeTuningObjectSelected) {
    geometryBundleForTuningObjectId(userGeometryRuntimeTuningObjectId, bundle);
  }
  if (bundle) {
    GeometryCatalogReader reader;
    if (!beginGeometryBundleRead(*bundle, reader)) return -1;
    uint16_t handle = 0;
    GeometryObjectIndexEntry object;
    while (readNextGeometryObjectMetadata(reader, handle, object)) {
      GeometryObjectSlot fullObject;
      if (object.objectType == objectType
          && geometryObjectForMetadata(object, fullObject)
          && geometryObjectReferencesObjectId(fullObject,
                                              referenceTag,
                                              referenceObjectType,
                                              referenceObjectId)) {
        endGeometryCatalogRead(reader);
        return static_cast<int>(handle);
      }
    }
    endGeometryCatalogRead(reader);
    return -1;
  }

  GeometryCatalogReader reader;
  if (beginGeometryCatalogRead(reader)) {
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
  }
  return -1;
}

void clearUserGeometryButtonRuntimeOverrides() {
  releaseAllMappedButtonActions();
  for (byte i = 0; i < LED_COUNT; ++i) {
    userGeometryRuntimeButtonDisabled[i] = false;
    userGeometryRuntimeButtonRole[i] = PRESET_SYNC_BUTTON_MAP_ROLE_NOTE;
    userGeometryRuntimeButtonRoleOverride[i] = false;
    userGeometryRuntimeButtonNoteOverride[i] = false;
    userGeometryRuntimeButtonColorActive[i] = false;
    userGeometryRuntimeButtonStepsFromC[i] = 0;
    userGeometryRuntimeButtonColor[i] = { HUE_NONE, SAT_BW, VALUE_BLACK };
    userGeometryRuntimeButtonOutputMode[i] = PRESET_SYNC_BUTTON_OUTPUT_TUNED;
    userGeometryRuntimeButtonMidiNote[i] = UNUSED_NOTE;
    userGeometryRuntimeButtonMidiChannel[i] = 0;
    userGeometryRuntimeButtonChordActionId[i] = 0;
    userGeometryRuntimeButtonChordRootMidiNote[i] = UNUSED_NOTE;
  }
  memset(userGeometryRuntimeChordActions, 0, sizeof(userGeometryRuntimeChordActions));
}

void clearUserGeometryRuntimeSelection() {
  userGeometryRuntimeActive = false;
  userGeometryRuntimeScaleActive = false;
  userGeometryRuntimePaletteActive = false;
  userGeometryRuntimeTuningObjectSelected = false;
  userGeometryRuntimeLayoutObjectSelected = false;
  userGeometryRuntimeScaleObjectSelected = false;
  memset(userGeometryRuntimeTuningObjectId, 0, sizeof(userGeometryRuntimeTuningObjectId));
  memset(userGeometryRuntimeLayoutObjectId, 0, sizeof(userGeometryRuntimeLayoutObjectId));
  memset(userGeometryRuntimeScaleObjectId, 0, sizeof(userGeometryRuntimeScaleObjectId));
  userGeometryRuntimeCentsTableActive = false;
  userGeometryRuntimeExactEdoActive = false;
  userGeometryRuntimeTuningKind = 0;
  userGeometryRuntimeCycleLength = 0;
  userGeometryRuntimeCentsTableLength = 0;
  memset(userGeometryRuntimeCentsTable, 0, sizeof(userGeometryRuntimeCentsTable));
  userGeometryRuntimePeriodCents = 1200.0f;
  userGeometryRuntimeReferenceMidiNote = 69;
  userGeometryRuntimeReferenceHz = 440.0f;
  userGeometryRuntimeDeviceRotation = DEVICE_ROTATION_PORTRAIT;
  userGeometryRuntimeLayoutCenterStepsFromC = 0;
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
  float periodCents = 1200.0f;
  float stepCents = 0.0f;
  uint8_t referenceMidiNote = 69;
  uint32_t referenceMilliHz = 440000;
  float referenceHz = 440.0f;
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
  periodCents = static_cast<float>(periodMilliCents) / 1000.0f;
  stepCents = static_cast<float>(stepMilliCents) / 1000.0f;
  referenceHz = static_cast<float>(referenceMilliHz) / 1000.0f;
  presetSyncFindTlvFloat32LE(object.body, PRESET_SYNC_TLV_TUNING_PERIOD_CENTS_FLOAT32, periodCents);
  presetSyncFindTlvFloat32LE(object.body, PRESET_SYNC_TLV_TUNING_STEP_CENTS_FLOAT32, stepCents);
  presetSyncFindTlvFloat32LE(object.body, PRESET_SYNC_TLV_TUNING_REFERENCE_HZ_FLOAT32, referenceHz);
  if (referenceMidiNote > 127) {
    sendToLog("Geometry runtime tuning apply rejected: reference MIDI note is invalid.");
    return false;
  }
  if (!std::isfinite(referenceHz) || referenceHz <= 0.0f
      || !std::isfinite(periodCents) || periodCents <= 0.0f) {
    sendToLog("Geometry runtime tuning apply rejected: period or reference Hz is invalid.");
    return false;
  }

  bool centsTableActive = false;
  float centsTablePeriod = periodCents;
  float parsedCentsTable[MAX_SCALE_DIVISIONS] = {};
  if (tuningKind == PRESET_SYNC_USER_TUNING_KIND_CENTS_LIST) {
    if (!readRuntimeCentsTable(object, cycleLength, centsTablePeriod, parsedCentsTable)) {
      sendToLog("Geometry runtime tuning apply rejected: cents table is invalid.");
      return false;
    }
    periodCents = centsTablePeriod;
    stepCents = periodCents / static_cast<float>(cycleLength);
    centsTableActive = true;
  } else {
    if (stepCents <= 0.0f) {
      stepCents = periodCents / static_cast<float>(cycleLength);
    }
    if (!std::isfinite(stepCents) || stepCents <= 0.0f) {
      sendToLog("Geometry runtime tuning apply rejected: step size is invalid.");
      return false;
    }
  }

  copyRuntimeGeometryName(userGeometryRuntimeTuningNameStorage, sizeof(userGeometryRuntimeTuningNameStorage), object.name);
  userGeometryRuntimeTuning.name = userGeometryRuntimeTuningNameStorage;
  userGeometryRuntimeTuning.cycleLength = static_cast<byte>(cycleLength);
  userGeometryRuntimeTuning.stepSize = stepCents;
  memcpy(userGeometryRuntimeTuningObjectId, object.objectId, sizeof(userGeometryRuntimeTuningObjectId));
  userGeometryRuntimeTuningObjectSelected = true;
  userGeometryRuntimeLayoutObjectSelected = false;
  userGeometryRuntimeScaleObjectSelected = false;
  userGeometryRuntimeCentsTableActive = centsTableActive;
  userGeometryRuntimeExactEdoActive = tuningKind == PRESET_SYNC_USER_TUNING_KIND_EDO;
  userGeometryRuntimeTuningKind = tuningKind;
  userGeometryRuntimeCycleLength = cycleLength;
  userGeometryRuntimeCentsTableLength = centsTableActive ? cycleLength : 0;
  memset(userGeometryRuntimeCentsTable, 0, sizeof(userGeometryRuntimeCentsTable));
  if (centsTableActive) {
    memcpy(userGeometryRuntimeCentsTable, parsedCentsTable, cycleLength * sizeof(parsedCentsTable[0]));
  }
  userGeometryRuntimePeriodCents = periodCents;
  userGeometryRuntimeReferenceMidiNote = referenceMidiNote;
  userGeometryRuntimeReferenceHz = referenceHz;
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
  userGeometryRuntimeLayoutCenterStepsFromC = 0;
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
  uint8_t storedDeviceRotation = 0;
  uint8_t storedLayoutRotation = 0;
  uint8_t mirrorFlags = 0;
  int32_t centerStepsFromC = 0;
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
  storedDeviceRotation = portrait != 0 ? DEVICE_ROTATION_PORTRAIT : DEVICE_ROTATION_LANDSCAPE;
  presetSyncFindTlvU8(object.body, PRESET_SYNC_TLV_LAYOUT_DEVICE_ROTATION, storedDeviceRotation);
  presetSyncFindTlvU8(object.body, PRESET_SYNC_TLV_LAYOUT_ROTATION, storedLayoutRotation);
  presetSyncFindTlvU8(object.body, PRESET_SYNC_TLV_LAYOUT_MIRROR_FLAGS, mirrorFlags);
  presetSyncFindTlvI32LE(object.body, PRESET_SYNC_TLV_LAYOUT_CENTER_STEPS_FROM_C, centerStepsFromC);
  if (storedDeviceRotation > 3 || storedLayoutRotation > 5 || (mirrorFlags & ~0x03u) != 0) {
    sendToLog("Geometry runtime layout apply rejected: rotation or mirror field is out of range.");
    return false;
  }
  if (centerStepsFromC < std::numeric_limits<int16_t>::min()
      || centerStepsFromC > std::numeric_limits<int16_t>::max()) {
    sendToLog("Geometry runtime layout apply rejected: center step offset is out of range.");
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
  userGeometryRuntimeDeviceRotation = storedDeviceRotation;
  userGeometryRuntimeLayoutCenterStepsFromC = static_cast<int16_t>(centerStepsFromC);
  deviceRotation = storedDeviceRotation;
  layoutRotation = storedLayoutRotation;
  mirrorLeftRight = (mirrorFlags & 0x01u) != 0;
  mirrorUpDown = (mirrorFlags & 0x02u) != 0;
  settings[static_cast<uint8_t>(SettingKey::DeviceRotation)] = deviceRotation;
  settings[static_cast<uint8_t>(SettingKey::LayoutRotation)] = layoutRotation;
  settings[static_cast<uint8_t>(SettingKey::MirrorLeftRight)] = mirrorLeftRight;
  settings[static_cast<uint8_t>(SettingKey::MirrorUpDown)] = mirrorUpDown;
  clearUserGeometryButtonRuntimeOverrides();
  applyLayout();
  applyDeviceDisplayRotation();
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
  memcpy(userGeometryRuntimeScaleObjectId, object.objectId, sizeof(userGeometryRuntimeScaleObjectId));
  userGeometryRuntimeScaleObjectSelected = true;
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
      || (recordFormat != PRESET_SYNC_BUTTON_MAP_RECORD_FORMAT_LEGACY
          && recordFormat != PRESET_SYNC_BUTTON_MAP_RECORD_FORMAT_FIELD_MASKED)
      || (recordFormat == PRESET_SYNC_BUTTON_MAP_RECORD_FORMAT_LEGACY
          && (recordsLength % PRESET_SYNC_BUTTON_MAP_RECORD_SIZE) != 0)) {
    sendToLog("Geometry runtime button map apply rejected: button records are invalid.");
    return false;
  }

  clearUserGeometryButtonRuntimeOverrides();
  const uint8_t* actionRecords = nullptr;
  uint16_t actionRecordsLength = 0;
  if (recordFormat == PRESET_SYNC_BUTTON_MAP_RECORD_FORMAT_FIELD_MASKED
      && presetSyncFindTlv(object.body, PRESET_SYNC_TLV_BUTTON_MAP_ACTIONS, actionRecords, actionRecordsLength)) {
    size_t cursor = 0;
    uint8_t actionCount = 0;
    while (cursor < actionRecordsLength) {
      if (cursor + 2 > actionRecordsLength) {
        sendToLog("Geometry runtime button map apply rejected: chord action length is truncated.");
        clearUserGeometryButtonRuntimeOverrides();
        return false;
      }
      uint16_t actionLength = presetSyncReadU16LE(actionRecords + cursor);
      cursor += 2;
      if (actionLength < 6 || cursor + actionLength > actionRecordsLength
          || actionCount >= PRESET_SYNC_MAX_CHORD_ACTIONS) {
        sendToLog("Geometry runtime button map apply rejected: chord action is invalid.");
        clearUserGeometryButtonRuntimeOverrides();
        return false;
      }
      const uint8_t* action = actionRecords + cursor;
      uint8_t toneCount = action[4];
      uint8_t nameLength = action[5];
      if (action[0] == 0
          || action[1] != PRESET_SYNC_BUTTON_ACTION_CHORD
          || action[2] > PRESET_SYNC_CHORD_PITCH_MIDI_SEMITONES
          || action[3] > MIDI_CHANNEL_MAX
          || (action[2] == PRESET_SYNC_CHORD_PITCH_MIDI_SEMITONES && action[3] < MIDI_CHANNEL_MIN)
          || toneCount == 0
          || toneCount > PRESET_SYNC_MAX_CHORD_TONES
          || actionLength != static_cast<uint16_t>(6 + (2 * toneCount) + nameLength)) {
        sendToLog("Geometry runtime button map apply rejected: chord action fields are invalid.");
        clearUserGeometryButtonRuntimeOverrides();
        return false;
      }
      for (uint8_t existing = 0; existing < actionCount; ++existing) {
        if (userGeometryRuntimeChordActions[existing].id == action[0]) {
          sendToLog("Geometry runtime button map apply rejected: duplicate chord action id.");
          clearUserGeometryButtonRuntimeOverrides();
          return false;
        }
      }
      UserGeometryChordAction& runtimeAction = userGeometryRuntimeChordActions[actionCount++];
      runtimeAction.active = true;
      runtimeAction.id = action[0];
      runtimeAction.pitchMode = action[2];
      runtimeAction.midiChannel = action[3];
      runtimeAction.toneCount = toneCount;
      for (uint8_t tone = 0; tone < toneCount; ++tone) {
        runtimeAction.intervals[tone] = presetSyncReadI16LE(action + 6 + (tone * 2));
      }
      cursor += actionLength;
    }
  }

  if (recordFormat == PRESET_SYNC_BUTTON_MAP_RECORD_FORMAT_LEGACY) {
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
  } else {
    size_t cursor = 0;
    while (cursor < recordsLength) {
      if (cursor + 2 > recordsLength) {
        sendToLog("Geometry runtime button map apply rejected: field-masked record length is truncated.");
        clearUserGeometryButtonRuntimeOverrides();
        return false;
      }
      uint16_t recordLength = presetSyncReadU16LE(records + cursor);
      cursor += 2;
      if (recordLength < PRESET_SYNC_BUTTON_MAP_FIELD_MASKED_RECORD_SIZE || cursor + recordLength > recordsLength) {
        sendToLog("Geometry runtime button map apply rejected: field-masked record is invalid.");
        clearUserGeometryButtonRuntimeOverrides();
        return false;
      }
      const uint8_t* record = records + cursor;
      uint16_t buttonIndex = presetSyncReadU16LE(record);
      uint16_t fieldMask = presetSyncReadU16LE(record + 2);
      if ((fieldMask & ~(PRESET_SYNC_BUTTON_MAP_FIELD_ROLE
                         | PRESET_SYNC_BUTTON_MAP_FIELD_PITCH
                         | PRESET_SYNC_BUTTON_MAP_FIELD_COLOR
                         | PRESET_SYNC_BUTTON_MAP_FIELD_ACTION)) != 0) {
        sendToLog("Geometry runtime button map apply rejected: unknown button field flag.");
        clearUserGeometryButtonRuntimeOverrides();
        return false;
      }
      if (buttonIndex < LED_COUNT) {
        if ((fieldMask & PRESET_SYNC_BUTTON_MAP_FIELD_ROLE) != 0) {
          uint8_t role = record[4];
          if (role > PRESET_SYNC_BUTTON_MAP_ROLE_COMMAND) {
            role = PRESET_SYNC_BUTTON_MAP_ROLE_UNUSED;
          }
          userGeometryRuntimeButtonRoleOverride[buttonIndex] = true;
          userGeometryRuntimeButtonRole[buttonIndex] = role;
          userGeometryRuntimeButtonDisabled[buttonIndex] = role != PRESET_SYNC_BUTTON_MAP_ROLE_NOTE;
        }
        if ((fieldMask & PRESET_SYNC_BUTTON_MAP_FIELD_PITCH) != 0) {
          int32_t stepsFromC = presetSyncReadI32LE(record + 5);
          userGeometryRuntimeButtonNoteOverride[buttonIndex] = true;
          userGeometryRuntimeButtonStepsFromC[buttonIndex] = static_cast<int16_t>(
            std::clamp<int32_t>(stepsFromC, std::numeric_limits<int16_t>::min(), std::numeric_limits<int16_t>::max())
          );
        }
        if ((fieldMask & PRESET_SYNC_BUTTON_MAP_FIELD_COLOR) != 0) {
          uint16_t hueTenthDegrees = presetSyncReadU16LE(record + 13);
          userGeometryRuntimeButtonColorActive[buttonIndex] = true;
          userGeometryRuntimeButtonColor[buttonIndex] = {
            static_cast<float>(hueTenthDegrees) / 10.0f,
            record[15],
            record[16]
          };
        }
        if ((fieldMask & PRESET_SYNC_BUTTON_MAP_FIELD_ACTION) != 0) {
          uint8_t outputMode = record[9];
          if (outputMode == PRESET_SYNC_BUTTON_OUTPUT_DIRECT_MIDI) {
            if (record[10] > 127 || record[11] < MIDI_CHANNEL_MIN || record[11] > MIDI_CHANNEL_MAX) {
              sendToLog("Geometry runtime button map apply rejected: direct MIDI action is invalid.");
              clearUserGeometryButtonRuntimeOverrides();
              return false;
            }
            userGeometryRuntimeButtonOutputMode[buttonIndex] = outputMode;
            userGeometryRuntimeButtonMidiNote[buttonIndex] = record[10];
            userGeometryRuntimeButtonMidiChannel[buttonIndex] = record[11];
          } else if (outputMode == PRESET_SYNC_BUTTON_OUTPUT_CHORD) {
            bool actionFound = false;
            for (const UserGeometryChordAction& action : userGeometryRuntimeChordActions) {
              if (action.active && action.id == record[12]) {
                actionFound = true;
                break;
              }
            }
            if (!actionFound || record[10] > 127) {
              sendToLog("Geometry runtime button map apply rejected: chord action reference is invalid.");
              clearUserGeometryButtonRuntimeOverrides();
              return false;
            }
            userGeometryRuntimeButtonOutputMode[buttonIndex] = outputMode;
            userGeometryRuntimeButtonChordActionId[buttonIndex] = record[12];
            userGeometryRuntimeButtonChordRootMidiNote[buttonIndex] = record[10];
          } else {
            sendToLog("Geometry runtime button map apply rejected: button output mode is invalid.");
            clearUserGeometryButtonRuntimeOverrides();
            return false;
          }
        }
      }
      cursor += recordLength;
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
  uint8_t tuningObjectId[GEOMETRY_OBJECT_ID_LENGTH] = {};
  memcpy(tuningObjectId, tuningObject.objectId, sizeof(tuningObjectId));
  char tuningName[GEOMETRY_OBJECT_NAME_LENGTH] = {};
  snprintf(tuningName, sizeof(tuningName), "%s", tuningObject.name);
  std::vector<uint8_t>().swap(tuningObject.body);

  int layoutIndex = findFirstGeometryObjectReferencing(
    PRESET_SYNC_OBJECT_TYPE_USER_LAYOUT,
    PRESET_SYNC_TLV_LAYOUT_TUNING_REF,
    PRESET_SYNC_OBJECT_TYPE_USER_TUNING,
    tuningObjectId
  );
  bool sawLayoutObject = false;
  uint8_t layoutObjectId[GEOMETRY_OBJECT_ID_LENGTH] = {};
  if (layoutIndex >= 0) {
    GeometryObjectSlot layoutObject;
    sawLayoutObject = geometryObjectForHandle(static_cast<uint16_t>(layoutIndex), layoutObject);
    if (!sawLayoutObject || !applyUserGeometryRuntimeLayout(layoutObject)) {
      return false;
    }
    memcpy(layoutObjectId, layoutObject.objectId, sizeof(layoutObjectId));
  }

  int scaleIndex = findFirstGeometryObjectReferencing(
    PRESET_SYNC_OBJECT_TYPE_USER_SCALE,
    PRESET_SYNC_TLV_USER_SCALE_TUNING_REF,
    PRESET_SYNC_OBJECT_TYPE_USER_TUNING,
    tuningObjectId
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
    tuningObjectId
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
      layoutObjectId
    );
  }
  if (buttonMapIndex < 0 && !sawLayoutObject) {
    buttonMapIndex = findFirstGeometryObjectReferencing(
      PRESET_SYNC_OBJECT_TYPE_EXPLICIT_BUTTON_MAP,
      PRESET_SYNC_TLV_BUTTON_MAP_TUNING_REF,
      PRESET_SYNC_OBJECT_TYPE_USER_TUNING,
      tuningObjectId
    );
  }
  if (buttonMapIndex >= 0) {
    GeometryObjectSlot buttonMapObject;
    if (!geometryObjectForHandle(static_cast<uint16_t>(buttonMapIndex), buttonMapObject)
        || !applyUserGeometryRuntimeExplicitButtonMap(buttonMapObject)) {
      return false;
    }
  }

  sendToLog("Loaded user geometry " + std::string(tuningName) + " from menu.");
  return true;
}
