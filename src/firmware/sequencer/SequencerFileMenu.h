#pragma once

#include "../FirmwareModule.h"

namespace sequencer {

using FileMenuSetLedPixelFn = void (*)(byte buttonIndex, uint32_t color);

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
