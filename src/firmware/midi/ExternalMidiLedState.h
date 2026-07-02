#pragma once

#include "../FirmwareModule.h"

bool shouldDeferMidiInLedRefresh();
void RAM_FUNC(applyExternalMidiToHex)(byte midiNote, bool noteOn);
