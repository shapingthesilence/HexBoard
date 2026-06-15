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

constexpr byte LED_TEST_OFF = 0;
constexpr byte LED_TEST_RED = 1;
constexpr byte LED_TEST_GREEN = 2;
constexpr byte LED_TEST_BLUE = 3;
constexpr byte LED_TEST_WHITE = 4;

struct MetronomeSignature {
  uint8_t beats;
  uint8_t noteValue;
};

constexpr uint8_t METRONOME_SIGNATURE_COUNT = 7;
extern const MetronomeSignature metronomeSignatures[METRONOME_SIGNATURE_COUNT];

extern byte mpeUserMode;
extern bool extraMPE;
extern bool standardMidiMicrotonalActive;
extern byte standardMidiBaseChannel;
extern byte mpeLowestChannel;
extern byte mpeHighestChannel;
extern bool mpeLowPriorityMode;
extern byte ledRestBrightness;
extern byte ledDimBrightness;
void clampMPEChannelRange();
byte applyLEDLevel(byte value, byte level);

extern byte CC74value;
extern byte defaultMidiChannel;
extern byte layoutRotation;
extern byte deviceRotation;
extern byte arpeggiatorDivision;
extern byte synthBPM;
extern byte arpeggiatorDirection;
extern byte metronomeMode;
extern byte metronomeSignatureIndex;
extern uint8_t metronomeBeatsPerMeasure;
extern uint64_t metronomeBeatIntervalMicros;
extern uint64_t metronomeNextBeatTime;
extern uint8_t metronomeBeatCursor;
extern uint64_t metronomeVisualFlashUntil;
extern bool metronomeAccent;
extern bool mirrorLeftRight;
extern bool mirrorUpDown;
extern byte justIntonationBPM;
extern byte justIntonationBPM_Multiplier;
extern bool useJustIntonationBPM;
extern bool useDynamicJustIntonation;
extern byte dynamicJIRatioTable;
extern int transposeSteps;
extern bool scaleLock;
extern bool perceptual;
extern bool paletteBeginsAtKeyCenter;
extern byte animationFPS;
extern byte wheelMode;
extern byte modSticky;
extern byte pbSticky;
extern byte velSticky;
extern int modWheelSpeed;
extern int pbWheelSpeed;
extern int velWheelSpeed;
extern byte currWave;
extern char currentSynthWavetableName[SYNTH_WAVETABLE_NAME_LENGTH];
extern char currentSynthWavetableFolderPath[SYNTH_WAVETABLE_FOLDER_LENGTH];
extern bool currentSynthWavetableReferenceValid;
extern byte playbackMode;
extern byte synthDrive;
extern byte synthModTarget;
extern byte synthModAmount;
extern byte synthVibratoSpeed;
extern byte arpeggiatorDivision;
extern byte arpeggiatorDirection;
extern byte synthBPM;
extern uint8_t synthPortamentoTimeIndex;
extern byte synthWavetablePosition;
extern byte synthLfoTarget;
extern byte synthLfoAmount;
extern byte synthLfoWave;
extern byte synthLfoSpeed;
extern uint8_t envelopeAttackIndex;
extern uint8_t envelopeHoldIndex;
extern uint8_t envelopeDecayIndex;
extern uint8_t envelopeSustainLevel;
extern uint8_t envelopeReleaseIndex;
extern uint32_t synthPortamentoTicks;
extern std::array<uint8_t, SYNTH_FX_ENVELOPE_COUNT> effectEnvelopeTarget;
extern std::array<uint8_t, SYNTH_FX_ENVELOPE_COUNT> effectEnvelopeAmount;
extern std::array<uint8_t, SYNTH_FX_ENVELOPE_COUNT> effectEnvelopeAttackIndex;
extern std::array<uint8_t, SYNTH_FX_ENVELOPE_COUNT> effectEnvelopeHoldIndex;
extern std::array<uint8_t, SYNTH_FX_ENVELOPE_COUNT> effectEnvelopeDecayIndex;
extern std::array<uint8_t, SYNTH_FX_ENVELOPE_COUNT> effectEnvelopeSustainLevel;
extern std::array<uint8_t, SYNTH_FX_ENVELOPE_COUNT> effectEnvelopeReleaseIndex;

extern byte colorMode;
extern bool bootAnimationEnabled;
extern byte animationType;
extern byte ledTestMode;
extern byte globalBrightness;
extern byte ledCurrentLimitMode;
extern uint16_t ledCurrentLimitMilliamps;
uint16_t decodeLedCurrentLimitMilliamps(byte limitMode);
void syncLedCurrentLimit();
