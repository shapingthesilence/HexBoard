#include "SequencerMode.h"

#include "../config/FeatureFlags.h"

#if HEXBOARD_ENABLE_SEQUENCER
#include "SequencerInput.h"
#include "SequencerState.h"
#include "../menu/MenuAndDisplay.h"
#include "../synth/SynthAudio.h"

namespace {

bool sequencerMenuInstalled = false;
bool sequencerActive = false;

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
  static GEMItem item("Step edit ready");
  return item;
}

GEMItem& sequencerShellStatusRow() {
  static GEMItem item("Hold 19 clears");
  return item;
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
  sequencer::resetInputState();
  panicStopOutput();
  screenTime = 0;
  menu.setMenuPageCurrent(sequencerMenuPage());
  menu.drawMenu();
#endif
}

void exitSequencerMode() {
#if HEXBOARD_ENABLE_SEQUENCER
  sequencerActive = false;
  sequencer::deselectStep();
  sequencer::resetInputState();
  panicStopOutput();
  screenTime = 0;
  menuHome();
#endif
}

void serviceSequencerMode() {
#if HEXBOARD_ENABLE_SEQUENCER
  if (sequencerActive) {
    sequencer::serviceInput();
  }
#endif
}

void handleSequencerButtonEvent(byte buttonIndex, bool pressed) {
#if HEXBOARD_ENABLE_SEQUENCER
  if (sequencerActive) {
    sequencer::handleButtonEvent(buttonIndex, pressed);
  }
#else
  (void)buttonIndex;
  (void)pressed;
#endif
}

void setupSequencerMenu() {
#if HEXBOARD_ENABLE_SEQUENCER
  if (sequencerMenuInstalled) {
    return;
  }

  GEMPage& page = sequencerMenuPage();
  page.addMenuItem(sequencerKeyboardAction());
  page.addMenuItem(sequencerTitleRow());
  page.addMenuItem(sequencerShellStatusRow());
  menuPageMain.addMenuItem(sequencerMenuAction());
  sequencerMenuInstalled = true;
#endif
}
