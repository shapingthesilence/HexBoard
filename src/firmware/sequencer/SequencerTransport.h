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
void releasePlaybackForStep(byte stepIndex);
void handlePlaybackSettingsChanged(bool resetDirectionState);

}  // namespace sequencer
