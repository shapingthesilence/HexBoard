#include "../FirmwareModule.h"
#include "CommandWheelOverlay.h"
#include "MenuAndDisplay.h"
#include "PlayedNotesOverlay.h"
#include "VirtualListMenu.h"
#include "../storage/PersistentDataModels.h"

namespace {
constexpr uint8_t VIRTUAL_LIST_ITEM_HEIGHT = 10;
constexpr uint8_t VIRTUAL_LIST_SCREEN_TOP_OFFSET = 18;
constexpr uint8_t VIRTUAL_LIST_VALUES_LEFT_OFFSET = 78;
constexpr uint8_t VIRTUAL_LIST_FONT_WIDTH = 6;
constexpr uint8_t VIRTUAL_LIST_FONT_HEIGHT = 8;
constexpr uint8_t VIRTUAL_LIST_SPRITE_WIDTH = 6;
constexpr uint8_t VIRTUAL_LIST_SPRITE_HEIGHT = 8;
constexpr uint8_t VIRTUAL_LIST_BACK_INDEX = 0;
constexpr uint8_t VIRTUAL_LIST_HEADER_DIVIDER_Y = VIRTUAL_LIST_SCREEN_TOP_OFFSET - 3;

static const unsigned char arrowLeftBits[] U8X8_PROGMEM = {
  0xc0, 0xc4, 0xc6, 0xc7, 0xc6, 0xc4, 0xc0, 0xc0
};

static const unsigned char arrowRightBits[] U8X8_PROGMEM = {
  0xc0, 0xc4, 0xcc, 0xdc, 0xcc, 0xc4, 0xc0, 0xc0
};

static const unsigned char arrowButtonBits[] U8X8_PROGMEM = {
  0xc0, 0xc3, 0xc5, 0xc9, 0xc5, 0xc3, 0xc0, 0xc0
};

static const unsigned char currentDiamondBits[] U8X8_PROGMEM = {
  0xc0, 0xc4, 0xce, 0xdf, 0xce, 0xc4, 0xc0, 0xc0
};

VirtualListMenuProvider activeProvider;
bool active = false;
uint16_t currentItemIndex = VIRTUAL_LIST_BACK_INDEX;

uint16_t providerItemCount() {
  if (!activeProvider.getCount) {
    return 0;
  }
  return activeProvider.getCount(activeProvider.context);
}

uint16_t virtualItemCount() {
  uint16_t itemCount = providerItemCount();
  return static_cast<uint16_t>(1 + (itemCount > 0 ? itemCount : 1));
}

uint8_t menuItemsPerScreen() {
  return static_cast<uint8_t>((u8g2.getDisplayHeight() - VIRTUAL_LIST_SCREEN_TOP_OFFSET) / VIRTUAL_LIST_ITEM_HEIGHT);
}

uint8_t textInsetOffset() {
  return static_cast<uint8_t>((VIRTUAL_LIST_ITEM_HEIGHT - VIRTUAL_LIST_FONT_HEIGHT) / 2 - 1);
}

uint8_t spriteInsetOffset() {
  return static_cast<uint8_t>((VIRTUAL_LIST_ITEM_HEIGHT - VIRTUAL_LIST_FONT_HEIGHT) / 2
                              + (VIRTUAL_LIST_FONT_HEIGHT - VIRTUAL_LIST_SPRITE_HEIGHT) / 2);
}

uint8_t menuItemFullLength() {
  uint8_t titleLength = static_cast<uint8_t>((VIRTUAL_LIST_VALUES_LEFT_OFFSET - 5) / VIRTUAL_LIST_FONT_WIDTH);
  uint8_t valueLength = static_cast<uint8_t>((u8g2.getDisplayWidth() - VIRTUAL_LIST_VALUES_LEFT_OFFSET - 6) / VIRTUAL_LIST_FONT_WIDTH);
  return static_cast<uint8_t>(titleLength + valueLength);
}

void printMenuString(const char* text, uint8_t maxChars) {
  if (!text) {
    return;
  }
  for (uint8_t i = 0; i < maxChars && text[i] != '\0'; ++i) {
    u8g2.print(text[i]);
  }
}

void drawTitleBar() {
  drawCenteredMenuHeaderTitle(activeProvider.title);
  u8g2.drawHLine(0, VIRTUAL_LIST_HEADER_DIVIDER_Y, u8g2.getDisplayWidth());
}

void rowLabel(uint16_t itemIndex, char* output, size_t outputLength) {
  if (outputLength == 0) {
    return;
  }
  output[0] = '\0';
  uint16_t itemCount = providerItemCount();
  if (itemIndex == VIRTUAL_LIST_BACK_INDEX) {
    return;
  }
  if (itemCount == 0) {
    snprintf(output, outputLength, "%s", activeProvider.emptyLabel ? activeProvider.emptyLabel : "");
    return;
  }
  uint16_t providerIndex = static_cast<uint16_t>(itemIndex - 1);
  if (providerIndex >= itemCount || !activeProvider.getLabel) {
    return;
  }
  activeProvider.getLabel(activeProvider.context, providerIndex, output, outputLength);
}

VirtualListMenuRowType rowType(uint16_t itemIndex) {
  uint16_t itemCount = providerItemCount();
  if (itemIndex == VIRTUAL_LIST_BACK_INDEX || itemCount == 0 || !activeProvider.getRowType) {
    return VirtualListMenuRowType::Button;
  }
  uint16_t providerIndex = static_cast<uint16_t>(itemIndex - 1);
  if (providerIndex >= itemCount) {
    return VirtualListMenuRowType::Button;
  }
  return activeProvider.getRowType(activeProvider.context, providerIndex);
}

bool rowIsCurrent(uint16_t itemIndex) {
  uint16_t itemCount = providerItemCount();
  if (itemIndex == VIRTUAL_LIST_BACK_INDEX || itemCount == 0 || !activeProvider.isCurrent) {
    return false;
  }
  uint16_t providerIndex = static_cast<uint16_t>(itemIndex - 1);
  return providerIndex < itemCount
         && rowType(itemIndex) == VirtualListMenuRowType::Button
         && activeProvider.isCurrent(activeProvider.context, providerIndex);
}

uint16_t defaultSelectionIndex() {
  return virtualItemCount() > 1 ? 1 : VIRTUAL_LIST_BACK_INDEX;
}

uint16_t initialSelectionIndex() {
  uint16_t itemCount = providerItemCount();
  uint16_t providerIndex = 0;
  if (itemCount > 0
      && activeProvider.getInitialSelection
      && activeProvider.getInitialSelection(activeProvider.context, &providerIndex)
      && providerIndex < itemCount) {
    uint16_t itemIndex = static_cast<uint16_t>(providerIndex + 1);
    if (rowType(itemIndex) == VirtualListMenuRowType::Button) {
      return itemIndex;
    }
  }
  return defaultSelectionIndex();
}

void drawRows() {
  uint8_t perScreen = menuItemsPerScreen();
  uint16_t screenStart = static_cast<uint16_t>((currentItemIndex / perScreen) * perScreen);
  uint16_t totalItems = virtualItemCount();
  uint8_t y = VIRTUAL_LIST_SCREEN_TOP_OFFSET;
  char label[SYNTH_PRESET_MENU_LABEL_LENGTH] = {};

  for (uint8_t row = 0; row < perScreen; ++row) {
    uint16_t itemIndex = static_cast<uint16_t>(screenStart + row);
    if (itemIndex >= totalItems) {
      break;
    }
    uint8_t yText = static_cast<uint8_t>(y + textInsetOffset());
    uint8_t yDraw = static_cast<uint8_t>(y + spriteInsetOffset());

    if (itemIndex == VIRTUAL_LIST_BACK_INDEX) {
      u8g2.drawXBMP(5, yDraw, VIRTUAL_LIST_SPRITE_WIDTH, VIRTUAL_LIST_SPRITE_HEIGHT, arrowLeftBits);
    } else {
      rowLabel(itemIndex, label, sizeof(label));
      bool currentRow = rowIsCurrent(itemIndex);
      if (providerItemCount() == 0) {
        u8g2.setCursor(5, yText);
      } else {
        VirtualListMenuRowType type = rowType(itemIndex);
        switch (type) {
          case VirtualListMenuRowType::Link:
            u8g2.setCursor(5, yText);
            u8g2.drawXBMP(u8g2.getDisplayWidth() - 8,
                          yDraw,
                          VIRTUAL_LIST_SPRITE_WIDTH,
                          VIRTUAL_LIST_SPRITE_HEIGHT,
                          arrowRightBits);
            break;
          case VirtualListMenuRowType::Label:
            u8g2.setCursor(5, yText);
            break;
          case VirtualListMenuRowType::Button:
          default:
            u8g2.setCursor(11, yText);
            u8g2.drawXBMP(5,
                          yDraw,
                          VIRTUAL_LIST_SPRITE_WIDTH,
                          VIRTUAL_LIST_SPRITE_HEIGHT,
                          currentRow ? currentDiamondBits : arrowButtonBits);
            break;
        }
      }
      printMenuString(label, menuItemFullLength());
    }

    y = static_cast<uint8_t>(y + VIRTUAL_LIST_ITEM_HEIGHT);
  }
}

void drawPointer() {
  uint8_t perScreen = menuItemsPerScreen();
  uint8_t pointerRow = static_cast<uint8_t>(currentItemIndex % perScreen);
  uint8_t pointerY = static_cast<uint8_t>(pointerRow * VIRTUAL_LIST_ITEM_HEIGHT + VIRTUAL_LIST_SCREEN_TOP_OFFSET);
  u8g2.setDrawColor(2);
  u8g2.drawBox(0, pointerY - 1, u8g2.getDisplayWidth() - 2, VIRTUAL_LIST_ITEM_HEIGHT + 1);
  u8g2.setDrawColor(1);
}

void drawScrollbar() {
  uint8_t perScreen = menuItemsPerScreen();
  uint16_t totalItems = virtualItemCount();
  uint16_t screensCount = static_cast<uint16_t>((totalItems + perScreen - 1) / perScreen);
  if (screensCount <= 1) {
    return;
  }
  uint16_t currentScreen = static_cast<uint16_t>(currentItemIndex / perScreen);
  uint16_t scrollbarHeight = static_cast<uint16_t>((u8g2.getDisplayHeight() - VIRTUAL_LIST_SCREEN_TOP_OFFSET + 1) / screensCount);
  if (scrollbarHeight == 0) {
    scrollbarHeight = 1;
  }
  uint16_t scrollbarPosition = static_cast<uint16_t>(currentScreen * scrollbarHeight + VIRTUAL_LIST_SCREEN_TOP_OFFSET - 1);
  uint8_t x = static_cast<uint8_t>(u8g2.getDisplayWidth() - 1);
  u8g2.drawLine(x,
                scrollbarPosition,
                x,
                static_cast<uint16_t>(scrollbarPosition + scrollbarHeight));
}

void handleBackRow() {
  if (activeProvider.back && activeProvider.back(activeProvider.context)) {
    return;
  }
  closeVirtualListMenu();
}

void selectCurrentItem() {
  uint16_t itemCount = providerItemCount();
  if (currentItemIndex == VIRTUAL_LIST_BACK_INDEX) {
    handleBackRow();
    return;
  }
  if (itemCount == 0) {
    redrawVirtualListMenu();
    return;
  }
  uint16_t providerIndex = static_cast<uint16_t>(currentItemIndex - 1);
  if (providerIndex < itemCount && activeProvider.select) {
    activeProvider.select(activeProvider.context, providerIndex);
  }
}

}  // namespace

void openVirtualListMenu(const VirtualListMenuProvider& provider) {
  activeProvider = provider;
  active = true;
  currentItemIndex = initialSelectionIndex();
  redrawVirtualListMenu();
}

bool virtualListMenuIsActive() {
  return active;
}

bool handleVirtualListMenuKey(byte keyCode) {
  if (!active) {
    return false;
  }

  uint16_t totalItems = virtualItemCount();
  if (totalItems == 0) {
    return true;
  }

  switch (keyCode) {
    case GEM_KEY_UP:
      currentItemIndex = (currentItemIndex == 0)
                           ? static_cast<uint16_t>(totalItems - 1)
                           : static_cast<uint16_t>(currentItemIndex - 1);
      redrawVirtualListMenu();
      return true;
    case GEM_KEY_DOWN:
      currentItemIndex = (currentItemIndex + 1 >= totalItems)
                           ? 0
                           : static_cast<uint16_t>(currentItemIndex + 1);
      redrawVirtualListMenu();
      return true;
    case GEM_KEY_OK:
    case GEM_KEY_RIGHT:
      selectCurrentItem();
      return true;
    case GEM_KEY_LEFT:
    case GEM_KEY_CANCEL:
      handleBackRow();
      return true;
    default:
      return true;
  }
}

void redrawVirtualListMenu() {
  if (!active) {
    return;
  }
  dismissCommandWheelOverlay();
  uint16_t totalItems = virtualItemCount();
  if (totalItems > 0 && currentItemIndex >= totalItems) {
    currentItemIndex = static_cast<uint16_t>(totalItems - 1);
  }

  u8g2.firstPage();
  do {
    drawTitleBar();
    drawRows();
    drawPointer();
    drawScrollbar();
    drawPlayedNoteBadgeOnMenuFrame();
  } while (u8g2.nextPage());
}

void resetVirtualListMenuSelection() {
  if (!active) {
    return;
  }
  currentItemIndex = initialSelectionIndex();
  redrawVirtualListMenu();
}

void closeVirtualListMenu() {
  if (!active) {
    return;
  }
  VirtualListMenuProvider provider = activeProvider;
  active = false;
  currentItemIndex = VIRTUAL_LIST_BACK_INDEX;
  activeProvider = {};
  if (provider.close) {
    provider.close(provider.context);
  }
}

void deactivateVirtualListMenu() {
  active = false;
  currentItemIndex = VIRTUAL_LIST_BACK_INDEX;
  activeProvider = {};
}
