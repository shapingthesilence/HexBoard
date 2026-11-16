#include "TypingKeyboard.h"
#include "../storage/PresetSync.h"
#include "../storage/Settings.h"
#include "../storage/StorageHealth.h"
#include "../storage/SynthPresetStorage.h"

namespace {
TypingPresetMetadata catalog[TYPING_PRESET_COUNT];
void pathFor(uint16_t slot, char (&path)[24]) {
  snprintf(path, sizeof(path), "/typing/%02u.hkb", static_cast<unsigned>(slot));
}
void remember(uint16_t slot, const TypingPreset& preset) {
  catalog[slot].valid = true;
  memcpy(catalog[slot].name, preset.name, sizeof(preset.name));
  memcpy(catalog[slot].objectId, preset.objectId, sizeof(preset.objectId));
}
}

const TypingPresetMetadata* typingPresetMetadata(uint16_t slot) {
  return slot < TYPING_PRESET_COUNT && catalog[slot].valid ? &catalog[slot] : nullptr;
}

bool parseTypingPreset(const std::vector<uint8_t>& body, TypingPreset& preset) {
  if (body.size() < 8 || body.size() > TYPING_PRESET_MAX_BYTES
      || memcmp(body.data(), "HBS1", 4) || body[4] != PRESET_SYNC_OBJECT_TYPE_TYPING_PRESET
      || body[5] != 1 || body[6] != 0 || body[7] != 0) return false;
  preset = TypingPreset{};
  uint8_t seen = 0;
  for (size_t pos = 8; pos < body.size();) {
    if (pos + 3 > body.size()) return false;
    uint8_t tag = body[pos];
    size_t length = presetSyncReadU16LE(body.data() + pos + 1);
    pos += 3;
    if (pos + length > body.size()) return false;
    const uint8_t* value = body.data() + pos;
    uint8_t bit = 0;
    switch (tag) {
      case 1:
        bit = 1;
        if (!length || length >= sizeof(preset.name)) return false;
        for (size_t i = 0; i < length; ++i) if (value[i] < 32 || value[i] > 126) return false;
        memcpy(preset.name, value, length);
        break;
      case 2:
        bit = 2;
        if (length != sizeof(preset.objectId)) return false;
        memcpy(preset.objectId, value, length);
        break;
      case 0x20:
        bit = 4;
        if (length != sizeof(preset.keys)) return false;
        memcpy(preset.keys, value, length);
        for (const auto& key : preset.keys) {
          const auto usage = key[0];
          if (usage != 0 && !(usage >= 4 && usage <= 0x73) && !(usage >= 0xe0 && usage <= 0xe7)) return false;
        }
        break;
      case 0x21:
        bit = 8;
        if (length != sizeof(preset.colors)) return false;
        memcpy(preset.colors, value, length);
        break;
      case 0x22:
        bit = 16;
        if (length != 1 || !(value[0] <= 3 || (value[0] >= 6 && value[0] <= 8) || value[0] == 10)) return false;
        preset.animation = value[0];
        break;
      case 0x23:
        bit = 32;
        if (length != 1 || value[0] > 3) return false;
        preset.rotation = value[0];
        break;
      default: return false;
    }
    if (seen & bit) return false;
    seen |= bit;
    pos += length;
  }
  return (seen & 31) == 31 && std::any_of(std::begin(preset.objectId), std::end(preset.objectId), [](uint8_t b) { return b != 0; });
}

bool readTypingPreset(uint16_t slot, TypingPreset& preset, std::vector<uint8_t>* body) {
  if (!fileSystemExists || slot >= TYPING_PRESET_COUNT) return false;
  char path[24]; pathFor(slot, path);
  if (!LittleFS.exists(path)) return false;
  File file = LittleFS.open(path, "r");
  if (!file || file.size() < 12 || file.size() > TYPING_PRESET_MAX_BYTES + 4) {
    reportStorageHealthIssue(path, "typing open/length"); return false;
  }
  std::vector<uint8_t> raw(file.size() - 4);
  uint8_t checksum[4];
  if (file.read(raw.data(), raw.size()) != static_cast<int>(raw.size()) || file.read(checksum, 4) != 4) {
    reportStorageHealthIssue(path, "typing read"); return false;
  }
  if (crc32(raw.data(), raw.size()) != presetSyncReadU32LE(checksum)) {
    reportStorageHealthIssue(path, "typing CRC"); return false;
  }
  if (!parseTypingPreset(raw, preset)) {
    reportStorageHealthIssue(path, "typing schema"); return false;
  }
  if (body) *body = std::move(raw);
  return true;
}

void loadTypingCatalog() {
  for (auto& entry : catalog) entry = TypingPresetMetadata{};
  if (!fileSystemExists) return;
  for (uint16_t slot = 0; slot < TYPING_PRESET_COUNT; ++slot) {
    TypingPreset preset;
    if (readTypingPreset(slot, preset)) remember(slot, preset);
  }
}

int saveTypingPreset(uint16_t handle, const TypingPreset& preset, const std::vector<uint8_t>& body) {
  if (!fileSystemExists) return -1;
  int slot = -1;
  for (uint16_t i = 0; i < TYPING_PRESET_COUNT; ++i) {
    if (catalog[i].valid && !memcmp(catalog[i].objectId, preset.objectId, 16)) slot = i;
  }
  if (handle != PRESET_SYNC_NEW_OBJECT_HANDLE) {
    if (handle >= TYPING_PRESET_COUNT || (slot >= 0 && slot != handle)) return -1;
    slot = handle;
  }
  if (slot < 0) for (uint16_t i = 0; i < TYPING_PRESET_COUNT; ++i) {
    char path[24]; pathFor(i, path);
    // Do not silently overwrite an invalid record discovered during boot.
    if (!catalog[i].valid && !LittleFS.exists(path)) { slot = i; break; }
  }
  if (slot < 0) return -1;
  char path[24]; pathFor(slot, path);
  constexpr char temporary[] = "/typing/write.tmp";
  beginFlashSafeWrite();
  bool ok = LittleFS.exists("/typing") || LittleFS.mkdir("/typing");
  File file = ok ? LittleFS.open(temporary, "w") : File();
  uint32_t checksum = crc32(body.data(), body.size());
  uint8_t bytes[] = {uint8_t(checksum), uint8_t(checksum >> 8), uint8_t(checksum >> 16), uint8_t(checksum >> 24)};
  ok = file && file.write(body.data(), body.size()) == body.size() && file.write(bytes, 4) == 4;
  file.close();
  if (ok) ok = LittleFS.rename(temporary, path);
  endFlashSafeWrite();
  if (!ok) { reportStorageHealthIssue(path, "typing write/rename"); return -1; }
  remember(slot, preset);
  return slot;
}

bool deleteTypingPreset(uint16_t slot) {
  if (!fileSystemExists || !typingPresetMetadata(slot)) return false;
  char path[24]; pathFor(slot, path);
  beginFlashSafeWrite();
  bool ok = LittleFS.remove(path);
  endFlashSafeWrite();
  if (!ok) { reportStorageHealthIssue(path, "typing delete"); return false; }
  catalog[slot] = TypingPresetMetadata{};
  syncTypingSettings();
  return true;
}
