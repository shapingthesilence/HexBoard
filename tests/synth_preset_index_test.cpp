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
Record record(uint8_t seed, const char* name, uint8_t folder, uint8_t flags = 0) {
  Record r;
  for (size_t i = 0; i < kIdBytes; ++i) r.id[i] = static_cast<uint8_t>(seed + i);
  snprintf(r.name, sizeof(r.name), "%s", name);
  r.folder = folder;
  r.flags = flags;
  return r;
}

// Mirrors the firmware's whole-file validation in SynthPresetCatalog.cpp.
bool validate(const std::vector<uint8_t>& file, uint16_t maxCount, uint8_t maxFolders,
              std::vector<Record>* records = nullptr, std::vector<std::string>* folders = nullptr) {
  Header header;
  if (file.size() < kHeaderBytes || !decodeHeader(file.data(), header, maxCount, maxFolders)
      || file.size() != fileBytes(header.count, header.folderCount)) return false;
  uint32_t crc = crcBegin();
  for (uint16_t i = 0; i < header.count; ++i) {
    Record r;
    if (!decodeRecord(file.data() + recordOffset(i), r, header.folderCount)) return false;
    if (records) records->push_back(r);
  }
  crc = crcUpdate(crc, file.data() + kHeaderBytes, file.size() - kHeaderBytes);
  for (uint8_t slot = 0; slot < header.folderCount; ++slot) {
    char path[kFolderBytes];
    if (!decodeFolder(file.data() + folderOffset(header.count, slot), path)) return false;
    if (folders) folders->push_back(path);
  }
  return crcFinish(crcUpdate(crc, file.data(), 16)) == header.crc;
}

std::vector<uint8_t> encode(const std::vector<Record>& records, const std::vector<const char*>& folders,
                            uint16_t directoryCount, uint32_t directoryHash) {
  Header header;
  header.count = static_cast<uint16_t>(records.size());
  header.folderCount = static_cast<uint8_t>(folders.size());
  header.directoryCount = directoryCount;
  header.directoryHash = directoryHash;
  std::vector<uint8_t> file(fileBytes(header.count, header.folderCount));
  for (size_t i = 0; i < records.size(); ++i) encodeRecord(records[i], file.data() + recordOffset(i));
  for (size_t i = 0; i < folders.size(); ++i) encodeFolder(folders[i], file.data() + folderOffset(header.count, i));
  encodeHeader(header, file.data());
  uint32_t crc = crcUpdate(crcBegin(), file.data() + kHeaderBytes, file.size() - kHeaderBytes);
  header.crc = crcFinish(crcUpdate(crc, file.data(), 16));
  encodeHeader(header, file.data());
  return file;
}

void seal(std::vector<uint8_t>& file) {
  uint32_t crc = crcUpdate(crcBegin(), file.data() + kHeaderBytes, file.size() - kHeaderBytes);
  put32(file.data() + 16, crcFinish(crcUpdate(crc, file.data(), 16)));
}

void testRoundTripAndRejection() {
  std::vector<Record> records = {record(1, "Glassy Bow", 0), record(40, "Starry Stabs", 1, kFlagFavorite)};
  auto file = encode(records, {"Pads", "Leads"}, 2, idHash(records[0].id) + idHash(records[1].id));
  std::vector<Record> decoded;
  std::vector<std::string> folders;
  assert(validate(file, 512, 32, &decoded, &folders));
  assert(decoded.size() == 2 && std::string(decoded[1].name) == "Starry Stabs");
  assert(decoded[1].flags == kFlagFavorite && decoded[1].folder == 1);
  assert(folders.size() == 2 && folders[0] == "Pads");

  // Any flipped bit in the file is caught.
  for (size_t at = 0; at < file.size(); ++at) {
    auto damaged = file;
    damaged[at] ^= 0x10;
    assert(!validate(damaged, 512, 32));
  }
  // Structurally invalid content is rejected even with a matching CRC.
  auto reject = [&](size_t offset, uint8_t value) {
    auto damaged = file;
    damaged[offset] = value;
    seal(damaged);
    assert(!validate(damaged, 512, 32));
  };
  reject(3, 2);                               // version
  reject(7, 1);                               // reserved header byte
  reject(recordOffset(0) + 48, 2);            // folder slot out of range
  reject(recordOffset(0) + 49, 0x10);         // unknown flag
  reject(recordOffset(0) + 50, 1);            // reserved record bytes
  reject(recordOffset(0) + kIdBytes, 0);      // empty name
  reject(folderOffset(2, 0), 0);              // empty folder
  auto unterminated = file;
  memset(unterminated.data() + recordOffset(0) + kIdBytes, 'A', kNameBytes);
  seal(unterminated);
  assert(!validate(unterminated, 512, 32));
  auto zeroId = file;
  memset(zeroId.data() + recordOffset(1), 0, kIdBytes);
  seal(zeroId);
  assert(!validate(zeroId, 512, 32));
  // Capacity limits come from the firmware, not the file.
  assert(!validate(file, 1, 32));
  assert(!validate(file, 512, 1));
  // Truncated and extended files are rejected.
  auto shorter = file;
  shorter.pop_back();
  assert(!validate(shorter, 512, 32));
  auto longer = file;
  longer.push_back(0);
  assert(!validate(longer, 512, 32));
  // Records require a folder table; an empty catalog does not.
  assert(validate(encode({}, {}, 0, 0), 512, 32));
}

void testNames() {
  uint8_t id[kIdBytes];
  assert(parseCanonicalFileName("0585D8D1E4BCC54F1C3E6F71C3E16262.hsp", id) && id[0] == 0x05 && id[15] == 0x62);
  assert(parseCanonicalFileName("/presets/0585D8D1E4BCC54F1C3E6F71C3E16262.hsp", id));
  assert(!parseCanonicalFileName("0585d8d1e4bcc54f1c3e6f71c3e16262.hsp", id));  // lower case
  assert(!parseCanonicalFileName("0585D8D1E4BCC54F1C3E6F71C3E16262.hsp.tmp", id));
  assert(!parseCanonicalFileName("0585D8D1E4BCC54F1C3E6F71C3E1626.hsp", id));
  assert(!parseCanonicalFileName("00000000000000000000000000000000.hsp", id));
  assert(!parseCanonicalFileName("0585D8D1E4BCC54F1C3E6F71C3E1626G.hsp", id));
  // Directory hashes are order independent sums.
  uint8_t a[kIdBytes] = {1}, b[kIdBytes] = {2};
  assert(idHash(a) + idHash(b) == idHash(b) + idHash(a));
  assert(idHash(a) != idHash(b));
}

void testFolderTable() {
  FolderTable<2> table;
  assert(table.findOrAdd("Pads") == 0);
  assert(table.findOrAdd("Leads") == 1);
  assert(table.findOrAdd("Pads") == 0);
  assert(table.findOrAdd("Basses") == -1);
  assert(table.find("Leads") == 1 && table.find("Basses") == -1);
}

// Decodes a generator-written index and checks it against the preset files.
int checkFactoryIndex(const char* indexPath, int fileCount, char** files) {
  std::ifstream input(indexPath, std::ios::binary);
  std::vector<uint8_t> file((std::istreambuf_iterator<char>(input)), std::istreambuf_iterator<char>());
  std::vector<Record> records;
  std::vector<std::string> folders;
  if (!validate(file, 512, 32, &records, &folders)) return 2;
  Header header;
  decodeHeader(file.data(), header, 512, 32);
  if (records.size() != static_cast<size_t>(fileCount) || header.directoryCount != fileCount) return 3;
  uint32_t hash = 0;
  std::set<std::string> ids;
  for (int i = 0; i < fileCount; ++i) {
    uint8_t id[kIdBytes];
    if (!parseCanonicalFileName(files[i], id)) return 4;
    hash += idHash(id);
    ids.insert(std::string(reinterpret_cast<char*>(id), kIdBytes));
  }
  for (const Record& r : records) {
    if (!ids.count(std::string(reinterpret_cast<const char*>(r.id), kIdBytes))) return 5;
    printf("%s\t%s\n", folders[r.folder].c_str(), r.name);
  }
  return hash == header.directoryHash ? 0 : 6;
}
}  // namespace

int main(int argc, char** argv) {
  if (argc > 1) return checkFactoryIndex(argv[1], argc - 2, argv + 2);
  testRoundTripAndRejection();
  testNames();
  testFolderTable();
  return 0;
}
