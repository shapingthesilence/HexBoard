#pragma once

#include "../FirmwareModule.h"
#include "../hardware/LedColor.h"

namespace sequencer {

using FileMenuSetLedPixelFn = void (*)(byte buttonIndex, LedColor color);

void setupSequenceFileMenu(GEMPage& sequencerMenuPage);
bool fileWorkflowActive();
bool fileNamingActive();
void serviceSequenceFileMenu();
bool handleFileMenuButtonEvent(byte buttonIndex, bool pressed);
bool handleFileMenuRotaryTurn(int8_t direction);
bool handleFileMenuEncoderClick();
void drawFileMenuOverlay();
void renderFileMenuLedOverrides(FileMenuSetLedPixelFn setLedPixel);

}  // namespace sequencer
