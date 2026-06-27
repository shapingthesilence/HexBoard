#include "SequencerUsbBackup.h"

#include "../config/FeatureFlags.h"

#if HEXBOARD_ENABLE_SEQUENCER

#include <atomic>
#include <ctype.h>
#include <stdlib.h>
#include <string.h>

#include "../app/DiagnosticsTiming.h"
#include "../storage/Settings.h"
#include "../synth/SynthAudio.h"
#include "SequencerStorage.h"

namespace sequencer {
namespace {

constexpr uint32_t kUsbBackupTransferTimeoutMs = 15000;
constexpr size_t kUsbBackupCommandBufferSize = 320;
constexpr size_t kUsbBackupPathBufferSize = 256;
constexpr size_t kUsbBackupTempPathBufferSize = 288;
constexpr size_t kUsbBackupStatusLineSize = 24;
constexpr size_t kUsbBackupIoBufferSize = 128;
constexpr const char* kUsbBackupProtocol = "HBK1";

enum class ReceiveState : uint8_t {
  Command = 0,
  PutPayload = 1
};

bool g_active = false;
bool g_serialDebugSuppressedForSession = false;
bool g_uiRefreshRequested = false;
char g_statusLineOne[kUsbBackupStatusLineSize] = "USB Backup Off";
char g_statusLineTwo[kUsbBackupStatusLineSize] = "Host tool idle";
ReceiveState g_receiveState = ReceiveState::Command;
char g_commandBuffer[kUsbBackupCommandBufferSize] = {};
size_t g_commandLength = 0;
uint32_t g_lastIoAt = 0;
File g_incomingFile;
char g_incomingFinalPath[kUsbBackupPathBufferSize] = {};
char g_incomingTempPath[kUsbBackupTempPathBufferSize] = {};
size_t g_incomingBytesRemaining = 0;

void setStatus(const char* lineOne, const char* lineTwo) {
  snprintf(g_statusLineOne, sizeof(g_statusLineOne), "%s", lineOne != nullptr ? lineOne : "");
  snprintf(g_statusLineTwo, sizeof(g_statusLineTwo), "%s", lineTwo != nullptr ? lineTwo : "");
  g_uiRefreshRequested = true;
}

const char* statusTextForError(const char* code) {
  if (code == nullptr) {
    return "Unknown error";
  }
  if (strcmp(code, "FILESYSTEM_UNAVAILABLE") == 0) {
    return "FS unavailable";
  }
  if (strcmp(code, "BAD_PATH") == 0) {
    return "Bad path";
  }
  if (strcmp(code, "BAD_SIZE") == 0) {
    return "Bad size";
  }
  if (strcmp(code, "MISSING_PARENT") == 0) {
    return "Missing parent";
  }
  if (strcmp(code, "PATH_TOO_LONG") == 0) {
    return "Path too long";
  }
  if (strcmp(code, "OPEN_FAILED") == 0) {
    return "Open failed";
  }
  if (strcmp(code, "WRITE_FAILED") == 0) {
    return "Write failed";
  }
  if (strcmp(code, "PATH_EXISTS") == 0) {
    return "Path exists";
  }
  if (strcmp(code, "MKDIR_FAILED") == 0) {
    return "Create failed";
  }
  if (strcmp(code, "DELETE_FAILED") == 0) {
    return "Delete failed";
  }
  if (strcmp(code, "RMDIR_FAILED") == 0) {
    return "Folder delete failed";
  }
  if (strcmp(code, "RENAME_FAILED") == 0) {
    return "Rename failed";
  }
  if (strcmp(code, "COMMAND_TOO_LONG") == 0) {
    return "Command too long";
  }
  if (strcmp(code, "UNKNOWN_COMMAND") == 0) {
    return "Unknown command";
  }
  if (strcmp(code, "TIMEOUT") == 0) {
    return "Transfer timeout";
  }
  return code;
}

void sendProtocolLine(const char* text) {
  Serial.print(text);
  Serial.print('\n');
}

void sendErrorLine(const char* code) {
  Serial.print("ERR ");
  Serial.print(code);
  Serial.print('\n');
  setStatus("Backup Error", statusTextForError(code));
}

bool pathHasExtension(const char* path, const char* extension) {
  if (path == nullptr || extension == nullptr) {
    return false;
  }
  const size_t pathLength = strlen(path);
  const size_t extensionLength = strlen(extension);
  return pathLength > extensionLength &&
         strcmp(path + pathLength - extensionLength, extension) == 0;
}

bool pathStartsWithRoot(const char* path) {
  if (path == nullptr) {
    return false;
  }
  const size_t rootLength = strlen(kSequenceStorageRoot);
  if (strncmp(path, kSequenceStorageRoot, rootLength) != 0) {
    return false;
  }
  return path[rootLength] == '\0' || path[rootLength] == '/';
}

bool pathContainsInvalidSegments(const char* path) {
  if (path == nullptr || path[0] != '/') {
    return true;
  }

  const char* segment = path + 1;
  while (*segment != '\0') {
    const char* slash = strchr(segment, '/');
    const size_t segmentLength = slash != nullptr
                                   ? static_cast<size_t>(slash - segment)
                                   : strlen(segment);
    if (segmentLength == 0) {
      return true;
    }
    if (segment[0] == '.') {
      return true;
    }
    for (size_t index = 0; index < segmentLength; ++index) {
      const unsigned char c = static_cast<unsigned char>(segment[index]);
      if (c < 32 || c == '\\') {
        return true;
      }
    }
    if (slash == nullptr) {
      break;
    }
    segment = slash + 1;
  }
  return false;
}

int hexValue(char c) {
  if (c >= '0' && c <= '9') {
    return c - '0';
  }
  if (c >= 'A' && c <= 'F') {
    return c - 'A' + 10;
  }
  if (c >= 'a' && c <= 'f') {
    return c - 'a' + 10;
  }
  return -1;
}

bool decodePathToken(const char* token, char* out, size_t outSize) {
  if (token == nullptr || out == nullptr || outSize == 0) {
    return false;
  }

  size_t outIndex = 0;
  for (size_t index = 0; token[index] != '\0'; ++index) {
    char c = token[index];
    if (c == '%') {
      if (token[index + 1] == '\0' || token[index + 2] == '\0') {
        return false;
      }
      const int hi = hexValue(token[index + 1]);
      const int lo = hexValue(token[index + 2]);
      if (hi < 0 || lo < 0) {
        return false;
      }
      c = static_cast<char>((hi << 4) | lo);
      index += 2;
    }
    if (outIndex + 1 >= outSize) {
      return false;
    }
    out[outIndex++] = c;
  }
  out[outIndex] = '\0';
  return true;
}

bool encodePathToken(const char* path, char* out, size_t outSize) {
  if (path == nullptr || out == nullptr || outSize == 0) {
    return false;
  }

  size_t outIndex = 0;
  for (size_t index = 0; path[index] != '\0'; ++index) {
    const unsigned char c = static_cast<unsigned char>(path[index]);
    const bool safe = isalnum(c) != 0 || c == '/' || c == '-' || c == '_' || c == '.';
    if (safe) {
      if (outIndex + 1 >= outSize) {
        return false;
      }
      out[outIndex++] = static_cast<char>(c);
    } else {
      if (outIndex + 3 >= outSize) {
        return false;
      }
      snprintf(out + outIndex, outSize - outIndex, "%%%02X", c);
      outIndex += 3;
    }
  }
  out[outIndex] = '\0';
  return true;
}

bool pathExistsAndIsDirectory(const char* path) {
  File f = LittleFS.open(path, "r");
  if (!f) {
    return false;
  }
  const bool isDirectory = f.isDirectory();
  f.close();
  return isDirectory;
}

bool pathExistsAndIsFile(const char* path) {
  File f = LittleFS.open(path, "r");
  if (!f) {
    return false;
  }
  const bool isFile = f.isFile();
  f.close();
  return isFile;
}

void joinBackupPath(const char* directoryPath, const char* leafName, char* out, size_t outSize) {
  if (outSize == 0) {
    return;
  }
  if (strcmp(directoryPath, "/") == 0) {
    snprintf(out, outSize, "/%s", leafName);
  } else {
    snprintf(out, outSize, "%s/%s", directoryPath, leafName);
  }
}

bool validateDirectoryPath(const char* path) {
  return path != nullptr &&
         pathStartsWithRoot(path) &&
         !pathContainsInvalidSegments(path);
}

bool validateFilePath(const char* path) {
  return validateDirectoryPath(path) &&
         pathHasExtension(path, kSequenceFileExtension);
}

bool parentDirectoryExists(const char* path) {
  char parentPath[kUsbBackupPathBufferSize];
  snprintf(parentPath, sizeof(parentPath), "%s", path);
  char* slash = strrchr(parentPath, '/');
  if (slash == nullptr || slash == parentPath) {
    snprintf(parentPath, sizeof(parentPath), "%s", kSequenceStorageRoot);
  } else {
    *slash = '\0';
  }
  return pathExistsAndIsDirectory(parentPath);
}

void suppressSerialDebugForSession() {
  if (g_serialDebugSuppressedForSession) {
    return;
  }
  setSerialDebugGeneralSuppressed(true);
  setSerialDebugPeriodicSuppressed(true);
  g_serialDebugSuppressedForSession = true;
}

void restoreSerialDebugAfterSession() {
  if (!g_serialDebugSuppressedForSession) {
    return;
  }
  setSerialDebugPeriodicSuppressed(false);
  setSerialDebugGeneralSuppressed(false);
  g_serialDebugSuppressedForSession = false;
}

void clearPendingIncomingState() {
  if (g_incomingFile) {
    g_incomingFile.close();
  }
  if (g_incomingTempPath[0] != '\0' && LittleFS.exists(g_incomingTempPath)) {
    LittleFS.remove(g_incomingTempPath);
  }
  g_incomingFinalPath[0] = '\0';
  g_incomingTempPath[0] = '\0';
  g_incomingBytesRemaining = 0;
  g_receiveState = ReceiveState::Command;
  flashWriteInProgress.store(false, std::memory_order_relaxed);
}

void finishIncomingFileWrite() {
  if (g_incomingFile) {
    g_incomingFile.flush();
    g_incomingFile.close();
  }

  bool success = true;
  if (LittleFS.exists(g_incomingFinalPath) && !LittleFS.remove(g_incomingFinalPath)) {
    success = false;
  }
  if (success && !LittleFS.rename(g_incomingTempPath, g_incomingFinalPath)) {
    success = false;
  }

  flashWriteInProgress.store(false, std::memory_order_relaxed);

  if (!success) {
    if (LittleFS.exists(g_incomingTempPath)) {
      LittleFS.remove(g_incomingTempPath);
    }
    sendErrorLine("WRITE_FAILED");
  } else {
    sendProtocolLine("OK PUT");
    setStatus("Restore OK", "File written");
  }

  g_incomingFinalPath[0] = '\0';
  g_incomingTempPath[0] = '\0';
  g_incomingBytesRemaining = 0;
  g_receiveState = ReceiveState::Command;
}

bool deleteDirectoryRecursive(const char* folderPath) {
  if (!validateDirectoryPath(folderPath) || strcmp(folderPath, kSequenceStorageRoot) == 0) {
    return false;
  }

  while (true) {
    char childPath[kUsbBackupPathBufferSize] = "";
    bool childIsFolder = false;
    bool foundChild = false;

    Dir dir = LittleFS.openDir(folderPath);
    while (dir.next()) {
      String entryName = dir.fileName();
      if (entryName.length() == 0 || entryName.startsWith(".")) {
        continue;
      }
      joinBackupPath(folderPath, entryName.c_str(), childPath, sizeof(childPath));
      childIsFolder = dir.isDirectory();
      foundChild = true;
      break;
    }

    if (!foundChild) {
      break;
    }
    if (childIsFolder) {
      if (!deleteDirectoryRecursive(childPath)) {
        return false;
      }
    } else if (!LittleFS.remove(childPath)) {
      return false;
    }
  }

  if (!LittleFS.exists(folderPath)) {
    return true;
  }
  return LittleFS.rmdir(folderPath);
}

size_t tokenizeCommand(char* line, char** tokens, size_t maxTokens) {
  size_t count = 0;
  char* current = line;
  while (*current != '\0' && count < maxTokens) {
    while (*current == ' ') {
      ++current;
    }
    if (*current == '\0') {
      break;
    }
    tokens[count++] = current;
    while (*current != '\0' && *current != ' ') {
      ++current;
    }
    if (*current == '\0') {
      break;
    }
    *current++ = '\0';
  }
  return count;
}

void handleHelloCommand() {
  if (!ensureSequenceStorageRoot()) {
    sendErrorLine("FILESYSTEM_UNAVAILABLE");
    return;
  }
  Serial.print("OK HELLO ");
  Serial.print(kUsbBackupProtocol);
  Serial.print(" ROOT ");
  Serial.print(kSequenceStorageRoot);
  Serial.print('\n');
  setStatus("Session Active", "Host connected");
}

void handleListCommand(const char* encodedPath) {
  char path[kUsbBackupPathBufferSize];
  if (!decodePathToken(encodedPath, path, sizeof(path)) ||
      !validateDirectoryPath(path) ||
      !pathExistsAndIsDirectory(path)) {
    sendErrorLine("BAD_PATH");
    return;
  }

  Dir dir = LittleFS.openDir(path);
  char encodedChild[kUsbBackupPathBufferSize * 3];
  while (dir.next()) {
    String entryName = dir.fileName();
    if (entryName.length() == 0 || entryName.startsWith(".")) {
      continue;
    }

    char childPath[kUsbBackupPathBufferSize];
    joinBackupPath(path, entryName.c_str(), childPath, sizeof(childPath));
    const bool includeEntry = dir.isDirectory() ||
                              pathHasExtension(entryName.c_str(), kSequenceFileExtension);
    if (!includeEntry || !encodePathToken(childPath, encodedChild, sizeof(encodedChild))) {
      continue;
    }

    Serial.print("ENTRY ");
    Serial.print(dir.isDirectory() ? 'D' : 'F');
    Serial.print(' ');
    Serial.print(encodedChild);
    Serial.print(' ');
    Serial.print(dir.isDirectory() ? 0 : dir.fileSize());
    Serial.print('\n');
  }

  sendProtocolLine("DONE LIST");
  setStatus("Backup Ready", "Listed files");
}

void handleGetCommand(const char* encodedPath) {
  char path[kUsbBackupPathBufferSize];
  if (!decodePathToken(encodedPath, path, sizeof(path)) ||
      !validateFilePath(path) ||
      !pathExistsAndIsFile(path)) {
    sendErrorLine("BAD_PATH");
    return;
  }

  File file = LittleFS.open(path, "r");
  if (!file) {
    sendErrorLine("OPEN_FAILED");
    return;
  }

  const size_t fileSize = file.size();
  Serial.print("OK SIZE ");
  Serial.print(fileSize);
  Serial.print('\n');

  uint8_t buffer[kUsbBackupIoBufferSize];
  while (file.available()) {
    const size_t bytesRead = file.read(buffer, sizeof(buffer));
    if (bytesRead == 0) {
      break;
    }
    Serial.write(buffer, bytesRead);
  }
  file.close();
  sendProtocolLine("DONE GET");
  setStatus("Backup Sent", "File transferred");
}

void handlePutCommand(const char* encodedPath, const char* sizeToken) {
  char path[kUsbBackupPathBufferSize];
  if (!decodePathToken(encodedPath, path, sizeof(path)) || !validateFilePath(path)) {
    sendErrorLine("BAD_PATH");
    return;
  }

  const unsigned long sizeValue = strtoul(sizeToken, nullptr, 10);
  if (sizeValue == 0 && strcmp(sizeToken, "0") != 0) {
    sendErrorLine("BAD_SIZE");
    return;
  }

  if (!parentDirectoryExists(path)) {
    sendErrorLine("MISSING_PARENT");
    return;
  }

  snprintf(g_incomingFinalPath, sizeof(g_incomingFinalPath), "%s", path);
  if (snprintf(g_incomingTempPath, sizeof(g_incomingTempPath), "%s.tmp", path) >=
      static_cast<int>(sizeof(g_incomingTempPath))) {
    sendErrorLine("PATH_TOO_LONG");
    g_incomingFinalPath[0] = '\0';
    return;
  }

  if (LittleFS.exists(g_incomingTempPath)) {
    LittleFS.remove(g_incomingTempPath);
  }

  flashWriteInProgress.store(true, std::memory_order_relaxed);
  g_incomingFile = LittleFS.open(g_incomingTempPath, "w");
  if (!g_incomingFile) {
    flashWriteInProgress.store(false, std::memory_order_relaxed);
    g_incomingFinalPath[0] = '\0';
    g_incomingTempPath[0] = '\0';
    sendErrorLine("OPEN_FAILED");
    return;
  }

  g_incomingBytesRemaining = static_cast<size_t>(sizeValue);
  g_receiveState = ReceiveState::PutPayload;
  g_lastIoAt = millis();
  sendProtocolLine("READY");
  setStatus("Restore Busy", "Receiving file");

  if (g_incomingBytesRemaining == 0) {
    finishIncomingFileWrite();
  }
}

void handleMkdirCommand(const char* encodedPath) {
  char path[kUsbBackupPathBufferSize];
  if (!decodePathToken(encodedPath, path, sizeof(path)) ||
      !validateDirectoryPath(path) ||
      strcmp(path, kSequenceStorageRoot) == 0) {
    sendErrorLine("BAD_PATH");
    return;
  }

  if (LittleFS.exists(path)) {
    if (pathExistsAndIsDirectory(path)) {
      sendProtocolLine("OK MKDIR");
      return;
    }
    sendErrorLine("PATH_EXISTS");
    return;
  }

  if (!LittleFS.mkdir(path)) {
    sendErrorLine("MKDIR_FAILED");
    return;
  }
  sendProtocolLine("OK MKDIR");
  setStatus("Restore OK", "Folder created");
}

void handleDeleteCommand(const char* encodedPath) {
  char path[kUsbBackupPathBufferSize];
  if (!decodePathToken(encodedPath, path, sizeof(path)) ||
      !validateFilePath(path) ||
      !pathExistsAndIsFile(path)) {
    sendErrorLine("BAD_PATH");
    return;
  }

  if (!LittleFS.remove(path)) {
    sendErrorLine("DELETE_FAILED");
    return;
  }
  sendProtocolLine("OK DELETE");
  setStatus("Restore OK", "File deleted");
}

void handleRmdirCommand(const char* encodedPath) {
  char path[kUsbBackupPathBufferSize];
  if (!decodePathToken(encodedPath, path, sizeof(path)) ||
      !validateDirectoryPath(path) ||
      strcmp(path, kSequenceStorageRoot) == 0 ||
      !pathExistsAndIsDirectory(path)) {
    sendErrorLine("BAD_PATH");
    return;
  }

  if (!deleteDirectoryRecursive(path)) {
    sendErrorLine("RMDIR_FAILED");
    return;
  }
  sendProtocolLine("OK RMDIR");
  setStatus("Restore OK", "Folder deleted");
}

void handleRenameCommand(const char* encodedSourcePath, const char* encodedTargetPath) {
  char sourcePath[kUsbBackupPathBufferSize];
  char targetPath[kUsbBackupPathBufferSize];
  if (!decodePathToken(encodedSourcePath, sourcePath, sizeof(sourcePath)) ||
      !decodePathToken(encodedTargetPath, targetPath, sizeof(targetPath))) {
    sendErrorLine("BAD_PATH");
    return;
  }

  const bool sourceIsFile = pathExistsAndIsFile(sourcePath);
  const bool sourceIsDirectory = pathExistsAndIsDirectory(sourcePath);
  if (!sourceIsFile && !sourceIsDirectory) {
    sendErrorLine("BAD_PATH");
    return;
  }

  if (sourceIsFile) {
    if (!validateFilePath(sourcePath) || !validateFilePath(targetPath)) {
      sendErrorLine("BAD_PATH");
      return;
    }
  } else if (!validateDirectoryPath(sourcePath) ||
             !validateDirectoryPath(targetPath) ||
             strcmp(sourcePath, kSequenceStorageRoot) == 0 ||
             strcmp(targetPath, kSequenceStorageRoot) == 0) {
    sendErrorLine("BAD_PATH");
    return;
  }

  if (!parentDirectoryExists(targetPath)) {
    sendErrorLine("MISSING_PARENT");
    return;
  }

  if (strcmp(sourcePath, targetPath) == 0) {
    sendProtocolLine("OK RENAME");
    return;
  }

  if (LittleFS.exists(targetPath)) {
    sendErrorLine("PATH_EXISTS");
    return;
  }

  if (!LittleFS.rename(sourcePath, targetPath)) {
    sendErrorLine("RENAME_FAILED");
    return;
  }

  sendProtocolLine("OK RENAME");
  setStatus("Restore OK", sourceIsFile ? "File renamed" : "Folder renamed");
}

void processCommandLine(char* line) {
  char* tokens[4] = {};
  const size_t tokenCount = tokenizeCommand(line, tokens, 4);
  if (tokenCount == 0) {
    return;
  }

  if (strcmp(tokens[0], "HELLO") == 0) {
    handleHelloCommand();
  } else if (strcmp(tokens[0], "LIST") == 0 && tokenCount >= 2) {
    handleListCommand(tokens[1]);
  } else if (strcmp(tokens[0], "GET") == 0 && tokenCount >= 2) {
    handleGetCommand(tokens[1]);
  } else if (strcmp(tokens[0], "PUT") == 0 && tokenCount >= 3) {
    handlePutCommand(tokens[1], tokens[2]);
  } else if (strcmp(tokens[0], "MKDIR") == 0 && tokenCount >= 2) {
    handleMkdirCommand(tokens[1]);
  } else if (strcmp(tokens[0], "DELETE") == 0 && tokenCount >= 2) {
    handleDeleteCommand(tokens[1]);
  } else if (strcmp(tokens[0], "RMDIR") == 0 && tokenCount >= 2) {
    handleRmdirCommand(tokens[1]);
  } else if (strcmp(tokens[0], "RENAME") == 0 && tokenCount >= 3) {
    handleRenameCommand(tokens[1], tokens[2]);
  } else if (strcmp(tokens[0], "PING") == 0) {
    sendProtocolLine("OK PONG");
  } else {
    sendErrorLine("UNKNOWN_COMMAND");
  }
}

void serviceCommandInput() {
  while (Serial.available() > 0) {
    const int incoming = Serial.read();
    if (incoming < 0) {
      break;
    }
    const char c = static_cast<char>(incoming);
    if (c == '\r') {
      continue;
    }
    if (c == '\n') {
      g_commandBuffer[g_commandLength] = '\0';
      processCommandLine(g_commandBuffer);
      g_commandLength = 0;
      g_commandBuffer[0] = '\0';
      g_lastIoAt = millis();
      if (g_receiveState != ReceiveState::Command) {
        return;
      }
      continue;
    }
    if (g_commandLength + 1 >= sizeof(g_commandBuffer)) {
      g_commandLength = 0;
      g_commandBuffer[0] = '\0';
      sendErrorLine("COMMAND_TOO_LONG");
      continue;
    }
    g_commandBuffer[g_commandLength++] = c;
  }
}

void serviceIncomingFilePayload() {
  uint8_t buffer[kUsbBackupIoBufferSize];
  while (g_incomingBytesRemaining > 0 && Serial.available() > 0) {
    size_t desired = g_incomingBytesRemaining;
    if (desired > sizeof(buffer)) {
      desired = sizeof(buffer);
    }
    const size_t available = static_cast<size_t>(Serial.available());
    if (desired > available) {
      desired = available;
    }
    if (desired == 0) {
      break;
    }
    const size_t bytesRead = Serial.readBytes(reinterpret_cast<char*>(buffer), desired);
    if (bytesRead == 0) {
      break;
    }
    const size_t bytesWritten = g_incomingFile.write(buffer, bytesRead);
    if (bytesWritten != bytesRead) {
      clearPendingIncomingState();
      sendErrorLine("WRITE_FAILED");
      return;
    }
    g_incomingBytesRemaining -= bytesRead;
    g_lastIoAt = millis();
  }

  if (g_incomingBytesRemaining == 0) {
    finishIncomingFileWrite();
    return;
  }

  if ((millis() - g_lastIoAt) > kUsbBackupTransferTimeoutMs) {
    clearPendingIncomingState();
    sendErrorLine("TIMEOUT");
  }
}

}  // namespace

void setupUsbBackup() {
  setStatus("USB Backup Off", "Host tool idle");
}

bool enterUsbBackupMode() {
  if (g_active) {
    setStatus("Session Active", "Run host tool");
    return true;
  }
  if (!ensureSequenceStorageRoot()) {
    setStatus("Backup Error", "FS unavailable");
    return false;
  }

  g_active = true;
  suppressSerialDebugForSession();
  g_receiveState = ReceiveState::Command;
  g_commandLength = 0;
  g_commandBuffer[0] = '\0';
  g_incomingBytesRemaining = 0;
  g_incomingFinalPath[0] = '\0';
  g_incomingTempPath[0] = '\0';
  g_lastIoAt = millis();
  while (Serial.available() > 0) {
    Serial.read();
  }
  setStatus("Session Active", "Run host tool");
  return true;
}

void exitUsbBackupMode() {
  if (!g_active) {
    restoreSerialDebugAfterSession();
    setStatus("USB Backup Off", "Host tool idle");
    return;
  }

  clearPendingIncomingState();
  g_active = false;
  g_commandLength = 0;
  g_commandBuffer[0] = '\0';
  restoreSerialDebugAfterSession();
  setStatus("USB Backup Off", "Host tool idle");
}

bool isUsbBackupActive() {
  return g_active;
}

void serviceUsbBackup() {
  if (!g_active) {
    return;
  }

  if (g_receiveState == ReceiveState::PutPayload) {
    serviceIncomingFilePayload();
  } else {
    serviceCommandInput();
  }
}

void getUsbBackupStatusLines(char* lineOneOut, size_t lineOneSize,
                             char* lineTwoOut, size_t lineTwoSize) {
  if (lineOneOut != nullptr && lineOneSize > 0) {
    snprintf(lineOneOut, lineOneSize, "%s", g_statusLineOne);
  }
  if (lineTwoOut != nullptr && lineTwoSize > 0) {
    snprintf(lineTwoOut, lineTwoSize, "%s", g_statusLineTwo);
  }
}

bool consumeUsbBackupUiRefreshRequested() {
  const bool requested = g_uiRefreshRequested;
  g_uiRefreshRequested = false;
  return requested;
}

}  // namespace sequencer

#else

namespace sequencer {

void setupUsbBackup() {}
bool enterUsbBackupMode() { return false; }
void exitUsbBackupMode() {}
bool isUsbBackupActive() { return false; }
void serviceUsbBackup() {}
void getUsbBackupStatusLines(char* lineOneOut, size_t lineOneSize,
                             char* lineTwoOut, size_t lineTwoSize) {
  if (lineOneOut != nullptr && lineOneSize > 0) {
    lineOneOut[0] = '\0';
  }
  if (lineTwoOut != nullptr && lineTwoSize > 0) {
    lineTwoOut[0] = '\0';
  }
}
bool consumeUsbBackupUiRefreshRequested() { return false; }

}  // namespace sequencer

#endif
