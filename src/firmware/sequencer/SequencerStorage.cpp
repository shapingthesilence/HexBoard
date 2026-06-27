#include "SequencerStorage.h"

#include "../config/FeatureFlags.h"

#if HEXBOARD_ENABLE_SEQUENCER

#include <ctype.h>
#include <stdlib.h>
#include <string.h>

#include "../model/ScalePalettePreset.h"
#include "../storage/Settings.h"
#include "SequencerInput.h"
#include "SequencerManagedNotes.h"
#include "SequencerOverlay.h"
#include "SequencerPlaybackSettings.h"
#include "SequencerState.h"
#include "SequencerTools.h"
#include "SequencerTransport.h"

namespace sequencer {
namespace {

constexpr byte kSequenceFileVersion = 3;
constexpr size_t kLineLength = 128;

struct SequenceDocument {
  SequencerStepSnapshot steps[kStepCount];
  byte tempo = kPlaybackTempoDefault;
  byte activeSteps = kActiveStepCountDefault;
  byte direction = kDirectionDefault;
  byte playType = kPlayTypeDefault;
};

char g_currentPath[kSequencePathLength] = "";
char g_title[kSequenceTitleLength] = "Sequencer";
bool g_dirty = false;
bool g_initialized = false;
uint32_t g_titleVersion = 1;

void copyString(char* destination, size_t destinationLength, const char* source) {
  if (destinationLength == 0) {
    return;
  }

  if (source == nullptr) {
    destination[0] = '\0';
    return;
  }

  strncpy(destination, source, destinationLength - 1);
  destination[destinationLength - 1] = '\0';
}

bool appendToPath(char* path, size_t pathLength, const char* suffix) {
  const size_t used = strlen(path);
  const size_t suffixLength = strlen(suffix);
  if (used + suffixLength >= pathLength) {
    return false;
  }
  memcpy(path + used, suffix, suffixLength + 1);
  return true;
}

bool startsWith(const char* value, const char* prefix) {
  return strncmp(value, prefix, strlen(prefix)) == 0;
}

bool endsWithIgnoreCase(const char* value, const char* suffix) {
  const size_t valueLength = strlen(value);
  const size_t suffixLength = strlen(suffix);
  if (suffixLength > valueLength) {
    return false;
  }

  const char* tail = value + valueLength - suffixLength;
  for (size_t i = 0; i < suffixLength; ++i) {
    if (tolower(static_cast<unsigned char>(tail[i])) !=
        tolower(static_cast<unsigned char>(suffix[i]))) {
      return false;
    }
  }
  return true;
}

void updateSequenceTitle() {
  char nextTitle[kSequenceTitleLength] = "";
  if (g_currentPath[0] == '\0') {
    snprintf(nextTitle, sizeof(nextTitle), "Seq-%sNew", g_dirty ? "*" : "");
  } else {
    char name[kSequenceNameLength + 1] = "";
    extractSequenceDisplayName(g_currentPath, name, sizeof(name));
    if (name[0] == '\0') {
      copyString(name, sizeof(name), "Untitled");
    }
    snprintf(nextTitle, sizeof(nextTitle), "Seq-%s%s", g_dirty ? "*" : "", name);
  }

  if (strcmp(g_title, nextTitle) != 0) {
    copyString(g_title, sizeof(g_title), nextTitle);
    ++g_titleVersion;
  }
}

void setDirtyState(bool dirty) {
  if (g_dirty == dirty) {
    return;
  }
  g_dirty = dirty;
  updateSequenceTitle();
}

bool writeRememberedCurrentPath() {
  if (!ensureSequenceStorageRoot()) {
    return false;
  }

  if (g_currentPath[0] == '\0') {
    if (LittleFS.exists(kSequenceCurrentPathFile)) {
      LittleFS.remove(kSequenceCurrentPathFile);
    }
    return true;
  }

  File file = LittleFS.open(kSequenceCurrentPathFile, "w");
  if (!file) {
    return false;
  }
  file.println(g_currentPath);
  file.close();
  return true;
}

bool readRememberedCurrentPath(char* output, size_t outputLength) {
  if (outputLength == 0) {
    return false;
  }
  output[0] = '\0';
  if (!LittleFS.exists(kSequenceCurrentPathFile)) {
    return false;
  }

  File file = LittleFS.open(kSequenceCurrentPathFile, "r");
  if (!file) {
    return false;
  }

  size_t index = 0;
  while (file.available()) {
    const int value = file.read();
    if (value < 0 || value == '\n' || value == '\r') {
      break;
    }
    if (index + 1 < outputLength) {
      output[index++] = static_cast<char>(value);
    }
  }
  output[index] = '\0';
  file.close();
  return output[0] != '\0';
}

void trimInPlace(char* value) {
  if (value == nullptr) {
    return;
  }

  char* start = value;
  while (*start != '\0' && isspace(static_cast<unsigned char>(*start))) {
    ++start;
  }

  char* end = start + strlen(start);
  while (end > start && isspace(static_cast<unsigned char>(end[-1]))) {
    --end;
  }
  *end = '\0';

  if (start != value) {
    memmove(value, start, strlen(start) + 1);
  }
}

bool readLine(File& file, char* output, size_t outputLength) {
  if (outputLength == 0 || !file.available()) {
    return false;
  }

  size_t index = 0;
  bool readAny = false;
  while (file.available()) {
    const int value = file.read();
    if (value < 0) {
      break;
    }
    readAny = true;
    if (value == '\n') {
      break;
    }
    if (value == '\r') {
      continue;
    }
    if (index + 1 < outputLength) {
      output[index++] = static_cast<char>(value);
    }
  }
  output[index] = '\0';
  return readAny;
}

long parseLongClamped(const char* value, long fallback, long minimum, long maximum) {
  if (value == nullptr) {
    return fallback;
  }

  char* end = nullptr;
  const long parsed = strtol(value, &end, 10);
  if (end == value) {
    return fallback;
  }
  if (parsed < minimum) {
    return minimum;
  }
  if (parsed > maximum) {
    return maximum;
  }
  return parsed;
}

bool parseBoolValue(const char* value, bool fallback) {
  if (value == nullptr) {
    return fallback;
  }
  if (strcmp(value, "1") == 0 || strcasecmp(value, "true") == 0 ||
      strcasecmp(value, "on") == 0) {
    return true;
  }
  if (strcmp(value, "0") == 0 || strcasecmp(value, "false") == 0 ||
      strcasecmp(value, "off") == 0) {
    return false;
  }
  return fallback;
}

bool parseStepKey(const char* key, const char* prefix, byte& stepIndex) {
  const size_t prefixLength = strlen(prefix);
  if (strncmp(key, prefix, prefixLength) != 0) {
    return false;
  }

  const long stepNumber = parseLongClamped(key + prefixLength, -1, 1, kStepCount);
  if (stepNumber < 1 || stepNumber > kStepCount) {
    return false;
  }
  stepIndex = static_cast<byte>(stepNumber - 1);
  return true;
}

void resetDocumentToDefaults(SequenceDocument& document) {
  for (byte i = 0; i < kStepCount; ++i) {
    document.steps[i].noteCount = 0;
    for (byte note = 0; note < kMaxNotesPerStep; ++note) {
      document.steps[i].pitchSteps[note] = 0;
    }
    document.steps[i].gatePercent = kDefaultGatePercent;
    document.steps[i].velocity = kDefaultVelocity;
    document.steps[i].probability = kDefaultProbability;
    document.steps[i].tie = false;
  }
  document.tempo = kPlaybackTempoDefault;
  document.activeSteps = kActiveStepCountDefault;
  document.direction = kDirectionDefault;
  document.playType = kPlayTypeDefault;
}

void captureCurrentDocument(SequenceDocument& document) {
  for (byte i = 0; i < kStepCount; ++i) {
    snapshotStep(i, document.steps[i]);
  }
  document.tempo = playbackTempo();
  document.activeSteps = activeStepCount();
  document.direction = playbackDirection();
  document.playType = playType();
}

void applyDocument(const SequenceDocument& document) {
  stopTransport();
  stopAllManagedNotes();
  resetInputState();
  resetToolsState();
  resetOverlayState();

  resetAllSteps();
  for (byte i = 0; i < kStepCount; ++i) {
    restoreStep(i, document.steps[i]);
  }

  playbackTempoMutable() = document.tempo;
  activeStepCountMutable() = document.activeSteps;
  playbackDirectionMutable() = document.direction;
  playTypeMutable() = document.playType;
  normalizePlaybackSettings();
}

bool writeSequenceDocument(File& file, const SequenceDocument& document) {
  file.println("format=HBSEQ");
  file.print("version=");
  file.println(kSequenceFileVersion);
  file.println("noteFormat=stepsFromC");
  file.print("tempo=");
  file.println(document.tempo);
  file.print("steps=");
  file.println(document.activeSteps);
  file.print("playType=");
  file.println(document.playType);
  file.print("direction=");
  file.println(document.direction);

  for (byte i = 0; i < kStepCount; ++i) {
    const SequencerStepSnapshot& stepData = document.steps[i];
    const byte stepNumber = i + 1;
    file.print("step");
    file.print(stepNumber);
    file.print("=");
    for (byte note = 0; note < stepData.noteCount && note < kMaxNotesPerStep; ++note) {
      if (note > 0) {
        file.print(",");
      }
      file.print(stepData.pitchSteps[note]);
    }
    file.println();

    file.print("gate");
    file.print(stepNumber);
    file.print("=");
    file.println(stepData.gatePercent);

    file.print("vel");
    file.print(stepNumber);
    file.print("=");
    file.println(stepData.velocity);

    file.print("prob");
    file.print(stepNumber);
    file.print("=");
    file.println(stepData.probability);

    file.print("tie");
    file.print(stepNumber);
    file.print("=");
    file.println(stepData.tie ? 1 : 0);
  }

  return true;
}

void parseStepNotes(SequenceDocument& document,
                    byte stepIndex,
                    const char* value,
                    bool noteFormatStepsFromC) {
  document.steps[stepIndex].noteCount = 0;
  if (value == nullptr || value[0] == '\0') {
    return;
  }

  const char* cursor = value;
  while (*cursor != '\0' && document.steps[stepIndex].noteCount < kMaxNotesPerStep) {
    while (*cursor == ' ' || *cursor == ',') {
      ++cursor;
    }
    if (*cursor == '\0') {
      break;
    }

    char* end = nullptr;
    long parsed = strtol(cursor, &end, 10);
    if (end == cursor) {
      break;
    }

    if (!noteFormatStepsFromC) {
      parsed = parsed - 60 - current.transpose;
    }
    if (parsed < INT16_MIN) {
      parsed = INT16_MIN;
    } else if (parsed > INT16_MAX) {
      parsed = INT16_MAX;
    }

    document.steps[stepIndex].pitchSteps[document.steps[stepIndex].noteCount++] =
      static_cast<int16_t>(parsed);
    cursor = end;
  }
}

bool parseSequenceDocument(File& file, SequenceDocument& document) {
  resetDocumentToDefaults(document);

  bool formatOk = false;
  bool noteFormatStepsFromC = true;
  int fileVersion = 0;

  char line[kLineLength];
  while (readLine(file, line, sizeof(line))) {
    trimInPlace(line);
    if (line[0] == '\0' || line[0] == '#') {
      continue;
    }

    char* separator = strchr(line, '=');
    if (separator == nullptr) {
      continue;
    }
    *separator = '\0';
    char* key = line;
    char* value = separator + 1;
    trimInPlace(key);
    trimInPlace(value);

    if (strcmp(key, "format") == 0) {
      formatOk = strcmp(value, "HBSEQ") == 0;
      continue;
    }
    if (strcmp(key, "version") == 0) {
      fileVersion = parseLongClamped(value, fileVersion, 0, kSequenceFileVersion);
      continue;
    }
    if (strcmp(key, "noteFormat") == 0) {
      noteFormatStepsFromC = strcmp(value, "stepsFromC") == 0;
      continue;
    }
    if (strcmp(key, "tempo") == 0) {
      document.tempo = static_cast<byte>(
        parseLongClamped(value, kPlaybackTempoDefault, kPlaybackTempoMin, kPlaybackTempoMax));
      continue;
    }
    if (strcmp(key, "steps") == 0) {
      document.activeSteps =
        static_cast<byte>(parseLongClamped(value, kActiveStepCountDefault, 1, kStepCount));
      continue;
    }
    if (strcmp(key, "playType") == 0) {
      document.playType =
        static_cast<byte>(parseLongClamped(value, kPlayTypeDefault, kPlayTypeMidi, kPlayTypeObSynth));
      continue;
    }
    if (strcmp(key, "direction") == 0) {
      document.direction =
        static_cast<byte>(parseLongClamped(value, kDirectionDefault, kDirectionForward, kDirectionDrunk));
      continue;
    }

    byte stepIndex = 0;
    if (parseStepKey(key, "step", stepIndex)) {
      parseStepNotes(document, stepIndex, value, noteFormatStepsFromC || fileVersion >= 2);
    } else if (parseStepKey(key, "gate", stepIndex)) {
      document.steps[stepIndex].gatePercent =
        static_cast<uint16_t>(parseLongClamped(value, kDefaultGatePercent, 0, 1000));
    } else if (parseStepKey(key, "vel", stepIndex)) {
      document.steps[stepIndex].velocity =
        static_cast<byte>(parseLongClamped(value, kDefaultVelocity, 0, 127));
    } else if (parseStepKey(key, "prob", stepIndex)) {
      document.steps[stepIndex].probability =
        static_cast<byte>(parseLongClamped(value, kDefaultProbability, 0, 100));
    } else if (parseStepKey(key, "tie", stepIndex)) {
      document.steps[stepIndex].tie = parseBoolValue(value, false);
    }
  }

  return formatOk;
}

void resetSequenceOwnedDataToDefaults() {
  SequenceDocument document;
  resetDocumentToDefaults(document);
  applyDocument(document);
}

bool pathContainsUnsafeSegment(const char* path) {
  if (path == nullptr || path[0] == '\0') {
    return true;
  }
  if (strstr(path, "..") != nullptr) {
    return true;
  }
  return false;
}

}  // namespace

bool ensureSequenceStorageRoot() {
  if (!fileSystemExists) {
    return false;
  }
  if (LittleFS.exists(kSequenceStorageRoot)) {
    return true;
  }
  return LittleFS.mkdir(kSequenceStorageRoot);
}

void initializeSequenceStorage() {
  if (g_initialized) {
    return;
  }
  ensureSequenceStorageRoot();
  updateSequenceTitle();
  g_initialized = true;
}

void restoreRememberedSequenceAtStartup() {
  initializeSequenceStorage();

  char rememberedPath[kSequencePathLength] = "";
  if (!readRememberedCurrentPath(rememberedPath, sizeof(rememberedPath)) ||
      !sequencePathIsSafeStoragePath(rememberedPath) || !sequencePathIsFile(rememberedPath) ||
      !LittleFS.exists(rememberedPath) || !loadSequenceFromPath(rememberedPath, true)) {
    resetSequenceOwnedDataToDefaults();
    clearCurrentSequencePath();
    clearSequenceDirty();
  }
}

bool saveSequenceToPath(const char* path) {
  initializeSequenceStorage();
  if (!sequencePathIsSafeStoragePath(path) || !sequencePathIsFile(path)) {
    return false;
  }

  char tempPath[kSequencePathLength] = "";
  copyString(tempPath, sizeof(tempPath), path);
  if (!appendToPath(tempPath, sizeof(tempPath), ".tmp")) {
    return false;
  }

  if (LittleFS.exists(tempPath)) {
    LittleFS.remove(tempPath);
  }

  SequenceDocument document;
  captureCurrentDocument(document);

  File file = LittleFS.open(tempPath, "w");
  if (!file) {
    return false;
  }
  writeSequenceDocument(file, document);
  file.flush();
  file.close();

  if (LittleFS.exists(path) && !LittleFS.remove(path)) {
    LittleFS.remove(tempPath);
    return false;
  }
  if (!LittleFS.rename(tempPath, path)) {
    LittleFS.remove(tempPath);
    return false;
  }

  setCurrentSequencePath(path);
  clearSequenceDirty();
  return true;
}

bool saveSequenceToCurrentPath() {
  if (g_currentPath[0] == '\0') {
    return false;
  }
  return saveSequenceToPath(g_currentPath);
}

bool loadSequenceFromPath(const char* path, bool rememberPath) {
  initializeSequenceStorage();
  if (!sequencePathIsSafeStoragePath(path) || !sequencePathIsFile(path) || !LittleFS.exists(path)) {
    return false;
  }

  File file = LittleFS.open(path, "r");
  if (!file) {
    return false;
  }

  SequenceDocument document;
  const bool ok = parseSequenceDocument(file, document);
  file.close();
  if (!ok) {
    return false;
  }

  applyDocument(document);
  if (rememberPath) {
    setCurrentSequencePath(path);
  }
  clearSequenceDirty();
  return true;
}

void newBlankSequence() {
  initializeSequenceStorage();
  resetSequenceOwnedDataToDefaults();
  clearCurrentSequencePath();
  clearSequenceDirty();
}

bool revertSequence() {
  initializeSequenceStorage();
  if (g_currentPath[0] == '\0') {
    resetSequenceOwnedDataToDefaults();
    clearSequenceDirty();
    return true;
  }
  return loadSequenceFromPath(g_currentPath, true);
}

void markSequenceDirty() {
  initializeSequenceStorage();
  setDirtyState(true);
}

void clearSequenceDirty() {
  initializeSequenceStorage();
  setDirtyState(false);
}

bool sequenceDirty() {
  return g_dirty;
}

const char* sequenceTitle() {
  initializeSequenceStorage();
  return g_title;
}

uint32_t sequenceTitleVersion() {
  return g_titleVersion;
}

bool hasCurrentSequencePath() {
  return g_currentPath[0] != '\0';
}

const char* currentSequencePath() {
  return g_currentPath;
}

void setCurrentSequencePath(const char* path) {
  if (path == nullptr || path[0] == '\0') {
    clearCurrentSequencePath();
    return;
  }
  if (!sequencePathIsSafeStoragePath(path) || !sequencePathIsFile(path)) {
    return;
  }
  copyString(g_currentPath, sizeof(g_currentPath), path);
  writeRememberedCurrentPath();
  updateSequenceTitle();
}

void clearCurrentSequencePath() {
  if (g_currentPath[0] != '\0') {
    g_currentPath[0] = '\0';
    updateSequenceTitle();
  }
  writeRememberedCurrentPath();
}

void extractSequenceLeafName(const char* path, char* output, size_t outputLength) {
  if (outputLength == 0) {
    return;
  }
  output[0] = '\0';
  if (path == nullptr) {
    return;
  }

  const char* leaf = strrchr(path, '/');
  leaf = leaf == nullptr ? path : leaf + 1;
  copyString(output, outputLength, leaf);
}

void extractSequenceDisplayName(const char* path, char* output, size_t outputLength) {
  extractSequenceLeafName(path, output, outputLength);
  const size_t length = strlen(output);
  const size_t extensionLength = strlen(kSequenceFileExtension);
  if (length > extensionLength && endsWithIgnoreCase(output, kSequenceFileExtension)) {
    output[length - extensionLength] = '\0';
  }
}

void extractSequenceParentPath(const char* path, char* output, size_t outputLength) {
  if (outputLength == 0) {
    return;
  }
  output[0] = '\0';
  if (path == nullptr || path[0] == '\0') {
    return;
  }

  copyString(output, outputLength, path);
  char* slash = strrchr(output, '/');
  if (slash == nullptr || slash == output) {
    copyString(output, outputLength, kSequenceStorageRoot);
    return;
  }
  *slash = '\0';
}

void joinSequencePath(const char* directoryPath, const char* leafName, char* output, size_t outputLength) {
  if (outputLength == 0) {
    return;
  }
  output[0] = '\0';
  if (directoryPath == nullptr || leafName == nullptr || directoryPath[0] == '\0' ||
      leafName[0] == '\0') {
    return;
  }

  copyString(output, outputLength, directoryPath);
  if (output[0] != '\0' && output[strlen(output) - 1] != '/') {
    appendToPath(output, outputLength, "/");
  }
  appendToPath(output, outputLength, leafName);
}

bool sequencePathIsRoot(const char* path) {
  return path != nullptr && strcmp(path, kSequenceStorageRoot) == 0;
}

bool sequencePathIsFile(const char* path) {
  return path != nullptr && endsWithIgnoreCase(path, kSequenceFileExtension);
}

bool sequencePathIsWithinFolder(const char* path, const char* folderPath) {
  if (path == nullptr || folderPath == nullptr || folderPath[0] == '\0') {
    return false;
  }
  const size_t folderLength = strlen(folderPath);
  if (strncmp(path, folderPath, folderLength) != 0) {
    return false;
  }
  return path[folderLength] == '/' || path[folderLength] == '\0';
}

bool sequencePathIsSafeStoragePath(const char* path) {
  if (pathContainsUnsafeSegment(path)) {
    return false;
  }
  if (!startsWith(path, kSequenceStorageRoot)) {
    return false;
  }
  const size_t rootLength = strlen(kSequenceStorageRoot);
  return path[rootLength] == '\0' || path[rootLength] == '/';
}

int compareSequenceNamesIgnoreCase(const char* left, const char* right) {
  if (left == nullptr) {
    left = "";
  }
  if (right == nullptr) {
    right = "";
  }

  while (*left != '\0' && *right != '\0') {
    const int lc = tolower(static_cast<unsigned char>(*left));
    const int rc = tolower(static_cast<unsigned char>(*right));
    if (lc != rc) {
      return lc - rc;
    }
    ++left;
    ++right;
  }
  return static_cast<unsigned char>(*left) - static_cast<unsigned char>(*right);
}

}  // namespace sequencer

#else

namespace sequencer {

bool ensureSequenceStorageRoot() { return false; }
void initializeSequenceStorage() {}
void restoreRememberedSequenceAtStartup() {}
bool saveSequenceToPath(const char*) { return false; }
bool saveSequenceToCurrentPath() { return false; }
bool loadSequenceFromPath(const char*, bool) { return false; }
void newBlankSequence() {}
bool revertSequence() { return false; }
void markSequenceDirty() {}
void clearSequenceDirty() {}
bool sequenceDirty() { return false; }
const char* sequenceTitle() { return "Seq-New"; }
uint32_t sequenceTitleVersion() { return 0; }
bool hasCurrentSequencePath() { return false; }
const char* currentSequencePath() { return ""; }
void setCurrentSequencePath(const char*) {}
void clearCurrentSequencePath() {}
void extractSequenceLeafName(const char*, char* output, size_t outputLength) {
  if (outputLength > 0) {
    output[0] = '\0';
  }
}
void extractSequenceDisplayName(const char*, char* output, size_t outputLength) {
  if (outputLength > 0) {
    output[0] = '\0';
  }
}
void extractSequenceParentPath(const char*, char* output, size_t outputLength) {
  if (outputLength > 0) {
    output[0] = '\0';
  }
}
void joinSequencePath(const char*, const char*, char* output, size_t outputLength) {
  if (outputLength > 0) {
    output[0] = '\0';
  }
}
bool sequencePathIsRoot(const char*) { return false; }
bool sequencePathIsFile(const char*) { return false; }
bool sequencePathIsWithinFolder(const char*, const char*) { return false; }
bool sequencePathIsSafeStoragePath(const char*) { return false; }
int compareSequenceNamesIgnoreCase(const char*, const char*) { return 0; }

}  // namespace sequencer

#endif
