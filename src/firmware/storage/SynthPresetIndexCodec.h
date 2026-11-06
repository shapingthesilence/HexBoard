#pragma once

#include <cstddef>
#include <cstdint>
#include <cstring>

// HPI1: the synth preset catalog index. It lets the preset browser and preset
// sync list presets without opening every preset file, and without keeping
// the whole catalog in RAM. No Arduino or storage dependencies.
//
// Layout (little-endian):
//   header   20 bytes  "HPI", version, record count, folder count,
//                      directory count, directory hash, CRC
//   records  count x 52 bytes, in handle order
//   folders  folderCount x 48 bytes, NUL-padded normalized folder paths
// The CRC covers records, then folders, then header bytes 0..15.
// The directory count/hash describe the set of canonical /presets/*.hsp
// names the index was written for, so boot can detect a stale index from a
// directory listing alone.
namespace SynthPresetIndex {
constexpr uint8_t kVersion = 1;
constexpr size_t kHeaderBytes = 20;
constexpr size_t kRecordBytes = 52;
constexpr size_t kFolderBytes = 48;
constexpr size_t kIdBytes = 16;
constexpr size_t kNameBytes = 32;
constexpr size_t kCanonicalFileNameLength = kIdBytes * 2 + 4;  // hex + ".hsp"

// Record flag bits. Engine bits are reserved for sampler presets.
constexpr uint8_t kFlagFavorite = 0x01;
constexpr uint8_t kFlagEngineShift = 1;
constexpr uint8_t kFlagEngineMask = 0x0E;
constexpr uint8_t kEngineWavetable = 0;
constexpr uint8_t kKnownFlagBits = kFlagFavorite | kFlagEngineMask;

inline uint16_t u16(const uint8_t* p) { return static_cast<uint16_t>(p[0] | (p[1] << 8)); }
inline uint32_t u32(const uint8_t* p) { return u16(p) | (static_cast<uint32_t>(u16(p + 2)) << 16); }
inline void put16(uint8_t* p, uint16_t v) { p[0] = static_cast<uint8_t>(v); p[1] = static_cast<uint8_t>(v >> 8); }
inline void put32(uint8_t* p, uint32_t v) { put16(p, static_cast<uint16_t>(v)); put16(p + 2, static_cast<uint16_t>(v >> 16)); }

inline uint32_t crcBegin() { return 0xFFFFFFFFu; }
inline uint32_t crcUpdate(uint32_t crc, const uint8_t* p, size_t n) {
  while (n--) {
    crc ^= *p++;
    for (unsigned i = 0; i < 8; ++i) crc = (crc >> 1) ^ (0xEDB88320u & (0u - (crc & 1u)));
  }
  return crc;
}
inline uint32_t crcFinish(uint32_t crc) { return ~crc; }

inline size_t fileBytes(uint16_t count, uint8_t folderCount) {
  return kHeaderBytes + static_cast<size_t>(count) * kRecordBytes
         + static_cast<size_t>(folderCount) * kFolderBytes;
}
inline size_t recordOffset(uint16_t handle) { return kHeaderBytes + static_cast<size_t>(handle) * kRecordBytes; }
inline size_t folderOffset(uint16_t count, uint8_t slot) {
  return kHeaderBytes + static_cast<size_t>(count) * kRecordBytes + static_cast<size_t>(slot) * kFolderBytes;
}

// Order-independent hash of one preset file's object id. The directory hash
// is the 32-bit sum of these values over every canonical preset file name.
inline uint32_t idHash(const uint8_t* id) {
  uint32_t hash = 2166136261u;
  for (size_t i = 0; i < kIdBytes; ++i) {
    hash ^= id[i];
    hash *= 16777619u;
  }
  return hash;
}

inline int hexValue(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

// Accepts exactly 32 upper-case hex digits followed by ".hsp" (the name the
// firmware writes). A leading directory is ignored.
inline bool parseCanonicalFileName(const char* name, uint8_t* id) {
  if (!name) return false;
  const char* slash = strrchr(name, '/');
  if (slash) name = slash + 1;
  if (strlen(name) != kCanonicalFileNameLength || strcmp(name + kIdBytes * 2, ".hsp") != 0) return false;
  bool nonZero = false;
  for (size_t i = 0; i < kIdBytes; ++i) {
    int high = hexValue(name[i * 2]);
    int low = hexValue(name[i * 2 + 1]);
    if (high < 0 || low < 0) return false;
    id[i] = static_cast<uint8_t>((high << 4) | low);
    nonZero = nonZero || id[i] != 0;
  }
  return nonZero;
}

struct Header {
  uint16_t count = 0;
  uint8_t folderCount = 0;
  uint16_t directoryCount = 0;
  uint32_t directoryHash = 0;
  uint32_t crc = 0;
};

inline void encodeHeader(const Header& header, uint8_t* out) {
  memset(out, 0, kHeaderBytes);
  out[0] = 'H'; out[1] = 'P'; out[2] = 'I';
  out[3] = kVersion;
  put16(out + 4, header.count);
  out[6] = header.folderCount;
  put16(out + 8, header.directoryCount);
  put32(out + 12, header.directoryHash);
  put32(out + 16, header.crc);
}

// Validates structure and bounds. The caller checks the CRC and file size.
inline bool decodeHeader(const uint8_t* p, Header& header, uint16_t maxCount, uint8_t maxFolders) {
  if (p[0] != 'H' || p[1] != 'P' || p[2] != 'I' || p[3] != kVersion || p[7] != 0 || u16(p + 10) != 0) {
    return false;
  }
  header.count = u16(p + 4);
  header.folderCount = p[6];
  header.directoryCount = u16(p + 8);
  header.directoryHash = u32(p + 12);
  header.crc = u32(p + 16);
  if (header.count > maxCount || header.folderCount > maxFolders) return false;
  // Every record names a folder, so records require at least one folder.
  return header.count == 0 || header.folderCount > 0;
}

struct Record {
  uint8_t id[kIdBytes] = {};
  char name[kNameBytes] = {};
  uint8_t folder = 0;
  uint8_t flags = 0;
};

inline void encodeRecord(const Record& record, uint8_t* out) {
  memset(out, 0, kRecordBytes);
  memcpy(out, record.id, kIdBytes);
  size_t nameLength = strnlen(record.name, kNameBytes - 1);
  memcpy(out + kIdBytes, record.name, nameLength);
  out[48] = record.folder;
  out[49] = record.flags;
}

inline bool textIsTerminated(const uint8_t* p, size_t capacity) {
  return memchr(p, 0, capacity) != nullptr;
}

inline bool decodeRecord(const uint8_t* p, Record& record, uint8_t folderCount) {
  memcpy(record.id, p, kIdBytes);
  bool nonZero = false;
  for (size_t i = 0; i < kIdBytes; ++i) nonZero = nonZero || record.id[i] != 0;
  if (!nonZero || !textIsTerminated(p + kIdBytes, kNameBytes) || p[kIdBytes] == 0) return false;
  memcpy(record.name, p + kIdBytes, kNameBytes);
  record.folder = p[48];
  record.flags = p[49];
  return record.folder < folderCount && (record.flags & ~kKnownFlagBits) == 0 && u16(p + 50) == 0;
}

inline bool decodeFolder(const uint8_t* p, char* out) {
  if (!textIsTerminated(p, kFolderBytes) || p[0] == 0) return false;
  memcpy(out, p, kFolderBytes);
  return true;
}

inline void encodeFolder(const char* path, uint8_t* out) {
  memset(out, 0, kFolderBytes);
  memcpy(out, path, strnlen(path, kFolderBytes - 1));
}

// Fixed-capacity table of distinct normalized folder paths.
template <size_t Capacity>
struct FolderTable {
  char paths[Capacity][kFolderBytes] = {};
  uint8_t count = 0;

  void clear() { count = 0; }
  int find(const char* path) const {
    for (uint8_t i = 0; i < count; ++i) {
      if (strncmp(paths[i], path, kFolderBytes) == 0) return i;
    }
    return -1;
  }
  // Returns the slot, or -1 when the table is full.
  int findOrAdd(const char* path) {
    int existing = find(path);
    if (existing >= 0) return existing;
    if (count >= Capacity) return -1;
    memset(paths[count], 0, kFolderBytes);
    memcpy(paths[count], path, strnlen(path, kFolderBytes - 1));
    return count++;
  }
};
}  // namespace SynthPresetIndex
