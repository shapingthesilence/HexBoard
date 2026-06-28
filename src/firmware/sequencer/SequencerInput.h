#pragma once

#include "../FirmwareModule.h"

namespace sequencer {

int8_t buttonIndexToStep(byte buttonIndex);
int8_t stepToButtonIndex(byte stepIndex);
bool confirmClearHeld();
void resetInputState();
void serviceInput();
void handleButtonEvent(byte buttonIndex, bool pressed);

}  // namespace sequencer
