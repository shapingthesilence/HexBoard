#include "../src/firmware/storage/SynthPresetIndexCodec.h"
#include <cassert>
#include <cstdio>
#include <fstream>
#include <iterator>
#include <set>
#include <string>
#include <vector>

using namespace SynthPresetIndex;

namespace {
constexpr unsigned kSlots = 32;

Record record(uint8_t seed, const char* name, uint8_t slot, uint8_t flags = 0) {
  Record r;
  for (size_t i = 0; i < kIdBytes; ++i) r.id[i] = static_cast<uint8_t>(seed + i);
  snprintf(r.name, sizeof(r.name), "%s", name);
  r.folder = slot;
  r.flags = flags;
  return r;
}

std::vector<uint8_t> seal(const char* magic, uint8_t version, uint8_t count, uint8_t slot, std::vector<uint8_t> body) {
  std::vector<uint8_t> file(kHeaderBytes);
  file.insert(file.end(), body.begin(), body.end());
  Header header;
  header.count = count;
  header.slot = slot;
  encodeHeader(magic, version, header, file.data());
  header.crc = sealCrc(crcUpdate(crcBegin(), file.data() + kHeaderBytes, file.size() - kHeaderBytes), file.data());
  encodeHeader(magic, version, header, file.data());
  return file;
}

std::vector<uint8_t> folderFile(uint8_t slot, const std::vector<Record>& records) {
  std::vector<uint8_t> body(records.size() * kRecordBytes);
  for (size_t i = 0; i < records.size(); ++i) encodeRecord(records[i], body.data() + i * kRecordBytes);
  return seal("HPI", kFolderFileVersion, static_cast<uint8_t>(records.size()), slot, body);
}

std::vector<uint8_t> tableFile(const std::vector<const char*>& paths) {
  std::vector<uint8_t> body(kSlots * kFolderBytes);
  for (size_t i = 0; i < paths.size(); ++i) encodeFolder(paths[i], body.data() + i * kFolderBytes);
  return seal("HPF", kTableVersion, kSlots, 0, body);
}

void reseal(std::vector<uint8_t>& file) {
  put32(file.data() + 8, sealCrc(crcUpdate(crcBegin(), file.data() + kHeaderBytes, file.size() - kHeaderBytes), file.data()));
}

// Mirrors loadFolderFile() in SynthPresetCatalog.cpp.
bool validateFolderFile(const std::vector<uint8_t>& file, uint8_t slot, std::vector<Record>* records = nullptr) {
  Header header;
  if (file.size() < kHeaderBytes || !decodeHeader(file.data(), "HPI", kFolderFileVersion, header)
      || header.slot != slot || header.count == 0 || file.size() != kHeaderBytes + header.count * kRecordBytes) {
    return false;
  }
  for (unsigned i = 0; i < header.count; ++i) {
    Record r;
    if (!decodeRecord(file.data() + kHeaderBytes + i * kRecordBytes, r, slot)) return false;
    if (records) records->push_back(r);
  }
  return sealCrc(crcUpdate(crcBegin(), file.data() + kHeaderBytes, file.size() - kHeaderBytes), file.data()) == header.crc;
}

// Mirrors loadTable().
bool validateTable(const std::vector<uint8_t>& file, std::vector<std::string>* paths = nullptr) {
  Header header;
  if (file.size() != kHeaderBytes + kSlots * kFolderBytes || !decodeHeader(file.data(), "HPF", kTableVersion, header)
      || header.count != kSlots || header.slot != 0) {
    return false;
  }
  for (unsigned slot = 0; slot < kSlots; ++slot) {
    char path[kFolderBytes];
    if (!decodeFolder(file.data() + kHeaderBytes + slot * kFolderBytes, path)) return false;
    if (paths) paths->push_back(path);
  }
  return sealCrc(crcUpdate(crcBegin(), file.data() + kHeaderBytes, file.size() - kHeaderBytes), file.data()) == header.crc;
}

void testFolderFiles() {
  auto file = folderFile(3, {record(1, "Glassy Bow", 3), record(40, "Starry Stabs", 3, kFlagFavorite)});
  std::vector<Record> decoded;
  assert(validateFolderFile(file, 3, &decoded));
  assert(decoded.size() == 2 && std::string(decoded[1].name) == "Starry Stabs" && decoded[1].flags == kFlagFavorite);
  assert(!validateFolderFile(file, 4));  // a file belongs to one slot
  for (size_t at = 0; at < file.size(); ++at) {
    auto damaged = file;
    damaged[at] ^= 0x10;
    assert(!validateFolderFile(damaged, 3));
  }
  auto reject = [&](size_t offset, uint8_t value) {
    auto damaged = file;
    damaged[offset] = value;
    reseal(damaged);
    assert(!validateFolderFile(damaged, 3));
  };
  reject(3, 1);                                   // version
  reject(6, 1);                                   // reserved header
  reject(kHeaderBytes + 48, 2);                   // record names another slot
  reject(kHeaderBytes + 49, 0x10);                // unknown flag
  reject(kHeaderBytes + 50, 1);                   // reserved record bytes
  reject(kHeaderBytes + kIdBytes, 0);             // empty name
  auto unterminated = file;
  memset(unterminated.data() + kHeaderBytes + kIdBytes, 'A', kNameBytes);
  reseal(unterminated);
  assert(!validateFolderFile(unterminated, 3));
  auto zeroId = file;
  memset(zeroId.data() + kHeaderBytes + kRecordBytes, 0, kIdBytes);
  reseal(zeroId);
  assert(!validateFolderFile(zeroId, 3));
  auto shorter = file;
  shorter.pop_back();
  assert(!validateFolderFile(shorter, 3));
  assert(!validateFolderFile(folderFile(3, {}), 3));  // empty folders are released, not stored
}

void testTable() {
  auto file = tableFile({"/", "Pads", "Keys/Pianos"});
  std::vector<std::string> paths;
  assert(validateTable(file, &paths));
  assert(paths[0] == "/" && paths[2] == "Keys/Pianos" && paths[3].empty());
  auto damaged = file;
  damaged[kHeaderBytes + 3 * kFolderBytes + 5] = 'x';  // junk inside a free slot
  reseal(damaged);
  assert(!validateTable(damaged));
  auto unterminated = file;
  memset(unterminated.data() + kHeaderBytes, 'a', kFolderBytes);
  reseal(unterminated);
  assert(!validateTable(unterminated));
  auto flipped = file;
  flipped[kHeaderBytes + 1] ^= 1;
  assert(!validateTable(flipped));
}

void testNamesAndBuckets() {
  uint8_t id[kIdBytes];
  assert(parseCanonicalFileName("0585D8D1E4BCC54F1C3E6F71C3E16262.hsp", id) && id[0] == 0x05 && id[15] == 0x62);
  assert(bucketDigit(id) == '0');
  assert(parseCanonicalFileName("/presets/D/D5FF404BAAF7465FC9E98825FC6C1DC0.hsp", id) && bucketDigit(id) == 'D');
  assert(!parseCanonicalFileName("0585d8d1e4bcc54f1c3e6f71c3e16262.hsp", id));
  assert(!parseCanonicalFileName("0585D8D1E4BCC54F1C3E6F71C3E16262.hsp.tmp", id));
  assert(!parseCanonicalFileName("0585D8D1E4BCC54F1C3E6F71C3E1626.hsp", id));
  assert(!parseCanonicalFileName("00000000000000000000000000000000.hsp", id));
}

void testFolderTableSlots() {
  FolderTable<3> table;
  assert(table.findOrAdd("Pads") == 0 && table.findOrAdd("Leads") == 1 && table.findOrAdd("Pads") == 0);
  table.counts[0] = 5;
  table.counts[1] = 2;
  table.release(0);
  // Released slots are reused; other slots (and their handles) stay put.
  assert(table.findOrAdd("Basses") == 0 && table.find("Leads") == 1 && table.total() == 2);
  assert(table.findOrAdd("Keys") == 2 && table.findOrAdd("Strings") == -1);
}

std::vector<uint8_t> readFile(const std::string& path) {
  std::ifstream input(path, std::ios::binary);
  return std::vector<uint8_t>((std::istreambuf_iterator<char>(input)), std::istreambuf_iterator<char>());
}

// Decodes a generator-written index and checks it against the preset files,
// given as paths relative to /presets (bucket/name.hsp).
int checkFactoryIndex(const char* indexDirectory, int fileCount, char** files) {
  std::vector<std::string> paths;
  if (!validateTable(readFile(std::string(indexDirectory) + "/folders.hpf"), &paths)) return 2;
  std::set<std::string> ids;
  for (int i = 0; i < fileCount; ++i) {
    uint8_t id[kIdBytes];
    std::string file = files[i];
    if (!parseCanonicalFileName(file.c_str(), id) || file.size() < 2 || file[0] != bucketDigit(id) || file[1] != '/') return 3;
    ids.insert(std::string(reinterpret_cast<char*>(id), kIdBytes));
  }
  size_t total = 0;
  for (unsigned slot = 0; slot < kSlots; ++slot) {
    if (paths[slot].empty()) continue;
    char name[8];
    snprintf(name, sizeof(name), "/%02X.hpi", slot);
    std::vector<Record> records;
    if (!validateFolderFile(readFile(std::string(indexDirectory) + name), static_cast<uint8_t>(slot), &records)) return 4;
    for (const Record& r : records) {
      if (!ids.count(std::string(reinterpret_cast<const char*>(r.id), kIdBytes))) return 5;
      printf("%s\t%s\n", paths[slot].c_str(), r.name);
    }
    total += records.size();
  }
  return total == ids.size() ? 0 : 6;
}
}  // namespace

int main(int argc, char** argv) {
  if (argc > 1) return checkFactoryIndex(argv[1], argc - 2, argv + 2);
  testFolderFiles();
  testTable();
  testNamesAndBuckets();
  testFolderTableSlots();
  return 0;
}
