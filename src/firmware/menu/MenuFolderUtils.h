#pragma once

#include "../FirmwareModule.h"

bool menuFolderIsRoot(const char* folderPath);
bool menuFolderEquals(const char* left, const char* right);
bool menuFolderEntryBelongsToCurrentFolder(const char* entryFolderPath, const char* currentFolderPath);
bool menuFolderImmediateChildPath(const char* entryFolderPath,
                                  const char* currentFolderPath,
                                  char* output,
                                  size_t outputLength);
void menuFolderParentPath(const char* folderPath, char* output, size_t outputLength);
