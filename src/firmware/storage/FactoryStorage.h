#pragma once

#include "../FirmwareModule.h"

enum class FactoryStorageBootState : uint8_t {
  Ready,
  Degraded,
  Unavailable,
};

FactoryStorageBootState inspectFactoryStorage();
const char* factoryStorageLastError();
uint8_t factoryStorageIssueCount();
