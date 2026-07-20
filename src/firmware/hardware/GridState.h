#pragma once

#include "../FirmwareModule.h"
#include "HardwareConfig.h"
#include "../model/ScalePalettePreset.h"

constexpr byte BTN_STATE_OFF = 0;
constexpr byte BTN_STATE_NEWPRESS = 1;
constexpr byte BTN_STATE_RELEASED = 2;
constexpr byte BTN_STATE_HELD = 3;
constexpr uint8_t WHEEL_MAX_CATCHUP_STEPS = 8;
constexpr uint8_t USER_GEOMETRY_MAX_CHORD_ACTIONS = 16;
constexpr uint8_t USER_GEOMETRY_MAX_CHORD_TONES = 4;

struct UserGeometryChordAction {
  bool active = false;
  uint8_t id = 0;
  uint8_t pitchMode = 0;
  uint8_t midiChannel = 0;
  uint8_t toneCount = 0;
  int16_t intervals[USER_GEOMETRY_MAX_CHORD_TONES] = {};
};

class buttonDef {
public:
  byte btnState = BTN_STATE_OFF;  // binary 00 = off, 01 = just pressed, 10 = just released, 11 = held
  void RAM_FUNC(interpBtnPress)(bool isPress) {
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
  bool animate = false;      // true when this hex participates in the current animation frame
  int16_t stepsFromC = 0;    // number of steps from C4 (semitones in 12EDO; microtones if >12EDO)
  bool isCmd = false;        // true if this slot acts as a command instead of a playable note
  bool inScale = false;      // true when this note belongs to the selected scale
  byte note = UNUSED_NOTE;   // MIDI note or control parameter corresponding to this hex
  int16_t bend = 0;          // in microtonal mode, the pitch bend for this note needed to be tuned correctly
  byte MIDIch = 0;           // what MIDI channel this note is playing on
  byte activeMidiNote = UNUSED_NOTE;  // exact MIDI note sent for the active note-on
  byte synthCh = 0;          // what synth polyphony ch this is playing on
  float frequency = 0.0;     // what frequency to ring on the synther
  float midiPitch = 0.0f;     // unrounded MIDI pitch used for nearest-note bend output
  int16_t jiRetune = 0;
  float jiRetuneCents = 0.0f;
  int16_t activePitchBend = 0;
  float jiFrequencyMultiplier = 1.0f;
  uint8_t externalNoteDepth = 0;  // number of active external MIDI notes mapped here
  int32_t midiNoteIndex = 0;      // extended MIDI note number before channel folding
  byte mappedMidiChannel = 0;     // preferred channel when not using MPE
};

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
  bool wasMoving = false;
  int RAM_FUNC(effectiveStepValue)() const {
    return (*stepValue <= 0) ? 1 : *stepValue;
  }
  uint64_t RAM_FUNC(updateIntervalMicros)() const {
    return (*stepValue <= 0) ? (CC_MSG_COOLDOWN_MICROSECONDS * 2u) : CC_MSG_COOLDOWN_MICROSECONDS;
  }
  void RAM_FUNC(setTargetValue)() {
    int step = effectiveStepValue();
    if (*alternateMode) {
      if (*midBtn >> 1) {  // middle button toggles target (0) vs. step (1) mode
        int16_t temp = curValue;
        if (*topBtn == 1) { temp += step; }  // tap button
        if (*botBtn == 1) { temp -= step; }  // tap button
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
  bool RAM_FUNC(updateValue)(uint64_t givenTime) {
    int16_t temp = targetValue - curValue;
    if (temp == 0) {
      wasMoving = false;
      return false;
    }

    uint64_t interval = updateIntervalMicros();
    uint8_t stepsToApply = 1;
    if (wasMoving) {
      uint64_t elapsed = givenTime - timeLastChanged;
      uint64_t elapsedIntervals = elapsed / interval;
      if (elapsedIntervals == 0) {
        return false;
      }
      stepsToApply = static_cast<uint8_t>(
        std::min<uint64_t>(elapsedIntervals, WHEEL_MAX_CATCHUP_STEPS)
      );
      timeLastChanged += elapsedIntervals * interval;
    } else {
      wasMoving = true;
      timeLastChanged = givenTime;
    }

    int step = effectiveStepValue();
    for (uint8_t i = 0; i < stepsToApply; ++i) {
      temp = targetValue - curValue;
      if (temp == 0) {
        wasMoving = false;
        break;
      }
      if (abs(temp) < step) {
        curValue = targetValue;
      } else {
        curValue = curValue + (step * (temp / abs(temp)));
      }
    }
    if (curValue == targetValue) {
      wasMoving = false;
    }
    return true;
  }
};

extern const byte assignCmd[CMDCOUNT];
extern uint32_t multiplexerMask;
extern uint32_t rowSelectMask[ROWCOUNT];
extern uint32_t columnMasks[COLCOUNT];
extern buttonDef h[BTN_COUNT];

extern bool userGeometryRuntimeActive;
extern bool userGeometryRuntimeScaleActive;
extern bool userGeometryRuntimePaletteActive;
extern bool userGeometryRuntimeTuningObjectSelected;
extern bool userGeometryRuntimeLayoutObjectSelected;
extern bool userGeometryRuntimeScaleObjectSelected;
extern uint8_t userGeometryRuntimeTuningObjectId[16];
extern uint8_t userGeometryRuntimeLayoutObjectId[16];
extern uint8_t userGeometryRuntimeScaleObjectId[16];
extern bool userGeometryRuntimeCentsTableActive;
extern bool userGeometryRuntimeExactEdoActive;
extern uint8_t userGeometryRuntimeTuningKind;
extern uint16_t userGeometryRuntimeCycleLength;
extern uint16_t userGeometryRuntimeCentsTableLength;
extern float userGeometryRuntimeCentsTable[MAX_SCALE_DIVISIONS];
extern float userGeometryRuntimePeriodCents;
extern uint8_t userGeometryRuntimeReferenceMidiNote;
extern float userGeometryRuntimeReferenceHz;
extern char userGeometryRuntimeKeyLabelStorage[MAX_SCALE_DIVISIONS][TUNING_KEY_LABEL_LENGTH];
extern tuningDef userGeometryRuntimeTuning;
extern layoutDef userGeometryRuntimeLayout;
extern scaleDef userGeometryRuntimeScale;
extern paletteDef userGeometryRuntimePalette;
extern bool userGeometryRuntimeButtonDisabled[LED_COUNT];
extern uint8_t userGeometryRuntimeButtonRole[LED_COUNT];
extern bool userGeometryRuntimeButtonRoleOverride[LED_COUNT];
extern bool userGeometryRuntimeButtonNoteOverride[LED_COUNT];
extern bool userGeometryRuntimeButtonColorActive[LED_COUNT];
extern int16_t userGeometryRuntimeButtonStepsFromC[LED_COUNT];
extern colorDef userGeometryRuntimeButtonColor[LED_COUNT];
extern uint8_t userGeometryRuntimeDeviceRotation;
extern uint8_t userGeometryRuntimeButtonOutputMode[LED_COUNT];
extern uint8_t userGeometryRuntimeButtonMidiNote[LED_COUNT];
extern uint8_t userGeometryRuntimeButtonMidiChannel[LED_COUNT];
extern uint8_t userGeometryRuntimeButtonChordActionId[LED_COUNT];
extern uint8_t userGeometryRuntimeButtonChordRootMidiNote[LED_COUNT];
extern UserGeometryChordAction userGeometryRuntimeChordActions[USER_GEOMETRY_MAX_CHORD_ACTIONS];

extern wheelDef modWheel;
extern wheelDef pbWheel;
extern wheelDef velWheel;
extern bool toggleWheel;

extern bool delegatedControl;
extern uint32_t delegatedColors[LED_COUNT];
constexpr byte DELEGATED_APP_NAME_MAX = 20;
extern char delegatedAppName[DELEGATED_APP_NAME_MAX + 1];
extern bool delegatedDisplayDirty;
extern bool delegatedDisplayWakeRequested;
extern bool delegatedReturnToMenuRequested;
extern byte delegatedNoteMapChannel[LED_COUNT];
extern byte delegatedNoteMapNote[LED_COUNT];
extern byte delegatedActiveChannel[LED_COUNT];
extern byte delegatedActiveNote[LED_COUNT];
constexpr byte SYSEX_DELEGATED_ENTER = 1;
constexpr byte SYSEX_DELEGATED_EXIT = 2;
constexpr byte SYSEX_LED = 3;
constexpr byte SYSEX_DELEGATED_NOTE_MAP = 4;
constexpr byte SYSEX_DELEGATED_NOTE_MAP_RESET = 5;
constexpr byte SYSEX_DELEGATED_ENCODER_EVENT = 6;
constexpr byte DELEGATED_ENCODER_UP = 1;
constexpr byte DELEGATED_ENCODER_DOWN = 2;
constexpr byte DELEGATED_ENCODER_BUTTON_PRESS = 3;
constexpr byte DELEGATED_ENCODER_BUTTON_RELEASE = 4;
constexpr uint64_t DELEGATED_EXIT_HOLD_MICROS = 5000000ULL;

void setupPins();
void setupGrid();
void detectHardwareVersion();
bool hardwareDefaultRotaryInvert();
void resetDelegatedNoteMap();
void clearDelegatedNoteActivity();
