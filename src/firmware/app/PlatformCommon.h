#pragma once

#include "../FirmwareModule.h"
#include "../hardware/HardwareConfig.h"

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
