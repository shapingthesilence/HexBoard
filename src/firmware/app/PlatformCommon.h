#pragma once

#include "../FirmwareModule.h"

constexpr byte HARDWARE_UNKNOWN = 0;
constexpr byte HARDWARE_V1_1 = 1;
constexpr byte HARDWARE_V1_2 = 2;
constexpr byte SDAPIN = 16;
constexpr byte SCLPIN = 17;
constexpr byte MIDI_CHANNEL_MIN = 1;
constexpr byte MIDI_CHANNEL_MAX = 16;
constexpr byte MIDI_CHANNEL_COUNT = MIDI_CHANNEL_MAX - MIDI_CHANNEL_MIN + 1;
constexpr byte MPE_CHANNEL_MIN = 2;
constexpr int32_t MIDI_NOTES_PER_CHANNEL = 128;

extern byte Hardware_Version;
extern std::array<std::vector<uint8_t>, 128> midiNoteToHexIndices;
extern volatile uint32_t audioDmaUnderrunCount;

bool isValidMidiChannel(byte channel);
int RAM_FUNC(positiveMod)(int n, int d);
byte byteLerp(byte xOne, byte xTwo, float yOne, float yTwo, float y);
void splitExtendedMidiNote(int32_t midiIndex, int32_t& channelOffsetOut, byte& noteOut);
byte wrapMidiChannel(byte baseChannel, int32_t offset);
void mapExtendedMidiNote(int32_t midiIndex, byte baseChannel, byte& noteOut, byte& channelOut);
int32_t midiChannelOffset(int32_t midiIndex);
