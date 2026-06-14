#if HEXBOARD_FIRMWARE_UNITY

#include "../FirmwareModule.h"
#include "../storage/PersistentDataModels.h"
#include "../tuning/Tuning.h"

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
  mpeLowestChannel = std::clamp(mpeLowestChannel, MPE_CHANNEL_MIN, MIDI_CHANNEL_MAX);
  mpeHighestChannel = std::clamp(mpeHighestChannel, MPE_CHANNEL_MIN, MIDI_CHANNEL_MAX);
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
byte deviceRotation = 0;

byte arpeggiatorDivision = 32;  // denominator of whole-note duration (1/32 by default)
byte synthBPM = 120;

constexpr byte ARP_DIRECTION_UP = 0;
constexpr byte ARP_DIRECTION_DOWN = 1;
constexpr byte ARP_DIRECTION_ORDER_PLAYED = 2;
constexpr byte ARP_DIRECTION_REVERSE_PLAYED = 3;
constexpr byte ARP_DIRECTION_UP_DOWN = 4;
constexpr byte ARP_DIRECTION_DOWN_UP = 5;
constexpr byte ARP_DIRECTION_RANDOM = 6;
constexpr byte ARP_DIRECTION_COUNT = 7;
byte arpeggiatorDirection = ARP_DIRECTION_UP;

constexpr byte METRONOME_MODE_OFF = 0;
constexpr byte METRONOME_MODE_BEEP = 1;
constexpr byte METRONOME_MODE_BRIGHTNESS = 2;
constexpr byte METRONOME_MODE_SIDE_BUTTONS = 3;

struct MetronomeSignature {
  uint8_t beats;
  uint8_t noteValue;
};

const MetronomeSignature metronomeSignatures[] = {
  { 4, 4 },
  { 3, 4 },
  { 2, 4 },
  { 6, 8 },
  { 5, 4 },
  { 7, 8 },
  { 12, 8 }
};
constexpr uint8_t METRONOME_SIGNATURE_COUNT = sizeof(metronomeSignatures) / sizeof(metronomeSignatures[0]);

byte metronomeMode = METRONOME_MODE_OFF;
byte metronomeSignatureIndex = 0;
uint8_t metronomeBeatsPerMeasure = 4;
uint64_t metronomeBeatIntervalMicros = 500000;
uint64_t metronomeNextBeatTime = 0;
uint8_t metronomeBeatCursor = 0;
uint64_t metronomeVisualFlashUntil = 0;
bool metronomeAccent = false;

//  Keyboard layout swapping
bool mirrorLeftRight = false;
bool mirrorUpDown = false;

//  Just Intonation related global variables
byte justIntonationBPM = 60;
byte justIntonationBPM_Multiplier = 1;
bool useJustIntonationBPM = false;
bool useDynamicJustIntonation = false;
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
byte dynamicJIRatioTable = DYNAMIC_JI_RATIO_TABLE_41_LIMIT;

int transposeSteps = 0;
bool scaleLock = false;
bool perceptual = true;
bool paletteBeginsAtKeyCenter = true;
byte animationFPS = 32;  // actually frames per 2^20 microseconds. close enough to 30fps

byte wheelMode = 0;  // standard vs. fine tune mode
byte modSticky = 0;
byte pbSticky = 0;
byte velSticky = 1;
int modWheelSpeed = 8;
int pbWheelSpeed = 1024;
int velWheelSpeed = 8;

uint8_t envelopeAttackIndex = 2;
uint8_t envelopeHoldIndex = 0;
uint8_t envelopeDecayIndex = 3;
uint8_t envelopeSustainLevel = 127;
uint8_t envelopeReleaseIndex = 3;
constexpr uint8_t SYNTH_CONTROL_RATE_SAMPLES = 8;
constexpr uint8_t SYNTH_FX_ENVELOPE_CONTROL_TICKS = SYNTH_CONTROL_RATE_SAMPLES;
std::array<uint8_t, SYNTH_FX_ENVELOPE_COUNT> effectEnvelopeAttackIndex = { 0, 0 };
std::array<uint8_t, SYNTH_FX_ENVELOPE_COUNT> effectEnvelopeHoldIndex = { 0, 0 };
std::array<uint8_t, SYNTH_FX_ENVELOPE_COUNT> effectEnvelopeDecayIndex = { 0, 0 };
std::array<uint8_t, SYNTH_FX_ENVELOPE_COUNT> effectEnvelopeSustainLevel = { 0, 0 };
std::array<uint8_t, SYNTH_FX_ENVELOPE_COUNT> effectEnvelopeReleaseIndex = { 0, 0 };

constexpr byte SYNTH_OFF = 0;
constexpr byte SYNTH_MONO_RETRIGGER = 1;
constexpr byte SYNTH_ARPEGGIO = 2;
constexpr byte SYNTH_POLY = 3;
constexpr byte SYNTH_MONO_LEGATO = 4;
constexpr byte SYNTH_POLYTBL_LEGACY = 5;
constexpr byte SYNTH_MONO = SYNTH_MONO_RETRIGGER;  // Legacy stored mono value.
byte playbackMode = SYNTH_POLY;

uint8_t synthPortamentoTimeIndex = 0;
uint32_t synthPortamentoTicks = 0;

inline bool RAM_FUNC(isMonoPlaybackMode)(byte mode) {
  return mode == SYNTH_MONO_RETRIGGER || mode == SYNTH_MONO_LEGATO;
}

inline bool RAM_FUNC(isPolyPlaybackMode)(byte mode) {
  return mode == SYNTH_POLY;
}

inline bool RAM_FUNC(isValidPlaybackMode)(byte mode) {
  return mode == SYNTH_OFF || isMonoPlaybackMode(mode) || mode == SYNTH_ARPEGGIO || isPolyPlaybackMode(mode);
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
byte currWave = WAVEFORM_HYBRID;
char currentSynthWavetableName[SYNTH_WAVETABLE_NAME_LENGTH] = "Basic";
char currentSynthWavetableFolderPath[SYNTH_WAVETABLE_FOLDER_LENGTH] = "/Built In";
bool currentSynthWavetableReferenceValid = false;

constexpr byte SYNTH_DRIVE_OFF = 0;
constexpr byte SYNTH_DRIVE_WARM = 1;
constexpr byte SYNTH_DRIVE_EDGE = 2;
constexpr byte SYNTH_DRIVE_DIRTY = 3;
byte synthDrive = SYNTH_DRIVE_OFF;

constexpr byte SYNTH_MOD_TARGET_FOLD_WARP = 0;
constexpr byte SYNTH_MOD_TARGET_VIBRATO = 1;
constexpr byte SYNTH_MOD_TARGET_PITCH = 2;
constexpr byte SYNTH_MOD_TARGET_WAVETABLE_POSITION = 3;
constexpr byte SYNTH_MOD_TARGET_DUTY_WARP = 4;
constexpr byte SYNTH_MOD_TARGET_POLY_WARP = 5;
constexpr byte SYNTH_MOD_TARGET_MAX = SYNTH_MOD_TARGET_POLY_WARP;
byte synthModTarget = SYNTH_MOD_TARGET_FOLD_WARP;
constexpr uint8_t SYNTH_MOD_AMOUNT_FULL = 127;
byte synthModAmount = SYNTH_MOD_AMOUNT_FULL;
std::array<uint8_t, SYNTH_FX_ENVELOPE_COUNT> effectEnvelopeTarget = { SYNTH_MOD_TARGET_VIBRATO, SYNTH_MOD_TARGET_PITCH };
constexpr uint8_t SYNTH_FX_AMOUNT_OFF = 127;
constexpr uint8_t SYNTH_FX_AMOUNT_FULL = 254;
std::array<uint8_t, SYNTH_FX_ENVELOPE_COUNT> effectEnvelopeAmount = { SYNTH_FX_AMOUNT_FULL, SYNTH_FX_AMOUNT_FULL };
constexpr uint8_t SYNTH_WAVETABLE_POSITION_DEFAULT = 0;
byte synthWavetablePosition = SYNTH_WAVETABLE_POSITION_DEFAULT;

constexpr byte SYNTH_LFO_WAVE_SINE = 0;
constexpr byte SYNTH_LFO_WAVE_TRIANGLE = 1;
constexpr byte SYNTH_LFO_WAVE_SAW = 2;
constexpr byte SYNTH_LFO_WAVE_SQUARE = 3;
constexpr byte SYNTH_LFO_WAVE_MAX = SYNTH_LFO_WAVE_SQUARE;
byte synthLfoTarget = SYNTH_MOD_TARGET_FOLD_WARP;
byte synthLfoAmount = SYNTH_FX_AMOUNT_OFF;
byte synthLfoWave = SYNTH_LFO_WAVE_SINE;

constexpr byte SYNTH_VIBRATO_SPEED_DEFAULT = 5;  // 6 Hz in the 1..12 Hz table.
byte synthVibratoSpeed = SYNTH_VIBRATO_SPEED_DEFAULT;
constexpr byte SYNTH_LFO_SPEED_DEFAULT = 6;  // 1 Hz in the granular LFO speed table.
byte synthLfoSpeed = SYNTH_LFO_SPEED_DEFAULT;

constexpr byte RAINBOW_MODE = 0;
constexpr byte TIERED_COLOR_MODE = 1;
constexpr byte ALTERNATE_COLOR_MODE = 2;
constexpr byte RAINBOW_OF_FIFTHS_MODE = 3;
constexpr byte PIANO_ALT_COLOR_MODE = 4;
constexpr byte PIANO_COLOR_MODE = 5;
constexpr byte PIANO_INCANDESCENT_COLOR_MODE = 6;
constexpr byte DIATONIC_COLOR_MODE = 7;
byte colorMode = RAINBOW_MODE;
bool bootAnimationEnabled = true;

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
byte animationType = ANIMATE_BUTTON;

constexpr byte LED_TEST_OFF = 0;
constexpr byte LED_TEST_RED = 1;
constexpr byte LED_TEST_GREEN = 2;
constexpr byte LED_TEST_BLUE = 3;
constexpr byte LED_TEST_WHITE = 4;
byte ledTestMode = LED_TEST_OFF;

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
byte globalBrightness = BRIGHT_DIM;

constexpr byte LED_CURRENT_LIMIT_OFF = 0;
constexpr byte LED_CURRENT_LIMIT_250MA = 1;
constexpr byte LED_CURRENT_LIMIT_500MA = 2;
constexpr byte LED_CURRENT_LIMIT_750MA = 3;
constexpr byte LED_CURRENT_LIMIT_1000MA = 4;
constexpr byte LED_CURRENT_LIMIT_1500MA = 5;
constexpr byte LED_CURRENT_LIMIT_2000MA = 6;
constexpr byte LED_CURRENT_LIMIT_3000MA = 7;
constexpr byte LED_CURRENT_LIMIT_MAX_MODE = LED_CURRENT_LIMIT_3000MA;

byte ledCurrentLimitMode = LED_CURRENT_LIMIT_OFF;
uint16_t ledCurrentLimitMilliamps = 0;

// V1.2 calibration: laptop-side USB meter readings with Diatonic / 12EDO /
// THE SUN brightness, OLED active, and the buzzer disabled. The displayed
// limit remains a USB-side target; these larger internal budgets compensate
// for the conservative WS2812 estimate while leaving buzzer/OLED headroom.
uint16_t decodeLedCurrentLimitMilliampsV12(byte limitMode) {
  switch (limitMode) {
    case LED_CURRENT_LIMIT_250MA:
      return 250;
    case LED_CURRENT_LIMIT_500MA:
      return 500;
    case LED_CURRENT_LIMIT_750MA:
      return 900;
    case LED_CURRENT_LIMIT_1000MA:
      return 1350;
    case LED_CURRENT_LIMIT_1500MA:
      return 2000;
    case LED_CURRENT_LIMIT_2000MA:
      return 3150;
    case LED_CURRENT_LIMIT_3000MA:
      return 5000;
    default:
      return 0;
  }
}

// V1.1 calibration: pure-white USB meter readings showed 0.6 A at the V1.2
// 1.5 A internal budget and 1.35 A at the V1.2 3.0 A internal budget. This
// table fits those readings so V1.1 modes land near the V1.2 actual draw.
uint16_t decodeLedCurrentLimitMilliampsV11(byte limitMode) {
  switch (limitMode) {
    case LED_CURRENT_LIMIT_250MA:
      return 600;
    case LED_CURRENT_LIMIT_500MA:
      return 1160;
    case LED_CURRENT_LIMIT_750MA:
      return 2100;
    case LED_CURRENT_LIMIT_1000MA:
      return 3150;
    case LED_CURRENT_LIMIT_1500MA:
      return 4600;
    case LED_CURRENT_LIMIT_2000MA:
      return 7100;
    case LED_CURRENT_LIMIT_3000MA:
      return 8500;
    default:
      return 0;
  }
}

uint16_t decodeLedCurrentLimitMilliamps(byte limitMode) {
  if (Hardware_Version == HARDWARE_V1_1) {
    return decodeLedCurrentLimitMilliampsV11(limitMode);
  }
  return decodeLedCurrentLimitMilliampsV12(limitMode);
}

void syncLedCurrentLimit() {
  if (ledCurrentLimitMode > LED_CURRENT_LIMIT_MAX_MODE) {
    ledCurrentLimitMode = LED_CURRENT_LIMIT_OFF;
  }
  ledCurrentLimitMilliamps = decodeLedCurrentLimitMilliamps(ledCurrentLimitMode);
}
#endif  // HEXBOARD_FIRMWARE_UNITY
