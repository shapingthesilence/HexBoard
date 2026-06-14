#pragma once

#include "../FirmwareModule.h"

constexpr byte ARP_DIRECTION_UP = 0;
constexpr byte ARP_DIRECTION_DOWN = 1;
constexpr byte ARP_DIRECTION_ORDER_PLAYED = 2;
constexpr byte ARP_DIRECTION_REVERSE_PLAYED = 3;
constexpr byte ARP_DIRECTION_UP_DOWN = 4;
constexpr byte ARP_DIRECTION_DOWN_UP = 5;
constexpr byte ARP_DIRECTION_RANDOM = 6;
constexpr byte ARP_DIRECTION_COUNT = 7;

constexpr byte METRONOME_MODE_OFF = 0;
constexpr byte METRONOME_MODE_BEEP = 1;
constexpr byte METRONOME_MODE_BRIGHTNESS = 2;
constexpr byte METRONOME_MODE_SIDE_BUTTONS = 3;

constexpr uint8_t SYNTH_CONTROL_RATE_SAMPLES = 8;
constexpr uint8_t SYNTH_FX_ENVELOPE_CONTROL_TICKS = SYNTH_CONTROL_RATE_SAMPLES;

constexpr byte SYNTH_OFF = 0;
constexpr byte SYNTH_MONO_RETRIGGER = 1;
constexpr byte SYNTH_ARPEGGIO = 2;
constexpr byte SYNTH_POLY = 3;
constexpr byte SYNTH_MONO_LEGATO = 4;
constexpr byte SYNTH_POLYTBL_LEGACY = 5;
constexpr byte SYNTH_MONO = SYNTH_MONO_RETRIGGER;  // Legacy stored mono value.

constexpr byte WAVEFORM_SINE = 0;
constexpr byte WAVEFORM_STRINGS = 1;
constexpr byte WAVEFORM_CLARINET = 2;
constexpr byte WAVEFORM_HYBRID = 7;
constexpr byte WAVEFORM_SQUARE = 8;
constexpr byte WAVEFORM_SAW = 9;
constexpr byte WAVEFORM_TRIANGLE = 10;
constexpr byte WAVEFORM_MP = 11;
constexpr byte WAVEFORM_MP_BOX_SAW = 12;
constexpr byte WAVEFORM_MP_FRIENDLY_SQUARE = 13;
constexpr byte WAVEFORM_MP_GLASSY = 14;
constexpr byte WAVEFORM_MP_KOOLAID = 15;
constexpr byte WAVEFORM_MP_MERV = 16;
constexpr byte WAVEFORM_MP_M_BELLISH = 17;
constexpr byte WAVEFORM_MP_OVAL = 18;
constexpr byte WAVEFORM_MP_PRETTY_SHAPE = 19;
constexpr byte WAVEFORM_MP_QUICK_808 = 20;
constexpr byte WAVEFORM_MP_RICH_REPEATER = 21;
constexpr byte WAVEFORM_MP_ROUNDED_TRIANGLE = 22;
constexpr byte WAVEFORM_MP_STARDEW = 23;
constexpr byte WAVEFORM_MP_SYNC_THE_TITANIC = 24;
constexpr byte WAVEFORM_MP_WEIRD_WIZARD = 25;
constexpr byte WAVEFORM_MP_WOO = 26;
constexpr byte WAVEFORM_BASIC_WAVETABLE = 27;
constexpr byte WAVEFORM_USER_WAVETABLE = 28;

constexpr byte AUDIO_NONE = 0;
constexpr byte AUDIO_PIEZO = 1;
constexpr byte AUDIO_AJACK = 2;
constexpr byte AUDIO_BOTH = 3;

constexpr uint8_t HEADPHONE_VOLUME_CAP_FULL = 127;
constexpr uint8_t SYNTH_OUTPUT_SMOOTHING_OFF = 0;
constexpr uint8_t SYNTH_OUTPUT_SMOOTHING_MAX = 8;

constexpr byte SYNTH_DRIVE_OFF = 0;
constexpr byte SYNTH_DRIVE_WARM = 1;
constexpr byte SYNTH_DRIVE_EDGE = 2;
constexpr byte SYNTH_DRIVE_DIRTY = 3;

constexpr byte SYNTH_MOD_TARGET_FOLD_WARP = 0;
constexpr byte SYNTH_MOD_TARGET_VIBRATO = 1;
constexpr byte SYNTH_MOD_TARGET_PITCH = 2;
constexpr byte SYNTH_MOD_TARGET_WAVETABLE_POSITION = 3;
constexpr byte SYNTH_MOD_TARGET_DUTY_WARP = 4;
constexpr byte SYNTH_MOD_TARGET_POLY_WARP = 5;
constexpr byte SYNTH_MOD_TARGET_MAX = SYNTH_MOD_TARGET_POLY_WARP;
constexpr uint8_t SYNTH_MOD_AMOUNT_FULL = 127;

constexpr uint8_t SYNTH_FX_AMOUNT_OFF = 127;
constexpr uint8_t SYNTH_FX_AMOUNT_FULL = 254;
constexpr uint8_t SYNTH_WAVETABLE_POSITION_DEFAULT = 0;

constexpr byte SYNTH_LFO_WAVE_SINE = 0;
constexpr byte SYNTH_LFO_WAVE_TRIANGLE = 1;
constexpr byte SYNTH_LFO_WAVE_SAW = 2;
constexpr byte SYNTH_LFO_WAVE_SQUARE = 3;
constexpr byte SYNTH_LFO_WAVE_MAX = SYNTH_LFO_WAVE_SQUARE;

constexpr byte SYNTH_VIBRATO_SPEED_DEFAULT = 5;  // 6 Hz in the 1..12 Hz table.
constexpr byte SYNTH_LFO_SPEED_DEFAULT = 6;      // 1 Hz in the granular LFO speed table.
