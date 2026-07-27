#pragma once

#include "../FirmwareModule.h"

constexpr uint8_t STORAGE_HEALTH_MAX_ISSUES = 8;

void resetStorageHealth();
void reportStorageHealthIssue(const char* path, const char* reason);
uint8_t storageHealthIssueCount();
const char* storageHealthSummaryLabel();
const char* storageHealthIssuePath(uint8_t index);
const char* storageHealthIssueReason(uint8_t index);
