#pragma once

#include "../FirmwareModule.h"

void setupSequencerMenu();
bool sequencerModeActive();
void enterSequencerMode();
void exitSequencerMode();
void serviceSequencerMode();
void handleSequencerButtonEvent(byte buttonIndex, bool pressed);
bool handleSequencerRotaryTurn(int8_t direction);
bool handleSequencerEncoderClick();
void drawSequencerModeDisplay();
