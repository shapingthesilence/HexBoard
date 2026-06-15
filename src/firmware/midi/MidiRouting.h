#pragma once

#include "../FirmwareModule.h"

extern byte MPEpitchBendsNeeded;

uint8_t mpePlayableChannelCount();
byte RAM_FUNC(takeMPEChannel)();
void RAM_FUNC(releaseMPEChannel)(byte ch);
float freqToMIDI(float Hz);
float MIDItoFreq(float midi);
float stepsToMIDI(int16_t stepsFromA);
void refreshMidiRouting();
void sendSysExToConfiguredMidiOutputs(unsigned length, const byte* data);
