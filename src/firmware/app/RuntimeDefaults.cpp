#if HEXBOARD_FIRMWARE_UNITY

#include "../FirmwareModule.h"
#include "RuntimeDefaults.h"
#include "../storage/PersistentDataModels.h"
#include "../synth/SynthDefaults.h"
#include "../tuning/Tuning.h"

// @defaults
/*
    This section sets default values
    for user-editable options
  */
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

byte arpeggiatorDirection = ARP_DIRECTION_UP;

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
std::array<uint8_t, SYNTH_FX_ENVELOPE_COUNT> effectEnvelopeAttackIndex = { 0, 0 };
std::array<uint8_t, SYNTH_FX_ENVELOPE_COUNT> effectEnvelopeHoldIndex = { 0, 0 };
std::array<uint8_t, SYNTH_FX_ENVELOPE_COUNT> effectEnvelopeDecayIndex = { 0, 0 };
std::array<uint8_t, SYNTH_FX_ENVELOPE_COUNT> effectEnvelopeSustainLevel = { 0, 0 };
std::array<uint8_t, SYNTH_FX_ENVELOPE_COUNT> effectEnvelopeReleaseIndex = { 0, 0 };

byte playbackMode = SYNTH_POLY;

uint8_t synthPortamentoTimeIndex = 0;
uint32_t synthPortamentoTicks = 0;

byte currWave = WAVEFORM_HYBRID;
char currentSynthWavetableName[SYNTH_WAVETABLE_NAME_LENGTH] = "Basic";
char currentSynthWavetableFolderPath[SYNTH_WAVETABLE_FOLDER_LENGTH] = "/Built In";
bool currentSynthWavetableReferenceValid = false;

byte synthDrive = SYNTH_DRIVE_OFF;

byte synthModTarget = SYNTH_MOD_TARGET_FOLD_WARP;
byte synthModAmount = SYNTH_MOD_AMOUNT_FULL;
std::array<uint8_t, SYNTH_FX_ENVELOPE_COUNT> effectEnvelopeTarget = { SYNTH_MOD_TARGET_VIBRATO, SYNTH_MOD_TARGET_PITCH };
std::array<uint8_t, SYNTH_FX_ENVELOPE_COUNT> effectEnvelopeAmount = { SYNTH_FX_AMOUNT_FULL, SYNTH_FX_AMOUNT_FULL };
byte synthWavetablePosition = SYNTH_WAVETABLE_POSITION_DEFAULT;

byte synthLfoTarget = SYNTH_MOD_TARGET_FOLD_WARP;
byte synthLfoAmount = SYNTH_FX_AMOUNT_OFF;
byte synthLfoWave = SYNTH_LFO_WAVE_SINE;

byte synthVibratoSpeed = SYNTH_VIBRATO_SPEED_DEFAULT;
byte synthLfoSpeed = SYNTH_LFO_SPEED_DEFAULT;

byte colorMode = RAINBOW_MODE;
bool bootAnimationEnabled = true;

byte animationType = ANIMATE_BUTTON;

constexpr byte LED_TEST_OFF = 0;
constexpr byte LED_TEST_RED = 1;
constexpr byte LED_TEST_GREEN = 2;
constexpr byte LED_TEST_BLUE = 3;
constexpr byte LED_TEST_WHITE = 4;
byte ledTestMode = LED_TEST_OFF;

byte globalBrightness = BRIGHT_DIM;

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
