#pragma once

#include "../FirmwareModule.h"
#include "MidiTransport.h"

extern byte MPEpitchBendsNeeded;
extern bool mpeChannelQueueActive;

uint8_t mpePlayableChannelCount();
byte RAM_FUNC(takeMPEChannel)();
void RAM_FUNC(releaseMPEChannel)(byte ch);
void resetTuningMIDI();
byte primaryMIDIChannel();
void RAM_FUNC(sendMIDImodulationToCh1)();
void RAM_FUNC(sendMIDIpitchBendToCh1)();
float freqToMIDI(float Hz);
float MIDItoFreq(float midi);
float stepsToMIDI(int16_t stepsFromA);
void refreshMidiRouting();
void sendSysExToConfiguredMidiOutputs(unsigned length, const byte* data);
