#include "FirmwareModule.h"

#if HEXBOARD_FIRMWARE_UNITY

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

constexpr std::array<uint32_t, 20> envelopeTimeMicrosOptions = {
  0, 5000, 10000, 15000, 20000, 30000, 50000, 75000, 100000, 150000,
  200000, 300000, 500000, 750000, 1000000, 1500000, 2000000, 2500000,
  3000000, 4000000
};
constexpr std::array<uint8_t, 10> legacyEnvelopeTimeIndexToCurrent = {
  0, 1, 2, 4, 6, 8, 10, 12, 14, 16
};
constexpr uint8_t ENVELOPE_LEVEL_SCALE_SHIFT = 7;
constexpr uint32_t envelopeAudioMaxLevel = 65535;
constexpr uint32_t envelopeMaxLevel = envelopeAudioMaxLevel << ENVELOPE_LEVEL_SCALE_SHIFT;
constexpr uint8_t ENVELOPE_MOD_VALUE_SHIFT = ENVELOPE_LEVEL_SCALE_SHIFT + 9;
constexpr uint32_t ENVELOPE_MOD_VALUE_ROUND = 1u << (ENVELOPE_MOD_VALUE_SHIFT - 1);
constexpr uint8_t ENVELOPE_RELEASE_INCREMENT_BUCKET_BITS = 8;
constexpr uint16_t ENVELOPE_RELEASE_INCREMENT_BUCKETS = 1u << ENVELOPE_RELEASE_INCREMENT_BUCKET_BITS;
constexpr uint8_t ENVELOPE_RELEASE_INCREMENT_SHIFT = 16 + ENVELOPE_LEVEL_SCALE_SHIFT - ENVELOPE_RELEASE_INCREMENT_BUCKET_BITS;

enum class EnvelopeStage : uint8_t {
  Idle,
  Attack,
  Hold,
  Decay,
  Sustain,
  Release
};

struct EnvelopeParams {
  uint32_t attackTicks = 0;
  uint32_t holdTicks = 0;
  uint32_t decayTicks = 0;
  uint32_t releaseTicks = 0;
  uint32_t attackIncrement = envelopeMaxLevel;
  uint32_t decayIncrement = envelopeMaxLevel;
  uint32_t sustainLevel = envelopeMaxLevel;
};

EnvelopeParams envelopeParams;
std::array<EnvelopeParams, SYNTH_FX_ENVELOPE_COUNT> effectEnvelopeParams;
std::array<uint16_t, ENVELOPE_RELEASE_INCREMENT_BUCKETS> envelopeReleaseIncrementByLevel = {};
std::array<std::array<uint16_t, ENVELOPE_RELEASE_INCREMENT_BUCKETS>, SYNTH_FX_ENVELOPE_COUNT> effectEnvelopeReleaseIncrementByLevel = {};
void updateEnvelopeReleaseIncrementTable(EnvelopeParams& params, std::array<uint16_t, ENVELOPE_RELEASE_INCREMENT_BUCKETS>& releaseTable);
void updateEnvelopeParamsFromValues(EnvelopeParams& params,
                                    uint8_t& attackIndex,
                                    uint8_t& holdIndex,
                                    uint8_t& decayIndex,
                                    uint8_t& sustainLevel,
                                    uint8_t& releaseIndex,
                                    std::array<uint16_t, ENVELOPE_RELEASE_INCREMENT_BUCKETS>& releaseTable);

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


#endif  // HEXBOARD_FIRMWARE_UNITY
