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

bool sequencerMenuInstalled = false;
bool sequencerActive = false;
char sequencerTitleLabel[sequencer::kSequenceTitleLength] = "Sequencer";
uint32_t sequencerTitleSeenVersion = 0;

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

GEMItem& sequencerTitleRow() {
  static GEMItem item(sequencerTitleLabel);
  return item;
}

GEMItem& sequencerShellStatusRow() {
  static GEMItem item("Hold 19 clears");
  return item;
}

void refreshSequencerTitleRow(bool redrawIfVisible = false) {
  uint32_t titleVersion = sequencer::sequenceTitleVersion();
  const char* title = sequencer::sequenceTitle();
  if (titleVersion == sequencerTitleSeenVersion && strcmp(sequencerTitleLabel, title) == 0) {
    return;
  }

  snprintf(sequencerTitleLabel, sizeof(sequencerTitleLabel), "%s", title);
  sequencerTitleRow().setTitle(sequencerTitleLabel);
  sequencerTitleSeenVersion = titleVersion;

  if (redrawIfVisible && sequencerActive && menu.getCurrentMenuPage() == &sequencerMenuPage()) {
    menu.drawMenu();
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
    sequencer::drawSequencerOverlay();
  }
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

void handleSequencerExternalMidiClock() {
#if HEXBOARD_ENABLE_SEQUENCER
  if (sequencerActive) {
    sequencer::handleExternalMidiClock();
  }
#endif
}

void handleSequencerExternalMidiStart() {
#if HEXBOARD_ENABLE_SEQUENCER
  if (sequencerActive) {
    sequencer::handleExternalMidiStart();
  }
#endif
}

void handleSequencerExternalMidiStop() {
#if HEXBOARD_ENABLE_SEQUENCER
  if (sequencerActive) {
    sequencer::handleExternalMidiStop();
  }
#endif
}

void handleSequencerExternalMidiContinue() {
#if HEXBOARD_ENABLE_SEQUENCER
  if (sequencerActive) {
    sequencer::handleExternalMidiContinue();
  }
#endif
}

void setupSequencerMenu() {
#if HEXBOARD_ENABLE_SEQUENCER
  if (sequencerMenuInstalled) {
    return;
  }

  GEMPage& page = sequencerMenuPage();
  page.addMenuItem(sequencerKeyboardAction());
  sequencer::initializeSequenceStorage();
  sequencer::setupUsbBackup();
  sequencer::setupSequenceFileMenu(page);
  sequencer::setupPlaybackSettingsMenu(page);
  sequencer::setupLightSettingsMenu(page);
  refreshSequencerTitleRow(false);
  page.addMenuItem(sequencerTitleRow());
  page.addMenuItem(sequencerShellStatusRow());
  menuPageMain.addMenuItem(sequencerMenuAction());
  sequencerMenuInstalled = true;
#endif
}
