#pragma once

#include "../FirmwareModule.h"
#include <MIDIUSB.h>

constexpr float CONCERT_A_HZ = 440.0f;
constexpr float CONCERT_A_MIDI_NOTE = 69.0f;
constexpr byte DEFAULT_PITCH_BEND_RANGE_SEMITONES = 2;

constexpr byte MIDID_NONE = 0;
constexpr byte MIDID_USB = 1;
constexpr byte MIDID_SER = 2;
constexpr byte MIDID_BOTH = 3;
constexpr uint16_t MIDI_INPUT_DRAIN_BYTE_LIMIT = 512;

extern byte MPEpitchBendSemis;
extern byte midiD;

void setupUSBDescriptors();
void setupMIDI();
