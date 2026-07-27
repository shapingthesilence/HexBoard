#include "StorageHealth.h"

namespace {

struct StorageHealthIssue {
  char path[64] = {};
  char reason[64] = {};
};

StorageHealthIssue storageHealthIssues[STORAGE_HEALTH_MAX_ISSUES] = {};
uint8_t storageHealthCount = 0;
char storageHealthSummary[24] = "Storage OK";

}  // namespace

void resetStorageHealth() {
  memset(storageHealthIssues, 0, sizeof(storageHealthIssues));
  storageHealthCount = 0;
  snprintf(storageHealthSummary, sizeof(storageHealthSummary), "Storage OK");
}

void reportStorageHealthIssue(const char* path, const char* reason) {
  const char* safePath = path && path[0] ? path : "LittleFS";
  for (uint8_t index = 0; index < storageHealthCount; ++index) {
    if (strcmp(storageHealthIssues[index].path, safePath) == 0) {
      return;
    }
  }
  if (storageHealthCount >= STORAGE_HEALTH_MAX_ISSUES) {
    snprintf(storageHealthSummary,
             sizeof(storageHealthSummary),
             "%u+ storage issues",
             STORAGE_HEALTH_MAX_ISSUES);
    return;
  }
  StorageHealthIssue& issue = storageHealthIssues[storageHealthCount++];
  snprintf(issue.path, sizeof(issue.path), "%s", safePath);
  snprintf(issue.reason,
           sizeof(issue.reason),
           "%s",
           reason && reason[0] ? reason : "invalid");
  snprintf(storageHealthSummary,
           sizeof(storageHealthSummary),
           "%u storage issue%s",
           storageHealthCount,
           storageHealthCount == 1 ? "" : "s");
}

uint8_t storageHealthIssueCount() {
  return storageHealthCount;
}

const char* storageHealthSummaryLabel() {
  return storageHealthSummary;
}

const char* storageHealthIssuePath(uint8_t index) {
  return index < storageHealthCount ? storageHealthIssues[index].path : "";
}

const char* storageHealthIssueReason(uint8_t index) {
  return index < storageHealthCount ? storageHealthIssues[index].reason : "";
}
