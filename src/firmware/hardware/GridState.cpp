#include "../FirmwareModule.h"
#include "GridState.h"
#include "../app/DiagnosticsTiming.h"
#include "../app/PlatformCommon.h"
#include "../app/RuntimeDefaults.h"

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
/*
    Of the 140 buttons, 7 are offset to the bottom left
    quadrant of the Hexboard and are reserved as command
    buttons. Their LED reference is pre-defined here.
    If you want those seven buttons remapped to play
    notes, you may wish to change or remove these
    variables and alter the value of CMDCOUNT to agree
    with how many buttons you reserve for non-note use.
  */
const byte mPin[] = {
  MPLEX_1_PIN, MPLEX_2_PIN, MPLEX_4_PIN, MPLEX_8_PIN
};
const byte cPin[] = {
  COLUMN_PIN_0, COLUMN_PIN_1, COLUMN_PIN_2, COLUMN_PIN_3,
  COLUMN_PIN_4, COLUMN_PIN_5, COLUMN_PIN_6,
  COLUMN_PIN_7, COLUMN_PIN_8, COLUMN_PIN_9
};
extern const byte assignCmd[CMDCOUNT] = {
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

char userGeometryRuntimeKeyLabelStorage[MAX_SCALE_DIVISIONS][TUNING_KEY_LABEL_LENGTH] = {};
bool userGeometryRuntimeActive = false;
bool userGeometryRuntimeScaleActive = false;
bool userGeometryRuntimePaletteActive = false;
bool userGeometryRuntimeTuningObjectSelected = false;
bool userGeometryRuntimeLayoutObjectSelected = false;
bool userGeometryRuntimeScaleObjectSelected = false;
uint8_t userGeometryRuntimeTuningObjectId[16] = {};
uint8_t userGeometryRuntimeLayoutObjectId[16] = {};
uint8_t userGeometryRuntimeScaleObjectId[16] = {};
bool userGeometryRuntimeCentsTableActive = false;
bool userGeometryRuntimeExactEdoActive = false;
uint8_t userGeometryRuntimeTuningKind = 0;
uint16_t userGeometryRuntimeCycleLength = 0;
uint16_t userGeometryRuntimeCentsTableLength = 0;
float userGeometryRuntimeCentsTable[MAX_SCALE_DIVISIONS] = {};
float userGeometryRuntimePeriodCents = 1200.0f;
uint8_t userGeometryRuntimeReferenceMidiNote = 69;
float userGeometryRuntimeReferenceHz = 440.0f;
tuningDef userGeometryRuntimeTuning = { "User Tuning", 12, 100.0f, { { "0", -9 } } };
layoutDef userGeometryRuntimeLayout = { "User Layout", false, 65, 1, -2, TUNING_12EDO };
scaleDef userGeometryRuntimeScale = { "User Scale", TUNING_12EDO, { 0 } };
paletteDef userGeometryRuntimePalette = {};
bool userGeometryRuntimeButtonDisabled[LED_COUNT] = {};
uint8_t userGeometryRuntimeButtonRole[LED_COUNT] = {};
bool userGeometryRuntimeButtonRoleOverride[LED_COUNT] = {};
bool userGeometryRuntimeButtonNoteOverride[LED_COUNT] = {};
bool userGeometryRuntimeButtonColorActive[LED_COUNT] = {};
int16_t userGeometryRuntimeButtonStepsFromC[LED_COUNT] = {};
colorDef userGeometryRuntimeButtonColor[LED_COUNT] = {};
uint8_t userGeometryRuntimeDeviceRotation = DEVICE_ROTATION_PORTRAIT;
int16_t userGeometryRuntimeLayoutCenterStepsFromC = 0;
uint8_t userGeometryRuntimeButtonOutputMode[LED_COUNT] = {};
uint8_t userGeometryRuntimeButtonMidiNote[LED_COUNT] = {};
uint8_t userGeometryRuntimeButtonMidiChannel[LED_COUNT] = {};
uint8_t userGeometryRuntimeButtonChordActionId[LED_COUNT] = {};
uint8_t userGeometryRuntimeButtonChordRootMidiNote[LED_COUNT] = {};
UserGeometryChordAction userGeometryRuntimeChordActions[USER_GEOMETRY_MAX_CHORD_ACTIONS] = {};

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
char delegatedAppName[DELEGATED_APP_NAME_MAX + 1] = "Host Application";
bool delegatedDisplayDirty = false;
bool delegatedDisplayWakeRequested = false;
bool delegatedReturnToMenuRequested = false;
byte delegatedNoteMapChannel[LED_COUNT];
byte delegatedNoteMapNote[LED_COUNT];
byte delegatedActiveChannel[LED_COUNT];
byte delegatedActiveNote[LED_COUNT];
void resetDelegatedNoteMap() {
  for (byte i = 0; i < LED_COUNT; ++i) {
    delegatedNoteMapChannel[i] = static_cast<byte>((i / 100) + 1);
    delegatedNoteMapNote[i] = i % 100;
  }
}

void clearDelegatedNoteActivity() {
  for (byte i = 0; i < LED_COUNT; ++i) {
    delegatedActiveChannel[i] = 0;
    delegatedActiveNote[i] = UNUSED_NOTE;
  }
}

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
  resetDelegatedNoteMap();
  clearDelegatedNoteActivity();
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

bool hardwareDefaultRotaryInvert() {
  return Hardware_Version == HARDWARE_V1_2;
}
