#pragma once

#include "../FirmwareModule.h"

struct VirtualListMenuProvider {
  const char* title = "";
  void* context = nullptr;
  uint16_t (*getCount)(void* context) = nullptr;
  bool (*getLabel)(void* context, uint16_t index, char* output, size_t outputLength) = nullptr;
  void (*select)(void* context, uint16_t index) = nullptr;
  void (*close)(void* context) = nullptr;
  const char* emptyLabel = "";
};

void openVirtualListMenu(const VirtualListMenuProvider& provider);
bool virtualListMenuIsActive();
bool handleVirtualListMenuKey(byte keyCode);
void redrawVirtualListMenu();
void closeVirtualListMenu();
void deactivateVirtualListMenu();
