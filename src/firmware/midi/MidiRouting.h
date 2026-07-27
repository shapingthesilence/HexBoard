#pragma once

#include "../FirmwareModule.h"
#include "MidiTransport.h"

extern byte MPEpitchBendsNeeded;
extern bool mpeChannelQueueActive;

uint8_t RAM_FUNC(mpePlayableChannelCount)();
byte RAM_FUNC(takeMPEChannel)();
void RAM_FUNC(releaseMPEChannel)(byte ch);
void resetTuningMIDI();
byte primaryMIDIChannel();
void RAM_FUNC(sendMIDImodulationToCh1)();
void RAM_FUNC(sendMIDIpitchBendToCh1)();
float RAM_FUNC(freqToMIDI)(float Hz);
float RAM_FUNC(MIDItoFreq)(float midi);
uint8_t RAM_FUNC(currentTuningReferenceMidiNote)();
float RAM_FUNC(currentTuningReferenceHz)();
float RAM_FUNC(currentTuningNominalStepSizeCents)();
int32_t RAM_FUNC(currentPitchStepsFromReference)(int16_t stepsFromC);
float RAM_FUNC(stepsToCentsFromReference)(int16_t stepsFromReference);
float RAM_FUNC(stepsToFrequency)(int16_t stepsFromReference);
float RAM_FUNC(stepsToMIDI)(int16_t stepsFromReference);
bool currentTuningIsStandardSemitone();
void refreshMidiRouting();
void sendSysExToConfiguredMidiOutputs(unsigned length, const byte* data);
void sendRealTimeToConfiguredMidiOutputs(uint8_t status);
