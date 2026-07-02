#pragma once

#include "../FirmwareModule.h"

namespace sequencer {

constexpr const char* kSequenceStorageRoot = "/Sequences";
constexpr const char* kSequenceCurrentPathFile = "/Sequences/.current";
constexpr const char* kSequenceFileExtension = ".hbseq";
constexpr size_t kSequencePathLength = 255;
constexpr size_t kSequenceNameLength = 20;
constexpr size_t kSequenceTitleLength = 48;

bool ensureSequenceStorageRoot();
void initializeSequenceStorage();
void restoreRememberedSequenceAtStartup();

bool saveSequenceToPath(const char* path);
bool saveSequenceToCurrentPath();
bool loadSequenceFromPath(const char* path, bool rememberPath);
void newBlankSequence();
bool revertSequence();

void markSequenceDirty();
void clearSequenceDirty();
bool sequenceDirty();
const char* sequenceTitle();
uint32_t sequenceTitleVersion();

bool hasCurrentSequencePath();
const char* currentSequencePath();
void setCurrentSequencePath(const char* path);
void clearCurrentSequencePath();

void extractSequenceLeafName(const char* path, char* output, size_t outputLength);
void extractSequenceDisplayName(const char* path, char* output, size_t outputLength);
void extractSequenceParentPath(const char* path, char* output, size_t outputLength);
void joinSequencePath(const char* directoryPath, const char* leafName, char* output, size_t outputLength);
bool sequencePathIsRoot(const char* path);
bool sequencePathIsFile(const char* path);
bool sequencePathIsWithinFolder(const char* path, const char* folderPath);
bool sequencePathIsSafeStoragePath(const char* path);
int compareSequenceNamesIgnoreCase(const char* left, const char* right);

}  // namespace sequencer
