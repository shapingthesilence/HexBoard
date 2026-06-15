#pragma once

#include "../FirmwareModule.h"
#include "../storage/PersistentDataModels.h"

constexpr byte MPE_MODE_AUTO = 0;
constexpr byte MPE_MODE_DISABLE = 1;
constexpr byte MPE_MODE_FORCE = 2;

constexpr byte DYNAMIC_JI_RATIO_TABLE_3_LIMIT = 3;
constexpr byte DYNAMIC_JI_RATIO_TABLE_5_LIMIT = 5;
constexpr byte DYNAMIC_JI_RATIO_TABLE_7_LIMIT = 7;
constexpr byte DYNAMIC_JI_RATIO_TABLE_11_LIMIT = 11;
constexpr byte DYNAMIC_JI_RATIO_TABLE_13_LIMIT = 13;
constexpr byte DYNAMIC_JI_RATIO_TABLE_17_LIMIT = 17;
constexpr byte DYNAMIC_JI_RATIO_TABLE_19_LIMIT = 19;
constexpr byte DYNAMIC_JI_RATIO_TABLE_23_LIMIT = 23;
constexpr byte DYNAMIC_JI_RATIO_TABLE_29_LIMIT = 29;
constexpr byte DYNAMIC_JI_RATIO_TABLE_31_LIMIT = 31;
constexpr byte DYNAMIC_JI_RATIO_TABLE_37_LIMIT = 37;
constexpr byte DYNAMIC_JI_RATIO_TABLE_41_LIMIT = 41;

constexpr byte RAINBOW_MODE = 0;
constexpr byte TIERED_COLOR_MODE = 1;
constexpr byte ALTERNATE_COLOR_MODE = 2;
constexpr byte RAINBOW_OF_FIFTHS_MODE = 3;
constexpr byte PIANO_ALT_COLOR_MODE = 4;
constexpr byte PIANO_COLOR_MODE = 5;
constexpr byte PIANO_INCANDESCENT_COLOR_MODE = 6;
constexpr byte DIATONIC_COLOR_MODE = 7;

constexpr byte ANIMATE_BUTTON = 0;
constexpr byte ANIMATE_STAR = 1;
constexpr byte ANIMATE_SPLASH = 2;
constexpr byte ANIMATE_ORBIT = 3;
constexpr byte ANIMATE_OCTAVE = 4;
constexpr byte ANIMATE_BY_NOTE = 5;
constexpr byte ANIMATE_BEAMS = 6;
constexpr byte ANIMATE_SPLASH_REVERSE = 7;
constexpr byte ANIMATE_STAR_REVERSE = 8;
constexpr byte ANIMATE_MIDI_IN = 9;
constexpr byte ANIMATE_NONE = 10;

constexpr byte BRIGHT_MAX = 255;
constexpr byte BRIGHT_HIGH = 210;
constexpr byte BRIGHT_MID = 180;
constexpr byte BRIGHT_LOW = 150;
constexpr byte BRIGHT_DIM = 110;
constexpr byte BRIGHT_DIMMER = 70;
constexpr byte BRIGHT_DARK = 50;     // BRIGHT_DIMMEST
constexpr byte BRIGHT_DARKER = 34;   // Lowest brightness before backlight shuts down
constexpr byte BRIGHT_FAINT = 33;    // Highest brightness before backlight turns on
constexpr byte BRIGHT_FAINTER = 24;  // Lowest brightness before any highlighted button is lit in all color modes
constexpr byte BRIGHT_OFF = 0;

constexpr byte LED_CURRENT_LIMIT_OFF = 0;
constexpr byte LED_CURRENT_LIMIT_250MA = 1;
constexpr byte LED_CURRENT_LIMIT_500MA = 2;
constexpr byte LED_CURRENT_LIMIT_750MA = 3;
constexpr byte LED_CURRENT_LIMIT_1000MA = 4;
constexpr byte LED_CURRENT_LIMIT_1500MA = 5;
constexpr byte LED_CURRENT_LIMIT_2000MA = 6;
constexpr byte LED_CURRENT_LIMIT_3000MA = 7;
constexpr byte LED_CURRENT_LIMIT_MAX_MODE = LED_CURRENT_LIMIT_3000MA;

extern byte currWave;
extern char currentSynthWavetableName[SYNTH_WAVETABLE_NAME_LENGTH];
extern char currentSynthWavetableFolderPath[SYNTH_WAVETABLE_FOLDER_LENGTH];
extern bool currentSynthWavetableReferenceValid;
extern byte synthWavetablePosition;
