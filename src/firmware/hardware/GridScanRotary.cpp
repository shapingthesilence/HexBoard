#include "../FirmwareModule.h"
#include "CommandButtons.h"
#include "GridState.h"
#include "HardwareConfig.h"
#include "../app/DiagnosticsTiming.h"
#include "../app/PlatformCommon.h"
#include "../app/RuntimeDefaults.h"
#include "../midi/MidiRouting.h"
#include "../midi/MidiTransport.h"
#include "../midi/DelegatedControl.h"
#include "../midi/NoteDispatch.h"
#include "../sequencer/SequencerMode.h"
#include "GridScanRotary.h"
#include "../menu/CommandWheelOverlay.h"
#include "../menu/MenuAndDisplay.h"
#include "../menu/PlayedNotesOverlay.h"
#include "../menu/VirtualListMenu.h"
#include "../synth/SynthAudio.h"

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
byte lastVelocityWheelGestureMask = 0;
byte lastModulationWheelGestureMask = 0;
byte lastPitchBendWheelGestureMask = 0;

namespace {
bool encoderCommandConsumed[3] = {}; // command buttons 0, 1, and 6
byte simulatedRotaryTurn = 0;
}

constexpr uint64_t COMMAND_WHEEL_UPDATE_INTERVAL_MICROS = 10000ULL;

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

  // Reserve the modifier from its wheel action; latch chord keys until release.
  const bool shortcutEnabled = commandEncoder && !delegatedControlState.active
    && !presetSyncTransferActive;
  const bool modifierHeld = shortcutEnabled && (h[assignCmd[6]].btnState & 1);
  const byte shortcutCommands[3] = {0, 1, 6};
  for (byte slot = 0; slot < 3; ++slot) {
    const byte state = h[assignCmd[shortcutCommands[slot]]].btnState;
    if (state == BTN_STATE_OFF) encoderCommandConsumed[slot] = false;
    if (modifierHeld && (slot == 2 || state == BTN_STATE_NEWPRESS)) {
      encoderCommandConsumed[slot] = true;
      if (slot < 2) {
        const bool down = slot == 1;
        simulatedRotaryTurn = (down == rotaryInvert) ? 8 : 16;
      }
    }
  }

  for (byte i = 0; i < BTN_COUNT; i++) {  // For all buttons in the deck
    if ((i == assignCmd[0] && encoderCommandConsumed[0])
        || (i == assignCmd[1] && encoderCommandConsumed[1])
        || (i == assignCmd[6] && encoderCommandConsumed[2])) continue;
    switch (h[i].btnState) {
      case BTN_STATE_NEWPRESS:  // just pressed
        if (presetSyncTransferActive) {
          break;
        } else if (delegatedControlState.active) {
          delegatedButtonEvent(i, true);
        } else if (h[i].isCmd) {
          cmdOn(i);
        } else if (sequencerModeActive()) {
          handleSequencerButtonEvent(i, true);
        } else if (mappedButtonHasAdvancedAction(i)) {
          tryMappedButtonActionOn(i);
        } else if (h[i].note != UNUSED_NOTE && (h[i].inScale || !scaleLock)) {
          tryMIDInoteOn(i);
          trySynthNoteOn(i);
        }
        break;
      case BTN_STATE_RELEASED:  // just released
        if (delegatedControlState.active) {
          delegatedButtonEvent(i, false);
        } else if (h[i].isCmd) {
          cmdOff(i);
        } else if (sequencerModeActive()) {
          handleSequencerButtonEvent(i, false);
        } else if (mappedButtonHasAdvancedAction(i)) {
          tryMappedButtonActionOff(i);
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

static void RAM_FUNC(notifyCommandWheelValue)(CommandWheelOverlayType type,
                                              const wheelDef& wheel) {
  notifyCommandWheelOverlay(type,
                            wheel.curValue,
                            wheel.minValue,
                            wheel.maxValue);
}

static byte RAM_FUNC(commandWheelGestureMask)(const wheelDef& wheel) {
  if (*wheel.alternateMode && (*wheel.midBtn >> 1)) {
    byte mask = 0;
    if (*wheel.topBtn == BTN_STATE_NEWPRESS) {
      mask |= 0b100;
    }
    if (*wheel.botBtn == BTN_STATE_NEWPRESS) {
      mask |= 0b001;
    }
    return mask;
  }

  byte mask = 0;
  if (*wheel.topBtn >> 1) {
    mask |= 0b100;
  }
  if (*wheel.midBtn >> 1) {
    mask |= 0b010;
  }
  if (*wheel.botBtn >> 1) {
    mask |= 0b001;
  }
  return mask;
}

static void RAM_FUNC(notifyCommandWheelGesture)(CommandWheelOverlayType type,
                                                const wheelDef& wheel,
                                                int16_t previousTarget,
                                                byte& lastGestureMask) {
  byte gestureMask = commandWheelGestureMask(wheel);
  bool targetChanged = wheel.targetValue != previousTarget;
  bool newGesture = gestureMask != 0 && gestureMask != lastGestureMask;

  if (targetChanged || newGesture) {
    notifyCommandWheelValue(type, wheel);
  }

  lastGestureMask = gestureMask;
}

void RAM_FUNC(updateWheels)() {
  if (delegatedControlState.active) {
    return;
  }

  const byte shortcutCommands[3] = {0, 1, 6};
  byte savedStates[3];
  for (byte slot = 0; slot < 3; ++slot) {
    savedStates[slot] = h[assignCmd[shortcutCommands[slot]]].btnState;
    if (encoderCommandConsumed[slot]) h[assignCmd[shortcutCommands[slot]]].btnState = BTN_STATE_OFF;
  }
  int16_t previousVelocityTarget = velWheel.targetValue;
  velWheel.setTargetValue();
  notifyCommandWheelGesture(CommandWheelOverlayType::Velocity,
                            velWheel,
                            previousVelocityTarget,
                            lastVelocityWheelGestureMask);
  bool upd = velWheel.updateValue(runTime, COMMAND_WHEEL_UPDATE_INTERVAL_MICROS);
  if (upd) {
    setSynthMasterVolumeControl(static_cast<byte>(velWheel.curValue));
    sendToLog("vel became " + std::to_string(velWheel.curValue));
    if (commandWheelOverlayActive()) {
      notifyCommandWheelValue(CommandWheelOverlayType::Velocity, velWheel);
    }
  }
  if (toggleWheel) {
    int16_t previousPitchBendTarget = pbWheel.targetValue;
    pbWheel.setTargetValue();
    notifyCommandWheelGesture(CommandWheelOverlayType::PitchBend,
                              pbWheel,
                              previousPitchBendTarget,
                              lastPitchBendWheelGestureMask);
    upd = pbWheel.updateValue(runTime, COMMAND_WHEEL_UPDATE_INTERVAL_MICROS);
    if (upd) {
      if (commandWheelOverlayActive()) {
        notifyCommandWheelValue(CommandWheelOverlayType::PitchBend, pbWheel);
      }
      sendMIDIpitchBendToCh1();
      updateSynthWithNewFreqs();
    }
  } else {
    int16_t previousModulationTarget = modWheel.targetValue;
    modWheel.setTargetValue();
    notifyCommandWheelGesture(CommandWheelOverlayType::Modulation,
                              modWheel,
                              previousModulationTarget,
                              lastModulationWheelGestureMask);
    upd = modWheel.updateValue(runTime, COMMAND_WHEEL_UPDATE_INTERVAL_MICROS);
    if (upd) {
      if (commandWheelOverlayActive()) {
        notifyCommandWheelValue(CommandWheelOverlayType::Modulation, modWheel);
      }
      sendMIDImodulationToCh1();
    }
  }
  for (byte slot = 0; slot < 3; ++slot) {
    h[assignCmd[shortcutCommands[slot]]].btnState = savedStates[slot];
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
  if (delegatedControlState.active || presetSyncTransferActive || !commandEncoder) simulatedRotaryTurn = 0;
  byte& turn = simulatedRotaryTurn != 0 ? simulatedRotaryTurn : storeRotaryTurn;
  bool buttonPressed = (digitalRead(ROT_PIN_C) == LOW);
  bool justPressed = (!rotaryButtonPressed && buttonPressed);
  bool justReleased = (rotaryButtonPressed && !buttonPressed);

  if (delegatedControlState.active) {
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
        turn = 0;
      }
    }

    if (delegatedControlState.active && turn != 0) {
      bool turnIsClockwise = (turn == 8);
      byte event = rotaryInvert
                     ? (turnIsClockwise ? DELEGATED_ENCODER_DOWN : DELEGATED_ENCODER_UP)
                     : (turnIsClockwise ? DELEGATED_ENCODER_UP : DELEGATED_ENCODER_DOWN);
      wakeDelegatedControlScreenForInput();
      sendDelegatedEncoderEvent(event);
      turn = 0;
    }

    if (delegatedControlState.active && justReleased && !rotaryPanicSuppressClick) {
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

  if (presetSyncTransferActive) {
    turn = 0;
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

  bool navigationTurnReady =
    (turn != 0) && u8g2.readyForNavigationInput();

  if (navigationTurnReady || (justReleased && !rotaryPanicSuppressClick)) {
    dismissFlashSaveScreenForMenuInput();
  }

  if (sequencerModeActive() && navigationTurnReady) {
    bool turnIsClockwise = (turn == 8);
    int8_t direction = rotaryInvert
                         ? (turnIsClockwise ? 1 : -1)
                         : (turnIsClockwise ? -1 : 1);
    if (handleSequencerRotaryTurn(direction)) {
      turn = 0;
      navigationTurnReady = false;
      screenTime = 0;
    }
  }

  if (sequencerModeActive() && justReleased && !rotaryPanicSuppressClick) {
    if (handleSequencerEncoderClick()) {
      noteOverlayDirty = true;
      screenTime = 0;
      rotaryPressStart = 0;
      rotaryPanicLatched = false;
      rotaryButtonPressed = buttonPressed;
      return;
    }
  }

  if (virtualListMenuIsActive()) {
    if (justReleased && !rotaryPanicSuppressClick) {
      dismissCommandWheelOverlay();
      dismissPlayedNotesOverlayForMenuInput();
      handleVirtualListMenuKey(GEM_KEY_OK);
      noteOverlayDirty = true;
      screenTime = 0;
    }
    if (navigationTurnReady) {
      bool turnIsClockwise = (turn == 8);
      dismissCommandWheelOverlay();
      dismissPlayedNotesOverlayForMenuInput();
      byte keyCode = rotaryInvert
                       ? (turnIsClockwise ? GEM_KEY_DOWN : GEM_KEY_UP)
                       : (turnIsClockwise ? GEM_KEY_UP : GEM_KEY_DOWN);
      handleVirtualListMenuKey(keyCode);
      noteOverlayDirty = true;
      turn = 0;
      screenTime = 0;
    }
  } else if (menu.readyForKey()) {
    if (justReleased && !rotaryPanicSuppressClick) {
      dismissCommandWheelOverlay();
      dismissPlayedNotesOverlayForMenuInput();
      if (!handleVirtualListLauncherKey(GEM_KEY_OK)) {
        menu.registerKeyPress(GEM_KEY_OK);
      }
      noteOverlayDirty = true;
      screenTime = 0;
    }
    if (navigationTurnReady) {
      bool turnIsClockwise = (turn == 8);
      dismissCommandWheelOverlay();
      dismissPlayedNotesOverlayForMenuInput();
      byte keyCode = rotaryInvert
                       ? (turnIsClockwise ? GEM_KEY_DOWN : GEM_KEY_UP)
                       : (turnIsClockwise ? GEM_KEY_UP : GEM_KEY_DOWN);
      menu.registerKeyPress(keyCode);
      noteOverlayDirty = true;
      turn = 0;
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
