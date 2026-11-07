#pragma once

#include <cstddef>
#include <cstdint>
#include <cstring>

// Synth preset catalog index. It lets the preset browser and preset sync list
// presets without opening preset files, and without keeping the whole catalog
// in RAM. No Arduino or storage dependencies.
//
// /preset_index/folders.hpf  folder table: 32 fixed slots of 48-byte paths
//                            (an empty path is a free slot)
// /preset_index/<SS>.hpi     one file per used slot (SS = two hex digits):
//                            the folder's records in handle order
// /preset_index/pending      present while a catalog change is in progress
//
// Both file kinds are little-endian with a 12-byte header:
//   0  magic (3)   3  version   4  count   5  slot (folder files) or 0
//   6  reserved u16 (0)         8  CRC-32
// The CRC covers everything after the header, then header bytes 0..7.
namespace SynthPresetIndex {
constexpr uint8_t kFolderFileVersion = 2;
constexpr uint8_t kTableVersion = 1;
constexpr size_t kHeaderBytes = 12;
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
constexpr uint8_t kEngineSampler = 1;
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

// Preset files live in 16 subdirectories named by the id's first hex digit,
// so no directory holds more than a fraction of the library.
inline char bucketDigit(const uint8_t* id) { return "0123456789ABCDEF"[id[0] >> 4]; }

struct Header {
  uint8_t count = 0;
  uint8_t slot = 0;
  uint32_t crc = 0;
};

inline void encodeHeader(const char* magic, uint8_t version, const Header& header, uint8_t* out) {
  memset(out, 0, kHeaderBytes);
  memcpy(out, magic, 3);
  out[3] = version;
  out[4] = header.count;
  out[5] = header.slot;
  put32(out + 8, header.crc);
}

inline bool decodeHeader(const uint8_t* p, const char* magic, uint8_t version, Header& header) {
  if (memcmp(p, magic, 3) != 0 || p[3] != version || u16(p + 6) != 0) return false;
  header.count = p[4];
  header.slot = p[5];
  header.crc = u32(p + 8);
  return true;
}

// CRC of a file whose body has already been hashed into bodyCrc.
inline uint32_t sealCrc(uint32_t bodyCrc, const uint8_t* header) {
  return crcFinish(crcUpdate(bodyCrc, header, 8));
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

// A record in a folder file must name that file's slot.
inline bool decodeRecord(const uint8_t* p, Record& record, uint8_t slot) {
  memcpy(record.id, p, kIdBytes);
  bool nonZero = false;
  for (size_t i = 0; i < kIdBytes; ++i) nonZero = nonZero || record.id[i] != 0;
  if (!nonZero || !textIsTerminated(p + kIdBytes, kNameBytes) || p[kIdBytes] == 0) return false;
  memcpy(record.name, p + kIdBytes, kNameBytes);
  record.folder = p[48];
  record.flags = p[49];
  return record.folder == slot && (record.flags & ~kKnownFlagBits) == 0 && u16(p + 50) == 0;
}

// Folder table entries: an all-zero entry is a free slot.
inline bool decodeFolder(const uint8_t* p, char* out) {
  if (!textIsTerminated(p, kFolderBytes)) return false;
  if (p[0] == 0) {
    for (size_t i = 1; i < kFolderBytes; ++i) if (p[i] != 0) return false;
  }
  memcpy(out, p, kFolderBytes);
  return true;
}

inline void encodeFolder(const char* path, uint8_t* out) {
  memset(out, 0, kFolderBytes);
  if (path) memcpy(out, path, strnlen(path, kFolderBytes - 1));
}

// Fixed slots of folder paths. Slots keep their number while used, so
// handles (slot x capacity + position) only change inside an edited folder.
template <size_t Capacity>
struct FolderTable {
  char paths[Capacity][kFolderBytes] = {};
  uint8_t counts[Capacity] = {};

  void clear() { memset(paths, 0, sizeof(paths)); memset(counts, 0, sizeof(counts)); }
  bool used(uint8_t slot) const { return slot < Capacity && paths[slot][0] != 0; }
  int find(const char* path) const {
    for (uint8_t i = 0; i < Capacity; ++i) {
      if (used(i) && strncmp(paths[i], path, kFolderBytes) == 0) return i;
    }
    return -1;
  }
  int firstFree() const {
    for (uint8_t i = 0; i < Capacity; ++i) if (!used(i)) return i;
    return -1;
  }
  int findOrAdd(const char* path) {
    int existing = find(path);
    if (existing >= 0) return existing;
    int slot = firstFree();
    if (slot < 0) return -1;
    memset(paths[slot], 0, kFolderBytes);
    memcpy(paths[slot], path, strnlen(path, kFolderBytes - 1));
    counts[slot] = 0;
    return slot;
  }
  void release(uint8_t slot) {
    memset(paths[slot], 0, kFolderBytes);
    counts[slot] = 0;
  }
  uint16_t total() const {
    uint16_t sum = 0;
    for (uint8_t i = 0; i < Capacity; ++i) sum = static_cast<uint16_t>(sum + counts[i]);
    return sum;
  }
};
}  // namespace SynthPresetIndex
