#pragma once

#include "../FirmwareModule.h"

namespace sequencer {

void markOverlayDirty();
void hideSelectedStepOverlay();
void resetOverlayState();
bool overviewActive();
void showOverviewPage(bool advancePage);
void hideOverview();
void drawSequencerOverlay();

}  // namespace sequencer
