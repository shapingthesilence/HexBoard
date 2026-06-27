#pragma once

#include "../FirmwareModule.h"

namespace sequencer {

void markOverlayDirty();
void hideSelectedStepOverlay();
bool sequencerOverlayOwnsEncoderInput();
bool sequencerIdleDisplayBlanked();
void redrawSequencerIdleBlankDisplay();
void clearSequencerIdleDisplayBlanked();
void releaseSequencerOverlayForMenuDisplay();
void resetOverlayState();
bool overviewActive();
void showOverviewPage(bool advancePage);
void hideOverview();
void drawSequencerOverlay();

}  // namespace sequencer
