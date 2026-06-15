#if HEXBOARD_FIRMWARE_UNITY

#include "../FirmwareModule.h"
#include "CommandButtons.h"
#include "HardwareConfig.h"
#include "../midi/DelegatedControl.h"
#include "GridScanRotary.h"
#include "../menu/MenuAndDisplay.h"
#include "../menu/PlayedNotesOverlay.h"

// @interface
/*
    This section of the code handles reading
    the rotary knob and physical hex buttons.

    Documentation:
      Rotary knob code derived from:
        https://github.com/buxtronix/arduino/tree/master/libraries/Rotary
    Copyright 2011 Ben Buxton. Licenced under the GNU GPL Version 3.
    Contact: bb@cactii.net

    when the mechanical rotary knob is turned,
    the two pins go through a set sequence of
    states during one physical "click", as follows:
      Direction          Binary state of pin A\B
      Counterclockwise = 1\1, 0\1, 0\0, 1\0, 1\1
      Clockwise        = 1\1, 1\0, 0\0, 0\1, 1\1

    The neutral state of the knob is 1\1; a turn
    is complete when 1\1 is reached again after
    passing through all the valid states above,
    at which point action should be taken depending
    on the direction of the turn.

    The variable rotaryState stores all of this
    data and refreshes it each loop of the 2nd processor.
      Value    Meaning
      0, 4     Knob is in neutral state
      1, 2, 3  CCW turn state 1, 2, 3
      5, 6, 7  CW  turn state 1, 2, 3
      8, 16    Completed turn CCW, CW
  */
byte rotaryState = 0;
byte rotaryStateTable[8][4] = {
  { 0, 5, 1, 0 }, { 2, 0, 1, 0 }, { 2, 3, 1, 0 }, { 2, 3, 0, 8 }, { 0, 5, 1, 0 }, { 6, 5, 0, 0 }, { 6, 5, 7, 0 }, { 6, 0, 7, 16 }
};
byte storeRotaryTurn = 0;
bool rotaryButtonPressed = false;
constexpr uint64_t ROTARY_PANIC_HOLD_MICROS = 2000000ULL;  // 2 seconds
uint64_t rotaryPressStart = 0;
bool rotaryPanicLatched = false;
bool rotaryPanicSuppressClick = false;

void RAM_FUNC(readHexes)() {

  // Optimized button reading using SIO registers - much faster!
  for (byte r = 0; r < ROWCOUNT; r++) {       // Iterate through each row via the multiplexer.
    sio_hw->gpio_clr = multiplexerMask;       // Set all multiplexer pins to LOW.
    sio_hw->gpio_set = rowSelectMask[r];      // Set the current row's select pins HIGH.
    busy_wait_us_32(12);                      // Allow the row selection to settle without blocking interrupts.
    uint32_t a = sio_hw->gpio_in;             // Reads all GPIO pins at once into a variable
    uint32_t b = sio_hw->gpio_in;             // optional second sample
    uint32_t stable = a & b;                  // double-sample filtering to reduce noise
    uint16_t base = r * COLCOUNT;             // base index for this row - less multiplication in the loop
    for (byte c = 0; c < COLCOUNT; ++c) {     // Now iterate through each of the column pins
      byte i = base + c;                      // index of this button
      bool didYouPressHex = ((stable & columnMasks[c]) == 0); // check if this column pin is LOW
      h[i].interpBtnPress(didYouPressHex);    // interpret the button press as new press, held, released, or inactive
      if (h[i].btnState == BTN_STATE_NEWPRESS) {
        h[i].timePressed = runTime;  // log the time
      }
    }
  }

  for (byte i = 0; i < BTN_COUNT; i++) {  // For all buttons in the deck
    switch (h[i].btnState) {
      case BTN_STATE_NEWPRESS:  // just pressed
        if (delegatedControl) {
          delegatedButtonEvent(i, true);
        } else if (h[i].isCmd) {
          cmdOn(i);
        } else if (h[i].inScale || (!scaleLock)) {
          tryMIDInoteOn(i);
          trySynthNoteOn(i);
        }
        break;
      case BTN_STATE_RELEASED:  // just released
        if (delegatedControl) {
          delegatedButtonEvent(i, false);
        } else if (h[i].isCmd) {
          cmdOff(i);
        } else if (h[i].inScale || (!scaleLock)) {
          tryMIDInoteOff(i);
          trySynthNoteOff(i);
        }
        break;
      case BTN_STATE_HELD:  // held
        break;
      default:  // inactive
        break;
    }
  }
}
void RAM_FUNC(updateWheels)() {
  if (delegatedControl) {
    return;
  }
  velWheel.setTargetValue();
  bool upd = velWheel.updateValue(runTime);
  if (upd) {
    sendToLog("vel became " + std::to_string(velWheel.curValue));
  }
  if (toggleWheel) {
    pbWheel.setTargetValue();
    upd = pbWheel.updateValue(runTime);
    if (upd) {
      sendMIDIpitchBendToCh1();
      updateSynthWithNewFreqs();
    }
  } else {
    modWheel.setTargetValue();
    upd = modWheel.updateValue(runTime);
    if (upd) {
      sendMIDImodulationToCh1();
    }
  }
}
void setupRotary() {
  pinMode(ROT_PIN_A, INPUT_PULLUP);
  pinMode(ROT_PIN_B, INPUT_PULLUP);
  pinMode(ROT_PIN_C, INPUT_PULLUP);
}
void RAM_FUNC(readKnob)() {
  byte encoderPhase = (digitalRead(ROT_PIN_B) << 1) | digitalRead(ROT_PIN_A);
  rotaryState = rotaryStateTable[rotaryState & 7][encoderPhase];
  if (rotaryState & 24) {
    storeRotaryTurn = rotaryState;
  }
}
void dealWithRotary() {
  bool buttonPressed = (digitalRead(ROT_PIN_C) == LOW);
  bool justPressed = (!rotaryButtonPressed && buttonPressed);
  bool justReleased = (rotaryButtonPressed && !buttonPressed);

  if (delegatedControl) {
    if (justPressed) {
      rotaryPressStart = runTime;
      rotaryPanicLatched = false;
      rotaryPanicSuppressClick = false;
      wakeDelegatedControlScreenForInput();
      sendDelegatedEncoderEvent(DELEGATED_ENCODER_BUTTON_PRESS);
    } else if (buttonPressed && (rotaryPressStart != 0) && (!rotaryPanicLatched)) {
      if ((runTime - rotaryPressStart) >= DELEGATED_EXIT_HOLD_MICROS) {
        sendDelegatedEncoderEvent(DELEGATED_ENCODER_BUTTON_RELEASE);
        exitDelegatedControl();
        rotaryPanicLatched = true;
        rotaryPanicSuppressClick = true;
        storeRotaryTurn = 0;
      }
    }

    if (delegatedControl && storeRotaryTurn != 0) {
      bool turnIsClockwise = (storeRotaryTurn == 8);
      byte event = rotaryInvert
                     ? (turnIsClockwise ? DELEGATED_ENCODER_DOWN : DELEGATED_ENCODER_UP)
                     : (turnIsClockwise ? DELEGATED_ENCODER_UP : DELEGATED_ENCODER_DOWN);
      wakeDelegatedControlScreenForInput();
      sendDelegatedEncoderEvent(event);
      storeRotaryTurn = 0;
    }

    if (delegatedControl && justReleased && !rotaryPanicSuppressClick) {
      wakeDelegatedControlScreenForInput();
      sendDelegatedEncoderEvent(DELEGATED_ENCODER_BUTTON_RELEASE);
    }

    if (justReleased || !buttonPressed) {
      rotaryPressStart = 0;
      rotaryPanicLatched = false;
    }
    if (rotaryPanicSuppressClick && !buttonPressed && !rotaryButtonPressed) {
      rotaryPanicSuppressClick = false;
    }
    rotaryButtonPressed = buttonPressed;
    return;
  }

  if (justPressed) {
    rotaryPressStart = runTime;
    rotaryPanicLatched = false;
  } else if (buttonPressed && (rotaryPressStart != 0) && (!rotaryPanicLatched)) {
    if ((runTime - rotaryPressStart) >= ROTARY_PANIC_HOLD_MICROS) {
      panicStopOutput();
      rotaryPanicLatched = true;
      rotaryPanicSuppressClick = true;
    }
  }

  if (menu.readyForKey()) {
    if (justReleased && !rotaryPanicSuppressClick) {
      dismissPlayedNotesOverlayForMenuInput();
      menu.registerKeyPress(GEM_KEY_OK);
      noteOverlayDirty = true;
      screenTime = 0;
    }
    if (storeRotaryTurn != 0) {
      bool turnIsClockwise = (storeRotaryTurn == 8);
      dismissPlayedNotesOverlayForMenuInput();
      menu.registerKeyPress(rotaryInvert
                              ? (turnIsClockwise ? GEM_KEY_DOWN : GEM_KEY_UP)
                              : (turnIsClockwise ? GEM_KEY_UP : GEM_KEY_DOWN));
      noteOverlayDirty = true;
      storeRotaryTurn = 0;
      screenTime = 0;
    }
  }

  if (justReleased || !buttonPressed) {
    rotaryPressStart = 0;
    rotaryPanicLatched = false;
  }

  if (rotaryPanicSuppressClick && !buttonPressed && !rotaryButtonPressed) {
    rotaryPanicSuppressClick = false;
  }

  rotaryButtonPressed = buttonPressed;
}

void setupHardware() {
  if (Hardware_Version == HARDWARE_V1_2) {
    midiD = MIDID_USB | MIDID_SER;
    installHardwareSpecificMenuItems();
  }
  syncAudioDestinationToRuntime();
}
#endif  // HEXBOARD_FIRMWARE_UNITY
