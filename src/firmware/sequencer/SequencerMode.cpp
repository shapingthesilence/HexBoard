#include "SequencerMode.h"

#include "../config/FeatureFlags.h"

#if HEXBOARD_ENABLE_SEQUENCER
#include "../menu/MenuAndDisplay.h"

namespace {

bool sequencerMenuInstalled = false;

GEMPage& sequencerMenuPage() {
  static GEMPage page("Sequencer", menuPageMain);
  return page;
}

GEMItem& sequencerMenuLink() {
  static GEMItem item("Sequencer", sequencerMenuPage());
  return item;
}

GEMItem& sequencerTitleRow() {
  static GEMItem item("Sequencer");
  return item;
}

GEMItem& sequencerShellStatusRow() {
  static GEMItem item("Port shell");
  return item;
}

}  // namespace
#endif

void setupSequencerMenu() {
#if HEXBOARD_ENABLE_SEQUENCER
  if (sequencerMenuInstalled) {
    return;
  }

  GEMPage& page = sequencerMenuPage();
  page.addMenuItem(sequencerTitleRow());
  page.addMenuItem(sequencerShellStatusRow());
  menuPageMain.addMenuItem(sequencerMenuLink());
  sequencerMenuInstalled = true;
#endif
}
