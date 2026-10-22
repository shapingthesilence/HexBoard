#pragma once

#include "../FirmwareModule.h"

enum class VirtualListMenuRowType : uint8_t {
  Button,
  Link,
  Label,
  Checkbox,
  Value
};

struct VirtualListMenuProvider {
  const char* title = "";
  void* context = nullptr;
  uint16_t (*getCount)(void* context) = nullptr;
  bool (*getLabel)(void* context, uint16_t index, char* output, size_t outputLength) = nullptr;
  VirtualListMenuRowType (*getRowType)(void* context, uint16_t index) = nullptr;
  bool (*isChecked)(void* context, uint16_t index) = nullptr;
  bool (*isCurrent)(void* context, uint16_t index) = nullptr;
  bool (*getInitialSelection)(void* context, uint16_t* index) = nullptr;
  void (*select)(void* context, uint16_t index) = nullptr;
  bool (*back)(void* context) = nullptr;
  void (*close)(void* context) = nullptr;
  const char* emptyLabel = "";
  bool (*getValue)(void*, uint16_t, char*, size_t) = nullptr;
  void (*adjust)(void*, uint16_t, int) = nullptr;
};

void openVirtualListMenu(const VirtualListMenuProvider& provider);
bool virtualListMenuIsActive();
bool handleVirtualListMenuKey(byte keyCode);
void redrawVirtualListMenu();
void resetVirtualListMenuSelection();
void closeVirtualListMenu();
void deactivateVirtualListMenu();
