#include "SequencerLightMenu.h"

#include "../config/FeatureFlags.h"

#if HEXBOARD_ENABLE_SEQUENCER
#include "SequencerLightSettings.h"
#include "../menu/MenuAndDisplay.h"

namespace sequencer {
namespace {

bool lightMenuInstalled = false;

GEMPage& lightSettingsPage(GEMPage& parentPage) {
  static GEMPage page("Seq Lights", parentPage);
  return page;
}

GEMItem& lightSettingsLink(GEMPage& parentPage) {
  static GEMItem item("Seq Lights", lightSettingsPage(parentPage));
  return item;
}

SelectOptionByte accentEveryOptions[] = {
  { "Off", kStepAccentOff },
  { " 2", 2 },
  { " 3", 3 },
  { " 4", 4 },
  { " 5", 5 },
  { " 6", 6 },
  { " 7", 7 },
  { " 8", 8 }
};
GEMSelect accentEverySelect(sizeof(accentEveryOptions) / sizeof(SelectOptionByte), accentEveryOptions);

SelectOptionByte stepColorOptions[] = {
  { "Note", kStepColorNote },
  { "Regular", kStepColorRegular }
};
GEMSelect stepColorSelect(sizeof(stepColorOptions) / sizeof(SelectOptionByte), stepColorOptions);

SelectOptionByte stepHueOptions[] = {
  { "Red", kStepHueRed },
  { "Orange", kStepHueOrange },
  { "Yellow", kStepHueYellow },
  { "Lime", kStepHueLime },
  { "Green", kStepHueGreen },
  { "Teal", kStepHueTeal },
  { "Cyan", kStepHueCyan },
  { "Lt Blue", kStepHueLightBlue },
  { "Blue", kStepHueBlue },
  { "Indigo", kStepHueIndigo },
  { "Purple", kStepHuePurple },
  { "Magenta", kStepHueMagenta },
  { "Pink", kStepHuePink }
};
GEMSelect stepHueSelect(sizeof(stepHueOptions) / sizeof(SelectOptionByte), stepHueOptions);

void accentEveryMenuCallback(GEMCallbackData /*callbackData*/) {
  persistLightSettingsToProfile();
}

void stepColorMenuCallback(GEMCallbackData /*callbackData*/) {
  persistLightSettingsToProfile();
  refreshLightSettingsMenu(true);
}

void stepHueMenuCallback(GEMCallbackData /*callbackData*/) {
  persistLightSettingsToProfile();
}

void previewStepHue(GEMPreviewCallbackData previewData) {
  stepHueMutable() = normalizeStepHue(previewData.previewValByte);
}

GEMItem& accentEveryItem() {
  static GEMItem item("Accent Every", stepAccentEveryMutable(), accentEverySelect, accentEveryMenuCallback);
  return item;
}

GEMItem& stepColorItem() {
  static GEMItem item("Step Color", stepColorModeMutable(), stepColorSelect, stepColorMenuCallback);
  return item;
}

GEMItem& stepHueItem() {
  static GEMItem item("Step Hue", stepHueMutable(), stepHueSelect, stepHueMenuCallback);
  return item;
}

}  // namespace

void refreshLightSettingsMenu(bool redrawMenu) {
  stepHueItem().hide(stepColorMode() != kStepColorRegular);
  if (redrawMenu && menu.getCurrentMenuPage() == &lightSettingsPage(menuPageMain)) {
    menu.drawMenu();
  }
}

void setupLightSettingsMenu(GEMPage& sequencerMenuPage) {
  if (lightMenuInstalled) {
    return;
  }

  GEMPage& page = lightSettingsPage(sequencerMenuPage);
  GEMItem& hueItem = stepHueItem();
  hueItem.setPreviewCallback(previewStepHue);

  page.addMenuItem(accentEveryItem());
  page.addMenuItem(stepColorItem());
  page.addMenuItem(hueItem);
  refreshLightSettingsMenu(false);
  sequencerMenuPage.addMenuItem(lightSettingsLink(sequencerMenuPage));
  lightMenuInstalled = true;
}

}  // namespace sequencer
#else
namespace sequencer {

void setupLightSettingsMenu(GEMPage& /*sequencerMenuPage*/) {
}

void refreshLightSettingsMenu(bool /*redrawMenu*/) {
}

}  // namespace sequencer
#endif
