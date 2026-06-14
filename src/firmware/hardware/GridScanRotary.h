#pragma once

#include "../FirmwareModule.h"

void setupHardware();
void setupRotary();
void dealWithRotary();
void RAM_FUNC(readHexes)();
void RAM_FUNC(updateWheels)();
void RAM_FUNC(readKnob)();
