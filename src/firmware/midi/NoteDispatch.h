#pragma once

#include "../FirmwareModule.h"

void RAM_FUNC(tryMIDInoteOn)(byte x);
void RAM_FUNC(tryMIDInoteOff)(byte x);
uint8_t RAM_FUNC(currentSynthVoiceLimit)();
