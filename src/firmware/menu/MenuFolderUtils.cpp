#include "../FirmwareModule.h"
#include "MenuFolderUtils.h"
#include "../storage/PersistentDataModels.h"

namespace {
void copyRoot(char* output, size_t outputLength) {
  if (outputLength == 0) {
    return;
  }
  snprintf(output, outputLength, "%s", SYNTH_PRESET_ROOT_FOLDER);
}

const char* nonNullPath(const char* folderPath) {
  return folderPath ? folderPath : "";
}

const char* nonRootPathWithoutLeadingSlash(const char* folderPath) {
  const char* path = nonNullPath(folderPath);
  while (path[0] == '/' && path[1] != '\0') {
    ++path;
  }
  return path;
}
}  // namespace

bool menuFolderIsRoot(const char* folderPath) {
  return !folderPath || !folderPath[0] || strcmp(folderPath, SYNTH_PRESET_ROOT_FOLDER) == 0;
}

bool menuFolderEquals(const char* left, const char* right) {
  bool leftRoot = menuFolderIsRoot(left);
  bool rightRoot = menuFolderIsRoot(right);
  if (leftRoot || rightRoot) {
    return leftRoot && rightRoot;
  }
  return strcmp(nonRootPathWithoutLeadingSlash(left), nonRootPathWithoutLeadingSlash(right)) == 0;
}

bool menuFolderEntryBelongsToCurrentFolder(const char* entryFolderPath, const char* currentFolderPath) {
  return menuFolderEquals(entryFolderPath, currentFolderPath);
}

bool menuFolderImmediateChildPath(const char* entryFolderPath,
                                  const char* currentFolderPath,
                                  char* output,
                                  size_t outputLength) {
  if (outputLength == 0) {
    return false;
  }
  output[0] = '\0';
  if (menuFolderIsRoot(entryFolderPath) || menuFolderEquals(entryFolderPath, currentFolderPath)) {
    return false;
  }

  const char* entry = nonNullPath(entryFolderPath);
  if (menuFolderIsRoot(currentFolderPath)) {
    const char* segmentStart = entry[0] == '/' ? entry + 1 : entry;
    if (!segmentStart[0]) {
      return false;
    }
    const char* slash = strchr(segmentStart, '/');
    size_t segmentLength = slash ? static_cast<size_t>(slash - segmentStart) : strlen(segmentStart);
    if (segmentLength == 0) {
      return false;
    }
    size_t copyLength = std::min(segmentLength, outputLength - 1);
    memcpy(output, segmentStart, copyLength);
    output[copyLength] = '\0';
    return true;
  }

  const char* current = nonRootPathWithoutLeadingSlash(currentFolderPath);
  entry = nonRootPathWithoutLeadingSlash(entry);
  size_t currentLength = strlen(current);
  if (strncmp(entry, current, currentLength) != 0 || entry[currentLength] != '/') {
    return false;
  }

  const char* segmentStart = entry + currentLength + 1;
  if (!segmentStart[0]) {
    return false;
  }
  const char* slash = strchr(segmentStart, '/');
  size_t segmentLength = slash ? static_cast<size_t>(slash - segmentStart) : strlen(segmentStart);
  if (segmentLength == 0) {
    return false;
  }

  size_t outputIndex = std::min(currentLength, outputLength - 1);
  memcpy(output, current, outputIndex);
  output[outputIndex] = '\0';
  if (outputIndex + 1 < outputLength) {
    output[outputIndex++] = '/';
    output[outputIndex] = '\0';
  }
  size_t remaining = outputLength - 1 - outputIndex;
  size_t copyLength = std::min(segmentLength, remaining);
  memcpy(output + outputIndex, segmentStart, copyLength);
  output[outputIndex + copyLength] = '\0';
  return true;
}

void menuFolderParentPath(const char* folderPath, char* output, size_t outputLength) {
  if (outputLength == 0) {
    return;
  }
  if (menuFolderIsRoot(folderPath)) {
    copyRoot(output, outputLength);
    return;
  }
  const char* slash = strrchr(folderPath, '/');
  if (!slash || slash == folderPath) {
    copyRoot(output, outputLength);
    return;
  }
  size_t length = std::min(static_cast<size_t>(slash - folderPath), outputLength - 1);
  memmove(output, folderPath, length);
  output[length] = '\0';
}
