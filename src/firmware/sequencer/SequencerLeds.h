#pragma once

#include "../FirmwareModule.h"

namespace sequencer {

using SetLedPixelFn = void (*)(byte buttonIndex, uint32_t color);

void renderLedOverrides(SetLedPixelFn setLedPixel);

}  // namespace sequencer
