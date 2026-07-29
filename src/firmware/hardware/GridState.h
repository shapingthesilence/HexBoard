#pragma once

#include "../FirmwareModule.h"
#include "HardwareConfig.h"
#include "../model/ScalePalettePreset.h"

constexpr byte BTN_STATE_OFF = 0;
constexpr byte BTN_STATE_NEWPRESS = 1;
constexpr byte BTN_STATE_RELEASED = 2;
constexpr byte BTN_STATE_HELD = 3;
constexpr uint8_t WHEEL_MAX_CATCHUP_STEPS = 8;

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

extern wheelDef modWheel;
extern wheelDef pbWheel;
extern wheelDef velWheel;
extern bool toggleWheel;

constexpr byte DELEGATED_APP_NAME_MAX = 20;
struct DelegatedControlState {
  std::atomic<bool> active{false};
  std::array<std::atomic<uint32_t>, LED_COUNT> colors = {};
  std::array<std::atomic<char>, DELEGATED_APP_NAME_MAX + 1> appName = {};
  std::atomic<bool> displayDirty{false};
  std::atomic<bool> displayWakeRequested{false};
  std::atomic<bool> returnToMenuRequested{false};
  std::array<std::atomic<byte>, LED_COUNT> noteMapChannel = {};
  std::array<std::atomic<byte>, LED_COUNT> noteMapNote = {};
  std::array<std::atomic<byte>, LED_COUNT> activeChannel = {};
  std::array<std::atomic<byte>, LED_COUNT> activeNote = {};
};

extern DelegatedControlState delegatedControlState;
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
