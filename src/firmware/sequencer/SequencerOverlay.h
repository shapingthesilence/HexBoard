#pragma once

#include "../FirmwareModule.h"

namespace sequencer {

void markOverlayDirty();
void hideSelectedStepOverlay();
bool sequencerIdleDisplayBlanked();
void redrawSequencerIdleBlankDisplay();
void clearSequencerIdleDisplayBlanked();
void resetOverlayState();
bool overviewActive();
void showOverviewPage(bool advancePage);
void hideOverview();
void drawSequencerOverlay();

}  // namespace sequencer
