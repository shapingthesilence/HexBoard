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

// @init
#include <Arduino.h>  // this is necessary to talk to the Hexboard!
#include <Wire.h>     // this is necessary to connect with I2C devices (such as the oled display)
#include <GEM_u8g2.h>  // library of code to create menu objects on the B&W display
#include <algorithm>
#include <array>
#include <atomic>
#include <cstdio>
#include <cstring>
#if defined(ARDUINO_ARCH_RP2040) //This is to enable RAM functions on the RP2040 specifically in case we port this to other architectures later
#include <hardware/flash.h>     // to access the __not_in_flash_func
#define RAM_FUNC(name) __not_in_flash_func(name) // macro to keep code clean - use RAM_FUNC(yourFunctionName) to have it run from RAM
#else
#define RAM_FUNC(name) name // do nothing on other architectures
#endif
#include <cmath>
#include <numeric>     // need that GCD function, son
#include <string>      // standard C++ library string classes (use "std::string" to invoke it); these do not cause the memory corruption that Arduino::String does.
#include <limits>
#include <queue>       // standard C++ library construction for various FIFO pools (use "std::queue" to invoke it)
#include <vector>
#include "LittleFS.h"  // code to use a portion of the 16MB flash chip space as a file system
#include "pico/time.h" // Allows me to set delays that don't disable interrupts
#include "hardware/structs/sio.h" // For fast GPIO read/write
#include "hardware/dma.h"

// Software-detected hardware revision.
byte Hardware_Version = HARDWARE_UNKNOWN;

bool RAM_FUNC(isValidMidiChannel)(byte channel) {
  return (channel >= MIDI_CHANNEL_MIN) && (channel <= MIDI_CHANNEL_MAX);
}

// @helpers
//might be redundant
std::array<std::vector<uint8_t>, 128> midiNoteToHexIndices = {};
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
