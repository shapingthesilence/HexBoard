#include "SequencerMode.h"

#include "../config/FeatureFlags.h"

#if HEXBOARD_ENABLE_SEQUENCER
#include "SequencerFileMenu.h"
#include "SequencerInput.h"
#include "SequencerLightMenu.h"
#include "SequencerManagedNotes.h"
#include "SequencerOverlay.h"
#include "SequencerPerformanceMonitor.h"
#include "SequencerPlaybackMenu.h"
#include "SequencerState.h"
#include "SequencerStorage.h"
#include "SequencerTools.h"
#include "SequencerTransport.h"
#include "SequencerUsbBackup.h"
#include "../menu/MenuAndDisplay.h"
#include "../synth/SynthAudio.h"

namespace {

constexpr byte kSequencerMenuItemHeight = 10;
constexpr byte kSequencerMenuTopOffset = 22;
constexpr byte kSequencerMenuValuesLeftOffset = 78;
constexpr byte kSequencerMenuFilenameHeaderTop = 11;
constexpr byte kSequencerMenuFilenameHeaderTextX = 4;
constexpr byte kSequencerMenuFilenameHeaderDividerY = kSequencerMenuTopOffset - 2;

bool sequencerMenuInstalled = false;
bool sequencerActive = false;
char sequencerTitleLabel[sequencer::kSequenceTitleLength] = "Sequencer";
uint32_t sequencerTitleSeenVersion = 0;
GEMAppearance sequencerMenuAppearance = {
  GEM_POINTER_ROW,
  GEM_ITEMS_COUNT_AUTO,
  kSequencerMenuItemHeight,
  kSequencerMenuTopOffset,
  kSequencerMenuValuesLeftOffset
};

GEMPage& sequencerMenuPage() {
  static GEMPage page("Sequencer");
  return page;
}

GEMItem& sequencerMenuAction() {
  static GEMItem item("Sequencer", enterSequencerMode);
  return item;
}

GEMItem& sequencerKeyboardAction() {
  static GEMItem item("Keyboard", exitSequencerMode);
  return item;
}

bool sequencerDisplayOverlayActive() {
  return sequencer::performanceMonitorActive() ||
         sequencer::overviewActive() ||
         sequencer::hasSelectedStep() ||
         sequencer::toolMode() != sequencer::SequencerToolMode::Normal ||
         sequencer::sequencerIdleDisplayBlanked();
}

void refreshSequencerTitleRow(bool redrawIfVisible = false) {
  uint32_t titleVersion = sequencer::sequenceTitleVersion();
  const char* title = sequencer::sequenceTitle();
  if (titleVersion == sequencerTitleSeenVersion && strcmp(sequencerTitleLabel, title) == 0) {
    return;
  }

  snprintf(sequencerTitleLabel, sizeof(sequencerTitleLabel), "%s", title);
  sequencerTitleSeenVersion = titleVersion;

  if (redrawIfVisible && sequencerActive && menu.getCurrentMenuPage() == &sequencerMenuPage()) {
    if (sequencerDisplayOverlayActive()) {
      sequencer::markOverlayDirty();
    } else {
      menu.drawMenu();
    }
  }
}

void copyFittingFilenameHeaderText(char* output, size_t outputLength) {
  if (outputLength == 0) {
    return;
  }

  output[0] = '\0';
  u8g2.setFont(GEM_FONT_BIG);
  const int maxWidth = static_cast<int>(u8g2.getDisplayWidth()) - (kSequencerMenuFilenameHeaderTextX * 2);
  for (size_t i = 0; sequencerTitleLabel[i] != '\0' && i < outputLength - 1; ++i) {
    output[i] = sequencerTitleLabel[i];
    output[i + 1] = '\0';
    if (u8g2.getStrWidth(output) > maxWidth) {
      output[i] = '\0';
      return;
    }
  }
}

}  // namespace
#endif

bool sequencerModeActive() {
#if HEXBOARD_ENABLE_SEQUENCER
  return sequencerActive;
#else
  return false;
#endif
}

void enterSequencerMode() {
#if HEXBOARD_ENABLE_SEQUENCER
  sequencerActive = true;
  sequencer::initializeSequenceStorage();
  sequencer::resetInputState();
  sequencer::resetToolsState();
  sequencer::resetOverlayState();
  panicStopOutput();
  screenTime = 0;
  menu.setMenuPageCurrent(sequencerMenuPage());
  refreshSequencerTitleRow(false);
  menu.drawMenu();
#endif
}

void exitSequencerMode() {
#if HEXBOARD_ENABLE_SEQUENCER
  sequencer::exitUsbBackupMode();
  sequencer::stopTransport();
  sequencerActive = false;
  sequencer::deselectStep();
  sequencer::resetInputState();
  sequencer::resetToolsState();
  sequencer::resetOverlayState();
  panicStopOutput();
  screenTime = 0;
  menuHome();
#endif
}

void serviceSequencerMode() {
#if HEXBOARD_ENABLE_SEQUENCER
  if (sequencerActive) {
    refreshSequencerTitleRow(true);
    sequencer::serviceUsbBackup();
    if (sequencer::isUsbBackupActive()) {
      return;
    }
    sequencer::serviceInput();
    sequencer::serviceTransport();
    sequencer::serviceManagedNotes();
  }
#endif
}

void restoreSequencerAtStartup() {
#if HEXBOARD_ENABLE_SEQUENCER
  sequencer::restoreRememberedSequenceAtStartup();
#endif
}

void handleSequencerButtonEvent(byte buttonIndex, bool pressed) {
#if HEXBOARD_ENABLE_SEQUENCER
  if (sequencerActive) {
    if (sequencer::isUsbBackupActive()) {
      return;
    }
    if (sequencer::handleFileMenuButtonEvent(buttonIndex, pressed)) {
      return;
    }
    sequencer::handleButtonEvent(buttonIndex, pressed);
  }
#else
  (void)buttonIndex;
  (void)pressed;
#endif
}

bool handleSequencerRotaryTurn(int8_t direction) {
#if HEXBOARD_ENABLE_SEQUENCER
  if (sequencerActive) {
    if (sequencer::isUsbBackupActive()) {
      return false;
    }
    if (sequencer::handleFileMenuRotaryTurn(direction)) {
      return true;
    }
    if (!sequencer::sequencerOverlayOwnsEncoderInput()) {
      sequencer::releaseSequencerOverlayForMenuDisplay();
      return false;
    }
    if (sequencer::performanceMonitorActive()) {
      return true;
    }
    return sequencer::handleRotaryTurn(direction);
  }
#else
  (void)direction;
#endif
  return false;
}

bool handleSequencerEncoderClick() {
#if HEXBOARD_ENABLE_SEQUENCER
  if (sequencerActive) {
    if (sequencer::isUsbBackupActive()) {
      return false;
    }
    if (sequencer::handleFileMenuEncoderClick()) {
      return true;
    }
    if (!sequencer::sequencerOverlayOwnsEncoderInput()) {
      sequencer::releaseSequencerOverlayForMenuDisplay();
      return false;
    }
    if (sequencer::performanceMonitorActive()) {
      return true;
    }
    return sequencer::handleEncoderClick();
  }
#endif
  return false;
}

void drawSequencerModeDisplay() {
#if HEXBOARD_ENABLE_SEQUENCER
  if (sequencerActive) {
    sequencer::serviceSequenceFileMenu();
    if (sequencer::fileNamingActive()) {
      sequencer::drawFileMenuOverlay();
      return;
    }
    if (sequencer::toolMode() == sequencer::SequencerToolMode::StatusMessage) {
      sequencer::drawSequencerOverlay();
      return;
    }
    if (sequencer::fileWorkflowActive() || menu.getCurrentMenuPage() != &sequencerMenuPage()) {
      sequencer::releaseSequencerOverlayForMenuDisplay();
      return;
    }
    sequencer::drawSequencerOverlay();
  }
#endif
}

void drawSequencerMenuFilenameHeader() {
#if HEXBOARD_ENABLE_SEQUENCER
  if (!sequencerActive || menu.getCurrentMenuPage() != &sequencerMenuPage()) {
    return;
  }

  refreshSequencerTitleRow(false);

  char visibleTitle[sequencer::kSequenceTitleLength] = "";
  copyFittingFilenameHeaderText(visibleTitle, sizeof(visibleTitle));

  u8g2.setDrawColor(1);
  u8g2.setFontPosTop();
  u8g2.setFont(GEM_FONT_BIG);
  u8g2.drawStr(kSequencerMenuFilenameHeaderTextX, kSequencerMenuFilenameHeaderTop, visibleTitle);
  u8g2.drawHLine(0, kSequencerMenuFilenameHeaderDividerY, u8g2.getDisplayWidth());
  u8g2.setDrawColor(1);
#endif
}

void restoreSequencerDisplayAfterPlayedNotesOverlay() {
#if HEXBOARD_ENABLE_SEQUENCER
  if (sequencerActive) {
    sequencer::serviceSequenceFileMenu();
    if (sequencer::fileNamingActive()) {
      sequencer::drawFileMenuOverlay();
      return;
    }
    if (sequencer::performanceMonitorActive() ||
        sequencer::overviewActive() ||
        sequencer::hasSelectedStep() ||
        sequencer::toolMode() != sequencer::SequencerToolMode::Normal) {
      sequencer::markOverlayDirty();
      sequencer::drawSequencerOverlay();
      return;
    }
    if (sequencer::sequencerIdleDisplayBlanked()) {
      sequencer::redrawSequencerIdleBlankDisplay();
      return;
    }
  }
  restoreInteractiveMenuDisplay();
#endif
}

void handleSequencerExternalMidiRealtime(uint8_t status) {
#if HEXBOARD_ENABLE_SEQUENCER
  if (!sequencerActive) {
    return;
  }

  switch (status) {
    case 0xF8:
      sequencer::handleExternalMidiClock();
      break;
    case 0xFA:
      sequencer::handleExternalMidiStart();
      break;
    case 0xFB:
      sequencer::handleExternalMidiContinue();
      break;
    case 0xFC:
      sequencer::handleExternalMidiStop();
      break;
    default:
      break;
  }
#else
  (void)status;
#endif
}

void setupSequencerMenu() {
#if HEXBOARD_ENABLE_SEQUENCER
  if (sequencerMenuInstalled) {
    return;
  }

  GEMPage& page = sequencerMenuPage();
  page.setAppearance(&sequencerMenuAppearance);
  page.addMenuItem(sequencerKeyboardAction());
  sequencer::initializeSequenceStorage();
  sequencer::setupUsbBackup();
  sequencer::setupSequenceFileMenu(page);
  sequencer::setupPlaybackSettingsMenu(page);
  sequencer::setupLightSettingsMenu(page);
  refreshSequencerTitleRow(false);
  menuPageMain.addMenuItem(sequencerMenuAction());
  sequencerMenuInstalled = true;
#endif
}
