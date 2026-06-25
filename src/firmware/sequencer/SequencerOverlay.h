#pragma once

#include "../FirmwareModule.h"

namespace sequencer {

void markOverlayDirty();
void hideSelectedStepOverlay();
void resetOverlayState();
void drawSequencerOverlay();

}  // namespace sequencer
