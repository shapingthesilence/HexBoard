#pragma once

#include "../FirmwareModule.h"
#include "../hardware/LedColor.h"

namespace sequencer {

using SetLedPixelFn = void (*)(byte buttonIndex, LedColor color);

void renderLedOverrides(SetLedPixelFn setLedPixel);

}  // namespace sequencer
