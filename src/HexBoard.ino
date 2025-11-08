// @readme
/*
    HexBoard
    Copyright 2022-2025 Jared DeCook and Zach DeCook
    with help from Nicholas Fox
    Licensed under the GNU GPL Version 3.

    Hardware information:
      Generic RP2040 running at 133MHz with 16MB of flash
        https://github.com/earlephilhower/arduino-pico
      Additional board manager URL:
        https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json
      Tools > USB Stack > (Adafruit TinyUSB)
      Sketch > Export Compiled Binary

    Compilation instructions:
      Using arduino-cli...
        # Download the board index
        arduino-cli --additional-urls=https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json core update-index
        # Install the core for rp2040
        arduino-cli --additional-urls=https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json core download rp2040:rp2040
        arduino-cli --additional-urls=https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json core install rp2040:rp2040
        # Install libraries
        arduino-cli lib install "MIDI library"
        arduino-cli lib install "Adafruit NeoPixel"
        arduino-cli lib install "U8g2" # dependency for GEM
        arduino-cli lib install "Adafruit GFX Library" # dependency for GEM
        arduino-cli lib install "GEM"
        sed -i 's@#include "config/enable-glcd.h"@//\0@g' ~/Arduino/libraries/GEM/src/config.h # remove dependency from GEM - I think this is unnecessary now.
        # Run Make to build the firmware
        make
    ---------------------------
    New to programming Arduino?
    ---------------------------
    Coding the Hexboard is, basically, done in C++.

    When the HexBoard is plugged in, it runs
    void setup() and void setup1(), then
    runs void loop() and void loop1() on an
    infinite loop until the HexBoard powers down.
    There are two cores running independently.
    You can pretend that the compiler tosses
    these two routines inside an int main() for
    each processor.

    To #include libraries, the Arduino
    compiler expects them to be installed from
    a centralized repository. You can also bring
    your own .h / .cpp code but it must be saved
    in "/src/____/___.h" to be valid.

    We found this really annoying so to the
    extent possible we have consolidated
    this code into one single .ino sketch file.
    However, the code is sectioned into something
    like a library format for each feature
    of the HexBoard, so that if the code becomes
    too long to manage in a single file in the
    future, it is easier to air-lift parts of
    the code into a library at that point.
  */

// @init
#include <Arduino.h>  // this is necessary to talk to the Hexboard!
#include <Wire.h>     // this is necessary to connect with I2C devices (such as the oled display)
#define SDAPIN 16
#define SCLPIN 17
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
#include "pico/time.h" // Allows me to set delays that don't disable interrupts
#include "hardware/structs/sio.h" // For fast GPIO read/write

                       // Software-detected hardware revision
#define HARDWARE_UNKNOWN 0
#define HARDWARE_V1_1 1
#define HARDWARE_V1_2 2
byte Hardware_Version = 0;  // 0 = unknown, 1 = v1.1 board. 2 = v1.2 board.

// @helpers
//might be redundant
std::vector<byte> pressedKeyIDs = {};
std::array<std::vector<uint8_t>, 128> midiNoteToHexIndices = {};

void updateEnvelopeParamsFromSettings();
void updateArpeggiatorTiming();
/*
    C++ returns a negative value for
    negative N % D. This function
    guarantees the mod value is always
    positive.
  */
int positiveMod(int n, int d) {
  return (((n % d) + d) % d);
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

byte wrapMidiChannel(byte baseChannel, int32_t offset) {
  if (baseChannel < 1 || baseChannel > 16) {
    baseChannel = 1;
  }
  int32_t index = static_cast<int32_t>(baseChannel - 1) + offset;
  index %= 16;
  if (index < 0) {
    index += 16;
  }
  return static_cast<byte>(index + 1);
}

void mapExtendedMidiNote(int32_t midiIndex, byte baseChannel, byte& noteOut, byte& channelOut) {
  int32_t offset = midiIndex / 128;
  int32_t remainder = midiIndex % 128;
  if (remainder < 0) {
    remainder += 128;
    offset -= 1;
  }
  channelOut = wrapMidiChannel(baseChannel, offset);
  noteOut = static_cast<byte>(remainder);
}

int32_t midiChannelOffset(int32_t midiIndex) {
  int32_t offset = midiIndex / 128;
  int32_t remainder = midiIndex % 128;
  if (remainder < 0) {
    remainder += 128;
    offset -= 1;
  }
  return offset;
}

// @defaults
/*
    This section sets default values
    for user-editable options
  */
constexpr byte MPE_MODE_AUTO = 0;
constexpr byte MPE_MODE_DISABLE = 1;
constexpr byte MPE_MODE_FORCE = 2;

byte mpeUserMode = MPE_MODE_AUTO;
bool extraMPE = false;
bool standardMidiMicrotonalActive = false;
byte standardMidiBaseChannel = 1;
byte mpeLowestChannel = 2;
byte mpeHighestChannel = 16;
bool mpeLowPriorityMode = false;
byte ledRestBrightness = 255;
byte ledDimBrightness = 255;

void clampMPEChannelRange() {
  if (mpeLowestChannel < 2) {
    mpeLowestChannel = 2;
  }
  if (mpeLowestChannel > 16) {
    mpeLowestChannel = 16;
  }
  if (mpeHighestChannel < 2) {
    mpeHighestChannel = 2;
  }
  if (mpeHighestChannel > 16) {
    mpeHighestChannel = 16;
  }
  if (mpeLowestChannel > mpeHighestChannel) {
    mpeHighestChannel = mpeLowestChannel;
  }
}

byte applyLEDLevel(byte value, byte level) {
  uint16_t scaled = static_cast<uint16_t>(value) * static_cast<uint16_t>(level);
  return static_cast<byte>((scaled + 127) / 255);
}

byte CC74value = 0;
byte defaultMidiChannel = 1;
byte layoutRotation = 0;

byte arpeggiatorDivision = 32;  // denominator of whole-note duration (1/32 by default)
byte synthBPM = 120;

//  Keyboard layout swapping
bool mirrorLeftRight = false;
bool mirrorUpDown = false;

//  Just Intonation related global variables
byte justIntonationBPM = 60;
byte justIntonationBPM_Multiplier = 1;
bool useJustIntonationBPM = false;
bool useDynamicJustIntonation = false;

int transposeSteps = 0;
bool scaleLock = 0;
bool perceptual = 1;
bool paletteBeginsAtKeyCenter = 1;
byte animationFPS = 32;  // actually frames per 2^20 microseconds. close enough to 30fps

byte wheelMode = 0;  // standard vs. fine tune mode
byte modSticky = 0;
byte pbSticky = 0;
byte velSticky = 1;
int modWheelSpeed = 8;
int pbWheelSpeed = 1024;
int velWheelSpeed = 8;

uint8_t envelopeAttackIndex = 2;
uint8_t envelopeDecayIndex = 3;
uint8_t envelopeSustainLevel = 127;
uint8_t envelopeReleaseIndex = 3;

#define SYNTH_OFF 0
#define SYNTH_MONO 1
#define SYNTH_ARPEGGIO 2
#define SYNTH_POLY 3
byte playbackMode = SYNTH_OFF;

#define WAVEFORM_SINE 0
#define WAVEFORM_STRINGS 1
#define WAVEFORM_CLARINET 2
#define WAVEFORM_HYBRID 7
#define WAVEFORM_SQUARE 8
#define WAVEFORM_SAW 9
#define WAVEFORM_TRIANGLE 10
byte currWave = WAVEFORM_HYBRID;

#define RAINBOW_MODE 0
#define TIERED_COLOR_MODE 1
#define ALTERNATE_COLOR_MODE 2
#define RAINBOW_OF_FIFTHS_MODE 3
#define PIANO_ALT_COLOR_MODE 4
#define PIANO_COLOR_MODE 5
#define PIANO_INCANDESCENT_COLOR_MODE 6
byte colorMode = RAINBOW_MODE;

#define ANIMATE_BUTTON 0
#define ANIMATE_STAR 1
#define ANIMATE_SPLASH 2
#define ANIMATE_ORBIT 3
#define ANIMATE_OCTAVE 4
#define ANIMATE_BY_NOTE 5
#define ANIMATE_BEAMS 6
#define ANIMATE_SPLASH_REVERSE 7
#define ANIMATE_STAR_REVERSE 8
#define ANIMATE_MIDI_IN 9
#define ANIMATE_NONE 10
byte animationType = ANIMATE_BUTTON;

#define BRIGHT_MAX 255
#define BRIGHT_HIGH 210
#define BRIGHT_MID 180
#define BRIGHT_LOW 150
#define BRIGHT_DIM 110
#define BRIGHT_DIMMER 70
#define BRIGHT_DARK 50     // BRIGHT_DIMMEST
#define BRIGHT_DARKER 34   // Lowest brightness before backlight shuts down
#define BRIGHT_FAINT 33    // Highest brightness before backlight turns on
#define BRIGHT_FAINTER 24  // Lowest brightness before any highlighted button is lit in all color modes
#define BRIGHT_OFF 0
byte globalBrightness = BRIGHT_DIM;

// @microtonal
/*
    Most users will stick to playing in standard Western
    tuning, but for those looking to play microtonally,
    the Hexboard accommodates equal step tuning systems
    of any arbitrary size.
  */
/*
    Each tuning system needs to be
    pre-defined, pre-counted, and enumerated as below.
    Future editions of this sketch may enable free
    definition and smart pointer references to tuning
    presets without requiring an enumeration.
  */
#define TUNING_12EDO 0
#define TUNING_12EDO_ZETA 1
#define TUNING_17EDO 2
#define TUNING_19EDO 3
#define TUNING_22EDO 4
#define TUNING_24EDO 5
#define TUNING_31EDO 6
#define TUNING_31EDO_ZETA 7
#define TUNING_41EDO 8
#define TUNING_43EDO 9
#define TUNING_46EDO 10
#define TUNING_53EDO 11
#define TUNING_58EDO 12
#define TUNING_58EDO_ZETA 13
#define TUNING_72EDO 14
#define TUNING_72EDO_ZETA 15
#define TUNING_80EDO 16
#define TUNING_87EDO 17
#define TUNING_BP    18
#define TUNING_ALPHA 19
#define TUNING_BETA  20
#define TUNING_GAMMA 21
#define TUNINGCOUNT  22
/*
    Note names and palette arrays are allocated in memory
    at runtime. Their usable size is based on the number
    of steps (in standard tuning, semitones) in a tuning
    system before a new period is reached (in standard
    tuning, the octave). This value provides a maximum
    array size that handles almost all useful tunings
    without wasting much space.
  */
#define MAX_SCALE_DIVISIONS 87
/*
    A dictionary of musical scales is defined in the code.
    A scale is tied to one tuning system, with the exception
    of "no scale" (i.e. every note is part of the scale).
    "No scale" is tied to this value "ALL_TUNINGS" so it can
    always be chosen in the menu.
  */
#define ALL_TUNINGS 255
/*
    MIDI notes are enumerated 0-127 (7 bits).
    Values of 128-255 can be used to indicate
    command instructions for non-note buttons.
    These definitions support this function.
  */
#define CMDB 192
#define UNUSED_NOTE 255
/*
    When sending smoothly-varying pitch bend
    or modulation messages over MIDI, the
    code uses a cool-down period of about
    1/60 of a second in between messages, enough
    for changes to sound continuous without
    overloading the MIDI message queue.
  */
#define CC_MSG_COOLDOWN_MICROSECONDS 16667
/*
    This class provides the seed values
    needed to map buttons to note frequencies
    and palette colors, and to populate
    the menu with correct key names and
    scale choices, for a given equal step
    tuning system.
  */
class tuningDef {
public:
  std::string name;  // limit is 17 characters for GEM menu
  byte cycleLength;  // steps before period/cycle/octave repeats
  float stepSize;    // in cents, 100 = "normal" semitone.
  SelectOptionInt keyChoices[MAX_SCALE_DIVISIONS];
  int spanCtoA() {
    return keyChoices[0].val_int;
  }
};
/*
    Note that for all practical musical purposes,
    expressing step sizes to six significant figures is
    sufficient to eliminate any detectable tuning artifacts
    due to rounding.

    The note names are formatted in an array specifically to
    match the format needed for the GEM Menu to accept directly
    as a spinner selection item. The number next to the note name
    is the number of steps from the anchor note A that key is.

    There are other ways the tuning could be calculated.
    Some microtonal players choose an anchor note
    other than A 440. Future versions will allow for
    more flexibility in anchor selection, which will also
    change the implementation of key options.
  */

constexpr std::array<uint32_t, 10> envelopeTimeMicrosOptions = {
  0, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000, 2000000
};
constexpr uint32_t envelopeMaxLevel = 65535;

enum class EnvelopeStage : uint8_t {
  Idle,
  Attack,
  Decay,
  Sustain,
  Release
};

struct EnvelopeParams {
  uint32_t attackTicks = 0;
  uint32_t decayTicks = 0;
  uint32_t releaseTicks = 0;
  uint32_t attackIncrement = envelopeMaxLevel;
  uint32_t decayIncrement = envelopeMaxLevel;
  uint16_t sustainLevel = envelopeMaxLevel;
};

EnvelopeParams envelopeParams;

/*
    Sko: I felt like maximizing precision for just intonation purposes.
    Values are precalculated by compiler, and MIDI 2.0 or later might benefit from it
  */
tuningDef tuningOptions[] = {
  { "12 EDO (Normal)", 12, 100.000, { { "C", -9 }, { "C#", -8 }, { "D", -7 }, { "Eb", -6 }, { "E", -5 }, { "F", -4 }, { "F#", -3 }, { "G", -2 }, { "G#", -1 }, { "A", 0 }, { "Bb", 1 }, { "B", 2 } } },
  { "12 TET 34 ZPI", 12, 99.8071807833375, { { "C", -9 }, { "C#", -8 }, { "D", -7 }, { "Eb", -6 }, { "E", -5 }, { "F", -4 }, { "F#", -3 }, { "G", -2 }, { "G#", -1 }, { "A", 0 }, { "Bb", 1 }, { "B", 2 } } },
  { "17 EDO", 17, 1200.0 / 17.0, { { "C", -13 }, { "Db", -12 }, { "C#", -11 }, { "D", -10 }, { "Eb", -9 }, { "D#", -8 }, { "E", -7 }, { "F", -6 }, { "Gb", -5 }, { "F#", -4 }, { "G", -3 }, { "Ab", -2 }, { "G#", -1 }, { "A", 0 }, { "Bb", 1 }, { "A#", 2 }, { "B", 3 } } },
  { "19 EDO", 19, 1200.0 / 19.0, { { "C", -14 }, { "C#", -13 }, { "Db", -12 }, { "D", -11 }, { "D#", -10 }, { "Eb", -9 }, { "E", -8 }, { "E#", -7 }, { "F", -6 }, { "F#", -5 }, { "Gb", -4 }, { "G", -3 }, { "G#", -2 }, { "Ab", -1 }, { "A", 0 }, { "A#", 1 }, { "Bb", 2 }, { "B", 3 }, { "Cb", 4 } } },
  { "22 EDO", 22, 1200.0 / 22.0, { { " C", -17 }, { "^C", -16 }, { "vC#", -15 }, { "vD", -14 }, { " D", -13 }, { "^D", -12 }, { "^Eb", -11 }, { "vE", -10 }, { " E", -9 }, { " F", -8 }, { "^F", -7 }, { "vF#", -6 }, { "vG", -5 }, { " G", -4 }, { "^G", -3 }, { "vG#", -2 }, { "vA", -1 }, { " A", 0 }, { "^A", 1 }, { "^Bb", 2 }, { "vB", 3 }, { " B", 4 } } },
  { "24 EDO", 24, 1200.0 / 24.0, { { "C", -18 }, { "C+", -17 }, { "C#", -16 }, { "Dd", -15 }, { "D", -14 }, { "D+", -13 }, { "Eb", -12 }, { "Ed", -11 }, { "E", -10 }, { "E+", -9 }, { "F", -8 }, { "F+", -7 }, { "F#", -6 }, { "Gd", -5 }, { "G", -4 }, { "G+", -3 }, { "G#", -2 }, { "Ad", -1 }, { "A", 0 }, { "A+", 1 }, { "Bb", 2 }, { "Bd", 3 }, { "B", 4 }, { "Cd", 5 } } },
  { "31 EDO", 31, 1200.0 / 31.0, { { "C", -23 }, { "C+", -22 }, { "C#", -21 }, { "Db", -20 }, { "Dd", -19 }, { "D", -18 }, { "D+", -17 }, { "D#", -16 }, { "Eb", -15 }, { "Ed", -14 }, { "E", -13 }, { "E+", -12 }, { "Fd", -11 }, { "F", -10 }, { "F+", -9 }, { "F#", -8 }, { "Gb", -7 }, { "Gd", -6 }, { "G", -5 }, { "G+", -4 }, { "G#", -3 }, { "Ab", -2 }, { "Ad", -1 }, { "A", 0 }, { "A+", 1 }, { "A#", 2 }, { "Bb", 3 }, { "Bd", 4 }, { "B", 5 }, { "B+", 6 }, { "Cd", 7 } } },
  { "31 TET 127 ZPI", 31, 1200.0 / 30.9783816349790, { { "C", -23 }, { "C+", -22 }, { "C#", -21 }, { "Db", -20 }, { "Dd", -19 }, { "D", -18 }, { "D+", -17 }, { "D#", -16 }, { "Eb", -15 }, { "Ed", -14 }, { "E", -13 }, { "E+", -12 }, { "Fd", -11 }, { "F", -10 }, { "F+", -9 }, { "F#", -8 }, { "Gb", -7 }, { "Gd", -6 }, { "G", -5 }, { "G+", -4 }, { "G#", -3 }, { "Ab", -2 }, { "Ad", -1 }, { "A", 0 }, { "A+", 1 }, { "A#", 2 }, { "Bb", 3 }, { "Bd", 4 }, { "B", 5 }, { "B+", 6 }, { "Cd", 7 } } },
  { "41 EDO", 41, 1200.0 / 41.0, { { " C", -31 }, { "^C", -30 }, { " C+", -29 }, { " Db", -28 }, { " C#", -27 }, { " Dd", -26 }, { "vD", -24 }, { " D", -24 }, { "^D", -23 }, { " D+", -22 }, { " Eb", -21 }, { " D#", -20 }, { " Ed", -19 }, { "vE", -18 }, { " E", -17 }, { "^E", -16 }, { "vF", -15 }, { " F", -14 }, { "^F", -13 }, { " F+", -12 }, { " Gb", -11 }, { " F#", -10 }, { " Gd", -9 }, { "vG", -8 }, { " G", -7 }, { "^G", -6 }, { " G+", -5 }, { " Ab", -4 }, { " G#", -3 }, { " Ad", -2 }, { "vA", -1 }, { " A", 0 }, { "^A", 1 }, { " A+", 2 }, { " Bb", 3 }, { " A#", 4 }, { " Bd", 5 }, { "vB", 6 }, { " B", 7 }, { "^B", 8 }, { "vC", 9 } } },
  { "43 EDO", 43, 1200.0 / 43.0, { { " C", -32 }, { "C+1", -31 }, { "C+2", -30 }, { "C+3", -29 }, { "C+4", -28 }, { "C+5", -27 }, { "C+6", -26 }, { " D", -25 }, { "D+1", -24 }, { "D+2", -23 }, { "D+3", -22 }, { "D+4", -21 }, { "D+5", -20 }, { "D+6", -19 }, { " E", -18 }, { "E+1", -17 }, { "E+2", -16 }, { "E+3", -15 }, { " F", -14 }, { "F+1", -13 }, { "F+2", -12 }, { "F+3", -11 }, { "F+4", -10 }, { "F+5", -9 }, { "F+6", -8 }, { " G", -7 }, { "G+1", -6 }, { "G+2", -5 }, { "G+3", -4 }, { "G+4", -3 }, { "G+5", -2 }, { "G+6", -1 }, { " A", 0 }, { "A+1", 1 }, { "A+2", 2 }, { "A+3", 3 }, { "A+4", 4 }, { "A+5", 5 }, { "A+6", 6 }, { " B", 7 }, { "B+1", 8 }, { "B+2", 9 }, { "B+3", 10 }, { "B+4", 11 } } },
  { "46 EDO", 46, 1200.0 / 46.0, { { " C", -35 }, { "C+1", -34 }, { "C+2", -33 }, { "C+3", -32 }, { "C+4", -31 }, { "C+5", -30 }, { "C+6", -29 }, { "C+7", -28 }, { " D", -27 }, { "D+1", -26 }, { "D+2", -25 }, { "D+3", -24 }, { "D+4", -23 }, { "D+5", -22 }, { "D+6", -21 }, { "D+7", -20 }, { " E", -19 }, { "E+1", -18 }, { "E+2", -17 }, { " F", -16 }, { "F+1", -15 }, { "F+2", -14 }, { "F+3", -13 }, { "F+4", -12 }, { "F+5", -11 }, { "F+6", -10 }, { "F+7", -9 }, { " G", -8 }, { "G+1", -7 }, { "G+2", -6 }, { "G+3", -5 }, { "G+4", -4 }, { "G+5", -3 }, { "G+6", -2 }, { "G+7", -1 }, { " A", 0 }, { "A+1", 1 }, { "A+2", 2 }, { "A+3", 3 }, { "A+4", 4 }, { "A+5", 5 }, { "A+6", 6 }, { "A+7", 7 }, { " B", 8 }, { "B+1", 9 }, { "B+2", 10 } } },
  { "53 EDO", 53, 1200.0 / 53.0, { { " C", -40 }, { "^C", -39 }, { ">C", -38 }, { "vDb", -37 }, { "Db", -36 }, { " C#", -35 }, { "^C#", -34 }, { "<D", -33 }, { "vD", -32 }, { " D", -31 }, { "^D", -30 }, { ">D", -29 }, { "vEb", -28 }, { "Eb", -27 }, { " D#", -26 }, { "^D#", -25 }, { "<E", -24 }, { "vE", -23 }, { " E", -22 }, { "^E", -21 }, { ">E", -20 }, { "vF", -19 }, { " F", -18 }, { "^F", -17 }, { ">F", -16 }, { "vGb", -15 }, { "Gb", -14 }, { " F#", -13 }, { "^F#", -12 }, { "<G", -11 }, { "vG", -10 }, { " G", -9 }, { "^G", -8 }, { ">G", -7 }, { "vAb", -6 }, { "Ab", -5 }, { " G#", -4 }, { "^G#", -3 }, { "<A", -2 }, { "vA", -1 }, { " A", 0 }, { "^A", 1 }, { ">A", 2 }, { "vBb", 3 }, { "Bb", 4 }, { " A#", 5 }, { "^A#", 6 }, { "<B", 7 }, { "vB", 8 }, { " B", 9 }, { "^B", 10 }, { "<C", 11 }, { "vC", 12 } } },
  { "58 EDO", 58, 1200.0 / 58.0, { { " C", -44 }, { "C+1", -43 }, { "C+2", -42 }, { "C+3", -41 }, { "C+4", -40 }, { "C+5", -39 }, { "C+6", -38 }, { "C+7", -37 }, { "C+8", -36 }, { "C+8", -35 }, { " D", -34 }, { "D+1", -33 }, { "D+2", -32 }, { "D+3", -31 }, { "D+4", -30 }, { "D+5", -29 }, { "D+6", -28 }, { "D+7", -27 }, { "D+8", -26 }, { "D+8", -25 }, { " E", -24 }, { "E+1", -23 }, { "E+2", -22 }, { "E+3", -21 }, { " F", -20 }, { "F+1", -19 }, { "F+2", -18 }, { "F+3", -17 }, { "F+4", -16 }, { "F+5", -15 }, { "F+6", -14 }, { "F+7", -13 }, { "F+8", -12 }, { "F+9", -11 }, { " G", -10 }, { "G+1", -9 }, { "G+2", -8 }, { "G+3", -7 }, { "G+4", -6 }, { "G+5", -5 }, { "G+6", -4 }, { "G+7", -3 }, { "G+8", -2 }, { "G+9", -1 }, { " A", 0 }, { "A+1", 1 }, { "A+2", 2 }, { "A+3", 3 }, { "A+4", 4 }, { "A+5", 5 }, { "A+6", 6 }, { "A+7", 7 }, { "A+8", 7 }, { "A+9", 7 }, { " B", 10 }, { "B+1", 11 }, { "B+2", 12 } } },
  { "58 EDO 289 ZPI", 58, 1200.0 / 58.0667185533159, { { " C", -44 }, { "C+1", -43 }, { "C+2", -42 }, { "C+3", -41 }, { "C+4", -40 }, { "C+5", -39 }, { "C+6", -38 }, { "C+7", -37 }, { "C+8", -36 }, { "C+8", -35 }, { " D", -34 }, { "D+1", -33 }, { "D+2", -32 }, { "D+3", -31 }, { "D+4", -30 }, { "D+5", -29 }, { "D+6", -28 }, { "D+7", -27 }, { "D+8", -26 }, { "D+8", -25 }, { " E", -24 }, { "E+1", -23 }, { "E+2", -22 }, { "E+3", -21 }, { " F", -20 }, { "F+1", -19 }, { "F+2", -18 }, { "F+3", -17 }, { "F+4", -16 }, { "F+5", -15 }, { "F+6", -14 }, { "F+7", -13 }, { "F+8", -12 }, { "F+9", -11 }, { " G", -10 }, { "G+1", -9 }, { "G+2", -8 }, { "G+3", -7 }, { "G+4", -6 }, { "G+5", -5 }, { "G+6", -4 }, { "G+7", -3 }, { "G+8", -2 }, { "G+9", -1 }, { " A", 0 }, { "A+1", 1 }, { "A+2", 2 }, { "A+3", 3 }, { "A+4", 4 }, { "A+5", 5 }, { "A+6", 6 }, { "A+7", 7 }, { "A+8", 7 }, { "A+9", 7 }, { " B", 10 }, { "B+1", 11 }, { "B+2", 12 } } },
  { "72 EDO", 72, 1200.0 / 72.0, { { " C", -54 }, { "^C", -53 }, { ">C", -52 }, { " C+", -51 }, { "<C#", -50 }, { "vC#", -49 }, { " C#", -48 }, { "^C#", -47 }, { ">C#", -46 }, { " Dd", -45 }, { "<D", -44 }, { "vD", -43 }, { " D", -42 }, { "^D", -41 }, { ">D", -40 }, { " D+", -39 }, { "<Eb", -38 }, { "vEb", -37 }, { " Eb", -36 }, { "^Eb", -35 }, { ">Eb", -34 }, { " Ed", -33 }, { "<E", -32 }, { "vE", -31 }, { " E", -30 }, { "^E", -29 }, { ">E", -28 }, { " E+", -27 }, { "<F", -26 }, { "vF", -25 }, { " F", -24 }, { "^F", -23 }, { ">F", -22 }, { " F+", -21 }, { "<F#", -20 }, { "vF#", -19 }, { " F#", -18 }, { "^F#", -17 }, { ">F#", -16 }, { " Gd", -15 }, { "<G", -14 }, { "vG", -13 }, { " G", -12 }, { "^G", -11 }, { ">G", -10 }, { " G+", -9 }, { "<G#", -8 }, { "vG#", -7 }, { " G#", -6 }, { "^G#", -5 }, { ">G#", -4 }, { " Ad", -3 }, { "<A", -2 }, { "vA", -1 }, { " A", 0 }, { "^A", 1 }, { ">A", 2 }, { " A+", 3 }, { "<Bb", 4 }, { "vBb", 5 }, { " Bb", 6 }, { "^Bb", 7 }, { ">Bb", 8 }, { " Bd", 9 }, { "<B", 10 }, { "vB", 11 }, { " B", 12 }, { "^B", 13 }, { ">B", 14 }, { " Cd", 15 }, { "<C", 16 }, { "vC", 17 } } },
  { "72 EDO 380 ZPI", 72, 1200.0 / 71.9506065993786, { { " C", -54 }, { "^C", -53 }, { ">C", -52 }, { " C+", -51 }, { "<C#", -50 }, { "vC#", -49 }, { " C#", -48 }, { "^C#", -47 }, { ">C#", -46 }, { " Dd", -45 }, { "<D", -44 }, { "vD", -43 }, { " D", -42 }, { "^D", -41 }, { ">D", -40 }, { " D+", -39 }, { "<Eb", -38 }, { "vEb", -37 }, { " Eb", -36 }, { "^Eb", -35 }, { ">Eb", -34 }, { " Ed", -33 }, { "<E", -32 }, { "vE", -31 }, { " E", -30 }, { "^E", -29 }, { ">E", -28 }, { " E+", -27 }, { "<F", -26 }, { "vF", -25 }, { " F", -24 }, { "^F", -23 }, { ">F", -22 }, { " F+", -21 }, { "<F#", -20 }, { "vF#", -19 }, { " F#", -18 }, { "^F#", -17 }, { ">F#", -16 }, { " Gd", -15 }, { "<G", -14 }, { "vG", -13 }, { " G", -12 }, { "^G", -11 }, { ">G", -10 }, { " G+", -9 }, { "<G#", -8 }, { "vG#", -7 }, { " G#", -6 }, { "^G#", -5 }, { ">G#", -4 }, { " Ad", -3 }, { "<A", -2 }, { "vA", -1 }, { " A", 0 }, { "^A", 1 }, { ">A", 2 }, { " A+", 3 }, { "<Bb", 4 }, { "vBb", 5 }, { " Bb", 6 }, { "^Bb", 7 }, { ">Bb", 8 }, { " Bd", 9 }, { "<B", 10 }, { "vB", 11 }, { " B", 12 }, { "^B", 13 }, { ">B", 14 }, { " Cd", 15 }, { "<C", 16 }, { "vC", 17 } } },
  { "80 EDO", 80, 1200.0 / 80.0, { { " C", -61 }, { "C+1", -60 }, { "C+2", -59 }, { "C+3", -58 }, { "C+4", -57 }, { "C+5", -56 }, { "C+6", -55 }, { "C+7", -54 }, { "C+8", -53 }, { "C+9", -52 }, { "C+10", -51 }, { "C+11", -50 }, { "C+12", -49 }, { "C+13", -48 }, { " D", -47 }, { "D+1", -46 }, { "D+2", -45 }, { "D+3", -44 }, { "D+4", -43 }, { "D+5", -42 }, { "D+6", -41 }, { "D+7", -40 }, { "D+8", -39 }, { "D+9", -38 }, { "D+11", -37 }, { "D+12", -36 }, { "D+13", -35 }, { "D+14", -34 }, { " E", -33 }, { "E+1", -32 }, { "E+2", -31 }, { "E+3", -30 }, { "E+4", -29 }, { " F", -28 }, { "F+1", -27 }, { "F+2", -26 }, { "F+3", -25 }, { "F+4", -24 }, { "F+5", -23 }, { "F+6", -22 }, { "F+7", -21 }, { "F+8", -20 }, { "F+9", -19 }, { "F+11", -18 }, { "F+12", -17 }, { "F+13", -16 }, { "F+14", -15 }, { " G", -14 }, { "G+1", -13 }, { "G+2", -12 }, { "G+3", -11 }, { "G+4", -10 }, { "G+5", -9 }, { "G+6", -8 }, { "G+7", -7 }, { "G+8", -6 }, { "G+9", -5 }, { "G+11", -4 }, { "G+12", -3 }, { "G+13", -2 }, { "G+14", -1 }, { " A", 0 }, { "A+1", 1 }, { "A+2", 2 }, { "A+3", 3 }, { "A+4", 4 }, { "A+5", 5 }, { "A+6", 6 }, { "A+7", 7 }, { "A+8", 8 }, { "A+9", 9 }, { "A+10", 10 }, { "A+11", 11 }, { "A+12", 12 }, { "A+13", 13 }, { " B", 14 }, { "B+1", 15 }, { "B+2", 16 }, { "B+3", 17 }, { "B+4", 18 } } },
  { "87 EDO", 87, 1200.0 / 87.0, { { " C", -66 }, { "C+1", -65 }, { "C+2", -64 }, { "C+3", -63 }, { "C+4", -62 }, { "C+5", -61 }, { "C+6", -60 }, { "C+7", -59 }, { "C+8", -58 }, { "C+9", -57 }, { "C10", -57 }, { "C+11", -56 }, { "C+12", -55 }, { "C+13", -54 }, { "C+14", -53 }, { "C+15", -52 }, { " D", -51 }, { "D+1", -50 }, { "D+2", -49 }, { "D+3", -48 }, { "D+4", -47 }, { "D+5", -46 }, { "D+6", -45 }, { "D+7", -44 }, { "D+8", -43 }, { "D+9", -42 }, { "D+10", -41 }, { "D+11", -40 }, { "D+12", -39 }, { "D+13", -38 }, { "D+14", -37 }, { " E", -36 }, { "E+1", -35 }, { "E+2", -34 }, { "E+3", -33 }, { " F", -30 }, { "F+1", -29 }, { "F+2", -28 }, { "F+3", -27 }, { "F+4", -26 }, { "F+5", -25 }, { "F+6", -24 }, { "F+7", -23 }, { "F+8", -22 }, { "F+9", -21 }, { "F+10", -20 }, { "F+11", -19 }, { "F+12", -18 }, { "F+13", -17 }, { "F+14", -16 }, { " G", -15 }, { "G+1", -14 }, { "G+2", -13 }, { "G+3", -12 }, { "G+4", -11 }, { "G+5", -10 }, { "G+6", -9 }, { "G+7", -8 }, { "G+8", -7 }, { "G+9", -6 }, { "G+10", -5 }, { "G+11", -4 }, { "G+12", -3 }, { "G+13", -2 }, { "G+14", -1 }, { " A", 0 }, { "A+1", 1 }, { "A+2", 2 }, { "A+3", 3 }, { "A+4", 4 }, { "A+5", 5 }, { "A+6", 6 }, { "A+7", 7 }, { "A+8", 8 }, { "A+9", 9 }, { "A+10", 10 }, { "A+11", 11 }, { "A+12", 12 }, { "A+13", 13 }, { "A+14", 14 }, { " B", 15 }, { "B+1", 16 }, { "B+2", 17 }, { "B+3", 18 } } },
  { "Bohlen-Pierce", 13, (1200.0 * (log(3.0 / 1.0) / log(2.0))) / 13.0, { { "C", -10 }, { "Db", -9 }, { "D", -8 }, { "E", -7 }, { "F", -6 }, { "Gb", -5 }, { "G", -4 }, { "H", -3 }, { "Jb", -2 }, { "J", -1 }, { "A", 0 }, { "Bb", 1 }, { "B", 2 } } },
  { "Carlos Alpha", 9, 77.964990, { { "I", 0 }, { "I#", 1 }, { "II-", 2 }, { "II+", 3 }, { "III", 4 }, { "III#", 5 }, { "IV-", 6 }, { "IV+", 7 }, { "Ib", 8 } } },
  { "Carlos Beta", 11, 63.832933, { { "I", 0 }, { "I#", 1 }, { "IIb", 2 }, { "II", 3 }, { "II#", 4 }, { "III", 5 }, { "III#", 6 }, { "IVb", 7 }, { "IV", 8 }, { "IV#", 9 }, { "Ib", 10 } } },
  { "Carlos Gamma", 20, 35.0985422804, { { " I", 0 }, { "^I", 1 }, { " IIb", 2 }, { "^IIb", 3 }, { " I#", 4 }, { "^I#", 5 }, { " II", 6 }, { "^II", 7 }, { " III", 8 }, { "^III", 9 }, { " IVb", 10 }, { "^IVb", 11 }, { " III#", 12 }, { "^III#", 13 }, { " IV", 14 }, { "^IV", 15 }, { " Ib", 16 }, { "^Ib", 17 }, { " IV#", 18 }, { "^IV#", 19 } } },
};

// @layout
/*
    This section defines the different
    preset note layout options.
*/
/*
    This class provides the seed values
    needed to implement a given isomorphic
    note layout. From it, the map of buttons
    to note frequencies can be calculated.

    A layout is tied to a specific tuning.
*/
class layoutDef {
public:
  std::string name;    // limit is 17 characters for GEM menu
  bool isPortrait;     // affects orientation of the GEM menu only.
  byte hexMiddleC;     // instead of "what note is button 1", "what button is the middle"
  int8_t acrossSteps;  // defined this way to be compatible with original v1.1 firmare
  int8_t dnLeftSteps;  // defined this way to be compatible with original v1.1 firmare
  byte tuning;         // index of the tuning that this layout is designed for
};
/*
    Isomorphic layouts are defined by
    establishing where the center of the
    layout is, and then the number of tuning
    steps to go up or down for the hex button
    across or down diagonally.
  */

// NOTE: Aside from adding new layouts,
// I have also rearranged them for personal use:
// - Wicki-Hayden first, if it manages to map all notes;
// - Compressed Janko second, if it maps all notes;
// - Full Janko otherwise;
// You might want to arrange them as seems fit for release,
// including all other layouts as I didn't put them in any particular order
layoutDef layoutOptions[] = {
  { "Wicki-Hayden", 1, 64, 2, -7, TUNING_12EDO },
  { "Harmonic Table", 0, 75, -7, 3, TUNING_12EDO },
  { "Gerhard", 0, 65, -1, -3, TUNING_12EDO },
  { "Janko", 0, 65, 1, -2, TUNING_12EDO },
  { "Bosanquet-Wilson", 0, 65, -1, -1, TUNING_12EDO },
  { "Compressed Janko", 0, 65, -1, -2, TUNING_12EDO },
  { "Compr. Bosanquet", 0, 65, 1, -3, TUNING_12EDO },
  { "Accordion C-sys.", 1, 75, 2, -3, TUNING_12EDO },
  { "Accordion B-sys.", 1, 64, 1, -3, TUNING_12EDO },
  { "Chromatic", 0, 75, 12, -1, TUNING_12EDO },
  { "Full Gamut", 1, 75, 1, -9, TUNING_12EDO },

  { "Wicki-Hayden", 1, 64, 2, -7, TUNING_12EDO_ZETA },
  { "Harmonic Table", 0, 75, -7, 3, TUNING_12EDO_ZETA },
  { "Janko", 0, 65, 1, -2, TUNING_12EDO_ZETA },
  { "Bosanquet-Wilson", 0, 65, -1, -1, TUNING_12EDO_ZETA },
  { "Compressed Janko", 0, 65, -1, -2, TUNING_12EDO_ZETA },
  { "Compr. Bosanquet", 0, 65, 1, -3, TUNING_12EDO_ZETA },
  { "Gerhard", 0, 65, -1, -3, TUNING_12EDO_ZETA },
  { "Accordion C-sys.", 1, 75, 2, -3, TUNING_12EDO_ZETA },
  { "Accordion B-sys.", 1, 64, 1, -3, TUNING_12EDO_ZETA },
  { "Chromatic", 0, 75, 12, -1, TUNING_12EDO_ZETA },
  { "Full Gamut", 1, 75, 1, -9, TUNING_12EDO_ZETA },

  { "Compressed Janko", 0, 65, -1, -3, TUNING_17EDO },
  { "Compr. Bosanquet", 0, 65, 1, -4, TUNING_17EDO },
  { "Janko", 0, 65, 2, -3, TUNING_17EDO },
  { "Bosanquet-Wilson", 0, 65, -2, -1, TUNING_17EDO },
  { "Neutral Thirds A", 0, 65, -1, -2, TUNING_17EDO },
  { "Neutral Thirds B", 0, 65, 1, -3, TUNING_17EDO },
  { "Full Gamut", 1, 75, 1, -9, TUNING_17EDO },

  { "Wicki-Hayden", 1, 65, 3, -11, TUNING_19EDO },
  { "Compressed Janko", 0, 65, -2, -3, TUNING_19EDO },
  { "Compr. Bosanquet", 0, 65, 2, -5, TUNING_19EDO },
  { "Janko", 0, 65, 1, -3, TUNING_19EDO },
  { "Bosanquet-Wilson", 0, 65, -1, -2, TUNING_19EDO },
  { "Harmonic Table", 0, 75, -11, 5, TUNING_19EDO },
  { "Kleismic", 0, 65, -1, -4, TUNING_19EDO },
  { "Full Gamut", 1, 75, 1, -9, TUNING_19EDO },

  { "Compressed Janko", 0, 65, -1, -4, TUNING_22EDO },
  { "Compr. Bosanquet", 0, 65, 1, -5, TUNING_22EDO },
  { "Janko", 0, 65, 3, -4, TUNING_22EDO },
  { "Bosanquet-Wilson", 0, 65, -3, -1, TUNING_22EDO },
  { "Wicki-Hayden", 1, 64, 4, -13, TUNING_22EDO },
  { "Porcupine", 0, 65, 1, -4, TUNING_22EDO },
  { "Full Gamut", 1, 75, 1, -9, TUNING_22EDO },

  { "Janko", 0, 65, 1, -4, TUNING_24EDO },              // Maybe call it "Quartertone Janko"?
  { "Bosanquet-Wilson", 0, 65, -1, -3, TUNING_24EDO },  // Maybe call it "1/4 tone Bosanquet"?
  { "Full Gamut", 1, 75, 1, -9, TUNING_24EDO },

  { "Compressed Janko", 0, 65, -3, -5, TUNING_31EDO },
  { "Compr. Bosanquet", 0, 65, 3, -8, TUNING_31EDO },
  { "Janko", 0, 65, 2, -5, TUNING_31EDO },
  { "Bosanquet-Wilson", 0, 65, -2, -3, TUNING_31EDO },
  { "Wicki-Hayden", 1, 64, 5, -18, TUNING_31EDO },
  { "5X -13Y", 1, 64, 5, -13, TUNING_31EDO },  // Unnamed layout, between Wicki-Hayd. and compressed Janko
  { "Harmonic Table", 0, 75, -18, 8, TUNING_31EDO },
  { "Double Bosanquet", 0, 65, -1, -4, TUNING_31EDO },
  { "Anti-Double Bos.", 0, 65, 1, -5, TUNING_31EDO },
  { "Full Gamut", 1, 75, 1, -9, TUNING_31EDO },

  { "Compressed Janko", 0, 65, -3, -5, TUNING_31EDO_ZETA },
  { "Compr. Bosanquet", 0, 65, 3, -8, TUNING_31EDO_ZETA },
  { "Janko", 0, 65, 2, -5, TUNING_31EDO_ZETA },
  { "Bosanquet-Wilson", 0, 65, -2, -3, TUNING_31EDO_ZETA },
  { "Wicki-Hayden", 1, 64, 5, -18, TUNING_31EDO_ZETA },
  { "5X -13Y", 1, 64, 5, -13, TUNING_31EDO_ZETA },  // Unnamed layout, between Wicki-Hayd. and compressed Janko
  { "Harmonic Table", 0, 75, -18, 8, TUNING_31EDO_ZETA },
  { "Double Bosanquet", 0, 65, -1, -4, TUNING_31EDO_ZETA },
  { "Anti-Double Bos.", 0, 65, 1, -5, TUNING_31EDO_ZETA },
  { "Full Gamut", 1, 75, 1, -9, TUNING_31EDO_ZETA },

  { "Compressed Janko", 0, 65, -3, -7, TUNING_41EDO },
  { "Compr. Bosanquet", 0, 65, 3, -10, TUNING_41EDO },
  { "Janko", 0, 65, 4, -7, TUNING_41EDO },
  { "Bosanquet-Wilson", 0, 65, -4, -3, TUNING_41EDO },  // forty-one #1
  { "Harmonic Table", 0, 75, -24, 11, TUNING_41EDO },
  { "Wicki-Hayden", 1, 64, 7, -24, TUNING_41EDO },
  { "Gerhard", 0, 65, 3, -10, TUNING_41EDO },  // forty-one #2
  { "Baldy", 0, 65, -1, -6, TUNING_41EDO },
  { "Rodan", 1, 65, -1, -7, TUNING_41EDO },
  { "Full Gamut", 1, 75, 1, -9, TUNING_41EDO },  // forty-one #3

  { "Janko", 0, 65, 3, -7, TUNING_43EDO },
  { "Bosanquet-Wilson", 0, 65, -3, -4, TUNING_43EDO },
  { "Wicki-Hayden", 1, 64, 7, -25, TUNING_43EDO },
  { "Harmonic Table", 0, 75, -25, 11, TUNING_43EDO },
  { "Full Gamut", 0, 75, 1, -9, TUNING_43EDO },

  { "Janko", 0, 65, 5, -8, TUNING_46EDO },
  { "Bosanquet-Wilson", 0, 65, -5, -3, TUNING_46EDO },
  { "Harmonic Table", 0, 75, -27, 12, TUNING_46EDO },
  { "Echidnic", 0, 65, 5, -9, TUNING_46EDO },
  { "Full Gamut", 1, 75, 1, -9, TUNING_46EDO },

  { "Janko", 0, 65, 5, -9, TUNING_53EDO },
  { "Bosanquet-Wilson", 0, 65, -5, -4, TUNING_53EDO },
  { "Harmonic Table", 0, 75, -31, 14, TUNING_53EDO },
  { "Wicki-Hayden", 1, 64, 9, -31, TUNING_53EDO },
  { "Kleismic A", 0, 65, -8, -3, TUNING_53EDO },
  { "Kleismic B", 0, 65, -5, -3, TUNING_53EDO },
  { "Buzzard", 0, 65, -9, -1, TUNING_53EDO },
  { "Compressed Janko", 1, 65, -4, -9, TUNING_53EDO },
  { "Compr. Bosanquet", 1, 65, 4, -13, TUNING_53EDO },
  { "Full Gamut", 1, 75, 1, -9, TUNING_53EDO },

  { "Janko", 0, 64, 3, -10, TUNING_58EDO },           // Maybe call it "Quartertone Janko"?
  { "Bosanquet-Wilson", 0, 64, 3, 7, TUNING_58EDO },  // Maybe call it "Quartertone Bosanquet"?
  { "Hemififths", 0, 64, 4, -7, TUNING_58EDO },
  { "Hemififths Mirror.", 0, 64, -4, -3, TUNING_58EDO },
  { "Chromatic", 0, 64, -7, -5, TUNING_58EDO },
  { "Harmonic Table", 0, 75, -34, 15, TUNING_58EDO },
  { "Septimal H.T.", 0, 75, -34, 13, TUNING_58EDO },
  { "Diaschismic", 0, 64, 4, -9, TUNING_58EDO },
  { "4X -19Y", 0, 64, 4, -19, TUNING_58EDO },    // unnamed layout, efficient for major 7ths, 9s, #11s and so on
  { "-27X 10Y", 1, 64, -27, 10, TUNING_58EDO },  // weird but efficient layout
  { "Wicki-Hayd.(29EDO)", 1, 64, 10, -34, TUNING_58EDO },
  { "Bos.Wilson (29EDO)", 0, 65, -6, -4, TUNING_58EDO },
  { "Janko      (29EDO)", 0, 65, 6, -10, TUNING_58EDO },  // 29 EDO subset, each for two rings of fifths
  { "Tridec.H.T.(29EDO)", 0, 75, -34, 14, TUNING_58EDO },
  { "Full Gamut", 1, 75, 1, -9, TUNING_58EDO },

  { "Janko", 0, 64, 3, -10, TUNING_58EDO_ZETA },           // Maybe call it "Quartertone Janko"?
  { "Bosanquet-Wilson", 0, 64, 3, 7, TUNING_58EDO_ZETA },  // Maybe call it "1/4 tone Bosanquet"?
  { "Hemififths", 0, 64, 4, -7, TUNING_58EDO_ZETA },
  { "Hemififths Mirror.", 0, 64, -4, -3, TUNING_58EDO_ZETA },
  { "Chromatic", 0, 64, -7, -5, TUNING_58EDO_ZETA },
  { "Harmonic Table", 0, 75, -34, 15, TUNING_58EDO_ZETA },
  { "Septimal H.T.", 0, 75, -34, 13, TUNING_58EDO_ZETA },
  { "Diaschismic", 0, 64, 4, -9, TUNING_58EDO_ZETA },
  { "4X -19Y", 0, 64, 4, -19, TUNING_58EDO_ZETA },    // unnamed layout, efficient for major 7ths, 9s, #11s and so on
  { "-27X 10Y", 1, 64, -27, 10, TUNING_58EDO_ZETA },  // weird but efficient layout
  { "Wicki-Hayd.(29EDO)", 1, 64, 10, -34, TUNING_58EDO_ZETA },
  { "Bos.Wilson (29EDO)", 0, 65, -6, -4, TUNING_58EDO_ZETA },
  { "Janko      (29EDO)", 0, 65, 6, -10, TUNING_58EDO_ZETA },  // 29 EDO subset, each for two rings of fifths
  { "Tridec.H.T.(29EDO)", 0, 75, -34, 14, TUNING_58EDO_ZETA },
  { "Full Gamut", 1, 75, 1, -9, TUNING_58EDO_ZETA },

  { "Harmonic Table", 0, 75, -42, 19, TUNING_72EDO },
  { "-30X 19Y", 0, 75, -30, 19, TUNING_72EDO },  // unnamed layout. Like harmonic table but with fourths instead of fifths
  { "Miracle Mapping", 0, 65, -7, -2, TUNING_72EDO },
  { "Sept.H.T.(36EDO)", 0, 75, -42, 16, TUNING_72EDO },  // 36 EDO subset
  { "Expanded Janko", 0, 65, -1, -6, TUNING_72EDO },
  { "Full Gamut", 1, 65, 1, -9, TUNING_72EDO },

  { "Harmonic Table", 0, 75, -42, 19, TUNING_72EDO_ZETA },
  { "-30X 19Y", 0, 75, -30, 19, TUNING_72EDO_ZETA },  // unnamed layout. Like harmonic table but with fourths instead of fifths
  { "Miracle Mapping", 0, 65, -7, -2, TUNING_72EDO_ZETA },
  { "Sept.H.T.(36EDO)", 0, 75, -42, 16, TUNING_72EDO_ZETA },  // 36 EDO subset
  { "Expanded Janko", 0, 65, -1, -6, TUNING_72EDO_ZETA },
  { "Full Gamut", 1, 65, 1, -9, TUNING_72EDO_ZETA },

  { "Janko", 0, 65, 9, -14, TUNING_80EDO },             // Janko mapping is still too large to map all notes (same for 87 EDO)
  { "Bosanquet-Wilson", 0, 65, -9, -5, TUNING_80EDO },  // Same for Bosanquet-Wilson. Still usable
  { "Compressed Janko", 0, 65, -5, -14, TUNING_80EDO },
  { "Full Gamut", 1, 75, 1, -9, TUNING_80EDO },  // So far this is the only one layout that maps every note

  { "Harmonic Table", 0, 75, -51, 23, TUNING_87EDO },
  { "Janko (good 3/2)", 0, 65, 5, -14, TUNING_87EDO },
  { "Bos.W.(good 3/2)", 0, 65, -5, -9, TUNING_87EDO },
  { "Wic.Hayd.nooctave", 1, 64, 14, -51, TUNING_87EDO },  // perfect thirds at the cost of losing an octave
  { "Wic.Hayd. Pyth.", 1, 64, 15, -51, TUNING_87EDO },    // pythagorean thirds, octave is preserved, note variety decreased
  { "Janko (Good 4/3)", 0, 65, 6, -14, TUNING_87EDO },    // Less efficient but allows perfect chord inversions
  { "Bos.W.(Good 4/3)", 0, 65, -6, -8, TUNING_87EDO },
  { "Bos.W.(26EDO)", 0, 65, -9, -6, TUNING_87EDO },
  { "Janko (26EDO)", 0, 65, 9, -15, TUNING_87EDO },
  { "Full Gamut", 1, 75, 1, -9, TUNING_87EDO },

  { "Standard", 0, 65, -2, -1, TUNING_BP },
  { "Full Gamut", 1, 65, 1, -9, TUNING_BP },

  { "Harmonic Table", 0, 75, -9, 5, TUNING_ALPHA },
  { "Compressed", 0, 65, -2, -1, TUNING_ALPHA },
  { "Full Gamut", 1, 65, 1, -9, TUNING_ALPHA },

  { "Wicki-Hayden", 1, 65, 3, -11, TUNING_BETA },  // Carlos Beta has the same mappings as 19 EDO
  { "Compressed Janko", 0, 65, -2, -3, TUNING_BETA },
  { "Compr. Bosanquet", 0, 65, 2, -5, TUNING_BETA },
  { "Janko", 0, 65, 1, -3, TUNING_BETA },
  { "Bosanquet-Wilson", 0, 65, -1, -2, TUNING_BETA },
  { "Harmonic Table", 0, 75, -11, 5, TUNING_BETA },
  { "Kleismic", 0, 65, -1, -4, TUNING_BETA },
  { "Full Gamut", 1, 75, 1, -9, TUNING_BETA },

  { "Harmonic Table", 0, 75, -20, 9, TUNING_GAMMA },  // Same mappings as for 34 EDO
  { "Compressed", 0, 65, -2, -1, TUNING_GAMMA },      // Difficult to map, has two rings of fifths
  { "Full Gamut", 1, 65, 1, -9, TUNING_GAMMA }
};
const byte layoutCount = sizeof(layoutOptions) / sizeof(layoutDef);
// @scales
/*
    This class defines a scale pattern
    for a given tuning. It is basically
    an array with the number of steps in
    between each degree of the scale. For
    example, the major scale in 12EDO
    is 2, 2, 1, 2, 2, 2, 1.

    A scale is tied to a specific tuning.
  */
class scaleDef {
public:
  std::string name;
  byte tuning;
  byte pattern[MAX_SCALE_DIVISIONS];
};
scaleDef scaleOptions[] = {
  { "None", ALL_TUNINGS, { 0 } },
  // 12 EDO
  { "Major", TUNING_12EDO, { 2, 2, 1, 2, 2, 2, 1 } },
  { "Minor, Natural", TUNING_12EDO, { 2, 1, 2, 2, 1, 2, 2 } },
  { "Minor, Melodic", TUNING_12EDO, { 2, 1, 2, 2, 2, 2, 1 } },
  { "Minor, Harmonic", TUNING_12EDO, { 2, 1, 2, 2, 1, 3, 1 } },
  { "Pentatonic, Major", TUNING_12EDO, { 2, 2, 3, 2, 3 } },
  { "Pentatonic, Minor", TUNING_12EDO, { 3, 2, 2, 3, 2 } },
  { "Blues", TUNING_12EDO, { 3, 1, 1, 1, 1, 3, 2 } },
  { "Double Harmonic", TUNING_12EDO, { 1, 3, 1, 2, 1, 3, 1 } },
  { "Phrygian", TUNING_12EDO, { 1, 2, 2, 2, 1, 2, 2 } },
  { "Phrygian Dominant", TUNING_12EDO, { 1, 3, 1, 2, 1, 2, 2 } },
  { "Dorian", TUNING_12EDO, { 2, 1, 2, 2, 2, 1, 2 } },
  { "Lydian", TUNING_12EDO, { 2, 2, 2, 1, 2, 2, 1 } },
  { "Lydian Dominant", TUNING_12EDO, { 2, 2, 2, 1, 2, 1, 2 } },
  { "Mixolydian", TUNING_12EDO, { 2, 2, 1, 2, 2, 1, 2 } },
  { "Locrian", TUNING_12EDO, { 1, 2, 2, 1, 2, 2, 2 } },
  { "Whole Tone", TUNING_12EDO, { 2, 2, 2, 2, 2, 2 } },
  { "Octatonic", TUNING_12EDO, { 2, 1, 2, 1, 2, 1, 2, 1 } },
  // 17 EDO; for more: https://en.xen.wiki/w/17edo#Scales
  { "Diatonic", TUNING_17EDO, { 3, 3, 1, 3, 3, 3, 1 } },
  { "Pentatonic", TUNING_17EDO, { 3, 3, 4, 3, 4 } },
  { "Harmonic", TUNING_17EDO, { 3, 2, 3, 2, 2, 2, 3 } },
  { "Husayni Maqam", TUNING_17EDO, { 2, 2, 3, 3, 2, 1, 1, 3 } },
  { "Blues", TUNING_17EDO, { 4, 3, 1, 1, 1, 4, 3 } },
  { "Hydra", TUNING_17EDO, { 3, 3, 1, 1, 2, 3, 2, 1, 1 } },
  // 19 EDO; for more: https://en.xen.wiki/w/19edo#Scales
  { "Diatonic", TUNING_19EDO, { 3, 3, 2, 3, 3, 3, 2 } },
  { "Pentatonic", TUNING_19EDO, { 3, 3, 5, 3, 5 } },
  { "Semaphore", TUNING_19EDO, { 3, 1, 3, 1, 3, 3, 1, 3, 1 } },
  { "Negri", TUNING_19EDO, { 2, 2, 2, 2, 2, 1, 2, 2, 2, 2 } },
  { "Sensi", TUNING_19EDO, { 2, 2, 1, 2, 2, 2, 1, 2, 2, 2, 1 } },
  { "Kleismic", TUNING_19EDO, { 1, 3, 1, 1, 3, 1, 1, 3, 1, 3, 1 } },
  { "Magic", TUNING_19EDO, { 3, 1, 1, 1, 3, 1, 1, 1, 3, 1, 1, 1, 1 } },
  { "Kind-of Blues", TUNING_19EDO, { 4, 4, 1, 2, 4, 4 } },
  // 22 EDO; for more: https://en.xen.wiki/w/22edo_modes
  { "Diatonic", TUNING_22EDO, { 4, 4, 1, 4, 4, 4, 1 } },
  { "Pentatonic", TUNING_22EDO, { 4, 4, 5, 4, 5 } },
  { "Orwell", TUNING_22EDO, { 3, 2, 3, 2, 3, 2, 3, 2, 2 } },
  { "Porcupine", TUNING_22EDO, { 4, 3, 3, 3, 3, 3, 3 } },
  { "Pajara", TUNING_22EDO, { 2, 2, 3, 2, 2, 2, 3, 2, 2, 2 } },
  // 24 EDO; for more: https://en.xen.wiki/w/24edo_scales
  { "Diatonic 12", TUNING_24EDO, { 4, 4, 2, 4, 4, 4, 2 } },
  { "Diatonic Soft", TUNING_24EDO, { 3, 5, 2, 3, 5, 4, 2 } },
  { "Diatonic Neutral", TUNING_24EDO, { 4, 3, 3, 4, 3, 4, 3 } },
  { "Pentatonic (12)", TUNING_24EDO, { 4, 4, 6, 4, 6 } },
  { "Pentatonic (Haba)", TUNING_24EDO, { 5, 5, 5, 5, 4 } },
  { "Invert Pentatonic", TUNING_24EDO, { 6, 3, 6, 6, 3 } },
  { "Rast Maqam", TUNING_24EDO, { 4, 3, 3, 4, 4, 2, 1, 3 } },
  { "Bayati Maqam", TUNING_24EDO, { 3, 3, 4, 4, 2, 1, 3, 4 } },
  { "Hijaz Maqam", TUNING_24EDO, { 2, 6, 2, 4, 2, 1, 3, 4 } },
  { "8-EDO", TUNING_24EDO, { 3, 3, 3, 3, 3, 3, 3, 3 } },
  { "Wyschnegradsky", TUNING_24EDO, { 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1 } },
  // 31 EDO; for more: https://en.xen.wiki/w/31edo#Scales
  { "Diatonic", TUNING_31EDO, { 5, 5, 3, 5, 5, 5, 3 } },
  { "Pentatonic", TUNING_31EDO, { 5, 5, 8, 5, 8 } },
  { "Harmonic", TUNING_31EDO, { 5, 5, 4, 4, 4, 3, 3, 3 } },
  { "Mavila", TUNING_31EDO, { 5, 3, 3, 3, 5, 3, 3, 3, 3 } },
  { "Quartal", TUNING_31EDO, { 2, 2, 7, 2, 2, 7, 2, 7 } },
  { "Orwell", TUNING_31EDO, { 4, 3, 4, 3, 4, 3, 4, 3, 3 } },
  { "Neutral", TUNING_31EDO, { 4, 4, 4, 4, 4, 4, 4, 3 } },
  { "Miracle", TUNING_31EDO, { 4, 3, 3, 3, 3, 3, 3, 3, 3, 3 } },
  // 31 EDO ZETA PEAK;
  { "Diatonic", TUNING_31EDO_ZETA, { 5, 5, 3, 5, 5, 5, 3 } },
  { "Pentatonic", TUNING_31EDO_ZETA, { 5, 5, 8, 5, 8 } },
  { "Harmonic", TUNING_31EDO_ZETA, { 5, 5, 4, 4, 4, 3, 3, 3 } },
  { "Mavila", TUNING_31EDO_ZETA, { 5, 3, 3, 3, 5, 3, 3, 3, 3 } },
  { "Quartal", TUNING_31EDO_ZETA, { 2, 2, 7, 2, 2, 7, 2, 7 } },
  { "Orwell", TUNING_31EDO_ZETA, { 4, 3, 4, 3, 4, 3, 4, 3, 3 } },
  { "Neutral", TUNING_31EDO_ZETA, { 4, 4, 4, 4, 4, 4, 4, 3 } },
  { "Miracle", TUNING_31EDO_ZETA, { 4, 3, 3, 3, 3, 3, 3, 3, 3, 3 } },
  // 41 EDO; for more: https://en.xen.wiki/w/41edo#Scales_and_modes
  { "Diatonic", TUNING_41EDO, { 7, 7, 3, 7, 7, 7, 3 } },
  { "Pentatonic", TUNING_41EDO, { 7, 7, 10, 7, 10 } },
  { "Pure Major", TUNING_41EDO, { 7, 6, 4, 7, 6, 7, 4 } },
  { "5-limit Chromatic", TUNING_41EDO, { 4, 3, 4, 2, 4, 3, 4, 4, 2, 4, 3, 4 } },
  { "7-limit Chromatic", TUNING_41EDO, { 3, 4, 2, 4, 4, 3, 4, 2, 4, 3, 3, 4 } },
  { "Harmonic", TUNING_41EDO, { 5, 4, 4, 4, 4, 3, 3, 3, 3, 3, 2, 3 } },
  { "Middle East-ish", TUNING_41EDO, { 7, 5, 7, 5, 5, 7, 5 } },
  { "Thai", TUNING_41EDO, { 6, 6, 6, 6, 6, 6, 5 } },
  { "Slendro", TUNING_41EDO, { 8, 8, 8, 8, 9 } },
  { "Pelog / Mavila", TUNING_41EDO, { 8, 5, 5, 8, 5, 5, 5 } },
  // 53 EDO
  { "Diatonic", TUNING_53EDO, { 9, 9, 4, 9, 9, 9, 4 } },
  { "Pentatonic", TUNING_53EDO, { 9, 9, 13, 9, 13 } },
  { "Rast Makam", TUNING_53EDO, { 9, 8, 5, 9, 9, 4, 4, 5 } },
  { "Usshak Makam", TUNING_53EDO, { 7, 6, 9, 9, 4, 4, 5, 9 } },
  { "Hicaz Makam", TUNING_53EDO, { 5, 12, 5, 9, 4, 9, 9 } },
  { "Orwell", TUNING_53EDO, { 7, 5, 7, 5, 7, 5, 7, 5, 5 } },
  { "Sephiroth", TUNING_53EDO, { 6, 5, 5, 6, 5, 5, 6, 5, 5, 5 } },
  { "Smitonic", TUNING_53EDO, { 11, 11, 3, 11, 3, 11, 3 } },
  { "Slendric", TUNING_53EDO, { 7, 3, 7, 3, 7, 3, 7, 3, 7, 3, 3 } },
  { "Semiquartal", TUNING_53EDO, { 9, 2, 9, 2, 9, 2, 9, 2, 9 } },
  // 72 EDO
  { "Diatonic", TUNING_72EDO, { 12, 12, 6, 12, 12, 12, 6 } },
  { "Pentatonic", TUNING_72EDO, { 12, 12, 18, 12, 18 } },
  { "Ben Johnston", TUNING_72EDO, { 6, 6, 6, 5, 5, 5, 9, 8, 4, 4, 7, 7 } },
  { "18-EDO", TUNING_72EDO, { 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4 } },
  { "Miracle", TUNING_72EDO, { 5, 2, 5, 2, 5, 2, 2, 5, 2, 5, 2, 5, 2, 5, 2, 5, 2, 5, 2, 5, 2 } },
  { "Marvolo", TUNING_72EDO, { 5, 5, 5, 5, 5, 5, 5, 2, 5, 5, 5, 5, 5, 5 } },
  { "Catakleismic", TUNING_72EDO, { 4, 7, 4, 4, 4, 7, 4, 4, 4, 7, 4, 4, 4, 7, 4 } },
  { "Palace", TUNING_72EDO, { 10, 9, 11, 12, 10, 9, 11 } },
  // BP
  { "Lambda", TUNING_BP, { 2, 1, 2, 1, 2, 1, 2, 1, 1 } },
  // Alpha
  { "Super Meta Lydian", TUNING_ALPHA, { 3, 2, 2, 2 } },
  // Beta
  { "Super Meta Lydian", TUNING_BETA, { 3, 3, 3, 2 } },
  // Gamma
  { "Super Meta Lydian", TUNING_GAMMA, { 6, 5, 5, 4 } }
};
const byte scaleCount = sizeof(scaleOptions) / sizeof(scaleDef);

// @palettes
/*
    This section defines the code needed
    to determine colors for each hex.
  */
/*
    LED colors are defined in the code
    on a perceptual basis. Instead of
    calculating RGB codes, the program
    uses an artist's color wheel approach.

    For value / brightness, two sets of
    named constants are defined. The BRIGHT_
    series (see the defaults section above)
    corresponds to the overall
    level of lights from the HexBoard, from
    dim to maximum. The VALUE_ series
    is used to differentiate light and dark
    colors in a palette. The BRIGHT and VALUE
    are multiplied together (and normalized)
    to get the output brightness.
  */
#define VALUE_BLACK 0
#define VALUE_LOW 80
#define VALUE_SHADE 164
#define VALUE_NORMAL 180
#define VALUE_FULL 255
/*
    Saturation is zero for black and white, and 255
    for fully chromatic color. Value is the
    brightness level of the LED, from 0 = off
    to 255 = max.
  */
#define SAT_BW 0
#define SAT_TINT 32
#define SAT_DULL 85
#define SAT_MODERATE 120
#define SAT_VIVID 255
/*
    Hues are angles from 0 to 360, starting
    at red and towards yellow->green->blue
    when the hue angle increases.
  */
#define HUE_NONE 0.0
#define HUE_RED 0.0
#define HUE_ORANGE 36.0
#define HUE_YELLOW 72.0
#define HUE_LIME 108.0
#define HUE_GREEN 144.0
#define HUE_CYAN 180.0
#define HUE_BLUE 216.0
#define HUE_INDIGO 252.0
#define HUE_PURPLE 288.0
#define HUE_MAGENTA 324.0
/*
    This class is a basic hue, saturation,
    and value triplet, with some limited
    transformation functions. Rather than
    load a full color space library, this
    program uses non-class procedures to
    perform conversions to and from LED-
    friendly color codes.
  */
class colorDef {
public:
  float hue;
  byte sat;
  byte val;
  colorDef tint() {
    colorDef temp;
    temp.hue = this->hue;
    temp.sat = ((this->sat > SAT_MODERATE) ? SAT_MODERATE : this->sat);
    temp.val = VALUE_FULL;
    return temp;
  }
  colorDef shade() {
    colorDef temp;
    temp.hue = this->hue;
    temp.sat = ((this->sat > SAT_MODERATE) ? SAT_MODERATE : this->sat);
    temp.val = VALUE_LOW;
    return temp;
  }
};
/*
    This class defines a palette, which is
    a map of musical scale degrees to
    colors. A palette is tied to a specific
    tuning but not to a specific layout.
  */
class paletteDef {
public:
  colorDef swatch[MAX_SCALE_DIVISIONS];  // the different colors used in this palette
  byte colorNum[MAX_SCALE_DIVISIONS];    // map key (c,d...) to swatches
  colorDef getColor(byte givenStepFromC) {
    return swatch[colorNum[givenStepFromC] - 1];
  }
  float getHue(byte givenStepFromC) {
    return getColor(givenStepFromC).hue;
  }
  byte getSat(byte givenStepFromC) {
    return getColor(givenStepFromC).sat;
  }
  byte getVal(byte givenStepFromC) {
    return getColor(givenStepFromC).val;
  }
};
/*
    Palettes are defined by creating
    a set of colors, and then making
    an array of numbers that map the
    intervals of that tuning to the
    chosen colors. It's like paint
    by numbers! Note that the indexes
    start with 1, because the arrays are
    padded with 0 for entries after
    those intialized.
  */
paletteDef palette[] = {
  // 12 EDO
  { { { HUE_NONE, SAT_BW, 64 }, { 200, 60, VALUE_SHADE }, { HUE_BLUE, SAT_VIVID, VALUE_SHADE }, { 230, 240, VALUE_NORMAL }, { HUE_PURPLE, SAT_VIVID, VALUE_NORMAL }, { 270, SAT_VIVID, VALUE_NORMAL } }, { 6, 1, 2, 1, 2, 2, 1, 4, 1, 2, 1, 2 } },
  // 17 EDO
  { { { HUE_NONE, SAT_BW, VALUE_NORMAL }, { HUE_INDIGO, SAT_VIVID, VALUE_NORMAL }, { HUE_RED, SAT_VIVID, VALUE_NORMAL } }, { 1, 2, 3, 1, 2, 3, 1, 1, 2, 3, 1, 2, 3, 1, 2, 3, 1 } },
  // 19 EDO
  { {
      { HUE_NONE, SAT_BW, VALUE_NORMAL }  // n
      ,
      { HUE_YELLOW, SAT_VIVID, VALUE_NORMAL }  //  #
      ,
      { HUE_BLUE, SAT_VIVID, VALUE_NORMAL }  //  b
      ,
      { HUE_MAGENTA, SAT_VIVID, VALUE_NORMAL }  // enh
    },
    { 1, 2, 3, 1, 2, 3, 1, 4, 1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 4 } },
  // 22 EDO
  { {
      { HUE_NONE, SAT_BW, VALUE_NORMAL }  // n
      ,
      { HUE_BLUE, SAT_VIVID, VALUE_NORMAL }  // ^
      ,
      { HUE_MAGENTA, SAT_VIVID, VALUE_NORMAL }  // mid
      ,
      { HUE_YELLOW, SAT_VIVID, VALUE_NORMAL }  // v
    },
    { 1, 2, 3, 4, 1, 2, 3, 4, 1, 1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4, 1 } },
  // 24 EDO
  { {
      { HUE_NONE, SAT_BW, VALUE_NORMAL }  // n
      ,
      { HUE_LIME, SAT_DULL, VALUE_SHADE }  //  +
      ,
      { HUE_CYAN, SAT_VIVID, VALUE_NORMAL }  //  #/b
      ,
      { HUE_INDIGO, SAT_DULL, VALUE_SHADE }  //  d
      ,
      { HUE_CYAN, SAT_DULL, VALUE_SHADE }  // enh
    },
    { 1, 2, 3, 4, 1, 2, 3, 4, 1, 5, 1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4, 1, 5 } },
  // 31 EDO
  { {
      { HUE_NONE, SAT_BW, VALUE_NORMAL }  // n
      ,
      { HUE_RED, SAT_DULL, VALUE_NORMAL }  //  +
      ,
      { HUE_YELLOW, SAT_DULL, VALUE_SHADE }  //  #
      ,
      { HUE_CYAN, SAT_DULL, VALUE_SHADE }  //  b
      ,
      { HUE_INDIGO, SAT_DULL, VALUE_NORMAL }  //  d
      ,
      { HUE_RED, SAT_DULL, VALUE_SHADE }  //  enh E+ Fb
      ,
      { HUE_INDIGO, SAT_DULL, VALUE_SHADE }  //  enh E# Fd
    },
    { 1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 1, 6, 7, 1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 1, 6, 7 } },
  // 41 EDO
  { {
      { HUE_NONE, SAT_BW, VALUE_NORMAL }  // n
      ,
      { HUE_RED, SAT_DULL, VALUE_NORMAL }  //  ^
      ,
      { HUE_BLUE, SAT_VIVID, VALUE_NORMAL }  //  +
      ,
      { HUE_CYAN, SAT_DULL, VALUE_SHADE }  //  b
      ,
      { HUE_GREEN, SAT_DULL, VALUE_SHADE }  //  #
      ,
      { HUE_MAGENTA, SAT_DULL, VALUE_NORMAL }  //  d
      ,
      { HUE_YELLOW, SAT_VIVID, VALUE_NORMAL }  //  v
    },
    { 1, 2, 3, 4, 5, 6, 7, 1, 2, 3, 4, 5, 6, 7, 1, 2, 3, 1, 2, 3, 4, 5, 6, 7,
      1, 2, 3, 4, 5, 6, 7, 1, 2, 3, 4, 5, 6, 7, 1, 6, 7 } },
  // 43 EDO
  { {
      { HUE_NONE, SAT_BW, VALUE_NORMAL }  // n
      ,
      { HUE_RED, SAT_DULL, VALUE_NORMAL }  //  ^
      ,
      { HUE_BLUE, SAT_VIVID, VALUE_NORMAL }  //  +
      ,
      { HUE_CYAN, SAT_DULL, VALUE_SHADE }  //  b
      ,
      { HUE_GREEN, SAT_DULL, VALUE_SHADE }  //  #
      ,
      { HUE_MAGENTA, SAT_DULL, VALUE_NORMAL }  //  d
      ,
      { HUE_YELLOW, SAT_VIVID, VALUE_NORMAL }  //  v
    },
    { 1, 2, 3, 4, 5, 6, 7, 1, 2, 3, 4, 5, 6, 7, 1, 2, 3, 1, 2, 3, 4, 5, 6, 7,
      1, 2, 3, 4, 5, 6, 7, 1, 2, 3, 4, 5, 6, 7, 1, 6, 7 } },
  // 53 EDO
  { {
      { HUE_NONE, SAT_BW, VALUE_NORMAL }  // n
      ,
      { HUE_ORANGE, SAT_VIVID, VALUE_NORMAL }  //  ^
      ,
      { HUE_MAGENTA, SAT_DULL, VALUE_NORMAL }  //  L
      ,
      { HUE_INDIGO, SAT_VIVID, VALUE_NORMAL }  // bv
      ,
      { HUE_GREEN, SAT_VIVID, VALUE_SHADE }  // b
      ,
      { HUE_YELLOW, SAT_VIVID, VALUE_SHADE }  // #
      ,
      { HUE_RED, SAT_VIVID, VALUE_NORMAL }  // #^
      ,
      { HUE_PURPLE, SAT_DULL, VALUE_NORMAL }  //  7
      ,
      { HUE_CYAN, SAT_VIVID, VALUE_SHADE }  //  v
    },
    { 1, 2, 3, 4, 5, 6, 7, 8, 9, 1, 2, 3, 4, 5, 6, 7, 8, 9, 1, 2, 3, 9, 1, 2, 3, 4, 5, 6, 7, 8, 9,
      1, 2, 3, 4, 5, 6, 7, 8, 9, 1, 2, 3, 4, 5, 6, 7, 8, 9, 1, 2, 3, 9 } },
  // 72 EDO
  { {
      { HUE_NONE, SAT_BW, VALUE_NORMAL }  // n
      ,
      { HUE_GREEN, SAT_DULL, VALUE_SHADE }  // ^
      ,
      { HUE_RED, SAT_DULL, VALUE_SHADE }  // L
      ,
      { HUE_PURPLE, SAT_DULL, VALUE_SHADE }  // +/d
      ,
      { HUE_BLUE, SAT_DULL, VALUE_SHADE }  // 7
      ,
      { HUE_YELLOW, SAT_DULL, VALUE_SHADE }  // v
      ,
      { HUE_INDIGO, SAT_VIVID, VALUE_SHADE }  // #/b
    },
    { 1, 2, 3, 4, 5, 6, 7, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6, 7, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6,
      7, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6, 7, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6, 7, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6 } },
  // BOHLEN PIERCE
  { { { HUE_NONE, SAT_BW, VALUE_NORMAL }, { HUE_INDIGO, SAT_VIVID, VALUE_NORMAL }, { HUE_RED, SAT_VIVID, VALUE_NORMAL } }, { 1, 2, 3, 1, 2, 3, 1, 1, 2, 3, 1, 2, 3 } },
  // ALPHA
  { {
      { HUE_NONE, SAT_BW, VALUE_NORMAL }  // n
      ,
      { HUE_YELLOW, SAT_VIVID, VALUE_NORMAL }  // #
      ,
      { HUE_INDIGO, SAT_VIVID, VALUE_NORMAL }  // d
      ,
      { HUE_LIME, SAT_VIVID, VALUE_NORMAL }  // +
      ,
      { HUE_RED, SAT_VIVID, VALUE_NORMAL }  // enharmonic
      ,
      { HUE_CYAN, SAT_VIVID, VALUE_NORMAL }  // b
    },
    { 1, 2, 3, 4, 1, 2, 3, 5, 6 } },
  // BETA
  { {
      { HUE_NONE, SAT_BW, VALUE_NORMAL }  // n
      ,
      { HUE_INDIGO, SAT_VIVID, VALUE_NORMAL }  // #
      ,
      { HUE_RED, SAT_VIVID, VALUE_NORMAL }  // b
      ,
      { HUE_MAGENTA, SAT_DULL, VALUE_NORMAL }  // enharmonic
    },
    { 1, 2, 3, 1, 4, 1, 2, 3, 1, 2, 3 } },
  // GAMMA
  { {
      { HUE_NONE, SAT_BW, VALUE_NORMAL }  // n
      ,
      { HUE_RED, SAT_VIVID, VALUE_NORMAL }  // b
      ,
      { HUE_BLUE, SAT_VIVID, VALUE_NORMAL }  // #
      ,
      { HUE_YELLOW, SAT_VIVID, VALUE_NORMAL }  // n^
      ,
      { HUE_PURPLE, SAT_VIVID, VALUE_NORMAL }  // b^
      ,
      { HUE_GREEN, SAT_VIVID, VALUE_NORMAL }  // #^
    },
    { 1, 4, 2, 5, 3, 6, 1, 4, 1, 4, 2, 5, 3, 6, 1, 4, 2, 5, 3, 6 } },
};

// @presets
/*
    This section of the code defines
    a "preset" as a collection of
    parameters that control how the
    hexboard is operating and playing.

    In the long run this will serve as
    a foundation for saving and loading
    preferences / settings through the
    file system.
  */

class presetDef {
public:
  std::string presetName;
  int tuningIndex;  // instead of using pointers, i chose to store index value of each option, to be saved to a .pref or .ini or something
  int layoutIndex;
  int scaleIndex;
  int keyStepsFromA;  // what key the scale is in, where zero equals A.
  int transpose;
  // define simple recall functions
  tuningDef tuning() {
    return tuningOptions[tuningIndex];
  }
  layoutDef layout() {
    return layoutOptions[layoutIndex];
  }
  scaleDef scale() {
    return scaleOptions[scaleIndex];
  }
  int layoutsBegin() {
    if (tuningIndex == TUNING_12EDO) {
      return 0;
    } else {
      int temp = 0;
      while (layoutOptions[temp].tuning < tuningIndex) {
        temp++;
      }
      return temp;
    }
  }
  int keyStepsFromC() {
    return tuning().spanCtoA() - keyStepsFromA;
  }
  int pitchRelToA4(int givenStepsFromC) {
    return givenStepsFromC + tuning().spanCtoA() + transpose;
  }
  int keyDegree(int givenStepsFromC) {
    return positiveMod(givenStepsFromC + keyStepsFromC(), tuning().cycleLength);
  }
};

presetDef current = {
  "Default",     // name
  TUNING_12EDO,  // tuning
  0,             // default to the first layout, wicki hayden
  0,             // default to using no scale (chromatic)
  -9,            // default to the key of C, which in 12EDO is -9 steps from A.
  0              // default to no transposition
};

// @diagnostics
/*
    This section of the code handles
    optional sending of log messages
    to the Serial port
  */
bool debugMessages = true;
void sendToLog(std::string msg) {
  if (debugMessages) {
    Serial.println(msg.c_str());
  }
}

// @timing
/*
    This section of the code handles basic
    timekeeping stuff
  */
#include "hardware/timer.h"  // library of code to access the processor's clock functions
uint64_t runTime = 0;        // Program loop consistent variable for time in microseconds since power on
uint64_t lapTime = 0;        // Used to keep track of how long each loop takes. Useful for rate-limiting.
uint64_t loopTime = 0;       // Used to check speed of the loop
uint64_t readClock() {
  uint64_t temp = timer_hw->timerawh;
  return (temp << 32) | timer_hw->timerawl;
}
void timeTracker() {
  lapTime = runTime - loopTime;
  loopTime = runTime;     // Update previousTime variable to give us a reference point for next loop
  runTime = readClock();  // Store the current time in a uniform variable for this program loop
}

// @gridSystem
/*
    This section of the code handles the hex grid
       Hexagonal coordinates
         https://www.redblobgames.com/grids/hexagons/
         http://ondras.github.io/rot.js/manual/#hex/indexing
    The HexBoard contains a grid of 140 buttons with
    hexagonal keycaps. The processor has 10 pins connected
    to a multiplexing unit, which hotswaps between the 14 rows
    of ten buttons to allow all 140 inputs to be read in one
    program read cycle.
  */
#define MPLEX_1_PIN 4
#define MPLEX_2_PIN 5
#define MPLEX_4_PIN 2
#define MPLEX_8_PIN 3
#define COLUMN_PIN_0 6
#define COLUMN_PIN_1 7
#define COLUMN_PIN_2 8
#define COLUMN_PIN_3 9
#define COLUMN_PIN_4 10
#define COLUMN_PIN_5 11
#define COLUMN_PIN_6 12
#define COLUMN_PIN_7 13
#define COLUMN_PIN_8 14
#define COLUMN_PIN_9 15
/*
    There are 140 LED pixels on the Hexboard.
    LED instructions all go through the LED_PIN.
    It so happens that each LED pixel corresponds
    to one and only one hex button, so both a LED
    and its button can have the same index from 0-139.
    Since these parameters are pre-defined by the
    hardware build, the dimensions of the grid
    are therefore constants.
  */
#define LED_COUNT 140
#define COLCOUNT 10
#define ROWCOUNT 16
#define BTN_COUNT COLCOUNT* ROWCOUNT
/*
    Of the 140 buttons, 7 are offset to the bottom left
    quadrant of the Hexboard and are reserved as command
    buttons. Their LED reference is pre-defined here.
    If you want those seven buttons remapped to play
    notes, you may wish to change or remove these
    variables and alter the value of CMDCOUNT to agree
    with how many buttons you reserve for non-note use.
  */
#define CMDBTN_0 0
#define CMDBTN_1 20
#define CMDBTN_2 40
#define CMDBTN_3 60
#define CMDBTN_4 80
#define CMDBTN_5 100
#define CMDBTN_6 120
#define CMDCOUNT 7
/*
    This class defines the hexagon button
    as an object. It stores all real-time
    properties of the button -- its coordinates,
    its current pressed state, the color
    codes to display based on what action is
    taken, what note and frequency is assigned,
    whether the button is a command or not,
    whether the note is in the selected scale,
    whether the button is flagged to be animated,
    and whether the note is currently
    sounding on MIDI / the synth.

    Needless to say, this is an important class.
  */
class buttonDef {
public:
#define BTN_STATE_OFF 0
#define BTN_STATE_NEWPRESS 1
#define BTN_STATE_RELEASED 2
#define BTN_STATE_HELD 3
  byte btnState = 0;  // binary 00 = off, 01 = just pressed, 10 = just released, 11 = held
  void interpBtnPress(bool isPress) {
    btnState = (((btnState << 1) + isPress) & 3);
  }
  int8_t coordRow = 0;       // hex coordinates
  int8_t coordCol = 0;       // hex coordinates
  uint64_t timePressed = 0;  // timecode of last press
  uint32_t LEDcodeAnim = 0;  // calculate it once and store value, to make LED playback snappier
  uint32_t LEDcodePlay = 0;  // calculate it once and store value, to make LED playback snappier
  uint32_t LEDcodeRest = 0;  // calculate it once and store value, to make LED playback snappier
  uint32_t LEDcodeOff = 0;   // calculate it once and store value, to make LED playback snappier
  uint32_t LEDcodeDim = 0;   // calculate it once and store value, to make LED playback snappier
  bool animate = 0;          // hex is flagged as part of the animation in this frame, helps make animations smoother
  int16_t stepsFromC = 0;    // number of steps from C4 (semitones in 12EDO; microtones if >12EDO)
  bool isCmd = 0;            // 0 if it's a MIDI note; 1 if it's a MIDI control cmd
  bool inScale = 0;          // 0 if it's not in the selected scale; 1 if it is
  byte note = UNUSED_NOTE;   // MIDI note or control parameter corresponding to this hex
  int16_t bend = 0;          // in microtonal mode, the pitch bend for this note needed to be tuned correctly
  byte MIDIch = 0;           // what MIDI channel this note is playing on
  byte synthCh = 0;          // what synth polyphony ch this is playing on
  float frequency = 0.0;     // what frequency to ring on the synther
  int16_t jiRetune = 0;
  float jiFrequencyMultiplier = 1.0f;
  uint8_t externalNoteDepth = 0;  // number of active external MIDI notes mapped here
  int32_t midiNoteIndex = 0;      // extended MIDI note number before channel folding
  byte mappedMidiChannel = 0;     // preferred channel when not using MPE
};
/*
    This class is like a virtual wheel.
    It takes references / pointers to
    the state of three command buttons,
    translates presses of those buttons
    into wheel turns, and converts
    these movements into corresponding
    values within a range.

    This lets us generalize the
    behavior of a virtual pitch bend
    wheel or mod wheel using the same
    code, only needing to modify the
    range of output and the connected
    buttons to operate it.
  */
class wheelDef {
public:
  byte* alternateMode;  // two ways to control
  byte* isSticky;       // TRUE if you leave value unchanged when no buttons pressed
  byte* topBtn;         // pointer to the key Status of the button you use as this button
  byte* midBtn;
  byte* botBtn;
  int16_t minValue;
  int16_t maxValue;
  int* stepValue;    // this can be changed via GEM menu
  int16_t defValue;  // snapback value
  int16_t curValue;
  int16_t targetValue;
  uint64_t timeLastChanged;
  void setTargetValue() {
    if (*alternateMode) {
      if (*midBtn >> 1) {  // middle button toggles target (0) vs. step (1) mode
        int16_t temp = curValue;
        if (*topBtn == 1) { temp += *stepValue; }  // tap button
        if (*botBtn == 1) { temp -= *stepValue; }  // tap button
        if (temp > maxValue) {
          temp = maxValue;
        } else if (temp <= minValue) {
          temp = minValue;
        }
        targetValue = temp;
      } else {
        switch (((*topBtn >> 1) << 1) + (*botBtn >> 1)) {
          case 0b10: targetValue = maxValue; break;
          case 0b11: targetValue = defValue; break;
          case 0b01: targetValue = minValue; break;
          default: targetValue = curValue; break;
        }
      }
    } else {
      switch (((*topBtn >> 1) << 2) + ((*midBtn >> 1) << 1) + (*botBtn >> 1)) {
        case 0b100: targetValue = maxValue; break;
        case 0b110: targetValue = (3 * maxValue + minValue) / 4; break;
        case 0b010:
        case 0b111:
        case 0b101: targetValue = (maxValue + minValue) / 2; break;
        case 0b011: targetValue = (maxValue + 3 * minValue) / 4; break;
        case 0b001: targetValue = minValue; break;
        case 0b000: targetValue = (*isSticky ? curValue : defValue); break;
        default: break;
      }
    }
  }
  bool updateValue(uint64_t givenTime) {
    int16_t temp = targetValue - curValue;
    if (temp != 0) {
      if ((givenTime - timeLastChanged) >= CC_MSG_COOLDOWN_MICROSECONDS) {
        timeLastChanged = givenTime;
        if (abs(temp) < *stepValue) {
          curValue = targetValue;
        } else {
          curValue = curValue + (*stepValue * (temp / abs(temp)));
        }
        return 1;
      } else {
        return 0;
      }
    } else {
      return 0;
    }
  }
};
const byte mPin[] = {
  MPLEX_1_PIN, MPLEX_2_PIN, MPLEX_4_PIN, MPLEX_8_PIN
};
const byte cPin[] = {
  COLUMN_PIN_0, COLUMN_PIN_1, COLUMN_PIN_2, COLUMN_PIN_3,
  COLUMN_PIN_4, COLUMN_PIN_5, COLUMN_PIN_6,
  COLUMN_PIN_7, COLUMN_PIN_8, COLUMN_PIN_9
};
const byte assignCmd[] = {
  CMDBTN_0, CMDBTN_1, CMDBTN_2, CMDBTN_3,
  CMDBTN_4, CMDBTN_5, CMDBTN_6
};

uint32_t multiplexerMask = 0;
uint32_t rowSelectMask[ROWCOUNT] = { 0 };
uint32_t columnMasks[COLCOUNT] = { 0 };

/*
    define h, which is a collection of all the
    buttons from 0 to 139. h[i] refers to the
    button with the LED address = i.
  */
buttonDef h[BTN_COUNT];

wheelDef modWheel = { &wheelMode, &modSticky,
                      &h[assignCmd[4]].btnState, &h[assignCmd[5]].btnState, &h[assignCmd[6]].btnState,
                      0, 127, &modWheelSpeed, 0, 0, 0, 0 };
wheelDef pbWheel = { &wheelMode, &pbSticky,
                     &h[assignCmd[4]].btnState, &h[assignCmd[5]].btnState, &h[assignCmd[6]].btnState,
                     -8192, 8191, &pbWheelSpeed, 0, 0, 0, 0 };
wheelDef velWheel = { &wheelMode, &velSticky,
                      &h[assignCmd[0]].btnState, &h[assignCmd[1]].btnState, &h[assignCmd[2]].btnState,
                      0, 127, &velWheelSpeed, 96, 96, 96, 0 };

bool toggleWheel = 0;  // 0 for mod, 1 for pb

void setupPins() {
  multiplexerMask = 0;
  for (byte p = 0; p < sizeof(mPin); p++) {
    byte pin = mPin[p];
    pinMode(pin, OUTPUT);
    multiplexerMask |= (1u << pin);
  }
  for (byte r = 0; r < ROWCOUNT; ++r) {
    uint32_t mask = 0;
    for (byte bit = 0; bit < sizeof(mPin); ++bit) {
      if ((r >> bit) & 1) {
        mask |= (1u << mPin[bit]);
      }
    }
    rowSelectMask[r] = mask;
  }
  for (byte p = 0; p < sizeof(cPin); p++) {
    byte pin = cPin[p];
    pinMode(pin, INPUT_PULLUP);
    columnMasks[p] = (1u << pin);
  }
  sendToLog("Pins mounted");
}

void setupGrid() {
  for (byte i = 0; i < BTN_COUNT; i++) {
    h[i].coordRow = (i / 10);
    h[i].coordCol = (2 * (i % 10)) + (h[i].coordRow & 1);
    h[i].isCmd = 0;
    h[i].note = UNUSED_NOTE;
    h[i].btnState = 0;
    h[i].midiNoteIndex = 0;
    h[i].mappedMidiChannel = 0;
  }
  for (byte c = 0; c < CMDCOUNT; c++) {
    h[assignCmd[c]].isCmd = 1;
    h[assignCmd[c]].note = CMDB + c;
  }
  // "flag" buttons
  for (byte i = 140; i < BTN_COUNT; i++) {
    h[i].isCmd = 1;
  }
  // On version 1.2, "button" 140 is shorted (always connected)
  h[140].note = HARDWARE_V1_2;
}

void detectHardwareVersion() {
  constexpr byte hardwareFlagIndex = 140;
  const byte targetRow = hardwareFlagIndex / 10;
  const byte targetColumn = hardwareFlagIndex % 10;
  byte columnPin = cPin[targetColumn];
  sio_hw->gpio_clr = multiplexerMask;
  sio_hw->gpio_set = rowSelectMask[targetRow];
  delayMicroseconds(14);
  bool flagPressed = (digitalRead(columnPin) == LOW);
  Hardware_Version = flagPressed ? HARDWARE_V1_2 : HARDWARE_V1_1;
  sendToLog("Hardware detection: revision " + std::to_string(Hardware_Version));
}

// @LED
/*
    This section of the code handles sending
    color data to the LED pixels underneath
    the hex buttons.
  */
#include <Adafruit_NeoPixel.h>  // library of code to interact with the LED array
#define LED_PIN 22
Adafruit_NeoPixel strip(LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800);
int32_t rainbowDegreeTime = 65'536;  // microseconds to go through 1/360 of rainbow
/*
    This is actually a hacked together approximation
    of the color space OKLAB. A true conversion would
    take the hue, saturation, and value bits and
    turn them into linear RGB to feed directly into
    the LED class. This conversion is... not very OK...
    but does the job for now. A proper implementation
    of OKLAB is in the works.

    For transforming hues, the okLAB hue degree (0-360) is
    mapped to the RGB hue degree from 0 to 65535, using
    simple linear interpolation I created by hand comparing
    my HexBoard outputs to a Munsell color chip book.
  */
int16_t transformHue(float h) {
  float D = fmod(h, 360);
  if (!perceptual) {
    return 65536 * D / 360;
  } else {
    //                red            yellow             green        cyan         blue
    int hueIn[] = { 0, 9, 18, 102, 117, 135, 142, 155, 203, 240, 252, 261, 306, 333, 360 };
    //              #ff0000          #ffff00           #00ff00      #00ffff     #0000ff     #ff00ff
    int hueOut[] = { 0, 3640, 5861, 10922, 12743, 16384, 21845, 27306, 32768, 38229, 43690, 49152, 54613, 58254, 65535 };
    byte B = 0;
    while (D - hueIn[B] > 0) {
      B++;
    }
    float T = (D - hueIn[B - 1]) / (float)(hueIn[B] - hueIn[B - 1]);
    return (hueOut[B - 1] * (1 - T)) + (hueOut[B] * T);
  }
}

namespace incandescence {
/*
  const int fixed_shift = 16;
  const int fixed_scale = (1 << fixed_shift);

  constexpr int32_t lambda_r = 700*256;
  constexpr int32_t lambda_g = 550*256;
  constexpr int32_t lambda_b = 450*256;

  constexpr uint32_t C1 = 374183; // W*m^2
  constexpr uint32_t C2 = 14388;   // m*K

  int32_t fixed_exp(int32_t x)
  {
    return (fixed_scale + x + ((x*x) >> 1) + ((x*x*x)/6));
  }
  int32_t planckRadiation(int32_t lambda, int32_t temp)
  {
    int32_t denom = (C2 / (lambda*temp >> fixed_shift));
    return (C1 / (pow(lambda,5))) / (fixed_exp(denom));
  }
  */

constexpr float lambda_r = 625e-9;  // average wavelengths of LED diodes
constexpr float lambda_g = 525e-9;
constexpr float lambda_b = 460e-9;

constexpr float C1 = 3.74183e-16;  // W*m^2
constexpr float C2 = 1.4388e-2;    // m*K

float maxTemperature = 2400;
float brightnessCoefficient = 745000000.0f;

float planckRadiation(float lambda, float temp) {
  return (C1 / (pow(lambda, 5))) / (exp(C2 / (lambda * temp)) - 1);
}

float getCoefficient(float lambda, float maxTemperature) {
  float radiation = planckRadiation(lambda, maxTemperature);
  return radiation / 256.0f;
}

float getTemperatureFromV(float value) {
  return value;
}

colorDef getColor(int32_t temp) {
  float r = planckRadiation(lambda_r, temp);
  float g = planckRadiation(lambda_g, temp);
  float b = planckRadiation(lambda_b, temp);

  float maxVal = max(max(r, g), b);

  float minVal = min(min(r, g), b);
  float delta = maxVal - minVal;
  float h = 0, s = 0, v = 0;

  if (delta > 0.00001) {
    s = delta / maxVal;
    if (maxVal == r) {
      h = 60.0 * fmodf(((g - b) / delta), 6.0);
      v = r / getCoefficient(lambda_r, maxTemperature);
    } else if (maxVal == g) {
      h = 60.0 * (((g - b) / delta) + 2.0);
      v = g / getCoefficient(lambda_g, maxTemperature);
    } else {
      h = 60.0 * (((g - b) / delta) + 4.0);
      v = b / getCoefficient(lambda_b, maxTemperature);
    }
    v = min(max(v, 0), 255);
  }

  if (h < 0.0) h += 360.0;
  return colorDef{ h, (byte)(s * 255), (byte)(v) };
}
}

/*
    Saturation and Brightness are taken as is (already in a 0-255 range).
    The global brightness / 255 attenuates the resulting color for the
    user's brightness selection. Then the resulting RGB (HSV) color is
    "un-gamma'd" to be converted to the LED strip color.
  */
uint32_t getLEDcode(colorDef c) {
  return strip.gamma32(strip.ColorHSV(transformHue(c.hue), c.sat, c.val * globalBrightness / 255));
}
/*
    This function cycles through each button, and based on what color
    palette is active, it calculates the LED color code in the palette,
    plus its variations for being animated, played, or out-of-scale, and
    stores it for recall during playback and animation. The color
    codes remain in the object until this routine is called again.
  */
void setLEDcolorCodes() {
  for (byte i = 0; i < LED_COUNT; i++) {
    if (!(h[i].isCmd)) {
      colorDef setColor;
      byte paletteIndex = positiveMod(h[i].stepsFromC, current.tuning().cycleLength);
      if (paletteBeginsAtKeyCenter) {
        paletteIndex = current.keyDegree(paletteIndex);
      }
      switch (colorMode) {
        case TIERED_COLOR_MODE:  // This mode sets the color based on the palettes defined above.
          setColor = palette[current.tuningIndex].getColor(paletteIndex);
          break;
        case RAINBOW_MODE:  // This mode assigns the root note as red, and the rest as saturated spectrum colors across the rainbow.
          setColor = { 360 * ((float)paletteIndex / (float)current.tuning().cycleLength), SAT_VIVID, VALUE_NORMAL };
          break;
        case RAINBOW_OF_FIFTHS_MODE:  // This mode assigns the root note as red, and the rest as saturated spectrum colors across the rainbow.
          {
            float stepSize = current.tuning().stepSize;
            float octaveCycleLength = 1200.0 / current.tuning().stepSize;  // This is to prevent non-octave colouring weirdness
            float semipaletteIndex = fmodf(h[i].stepsFromC + (octaveCycleLength * 256.0), octaveCycleLength);
            float keyDegree = fmodf(semipaletteIndex + (current.tuning().spanCtoA() - current.keyStepsFromA), octaveCycleLength);
            float fifthSize = ((ratioToCents(3.0 / 2.0)) / stepSize);
            float reverseFifth = fifthSize;
            switch (current.tuningIndex) {
              case TUNING_17EDO:
                {
                  reverseFifth = 12;
                }
                break;  // reverse hash of (10*x)%17=x where 10 steps is a 17EDO fifth
              case TUNING_19EDO:
                {
                  reverseFifth = 7;
                }
                break;  // reverse hash of (11*x)%19=x where 11 steps is a 19EDO fifth
              case TUNING_22EDO:
                {
                  reverseFifth = 17;
                }
                break;  // reverse hash of (13*x)%22=x where 13 steps is a 22EDO fifth
              case TUNING_24EDO:
                {
                  reverseFifth = 11;
                }
                break;  // hand-picked best-fit value. This tuning is very unruly
              case TUNING_31EDO:
                {
                  reverseFifth = 19;
                }
                break;  // reverse hash of (18*x)%31=x where 18 steps is a 31EDO fifth
              case TUNING_31EDO_ZETA:
                {
                  reverseFifth = 19;
                }
                break;
              case TUNING_41EDO:
                {
                  reverseFifth = 12;
                }
                break;  // reverse hash of (24*x)%41=x where 24 steps is a 41EDO fifth
              case TUNING_43EDO:
                {
                  reverseFifth = 31;
                }
                break;  // reverse hash of (25*x)%43=x where 25 steps is a 43EDO fifth
              case TUNING_46EDO:
                {
                  reverseFifth = 29;
                }
                break;  // reverse hash of (27*x)%46=x where 27 steps is a 46EDO fifth
              case TUNING_53EDO:
                {
                  reverseFifth = 12;
                }
                break;  // reverse hash of (31*x)%53=x where 31 steps is a 53EDO fifth
              case TUNING_58EDO:
                {
                  reverseFifth = 12;
                }
                break;  // reverse hash for 29EDO (2 chains of 29 EDO fifths in 58 EDO)
              case TUNING_58EDO_ZETA:
                {
                  reverseFifth = 12;
                }
                break;
              case TUNING_72EDO:
                {
                  reverseFifth = 7;
                }
                break;  // reverse hash for 12EDO (6 chains of 12 EDO fifths in 72 EDO)
              case TUNING_72EDO_ZETA:
                {
                  reverseFifth = 7;
                }
                break;
              case TUNING_80EDO:
                {
                  reverseFifth = 63;
                }
                break;  // reverse hash of (47*x)%80=x where 47 steps is an 80EDO fifth
              case TUNING_87EDO:
                {
                  reverseFifth = 41;
                }
                break;  // A hand-picked value, seems to work. 46 also works
              case TUNING_BP:
                {
                  reverseFifth = 5;
                }
                break;  // A hand-picked value; 23 and 64 also work
              case TUNING_ALPHA:
                {
                  reverseFifth = 5;
                }
                break;  // A hand-picked value
              case TUNING_BETA:
                {
                  reverseFifth = 7;
                }
                break;  // reverse hash of (11*x)%19=x where 11 steps is a 19EDO equivalent fifth
              case TUNING_GAMMA:
                {
                  reverseFifth = 12;
                }
                break;  // reverse hash for 17EDO(2 chains of 17 EDO fifths in 34 EDO equivalent)
              default:
                {
                  reverseFifth = fifthSize;
                }  // either the tuning has no fifths or scrambling colors using fifths works
            }

            float paletteIndexOfFifths = fmodf((keyDegree * reverseFifth), octaveCycleLength);
            setColor = { 360.0f * (paletteIndexOfFifths / (1200.0f / stepSize)), SAT_VIVID, VALUE_NORMAL };
          }
          break;
        case PIANO_ALT_COLOR_MODE:
          {
            float octaveCycleLength = 1200.0 / current.tuning().stepSize;  // This is to prevent non-octave colouring weirdness
            float semipaletteIndex = fmodf(h[i].stepsFromC + (octaveCycleLength * 256.0), octaveCycleLength);
            float keyDegree = (12.0f / octaveCycleLength) * semipaletteIndex;
            if ((int)round(keyDegree) % 12 == 1 || (int)round(keyDegree) % 12 == 3 || (int)round(keyDegree) % 12 == 6 || (int)round(keyDegree) % 12 == 8 || (int)round(keyDegree) % 12 == 10) {
              float deviationFromDiatonic = (float)((int)round(keyDegree) - keyDegree) * 180.0;  // range from 180 to 360
              // +360 for proper fmodf; 180 is the opposite tint of 0; 30 is midway between yellow and red;
              setColor = { fmodf(360.0 + 180.0 + 30.0 + deviationFromDiatonic, 360.0f), SAT_VIVID, VALUE_NORMAL };
            } else  // White key
            {
              float deviationFromDiatonic = (((float)((int)round(keyDegree))) - (keyDegree)) * 180.0;  // from -60 to 120
              setColor = { fmodf(360.0 + 0.0 + 30.0 + deviationFromDiatonic, 360.0f), SAT_VIVID, VALUE_NORMAL };
            }
          }
          break;
        case PIANO_COLOR_MODE:
          {
            float octaveCycleLength = 1200.0 / current.tuning().stepSize;  // This is to prevent non-octave colouring weirdness
            float semipaletteIndex = fmodf(h[i].stepsFromC + (octaveCycleLength * 256.0), octaveCycleLength);
            float keyDegree = (12.0f / octaveCycleLength) * semipaletteIndex;
            if ((int)round(keyDegree) % 12 == 1 || (int)round(keyDegree) % 12 == 3 || (int)round(keyDegree) % 12 == 6 || (int)round(keyDegree) % 12 == 8 || (int)round(keyDegree) % 12 == 10) {
              float deviationFromDiatonic = ((float)((int)round(keyDegree) - keyDegree) * 3072.0f) / 12.0;
              uint8_t tint = (uint8_t)(abs(round(deviationFromDiatonic)));
              tint = strip.gamma8(tint);
              setColor = { 360 * (fmodf(round(keyDegree), 12.0f) / 12.0f), SAT_TINT, VALUE_BLACK };
            } else  // White key
            {
              float deviationFromDiatonic = ((((float)((int)round(keyDegree))) - (keyDegree)) * 3072.0f) / 12.0;
              uint8_t tint = 255 - (uint8_t)(abs(round(deviationFromDiatonic)));
              tint = strip.gamma8(tint);
              setColor = { 360 * (fmodf(round(keyDegree), 12.0f) / 12.0f), SAT_TINT, VALUE_NORMAL };
            }
          }
          break;
        case PIANO_INCANDESCENT_COLOR_MODE:
          {
            float octaveCycleLength = 1200.0 / current.tuning().stepSize;  // This is to prevent non-octave colouring weirdness
            float semipaletteIndex = fmodf(h[i].stepsFromC + (octaveCycleLength * 256.0), octaveCycleLength);
            float keyDegree = (12.0f / octaveCycleLength) * semipaletteIndex;
            float tint, deviationFromDiatonic;
            if ((int)round(keyDegree) % 12 == 1 || (int)round(keyDegree) % 12 == 3 || (int)round(keyDegree) % 12 == 6 || (int)round(keyDegree) % 12 == 8 || (int)round(keyDegree) % 12 == 10) {
              deviationFromDiatonic = (round(keyDegree) - keyDegree);
              deviationFromDiatonic = (abs(deviationFromDiatonic));  // from 0 to 0.5
            } else                                                   // White key
            {
              deviationFromDiatonic = (round(keyDegree) - keyDegree);
              deviationFromDiatonic = 1.0 - abs(deviationFromDiatonic);  // from 1 to 0.5
            }
            auto baseTemperature = 800;
            tint = ((sqrt(deviationFromDiatonic))) * (incandescence::maxTemperature - baseTemperature) + baseTemperature;

            setColor = incandescence::getColor(tint);
          }
          break;
        case ALTERNATE_COLOR_MODE:
          // This mode assigns each note a color based on the interval it forms with the root note.
          // This is an adaptation of an algorithm developed by Nicholas Fox and Kite Giedraitis.
          float cents = current.tuning().stepSize * paletteIndex;
          bool perf = 0;
          float center = 0.0;
          if (cents < 50) {
            perf = 1;
            center = 0.0;
          } else if ((cents >= 50) && (cents < 250)) {
            center = 147.1;
          } else if ((cents >= 250) && (cents < 450)) {
            center = 351.0;
          } else if ((cents >= 450) && (cents < 600)) {
            perf = 1;
            center = 498.0;
          } else if ((cents >= 600) && (cents <= 750)) {
            perf = 1;
            center = 702.0;
          } else if ((cents > 750) && (cents <= 950)) {
            center = 849.0;
          } else if ((cents > 950) && (cents <= 1150)) {
            center = 1053.0;
          } else if ((cents > 1150) && (cents < 1250)) {
            perf = 1;
            center = 1200.0;
          } else if ((cents >= 1250) && (cents < 1450)) {
            center = 1347.1;
          } else if ((cents >= 1450) && (cents < 1650)) {
            center = 1551.0;
          } else if ((cents >= 1650) && (cents < 1850)) {
            perf = 1;
            center = 1698.0;
          } else if ((cents >= 1800) && (cents <= 1950)) {
            perf = 1;
            center = 1902.0;
          }
          float offCenter = cents - center;
          int16_t altHue = positiveMod((int)(150 + (perf * ((offCenter > 0) ? -72 : 72)) - round(1.44 * offCenter)), 360);
          float deSaturate = perf * (abs(offCenter) < 20) * (1 - (0.02 * abs(offCenter)));
          setColor = {
            (float)altHue,
            (byte)(255 - round(255 * deSaturate)),
            (byte)(cents ? VALUE_SHADE : VALUE_NORMAL)
          };
          break;
      }
      colorDef restColor = setColor;
      restColor.val = applyLEDLevel(restColor.val, ledRestBrightness);
      h[i].LEDcodeRest = getLEDcode(restColor);
      colorDef playColor = setColor.tint();
      h[i].LEDcodePlay = getLEDcode(playColor);
      colorDef dimColor = setColor.shade();
      dimColor.val = applyLEDLevel(dimColor.val, ledDimBrightness);
      h[i].LEDcodeDim = getLEDcode(dimColor);
      setColor = { HUE_NONE, SAT_BW, VALUE_BLACK };
      h[i].LEDcodeOff = getLEDcode(setColor);  // turn off entirely
      h[i].LEDcodeAnim = h[i].LEDcodePlay;
    }
  }
  sendToLog("LED codes re-calculated.");
}

void resetVelocityLEDs() {
  byte topValue = byteLerp(0, 255, 85, 127, velWheel.curValue);
  colorDef tempColor = {
    (runTime % (rainbowDegreeTime * 360)) / (float)rainbowDegreeTime,
    SAT_MODERATE,
    applyLEDLevel(topValue, ledRestBrightness)
  };
  strip.setPixelColor(assignCmd[0], getLEDcode(tempColor));

  tempColor.val = applyLEDLevel(byteLerp(0, 255, 42, 85, velWheel.curValue), ledRestBrightness);
  strip.setPixelColor(assignCmd[1], getLEDcode(tempColor));

  tempColor.val = applyLEDLevel(byteLerp(0, 255, 0, 42, velWheel.curValue), ledRestBrightness);
  strip.setPixelColor(assignCmd[2], getLEDcode(tempColor));
}
void resetWheelLEDs() {
  // middle button
  byte tempSat = SAT_BW;
  byte baseValue = static_cast<byte>(toggleWheel ? VALUE_SHADE : VALUE_LOW);
  colorDef tempColor = { HUE_NONE, tempSat, applyLEDLevel(baseValue, ledRestBrightness) };
  strip.setPixelColor(assignCmd[3], getLEDcode(tempColor));
  if (toggleWheel) {
    // pb red / green
    tempSat = byteLerp(SAT_BW, SAT_VIVID, 0, 8192, abs(pbWheel.curValue));
    tempColor = {
      (float)((pbWheel.curValue > 0) ? HUE_RED : HUE_CYAN),
      tempSat,
      applyLEDLevel(VALUE_FULL, ledRestBrightness)
    };
    strip.setPixelColor(assignCmd[5], getLEDcode(tempColor));

    tempColor.val = applyLEDLevel(static_cast<byte>(tempSat * (pbWheel.curValue > 0)), ledRestBrightness);
    strip.setPixelColor(assignCmd[4], getLEDcode(tempColor));

    tempColor.val = applyLEDLevel(static_cast<byte>(tempSat * (pbWheel.curValue < 0)), ledRestBrightness);
    strip.setPixelColor(assignCmd[6], getLEDcode(tempColor));
  } else {
    // mod blue / yellow
    tempSat = byteLerp(SAT_BW, SAT_VIVID, 0, 64, abs(modWheel.curValue - 63));
    byte brightValue = static_cast<byte>(127 + (tempSat / 2));
    tempColor = {
      (float)((modWheel.curValue > 63) ? HUE_YELLOW : HUE_INDIGO),
      tempSat,
      applyLEDLevel(brightValue, ledRestBrightness)
    };
    strip.setPixelColor(assignCmd[6], getLEDcode(tempColor));

    if (modWheel.curValue <= 63) {
      brightValue = static_cast<byte>(127 - (tempSat / 2));
      tempColor.val = applyLEDLevel(brightValue, ledRestBrightness);
    }
    // when modWheel.curValue > 63, tempColor already holds the proper value
    strip.setPixelColor(assignCmd[5], getLEDcode(tempColor));

    tempColor.val = applyLEDLevel(static_cast<byte>(tempSat * (modWheel.curValue > 63)), ledRestBrightness);
    strip.setPixelColor(assignCmd[4], getLEDcode(tempColor));
  }
}
uint32_t applyNotePixelColor(byte x) {
  if (h[x].animate) {
    return h[x].LEDcodeAnim;
  } else if ((animationType != ANIMATE_NONE) && h[x].MIDIch) {
    return h[x].LEDcodePlay;
  } else if (h[x].inScale) {
    return h[x].LEDcodeRest;
  } else if (scaleLock) {
    return h[x].LEDcodeOff;
  } else {
    return h[x].LEDcodeDim;
  }
}
void setupLEDs() {
  strip.begin();  // INITIALIZE NeoPixel strip object
  strip.show();   // Turn OFF all pixels ASAP
  sendToLog("LEDs started...");
}
void lightUpLEDs() {
  for (byte i = 0; i < LED_COUNT; i++) {
    if (!(h[i].isCmd)) {
      strip.setPixelColor(i, applyNotePixelColor(i));
    }
  }
  resetVelocityLEDs();
  resetWheelLEDs();
  strip.show();
}

// @MIDI
/*
    This section of the code handles all
    things related to MIDI messages.
  */
#include <Adafruit_TinyUSB.h>  // library of code to get the USB port working
#include <MIDI.h>              // library of code to send and receive MIDI messages
/*
    These values support correct MIDI output.
    Note frequencies are converted to MIDI note
    and pitch bend messages assuming note 69
    equals concert A4, as defined below.
  */
#define CONCERT_A_HZ 440.0
/*
    Pitch bend messages are calibrated
    to a pitch bend range where
    -8192 to 8191 = -200 to +200 cents,
    or two semitones.
  */
#define PITCH_BEND_SEMIS 2
/*
    We use pitch bends to retune notes in MPE mode.
    Some setups can adjust to fit this, but some need us to adjust it.
  */
byte MPEpitchBendSemis = 48;
/*
    Create a new instance of the Arduino MIDI Library,
    and attach usb_midi as the transport.
  */
Adafruit_USBD_MIDI usb_midi;
MIDI_CREATE_INSTANCE(Adafruit_USBD_MIDI, usb_midi, UMIDI);
MIDI_CREATE_INSTANCE(HardwareSerial, Serial1, SMIDI);
// midiD takes the following bitwise flags
#define MIDID_NONE 0
#define MIDID_USB 1
#define MIDID_SER 2
#define MIDID_BOTH 3
byte midiD = MIDID_USB | MIDID_SER;

// What program change number we last sent (General MIDI/Roland MT-32)
byte programChange = 0;

std::vector<byte> mpeAvailableChannels;
byte MPEpitchBendsNeeded;
bool mpeChannelQueueActive = false;

uint8_t mpePlayableChannelCount() {
  if (mpeHighestChannel < mpeLowestChannel) {
    return 0;
  }
  return static_cast<uint8_t>(mpeHighestChannel - mpeLowestChannel + 1);
}

void resetMPEChannelPool() {
  mpeAvailableChannels.clear();
  for (byte ch = mpeLowestChannel; ch <= mpeHighestChannel; ++ch) {
    mpeAvailableChannels.push_back(ch);
    sendToLog("added ch " + std::to_string(ch) + " to the MPE pool");
  }
  if (mpeLowPriorityMode) {
    std::sort(mpeAvailableChannels.begin(), mpeAvailableChannels.end());
  }
}

byte takeMPEChannel() {
  if (mpeAvailableChannels.empty()) {
    return 0;
  }
  if (mpeLowPriorityMode) {
    byte ch = mpeAvailableChannels.front();
    mpeAvailableChannels.erase(mpeAvailableChannels.begin());
    return ch;
  }
  byte ch = mpeAvailableChannels.front();
  mpeAvailableChannels.erase(mpeAvailableChannels.begin());
  return ch;
}

void releaseMPEChannel(byte ch) {
  if (ch < mpeLowestChannel || ch > mpeHighestChannel) {
    return;
  }
  if (mpeLowPriorityMode) {
    auto insertPos = std::lower_bound(mpeAvailableChannels.begin(), mpeAvailableChannels.end(), ch);
    mpeAvailableChannels.insert(insertPos, ch);
  } else {
    mpeAvailableChannels.push_back(ch);
  }
  sendToLog("returned ch " + std::to_string(ch) + " to the MPE pool");
}

float freqToMIDI(float Hz) {  // formula to convert from Hz to MIDI note
  return 69.0 + 12.0 * log2f(Hz / 440.0);
}
float MIDItoFreq(float midi) {  // formula to convert from MIDI note to Hz
  return 440.0 * exp2((midi - 69.0) / 12.0);
}
float stepsToMIDI(int16_t stepsFromA) {  // return the MIDI pitch associated
  return freqToMIDI(CONCERT_A_HZ) + ((float)stepsFromA * (float)current.tuning().stepSize / 100.0);
}

// Do the same thing on each defined MIDI interface. This reduces code
// duplication. Search for withMIDI to see how it's used.
template <class F>
inline void withMIDI(F&& f) {
  if (midiD & MIDID_USB) f(UMIDI);
  if (midiD & MIDID_SER) f(SMIDI);
}

void setPitchBendRange(byte Ch, byte semitones) {
  withMIDI([&](auto& M) {
    M.beginRpn(0, Ch);
    M.sendRpnValue(semitones << 7, Ch);
    M.endRpn(Ch);
  });
  sendToLog(
    "set pitch bend range on ch " + std::to_string(Ch) + " to be " + std::to_string(semitones) + " semitones");
}

void setMPEzone(byte masterCh, byte sizeOfZone) {
  withMIDI([&](auto& M) {
    M.beginRpn(6, masterCh);
    M.sendRpnValue(sizeOfZone << 7, masterCh);
    M.endRpn(masterCh);
  });
  sendToLog(
    "tried sending MIDI msg to set MPE zone, master ch " + std::to_string(masterCh) + ", zone of this size: " + std::to_string(sizeOfZone));
}

void resetTuningMIDI() {
  /*
      One of the ways that microtonal MIDI works
      is via MPE (MIDI polyphonic expression).
      This assigns re-tuned notes to an independent channel
      so they can be pitched separately.

      We can now use microtonal tunings without MPE
      by sending standard MIDI note numbers across
      multiple channels to be retuned by other software
      or hardware.

      If operating in a standard 12-EDO tuning, with MPE
      disabled, or in a tuning with steps that are exact
      multiples of 100 cents, then MPE is not necessary.
    */
  standardMidiMicrotonalActive = false;
  bool tuningIsStandardSemitone = (current.tuning().stepSize == 100.0);
  bool forceMPE = (mpeUserMode == MPE_MODE_FORCE);
  bool disableMPE = (mpeUserMode == MPE_MODE_DISABLE);
  bool mpeOptional = !forceMPE && !useDynamicJustIntonation && !useJustIntonationBPM;

  if (forceMPE) {
    MPEpitchBendsNeeded = 255;
  } else if (disableMPE) {
    standardMidiMicrotonalActive = !tuningIsStandardSemitone;
    MPEpitchBendsNeeded = 1;
  } else if (mpeOptional && tuningIsStandardSemitone) {
    MPEpitchBendsNeeded = 1;  // Standard 12EDO, single-channel mode
  } else {
    MPEpitchBendsNeeded = 255;  // Enables MPE mode when microtonal needs per-note pitch bends
  }
  clampMPEChannelRange();

  uint8_t playableChannels = mpePlayableChannelCount();
  if (playableChannels == 0) {
    mpeLowestChannel = 2;
    mpeHighestChannel = 2;
    playableChannels = mpePlayableChannelCount();
  }

  bool mpeEnabled = (MPEpitchBendsNeeded > 1);

  if (mpeEnabled) {
    byte zoneSize = 0;
    if (mpeHighestChannel > 1) {
      zoneSize = static_cast<byte>(mpeHighestChannel - 1);
    }
    setMPEzone(1, zoneSize);  // Advertise the highest channel we plan to use.
  } else {
    setMPEzone(1, 0);
  }

  mpeChannelQueueActive = false;
  mpeAvailableChannels.clear();

  if (mpeEnabled) {
    bool needsQueue = (MPEpitchBendsNeeded > playableChannels) || mpeLowPriorityMode;
    mpeChannelQueueActive = needsQueue;
    if (needsQueue) {
      resetMPEChannelPool();
    }
  }
  // Reset controllers and ensure every channel uses the appropriate pitch-bend range.
  for (byte i = 1; i <= 16; i++) {
    withMIDI([&](auto& M) { M.sendControlChange(123, 0, i); });
    byte range = 2;
    if (mpeEnabled && i >= mpeLowestChannel && i <= mpeHighestChannel) {
      range = MPEpitchBendSemis;
    } else if (MPEpitchBendsNeeded == 1) {
      range = 2;
    }
    setPitchBendRange(i, range);
  }
}

byte primaryMIDIChannel() {
  if (MPEpitchBendsNeeded == 1) {
    if (defaultMidiChannel < 1 || defaultMidiChannel > 16) {
      return 1;
    }
    return defaultMidiChannel;
  }
  return 1;  // In MPE mode, channel 1 is the master channel.
}

void sendMIDImodulationToCh1() {
  byte targetChannel = primaryMIDIChannel();
  withMIDI([&](auto& M) { M.sendControlChange(1, modWheel.curValue, targetChannel); });
  sendToLog("sent mod value " + std::to_string(modWheel.curValue) + " to ch " + std::to_string(targetChannel));
}

void sendMIDIpitchBendToCh1() {
  byte targetChannel = primaryMIDIChannel();
  withMIDI([&](auto& M) { M.sendPitchBend(pbWheel.curValue, targetChannel); });
  sendToLog("sent pb wheel value " + std::to_string(pbWheel.curValue) + " to ch " + std::to_string(targetChannel));
}

//////////////////////////////////////////////////////////////////
//  Dynamic just intonation code start


// HOW BPM SYNC WORKS:
// The idea is to round off the note frequency to a certain precision.
// If you round the note frequencies of a C-E-G chord to integer values (261.626Hz / 329.628Hz / 391.995Hz) -
// you'll get a chord with ratio of 262/294/392.
// As a result, because these frequency values are always a multiple of 1 Hz -
// they all will be guaranteed to finish their wave cycle in 1 second.
// Thus, this chord will beat at 1 Hz if not faster.

// By knowing the pressed keys it is possible to pick better ratios, ideally having 262/327.5/393 (4/5/6) in this example

// TODO: make BPM sync work with dynamic just intonation to make pure just intonation achieveable.
// Without it - this implementation provides you with n-EDO-sized independent JI rings, unconnected to eachother;
// TODO: replace floating point math with integer math;
// TODO: replace std::pair<byte,byte> ratios with precomputed floating(or fixed) point ratios;
// TODO: generate the table of ratios with a constexpr function rather than holding a huge block of hardcoded values in the code;
// TODO: It is a good idea to octave-reduce the ratios, and adjust the code to calculate pitchbend against the octave reduced set of ratios for significant performance improvement;
inline float pitchBendToFrequencyMultiplier(int16_t bendValue) {
  if (bendValue == 0) {
    return 1.0f;
  }
  const float semitoneOffset = (static_cast<float>(bendValue) * static_cast<float>(MPEpitchBendSemis)) / 8192.0f;
  return std::exp2(semitoneOffset / 12.0f);
}

int16_t justIntonationRetune(byte x);

inline int16_t combinedPitchBend(byte index) {
  const int32_t combined = static_cast<int32_t>(h[index].bend) + h[index].jiRetune;
  if (combined > 8191) {
    return 8191;
  }
  if (combined < -8192) {
    return -8192;
  }
  return static_cast<int16_t>(combined);
}


// This is a list of ratios sorted from the simplest ones to the most complex ones. The code searches for a first match that's good enough within 1/4 of an EDO step, literally bruteforcing through the list. As a result - the simplest ratio is chosen before more comples ones, prioritising consonant ratios first. In case not a single good ratio is found - the best one found so far is chosen instead

// byte pair was chosen to preserve space. The ratio is "unpacked" later
std::vector<std::pair<byte, byte>> ratios = {
  { 1, 1 },
  { 1, 2 },
  { 2, 1 },
  { 3, 1 },
  { 1, 3 },
  { 1, 4 },
  { 2, 3 },
  { 1, 4 },
  { 4, 1 },
  { 3, 2 },
  { 1, 5 },
  { 5, 1 },
  { 5, 2 },
  { 1, 6 },
  { 3, 4 },
  { 5, 2 },
  { 4, 3 },
  { 6, 1 },
  { 2, 5 },
  { 5, 3 },
  { 1, 7 },
  { 7, 1 },
  { 3, 5 },
  { 2, 7 },
  { 8, 1 },
  { 5, 4 },
  { 1, 8 },
  { 4, 5 },
  { 7, 2 },
  { 9, 1 },
  { 7, 3 },
  { 1, 9 },
  { 3, 7 },
  { 1, 9 },
  { 1, 10 },
  { 10, 1 },
  { 7, 4 },
  { 3, 8 },
  { 8, 3 },
  { 6, 5 },
  { 1, 10 },
  { 8, 3 },
  { 4, 7 },
  { 2, 9 },
  { 9, 2 },
  { 5, 6 },
  { 11, 1 },
  { 7, 5 },
  { 1, 11 },
  { 5, 7 },
  { 5, 8 },
  { 3, 10 },
  { 4, 9 },
  { 3, 10 },
  { 2, 11 },
  { 11, 2 },
  { 12, 1 },
  { 1, 12 },
  { 9, 4 },
  { 5, 8 },
  { 1, 12 },
  { 8, 5 },
  { 10, 3 },
  { 6, 7 },
  { 7, 6 },
  { 12, 1 },
  { 9, 5 },
  { 1, 13 },
  { 3, 11 },
  { 11, 3 },
  { 9, 5 },
  { 5, 9 },
  { 13, 1 },
  { 14, 1 },
  { 13, 2 },
  { 11, 4 },
  { 1, 14 },
  { 2, 13 },
  { 8, 7 },
  { 7, 8 },
  { 4, 11 },
  { 9, 7 },
  { 11, 5 },
  { 7, 9 },
  { 5, 11 },
  { 13, 3 },
  { 3, 13 },
  { 15, 1 },
  { 1, 15 },
  { 4, 13 },
  { 2, 15 },
  { 10, 7 },
  { 2, 15 },
  { 11, 6 },
  { 8, 9 },
  { 16, 1 },
  { 12, 5 },
  { 3, 14 },
  { 7, 10 },
  { 5, 12 },
  { 14, 3 },
  { 9, 8 },
  { 15, 2 },
  { 13, 4 },
  { 1, 16 },
  { 6, 11 },
  { 17, 1 },
  { 1, 17 },
  { 5, 13 },
  { 13, 5 },
  { 4, 15 },
  { 17, 2 },
  { 9, 10 },
  { 2, 17 },
  { 9, 10 },
  { 12, 7 },
  { 10, 9 },
  { 11, 8 },
  { 16, 3 },
  { 3, 16 },
  { 13, 6 },
  { 14, 5 },
  { 15, 4 },
  { 18, 1 },
  { 8, 11 },
  { 1, 18 },
  { 4, 15 },
  { 5, 14 },
  { 6, 13 },
  { 7, 12 },
  { 19, 1 },
  { 11, 9 },
  { 17, 3 },
  { 3, 17 },
  { 9, 11 },
  { 1, 19 },
  { 5, 16 },
  { 20, 1 },
  { 8, 13 },
  { 10, 11 },
  { 20, 1 },
  { 19, 2 },
  { 1, 20 },
  { 11, 10 },
  { 2, 19 },
  { 13, 8 },
  { 17, 4 },
  { 4, 17 },
  { 16, 5 },
  { 1, 20 },
  { 13, 9 },
  { 21, 1 },
  { 7, 15 },
  { 9, 13 },
  { 19, 3 },
  { 17, 5 },
  { 3, 19 },
  { 5, 17 },
  { 15, 7 },
  { 1, 21 },
  { 13, 10 },
  { 3, 20 },
  { 12, 11 },
  { 21, 2 },
  { 18, 5 },
  { 6, 17 },
  { 15, 8 },
  { 3, 20 },
  { 20, 3 },
  { 19, 4 },
  { 5, 18 },
  { 14, 9 },
  { 9, 14 },
  { 8, 15 },
  { 2, 21 },
  { 1, 22 },
  { 17, 6 },
  { 22, 1 },
  { 10, 13 },
  { 11, 12 },
  { 4, 19 },
  { 5, 19 },
  { 1, 23 },
  { 19, 5 },
  { 23, 1 },
  { 18, 7 },
  { 8, 17 },
  { 21, 4 },
  { 22, 3 },
  { 3, 22 },
  { 7, 18 },
  { 6, 19 },
  { 12, 13 },
  { 19, 6 },
  { 2, 23 },
  { 9, 16 },
  { 17, 8 },
  { 24, 1 },
  { 13, 12 },
  { 1, 24 },
  { 23, 2 },
  { 4, 21 },
  { 16, 9 },
  { 9, 17 },
  { 1, 25 },
  { 5, 21 },
  { 25, 1 },
  { 15, 11 },
  { 17, 9 },
  { 3, 23 },
  { 23, 3 },
  { 11, 15 },
  { 21, 5 },
  { 17, 10 },
  { 10, 17 },
  { 19, 8 },
  { 5, 22 },
  { 20, 7 },
  { 22, 5 },
  { 23, 4 },
  { 7, 20 },
  { 1, 26 },
  { 8, 19 },
  { 25, 2 },
  { 26, 1 },
  { 2, 25 },
  { 4, 23 },
  { 5, 23 },
  { 9, 19 },
  { 1, 27 },
  { 13, 15 },
  { 3, 25 },
  { 15, 13 },
  { 23, 5 },
  { 19, 9 },
  { 27, 1 },
  { 25, 3 },
  { 25, 4 },
  { 14, 15 },
  { 27, 2 },
  { 9, 20 },
  { 2, 27 },
  { 26, 3 },
  { 20, 9 },
  { 17, 12 },
  { 1, 28 },
  { 24, 5 },
  { 10, 19 },
  { 12, 17 },
  { 23, 6 },
  { 21, 8 },
  { 11, 18 },
  { 19, 10 },
  { 5, 24 },
  { 4, 25 },
  { 5, 24 },
  { 3, 26 },
  { 18, 11 },
  { 28, 1 },
  { 8, 21 },
  { 6, 23 },
  { 15, 14 },
  { 1, 29 },
  { 29, 1 },
  { 23, 8 },
  { 24, 7 },
  { 7, 24 },
  { 6, 25 },
  { 10, 21 },
  { 30, 1 },
  { 5, 26 },
  { 25, 6 },
  { 11, 20 },
  { 30, 1 },
  { 1, 30 },
  { 16, 15 },
  { 8, 23 },
  { 4, 27 },
  { 2, 29 },
  { 26, 5 },
  { 9, 22 },
  { 29, 2 },
  { 27, 4 },
  { 28, 3 },
  { 15, 16 },
  { 20, 11 },
  { 18, 13 },
  { 22, 9 },
  { 21, 10 },
  { 13, 18 },
  { 12, 19 },
  { 19, 12 },
  { 3, 28 },
  { 17, 15 },
  { 15, 17 },
  { 29, 3 },
  { 31, 1 },
  { 27, 5 },
  { 3, 29 },
  { 9, 23 },
  { 23, 9 },
  { 1, 31 },
  { 5, 27 },
  { 13, 20 },
  { 2, 31 },
  { 28, 5 },
  { 1, 32 },
  { 29, 4 },
  { 25, 8 },
  { 20, 13 },
  { 4, 29 },
  { 8, 25 },
  { 23, 10 },
  { 10, 23 },
  { 5, 28 },
  { 31, 2 },
  { 32, 1 },
  { 33, 1 },
  { 3, 31 },
  { 1, 33 },
  { 5, 29 },
  { 15, 19 },
  { 9, 25 },
  { 31, 3 },
  { 19, 15 },
  { 25, 9 },
  { 29, 5 },
  { 33, 2 },
  { 6, 29 },
  { 17, 18 },
  { 34, 1 },
  { 2, 33 },
  { 32, 3 },
  { 26, 9 },
  { 31, 4 },
  { 27, 8 },
  { 1, 34 },
  { 4, 31 },
  { 18, 17 },
  { 29, 6 },
  { 8, 27 },
  { 12, 23 },
  { 11, 24 },
  { 3, 32 },
  { 9, 26 },
  { 23, 12 },
  { 24, 11 },
  { 5, 31 },
  { 31, 5 },
  { 35, 1 },
  { 1, 35 },
  { 1, 36 },
  { 30, 7 },
  { 24, 13 },
  { 18, 19 },
  { 36, 1 },
  { 6, 31 },
  { 28, 9 },
  { 34, 3 },
  { 36, 1 },
  { 15, 22 },
  { 7, 30 },
  { 8, 29 },
  { 1, 36 },
  { 17, 20 },
  { 29, 8 },
  { 4, 33 },
  { 12, 25 },
  { 10, 27 },
  { 32, 5 },
  { 20, 17 },
  { 3, 34 },
  { 25, 12 },
  { 5, 32 },
  { 2, 35 },
  { 33, 4 },
  { 22, 15 },
  { 9, 28 },
  { 13, 24 },
  { 27, 10 },
  { 35, 2 },
  { 19, 18 },
  { 31, 6 },
  { 9, 29 },
  { 35, 3 },
  { 29, 9 },
  { 5, 33 },
  { 23, 15 },
  { 33, 5 },
  { 15, 23 },
  { 37, 1 },
  { 3, 35 },
  { 1, 37 },
  { 10, 29 },
  { 31, 8 },
  { 5, 34 },
  { 4, 35 },
  { 1, 38 },
  { 35, 4 },
  { 29, 10 },
  { 34, 5 },
  { 37, 2 },
  { 2, 37 },
  { 19, 20 },
  { 8, 31 },
  { 20, 19 },
  { 38, 1 },
  { 31, 9 },
  { 39, 1 },
  { 37, 3 },
  { 3, 37 },
  { 9, 31 },
  { 1, 39 },
  { 38, 3 },
  { 11, 30 },
  { 9, 32 },
  { 26, 15 },
  { 31, 10 },
  { 29, 12 },
  { 32, 9 },
  { 20, 21 },
  { 2, 39 },
  { 35, 6 },
  { 33, 8 },
  { 5, 36 },
  { 37, 4 },
  { 21, 20 },
  { 15, 26 },
  { 40, 1 },
  { 8, 33 },
  { 10, 31 },
  { 30, 11 },
  { 12, 29 },
  { 23, 18 },
  { 17, 24 },
  { 36, 5 },
  { 40, 1 },
  { 1, 40 },
  { 4, 37 },
  { 24, 17 },
  { 39, 2 },
  { 6, 35 },
  { 18, 23 },
  { 3, 38 },
  { 41, 1 },
  { 37, 5 },
  { 5, 37 },
  { 1, 41 },
  { 33, 10 },
  { 3, 40 },
  { 4, 39 },
  { 1, 42 },
  { 37, 6 },
  { 13, 30 },
  { 12, 31 },
  { 42, 1 },
  { 10, 33 },
  { 7, 36 },
  { 36, 7 },
  { 9, 34 },
  { 41, 2 },
  { 35, 8 },
  { 40, 3 },
  { 8, 35 },
  { 5, 38 },
  { 2, 41 },
  { 39, 4 },
  { 38, 5 }
};

int16_t centsToRelativePitchBend(float cents) {
  return round(cents * (8192.0 / (100.0 * MPEpitchBendSemis)));
}

float ratioToCents(float ratio) {
  return 1200.0 * (std::log(ratio) / std::log(2.0));
}

int16_t justIntonationRetune(byte x) {
  if (useDynamicJustIntonation == false && useJustIntonationBPM == false) {
    h[x].jiRetune = 0;
    h[x].jiFrequencyMultiplier = 1.0f;
    return 0;
  }
  int16_t pitchAdjustment = 0;
  float pitchAdjustmentCents = 0;
  float basePitchOffset = 0;
  //int16_t degree = (current.keyDegree(h[x].stepsFromC + current.transpose + current.tuning().spanCtoA()));
  //float buttonStepsFromA = degree;
  if (useJustIntonationBPM) {
    float buttonStepsFromA = -current.tuning().spanCtoA() - h[x].stepsFromC;
    // It was planned to use integer math but floating point arithmetics works fast enough so far
    float rounding = ((float)justIntonationBPM / 60.0 * justIntonationBPM_Multiplier);
    pitchAdjustmentCents = (buttonStepsFromA * current.tuning().stepSize) - ratioToCents(round(440.0 / rounding) / round(h[x].frequency / rounding));

    if (pressedKeyIDs.size() > 1 && useDynamicJustIntonation) {
      basePitchOffset = ((-current.tuning().spanCtoA() - h[pressedKeyIDs[0]].stepsFromC) * current.tuning().stepSize) - ratioToCents(round(440.0 / rounding) / round(h[pressedKeyIDs[0]].frequency / rounding));
    } else {
      pitchAdjustment += centsToRelativePitchBend(pitchAdjustmentCents);
    }
  }
  if (useDynamicJustIntonation && pressedKeyIDs.size() > 1) {
    //bool ratioFound = false;  // I might need this one later
    bool preferSmallRatios = true;  // if false - the closest found ratio will be chosen from the ratio table

    // detune within a 1/4 of a step, avoid wild detuning but cover the entire pitch range
    float errorThreshold = current.tuning().stepSize / 4.0;
    float deviation = INFINITY;
    float EDOCents = ratioToCents(h[pressedKeyIDs[0]].frequency / h[x].frequency);
    std::pair<byte, byte> selectedRatio;

    for (int i = 0; i < ratios.size(); i++) {
      auto ratio = ratios[i];
      float ratio0 = ratio.first;
      float ratio1 = ratio.second;
      //if(h[pressedKeyIDs[0]].note < h[x].note)
      //{
      //  std::swap(ratio1,ratio0);
      //}
      float ratioCents = ratioToCents(ratio0 / ratio1);

      if (std::abs(deviation) > std::abs(ratioCents - EDOCents)) {
        deviation = (EDOCents - ratioCents);
        selectedRatio.first = ratio0;
        selectedRatio.second = ratio1;
        if (preferSmallRatios && std::abs(deviation) < errorThreshold) {
          //ratioFound = true;
          break;
        }
      }
    }
    //if(ratioFound)
    {
      pitchAdjustment += centsToRelativePitchBend(deviation + basePitchOffset);
    }
  }
  h[x].jiRetune = pitchAdjustment;
  h[x].jiFrequencyMultiplier = pitchBendToFrequencyMultiplier(pitchAdjustment);
  return pitchAdjustment;
}


void tryMIDInoteOn(byte x) {
  // This gets called on any non-command hex that is not scale-locked.
  if (h[x].note >= 128) {
    return;
  }
  if (!(h[x].MIDIch)) {
    if (MPEpitchBendsNeeded == 1) {
      if (standardMidiMicrotonalActive) {
        h[x].MIDIch = h[x].mappedMidiChannel ? h[x].mappedMidiChannel : defaultMidiChannel;
      } else {
        h[x].MIDIch = defaultMidiChannel;
      }
    } else {
      uint8_t availableChannels = mpePlayableChannelCount();
      if (availableChannels == 0) {
        sendToLog("No MPE channels configured; skipped MIDI note");
      } else if (mpeChannelQueueActive) {
        byte channel = takeMPEChannel();
        if (!channel) {
          sendToLog("MPE pool was empty so did not play a MIDI note");
        } else {
          h[x].MIDIch = channel;
          sendToLog("Assigned MPE ch " + std::to_string(h[x].MIDIch) + " from pool");
        }
      } else {
        h[x].MIDIch = static_cast<byte>(mpeLowestChannel + positiveMod(h[x].stepsFromC, availableChannels));
      }
    }

    if (h[x].MIDIch) {
      pressedKeyIDs.push_back(x);  // Dynamic JI pressed key tracking
      justIntonationRetune(x);
      int16_t pitchBendValue = 0;
      // First, send the pitch bend (if applicable)
      if (MPEpitchBendsNeeded != 1) {
        pitchBendValue = combinedPitchBend(x);
        withMIDI([&](auto& M) { M.sendPitchBend(pitchBendValue, h[x].MIDIch); });  // ch 1-16
        if (extraMPE) { // if the extra MPE messages are enabled
          withMIDI([&](auto& M) {
            M.sendAfterTouch(velWheel.curValue, h[x].MIDIch);  // Channel Pressure
            M.sendControlChange(74, CC74value, h[x].MIDIch);   // CC74 (Timbre)
          });
        }
      }
      // Then, send the note-on message
      withMIDI([&](auto& M) { M.sendNoteOn(h[x].note, velWheel.curValue, h[x].MIDIch); });  // ch 1-16

      sendToLog(
        "Sent MIDI pitch bend: " + std::to_string(pitchBendValue) + " to ch " + std::to_string(h[x].MIDIch));
      sendToLog(
        "Sent MIDI noteOn: " + std::to_string(h[x].note) + " vel " + std::to_string(velWheel.curValue) + " ch " + std::to_string(h[x].MIDIch));
    }
  }
}

void tryMIDInoteOff(byte x) {
  // this gets called on any non-command hex
  // that is not scale-locked.
  if (h[x].MIDIch) {  // but just in case, check
    withMIDI([&](auto& M) { M.sendNoteOff(h[x].note, velWheel.curValue, h[x].MIDIch); });
    pressedKeyIDs.pop_back();  // Dynamic JI pressed key tracking
    h[x].jiRetune = 0;
    h[x].jiFrequencyMultiplier = 1.0f;
    sendToLog(
      "sent note off: " + std::to_string(h[x].note) + " vel " + std::to_string(velWheel.curValue) + " ch " + std::to_string(h[x].MIDIch));
    if (mpeChannelQueueActive && h[x].MIDIch >= mpeLowestChannel && h[x].MIDIch <= mpeHighestChannel) {
      if (extraMPE) { //if the extra MPE messages are enabled
        withMIDI([&](auto& M) {
          M.sendAfterTouch(0, h[x].MIDIch);                 // Channel Pressure
          M.sendControlChange(74, CC74value, h[x].MIDIch);  // CC74 (Timbre)
        });
      }
      releaseMPEChannel(h[x].MIDIch);
    }
    h[x].MIDIch = 0;
  }
}

/*
    Eight voice polyphony can be simulated.
    Any more voices and the
    resolution is too low to distinguish;
    also, the code becomes too slow to keep
    up with the poll interval. This value
    can be safely reduced below eight if
    there are issues.

    Note this is NOT the same as the MIDI
    polyphony limit, which is 15 (based
    on using channel 2 through 16 for
    polyphonic expression mode).
  */
#define POLYPHONY_LIMIT 8

void setupMIDI() {
  usb_midi.setStringDescriptor("HexBoard MIDI");  // Initialize MIDI, and listen to all MIDI channels
  UMIDI.begin(MIDI_CHANNEL_OMNI);                 // This will also call usb_midi's begin()
  SMIDI.begin(MIDI_CHANNEL_OMNI);
  UMIDI.turnThruOff();                            // prevent echoing incoming MIDI back out
  SMIDI.turnThruOff();                            // disable thru on DIN as well
  sendToLog("setupMIDI okay");
}

// @synth
/*
    This section of the code handles audio
    output via the piezo buzzer and/or the
    headphone jack (on hardware v1.2 only)
  */
#include "hardware/pwm.h"  // library of code to access the processor's built in pulse wave modulation features
#include "hardware/irq.h"  // library of code to let you interrupt code execution to run something of higher priority
/*
    It is more convenient to pre-define the correct
    pulse wave modulation slice and channel associated
    with the PIEZO_PIN on this processor (see RP2040
    manual) than to have it looked up each time.
  */
#define PIEZO_PIN 23
#define PIEZO_SLICE 3
#define PIEZO_CHNL 1
#define AJACK_PIN 25
#define AJACK_SLICE 4
#define AJACK_CHNL 1
// midiD takes the following bitwise flags
#define AUDIO_NONE 0
#define AUDIO_PIEZO 1
#define AUDIO_AJACK 2
#define AUDIO_BOTH 3
byte audioD = AUDIO_PIEZO | AUDIO_AJACK;
/*
    These definitions provide 8-bit samples to emulate.
    You can add your own as desired; it must
    be an array of 256 values, each from 0 to 255.
    Ideally the waveform is normalized so that the
    peaks are at 0 to 255, with 127 representing
    no wave movement.
  */
byte sine[] = {
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 3, 3,
  4, 5, 6, 7, 8, 9, 10, 12, 13, 15, 16, 18, 19, 21, 23, 25,
  27, 29, 31, 33, 35, 37, 39, 42, 44, 46, 49, 51, 54, 56, 59, 62,
  64, 67, 70, 73, 76, 79, 81, 84, 87, 90, 93, 96, 99, 103, 106, 109,
  112, 115, 118, 121, 124, 127, 131, 134, 137, 140, 143, 146, 149, 152, 156, 159,
  162, 165, 168, 171, 174, 176, 179, 182, 185, 188, 191, 193, 196, 199, 201, 204,
  206, 209, 211, 213, 216, 218, 220, 222, 224, 226, 228, 230, 232, 234, 236, 237,
  239, 240, 242, 243, 245, 246, 247, 248, 249, 250, 251, 252, 252, 253, 254, 254,
  255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 254, 254, 253, 252, 252,
  251, 250, 249, 248, 247, 246, 245, 243, 242, 240, 239, 237, 236, 234, 232, 230,
  228, 226, 224, 222, 220, 218, 216, 213, 211, 209, 206, 204, 201, 199, 196, 193,
  191, 188, 185, 182, 179, 176, 174, 171, 168, 165, 162, 159, 156, 152, 149, 146,
  143, 140, 137, 134, 131, 127, 124, 121, 118, 115, 112, 109, 106, 103, 99, 96,
  93, 90, 87, 84, 81, 79, 76, 73, 70, 67, 64, 62, 59, 56, 54, 51,
  49, 46, 44, 42, 39, 37, 35, 33, 31, 29, 27, 25, 23, 21, 19, 18,
  16, 15, 13, 12, 10, 9, 8, 7, 6, 5, 4, 3, 3, 2, 1, 1
};
byte strings[] = {
  0, 0, 0, 1, 3, 6, 10, 14, 20, 26, 33, 41, 50, 59, 68, 77,
  87, 97, 106, 115, 124, 132, 140, 146, 152, 157, 161, 164, 166, 167, 167, 167,
  165, 163, 160, 157, 153, 149, 144, 140, 135, 130, 126, 122, 118, 114, 111, 109,
  106, 104, 103, 101, 101, 100, 100, 100, 100, 101, 101, 102, 103, 103, 104, 105,
  106, 107, 108, 109, 110, 111, 113, 114, 115, 116, 117, 119, 120, 121, 123, 124,
  126, 127, 129, 131, 132, 134, 135, 136, 138, 139, 140, 141, 142, 144, 145, 146,
  147, 148, 149, 150, 151, 152, 152, 153, 154, 154, 155, 155, 155, 155, 154, 154,
  152, 151, 149, 146, 144, 140, 137, 133, 129, 125, 120, 115, 111, 106, 102, 98,
  95, 92, 90, 88, 88, 88, 89, 91, 94, 98, 103, 109, 115, 123, 131, 140,
  149, 158, 168, 178, 187, 196, 205, 214, 222, 229, 235, 241, 245, 249, 252, 254,
  255, 255, 255, 254, 253, 250, 248, 245, 242, 239, 236, 233, 230, 227, 224, 222,
  220, 218, 216, 215, 214, 213, 212, 211, 210, 210, 209, 208, 207, 206, 205, 203,
  201, 199, 197, 194, 191, 188, 184, 180, 175, 171, 166, 161, 156, 150, 145, 139,
  133, 127, 122, 116, 110, 105, 99, 94, 89, 84, 80, 75, 71, 67, 64, 61,
  58, 56, 54, 52, 50, 49, 48, 47, 46, 45, 45, 44, 43, 42, 41, 40,
  39, 37, 35, 33, 31, 28, 25, 22, 19, 16, 13, 10, 7, 5, 2, 1
};
byte clarinet[] = {
  0,
  0,
  2,
  7,
  14,
  21,
  30,
  38,
  47,
  54,
  61,
  66,
  70,
  72,
  73,
  74,
  73,
  73,
  72,
  71,
  70,
  71,
  72,
  74,
  76,
  80,
  84,
  88,
  93,
  97,
  101,
  105,
  109,
  111,
  113,
  114,
  114,
  114,
  113,
  112,
  111,
  110,
  109,
  109,
  109,
  110,
  112,
  114,
  116,
  118,
  121,
  123,
  126,
  127,
  128,
  129,
  128,
  127,
  126,
  123,
  121,
  118,
  116,
  114,
  112,
  110,
  109,
  109,
  109,
  110,
  111,
  112,
  113,
  114,
  114,
  114,
  113,
  111,
  109,
  105,
  101,
  97,
  93,
  88,
  84,
  80,
  76,
  74,
  72,
  71,
  70,
  71,
  72,
  73,
  73,
  74,
  73,
  72,
  70,
  66,
  61,
  54,
  47,
  38,
  30,
  21,
  14,
  7,
  2,
  0,
  0,
  2,
  9,
  18,
  31,
  46,
  64,
  84,
  105,
  127,
  150,
  171,
  191,
  209,
  224,
  237,
  246,
  252,
  255,
  255,
  253,
  248,
  241,
  234,
  225,
  217,
  208,
  201,
  194,
  189,
  185,
  183,
  182,
  181,
  182,
  182,
  183,
  184,
  185,
  184,
  183,
  181,
  179,
  175,
  171,
  167,
  162,
  158,
  154,
  150,
  146,
  144,
  142,
  141,
  141,
  141,
  142,
  143,
  144,
  145,
  146,
  146,
  146,
  145,
  143,
  141,
  139,
  136,
  134,
  132,
  129,
  128,
  127,
  126,
  127,
  128,
  129,
  132,
  134,
  136,
  139,
  141,
  143,
  145,
  146,
  146,
  146,
  145,
  144,
  143,
  142,
  141,
  141,
  141,
  142,
  144,
  146,
  150,
  154,
  158,
  162,
  167,
  171,
  175,
  179,
  181,
  183,
  184,
  185,
  184,
  183,
  182,
  182,
  181,
  182,
  183,
  185,
  189,
  194,
  201,
  208,
  217,
  225,
  234,
  241,
  248,
  253,
  255,
  255,
  252,
  246,
  237,
  224,
  209,
  191,
  171,
  150,
  127,
  105,
  84,
  64,
  46,
  31,
  18,
  9,
  2,
};
/*
    The hybrid synth sound blends between
    square, saw, and triangle waveforms
    at different frequencies. Said frequencies
    are controlled via constants here.
  */
#define TRANSITION_SQUARE 220.0
#define TRANSITION_SAW_LOW 440.0
#define TRANSITION_SAW_HIGH 880.0
#define TRANSITION_TRIANGLE 1760.0
/*
    The poll interval represents how often a
    new sample value is emulated on the PWM
    hardware. It is the inverse of the digital
    audio sample rate. 24 microseconds has been
    determined to be the sweet spot, and corresponds
    to approximately 41 kHz, which is close to
    CD-quality (44.1 kHz). A shorter poll interval
    may produce more pleasant tones, but if the
    poll is too short then the code will not have
    enough time to calculate the new sample and
    the resulting audio becomes unstable and
    inaccurate.
  */
#define POLL_INTERVAL_IN_MICROSECONDS 24

inline uint32_t ticksFromMicros(uint32_t micros) {
  if (micros == 0) {
    return 0;
  }
  return (micros + POLL_INTERVAL_IN_MICROSECONDS - 1) / POLL_INTERVAL_IN_MICROSECONDS;
}

struct EnvelopeState {
  uint32_t level = 0;
  uint32_t releaseIncrement = 0;
  EnvelopeStage stage = EnvelopeStage::Idle;
};

std::array<EnvelopeState, POLYPHONY_LIMIT> envelopeStates;
enum class EnvelopeCommand : uint8_t {
  None,
  StartAttack,
  StartRelease,
  Reset
};

std::array<std::atomic<EnvelopeCommand>, POLYPHONY_LIMIT> envelopeCommands;
std::array<std::atomic<bool>, POLYPHONY_LIMIT> channelInUse = {};
std::array<std::atomic<bool>, POLYPHONY_LIMIT> envelopeNeedsFree;
std::array<std::atomic<uint32_t>, POLYPHONY_LIMIT> voiceGenerations;
std::array<std::atomic<int16_t>, POLYPHONY_LIMIT> synthChannelOwners;
std::atomic<uint32_t> nextVoiceGeneration = 1;
constexpr int16_t NO_SYNTH_OWNER = -1;
float pitchBendFactor = 1.0f;
std::array<uint8_t, POLYPHONY_LIMIT> releaseRetries = {};
std::array<uint8_t, POLYPHONY_LIMIT> releaseRetryCountdown = {};

constexpr uint8_t releaseRetryLimit = 2;
constexpr uint8_t releaseRetryDelayLoops = 2;
void updateEnvelopeParamsFromSettings() {
  auto clampIndex = [](uint8_t& index) {
    if (index >= envelopeTimeMicrosOptions.size()) {
      index = static_cast<uint8_t>(envelopeTimeMicrosOptions.size() - 1);
    }
  };

  clampIndex(envelopeAttackIndex);
  clampIndex(envelopeDecayIndex);
  clampIndex(envelopeReleaseIndex);

  uint32_t attackMicros = envelopeTimeMicrosOptions[envelopeAttackIndex];
  envelopeParams.attackTicks = ticksFromMicros(attackMicros);
  envelopeParams.attackIncrement = (envelopeParams.attackTicks == 0)
                                     ? envelopeMaxLevel
                                     : std::max<uint32_t>(1, (envelopeMaxLevel + envelopeParams.attackTicks - 1) / envelopeParams.attackTicks);

  uint8_t sustainByte = std::min<uint8_t>(127, envelopeSustainLevel);
  envelopeParams.sustainLevel = static_cast<uint16_t>((static_cast<uint32_t>(sustainByte) * envelopeMaxLevel) / 127);

  uint32_t decayMicros = envelopeTimeMicrosOptions[envelopeDecayIndex];
  envelopeParams.decayTicks = ticksFromMicros(decayMicros);
  if (envelopeParams.decayTicks == 0 || envelopeParams.sustainLevel >= envelopeMaxLevel) {
    envelopeParams.decayIncrement = envelopeMaxLevel;
  } else {
    uint32_t difference = envelopeMaxLevel - envelopeParams.sustainLevel;
    envelopeParams.decayIncrement = std::max<uint32_t>(1, (difference + envelopeParams.decayTicks - 1) / envelopeParams.decayTicks);
  }

  uint32_t releaseMicros = envelopeTimeMicrosOptions[envelopeReleaseIndex];
  envelopeParams.releaseTicks = ticksFromMicros(releaseMicros);
}
/*
    This defines which hardware alarm
    and interrupt address are used
    to time the call of the poll() function.
  */
#define ALARM_NUM 2
#define ALARM_IRQ TIMER_IRQ_2
/*
    A basic EQ level can be stored to perform
    simple loudness adjustments at certain
    frequencies where human hearing is sensitive.

    By default it's off but you can change this
    flag to "true" to enable it. This may also
    be moved to a Advanced menu option.
  */
#define EQUAL_LOUDNESS_ADJUST true
/*
    This class defines a virtual oscillator.
    It stores an oscillation frequency in
    the form of an increment value, which is
    how much a counter would have to be increased
    every time the poll() interval is reached,
    such that a counter overflows from 0 to 65,535
    back to zero at some frequency per second.

    The value of the counter is useful for reading
    a waveform sample, so that an analog signal
    can be emulated by reading the sample at each
    poll() based on how far the counter has moved
    towards 65,536.
  */
class oscillator {
public:
  uint16_t increment = 0;
  uint16_t counter = 0;
  byte a = 127;
  byte b = 128;
  byte c = 255;
  uint16_t ab = 0;
  uint16_t cd = 0;
  byte eq = 0;
};
oscillator synth[POLYPHONY_LIMIT];  // maximum polyphony
std::queue<byte> synthChQueue;
const byte attenuation[] = { 64, 24, 17, 14, 12, 11, 10, 9, 8 };  // full volume in mono mode; equalized volume in poly.

byte arpeggiatingNow = UNUSED_NOTE;  // if this is 255, set to off (0% duty cycle)
uint64_t arpeggiateTime = 0;         // Used to keep track of when this note started playing in ARPEG mode
uint64_t arpeggiateLength = 62500;   // default: 1/32 note at 120 BPM

void updateArpeggiatorTiming() {
  uint32_t bpm = synthBPM;
  if (bpm == 0) {
    bpm = 1;
  }
  uint32_t division = arpeggiatorDivision;
  if (division == 0) {
    division = 1;
  }

  const uint64_t wholeNoteMicros = (240000000ULL + (bpm / 2)) / bpm;  // four quarter notes in microseconds
  arpeggiateLength = (wholeNoteMicros + (division / 2)) / division;
  if (arpeggiateLength == 0) {
    arpeggiateLength = 1;
  }
}

// RUN ON CORE 2
void RAM_FUNC(poll)() {
  hw_clear_bits(&timer_hw->intr, 1u << ALARM_NUM);
  timer_hw->alarm[ALARM_NUM] = readClock() + POLL_INTERVAL_IN_MICROSECONDS;
  uint64_t mix = 0;
  byte voices = 0;
  uint16_t p;
  byte t;
  byte level = 0;
  for (byte i = 0; i < POLYPHONY_LIMIT; i++) {
    EnvelopeState& env = envelopeStates[i];

    EnvelopeCommand pendingCommand = envelopeCommands[i].exchange(EnvelopeCommand::None, std::memory_order_acq_rel);
    switch (pendingCommand) {
      case EnvelopeCommand::StartAttack: {
        env.releaseIncrement = 0;
        envelopeNeedsFree[i].store(false, std::memory_order_relaxed);
        if (envelopeParams.attackTicks == 0) {
          env.level = envelopeMaxLevel;
          if (envelopeParams.decayTicks == 0 || envelopeParams.sustainLevel >= envelopeMaxLevel) {
            env.stage = EnvelopeStage::Sustain;
            env.level = envelopeParams.sustainLevel;
          } else {
            env.stage = EnvelopeStage::Decay;
          }
        } else {
          env.stage = EnvelopeStage::Attack;
          env.level = 0;
        }
        if (env.stage == EnvelopeStage::Decay && envelopeParams.decayTicks == 0) {
          env.stage = EnvelopeStage::Sustain;
          env.level = envelopeParams.sustainLevel;
        }
        if (env.stage == EnvelopeStage::Sustain) {
          env.level = envelopeParams.sustainLevel;
        }
        if (voiceGenerations[i].load(std::memory_order_relaxed) == 0) {
          voiceGenerations[i].store(nextVoiceGeneration.fetch_add(1, std::memory_order_relaxed), std::memory_order_relaxed);
        }
        break;
      }
      case EnvelopeCommand::StartRelease: {
        if (envelopeParams.releaseTicks == 0 || env.level == 0) {
          env.level = 0;
          env.stage = EnvelopeStage::Idle;
          synth[i].increment = 0;
          synth[i].counter = 0;
          envelopeNeedsFree[i].store(true, std::memory_order_relaxed);
        } else {
          env.stage = EnvelopeStage::Release;
          env.releaseIncrement = std::max<uint32_t>(1, (env.level + envelopeParams.releaseTicks - 1) / envelopeParams.releaseTicks);
        }
        break;
      }
      case EnvelopeCommand::Reset: {
        env = EnvelopeState{};
        synth[i].increment = 0;
        synth[i].counter = 0;
        channelInUse[i].store(false, std::memory_order_relaxed);
        envelopeNeedsFree[i].store(false, std::memory_order_relaxed);
        voiceGenerations[i].store(0, std::memory_order_relaxed);
        break;
      }
      case EnvelopeCommand::None:
      default:
        break;
    }

    if (!synth[i].increment && env.stage == EnvelopeStage::Idle) {
      continue;
    }

    switch (env.stage) {
      case EnvelopeStage::Attack: {
        uint32_t nextLevel = env.level + envelopeParams.attackIncrement;
        if (env.level >= envelopeMaxLevel || nextLevel >= envelopeMaxLevel) {
          env.level = envelopeMaxLevel;
          if (envelopeParams.decayTicks == 0 || envelopeParams.sustainLevel >= envelopeMaxLevel) {
            env.stage = EnvelopeStage::Sustain;
            env.level = envelopeParams.sustainLevel;
          } else {
            env.stage = EnvelopeStage::Decay;
          }
        } else {
          env.level = nextLevel;
        }
        break;
      }
      case EnvelopeStage::Decay:
        if (envelopeParams.decayTicks == 0 || envelopeParams.sustainLevel >= envelopeMaxLevel) {
          env.stage = EnvelopeStage::Sustain;
          env.level = envelopeParams.sustainLevel;
        } else if (env.level > envelopeParams.sustainLevel) {
          uint32_t nextLevel = (env.level > envelopeParams.decayIncrement) ? (env.level - envelopeParams.decayIncrement) : 0;
          if (nextLevel <= envelopeParams.sustainLevel) {
            env.level = envelopeParams.sustainLevel;
            env.stage = EnvelopeStage::Sustain;
          } else {
            env.level = nextLevel;
          }
        } else {
          env.level = envelopeParams.sustainLevel;
          env.stage = EnvelopeStage::Sustain;
        }
        break;
      case EnvelopeStage::Sustain:
        env.level = envelopeParams.sustainLevel;
        break;
      case EnvelopeStage::Release:
        if (envelopeParams.releaseTicks == 0 || env.releaseIncrement == 0 || env.level <= env.releaseIncrement) {
          env.level = 0;
          env.stage = EnvelopeStage::Idle;
          synth[i].increment = 0;
          synth[i].counter = 0;
          envelopeNeedsFree[i].store(true, std::memory_order_relaxed);
        } else {
          env.level -= env.releaseIncrement;
        }
        break;
      case EnvelopeStage::Idle:
      default:
        env.level = 0;
        synth[i].increment = 0;
        synth[i].counter = 0;
        continue;
    }

    if (env.stage == EnvelopeStage::Idle || env.level == 0 || !synth[i].increment) {
      if (env.stage == EnvelopeStage::Idle) {
        envelopeNeedsFree[i].store(true, std::memory_order_relaxed);
      }
      continue;
    }

    synth[i].counter += synth[i].increment;  // should loop from 65536 -> 0
    p = synth[i].counter;
    t = p >> 8;
    switch (currWave) {
      case WAVEFORM_SAW: break;
      case WAVEFORM_TRIANGLE: p = 2 * ((p >> 15) ? p : (65535 - p)); break;
      case WAVEFORM_SQUARE: p = 0 - (p > (32768 - modWheel.curValue * 7 * 16)); break;
      case WAVEFORM_HYBRID:
        if (t <= synth[i].a) {
          p = 0;
        } else if (t < synth[i].b) {
          p = (t - synth[i].a) * synth[i].ab;
        } else if (t <= synth[i].c) {
          p = 65535;
        } else {
          p = (256 - t) * synth[i].cd;
        }
        break;
      case WAVEFORM_SINE: p = sine[t] << 8; break;
      case WAVEFORM_STRINGS: p = strings[t] << 8; break;
      case WAVEFORM_CLARINET: p = clarinet[t] << 8; break;
      default: break;
    }

    uint64_t voiceSample = static_cast<uint64_t>(p) * synth[i].eq;
    voiceSample = (voiceSample * env.level) >> 16;
    mix += voiceSample;
    ++voices;
  }

  uint8_t attenuationIndex = (playbackMode == SYNTH_POLY) ? voices : 0;
  mix *= attenuation[attenuationIndex];
  mix *= velWheel.curValue;
  level = mix >> 24;
  if (audioD & AUDIO_PIEZO) pwm_set_chan_level(PIEZO_SLICE, PIEZO_CHNL, level);
  if (audioD & AUDIO_AJACK) pwm_set_chan_level(AJACK_SLICE, AJACK_CHNL, level);
}
// RUN ON CORE 1
byte isoTwoTwentySix(float f) {
  /*
      a very crude implementation of ISO 226
      equal loudness curves
        Hz dB  Amp ~ sqrt(10^(dB/10))
       200  0  8
       800 -3  6
      1500  0  8
      3250 -6  4
      5000  0  8
    */
  if ((f < 8.0) || (f > 12500.0)) {  // really crude low- and high-pass
    return 0;
  } else {
    if (EQUAL_LOUDNESS_ADJUST) {
      if ((f <= 200.0) || (f >= 5000.0)) {
        return 8;
      } else {
        if (f < 1500.0) {
          return 6 + 2 * (float)(abs(f - 800) / 700);
        } else {
          return 4 + 4 * (float)(abs(f - 3250) / 1750);
        }
      }
    } else {
      return 8;
    }
  }
}
inline void recomputePitchBendFactor() {
  pitchBendFactor = exp2(pbWheel.curValue * PITCH_BEND_SEMIS / 98304.0f);
}

void RAM_FUNC(setSynthFreq)(float frequency, byte channel) {
  if (channel == 0) {
    return;
  }
  byte c = channel - 1;
  float tunedFrequency = frequency;
  if ((useDynamicJustIntonation || useJustIntonationBPM) && c < POLYPHONY_LIMIT) {
    int16_t owner = synthChannelOwners[c].load(std::memory_order_relaxed);
    if (owner >= 0 && owner < BTN_COUNT) {
      tunedFrequency *= h[owner].jiFrequencyMultiplier;
    }
  }
  float f = tunedFrequency * pitchBendFactor;
  synth[c].counter = 0;
  synth[c].increment = round(f * POLL_INTERVAL_IN_MICROSECONDS * 0.065536);  // cycle 0-65535 at resultant frequency
  synth[c].eq = isoTwoTwentySix(f);
  if (currWave == WAVEFORM_HYBRID) {
    if (f < TRANSITION_SQUARE) {
      synth[c].b = 128;
    } else if (f < TRANSITION_SAW_LOW) {
      synth[c].b = (byte)(128 + 127 * (f - TRANSITION_SQUARE) / (TRANSITION_SAW_LOW - TRANSITION_SQUARE));
    } else if (f < TRANSITION_SAW_HIGH) {
      synth[c].b = 255;
    } else if (f < TRANSITION_TRIANGLE) {
      synth[c].b = (byte)(127 + 128 * (TRANSITION_TRIANGLE - f) / (TRANSITION_TRIANGLE - TRANSITION_SAW_HIGH));
    } else {
      synth[c].b = 127;
    }
    if (f < TRANSITION_SAW_LOW) {
      synth[c].a = 255 - synth[c].b;
      synth[c].c = 255;
    } else {
      synth[c].a = 0;
      synth[c].c = synth[c].b;
    }
    if (synth[c].a > 126) {
      synth[c].ab = 65535;
    } else {
      synth[c].ab = 65535 / (synth[c].b - synth[c].a - 1);
    }
    synth[c].cd = 65535 / (256 - synth[c].c);
  }
}

void RAM_FUNC(beginEnvelopeAttack)(uint8_t channel) {
  channelInUse[channel].store(true, std::memory_order_relaxed);
  envelopeNeedsFree[channel].store(false, std::memory_order_relaxed);
  releaseRetries[channel] = 0;
  releaseRetryCountdown[channel] = 0;
  envelopeCommands[channel].store(EnvelopeCommand::StartAttack, std::memory_order_release);
}

void RAM_FUNC(beginEnvelopeRelease)(uint8_t channel) {
  if (channel >= POLYPHONY_LIMIT) {
    return;
  }
  releaseRetries[channel] = releaseRetryLimit;
  releaseRetryCountdown[channel] = 0;
  envelopeCommands[channel].store(EnvelopeCommand::StartRelease, std::memory_order_release);
}

// USE THIS IN MONO OR ARPEG MODE ONLY

byte findNextHeldNote() {
  byte n = UNUSED_NOTE;
  for (byte i = 1; i <= BTN_COUNT; i++) {
    byte j = positiveMod(arpeggiatingNow + i, BTN_COUNT);
    if ((h[j].MIDIch) && (!h[j].isCmd)) {
      n = j;
      break;
    }
  }
  return n;
}
void replaceMonoSynthWith(byte x) {
  if (arpeggiatingNow == x) return;
  if (arpeggiatingNow != UNUSED_NOTE) {
    h[arpeggiatingNow].synthCh = 0;
  }
  arpeggiatingNow = x;
  if (arpeggiatingNow != UNUSED_NOTE) {
    h[arpeggiatingNow].synthCh = 1;
    synthChannelOwners[0].store(static_cast<int16_t>(arpeggiatingNow), std::memory_order_relaxed);
    voiceGenerations[0].store(nextVoiceGeneration.fetch_add(1, std::memory_order_relaxed), std::memory_order_relaxed);
    beginEnvelopeAttack(0);
    setSynthFreq(h[arpeggiatingNow].frequency, 1);
  } else {
    synthChannelOwners[0].store(NO_SYNTH_OWNER, std::memory_order_relaxed);
    beginEnvelopeRelease(0);
  }
}

void resetSynthFreqs() {
  while (!synthChQueue.empty()) {
    synthChQueue.pop();
  }
  nextVoiceGeneration.store(1, std::memory_order_relaxed);
  for (byte i = 0; i < POLYPHONY_LIMIT; i++) {
    synth[i].increment = 0;
    synth[i].counter = 0;
    envelopeCommands[i].store(EnvelopeCommand::Reset, std::memory_order_relaxed);
    channelInUse[i].store(false, std::memory_order_relaxed);
    envelopeNeedsFree[i].store(false, std::memory_order_relaxed);
    voiceGenerations[i].store(0, std::memory_order_relaxed);
    synthChannelOwners[i].store(NO_SYNTH_OWNER, std::memory_order_relaxed);
    releaseRetries[i] = 0;
    releaseRetryCountdown[i] = 0;
  }
  for (byte i = 0; i < BTN_COUNT; i++) {
    h[i].synthCh = 0;
  }
  if (playbackMode == SYNTH_POLY) {
    for (byte i = 0; i < POLYPHONY_LIMIT; i++) {
      synthChQueue.push(i + 1);
    }
  }
}
void sendProgramChange() {
  if (programChange == 0) {
    return;  // 0 indicates "no program" selected yet.
  }
  byte targetChannel = primaryMIDIChannel();
  withMIDI([&](auto& M) { M.sendProgramChange(programChange - 1, targetChannel); });
}

void updateSynthWithNewFreqs() {
  recomputePitchBendFactor();
  byte targetChannel = primaryMIDIChannel();
  withMIDI([&](auto& M) { M.sendPitchBend(pbWheel.curValue, targetChannel); });
  for (byte i = 0; i < BTN_COUNT; i++) {
    if (!(h[i].isCmd)) {
      if (h[i].synthCh) {
        setSynthFreq(h[i].frequency, h[i].synthCh);  // pass all notes thru synth again if the pitch bend changes
      }
    }
  }
}

void RAM_FUNC(processEnvelopeReleases)() {
  for (uint8_t i = 0; i < POLYPHONY_LIMIT; ++i) {
    if (envelopeNeedsFree[i].exchange(false, std::memory_order_relaxed)) {
      channelInUse[i].store(false, std::memory_order_relaxed);
      voiceGenerations[i].store(0, std::memory_order_relaxed);
      int16_t owner = synthChannelOwners[i].exchange(NO_SYNTH_OWNER, std::memory_order_relaxed);
      if (owner >= 0 && owner < BTN_COUNT) {
        if (h[owner].synthCh == static_cast<byte>(i + 1)) {
          h[owner].synthCh = 0;
        }
      }
      if (playbackMode == SYNTH_POLY) {
        synthChQueue.push(i + 1);
      }
      releaseRetries[i] = 0;
      releaseRetryCountdown[i] = 0;
    }
  }
}

void RAM_FUNC(retryPendingReleases)() {
  for (uint8_t i = 0; i < POLYPHONY_LIMIT; ++i) {
    uint8_t retries = releaseRetries[i];
    if (retries == 0) {
      continue;
    }
    if (!channelInUse[i].load(std::memory_order_relaxed)) {
      releaseRetries[i] = 0;
      releaseRetryCountdown[i] = 0;
      continue;
    }
    if (releaseRetryCountdown[i] > 0) {
      --releaseRetryCountdown[i];
      continue;
    }
    envelopeCommands[i].store(EnvelopeCommand::StartRelease, std::memory_order_release);
    releaseRetryCountdown[i] = releaseRetryDelayLoops;
    releaseRetries[i] = static_cast<uint8_t>(retries - 1);
  }
}

bool stealOldestSynthVoice(byte& channelOut, int16_t& previousOwner) {
  previousOwner = NO_SYNTH_OWNER;
  uint32_t oldestGeneration = std::numeric_limits<uint32_t>::max();
  int8_t oldestIndex = -1;
  for (uint8_t i = 0; i < POLYPHONY_LIMIT; ++i) {
    if (!channelInUse[i].load(std::memory_order_relaxed)) {
      continue;
    }
    if (synthChannelOwners[i].load(std::memory_order_relaxed) == NO_SYNTH_OWNER) {
      continue;
    }
    uint32_t generation = voiceGenerations[i].load(std::memory_order_relaxed);
    if (generation == 0) {
      continue;
    }
    if (generation < oldestGeneration) {
      oldestGeneration = generation;
      oldestIndex = static_cast<int8_t>(i);
    }
  }
  if (oldestIndex < 0) {
    return false;
  }
  previousOwner = synthChannelOwners[oldestIndex].load(std::memory_order_relaxed);
  channelOut = static_cast<byte>(oldestIndex + 1);
  return true;
}

void trySynthNoteOn(byte x) {
  if (playbackMode == SYNTH_OFF) {
    return;
  }
  if (playbackMode == SYNTH_POLY) {
    processEnvelopeReleases();
    if (synthChQueue.empty()) {
      byte stolenChannel = 0;
      int16_t previousOwner = NO_SYNTH_OWNER;
      if (!stealOldestSynthVoice(stolenChannel, previousOwner)) {
        sendToLog("synth channels all firing, so did not add one");
        return;
      }
      if (previousOwner >= 0 && previousOwner < BTN_COUNT) {
        if (h[previousOwner].synthCh == stolenChannel) {
          h[previousOwner].synthCh = 0;
        }
      }
      h[x].synthCh = stolenChannel;
      synthChannelOwners[stolenChannel - 1].store(static_cast<int16_t>(x), std::memory_order_relaxed);
      voiceGenerations[stolenChannel - 1].store(nextVoiceGeneration.fetch_add(1, std::memory_order_relaxed), std::memory_order_relaxed);
      beginEnvelopeAttack(stolenChannel - 1);
      setSynthFreq(h[x].frequency, stolenChannel);
      sendToLog("stole synth channel " + std::to_string(stolenChannel));
      return;
    }
    byte channel = synthChQueue.front();
    synthChQueue.pop();
    h[x].synthCh = channel;
    synthChannelOwners[channel - 1].store(static_cast<int16_t>(x), std::memory_order_relaxed);
    voiceGenerations[channel - 1].store(nextVoiceGeneration.fetch_add(1, std::memory_order_relaxed), std::memory_order_relaxed);
    beginEnvelopeAttack(channel - 1);
    setSynthFreq(h[x].frequency, channel);
    sendToLog("popped " + std::to_string(channel) + " off the synth queue");
  } else {
    if (h[x].MIDIch) {
      replaceMonoSynthWith(x);
    }
  }
}

void trySynthNoteOff(byte x) {
  if (playbackMode && (playbackMode != SYNTH_POLY)) {
    if (arpeggiatingNow == x) {
      replaceMonoSynthWith(findNextHeldNote());
    }
    return;
  }

  if (playbackMode != SYNTH_POLY) {
    return;
  }

  if (h[x].synthCh) {
    uint8_t channel = h[x].synthCh;
    h[x].synthCh = 0;
    beginEnvelopeRelease(channel - 1);
    return;
  }

  // Fallback: the direct channel assignment was already cleared (e.g., by a voice steal),
  // but the synth voice is still owned by this hex. Look it up by owner.
  for (uint8_t i = 0; i < POLYPHONY_LIMIT; ++i) {
    if (!channelInUse[i].load(std::memory_order_relaxed)) {
      continue;
    }
    if (synthChannelOwners[i].load(std::memory_order_relaxed) == static_cast<int16_t>(x)) {
      synthChannelOwners[i].store(NO_SYNTH_OWNER, std::memory_order_relaxed);
      beginEnvelopeRelease(i);
      break;
    }
  }
}

void panicStopOutput() {
  sendToLog("Panic: stopping all MIDI and synth output.");

  for (byte channel = 1; channel <= 16; ++channel) {
    withMIDI([&](auto& M) {
      M.sendControlChange(120, 0, channel);
      M.sendControlChange(123, 0, channel);
    });
  }

  for (byte i = 0; i < BTN_COUNT; ++i) {
    h[i].MIDIch = 0;
    h[i].synthCh = 0;
    h[i].externalNoteDepth = 0;
    h[i].timePressed = 0;
    h[i].animate = 0;
  }

  pressedKeyIDs.clear();
  arpeggiatingNow = UNUSED_NOTE;
  resetSynthFreqs();
  refreshMidiRouting();
  strip.clear();
  strip.show();
}


void setupSynth(byte pin, byte slice) {
  gpio_set_function(pin, GPIO_FUNC_PWM);          // set that pin as PWM
  pwm_set_phase_correct(slice, true);             // phase correct sounds better
  pwm_set_wrap(slice, 254);                       // 0 - 254 allows 0 - 255 level
  pwm_set_clkdiv(slice, 1.0f);                    // run at full clock speed
  pwm_set_chan_level(slice, PIEZO_CHNL, 0);       // initialize at zero to prevent whining sound
  pwm_set_enabled(slice, true);                   // ENGAGE!
  hw_set_bits(&timer_hw->inte, 1u << ALARM_NUM);  // initialize the timer
  irq_set_exclusive_handler(ALARM_IRQ, poll);     // function to run every interrupt
  irq_set_priority(ALARM_IRQ, 0x00);              // optional: raise priority
  resetSynthFreqs();
  timer_hw->alarm[ALARM_NUM] = readClock() + POLL_INTERVAL_IN_MICROSECONDS;
  irq_set_enabled(ALARM_IRQ, true);               // ENGAGE!
  sendToLog("synth is ready.");
}

void arpeggiate() {
  if (playbackMode == SYNTH_ARPEGGIO) {
    if (runTime - arpeggiateTime > arpeggiateLength) {
      arpeggiateTime = runTime;
      replaceMonoSynthWith(findNextHeldNote());
    }
  }
}

// @animate
/*
    This section of the code handles
    LED animation responsive to key
    presses
  */
/*
    The coordinate system used to locate hex buttons
    a certain distance and direction away relies on
    a preset array of coordinate offsets corresponding
    to each of the six linear directions on the hex grid.
    These cardinal directions are enumerated to make
    the code more legible for humans.
  */
#define HEX_DIRECTION_EAST 0
#define HEX_DIRECTION_NE 1
#define HEX_DIRECTION_NW 2
#define HEX_DIRECTION_WEST 3
#define HEX_DIRECTION_SW 4
#define HEX_DIRECTION_SE 5
// animation variables  E NE NW  W SW SE
int8_t vertical[] = { 0, -1, -1, 0, 1, 1 };
int8_t horizontal[] = { 2, 1, -1, -2, -1, 1 };

uint64_t animFrame(byte x) {
  if (h[x].timePressed) {  // 2^20 microseconds is close enough to 1 second
    return 1 + (((runTime - h[x].timePressed) * animationFPS) >> 20);
  } else {
    return 0;
  }
}
void flagToAnimate(int8_t r, int8_t c) {
  if (!((r < 0) || (r >= ROWCOUNT)
        || (c < 0) || (c >= (2 * COLCOUNT))
        || ((c + r) & 1))) {
    h[(10 * r) + (c / 2)].animate = 1;
  }
}
void animateMirror() {
  for (byte i = 0; i < LED_COUNT; i++) {                     // check every hex
    if ((!(h[i].isCmd)) && (h[i].MIDIch)) {                  // that is a held note
      for (byte j = 0; j < LED_COUNT; j++) {                 // compare to every hex
        if ((!(h[j].isCmd)) && (!(h[j].MIDIch))) {           // that is a note not being played
          int16_t temp = h[i].stepsFromC - h[j].stepsFromC;  // look at difference between notes
          if (animationType == ANIMATE_OCTAVE) {             // set octave diff to zero if need be
            temp = positiveMod(temp, current.tuning().cycleLength);
          }
          if (temp == 0) {  // highlight if diff is zero
            h[j].animate = 1;
          }
        }
      }
    }
  }
}
/*
  void animateOrbit() {
    for (byte i = 0; i < LED_COUNT; i++) {                               // check every hex
      if ((!(h[i].isCmd)) && (h[i].MIDIch) && ((h[i].inScale) || (!scaleLock))) {    // that is a held note
        byte tempDir = (animFrame(i) % 6);
        flagToAnimate(h[i].coordRow + vertical[tempDir], h[i].coordCol + horizontal[tempDir]);       // different neighbor each frame
      }
    }
  }
*/
void animateOrbit() {           //BETTER ORBIT
  const byte ORBIT_RADIUS = 2;  // Radius of the orbit
  const byte SLOW_FACTOR = 1;   // Slowdown factor for animation

  for (byte i = 0; i < LED_COUNT; i++) {     // Check every hex
    if ((!(h[i].isCmd)) && (h[i].MIDIch) &&  // That is a held note
        ((h[i].inScale) || (!scaleLock))) {  // And is in scale or scale is unlocked

      byte frame = animFrame(i) / SLOW_FACTOR;  // Slow down the animation
      byte currentStep = frame % 12;            // Determine position in the 12-light orbit

      // Determine row and column adjustments for the 12 possible directions
      int8_t rowOffsets[12];
      int8_t colOffsets[12];

      // Fill offsets for the 6 primary directions
      for (byte dir = 0; dir < 6; dir++) {
        rowOffsets[dir * 2] = ORBIT_RADIUS * vertical[dir];
        colOffsets[dir * 2] = ORBIT_RADIUS * horizontal[dir];

        // Fill the intermediate (diagonal) positions
        rowOffsets[dir * 2 + 1] = ORBIT_RADIUS * (vertical[dir] + vertical[(dir + 1) % 6]) / 2;
        colOffsets[dir * 2 + 1] = ORBIT_RADIUS * (horizontal[dir] + horizontal[(dir + 1) % 6]) / 2;
      }

      // Calculate light positions
      int8_t light1Row = h[i].coordRow + rowOffsets[currentStep];
      int8_t light1Col = h[i].coordCol + colOffsets[currentStep];

      byte oppositeStep = (currentStep + 6) % 12;  // Opposite position in the 12-light ring
      int8_t light2Row = h[i].coordRow + rowOffsets[oppositeStep];
      int8_t light2Col = h[i].coordCol + colOffsets[oppositeStep];

      // Flag both lights for animation
      flagToAnimate(light1Row, light1Col);
      flagToAnimate(light2Row, light2Col);
    }
  }
}

void animateStaticBeams() {
  const byte MAX_BEAM_LENGTH = 13;                 // Maximum distance the beam can travel
  static byte lastDirection[LED_COUNT] = { 255 };  // Track the last direction for each button (255 = uninitialized)

  for (byte i = 0; i < LED_COUNT; i++) {  // Check every hex
    // Skip buttons that are not in the playable area
    if (h[i].isCmd || (!h[i].inScale && scaleLock)) {
      continue;
    }

    if (h[i].btnState == BTN_STATE_NEWPRESS) {  // Button was just pressed
      uint64_t clockValue = readClock();        // Get system clock

      // Choose a new random direction, excluding the last one
      byte newDirection;
      do {
        newDirection = clockValue % 3;             // Randomly pick 0, 1, or 2
        clockValue /= 3;                           // Update clockValue for a new seed
      } while (newDirection == lastDirection[i]);  // Exclude last direction

      lastDirection[i] = newDirection;  // Store new direction
    }

    if (h[i].btnState == BTN_STATE_HELD || h[i].btnState == BTN_STATE_NEWPRESS) {  // Active button
      byte baseDirection = lastDirection[i] * 2;                                   // Convert to hex direction (0, 2, or 4)
      byte oppositeDirection = (baseDirection + 3) % 6;                            // Opposite direction

      // Light up the entire beam in both directions
      for (byte length = 1; length <= MAX_BEAM_LENGTH; length++) {
        // Beam in primary direction
        int8_t beam1Row = h[i].coordRow + (length * vertical[baseDirection]);
        int8_t beam1Col = h[i].coordCol + (length * horizontal[baseDirection]);

        // Beam in opposite direction
        int8_t beam2Row = h[i].coordRow + (length * vertical[oppositeDirection]);
        int8_t beam2Col = h[i].coordCol + (length * horizontal[oppositeDirection]);

        // Flag both beams for animation
        flagToAnimate(beam1Row, beam1Col);
        flagToAnimate(beam2Row, beam2Col);
      }
    }
  }
}

void animateRadial() {
  for (byte i = 0; i < LED_COUNT; i++) {                  // check every hex
    if (!(h[i].isCmd) && (h[i].inScale || !scaleLock)) {  // that is a note
      uint64_t radius = animFrame(i);
      if ((radius > 0) && (radius < 16)) {                              // played in the last 16 frames
        byte steps = ((animationType == ANIMATE_SPLASH) ? radius : 1);  // star = 1 step to next corner; ring = 1 step per hex
        int8_t turtleRow = h[i].coordRow + (radius * vertical[HEX_DIRECTION_SW]);
        int8_t turtleCol = h[i].coordCol + (radius * horizontal[HEX_DIRECTION_SW]);
        for (byte dir = HEX_DIRECTION_EAST; dir < 6; dir++) {  // walk along the ring in each of the 6 hex directions
          for (byte i = 0; i < steps; i++) {                   // # of steps to the next corner
            flagToAnimate(turtleRow, turtleCol);               // flag for animation
            turtleRow += (vertical[dir] * (radius / steps));
            turtleCol += (horizontal[dir] * (radius / steps));
          }
        }
      }
    }
  }
}

void animateRadialReverse() {  //inverted splash/star
#define MAX_RADIUS 5
  for (byte i = 0; i < LED_COUNT; i++) {                                               // Check every hex
    if (!(h[i].isCmd) && (h[i].inScale || !scaleLock)) {                               // That is a note
      uint64_t frame = animFrame(i);                                                   // Current animation frame
      if ((frame > 0) && (frame < MAX_RADIUS)) {                                       // Played in the last X frames
        uint8_t reverseRadius = MAX_RADIUS - frame;                                    // Calculate reverse radius
        byte steps = ((animationType == ANIMATE_SPLASH_REVERSE) ? reverseRadius : 1);  // Steps depend on animation type
        int8_t turtleRow = h[i].coordRow + (reverseRadius * vertical[HEX_DIRECTION_SW]);
        int8_t turtleCol = h[i].coordCol + (reverseRadius * horizontal[HEX_DIRECTION_SW]);
        for (byte dir = HEX_DIRECTION_EAST; dir < 6; dir++) {  // Walk along the ring in 6 hex directions
          for (byte j = 0; j < steps; j++) {                   // Steps to the next corner
            flagToAnimate(turtleRow, turtleCol);               // Flag for animation
            turtleRow += (vertical[dir] * (reverseRadius / steps));
            turtleCol += (horizontal[dir] * (reverseRadius / steps));
          }
        }
      }
    }
  }
}

void applyExternalMidiToHex(byte midiNote, bool noteOn) {
  if (midiNote >= midiNoteToHexIndices.size()) {
    return;
  }
  auto& targets = midiNoteToHexIndices[midiNote];
  for (uint8_t index : targets) {
    buttonDef& hex = h[index];
    if (noteOn) {
      if (hex.externalNoteDepth < 255) {
        hex.externalNoteDepth++;
      }
    } else if (hex.externalNoteDepth > 0) {
      hex.externalNoteDepth--;
    }
  }
}

void processIncomingMIDI() {
  withMIDI([&](auto& M) {
    while (M.read()) {
      const auto type = M.getType();
      const byte n    = M.getData1();  // note
      const byte v    = M.getData2();  // velocity

      if (type == MIDI_NAMESPACE::NoteOn) {
        // treat NoteOn vel==0 as NoteOff
        applyExternalMidiToHex(n, v != 0);
      } else if (type == MIDI_NAMESPACE::NoteOff
                 || (type == MIDI_NAMESPACE::NoteOn && v == 0)) {
        applyExternalMidiToHex(n, false);
      }
    }
  });
}

void animateLEDs() {
  for (byte i = 0; i < LED_COUNT; i++) {
    h[i].animate = 0;
  }
    switch (animationType) {
    case ANIMATE_BUTTON:
    case ANIMATE_NONE:
      break;
      case ANIMATE_STAR:
      case ANIMATE_SPLASH:
        animateRadial();
        break;
      case ANIMATE_ORBIT:
        animateOrbit();
        break;
      case ANIMATE_OCTAVE:
      case ANIMATE_BY_NOTE:
        animateMirror();
        break;
      case ANIMATE_BEAMS:
        animateStaticBeams();
        break;
      case ANIMATE_SPLASH_REVERSE:
      case ANIMATE_STAR_REVERSE:
        animateRadialReverse();
        break;
      case ANIMATE_MIDI_IN:
        for (byte i = 0; i < LED_COUNT; i++) {
          if (h[i].externalNoteDepth > 0) {
            h[i].animate = 1;
          }
        }
        break;
      default:
        break;
  }
}

// @assignment
/*
    This section of the code contains broad
    procedures for assigning musical notes
    and related values to each button
    of the hex grid.
  */
// run this if the layout, key, or transposition changes, but not if color or scale changes
void assignPitches() {
  sendToLog("assignPitch was called:");
  for (auto& bucket : midiNoteToHexIndices) {
    bucket.clear();
  }
  int32_t lowestMidiIndex = std::numeric_limits<int32_t>::max();
  for (byte i = 0; i < LED_COUNT; i++) {
    if (!(h[i].isCmd)) {
      // steps is the distance from C
      // the stepsToMIDI function needs distance from A4
      // it also needs to reflect any transposition, but
      // NOT the key of the scale.
      int32_t relativeSteps = current.pitchRelToA4(h[i].stepsFromC);
      int32_t midiIndex = relativeSteps + 69;
      h[i].midiNoteIndex = midiIndex;
      if (standardMidiMicrotonalActive && midiIndex < lowestMidiIndex) {
        lowestMidiIndex = midiIndex;
      }
    }
  }

  if (standardMidiMicrotonalActive && lowestMidiIndex != std::numeric_limits<int32_t>::max()) {
    int32_t offset = midiChannelOffset(lowestMidiIndex);
    int32_t baseIndex = positiveMod(static_cast<int>(defaultMidiChannel - 1 - offset), 16);
    standardMidiBaseChannel = static_cast<byte>(baseIndex + 1);
  } else {
    standardMidiBaseChannel = defaultMidiChannel;
  }

  for (byte i = 0; i < LED_COUNT; i++) {
    if (!(h[i].isCmd)) {
      int32_t relativeSteps = current.pitchRelToA4(h[i].stepsFromC);
      float N = stepsToMIDI(static_cast<int16_t>(relativeSteps));
      float targetFrequency = MIDItoFreq(N);
      if (standardMidiMicrotonalActive) {
        byte mappedNote = 0;
        byte mappedChannel = 0;
        mapExtendedMidiNote(h[i].midiNoteIndex, standardMidiBaseChannel, mappedNote, mappedChannel);
        h[i].note = mappedNote;
        h[i].bend = 0;
        h[i].frequency = targetFrequency;
        h[i].mappedMidiChannel = mappedChannel;
      } else {
        h[i].mappedMidiChannel = 0;
        if (N < 0 || N >= 128) {
          h[i].note = UNUSED_NOTE;
          h[i].bend = 0;
          h[i].frequency = 0.0;
        } else {
          h[i].note = ((N >= 127) ? 127 : round(N));
          h[i].bend = (ldexp(N - h[i].note, 13) / MPEpitchBendSemis);
          h[i].frequency = targetFrequency;
        }
      }
      h[i].jiRetune = 0;
      h[i].jiFrequencyMultiplier = 1.0f;
      if (h[i].note < 128) {
        midiNoteToHexIndices[h[i].note].push_back(i);
      }
      h[i].externalNoteDepth = 0;
      sendToLog(
        "hex #" + std::to_string(i) + ", " + "steps=" + std::to_string(h[i].stepsFromC) + ", " + "isCmd? " + std::to_string(h[i].isCmd) + ", " + "note=" + std::to_string(h[i].note) + ", " + "bend=" + std::to_string(h[i].bend) + ", " + "freq=" + std::to_string(h[i].frequency) + ", " + "inScale? " + std::to_string(h[i].inScale) + ".");
    }
  }
  sendToLog("assignPitches complete.");
}

void refreshMidiRouting() {
  resetTuningMIDI();
  assignPitches();
}

void applyScale() {
  sendToLog("applyScale was called:");
  for (byte i = 0; i < LED_COUNT; i++) {
    if (!(h[i].isCmd)) {
      if (current.scale().tuning == ALL_TUNINGS) {
        h[i].inScale = 1;
      } else {
        byte degree = current.keyDegree(h[i].stepsFromC);
        if (degree == 0) {
          h[i].inScale = 1;  // the root is always in the scale
        } else {
          byte tempSum = 0;
          byte iterator = 0;
          while (degree > tempSum) {
            tempSum += current.scale().pattern[iterator];
            iterator++;
          }                                    // add the steps in the scale, and you're in scale
          h[i].inScale = (tempSum == degree);  // if the note lands on one of those sums
        }
      }
      sendToLog(
        "hex #" + std::to_string(i) + ", " + "steps=" + std::to_string(h[i].stepsFromC) + ", " + "isCmd? " + std::to_string(h[i].isCmd) + ", " + "note=" + std::to_string(h[i].note) + ", " + "inScale? " + std::to_string(h[i].inScale) + ".");
    }
  }
  setLEDcolorCodes();
  sendToLog("applyScale complete.");
}
void applyLayout() {  // call this function when the layout changes
  sendToLog("buildLayout was called:");
  ///////////////////////////////////////////////////////////////////////////////////////
  int8_t acrossSteps = current.layout().acrossSteps;  // x
  int8_t dnLeftSteps = current.layout().dnLeftSteps;  // y
  if (mirrorUpDown) {
    dnLeftSteps = -(acrossSteps + dnLeftSteps);  // y = -(x + y)
  }
  if (mirrorLeftRight) {
    dnLeftSteps = acrossSteps + dnLeftSteps;  // y = x + y
    acrossSteps = -acrossSteps;               // x = -x
  }
  for (byte rotations = 0; rotations < layoutRotation; rotations++) {
    byte keyOffsetY = dnLeftSteps;
    byte keyOffsetX = acrossSteps;
    dnLeftSteps = keyOffsetX + keyOffsetY;
    keyOffsetY = dnLeftSteps;
    dnLeftSteps = -acrossSteps;
    acrossSteps = keyOffsetY;
  }
  ////////////////////////////////////////////////////////////////////////////////////////
  for (byte i = 0; i < LED_COUNT; i++) {
    if (!(h[i].isCmd)) {
      int8_t distCol = h[i].coordCol - h[current.layout().hexMiddleC].coordCol;
      int8_t distRow = h[i].coordRow - h[current.layout().hexMiddleC].coordRow;
      h[i].stepsFromC = ((distCol * acrossSteps) + (distRow * (acrossSteps + (2 * dnLeftSteps)))) / 2;
      sendToLog(
        "hex #" + std::to_string(i) + ", " + "steps from C4=" + std::to_string(h[i].stepsFromC) + ".");
    }
  }
  applyScale();     // when layout changes, have to re-apply scale and re-apply LEDs
  assignPitches();  // same with pitches
  sendToLog("buildLayout complete.");
}
void cmdOn(byte x) {  // volume and mod wheel read all current buttons
  switch (h[x].note) {
    case CMDB + 3:
      toggleWheel = !toggleWheel;
      break;
    case HARDWARE_V1_2:
      Hardware_Version = h[x].note;
      setupHardware();
      break;
    default:
      // the rest should all be taken care of within the wheelDef structure
      break;
  }
}
void cmdOff(byte x) {  // pitch bend wheel only if buttons held.
  switch (h[x].note) {
    default:
      break;  // nothing; should all be taken care of within the wheelDef structure
  }
}

// --------------------------------------------------------
// Settings File Header Definition
// --------------------------------------------------------
struct SettingsHeader {
  char magic[3];           // e.g., "STG"
  uint8_t version;         // settings file version
  uint8_t defaultProfileIndex;
};

constexpr uint8_t CURRENT_SETTINGS_VERSION = 1;
constexpr uint8_t PROFILE_COUNT = 9;
constexpr uint8_t DEFAULT_PROFILE_INDEX = 0;

// ==================================================
// Settings Definitions
// ==================================================
// There are 4 steps to make a new setting work properly.
// I will document each SETTINGS STEP as below to make it easy to find.
// SETTINGS STEP 1 - Define each setting by name.
enum class SettingKey : uint8_t {
  Debug,
  RotaryInvert,
  AutoSave,
  MPEpitchBend,
  MPEMode,
  ExtraMPE,
  MPELowestChannel,
  MPEHighestChannel,
  MPELowPriority,
  DefaultMIDIChannel,
  CC74Value,
  CurrentTuning,
  CurrentLayout,
  CurrentScale,
  CurrentKeyStepsFromA,
  CurrentTransposeSteps,
  LayoutRotation,
  MirrorLeftRight,
  MirrorUpDown,
  ScaleLock,
  PaletteCenterOnKey,
  WheelAltMode,
  PBSticky,
  ModSticky,
  PBWheelSpeed,
  ModWheelSpeed,
  VelWheelSpeed,
  PlaybackMode,
  Waveform,
  AudioDestination,
  ArpeggiatorDivision,
  SynthBPM,
  ColorMode,
  RestLedBrightness,
  DimLedBrightness,
  GlobalBrightness,
  AnimationType,
  ProgramChange,
  JustIntonationBPMSync,
  BeatBPM,
  BPMMultiplier,
  DynamicJI,
  EnvelopeAttackIndex,
  EnvelopeDecayIndex,
  EnvelopeSustainLevel,
  EnvelopeReleaseIndex,
  // This must remain last – it gives the total number of settings.
  NumSettings
};

// Use a constexpr to get the total number of settings.
constexpr uint8_t NUM_SETTINGS = static_cast<uint8_t>(SettingKey::NumSettings);

// ==================================================
// Global Settings Array and Factory Defaults
// ==================================================

uint8_t settingsProfiles[PROFILE_COUNT][NUM_SETTINGS] = { { 0 } };
uint8_t* settings = settingsProfiles[DEFAULT_PROFILE_INDEX];
uint8_t activeProfileIndex = DEFAULT_PROFILE_INDEX;
uint8_t defaultProfileIndex = DEFAULT_PROFILE_INDEX;
extern bool settingsDirty;
void syncSettingsToRuntime();

// SETTINGS STEP 2 - Define factory defaults (in the same order as the enum).
// Adjust values below to match your desired defaults.
const uint8_t factoryDefaults[NUM_SETTINGS] = {
  /* Debug                        */ 0,
  /* Invert rotary encoder        */ 0,
  /* Auto save settings           */ 1,
  /* MPE pitch bend semitones     */ 48,
  /* MPE Mode                     */ MPE_MODE_AUTO,
  /* Extra MPE Messages           */ 0,
  /* MPE Lowest Channel           */ 2,
  /* MPE Highest Channel          */ 16,
  /* MPE Low Priority Mode        */ 0,
  /* Default MIDI Channel         */ 1,
  /* CC74 value                   */ 0,
  /* CurrentTuning                */ TUNING_12EDO,
  /* CurrentLayout                */ 0,
  /* CurrentScale                 */ 0,
  /* CurrentKeyStepsFromA         */ 119,   // -9 + 128
  /* CurrentTransposeSteps        */ 128,   // 0 + 128
  /* LayoutRotation               */ 0,
  /* MirrorLeftRight              */ 0,
  /* MirrorUpDown                 */ 0,
  /* ScaleLock                    */ 0,
  /* PaletteCenterOnKey           */ 1,
  /* WheelAltMode                 */ 0,
  /* PBSticky                     */ 0,
  /* ModSticky                    */ 0,
  /* PBWheelSpeed (2^N)           */ 10,    // 2^10 == 1024
  /* ModWheelSpeed                */ 8,
  /* VelWheelSpeed                */ 8,
  /* PlaybackMode                 */ SYNTH_OFF,
  /* Waveform                     */ WAVEFORM_HYBRID,
  /* AudioDestination             */ AUDIO_BOTH,
  /* ArpeggiatorDivision          */ 32,
  /* SynthBPM                     */ 120,
  /* ColorMode                    */ RAINBOW_MODE,
  /* Rest LED Brightness          */ 255,
  /* Dim LED Brightness           */ 255,
  /* GlobalBrightness             */ BRIGHT_DIM,
  /* AnimationType                */ ANIMATE_BUTTON,
  /* ProgramChange                */ 0,
  /* JustIntonationBPMSync        */ 0,
  /* BeatBPM                      */ 60,
  /* BPMMultiplier                */ 1,
  /* DynamicJI                    */ 0,
  /* EnvelopeAttackIndex          */ 2,
  /* EnvelopeDecayIndex           */ 3,
  /* EnvelopeSustainLevel         */ 127,
  /* EnvelopeReleaseIndex         */ 3,
};

// ==================================================
// File System Handling: LittleFS Setup
// ==================================================
#include "LittleFS.h"  // code to use a portion of the 16MB flash chip space as a file system

bool fileSystemExists = false;

void setupFileSystem() {
  Serial.begin(115200);
  LittleFSConfig cfg;
  cfg.setAutoFormat(true);  // Format automatically if LittleFS cannot be mounted.
  LittleFS.setConfig(cfg);
  fileSystemExists = LittleFS.begin();
  if (!fileSystemExists) {
    sendToLog("Error: Unable to mount LittleFS.");
  } else {
    sendToLog("LittleFS mounted successfully.");
  }
}

// --------------------------------------------------------
// Persistent Settings Functions: Save, Load, Restore
// --------------------------------------------------------
void applyFactoryDefaultsToSettings() {
  defaultProfileIndex = DEFAULT_PROFILE_INDEX;  // profile 1 is the canonical boot target
  for (uint8_t profile = 0; profile < PROFILE_COUNT; ++profile) {
    memcpy(settingsProfiles[profile], factoryDefaults, NUM_SETTINGS);
    if (Hardware_Version == HARDWARE_V1_2) {
      settingsProfiles[profile][static_cast<uint8_t>(SettingKey::RotaryInvert)] = 1;
    }
  }
  activeProfileIndex = defaultProfileIndex;
  settings = settingsProfiles[activeProfileIndex];
  settingsDirty = false;
}

bool load_settings() {
  if (!fileSystemExists) {
    sendToLog("File system not available. Using factory defaults.");
    applyFactoryDefaultsToSettings();
    return false;
  }
  File f = LittleFS.open("/settings.dat", "r");
  if (!f) {
    sendToLog("Settings file not found. Creating new file with factory defaults.");
    applyFactoryDefaultsToSettings();
    save_settings();
    return true;
  }
  SettingsHeader header;
  if (f.readBytes((char*)&header, sizeof(SettingsHeader)) != sizeof(SettingsHeader)) {
    sendToLog("Error: Failed to read settings header.");
    f.close();
    applyFactoryDefaultsToSettings();
    save_settings();
    return false;
  }
  if (strncmp(header.magic, "STG", 3) != 0) {
    sendToLog("Invalid settings file (magic mismatch). Restoring defaults.");
    f.close();
    applyFactoryDefaultsToSettings();
    save_settings();
    return false;
  }
  if (header.version != CURRENT_SETTINGS_VERSION) {
    sendToLog("Settings version mismatch. File version: " + std::to_string(header.version) + "; Expected version: " + std::to_string(CURRENT_SETTINGS_VERSION));
    f.close();
    applyFactoryDefaultsToSettings();
    save_settings();
    return false;
  }
  // Always boot from profile 1 even if an older file recorded a different default.
  defaultProfileIndex = DEFAULT_PROFILE_INDEX;
  size_t expectedSize = static_cast<size_t>(PROFILE_COUNT) * NUM_SETTINGS;
  size_t bytesRead = f.read((uint8_t*)settingsProfiles, expectedSize);
  f.close();
  if (bytesRead != expectedSize) {
    sendToLog("Warning: Settings data incomplete. Restoring defaults.");
    applyFactoryDefaultsToSettings();
    save_settings();
    return false;
  }
  activeProfileIndex = defaultProfileIndex;
  settings = settingsProfiles[activeProfileIndex];
  settingsDirty = false;
  sendToLog("Settings loaded successfully.");
  return true;
}

void save_settings() {
  if (!fileSystemExists) {
    sendToLog("File system not available.");
    return;
  }
  File f = LittleFS.open("/settings.dat", "w");
  if (!f) {
    sendToLog("Error: Unable to open /settings.dat for writing.");
    return;
  }
  SettingsHeader header;
  header.magic[0] = 'S'; header.magic[1] = 'T'; header.magic[2] = 'G';
  header.version = CURRENT_SETTINGS_VERSION;
  header.defaultProfileIndex = defaultProfileIndex;
  f.write(reinterpret_cast<uint8_t*>(&header), sizeof(SettingsHeader));
  f.write(reinterpret_cast<uint8_t*>(settingsProfiles), static_cast<size_t>(PROFILE_COUNT) * NUM_SETTINGS);
  f.close();
  sendToLog("Settings saved.");
}

// Restore all settings to the factory defaults.
void restore_default_settings() {
  applyFactoryDefaultsToSettings();
  sendToLog("Default settings restored.");
  save_settings();
}

// --------------------------------------------------------
// Auto-Save Debouncing Implementation
// --------------------------------------------------------
// When a menu item changes a setting, mark the settings as "dirty" and record the time.
// In the main loop, check if a change has occurred and if enough time (debounceDelay)
// has passed before calling save_settings().

bool settingsDirty = false;
unsigned long lastSettingsChangeTime = 0;
constexpr unsigned long debounceDelay = 10000;  // 10 second delay

void markSettingsDirty() {
  settingsDirty = true;
  lastSettingsChangeTime = millis();
}

bool autoSave = (settings[static_cast<uint8_t>(SettingKey::AutoSave)] !=0);
// Call this in your main loop to autosave if changes have stabilized.
void checkAndAutoSave() {
  if (!autoSave) {
    return;
  }
  if (!settingsDirty || (millis() - lastSettingsChangeTime <= debounceDelay)) {
    return;
  }
  // Auto-save always snapshots the current settings into profile 1 before writing to disk.
  copyCurrentSettingsToProfile(DEFAULT_PROFILE_INDEX);
    save_settings();
    settingsDirty = false;
}

void copyCurrentSettingsToProfile(uint8_t profileIndex) {
  if (profileIndex >= PROFILE_COUNT) {
    return;
  }
  // When profileIndex matches the active profile we are already editing its backing array.
  if (profileIndex != activeProfileIndex) {
    memcpy(settingsProfiles[profileIndex], settings, NUM_SETTINGS);
  }
}

void saveProfileToSlot(uint8_t profileIndex) {
  if (profileIndex >= PROFILE_COUNT) {
    return;
  }
  copyCurrentSettingsToProfile(profileIndex);
  save_settings();
  if (profileIndex == activeProfileIndex) {
    settingsDirty = false;
  }
  sendToLog("Saved profile " + std::to_string(profileIndex + 1));
}

void setActiveProfile(uint8_t profileIndex) {
  if (profileIndex >= PROFILE_COUNT) {
    return;
  }
  if (profileIndex == activeProfileIndex) {
    settingsDirty = false;
    return;
  }
  // Switching profiles swaps the backing array that the runtime reads from.
  activeProfileIndex = profileIndex;
  settings = settingsProfiles[activeProfileIndex];
  settingsDirty = false;
  syncSettingsToRuntime();
  sendToLog("Loaded profile " + std::to_string(profileIndex + 1));
}

// @menu
/*
    This section of the code handles the
    dot matrix screen and, most importantly,
    the menu system display and controls.

    The following library is used: documentation
    is also available here.
      https://github.com/Spirik/GEM
  */
#define GEM_DISABLE_GLCD  // this line is needed to get the B&W display to work
/*
    The GEM menu library accepts initialization
    values to set the width of various components
    of the menu display, as below.
  */
#define MENU_ITEM_HEIGHT 10
#define MENU_PAGE_SCREEN_TOP_OFFSET 10
#define MENU_VALUES_LEFT_OFFSET 78
#define CONTRAST_AWAKE 63
#define CONTRAST_SCREENSAVER 1
// Create an instance of the U8g2 graphics library.
U8G2_SH1107_SEEED_128X128_F_HW_I2C u8g2(U8G2_R2, /* reset=*/U8X8_PIN_NONE);
// Create menu object of class GEM_u8g2. Supply its constructor with reference to u8g2 object we created earlier
GEM_u8g2 menu(
  u8g2, GEM_POINTER_ROW, GEM_ITEMS_COUNT_AUTO,
  MENU_ITEM_HEIGHT, MENU_PAGE_SCREEN_TOP_OFFSET, MENU_VALUES_LEFT_OFFSET);
bool screenSaverOn = 0;
bool audioMenuItemInserted = false;
uint64_t screenTime = 0;                         // GFX timer to count if screensaver should go on
const uint64_t screenSaverTimeout = (1u << 25);  // 2^25 microseconds ~ 33 seconds
/*
    Create menu page object of class GEMPage.
    Menu page holds menu items (GEMItem) and represents menu level.
    Menu can have multiple menu pages (linked to each other) with multiple menu items each.

    GEMPage constructor creates each page with the associated label.
    GEMItem constructor can create many different sorts of menu items.
    The items here are navigation links.
    The first parameter is the item label.
    The second parameter is the destination page when that item is selected.
  */
GEMPage menuPageMain("HexBoard MIDI Controller");
GEMPage menuPageTuning("Tuning", menuPageMain);
GEMItem menuGotoTuning("Tuning", menuPageTuning);
GEMPage menuPageLayout("Layout", menuPageMain);
GEMItem menuGotoLayout("Layout", menuPageLayout);
GEMPage menuPageScales("Scales", menuPageMain);
GEMItem menuGotoScales("Scales", menuPageScales);
GEMPage menuPageColors("Color Options", menuPageMain);
GEMItem menuGotoColors("Color Options", menuPageColors);
GEMPage menuPageSynth("Synth Options", menuPageMain);
GEMItem menuGotoSynth("Synth Options", menuPageSynth);
GEMPage menuPageMIDI("MIDI Options", menuPageMain);
GEMItem menuGotoMIDI("MIDI Options", menuPageMIDI);
GEMPage menuPageControl("Control Wheel", menuPageMain);
GEMItem menuGotoControl("Control Wheel", menuPageControl);
GEMPage menuPageAdvanced("Advanced", menuPageMain);
GEMItem menuGotoAdvanced("Advanced", menuPageAdvanced);
GEMPage menuPageSave("Save Profiles", menuPageMain);
GEMItem menuGotoSave("Save", menuPageSave);
GEMPage menuPageLoad("Load Profiles", menuPageMain);
GEMItem menuGotoLoad("Load", menuPageLoad);
GEMPage menuPageReboot("Ready to flash firmware!");

// --------------------------------------------------------
// Helper: Persistent Callback Info
// --------------------------------------------------------
// This helper struct is used to pass both the persistent setting's index
// and the pointer to the variable that is updated via the menu.
using PersistentValueReader = uint8_t (*)(void*);

struct PersistentCallbackInfo {
  uint8_t settingIndex;           // Corresponds to an index in the settings[] array
  void* variablePtr;              // Pointer to the runtime variable (e.g. a bool, byte, etc.)
  PersistentValueReader reader;   // Optional encoder to convert the runtime value to a byte for storage
  void (*postChange)();           // Optional hook invoked after the value is saved
};

// Helper encoders for settings that need translation before being stored.
uint8_t encodePbWheelSpeed(void* variablePtr) {
  int value = *reinterpret_cast<int*>(variablePtr);
  if (value <= 0) {
    return 10;  // Default to 2^10 (1024) if something unexpected happens.
  }
  uint8_t exponent = 0;
  while (value > 1) {
    value >>= 1;
    ++exponent;
  }
  if (exponent < 7) {
    exponent = 7;  // The minimum selectable PB speed is 2^7 (128).
  }
  return exponent;
}

uint8_t encodeMPELowestChannel(void* /*variablePtr*/) {
  clampMPEChannelRange();
  return mpeLowestChannel;
}

uint8_t encodeMPEHighestChannel(void* /*variablePtr*/) {
  clampMPEChannelRange();
  return mpeHighestChannel;
}


// --------------------------------------------------------
// Universal Callback for Persistent Menu Items
// --------------------------------------------------------
// This callback uses GEMCallbackData provided by the GEM library.
// (Do not redefine GEMCallbackData here.)
void universalSaveCallback(GEMCallbackData callbackData) {
  // Retrieve our persistent callback information from the callback union.
  // We stored a pointer to our PersistentCallbackInfo struct in valPointer.
  PersistentCallbackInfo* info = reinterpret_cast<PersistentCallbackInfo*>(callbackData.valPointer);

  // Read the new value from the linked variable.
  // Default behaviour assumes the value fits in a byte; a custom reader can override this.
  uint8_t newValue = info->reader ? info->reader(info->variablePtr)
                                  : *(reinterpret_cast<uint8_t*>(info->variablePtr));

  // Update the persistent settings array.
  settings[info->settingIndex] = newValue;
  sendToLog("Universal callback: Setting " + std::to_string(info->settingIndex) + " updated to " + std::to_string(newValue));

  // Mark the settings as dirty so auto-save occurs.
  markSettingsDirty();

  // Run any post-change hook tied to this setting.
  if (info->postChange) {
    info->postChange();
  }
}
/*
    We haven't written the code for some procedures,
    but the menu item needs to know the address
    of procedures it has to run when it's selected.
    So we forward-declare a placeholder for the
    procedure like this, so that the menu item
    can be built, and then later we will define
    this procedure in full.
  */
void changeTranspose();
void rebootToBootloader();
/*
    These GEMItems are read-only display items.
    They do not change any variable or run any procedure.
  */
GEMItem menuItemVersion("Firmware 1.2.0+q1");
SelectOptionByte optionByteHardware[] = {
  { "V1.1", HARDWARE_UNKNOWN }, { "V1.1", HARDWARE_V1_1 }, { "V1.2", HARDWARE_V1_2 }
};
GEMSelect selectHardware(sizeof(optionByteHardware) / sizeof(SelectOptionByte), optionByteHardware);
GEMItem menuItemHardware("Hardware", Hardware_Version, selectHardware, GEM_READONLY);
/*
    These GEMItems runs a given procedure when you select them.
    We must declare or define that procedure first.
  */
GEMItem menuItemUSBBootloader("Update Firmware", rebootToBootloader);

void syncSettingsToRuntime();
extern bool settingsDirty;

void resetDefaultsMenuCallback() {
  applyFactoryDefaultsToSettings();
  save_settings();
  syncSettingsToRuntime();
  settingsDirty = false;
  sendToLog("Factory defaults loaded from menu.");
}

GEMItem menuItemResetDefaults("Reset Defaults", resetDefaultsMenuCallback);

void saveProfileMenu(GEMCallbackData callbackData) {
  saveProfileToSlot(callbackData.valByte);
}

void loadProfileMenu(GEMCallbackData callbackData) {
  setActiveProfile(callbackData.valByte);
  menuHome();
}

/*
    Tunings, layouts, scales, and keys are defined
    earlier in this code. We should not have to
    manually type in menu objects for those
    pre-loaded values. Instead, we will use routines to
    construct menu items automatically.

    These lines are forward declarations for
    the menu objects we will make later.
    This allocates space in memory with
    enough size to procedurally fill
    the objects based on the contents of
    the pre-loaded tuning/layout/etc. definitions
    we defined above.
  */
GEMItem* menuItemTuning[TUNINGCOUNT];
GEMItem* menuItemLayout[layoutCount];
GEMItem* menuItemScales[scaleCount];
GEMSelect* selectKey[TUNINGCOUNT];
GEMItem* menuItemKeys[TUNINGCOUNT];
GEMItem* menuItemSaveProfile[PROFILE_COUNT];
GEMItem* menuItemLoadProfile[PROFILE_COUNT];
char saveProfileLabels[PROFILE_COUNT][24];
char loadProfileLabels[PROFILE_COUNT][24];
/*
    We are now creating some GEMItems that let you
    1) select a value from a list of options,
    2) update a given variable based on what was chosen,
    3) if necessary, run a procedure as well once the value's chosen.

    The list of options is in the form of a 2-d array.
    There are A arrays, one for each option.
    Each is 2 entries long. First entry is the label
    for that choice, second entry is the value associated.

    These arrays go into a typedef that depends on the type of the variable
    being selected (i.e. Byte for small positive integers; Int for
    sign-dependent and large integers).

    Then that typeDef goes into a GEMSelect object, with parameters
    equal to the number of entries in the array, and the storage size of one element
    in the array. The GEMSelect object is basically just a pointer to the
    array of choices. The GEMItem then takes the GEMSelect pointer as a parameter.

    The fact that GEM expects pointers and references makes it tricky
    to work with if you are new to C++.
  */
// SETTINGS STEP 4 - Now add the menu item starting with a callback as below.
PersistentCallbackInfo callbackInfoMPE = {
  static_cast<uint8_t>(SettingKey::MPEpitchBend),
  reinterpret_cast<void*>(&MPEpitchBendSemis),
  nullptr,
  assignPitches
};
SelectOptionByte optionByteMPEpitchBend[] = { { "   1", 1 }, { "   2", 2 }, { "   12", 12 }, { "   24", 24 }, { "   48", 48 }, { "   96", 96 } };
GEMSelect selectMPEpitchBend(sizeof(optionByteMPEpitchBend) / sizeof(SelectOptionByte), optionByteMPEpitchBend);
GEMItem menuItemMPEpitchBend("MPE Bend", MPEpitchBendSemis, selectMPEpitchBend, universalSaveCallback,
                             reinterpret_cast<void*>(&callbackInfoMPE));

SelectOptionByte optionByteYesOrNo[] = { { "No", 0 }, { "Yes", 1 } };
GEMSelect selectYesOrNo(sizeof(optionByteYesOrNo) / sizeof(SelectOptionByte), optionByteYesOrNo);
PersistentCallbackInfo callbackInfoScaleLock = {
  static_cast<uint8_t>(SettingKey::ScaleLock),
  reinterpret_cast<void*>(&scaleLock),
  nullptr,
  nullptr
};
GEMItem menuItemScaleLock("Scale Lock", scaleLock, universalSaveCallback, reinterpret_cast<void*>(&callbackInfoScaleLock));

PersistentCallbackInfo callbackInfoShiftColor = {
  static_cast<uint8_t>(SettingKey::PaletteCenterOnKey),
  reinterpret_cast<void*>(&paletteBeginsAtKeyCenter),
  nullptr,
  setLEDcolorCodes
};
GEMItem menuItemShiftColor("ColorByKey", paletteBeginsAtKeyCenter, universalSaveCallback, reinterpret_cast<void*>(&callbackInfoShiftColor));

PersistentCallbackInfo callbackInfoWheelAlt = {
  static_cast<uint8_t>(SettingKey::WheelAltMode),
  reinterpret_cast<void*>(&wheelMode),
  nullptr,
  nullptr
};
GEMItem menuItemWheelAlt("Alt Wheel?", wheelMode, selectYesOrNo, universalSaveCallback,
                         reinterpret_cast<void*>(&callbackInfoWheelAlt));

// Create a PersistentCallbackInfo instance for this setting.
PersistentCallbackInfo callbackInfoAutoSave = {
  static_cast<uint8_t>(SettingKey::AutoSave),
  reinterpret_cast<void*>(&autoSave),
  nullptr,
  nullptr
};
// (The GEMItem constructor here accepts a linked value, callback, and our callback info.)
GEMItem menuItemAutoSave("Auto-Save", autoSave, universalSaveCallback, reinterpret_cast<void*>(&callbackInfoAutoSave));

// For "Invert Encoder" which is a bool tick box.
// We want to store its value persistently in the RotaryInvert setting.
// Create a global variable that reflects its current state.
bool rotaryInvert = (settings[static_cast<uint8_t>(SettingKey::RotaryInvert)] != 0);
// Create a PersistentCallbackInfo instance for this setting.
PersistentCallbackInfo callbackInfoRotary = {
  static_cast<uint8_t>(SettingKey::RotaryInvert),
  reinterpret_cast<void*>(&rotaryInvert),
  nullptr,
  nullptr
};
GEMItem menuItemRotary("Invert Encoder", rotaryInvert, universalSaveCallback, reinterpret_cast<void*>(&callbackInfoRotary));

PersistentCallbackInfo callbackInfoDebug = {
  static_cast<uint8_t>(SettingKey::Debug),
  reinterpret_cast<void*>(&debugMessages),
  nullptr,
  nullptr
};
GEMItem menuItemDebug("Serial Debug", debugMessages, universalSaveCallback, reinterpret_cast<void*>(&callbackInfoDebug));



SelectOptionByte optionByteWheelType[] = { { "Springy", 0 }, { "Sticky", 1 } };
GEMSelect selectWheelType(sizeof(optionByteWheelType) / sizeof(SelectOptionByte), optionByteWheelType);
PersistentCallbackInfo callbackInfoPBSticky = {
  static_cast<uint8_t>(SettingKey::PBSticky),
  reinterpret_cast<void*>(&pbSticky),
  nullptr,
  nullptr
};
GEMItem menuItemPBBehave("Pitch Bend", pbSticky, selectWheelType, universalSaveCallback,
                         reinterpret_cast<void*>(&callbackInfoPBSticky));

PersistentCallbackInfo callbackInfoModSticky = {
  static_cast<uint8_t>(SettingKey::ModSticky),
  reinterpret_cast<void*>(&modSticky),
  nullptr,
  nullptr
};
GEMItem menuItemModBehave("Mod Wheel", modSticky, selectWheelType, universalSaveCallback,
                          reinterpret_cast<void*>(&callbackInfoModSticky));

SelectOptionByte optionBytePlayback[] = { { "Off", SYNTH_OFF }, { "Mono", SYNTH_MONO }, { "Arp'gio", SYNTH_ARPEGGIO }, { "Poly", SYNTH_POLY } };
GEMSelect selectPlayback(sizeof(optionBytePlayback) / sizeof(SelectOptionByte), optionBytePlayback);
PersistentCallbackInfo callbackInfoPlayback = {
  static_cast<uint8_t>(SettingKey::PlaybackMode),
  reinterpret_cast<void*>(&playbackMode),
  nullptr,
  resetSynthFreqs
};
GEMItem menuItemPlayback("Synth Mode", playbackMode, selectPlayback, universalSaveCallback,
                         reinterpret_cast<void*>(&callbackInfoPlayback));

// Hardware V1.2-only
SelectOptionByte optionByteAudioD[] = {
  { "Buzzer", AUDIO_PIEZO }, { "Jack", AUDIO_AJACK }, { "Both", AUDIO_BOTH }
};
GEMSelect selectAudioD(sizeof(optionByteAudioD) / sizeof(SelectOptionByte), optionByteAudioD);
PersistentCallbackInfo callbackInfoAudioDest = {
  static_cast<uint8_t>(SettingKey::AudioDestination),
  reinterpret_cast<void*>(&audioD),
  nullptr,
  nullptr
};
GEMItem menuItemAudioD("SynthOutput", audioD, selectAudioD, universalSaveCallback,
                       reinterpret_cast<void*>(&callbackInfoAudioDest));

////////////////////////////////////////////////////////////////

const GEMSpinnerBoundariesByte spinnerBoundariesBPM = { 1, 255, 1 };
GEMSpinner spinnerJustIntonationBPM(spinnerBoundariesBPM, GEM_LOOP);
GEMSpinner spinnerSynthBPM(spinnerBoundariesBPM, GEM_LOOP);
GEMSpinner spinnerBPM_MultiplierOfJI(spinnerBoundariesBPM, GEM_LOOP);

///////////////////////////////////////////////////////////////////

// Roland MT-32 mode (1987)
SelectOptionByte optionByteRolandMT32[] = {
  // Blank
  { "None", 0 },
  // Piano
  { "APiano1", 1 },
  { "APiano2", 2 },
  { "APiano3", 3 },
  { "EPiano1", 4 },
  { "EPiano2", 5 },
  { "EPiano3", 6 },
  { "EPiano4", 7 },
  { "HonkyTonk", 8 },
  // Organ
  { "EOrgan1", 9 },
  { "EOrgan2", 10 },
  { "EOrgan3", 11 },
  { "EOrgan4", 12 },
  { "POrgan2", 13 },
  { "POrgan3", 14 },
  { "POrgan4", 15 },
  { "Accordion", 16 },
  // Keybrd
  { "Harpsi1", 17 },
  { "Harpsi2", 18 },
  { "Harpsi3", 19 },
  { "Clavi 1", 20 },
  { "Clavi 2", 21 },
  { "Clavi 3", 22 },
  { "Celesta", 23 },
  { "Celest2", 24 },
  // S Brass
  { "SBrass1", 25 },
  { "SBrass2", 26 },
  { "SBrass3", 27 },
  { "SBrass4", 28 },
  // SynBass
  { "SynBass", 29 },
  { "SynBas2", 30 },
  { "SynBas3", 31 },
  { "SynBas4", 32 },
  // Synth 1
  { "Fantasy", 33 },
  { "HarmoPan", 34 },
  { "Chorale", 35 },
  { "Glasses", 36 },
  { "Soundtrack", 37 },
  { "Atmosphere", 38 },
  { "WarmBell", 39 },
  { "FunnyVox", 40 },
  // Synth 2
  { "EchoBell", 41 },
  { "IceRain", 42 },
  { "Oboe2K1", 43 },
  { "EchoPan", 44 },
  { "Dr.Solo", 45 },
  { "SchoolDaze", 46 },
  { "BellSinger", 47 },
  { "SquareWave", 48 },
  // Strings
  { "StrSec1", 49 },
  { "StrSec2", 50 },
  { "StrSec3", 51 },
  { "Pizzicato", 52 },
  { "Violin1", 53 },
  { "Violin2", 54 },
  { "Cello 1", 55 },
  { "Cello 2", 56 },
  { "ContraBass", 57 },
  { "Harp  1", 58 },
  { "Harp  2", 59 },
  // Guitar
  { "Guitar1", 60 },
  { "Guitar2", 61 },
  { "EGuitr1", 62 },
  { "EGuitr2", 63 },
  { "Sitar", 64 },
  // Bass
  { "ABass 1", 65 },
  { "ABass 2", 66 },
  { "EBass 1", 67 },
  { "EBass 2", 68 },
  { "SlapBass", 69 },
  { "SlapBa2", 70 },
  { "Fretless", 71 },
  { "Fretle2", 72 },
  // Wind
  { "Flute 1", 73 },
  { "Flute 2", 74 },
  { "Piccolo", 75 },
  { "Piccol2", 76 },
  { "Recorder", 77 },
  { "PanPipes", 78 },
  { "Sax   1", 79 },
  { "Sax   2", 80 },
  { "Sax   3", 81 },
  { "Sax   4", 82 },
  { "Clarinet", 83 },
  { "Clarin2", 84 },
  { "Oboe", 85 },
  { "EnglHorn", 86 },
  { "Bassoon", 87 },
  { "Harmonica", 88 },
  // Brass
  { "Trumpet", 89 },
  { "Trumpe2", 90 },
  { "Trombone", 91 },
  { "Trombo2", 92 },
  { "FrHorn1", 93 },
  { "FrHorn2", 94 },
  { "Tuba", 95 },
  { "BrsSect", 96 },
  { "BrsSec2", 97 },
  // Mallet
  { "Vibe  1", 98 },
  { "Vibe  2", 99 },
  { "SynMallet", 100 },
  { "WindBell", 101 },
  { "Glock", 102 },
  { "TubeBell", 103 },
  { "XyloPhone", 104 },
  { "Marimba", 105 },
  // Special
  { "Koto", 106 },
  { "Sho", 107 },
  { "Shakuhachi", 108 },
  { "Whistle", 109 },
  { "Whistl2", 110 },
  { "BottleBlow", 111 },
  { "BreathPipe", 112 },
  // Percussion
  { "Timpani", 113 },
  { "MelTom", 114 },
  { "DeepSnare", 115 },
  { "ElPerc1", 116 },
  { "ElPerc2", 117 },
  { "Taiko", 118 },
  { "TaikoRim", 119 },
  { "Cymbal", 120 },
  { "Castanets", 121 },
  { "Triangle", 122 },
  // Effects
  { "OrchHit", 123 },
  { "Telephone", 124 },
  { "BirdTweet", 125 },
  { "1NoteJam", 126 },
  { "WaterBells", 127 },
  { "JungleTune", 128 },
};
GEMSelect selectRolandMT32(sizeof(optionByteRolandMT32) / sizeof(SelectOptionByte), optionByteRolandMT32);
PersistentCallbackInfo callbackInfoProgramChange = {
  static_cast<uint8_t>(SettingKey::ProgramChange),
  reinterpret_cast<void*>(&programChange),
  nullptr,
  sendProgramChange
};
GEMItem menuItemRolandMT32("RolandMT32", programChange, selectRolandMT32, universalSaveCallback,
                           reinterpret_cast<void*>(&callbackInfoProgramChange));

// General MIDI 1
SelectOptionByte optionByteGeneralMidi[] = {
  // Blank
  { "None", 0 },
  // Piano
  { "Piano 1", 1 },
  { "Piano 2", 2 },
  { "Piano 3", 3 },
  { "HonkyTonk", 4 },
  { "EPiano1", 5 },
  { "EPiano2", 6 },
  { "HarpsiChord", 7 },
  { "Clavinet", 8 },
  // Chromatic Percussion
  { "Celesta", 9 },
  { "Glockenspiel", 10 },
  { "MusicBox", 11 },
  { "Vibraphone", 12 },
  { "Marimba", 13 },
  { "Xylophone", 14 },
  { "TubeBells", 15 },
  { "Dulcimer", 16 },
  // Organ
  { "Organ 1", 17 },
  { "Organ 2", 18 },
  { "Organ 3", 19 },
  { "ChurchOrgan", 20 },
  { "ReedOrgan", 21 },
  { "Accordion", 22 },
  { "Harmonica", 23 },
  { "Bandoneon", 24 },
  // Guitar
  { "AGtrNylon", 25 },
  { "AGtrSteel", 26 },
  { "EGtrJazz", 27 },
  { "EGtrClean", 28 },
  { "EGtrMuted", 29 },
  { "EGtrOverdrive", 30 },
  { "EGtrDistortion", 31 },
  { "EGtrHarmonics", 32 },
  // Bass
  { "ABass", 33 },
  { "EBasFinger", 34 },
  { "EBasPicked", 35 },
  { "EBasFretless", 36 },
  { "SlpBass1", 37 },
  { "SlpBas2", 38 },
  { "SynBas1", 39 },
  { "SynBas2", 40 },
  // Strings
  { "Violin", 41 },
  { "Viola", 42 },
  { "Cello", 43 },
  { "ContraBass", 44 },
  { "TremoloStrings", 45 },
  { "PizzicatoStrings", 46 },
  { "OrchHarp", 47 },
  { "Timpani", 48 },
  // Ensemble
  { "StrEns1", 49 },
  { "StrEns2", 50 },
  { "SynStr1", 51 },
  { "SynStr2", 52 },
  { "ChoirAahs", 53 },
  { "VoiceOohs", 54 },
  { "SynVoice", 55 },
  { "OrchHit", 56 },
  // Brass
  { "Trumpet", 57 },
  { "Trombone", 58 },
  { "Tuba", 59 },
  { "MutedTrumpet", 60 },
  { "FrenchHorn", 61 },
  { "BrassSection", 62 },
  { "SynBrs1", 63 },
  { "SynBrs2", 64 },
  // Reed
  { "Sop Sax", 65 },
  { "AltoSax", 66 },
  { "Ten Sax", 67 },
  { "BariSax", 68 },
  { "Oboe", 69 },
  { "EnglHorn", 70 },
  { "Bassoon", 71 },
  { "Clarinet", 72 },
  // Pipe
  { "Piccolo", 73 },
  { "Flute", 74 },
  { "Recorder", 75 },
  { "PanFlute", 76 },
  { "BlownBottle", 77 },
  { "Shakuhachi", 78 },
  { "Whistle", 79 },
  { "Ocarina", 80 },
  // Synth Lead
  { "Ld1Square", 81 },
  { "Ld2Sawtooth", 82 },
  { "Ld3Calliope", 83 },
  { "Ld4Chiff", 84 },
  { "Ld5Charang", 85 },
  { "Ld6Voice", 86 },
  { "Ld7Fifths", 87 },
  { "Ld8Bass&Lead", 88 },
  // Synth Pad
  { "Pd1NewAge", 89 },
  { "Pd2Warm", 90 },
  { "Pd3Polysynth", 91 },
  { "Pd4Choir", 92 },
  { "Pd5BowedGlass", 93 },
  { "Pd6Metallic", 94 },
  { "Pd7Halo", 95 },
  { "Pd8Sweep", 96 },
  // Synth Effects
  { "FX1Rain", 97 },
  { "FX2Soundtrack", 98 },
  { "FX3Crystal", 99 },
  { "FX4Atmosphere", 100 },
  { "FX5Bright", 101 },
  { "FX6Goblins", 102 },
  { "FX7Echoes", 103 },
  { "FX8SciFi)", 104 },
  // Ethnic
  { "Sitar", 105 },
  { "Banjo", 106 },
  { "Shamisen", 107 },
  { "Koto", 108 },
  { "Kalimba", 109 },
  { "BagPipe", 110 },
  { "Fiddle", 111 },
  { "Shanai", 112 },
  // Percussive
  { "TinkleBell", 113 },
  { "Cowbell", 114 },
  { "SteelDrums", 115 },
  { "WoodBlock", 116 },
  { "TaikoDrum", 117 },
  { "MeloTom", 118 },
  { "SynDrum", 119 },
  { "RevCymbal", 120 },
  // Sound Effects
  { "GtrFretNoise", 121 },
  { "BreathNoise", 122 },
  { "Seashore", 123 },
  { "BirdTweet", 124 },
  { "TelephoneRing", 125 },
  { "Helicopter", 126 },
  { "Applause", 127 },
  { "Gunshot", 128 },
};
GEMSelect selectGeneralMidi(sizeof(optionByteGeneralMidi) / sizeof(SelectOptionByte), optionByteGeneralMidi);
GEMItem menuItemGeneralMidi("GeneralMidi", programChange, selectGeneralMidi, universalSaveCallback,
                            reinterpret_cast<void*>(&callbackInfoProgramChange));


// doing this long-hand because the STRUCT has problems accepting string conversions of numbers for some reason
SelectOptionInt optionIntTransposeSteps[] = {
  { "-127", -127 }, { "-126", -126 }, { "-125", -125 }, { "-124", -124 }, { "-123", -123 }, { "-122", -122 }, { "-121", -121 }, { "-120", -120 }, { "-119", -119 }, { "-118", -118 }, { "-117", -117 }, { "-116", -116 }, { "-115", -115 }, { "-114", -114 }, { "-113", -113 }, { "-112", -112 }, { "-111", -111 }, { "-110", -110 }, { "-109", -109 }, { "-108", -108 }, { "-107", -107 }, { "-106", -106 }, { "-105", -105 }, { "-104", -104 }, { "-103", -103 }, { "-102", -102 }, { "-101", -101 }, { "-100", -100 }, { "- 99", -99 }, { "- 98", -98 }, { "- 97", -97 }, { "- 96", -96 }, { "- 95", -95 }, { "- 94", -94 }, { "- 93", -93 }, { "- 92", -92 }, { "- 91", -91 }, { "- 90", -90 }, { "- 89", -89 }, { "- 88", -88 }, { "- 87", -87 }, { "- 86", -86 }, { "- 85", -85 }, { "- 84", -84 }, { "- 83", -83 }, { "- 82", -82 }, { "- 81", -81 }, { "- 80", -80 }, { "- 79", -79 }, { "- 78", -78 }, { "- 77", -77 }, { "- 76", -76 }, { "- 75", -75 }, { "- 74", -74 }, { "- 73", -73 }, { "- 72", -72 }, { "- 71", -71 }, { "- 70", -70 }, { "- 69", -69 }, { "- 68", -68 }, { "- 67", -67 }, { "- 66", -66 }, { "- 65", -65 }, { "- 64", -64 }, { "- 63", -63 }, { "- 62", -62 }, { "- 61", -61 }, { "- 60", -60 }, { "- 59", -59 }, { "- 58", -58 }, { "- 57", -57 }, { "- 56", -56 }, { "- 55", -55 }, { "- 54", -54 }, { "- 53", -53 }, { "- 52", -52 }, { "- 51", -51 }, { "- 50", -50 }, { "- 49", -49 }, { "- 48", -48 }, { "- 47", -47 }, { "- 46", -46 }, { "- 45", -45 }, { "- 44", -44 }, { "- 43", -43 }, { "- 42", -42 }, { "- 41", -41 }, { "- 40", -40 }, { "- 39", -39 }, { "- 38", -38 }, { "- 37", -37 }, { "- 36", -36 }, { "- 35", -35 }, { "- 34", -34 }, { "- 33", -33 }, { "- 32", -32 }, { "- 31", -31 }, { "- 30", -30 }, { "- 29", -29 }, { "- 28", -28 }, { "- 27", -27 }, { "- 26", -26 }, { "- 25", -25 }, { "- 24", -24 }, { "- 23", -23 }, { "- 22", -22 }, { "- 21", -21 }, { "- 20", -20 }, { "- 19", -19 }, { "- 18", -18 }, { "- 17", -17 }, { "- 16", -16 }, { "- 15", -15 }, { "- 14", -14 }, { "- 13", -13 }, { "- 12", -12 }, { "- 11", -11 }, { "- 10", -10 }, { "-  9", -9 }, { "-  8", -8 }, { "-  7", -7 }, { "-  6", -6 }, { "-  5", -5 }, { "-  4", -4 }, { "-  3", -3 }, { "-  2", -2 }, { "-  1", -1 }, { "+/-0", 0 }, { "+  1", 1 }, { "+  2", 2 }, { "+  3", 3 }, { "+  4", 4 }, { "+  5", 5 }, { "+  6", 6 }, { "+  7", 7 }, { "+  8", 8 }, { "+  9", 9 }, { "+ 10", 10 }, { "+ 11", 11 }, { "+ 12", 12 }, { "+ 13", 13 }, { "+ 14", 14 }, { "+ 15", 15 }, { "+ 16", 16 }, { "+ 17", 17 }, { "+ 18", 18 }, { "+ 19", 19 }, { "+ 20", 20 }, { "+ 21", 21 }, { "+ 22", 22 }, { "+ 23", 23 }, { "+ 24", 24 }, { "+ 25", 25 }, { "+ 26", 26 }, { "+ 27", 27 }, { "+ 28", 28 }, { "+ 29", 29 }, { "+ 30", 30 }, { "+ 31", 31 }, { "+ 32", 32 }, { "+ 33", 33 }, { "+ 34", 34 }, { "+ 35", 35 }, { "+ 36", 36 }, { "+ 37", 37 }, { "+ 38", 38 }, { "+ 39", 39 }, { "+ 40", 40 }, { "+ 41", 41 }, { "+ 42", 42 }, { "+ 43", 43 }, { "+ 44", 44 }, { "+ 45", 45 }, { "+ 46", 46 }, { "+ 47", 47 }, { "+ 48", 48 }, { "+ 49", 49 }, { "+ 50", 50 }, { "+ 51", 51 }, { "+ 52", 52 }, { "+ 53", 53 }, { "+ 54", 54 }, { "+ 55", 55 }, { "+ 56", 56 }, { "+ 57", 57 }, { "+ 58", 58 }, { "+ 59", 59 }, { "+ 60", 60 }, { "+ 61", 61 }, { "+ 62", 62 }, { "+ 63", 63 }, { "+ 64", 64 }, { "+ 65", 65 }, { "+ 66", 66 }, { "+ 67", 67 }, { "+ 68", 68 }, { "+ 69", 69 }, { "+ 70", 70 }, { "+ 71", 71 }, { "+ 72", 72 }, { "+ 73", 73 }, { "+ 74", 74 }, { "+ 75", 75 }, { "+ 76", 76 }, { "+ 77", 77 }, { "+ 78", 78 }, { "+ 79", 79 }, { "+ 80", 80 }, { "+ 81", 81 }, { "+ 82", 82 }, { "+ 83", 83 }, { "+ 84", 84 }, { "+ 85", 85 }, { "+ 86", 86 }, { "+ 87", 87 }, { "+ 88", 88 }, { "+ 89", 89 }, { "+ 90", 90 }, { "+ 91", 91 }, { "+ 92", 92 }, { "+ 93", 93 }, { "+ 94", 94 }, { "+ 95", 95 }, { "+ 96", 96 }, { "+ 97", 97 }, { "+ 98", 98 }, { "+ 99", 99 }, { "+100", 100 }, { "+101", 101 }, { "+102", 102 }, { "+103", 103 }, { "+104", 104 }, { "+105", 105 }, { "+106", 106 }, { "+107", 107 }, { "+108", 108 }, { "+109", 109 }, { "+110", 110 }, { "+111", 111 }, { "+112", 112 }, { "+113", 113 }, { "+114", 114 }, { "+115", 115 }, { "+116", 116 }, { "+117", 117 }, { "+118", 118 }, { "+119", 119 }, { "+120", 120 }, { "+121", 121 }, { "+122", 122 }, { "+123", 123 }, { "+124", 124 }, { "+125", 125 }, { "+126", 126 }, { "+127", 127 }
};
GEMSelect selectTransposeSteps(255, optionIntTransposeSteps);
GEMItem menuItemTransposeSteps("Transpose", transposeSteps, selectTransposeSteps, changeTranspose);

//////////////////////////////////////////////////////////////////////////////////////////////////////
// MIDI Channel selection
SelectOptionByte optionByteMIDIChannel[] = { { "   1", 1 }, { "   2", 2 }, { "   3", 3 }, { "   4", 4 }, { "   5", 5 }, { "   6", 6 }, { "   7", 7 }, { "   8", 8 }, { "   9", 9 }, { "   10", 10 }, { "   11", 11 }, { "   12", 12 }, { "   13", 13 }, { "   14", 14 }, { "   15", 15 }, { "   16", 16 } };
GEMSelect selectMIDIchannel(16, optionByteMIDIChannel);
PersistentCallbackInfo callbackInfoDefaultMIDIChannel = {
  static_cast<uint8_t>(SettingKey::DefaultMIDIChannel),
  reinterpret_cast<void*>(&defaultMidiChannel),
  nullptr,
  refreshMidiRouting
};
GEMItem menuItemSelectMIDIChannel("MIDI Channel", defaultMidiChannel, selectMIDIchannel, universalSaveCallback,
                                  reinterpret_cast<void*>(&callbackInfoDefaultMIDIChannel));

SelectOptionByte optionByteMPELowChannel[] = {
  { "   2", 2 }, { "   3", 3 }, { "   4", 4 }, { "   5", 5 }, { "   6", 6 },
  { "   7", 7 }, { "   8", 8 }, { "   9", 9 }, { "   10", 10 }, { "   11", 11 },
  { "   12", 12 }, { "   13", 13 }, { "   14", 14 }, { "   15", 15 }, { "   16", 16 }
};
GEMSelect selectMPELowChannel(sizeof(optionByteMPELowChannel) / sizeof(SelectOptionByte), optionByteMPELowChannel);
PersistentCallbackInfo callbackInfoMPELowChannel = {
  static_cast<uint8_t>(SettingKey::MPELowestChannel),
  reinterpret_cast<void*>(&mpeLowestChannel),
  encodeMPELowestChannel,
  resetTuningMIDI
};
GEMItem menuItemSelectMPELowChannel("MPE Low Ch", mpeLowestChannel, selectMPELowChannel, universalSaveCallback,
                                    reinterpret_cast<void*>(&callbackInfoMPELowChannel));

SelectOptionByte optionByteMPEHighChannel[] = {
  { "   2", 2 }, { "   3", 3 }, { "   4", 4 }, { "   5", 5 }, { "   6", 6 },
  { "   7", 7 }, { "   8", 8 }, { "   9", 9 }, { "   10", 10 }, { "   11", 11 },
  { "   12", 12 }, { "   13", 13 }, { "   14", 14 }, { "   15", 15 }, { "   16", 16 }
};
GEMSelect selectMPEHighChannel(sizeof(optionByteMPEHighChannel) / sizeof(SelectOptionByte), optionByteMPEHighChannel);
PersistentCallbackInfo callbackInfoMPEHighChannel = {
  static_cast<uint8_t>(SettingKey::MPEHighestChannel),
  reinterpret_cast<void*>(&mpeHighestChannel),
  encodeMPEHighestChannel,
  resetTuningMIDI
};
GEMItem menuItemSelectMPEHighChannel("MPE High Ch", mpeHighestChannel, selectMPEHighChannel, universalSaveCallback,
                                     reinterpret_cast<void*>(&callbackInfoMPEHighChannel));

PersistentCallbackInfo callbackInfoMPELowPriority = {
  static_cast<uint8_t>(SettingKey::MPELowPriority),
  reinterpret_cast<void*>(&mpeLowPriorityMode),
  nullptr,
  resetTuningMIDI
};
GEMItem menuItemToggleMPELowPriority("MPE Low Priority", mpeLowPriorityMode, universalSaveCallback,
                                     reinterpret_cast<void*>(&callbackInfoMPELowPriority));

// MIDI force MPE option toggle
SelectOptionByte optionByteMPEMode[] = {
  { "Auto", MPE_MODE_AUTO },
  { "Disable", MPE_MODE_DISABLE },
  { "Force", MPE_MODE_FORCE }
};
GEMSelect selectMPEMode(sizeof(optionByteMPEMode) / sizeof(SelectOptionByte), optionByteMPEMode);
PersistentCallbackInfo callbackInfoMPEMode = {
  static_cast<uint8_t>(SettingKey::MPEMode),
  reinterpret_cast<void*>(&mpeUserMode),
  nullptr,
  refreshMidiRouting
};
GEMItem menuItemSelectMPEMode("MPE Mode", mpeUserMode, selectMPEMode, universalSaveCallback,
                               reinterpret_cast<void*>(&callbackInfoMPEMode));

// Toggle additional MPE messages (CC74 + Channel Pressure)
PersistentCallbackInfo callbackInfoExtraMPE = {
  static_cast<uint8_t>(SettingKey::ExtraMPE),
  reinterpret_cast<void*>(&extraMPE),
  nullptr,
  nullptr
};
GEMItem menuItemToggleExtraMPE("Extra MPE", extraMPE, universalSaveCallback,
                               reinterpret_cast<void*>(&callbackInfoExtraMPE));

// MIDI Channel selection
const GEMSpinnerBoundariesByte spinnerBoundariesCC74Value = { 1, 0, 127 };
GEMSpinner spinnerCC74Value(spinnerBoundariesCC74Value, GEM_LOOP);
PersistentCallbackInfo callbackInfoCC74 = {
  static_cast<uint8_t>(SettingKey::CC74Value),
  reinterpret_cast<void*>(&CC74value),
  nullptr,
  nullptr
};
GEMItem menuItemSelectCC74value("CC 74 Value", CC74value, spinnerCC74Value, universalSaveCallback,
                                reinterpret_cast<void*>(&callbackInfoCC74));

// Layout rotation selection
SelectOptionByte optionByteLayoutRotation[] = { { "0 Deg", 0 }, { "60 Deg", 1 }, { "120 Deg", 2 }, { "180 Deg", 3 }, { "240 Deg", 4 }, { "300 Deg", 5 } };
GEMSelect selectLayoutRotation(6, optionByteLayoutRotation);
PersistentCallbackInfo callbackInfoLayoutRotation = {
  static_cast<uint8_t>(SettingKey::LayoutRotation),
  reinterpret_cast<void*>(&layoutRotation),
  nullptr,
  updateLayoutAndRotate
};
GEMItem menuItemSelectLayoutRotation("Rotate: ", layoutRotation, selectLayoutRotation, universalSaveCallback,
                                     reinterpret_cast<void*>(&callbackInfoLayoutRotation));

// Layout mirroring toggles
PersistentCallbackInfo callbackInfoMirrorLR = {
  static_cast<uint8_t>(SettingKey::MirrorLeftRight),
  reinterpret_cast<void*>(&mirrorLeftRight),
  nullptr,
  updateLayoutAndRotate
};
GEMItem mirrorLeftRightGEMItem("Mirror Ver.", mirrorLeftRight, universalSaveCallback,
                                reinterpret_cast<void*>(&callbackInfoMirrorLR));

PersistentCallbackInfo callbackInfoMirrorUD = {
  static_cast<uint8_t>(SettingKey::MirrorUpDown),
  reinterpret_cast<void*>(&mirrorUpDown),
  nullptr,
  updateLayoutAndRotate
};
GEMItem mirrorUpDownGEMItem("Mirror Hor.", mirrorUpDown, universalSaveCallback,
                             reinterpret_cast<void*>(&callbackInfoMirrorUD));

// Dynamic just intonation toggles and parameters
PersistentCallbackInfo callbackInfoJustIntonationBPMSync = {
  static_cast<uint8_t>(SettingKey::JustIntonationBPMSync),
  reinterpret_cast<void*>(&useJustIntonationBPM),
  nullptr,
  refreshMidiRouting
};
GEMItem menuItemToggleJI_BPM("JI BPM Sync", useJustIntonationBPM, universalSaveCallback,
                              reinterpret_cast<void*>(&callbackInfoJustIntonationBPMSync));

PersistentCallbackInfo callbackInfoBeatBPM = {
  static_cast<uint8_t>(SettingKey::BeatBPM),
  reinterpret_cast<void*>(&justIntonationBPM),
  nullptr,
  refreshMidiRouting
};
GEMItem menuItemSetJI_BPM("Beat BPM", justIntonationBPM, spinnerJustIntonationBPM, universalSaveCallback,
                          reinterpret_cast<void*>(&callbackInfoBeatBPM));

PersistentCallbackInfo callbackInfoBPM_Mult = {
  static_cast<uint8_t>(SettingKey::BPMMultiplier),
  reinterpret_cast<void*>(&justIntonationBPM_Multiplier),
  nullptr,
  refreshMidiRouting
};
GEMItem menuItemSetJI_BPM_Multiplier("BPM Mult.", justIntonationBPM_Multiplier, spinnerBPM_MultiplierOfJI, universalSaveCallback,
                                     reinterpret_cast<void*>(&callbackInfoBPM_Mult));

PersistentCallbackInfo callbackInfoDynamicJI = {
  static_cast<uint8_t>(SettingKey::DynamicJI),
  reinterpret_cast<void*>(&useDynamicJustIntonation),
  nullptr,
  refreshMidiRouting
};
GEMItem menuItemToggleDynamicJI("Dynamic JI", useDynamicJustIntonation, universalSaveCallback,
                                reinterpret_cast<void*>(&callbackInfoDynamicJI));

//////////////////////////////////////////////////////////////////////////////////////////////////////

SelectOptionByte optionByteColor[] = { { "Rainbow", RAINBOW_MODE }, { "Tiered", TIERED_COLOR_MODE }, { "Alt", ALTERNATE_COLOR_MODE }, { "Fifths", RAINBOW_OF_FIFTHS_MODE }, { "Piano", PIANO_COLOR_MODE }, { "Alt Piano", PIANO_ALT_COLOR_MODE }, { "Filament", PIANO_INCANDESCENT_COLOR_MODE } };
GEMSelect selectColor(sizeof(optionByteColor) / sizeof(SelectOptionByte), optionByteColor);
PersistentCallbackInfo callbackInfoColorMode = {
  static_cast<uint8_t>(SettingKey::ColorMode),
  reinterpret_cast<void*>(&colorMode),
  nullptr,
  setLEDcolorCodes
};
GEMItem menuItemColor("Color Mode", colorMode, selectColor, universalSaveCallback,
                      reinterpret_cast<void*>(&callbackInfoColorMode));

SelectOptionByte optionByteAnimate[] = {
  { "Off", ANIMATE_NONE },
  { "Button", ANIMATE_BUTTON },
  { "Octave", ANIMATE_OCTAVE },
  { "By Note", ANIMATE_BY_NOTE },
  { "Star", ANIMATE_STAR },
  { "Splash", ANIMATE_SPLASH },
  { "Orbit", ANIMATE_ORBIT },
  { "Beams", ANIMATE_BEAMS },
  { "rSplash", ANIMATE_SPLASH_REVERSE },
  { "rStar", ANIMATE_STAR_REVERSE },
  { "MIDI In", ANIMATE_MIDI_IN }
};
GEMSelect selectAnimate(sizeof(optionByteAnimate) / sizeof(SelectOptionByte), optionByteAnimate);
PersistentCallbackInfo callbackInfoAnimation = {
  static_cast<uint8_t>(SettingKey::AnimationType),
  reinterpret_cast<void*>(&animationType),
  nullptr,
  nullptr
};
GEMItem menuItemAnimate("Animation", animationType, selectAnimate, universalSaveCallback,
                        reinterpret_cast<void*>(&callbackInfoAnimation));

SelectOptionByte optionByteRestLedLevel[] = {
  { "Off", 0 },
  { "Faint", 60 },
  { "Dim", 100 },
  { "Low", 160 },
  { "Normal", 255 }
};
GEMSelect selectRestLedLevel(sizeof(optionByteRestLedLevel) / sizeof(SelectOptionByte), optionByteRestLedLevel);
PersistentCallbackInfo callbackInfoRestLedLevel = {
  static_cast<uint8_t>(SettingKey::RestLedBrightness),
  reinterpret_cast<void*>(&ledRestBrightness),
  nullptr,
  setLEDcolorCodes
};
GEMItem menuItemRestLedLevel("Rest Bright", ledRestBrightness, selectRestLedLevel, universalSaveCallback,
                             reinterpret_cast<void*>(&callbackInfoRestLedLevel));

SelectOptionByte optionByteDimLedLevel[] = {
  { "Off", 0 },
  { "Faint", 100 },
  { "Dim", 150 },
  { "Low", 200 },
  { "Normal", 255 }
};
GEMSelect selectDimLedLevel(sizeof(optionByteDimLedLevel) / sizeof(SelectOptionByte), optionByteDimLedLevel);
PersistentCallbackInfo callbackInfoDimLedLevel = {
  static_cast<uint8_t>(SettingKey::DimLedBrightness),
  reinterpret_cast<void*>(&ledDimBrightness),
  nullptr,
  setLEDcolorCodes
};
GEMItem menuItemDimLedLevel("Dim Bright", ledDimBrightness, selectDimLedLevel, universalSaveCallback,
                            reinterpret_cast<void*>(&callbackInfoDimLedLevel));

SelectOptionByte optionByteBright[] = { { "Off", BRIGHT_OFF }, { "Dimmer", BRIGHT_DIMMER }, { "Dim", BRIGHT_DIM }, { "Low", BRIGHT_LOW }, { "Normal", BRIGHT_MID }, { "High", BRIGHT_HIGH }, { "THE SUN", BRIGHT_MAX } };
GEMSelect selectBright(sizeof(optionByteBright) / sizeof(SelectOptionByte), optionByteBright);
PersistentCallbackInfo callbackInfoBrightness = {
  static_cast<uint8_t>(SettingKey::GlobalBrightness),
  reinterpret_cast<void*>(&globalBrightness),
  nullptr,
  setLEDcolorCodes
};
GEMItem menuItemBright("Brightness", globalBrightness, selectBright, universalSaveCallback,
                       reinterpret_cast<void*>(&callbackInfoBrightness));

SelectOptionByte optionByteWaveform[] = { { "Hybrid", WAVEFORM_HYBRID }, { "Square", WAVEFORM_SQUARE }, { "Saw", WAVEFORM_SAW }, { "Triangl", WAVEFORM_TRIANGLE }, { "Sine", WAVEFORM_SINE }, { "Strings", WAVEFORM_STRINGS }, { "Clrinet", WAVEFORM_CLARINET } };
GEMSelect selectWaveform(sizeof(optionByteWaveform) / sizeof(SelectOptionByte), optionByteWaveform);
PersistentCallbackInfo callbackInfoWaveform = {
  static_cast<uint8_t>(SettingKey::Waveform),
  reinterpret_cast<void*>(&currWave),
  nullptr,
  resetSynthFreqs
};
GEMItem menuItemWaveform("Waveform", currWave, selectWaveform, universalSaveCallback,
                         reinterpret_cast<void*>(&callbackInfoWaveform));

PersistentCallbackInfo callbackInfoSynthBPM = {
  static_cast<uint8_t>(SettingKey::SynthBPM),
  reinterpret_cast<void*>(&synthBPM),
  nullptr,
  updateArpeggiatorTiming
};
GEMItem menuItemSynthBPM("Arp BPM", synthBPM, spinnerSynthBPM, universalSaveCallback,
                         reinterpret_cast<void*>(&callbackInfoSynthBPM));

SelectOptionByte optionByteArpSpeed[] = {
  { "1/2", 2 },
  { "1/3", 3 },
  { "1/4", 4 },
  { "1/6", 6 },
  { "1/8", 8 },
  { "1/12", 12 },
  { "1/16", 16 },
  { "1/24", 24 },
  { "1/32", 32 }
};
GEMSelect selectArpSpeed(sizeof(optionByteArpSpeed) / sizeof(SelectOptionByte), optionByteArpSpeed);
PersistentCallbackInfo callbackInfoArpSpeed = {
  static_cast<uint8_t>(SettingKey::ArpeggiatorDivision),
  reinterpret_cast<void*>(&arpeggiatorDivision),
  nullptr,
  updateArpeggiatorTiming
};
GEMItem menuItemArpSpeed("Arp Speed", arpeggiatorDivision, selectArpSpeed, universalSaveCallback,
                         reinterpret_cast<void*>(&callbackInfoArpSpeed));

SelectOptionByte optionByteEnvelopeTimes[] = {
  { "0 ms", 0 },
  { "5 ms", 1 },
  { "10 ms", 2 },
  { "20 ms", 3 },
  { "50 ms", 4 },
  { "100 ms", 5 },
  { "200 ms", 6 },
  { "500 ms", 7 },
  { "1 s", 8 },
  { "2 s", 9 }
};
SelectOptionByte optionByteSustain[] = {
  { "0%", 0 },
  { "10%", 13 },
  { "25%", 32 },
  { "50%", 64 },
  { "75%", 96 },
  { "100%", 127 }
};

GEMSelect selectEnvelopeAttack(sizeof(optionByteEnvelopeTimes) / sizeof(SelectOptionByte), optionByteEnvelopeTimes);
GEMSelect selectEnvelopeDecay(sizeof(optionByteEnvelopeTimes) / sizeof(SelectOptionByte), optionByteEnvelopeTimes);
GEMSelect selectEnvelopeRelease(sizeof(optionByteEnvelopeTimes) / sizeof(SelectOptionByte), optionByteEnvelopeTimes);
GEMSelect selectEnvelopeSustain(sizeof(optionByteSustain) / sizeof(SelectOptionByte), optionByteSustain);

PersistentCallbackInfo callbackInfoEnvelopeAttack = {
  static_cast<uint8_t>(SettingKey::EnvelopeAttackIndex),
  reinterpret_cast<void*>(&envelopeAttackIndex),
  nullptr,
  updateEnvelopeParamsFromSettings
};
PersistentCallbackInfo callbackInfoEnvelopeDecay = {
  static_cast<uint8_t>(SettingKey::EnvelopeDecayIndex),
  reinterpret_cast<void*>(&envelopeDecayIndex),
  nullptr,
  updateEnvelopeParamsFromSettings
};
PersistentCallbackInfo callbackInfoEnvelopeSustain = {
  static_cast<uint8_t>(SettingKey::EnvelopeSustainLevel),
  reinterpret_cast<void*>(&envelopeSustainLevel),
  nullptr,
  updateEnvelopeParamsFromSettings
};
PersistentCallbackInfo callbackInfoEnvelopeRelease = {
  static_cast<uint8_t>(SettingKey::EnvelopeReleaseIndex),
  reinterpret_cast<void*>(&envelopeReleaseIndex),
  nullptr,
  updateEnvelopeParamsFromSettings
};

GEMItem menuItemEnvelopeAttack("Attack", envelopeAttackIndex, selectEnvelopeAttack, universalSaveCallback,
                               reinterpret_cast<void*>(&callbackInfoEnvelopeAttack));
GEMItem menuItemEnvelopeDecay("Decay", envelopeDecayIndex, selectEnvelopeDecay, universalSaveCallback,
                              reinterpret_cast<void*>(&callbackInfoEnvelopeDecay));
GEMItem menuItemEnvelopeSustain("Sustain", envelopeSustainLevel, selectEnvelopeSustain, universalSaveCallback,
                                reinterpret_cast<void*>(&callbackInfoEnvelopeSustain));
GEMItem menuItemEnvelopeRelease("Release", envelopeReleaseIndex, selectEnvelopeRelease, universalSaveCallback,
                                reinterpret_cast<void*>(&callbackInfoEnvelopeRelease));

SelectOptionInt optionIntModWheel[] = { { "too slo", 1 }, { "Turtle", 2 }, { "Slow", 4 }, { "Medium", 8 }, { "Fast", 16 }, { "Cheetah", 32 }, { "Instant", 127 } };
GEMSelect selectModSpeed(sizeof(optionIntModWheel) / sizeof(SelectOptionInt), optionIntModWheel);
PersistentCallbackInfo callbackInfoModSpeed = {
  static_cast<uint8_t>(SettingKey::ModWheelSpeed),
  reinterpret_cast<void*>(&modWheelSpeed),
  nullptr,
  nullptr
};
GEMItem menuItemModSpeed("Mod Wheel", modWheelSpeed, selectModSpeed, universalSaveCallback,
                         reinterpret_cast<void*>(&callbackInfoModSpeed));

PersistentCallbackInfo callbackInfoVelSpeed = {
  static_cast<uint8_t>(SettingKey::VelWheelSpeed),
  reinterpret_cast<void*>(&velWheelSpeed),
  nullptr,
  nullptr
};
GEMItem menuItemVelSpeed("Vel Wheel", velWheelSpeed, selectModSpeed, universalSaveCallback,
                         reinterpret_cast<void*>(&callbackInfoVelSpeed));

SelectOptionInt optionIntPBWheel[] = { { "too slo", 128 }, { "Turtle", 256 }, { "Slow", 512 }, { "Medium", 1024 }, { "Fast", 2048 }, { "Cheetah", 4096 }, { "Instant", 16384 } };
GEMSelect selectPBSpeed(sizeof(optionIntPBWheel) / sizeof(SelectOptionInt), optionIntPBWheel);
PersistentCallbackInfo callbackInfoPBSpeed = {
  static_cast<uint8_t>(SettingKey::PBWheelSpeed),
  reinterpret_cast<void*>(&pbWheelSpeed),
  encodePbWheelSpeed,
  nullptr
};
GEMItem menuItemPBSpeed("PB Wheel", pbWheelSpeed, selectPBSpeed, universalSaveCallback,
                        reinterpret_cast<void*>(&callbackInfoPBSpeed));

// --------------------------------------------------------
// SETTINGS STEP 3 - Callback to sync settings variables on power-up
// --------------------------------------------------------
void syncSettingsToRuntime() {
  debugMessages = (settings[static_cast<uint8_t>(SettingKey::Debug)] != 0);  // do it this way for bools...
  rotaryInvert = (settings[static_cast<uint8_t>(SettingKey::RotaryInvert)] != 0);
  autoSave = (settings[static_cast<uint8_t>(SettingKey::AutoSave)] != 0);
  MPEpitchBendSemis = settings[static_cast<uint8_t>(SettingKey::MPEpitchBend)];  // ... and this way for bytes...
  mpeUserMode = settings[static_cast<uint8_t>(SettingKey::MPEMode)];
  if (mpeUserMode > MPE_MODE_FORCE) {
    mpeUserMode = MPE_MODE_AUTO;
  }
  extraMPE = (settings[static_cast<uint8_t>(SettingKey::ExtraMPE)] != 0);
  mpeLowestChannel = settings[static_cast<uint8_t>(SettingKey::MPELowestChannel)];
  mpeHighestChannel = settings[static_cast<uint8_t>(SettingKey::MPEHighestChannel)];
  mpeLowPriorityMode = (settings[static_cast<uint8_t>(SettingKey::MPELowPriority)] != 0);
  clampMPEChannelRange();
  defaultMidiChannel = settings[static_cast<uint8_t>(SettingKey::DefaultMIDIChannel)];
  if (defaultMidiChannel < 1 || defaultMidiChannel > 16) {
    defaultMidiChannel = 1;
  }
  CC74value = settings[static_cast<uint8_t>(SettingKey::CC74Value)];
  current.tuningIndex = settings[static_cast<uint8_t>(SettingKey::CurrentTuning)];
  current.layoutIndex = settings[static_cast<uint8_t>(SettingKey::CurrentLayout)];
  current.scaleIndex = settings[static_cast<uint8_t>(SettingKey::CurrentScale)];
  { // Unpacking the signed values:
    uint8_t raw = settings[static_cast<uint8_t>(SettingKey::CurrentTransposeSteps)];  // ... and this way for signed values.
    transposeSteps = int(raw) - 128;
    current.transpose = transposeSteps;
  }
  {
    uint8_t raw = settings[static_cast<uint8_t>(SettingKey::CurrentKeyStepsFromA)];
    current.keyStepsFromA = int(raw) - 128;
  }
  layoutRotation = settings[static_cast<uint8_t>(SettingKey::LayoutRotation)] % 6;
  mirrorLeftRight = (settings[static_cast<uint8_t>(SettingKey::MirrorLeftRight)] != 0);
  mirrorUpDown = (settings[static_cast<uint8_t>(SettingKey::MirrorUpDown)] != 0);
  scaleLock = (settings[static_cast<uint8_t>(SettingKey::ScaleLock)] != 0);
  perceptual = true;
  paletteBeginsAtKeyCenter = (settings[static_cast<uint8_t>(SettingKey::PaletteCenterOnKey)] != 0);
  wheelMode = settings[static_cast<uint8_t>(SettingKey::WheelAltMode)] != 0;
  pbSticky = settings[static_cast<uint8_t>(SettingKey::PBSticky)] != 0;
  modSticky = settings[static_cast<uint8_t>(SettingKey::ModSticky)] != 0;

  {
    uint8_t exponent = settings[static_cast<uint8_t>(SettingKey::PBWheelSpeed)];
    if (exponent < 7) exponent = 7;
    if (exponent > 14) exponent = 14;
    pbWheelSpeed = 1 << exponent;
  }
  modWheelSpeed = settings[static_cast<uint8_t>(SettingKey::ModWheelSpeed)];
  if (modWheelSpeed <= 0) modWheelSpeed = 1;
  velWheelSpeed = settings[static_cast<uint8_t>(SettingKey::VelWheelSpeed)];
  if (velWheelSpeed <= 0) velWheelSpeed = 1;

  playbackMode = settings[static_cast<uint8_t>(SettingKey::PlaybackMode)];
  currWave = settings[static_cast<uint8_t>(SettingKey::Waveform)];
  audioD = settings[static_cast<uint8_t>(SettingKey::AudioDestination)];
  arpeggiatorDivision = settings[static_cast<uint8_t>(SettingKey::ArpeggiatorDivision)];
  if (arpeggiatorDivision == 0) {
    arpeggiatorDivision = 1;
  }
  synthBPM = settings[static_cast<uint8_t>(SettingKey::SynthBPM)];
  if (synthBPM == 0) {
    synthBPM = 1;
  }
  colorMode = settings[static_cast<uint8_t>(SettingKey::ColorMode)];
  ledRestBrightness = settings[static_cast<uint8_t>(SettingKey::RestLedBrightness)];
  ledDimBrightness = settings[static_cast<uint8_t>(SettingKey::DimLedBrightness)];
  globalBrightness = settings[static_cast<uint8_t>(SettingKey::GlobalBrightness)];
  animationType = settings[static_cast<uint8_t>(SettingKey::AnimationType)];
  programChange = settings[static_cast<uint8_t>(SettingKey::ProgramChange)];

  useJustIntonationBPM = (settings[static_cast<uint8_t>(SettingKey::JustIntonationBPMSync)] !=0);
  justIntonationBPM = settings[static_cast<uint8_t>(SettingKey::BeatBPM)];
  justIntonationBPM_Multiplier = settings[static_cast<uint8_t>(SettingKey::BPMMultiplier)];
  useDynamicJustIntonation = (settings[static_cast<uint8_t>(SettingKey::DynamicJI)] !=0);
  envelopeAttackIndex = settings[static_cast<uint8_t>(SettingKey::EnvelopeAttackIndex)];
  envelopeDecayIndex = settings[static_cast<uint8_t>(SettingKey::EnvelopeDecayIndex)];
  envelopeSustainLevel = settings[static_cast<uint8_t>(SettingKey::EnvelopeSustainLevel)];
  envelopeReleaseIndex = settings[static_cast<uint8_t>(SettingKey::EnvelopeReleaseIndex)];
  updateEnvelopeParamsFromSettings();
  updateArpeggiatorTiming();

  // Now *apply* them to the engine/UI:
  showOnlyValidLayoutChoices();   // for tuning/layout
  showOnlyValidScaleChoices();
  showOnlyValidKeyChoices();
  updateLayoutAndRotate();
  refreshMidiRouting();
  resetSynthFreqs();
  if (programChange > 0) {
    sendProgramChange();
  }
  menuHome();                    // Refresh main screen to match rotation
}

// Call this procedure to return to the main menu
void menuHome() {
  menu.setMenuPageCurrent(menuPageMain);
  menu.drawMenu();
}

void rebootToBootloader() {
  menu.setMenuPageCurrent(menuPageReboot);
  menu.drawMenu();
  strip.clear();
  strip.show();
  rp2040.rebootToBootloader();
}
/*
    This procedure sets each layout menu item to be either
    visible if that layout is available in the current tuning,
    or hidden if not.

    It should run once after the layout menu items are
    generated, and then once any time the tuning changes.
  */
void showOnlyValidLayoutChoices() {
  for (byte L = 0; L < layoutCount; L++) {
    menuItemLayout[L]->hide((layoutOptions[L].tuning != current.tuningIndex));
  }
  sendToLog("menu: Layout choices were updated.");
}
/*
    This procedure sets each scale menu item to be either
    visible if that scale is available in the current tuning,
    or hidden if not.

    It should run once after the scale menu items are
    generated, and then once any time the tuning changes.
  */
void showOnlyValidScaleChoices() {
  for (int S = 0; S < scaleCount; S++) {
    menuItemScales[S]->hide((scaleOptions[S].tuning != current.tuningIndex) && (scaleOptions[S].tuning != ALL_TUNINGS));
  }
  sendToLog("menu: Scale choices were updated.");
}
/*
    This procedure sets each key spinner menu item to be either
    visible if the key names correspond to the current tuning,
    or hidden if not.

    It should run once after the key selectors are
    generated, and then once any time the tuning changes.
  */
void showOnlyValidKeyChoices() {
  for (int T = 0; T < TUNINGCOUNT; T++) {
    menuItemKeys[T]->hide((T != current.tuningIndex));
  }
  sendToLog("menu: Key choices were updated.");
}

void updateLayoutAndRotate() {
  applyLayout();
  u8g2.setDisplayRotation(current.layout().isPortrait ? U8G2_R2 : U8G2_R1);  // and landscape / portrait rotation
}
/*
    This procedure is run when a layout is selected via the menu.
    It sets the current layout to the selected value.
    If it's different from the previous one, then
    re-apply the layout to the grid. In any case, go to the
    main menu when done.
  */
void changeLayout(GEMCallbackData callbackData) {
  byte selection = callbackData.valByte;
  if (selection != current.layoutIndex) {
    current.layoutIndex = selection;
    settings[static_cast<uint8_t>(SettingKey::CurrentLayout)] = selection;
    markSettingsDirty();
    updateLayoutAndRotate();
  }
  menuHome();
}
/*
    This procedure is run when a scale is selected via the menu.
    It sets the current scale to the selected value.
    If it's different from the previous one, then
    re-apply the scale to the grid. In any case, go to the
    main menu when done.
  */
void changeScale(GEMCallbackData callbackData) {  // when you change the scale via the menu
  int selection = callbackData.valInt;
  if (selection != current.scaleIndex) {
    current.scaleIndex = selection;
    settings[static_cast<uint8_t>(SettingKey::CurrentScale)] = selection;
    applyScale();
  }
  menuHome();
}
/*
    This procedure is run when the key is changed via the menu.
    A key change results in a shift in the location of the
    scale notes relative to the grid.
    In this program, the only thing that occurs is that
    the scale is reapplied to the grid.
    The menu does not go home because the intent is to stay
    on the scale/key screen.
  */
void changeKey() {  // when you change the key via the menu
  // 1) Save to flash (biased by +128):
  settings[static_cast<uint8_t>(SettingKey::CurrentKeyStepsFromA)] = uint8_t(current.keyStepsFromA + 128);
  markSettingsDirty();
  // 2) Apply it:
  applyScale();
}
/*
    This procedure was declared already and is being defined now.
    It's run when the transposition is changed via the menu.
    It sets the current transposition to the selected value.
    The effect of transposition is to change the sounded
    notes but not the layout or display.
    The procedure to re-assign pitches is therefore called.
    The menu doesn't change because the transpose is a spinner select.
  */
void changeTranspose() {  // when you change the transpose via the menu
  // 1) Save to flash (biased by +128):
  settings[static_cast<uint8_t>(SettingKey::CurrentTransposeSteps)] = uint8_t(transposeSteps + 128);
  markSettingsDirty();
  // 2) Apply it:
  current.transpose = transposeSteps;
  assignPitches();
  updateSynthWithNewFreqs();
}
/*
    This procedure is run when the tuning is changed via the menu.
    It affects almost everything in the program, so
    quite a few items are reset, refreshed, and redone
    when the tuning changes.
  */
void changeTuning(GEMCallbackData callbackData) {
  byte selection = callbackData.valByte;
  if (selection != current.tuningIndex) {
    // 1) Update runtime state
    current.tuningIndex = selection;
    current.layoutIndex = current.layoutsBegin();         // reset layout to first in list
    current.scaleIndex = 0;                               // reset scale to "no scale"
    current.keyStepsFromA = current.tuning().spanCtoA();  // reset key to C
    // 2) Copy and save all values to settings
    settings[static_cast<uint8_t>(SettingKey::CurrentTuning)]        = current.tuningIndex;
    settings[static_cast<uint8_t>(SettingKey::CurrentLayout)]        = current.layoutIndex;
    settings[static_cast<uint8_t>(SettingKey::CurrentScale)]         = current.scaleIndex;
    // bias the signed keyStepsFromA by +128
    settings[static_cast<uint8_t>(SettingKey::CurrentKeyStepsFromA)] = uint8_t(current.keyStepsFromA + 128);
    markSettingsDirty();                                  // auto‑save (after debounce)
    // 3) Apply all values
    showOnlyValidLayoutChoices();                         // change list of choices in GEM Menu
    showOnlyValidScaleChoices();                          // change list of choices in GEM Menu
    showOnlyValidKeyChoices();                            // change list of choices in GEM Menu
    updateLayoutAndRotate();                              // apply changes above
    refreshMidiRouting();                                 // clear out MIDI queue and rebuild mapping
    resetSynthFreqs();
  }
  menuHome();
}
/*
    The procedure below builds menu items for tuning,
    layout, scales, and keys based on what's preloaded.
    We already declared arrays of menu item objects earlier.
    Now we cycle through those arrays, and create GEMItem objects for
    each index. What's nice about doing this in an array is,
    we do not have to assign a variable name to each object; we just
    refer to it by its index in the array.

    The constructor "new GEMItem" is populated with the different
    variables in the preset objects we defined earlier.
    Then the menu item is added to the associated page.
    The item must be entered with the asterisk operator
    because an array index technically returns an address in memory
    pointing to the object; the addMenuItem procedure wants
    the contents of that item, which is what the * beforehand does.
  */
void createTuningMenuItems() {
  for (byte T = 0; T < TUNINGCOUNT; T++) {
    menuItemTuning[T] = new GEMItem(tuningOptions[T].name.c_str(), changeTuning, T);
    menuPageTuning.addMenuItem(*menuItemTuning[T]);
  }
}
void createLayoutMenuItems() {
  for (byte L = 0; L < layoutCount; L++) {  // create pointers to all layouts
    menuItemLayout[L] = new GEMItem(layoutOptions[L].name.c_str(), changeLayout, L);
    menuPageLayout.addMenuItem(*menuItemLayout[L]);
  }
  showOnlyValidLayoutChoices();
}
void createKeyMenuItems() {
  for (byte T = 0; T < TUNINGCOUNT; T++) {
    selectKey[T] = new GEMSelect(tuningOptions[T].cycleLength, tuningOptions[T].keyChoices);
    menuItemKeys[T] = new GEMItem("Key", current.keyStepsFromA, *selectKey[T], changeKey);
    menuPageScales.addMenuItem(*menuItemKeys[T]);
  }
  showOnlyValidKeyChoices();
}
void createScaleMenuItems() {
  for (int S = 0; S < scaleCount; S++) {  // create pointers to all scale items, filter them as you go
    menuItemScales[S] = new GEMItem(scaleOptions[S].name.c_str(), changeScale, S);
    menuPageScales.addMenuItem(*menuItemScales[S]);
  }
  showOnlyValidScaleChoices();
}

void createProfileMenuItems() {
  for (uint8_t i = 0; i < PROFILE_COUNT; ++i) {
    if (i == 0) {
      snprintf(saveProfileLabels[i], sizeof(saveProfileLabels[i]), "Boot/Auto-Save Slot");
    } else {
      snprintf(saveProfileLabels[i], sizeof(saveProfileLabels[i]), "Slot %u", static_cast<unsigned>(i));
    }
    menuItemSaveProfile[i] = new GEMItem(saveProfileLabels[i], saveProfileMenu, i);
    menuPageSave.addMenuItem(*menuItemSaveProfile[i]);
  }
  for (uint8_t i = 0; i < PROFILE_COUNT; ++i) {
    if (i == 0) {
      snprintf(loadProfileLabels[i], sizeof(loadProfileLabels[i]), "Boot/Auto-Save Slot");
    } else {
      snprintf(loadProfileLabels[i], sizeof(loadProfileLabels[i]), "Slot %u", static_cast<unsigned>(i));
    }
    menuItemLoadProfile[i] = new GEMItem(loadProfileLabels[i], loadProfileMenu, i);
    menuPageLoad.addMenuItem(*menuItemLoadProfile[i]);
  }
}

void setupMenu() {
  menu.setSplashDelay(0);
  menu.init();
  menu.invertKeysDuringEdit(true);  // Invert rotary direction when editing a value
  /*
      addMenuItem procedure adds that GEM object to the given page.
      The menu items appear in the order they are added.
      To change the order of the menu, change the order in the code below.
    */
  menuPageMain.addMenuItem(menuGotoTuning);
  createTuningMenuItems();
  menuPageTuning.addMenuItem(menuItemToggleDynamicJI);
  menuPageTuning.addMenuItem(menuItemToggleJI_BPM);
  menuPageTuning.addMenuItem(menuItemSetJI_BPM);
  menuPageTuning.addMenuItem(menuItemSetJI_BPM_Multiplier);
  menuPageMain.addMenuItem(menuGotoLayout);
  createLayoutMenuItems();
  menuPageLayout.addMenuItem(mirrorLeftRightGEMItem);
  menuPageLayout.addMenuItem(mirrorUpDownGEMItem);
  menuPageLayout.addMenuItem(menuItemSelectLayoutRotation);
  menuPageMain.addMenuItem(menuGotoScales);
  createKeyMenuItems();
  menuPageScales.addMenuItem(menuItemScaleLock);
  createScaleMenuItems();
  menuPageMain.addMenuItem(menuGotoColors);
  menuPageColors.addMenuItem(menuItemColor);
  menuPageColors.addMenuItem(menuItemBright);
  menuPageColors.addMenuItem(menuItemAnimate);
  menuPageColors.addMenuItem(menuItemRestLedLevel);
  menuPageColors.addMenuItem(menuItemDimLedLevel);
  menuPageMain.addMenuItem(menuGotoSynth);
  menuPageSynth.addMenuItem(menuItemPlayback);
  // menuItemAudioD added here for hardware V1.2
  menuPageSynth.addMenuItem(menuItemWaveform);
  menuPageSynth.addMenuItem(menuItemEnvelopeAttack);
  menuPageSynth.addMenuItem(menuItemEnvelopeDecay);
  menuPageSynth.addMenuItem(menuItemEnvelopeSustain);
  menuPageSynth.addMenuItem(menuItemEnvelopeRelease);
  menuPageSynth.addMenuItem(menuItemArpSpeed);
  menuPageSynth.addMenuItem(menuItemSynthBPM);
  menuPageMain.addMenuItem(menuGotoMIDI);
  menuPageMIDI.addMenuItem(menuItemSelectMIDIChannel);
  menuPageMIDI.addMenuItem(menuItemSelectMPEMode);
  menuPageMIDI.addMenuItem(menuItemMPEpitchBend);
  menuPageMIDI.addMenuItem(menuItemSelectMPELowChannel);
  menuPageMIDI.addMenuItem(menuItemSelectMPEHighChannel);
  menuPageMIDI.addMenuItem(menuItemToggleMPELowPriority);
  menuPageMIDI.addMenuItem(menuItemToggleExtraMPE);
  menuPageMIDI.addMenuItem(menuItemSelectCC74value);
  menuPageMIDI.addMenuItem(menuItemRolandMT32);
  menuPageMIDI.addMenuItem(menuItemGeneralMidi);
  menuPageMain.addMenuItem(menuGotoControl);
  menuPageControl.addMenuItem(menuItemVelSpeed);
  menuPageControl.addMenuItem(menuItemPBSpeed);
  menuPageControl.addMenuItem(menuItemModSpeed);
  menuPageControl.addMenuItem(menuItemPBBehave);
  menuPageControl.addMenuItem(menuItemModBehave);
  menuPageMain.addMenuItem(menuItemTransposeSteps);
  menuPageMain.addMenuItem(menuGotoSave);
  menuPageSave.addMenuItem(menuItemAutoSave);
  menuPageMain.addMenuItem(menuGotoLoad);
  createProfileMenuItems();
  menuPageMain.addMenuItem(menuGotoAdvanced);
  menuPageAdvanced.addMenuItem(menuItemVersion);
  menuPageAdvanced.addMenuItem(menuItemHardware);
  menuPageAdvanced.addMenuItem(menuItemRotary);
  menuPageAdvanced.addMenuItem(menuItemShiftColor);
  // menuPageAdvanced.addMenuItem(menuItemWheelAlt); // not sure why we have this, so I'm hiding it for now
  menuPageAdvanced.addMenuItem(menuItemResetDefaults);
  menuPageAdvanced.addMenuItem(menuItemUSBBootloader);
  menuPageAdvanced.addMenuItem(menuItemDebug);
}
void setupGFX() {
  u8g2.begin();                      // Menu and graphics setup
  u8g2.setBusClock(1000000);         // Speed up display
  u8g2.setContrast(CONTRAST_AWAKE);  // Set contrast
  sendToLog("U8G2 graphics initialized.");
}
void screenSaver() {
  if (screenTime <= screenSaverTimeout) {
    screenTime = screenTime + lapTime;
    if (screenSaverOn) {
      screenSaverOn = 0;
      u8g2.setContrast(CONTRAST_AWAKE);
    }
  } else {
    if (!screenSaverOn) {
      screenSaverOn = 1;
      u8g2.setContrast(CONTRAST_SCREENSAVER);
      //if(globalBrightness == BRIGHT_OFF)
      {
        u8g2.clear();
      }
    }
  }
}

// @interface
/*
    This section of the code handles reading
    the rotary knob and physical hex buttons.

    Documentation:
      Rotary knob code derived from:
        https://github.com/buxtronix/arduino/tree/master/libraries/Rotary
    Copyright 2011 Ben Buxton. Licenced under the GNU GPL Version 3.
    Contact: bb@cactii.net

    when the mechanical rotary knob is turned,
    the two pins go through a set sequence of
    states during one physical "click", as follows:
      Direction          Binary state of pin A\B
      Counterclockwise = 1\1, 0\1, 0\0, 1\0, 1\1
      Clockwise        = 1\1, 1\0, 0\0, 0\1, 1\1

    The neutral state of the knob is 1\1; a turn
    is complete when 1\1 is reached again after
    passing through all the valid states above,
    at which point action should be taken depending
    on the direction of the turn.

    The variable rotaryState stores all of this
    data and refreshes it each loop of the 2nd processor.
      Value    Meaning
      0, 4     Knob is in neutral state
      1, 2, 3  CCW turn state 1, 2, 3
      5, 6, 7  CW  turn state 1, 2, 3
      8, 16    Completed turn CCW, CW
  */
#define ROT_PIN_A 20
#define ROT_PIN_B 21
#define ROT_PIN_C 24
byte rotaryState = 0;
const byte rotaryStateTable[8][4] = {
  { 0, 5, 1, 0 }, { 2, 0, 1, 0 }, { 2, 3, 1, 0 }, { 2, 3, 0, 8 }, { 0, 5, 1, 0 }, { 6, 5, 0, 0 }, { 6, 5, 7, 0 }, { 6, 0, 7, 16 }
};
byte storeRotaryTurn = 0;
bool rotaryClicked = HIGH;
constexpr uint64_t ROTARY_PANIC_HOLD_MICROS = 2000000ULL;  // 2 seconds
uint64_t rotaryPressStart = 0;
bool rotaryPanicLatched = false;
bool rotaryPanicSuppressClick = false;

void readHexes() {
  // Simplified button reading to reduce time it takes to read. Stil uses slower Arduino digitalRead and digitalWrite.
  /* for (byte r = 0; r < ROWCOUNT; r++) {      // Iterate through each of the row pins on the multiplexing chip.
    for (byte d = 0; d < 4; d++) {
      digitalWrite(mPin[d], (r >> d) & 1);
    }
    busy_wait_us_32(12);
    for (byte c = 0; c < COLCOUNT; c++) {    // Now iterate through each of the column pins that are connected to the current row pin.
      byte p = cPin[c];                      // Hold the currently selected column pin in a variable.
      byte i = c + (r * COLCOUNT);
      bool didYouPressHex = (digitalRead(p) == LOW);  // hex is pressed if it returns LOW. else not pressed
      h[i].interpBtnPress(didYouPressHex);
      if (h[i].btnState == BTN_STATE_NEWPRESS) {
        h[i].timePressed = runTime;          // log the time
      }
    }
  } */
  // Optimized button reading using SIO registers - much faster!
  for (byte r = 0; r < ROWCOUNT; r++) {       // Iterate through each row via the multiplexer.
    sio_hw->gpio_clr = multiplexerMask;       // Set all multiplexer pins to LOW.
    sio_hw->gpio_set = rowSelectMask[r];      // Set the current row's select pins HIGH.
    busy_wait_us_32(12);                      // Allow the row selection to settle without blocking interrupts.
    uint32_t a = sio_hw->gpio_in;             // Reads all GPIO pins at once into a variable
    uint32_t b = sio_hw->gpio_in;             // optional second sample
    uint32_t stable = a & b;                  // double-sample filtering to reduce noise
    uint16_t base = r * COLCOUNT;             // base index for this row - less multiplication in the loop
    for (byte c = 0; c < COLCOUNT; ++c) {     // Now iterate through each of the column pins
      byte i = base + c;                      // index of this button
      bool didYouPressHex = ((stable & columnMasks[c]) == 0); // check if this column pin is LOW
      h[i].interpBtnPress(didYouPressHex);    // interpret the button press as new press, held, released, or inactive
      if (h[i].btnState == BTN_STATE_NEWPRESS) {
        h[i].timePressed = runTime;  // log the time
      }
    }
  }
  /* Old method.
  for (byte c = 0; c < COLCOUNT; c++) {    // Iterate through each of the column pins.
    byte p = cPin[c];                      // Hold the currently selected column pin in a variable.
    pinMode(p, INPUT_PULLUP);              // Set that column pin to INPUT_PULLUP mode (+3.3V / HIGH).
    delayMicroseconds(0);                  // delay to energize column and stabilize (may need adjustment)
    for (byte r = 0; r < ROWCOUNT; r++) {  // Then iterate through each of the row pins on the multiplexing chip for the selected column.
      for (byte d = 0; d < 4; d++) {
        digitalWrite(mPin[d], (r >> d) & 1);  // Selected multiplexer channel is pulled to ground.
      }
      byte i = c + (r * COLCOUNT);
      delayMicroseconds(14);                          // Delay to allow signal to settle and improve reliability (found this number by experimentation)
      bool didYouPressHex = (digitalRead(p) == LOW);  // hex is pressed if it returns LOW. else not pressed
      h[i].interpBtnPress(didYouPressHex);
      if (h[i].btnState == BTN_STATE_NEWPRESS) {
        h[i].timePressed = runTime;  // log the time
      }
    }
    pinMode(p, INPUT);  // Set the selected column pin back to INPUT mode (0V / LOW).
  }*/
  for (byte i = 0; i < BTN_COUNT; i++) {  // For all buttons in the deck
    switch (h[i].btnState) {
      case BTN_STATE_NEWPRESS:  // just pressed
        if (h[i].isCmd) {
          cmdOn(i);
        } else if (h[i].inScale || (!scaleLock)) {
          tryMIDInoteOn(i);
          trySynthNoteOn(i);
        }
        break;
      case BTN_STATE_RELEASED:  // just released
        if (h[i].isCmd) {
          cmdOff(i);
        } else if (h[i].inScale || (!scaleLock)) {
          tryMIDInoteOff(i);
          trySynthNoteOff(i);
        }
        break;
      case BTN_STATE_HELD:  // held
        break;
      default:  // inactive
        break;
    }
  }
}
void updateWheels() {
  velWheel.setTargetValue();
  bool upd = velWheel.updateValue(runTime);
  if (upd) {
    sendToLog("vel became " + std::to_string(velWheel.curValue));
  }
  if (toggleWheel) {
    pbWheel.setTargetValue();
    upd = pbWheel.updateValue(runTime);
    if (upd) {
      sendMIDIpitchBendToCh1();
      updateSynthWithNewFreqs();
    }
  } else {
    modWheel.setTargetValue();
    upd = modWheel.updateValue(runTime);
    if (upd) {
      sendMIDImodulationToCh1();
    }
  }
}
void setupRotary() {
  pinMode(ROT_PIN_A, INPUT_PULLUP);
  pinMode(ROT_PIN_B, INPUT_PULLUP);
  pinMode(ROT_PIN_C, INPUT_PULLUP);
}
void readKnob() {
  rotaryState = rotaryStateTable[rotaryState & 7][(digitalRead(ROT_PIN_B) << 1) | digitalRead(ROT_PIN_A)];
  if (rotaryState & 24) {
    storeRotaryTurn = rotaryState;
  }
}
void dealWithRotary() {
  bool temp = digitalRead(ROT_PIN_C);
  bool justPressed = (rotaryClicked == HIGH && temp == LOW);
  bool justReleased = (rotaryClicked == LOW && temp == HIGH);

  if (justPressed) {
    rotaryPressStart = runTime;
    rotaryPanicLatched = false;
  } else if ((temp == LOW) && (rotaryPressStart != 0) && (!rotaryPanicLatched)) {
    if ((runTime - rotaryPressStart) >= ROTARY_PANIC_HOLD_MICROS) {
      panicStopOutput();
      rotaryPanicLatched = true;
      rotaryPanicSuppressClick = true;
    }
  }

  bool suppressClick = rotaryPanicSuppressClick;

  if (menu.readyForKey()) {
    if (justReleased) {
      if (!suppressClick) {
      menu.registerKeyPress(GEM_KEY_OK);
      screenTime = 0;
    }
    }
    if (storeRotaryTurn != 0) {
      if (rotaryInvert == true) {
        menu.registerKeyPress((storeRotaryTurn == 8) ? GEM_KEY_DOWN : GEM_KEY_UP);
      } else {
        menu.registerKeyPress((storeRotaryTurn == 8) ? GEM_KEY_UP : GEM_KEY_DOWN);
      }
      storeRotaryTurn = 0;
      screenTime = 0;
    }
  }

  if (justReleased || temp == HIGH) {
    rotaryPressStart = 0;
    rotaryPanicLatched = false;
  }

  if (rotaryPanicSuppressClick && temp == HIGH && rotaryClicked == HIGH) {
    rotaryPanicSuppressClick = false;
  }

  rotaryClicked = temp;
}

void setupHardware() {
  if (Hardware_Version == HARDWARE_V1_2) {
    midiD = MIDID_USB | MIDID_SER;
    if (!audioMenuItemInserted) {
      menuPageSynth.addMenuItem(menuItemAudioD, 2);
      audioMenuItemInserted = true;
    }
  }
}

// @mainLoop
/*
    An Arduino program runs
    the setup() function once, then
    runs the loop() function on repeat
    until the machine is powered off.

    The RP2040 has two identical cores.
    Anything called from setup() and loop()
    runs on the first core.
    Anything called from setup1() and loop1()
    runs on the second core.

    On the HexBoard, the second core is
    dedicated to two timing-critical tasks:
    running the synth emulator, and tracking
    the rotary knob inputs.
    Everything else runs on the first core.
  */
void setup() {
#if (defined(ARDUINO_ARCH_MBED) && defined(ARDUINO_ARCH_RP2040))
  TinyUSB_Device_Init(0);  // Manual begin() is required on core without built-in support for TinyUSB such as mbed rp2040
#endif
  irq_set_enabled(ALARM_IRQ, false);
  setupMIDI();
  setupFileSystem();
  Wire.setSDA(SDAPIN);
  Wire.setSCL(SCLPIN);
  setupPins();
  setupGrid();
  detectHardwareVersion();
  load_settings();
  setupLEDs();
  setupGFX();
  setupRotary();
  setupMenu();
  setupHardware();
  syncSettingsToRuntime();
  recomputePitchBendFactor();
}
void loop() {        // run on first core
  timeTracker();     // Time tracking functions
  processEnvelopeReleases();
  retryPendingReleases();
  screenSaver();     // Reduces wear-and-tear on OLED panel
  readHexes();       // Read and store the digital button states of the scanning matrix
  arpeggiate();      // arpeggiate if synth mode allows it
  updateWheels();    // deal with the pitch/mod wheel
  processIncomingMIDI();  // respond to external MIDI input
  animateLEDs();     // deal with animations
  lightUpLEDs();     // refresh LEDs
  dealWithRotary();  // deal with menu
  checkAndAutoSave();// save settings
}
void setup1() {  // set up on second core
  setupSynth(PIEZO_PIN, PIEZO_SLICE);
  setupSynth(AJACK_PIN, AJACK_SLICE);
}
void loop1() {  // run on second core
  readKnob();
}
