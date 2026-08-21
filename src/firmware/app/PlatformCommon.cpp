#include "../FirmwareModule.h"
#include "PlatformCommon.h"
#include "../hardware/GridScanRotary.h"
#include "../hardware/LedRender.h"
#include "../menu/MenuAndDisplay.h"
#include "../menu/SynthPresetMenu.h"
#include "../menu/SynthWavetableMenu.h"
#include "../midi/MidiInput.h"
#include "../midi/MidiRouting.h"
#include "../model/PitchAssignment.h"
#include "../storage/Settings.h"
#include "../storage/PresetSync.h"
#include "../storage/SynthPresetStorage.h"
#include "../storage/SynthWavetableStorage.h"
#include "../synth/BuiltinWavetables.h"
#include "../synth/SynthAudio.h"

// Software-detected hardware revision.
byte Hardware_Version = HARDWARE_UNKNOWN;

bool RAM_FUNC(isValidMidiChannel)(byte channel) {
  return (channel >= MIDI_CHANNEL_MIN) && (channel <= MIDI_CHANNEL_MAX);
}

std::array<MidiNoteHexIndexList, 128> midiNoteToHexIndices = {};
/*
    C++ returns a negative value for
    negative N % D. This function
    guarantees the mod value is always
    positive.
  */
int RAM_FUNC(positiveMod)(int n, int d) {
  int remainder = n % d;
  return (remainder < 0) ? (remainder + d) : remainder;
}
/*
    There may already exist linear interpolation
    functions in the standard library. This one is helpful
    because it will do the weighting division for you.
    It only works on byte values since it's intended
    to blend color values together. A better C++
    coder may be able to allow automatic type casting here.
  */
byte byteLerp(byte xOne, byte xTwo, float yOne, float yTwo, float y) {
  float weight = (y - yOne) / (yTwo - yOne);
  int temp = xOne + ((xTwo - xOne) * weight);
  if (temp < xOne) { temp = xOne; }
  if (temp > xTwo) { temp = xTwo; }
  return temp;
}

/*
    A HexBoard note can travel outside the 0-127 MIDI
    note range. When that happens, we keep the note
    value within one MIDI channel and move the overflow
    into a channel offset instead.
  */
void RAM_FUNC(splitExtendedMidiNote)(int32_t midiIndex, int32_t& channelOffsetOut, byte& noteOut) {
  channelOffsetOut = midiIndex / MIDI_NOTES_PER_CHANNEL;
  int32_t remainder = midiIndex % MIDI_NOTES_PER_CHANNEL;
  if (remainder < 0) {
    remainder += MIDI_NOTES_PER_CHANNEL;
    channelOffsetOut -= 1;
  }
  noteOut = static_cast<byte>(remainder);
}

byte RAM_FUNC(wrapMidiChannel)(byte baseChannel, int32_t offset) {
  if (!isValidMidiChannel(baseChannel)) {
    baseChannel = MIDI_CHANNEL_MIN;
  }
  int32_t index = static_cast<int32_t>(baseChannel - MIDI_CHANNEL_MIN) + offset;
  index %= MIDI_CHANNEL_COUNT;
  if (index < 0) {
    index += MIDI_CHANNEL_COUNT;
  }
  return static_cast<byte>(index + MIDI_CHANNEL_MIN);
}

void RAM_FUNC(mapExtendedMidiNote)(int32_t midiIndex, byte baseChannel, byte& noteOut, byte& channelOut) {
  int32_t channelOffset = 0;
  splitExtendedMidiNote(midiIndex, channelOffset, noteOut);
  channelOut = wrapMidiChannel(baseChannel, channelOffset);
}

int32_t midiChannelOffset(int32_t midiIndex) {
  int32_t channelOffset = 0;
  byte unusedNote = 0;
  splitExtendedMidiNote(midiIndex, channelOffset, unusedNote);
  return channelOffset;
}
