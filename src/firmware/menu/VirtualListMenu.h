#pragma once

#include "../FirmwareModule.h"

enum class VirtualListMenuRowType : uint8_t {
  Button,
  Link,
  Label
};

struct VirtualListMenuProvider {
  const char* title = "";
  const char* breadcrumb = nullptr;
  void* context = nullptr;
  uint16_t (*getCount)(void* context) = nullptr;
  bool (*getLabel)(void* context, uint16_t index, char* output, size_t outputLength) = nullptr;
  VirtualListMenuRowType (*getRowType)(void* context, uint16_t index) = nullptr;
  bool (*isCurrent)(void* context, uint16_t index) = nullptr;
  bool (*getInitialSelection)(void* context, uint16_t* index) = nullptr;
  void (*select)(void* context, uint16_t index) = nullptr;
  bool (*back)(void* context) = nullptr;
  void (*close)(void* context) = nullptr;
  const char* emptyLabel = "";
};

void openVirtualListMenu(const VirtualListMenuProvider& provider);
bool virtualListMenuIsActive();
bool handleVirtualListMenuKey(byte keyCode);
void redrawVirtualListMenu();
void resetVirtualListMenuSelection();
void closeVirtualListMenu();
void deactivateVirtualListMenu();
