#pragma once

#include "../FirmwareModule.h"

void RAM_FUNC(tryMIDInoteOn)(byte x);
void RAM_FUNC(tryMIDInoteOff)(byte x);
bool RAM_FUNC(mappedButtonHasAdvancedAction)(byte x);
void RAM_FUNC(tryMappedButtonActionOn)(byte x);
void RAM_FUNC(tryMappedButtonActionOff)(byte x);
void RAM_FUNC(releaseAllMappedButtonActions)();
