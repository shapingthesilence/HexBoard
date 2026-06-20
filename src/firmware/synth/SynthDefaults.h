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

constexpr uint8_t SYNTH_CONTROL_RATE_SAMPLES = 16;
constexpr uint8_t SYNTH_CONTROL_RATE_SHIFT = 4;
static_assert((1u << SYNTH_CONTROL_RATE_SHIFT) == SYNTH_CONTROL_RATE_SAMPLES,
              "SYNTH_CONTROL_RATE_SHIFT must match SYNTH_CONTROL_RATE_SAMPLES.");
constexpr uint8_t SYNTH_FX_ENVELOPE_CONTROL_TICKS = SYNTH_CONTROL_RATE_SAMPLES;

constexpr byte SYNTH_OFF = 0;
constexpr byte SYNTH_MONO_RETRIGGER = 1;
constexpr byte SYNTH_ARPEGGIO = 2;
constexpr byte SYNTH_POLY = 3;
constexpr byte SYNTH_MONO_LEGATO = 4;
constexpr byte SYNTH_POLYTBL_LEGACY = 5;
constexpr byte SYNTH_MONO = SYNTH_MONO_RETRIGGER;  // Legacy stored mono value.

// Audio polyphony is deliberately lower than the MIDI/MPE channel count:
// higher values reduce PWM resolution and make the ISR harder to keep bounded.
constexpr uint8_t POLYPHONY_LIMIT = 8;

inline bool RAM_FUNC(isMonoPlaybackMode)(byte mode) {
  return mode == SYNTH_MONO_RETRIGGER || mode == SYNTH_MONO_LEGATO;
}

inline bool RAM_FUNC(isPolyPlaybackMode)(byte mode) {
  return mode == SYNTH_POLY;
}

inline bool RAM_FUNC(isValidPlaybackMode)(byte mode) {
  return mode == SYNTH_OFF || isMonoPlaybackMode(mode) || mode == SYNTH_ARPEGGIO || isPolyPlaybackMode(mode);
}

inline uint8_t RAM_FUNC(synthPlaybackVoiceLimit)(byte mode) {
  if (mode == SYNTH_POLY) {
    return POLYPHONY_LIMIT;
  }
  if (mode == SYNTH_OFF) {
    return 0;
  }
  return 1;
}

inline byte RAM_FUNC(normalizeSynthPlaybackMode)(byte mode) {
  if (mode == SYNTH_POLYTBL_LEGACY) {
    return SYNTH_POLY;
  }
  return isValidPlaybackMode(mode) ? mode : SYNTH_POLY;
}

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

constexpr uint16_t SYNTH_WAVE_SAMPLE_COUNT = 512;
constexpr uint8_t SYNTH_WAVE_SAMPLE_BITS = 9;
constexpr uint8_t SYNTH_WAVE_PHASE_FRACTION_BITS = 16 - SYNTH_WAVE_SAMPLE_BITS;
constexpr uint16_t SYNTH_WAVE_PHASE_FRACTION_MASK = (1u << SYNTH_WAVE_PHASE_FRACTION_BITS) - 1;
constexpr uint8_t SYNTH_WAVETABLE_FRAME_COUNT = 32;
constexpr uint8_t SYNTH_WAVETABLE_LAST_FRAME = SYNTH_WAVETABLE_FRAME_COUNT - 1;
constexpr size_t SYNTH_WAVETABLE_SAMPLE_BYTES = static_cast<size_t>(SYNTH_WAVETABLE_FRAME_COUNT) * SYNTH_WAVE_SAMPLE_COUNT;
constexpr uint8_t SYNTH_WAVETABLE_MIP_LEVEL_COUNT = 6;
constexpr uint16_t SYNTH_WAVETABLE_MIP_SAMPLES_PER_FRAME = SYNTH_WAVE_SAMPLE_COUNT;
constexpr size_t SYNTH_WAVETABLE_MIP_SAMPLE_BYTES =
  SYNTH_WAVETABLE_SAMPLE_BYTES * SYNTH_WAVETABLE_MIP_LEVEL_COUNT;
constexpr size_t SYNTH_WAVETABLE_MIP_EXTRA_SAMPLE_BYTES = SYNTH_WAVETABLE_MIP_SAMPLE_BYTES - SYNTH_WAVETABLE_SAMPLE_BYTES;
constexpr uint16_t SYNTH_WAVETABLE_MIP_HARMONIC_LIMIT_0 = 255;
constexpr uint16_t SYNTH_WAVETABLE_MIP_HARMONIC_LIMIT_1 = 96;
constexpr uint16_t SYNTH_WAVETABLE_MIP_HARMONIC_LIMIT_2 = 48;
constexpr uint16_t SYNTH_WAVETABLE_MIP_HARMONIC_LIMIT_3 = 24;
constexpr uint16_t SYNTH_WAVETABLE_MIP_HARMONIC_LIMIT_4 = 12;
constexpr uint16_t SYNTH_WAVETABLE_MIP_HARMONIC_LIMIT_5 = 6;
constexpr uint32_t SYNTH_WAVETABLE_MIP_SAMPLE_RATE_HZ = 250000000u / 1024u / 6u;
constexpr uint32_t SYNTH_WAVETABLE_MIP_NYQUIST_HZ = SYNTH_WAVETABLE_MIP_SAMPLE_RATE_HZ / 2u;
constexpr uint8_t SYNTH_WAVETABLE_MIP_HYSTERESIS_SHIFT = 3;
constexpr uint8_t SYNTH_WAVETABLE_MIP_AA_MODE_FIXED_HARMONIC_LIMITS = 0;
constexpr uint8_t SYNTH_WAVETABLE_MIP_OCTAVE_OFFSET_ZERO = 4;
constexpr uint8_t SYNTH_WAVETABLE_MIP_OCTAVE_OFFSET_MAX = 8;

constexpr byte AUDIO_NONE = 0;
constexpr byte AUDIO_PIEZO = 1;
constexpr byte AUDIO_AJACK = 2;
constexpr byte AUDIO_BOTH = 3;

constexpr uint8_t HEADPHONE_VOLUME_CAP_FULL = 127;

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
