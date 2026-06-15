#pragma once

#include "../FirmwareModule.h"

// Hardware revisions and fixed platform limits.
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

// Physical grid dimensions and derived button ranges.
constexpr byte LED_COUNT = 140;
constexpr byte COLCOUNT = 10;
constexpr byte ROWCOUNT = 16;
constexpr byte BTN_COUNT = COLCOUNT * ROWCOUNT;
constexpr byte FIRST_FLAG_BUTTON_INDEX = LED_COUNT;
constexpr byte CMDCOUNT = 7;

// Matrix scan GPIO assignments.
constexpr byte MPLEX_1_PIN = 4;
constexpr byte MPLEX_2_PIN = 5;
constexpr byte MPLEX_4_PIN = 2;
constexpr byte MPLEX_8_PIN = 3;
constexpr byte COLUMN_PIN_0 = 6;
constexpr byte COLUMN_PIN_1 = 7;
constexpr byte COLUMN_PIN_2 = 8;
constexpr byte COLUMN_PIN_3 = 9;
constexpr byte COLUMN_PIN_4 = 10;
constexpr byte COLUMN_PIN_5 = 11;
constexpr byte COLUMN_PIN_6 = 12;
constexpr byte COLUMN_PIN_7 = 13;
constexpr byte COLUMN_PIN_8 = 14;
constexpr byte COLUMN_PIN_9 = 15;

// Physical command-button indices in the scan matrix.
constexpr byte CMDBTN_0 = 0;
constexpr byte CMDBTN_1 = 20;
constexpr byte CMDBTN_2 = 40;
constexpr byte CMDBTN_3 = 60;
constexpr byte CMDBTN_4 = 80;
constexpr byte CMDBTN_5 = 100;
constexpr byte CMDBTN_6 = 120;

// Rotary encoder GPIO assignments.
constexpr byte ROT_PIN_A = 20;
constexpr byte ROT_PIN_B = 21;
constexpr byte ROT_PIN_C = 24;

// LED strip GPIO assignment.
constexpr byte LED_PIN = 22;

// Audio output GPIO and RP2040 PWM routing.
constexpr byte PIEZO_PIN = 23;
constexpr byte PIEZO_SLICE = 3;
constexpr byte PIEZO_CHNL = 1;
constexpr byte AJACK_PIN = 25;
constexpr byte AJACK_SLICE = 4;
constexpr byte AJACK_CHNL = 1;
