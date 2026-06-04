#include "FirmwareModule.h"

#if HEXBOARD_FIRMWARE_UNITY

// @gridSystem
/*
    This section of the code handles the hex grid
       Hexagonal coordinates
         https://www.redblobgames.com/grids/hexagons/
         http://ondras.github.io/rot.js/manual/#hex/indexing
    The HexBoard contains a grid of 140 buttons with
    hexagonal keycaps. The processor has 10 pins connected
    to a multiplexing unit, which hotswaps between the 14 rows
    of ten buttons to allow all 140 inputs to be read in one
    program read cycle.
  */
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
/*
    There are 140 LED pixels on the Hexboard.
    LED instructions all go through the LED_PIN.
    It so happens that each LED pixel corresponds
    to one and only one hex button, so both a LED
    and its button can have the same index from 0-139.
    The scan matrix itself is 16x10, so BTN_COUNT is
    larger than LED_COUNT on purpose. The extra slots
    are used as internal "flag" positions that help
    with hardware detection and bookkeeping.
  */
constexpr byte LED_COUNT = 140;
constexpr byte COLCOUNT = 10;
constexpr byte ROWCOUNT = 16;
constexpr byte BTN_COUNT = COLCOUNT * ROWCOUNT;
constexpr byte FIRST_FLAG_BUTTON_INDEX = LED_COUNT;
/*
    Of the 140 buttons, 7 are offset to the bottom left
    quadrant of the Hexboard and are reserved as command
    buttons. Their LED reference is pre-defined here.
    If you want those seven buttons remapped to play
    notes, you may wish to change or remove these
    variables and alter the value of CMDCOUNT to agree
    with how many buttons you reserve for non-note use.
  */
constexpr byte CMDBTN_0 = 0;
constexpr byte CMDBTN_1 = 20;
constexpr byte CMDBTN_2 = 40;
constexpr byte CMDBTN_3 = 60;
constexpr byte CMDBTN_4 = 80;
constexpr byte CMDBTN_5 = 100;
constexpr byte CMDBTN_6 = 120;
constexpr byte CMDCOUNT = 7;
/*
    This class defines the hexagon button
    as an object. It stores all real-time
    properties of the button -- its coordinates,
    its current pressed state, the color
    codes to display based on what action is
    taken, what note and frequency is assigned,
    whether the button is a command or not,
    whether the note is in the selected scale,
    whether the button is flagged to be animated,
    and whether the note is currently
    sounding on MIDI / the synth.

    Needless to say, this is an important class.
  */
class buttonDef {
public:
#define BTN_STATE_OFF 0
#define BTN_STATE_NEWPRESS 1
#define BTN_STATE_RELEASED 2
#define BTN_STATE_HELD 3
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
  byte synthCh = 0;          // what synth polyphony ch this is playing on
  float frequency = 0.0;     // what frequency to ring on the synther
  int16_t jiRetune = 0;
  float jiFrequencyMultiplier = 1.0f;
  uint8_t externalNoteDepth = 0;  // number of active external MIDI notes mapped here
  int32_t midiNoteIndex = 0;      // extended MIDI note number before channel folding
  byte mappedMidiChannel = 0;     // preferred channel when not using MPE
};
/*
    This class is like a virtual wheel.
    It takes references / pointers to
    the state of three command buttons,
    translates presses of those buttons
    into wheel turns, and converts
    these movements into corresponding
    values within a range.

    This lets us generalize the
    behavior of a virtual pitch bend
    wheel or mod wheel using the same
    code, only needing to modify the
    range of output and the connected
    buttons to operate it.
  */
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
    if (temp != 0) {
      int step = effectiveStepValue();
      if ((givenTime - timeLastChanged) >= updateIntervalMicros()) {
        timeLastChanged = givenTime;
        if (abs(temp) < step) {
          curValue = targetValue;
        } else {
          curValue = curValue + (step * (temp / abs(temp)));
        }
        return true;
      } else {
        return false;
      }
    } else {
      return false;
    }
  }
};
const byte mPin[] = {
  MPLEX_1_PIN, MPLEX_2_PIN, MPLEX_4_PIN, MPLEX_8_PIN
};
const byte cPin[] = {
  COLUMN_PIN_0, COLUMN_PIN_1, COLUMN_PIN_2, COLUMN_PIN_3,
  COLUMN_PIN_4, COLUMN_PIN_5, COLUMN_PIN_6,
  COLUMN_PIN_7, COLUMN_PIN_8, COLUMN_PIN_9
};
const byte assignCmd[] = {
  CMDBTN_0, CMDBTN_1, CMDBTN_2, CMDBTN_3,
  CMDBTN_4, CMDBTN_5, CMDBTN_6
};

uint32_t multiplexerMask = 0;
uint32_t rowSelectMask[ROWCOUNT] = { 0 };
uint32_t columnMasks[COLCOUNT] = { 0 };

/*
    define h, which is a collection of all the
    logical scan slots in the matrix. Indices
    0-139 map to visible hexes, while the extra
    slots above LED_COUNT are internal flags.
  */
buttonDef h[BTN_COUNT];

wheelDef modWheel = { &wheelMode, &modSticky,
                      &h[assignCmd[4]].btnState, &h[assignCmd[5]].btnState, &h[assignCmd[6]].btnState,
                      0, 127, &modWheelSpeed, 0, 0, 0, 0 };
wheelDef pbWheel = { &wheelMode, &pbSticky,
                     &h[assignCmd[4]].btnState, &h[assignCmd[5]].btnState, &h[assignCmd[6]].btnState,
                     -8192, 8191, &pbWheelSpeed, 0, 0, 0, 0 };
wheelDef velWheel = { &wheelMode, &velSticky,
                      &h[assignCmd[0]].btnState, &h[assignCmd[1]].btnState, &h[assignCmd[2]].btnState,
                      0, 127, &velWheelSpeed, 96, 96, 96, 0 };

bool toggleWheel = false;  // false = mod wheel, true = pitch bend wheel

// Delegate control is intentionally external-only. It has no menu item and is
// not persisted; a host must enter/exit it via SysEx.
bool delegatedControl = false;
uint32_t delegatedColors[LED_COUNT];
constexpr byte SYSEX_DELEGATED_ENTER = 1;
constexpr byte SYSEX_DELEGATED_EXIT = 2;
constexpr byte SYSEX_LED = 3;

void setupPins() {
  const byte multiplexerPinCount = sizeof(mPin) / sizeof(mPin[0]);
  const byte columnPinCount = sizeof(cPin) / sizeof(cPin[0]);
  multiplexerMask = 0;
  for (byte p = 0; p < multiplexerPinCount; ++p) {
    byte pin = mPin[p];
    pinMode(pin, OUTPUT);
    multiplexerMask |= (1u << pin);
  }
  for (byte r = 0; r < ROWCOUNT; ++r) {
    uint32_t mask = 0;
    for (byte bit = 0; bit < sizeof(mPin); ++bit) {
      if ((r >> bit) & 1) {
        mask |= (1u << mPin[bit]);
      }
    }
    rowSelectMask[r] = mask;
  }
  for (byte p = 0; p < columnPinCount; ++p) {
    byte pin = cPin[p];
    pinMode(pin, INPUT_PULLUP);
    columnMasks[p] = (1u << pin);
  }
  sendToLog("Pins mounted");
}

void setupGrid() {
  for (byte i = 0; i < BTN_COUNT; i++) {
    h[i].coordRow = (i / 10);
    h[i].coordCol = (2 * (i % 10)) + (h[i].coordRow & 1);
    h[i].isCmd = false;
    h[i].note = UNUSED_NOTE;
    h[i].btnState = BTN_STATE_OFF;
    h[i].midiNoteIndex = 0;
    h[i].mappedMidiChannel = 0;
  }
  for (byte c = 0; c < CMDCOUNT; ++c) {
    h[assignCmd[c]].isCmd = 1;
    h[assignCmd[c]].note = CMDB + c;
  }
  // The extra matrix positions above LED_COUNT are never playable notes.
  for (byte i = FIRST_FLAG_BUTTON_INDEX; i < BTN_COUNT; ++i) {
    h[i].isCmd = true;
  }
  // On version 1.2, the first flag input is shorted (always connected).
  h[FIRST_FLAG_BUTTON_INDEX].note = HARDWARE_V1_2;
}

void detectHardwareVersion() {
  constexpr byte hardwareFlagIndex = FIRST_FLAG_BUTTON_INDEX;
  const byte targetRow = hardwareFlagIndex / 10;
  const byte targetColumn = hardwareFlagIndex % 10;
  byte columnPin = cPin[targetColumn];
  sio_hw->gpio_clr = multiplexerMask;
  sio_hw->gpio_set = rowSelectMask[targetRow];
  delayMicroseconds(14);
  bool flagPressed = (digitalRead(columnPin) == LOW);
  Hardware_Version = flagPressed ? HARDWARE_V1_2 : HARDWARE_V1_1;
  sendToLog("Hardware detection: revision " + std::to_string(Hardware_Version));
}


#endif  // HEXBOARD_FIRMWARE_UNITY
