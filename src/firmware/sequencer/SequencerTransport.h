#pragma once

#include "../FirmwareModule.h"

namespace sequencer {

bool transportRunning();
int8_t playingStepIndex();
void startTransport();
void stopTransport();
void toggleTransport();
void serviceTransport();
void releasePlaybackNotesForPanic();

}  // namespace sequencer
