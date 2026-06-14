#pragma once

#include "../FirmwareModule.h"

extern std::vector<byte> pressedKeyIDs;

void syncDynamicJIRatioCandidates();
int16_t justIntonationRetune(byte x);
void prepareActiveMidiPitch(byte x);
