#include "FirmwareModule.h"

#if HEXBOARD_FIRMWARE_UNITY

// @animate
/*
    This section of the code handles
    LED animation responsive to key
    presses
  */
/*
    The coordinate system used to locate hex buttons
    a certain distance and direction away relies on
    a preset array of coordinate offsets corresponding
    to each of the six linear directions on the hex grid.
    These cardinal directions are enumerated to make
    the code more legible for humans.
  */
constexpr byte HEX_DIRECTION_EAST = 0;
constexpr byte HEX_DIRECTION_NE = 1;
constexpr byte HEX_DIRECTION_NW = 2;
constexpr byte HEX_DIRECTION_WEST = 3;
constexpr byte HEX_DIRECTION_SW = 4;
constexpr byte HEX_DIRECTION_SE = 5;
constexpr byte HEX_DIRECTION_COUNT = 6;
constexpr byte ORBIT_POSITION_COUNT = 12;
constexpr byte MAX_BEAM_LENGTH = 13;
constexpr byte MAX_ANIMATION_RADIUS = 5;
// animation variables  E NE NW  W SW SE
constexpr std::array<int8_t, HEX_DIRECTION_COUNT> hexRowOffsets = { 0, -1, -1, 0, 1, 1 };
constexpr std::array<int8_t, HEX_DIRECTION_COUNT> hexColOffsets = { 2, 1, -1, -2, -1, 1 };

// Precomputed orbit offsets for animateOrbit().
// 12 positions around a hex at radius 2: 6 cardinal + 6 intermediate.
// Generated from: rowOffsets[d*2] = R*vertical[d], colOffsets[d*2] = R*horizontal[d],
//   rowOffsets[d*2+1] = R*(vertical[d]+vertical[(d+1)%6])/2, etc. with R=2.
static const int8_t orbitRowOffsets[ORBIT_POSITION_COUNT] = {  0, -1, -2, -2, -2, -1,  0,  1,  2,  2,  2,  1 };
static const int8_t orbitColOffsets[ORBIT_POSITION_COUNT] = {  4,  3,  2,  0, -2, -3, -4, -3, -2,  0,  2,  3 };

uint64_t animFrame(byte x) {
  if (h[x].timePressed) {  // 2^20 microseconds is close enough to 1 second
    return 1 + (((runTime - h[x].timePressed) * animationFPS) >> 20);
  } else {
    return 0;
  }
}

bool isValidHexCoordinate(int8_t row, int8_t col) {
  return !(row < 0
           || row >= ROWCOUNT
           || col < 0
           || col >= (2 * COLCOUNT)
           || ((col + row) & 1));
}

bool hexAllowsScaleAnimations(byte hexIndex) {
  return !h[hexIndex].isCmd && (h[hexIndex].inScale || !scaleLock);
}

void flagToAnimate(int8_t row, int8_t col) {
  if (!isValidHexCoordinate(row, col)) {
    return;
  }
  h[(COLCOUNT * row) + (col / 2)].animate = true;
}

void animateRing(byte centerIndex, byte radius, byte stepsPerSide) {
  int8_t turtleRow = h[centerIndex].coordRow + (radius * hexRowOffsets[HEX_DIRECTION_SW]);
  int8_t turtleCol = h[centerIndex].coordCol + (radius * hexColOffsets[HEX_DIRECTION_SW]);
  for (byte direction = HEX_DIRECTION_EAST; direction < HEX_DIRECTION_COUNT; ++direction) {
    for (byte step = 0; step < stepsPerSide; ++step) {
      flagToAnimate(turtleRow, turtleCol);
      turtleRow += (hexRowOffsets[direction] * (radius / stepsPerSide));
      turtleCol += (hexColOffsets[direction] * (radius / stepsPerSide));
    }
  }
}

void animateMirror() {
  for (byte i = 0; i < LED_COUNT; ++i) {                     // check every hex
    if (!h[i].isCmd && h[i].MIDIch) {                        // that is a held note
      for (byte j = 0; j < LED_COUNT; ++j) {                 // compare to every hex
        if (!h[j].isCmd && !h[j].MIDIch) {                   // that is a note not being played
          int16_t temp = h[i].stepsFromC - h[j].stepsFromC;  // look at difference between notes
          if (animationType == ANIMATE_OCTAVE) {             // set octave diff to zero if need be
            temp = positiveMod(temp, current.tuning().cycleLength);
          }
          if (temp == 0) {  // highlight if diff is zero
            h[j].animate = true;
          }
        }
      }
    }
  }
}
void animateOrbit() {
  const byte SLOW_FACTOR = 1;   // Slowdown factor for animation

  for (byte i = 0; i < LED_COUNT; ++i) {   // Check every hex
    if (!hexAllowsScaleAnimations(i) || !h[i].MIDIch) {
      continue;
    }

    byte frame = animFrame(i) / SLOW_FACTOR;               // Slow down the animation
    byte currentStep = frame % ORBIT_POSITION_COUNT;       // Determine position in the orbit

    // orbitRowOffsets/orbitColOffsets already encode a radius-2 orbit.
    int8_t light1Row = h[i].coordRow + orbitRowOffsets[currentStep];
    int8_t light1Col = h[i].coordCol + orbitColOffsets[currentStep];

    byte oppositeStep = (currentStep + (ORBIT_POSITION_COUNT / 2)) % ORBIT_POSITION_COUNT;
    int8_t light2Row = h[i].coordRow + orbitRowOffsets[oppositeStep];
    int8_t light2Col = h[i].coordCol + orbitColOffsets[oppositeStep];

    flagToAnimate(light1Row, light1Col);
    flagToAnimate(light2Row, light2Col);
  }
}

void animateStaticBeams() {
  static byte lastDirection[LED_COUNT] = { 255 };  // Track the last direction for each button (255 = uninitialized)

  for (byte i = 0; i < LED_COUNT; ++i) {  // Check every hex
    if (!hexAllowsScaleAnimations(i)) {
      continue;
    }

    if (h[i].btnState == BTN_STATE_NEWPRESS) {  // Button was just pressed
      uint64_t clockValue = readClock();        // Get system clock

      // Choose a new random direction, excluding the last one
      byte newDirection;
      do {
        newDirection = clockValue % 3;             // Randomly pick 0, 1, or 2
        clockValue /= 3;                           // Update clockValue for a new seed
      } while (newDirection == lastDirection[i]);  // Exclude last direction

      lastDirection[i] = newDirection;  // Store new direction
    }

    if (h[i].btnState == BTN_STATE_HELD || h[i].btnState == BTN_STATE_NEWPRESS) {  // Active button
      byte baseDirection = lastDirection[i] * 2;                                   // Convert to hex direction (0, 2, or 4)
      byte oppositeDirection = (baseDirection + 3) % HEX_DIRECTION_COUNT;          // Opposite direction

      // Light up the entire beam in both directions
      for (byte length = 1; length <= MAX_BEAM_LENGTH; ++length) {
        // Beam in primary direction
        int8_t beam1Row = h[i].coordRow + (length * hexRowOffsets[baseDirection]);
        int8_t beam1Col = h[i].coordCol + (length * hexColOffsets[baseDirection]);

        // Beam in opposite direction
        int8_t beam2Row = h[i].coordRow + (length * hexRowOffsets[oppositeDirection]);
        int8_t beam2Col = h[i].coordCol + (length * hexColOffsets[oppositeDirection]);

        // Flag both beams for animation
        flagToAnimate(beam1Row, beam1Col);
        flagToAnimate(beam2Row, beam2Col);
      }
    }
  }
}

void animateRadial() {
  for (byte i = 0; i < LED_COUNT; ++i) {                  // check every hex
    if (!hexAllowsScaleAnimations(i)) {
      continue;
    }

    uint64_t radius = animFrame(i);
    if ((radius > 0) && (radius < ROWCOUNT)) {                           // played in the last 16 frames
      byte steps = ((animationType == ANIMATE_SPLASH) ? radius : 1);     // star = 1 step to next corner; ring = 1 step per hex
      animateRing(i, static_cast<byte>(radius), steps);
    }
  }
}

void animateRadialReverse() {  //inverted splash/star
  for (byte i = 0; i < LED_COUNT; ++i) {                                          // Check every hex
    if (!hexAllowsScaleAnimations(i)) {
      continue;
    }

    uint64_t frame = animFrame(i);                                                // Current animation frame
    if ((frame > 0) && (frame < MAX_ANIMATION_RADIUS)) {                          // Played in the last X frames
      byte reverseRadius = static_cast<byte>(MAX_ANIMATION_RADIUS - frame);       // Calculate reverse radius
      byte steps = ((animationType == ANIMATE_SPLASH_REVERSE) ? reverseRadius : 1);
      animateRing(i, reverseRadius, steps);
    }
  }
}

constexpr uint64_t MIDI_IN_LED_COALESCE_MICROS = 1000;
constexpr uint64_t MIDI_IN_LED_MAX_DEFER_MICROS = 8000;

bool midiInLedDirty = false;
uint64_t midiInLedFirstDirtyTime = 0;
uint64_t midiInLedLastDirtyTime = 0;

void markMidiInLedDirty() {
  if (animationType != ANIMATE_MIDI_IN) {
    return;
  }
  uint64_t now = readClock();
  if (!midiInLedDirty) {
    midiInLedDirty = true;
    midiInLedFirstDirtyTime = now;
  }
  midiInLedLastDirtyTime = now;
}

bool shouldDeferMidiInLedRefresh() {
  if (!midiInLedDirty || animationType != ANIMATE_MIDI_IN) {
    return false;
  }

  uint64_t now = readClock();
  bool stillCoalescing = (now - midiInLedLastDirtyTime) < MIDI_IN_LED_COALESCE_MICROS;
  bool maxDeferReached = (now - midiInLedFirstDirtyTime) >= MIDI_IN_LED_MAX_DEFER_MICROS;
  if (stillCoalescing && !maxDeferReached) {
    return true;
  }

  midiInLedDirty = false;
  return false;
}

void RAM_FUNC(applyExternalMidiToHex)(byte midiNote, bool noteOn) {
  if (midiNote >= midiNoteToHexIndices.size()) {
    return;
  }
  auto& targets = midiNoteToHexIndices[midiNote];
  bool changed = false;
  for (uint8_t index : targets) {
    buttonDef& hex = h[index];
    if (noteOn) {
      if (hex.externalNoteDepth < 255) {
        hex.externalNoteDepth++;
        changed = true;
      }
    } else if (hex.externalNoteDepth > 0) {
      hex.externalNoteDepth--;
      changed = true;
    }
  }
  if (changed) {
    markMidiInLedDirty();
  }
}

bool reportDeviceIdentity(const uint8_t* data, const unsigned int len) {
  if (len == 6 && data[1] == 0x7E && data[3] == 0x06 && data[4] == 0x01) {
    // Respond to a device identity request.
    // TODO: 7D = educational/dev; replace when a manufacturer ID is assigned.
    static byte deviceIdentity[] = {
      0x7E, 0x00, 0x06, 0x02,             // Device ID response
      0x7D,                               // Educational/dev manufacturer ID
      0x01, 0x00,                         // Family, LSB-first
      0x01, 0x00,                         // Model, LSB-first
      Hardware_Version, 0x00, 0x00, 0x00  // Version, LSB-first
    };
    withMIDI([&](auto& M) { M.sendSysEx(sizeof(deviceIdentity), deviceIdentity); });
    return true;
  }
  return false;
}

void notePresetSyncTransferActivity(uint8_t message) {
  uint64_t now = readClock();
  if (!presetSyncTransferActive) {
    presetSyncTransferFrameCount = 0;
  }
  presetSyncTransferActive = true;
  presetSyncTransferLastActivity = now;
  presetSyncTransferDeadline = now + PRESET_SYNC_TRANSFER_TIMEOUT_MICROS;
  presetSyncTransferLastMessage = message;
  ++presetSyncTransferFrameCount;
}

void onToggleDelegated() {
  if (delegatedControl) {
    memset(delegatedColors, 0, sizeof(delegatedColors));
    // Reset parser state when entering delegated mode.
    setupMIDI();
  }
  sendToLog("delegated = " + std::to_string(delegatedControl));
}

void toggleDelegated() {
  delegatedControl = !delegatedControl;
  onToggleDelegated();
}

void delegatedButtonEvent(byte x, bool press) {
  byte channel = x / 100;  // 0-based hundreds digit
  byte note = x % 100;
  if (press) {
    withMIDI([&](auto& M) { M.sendNoteOn(note, 127, channel + 1); });
  } else {
    withMIDI([&](auto& M) { M.sendNoteOff(note, 0, channel + 1); });
  }
}

void processLedSysEx(const uint8_t* data, const unsigned int len) {
  // Repeated records: LED number (14 bits), hue (7 bits), saturation (7 bits), value (7 bits).
  for (unsigned int idx = 0; idx + 5 <= len; idx += 5) {
    uint16_t led = (data[idx] << 7) + data[idx + 1];
    if (led >= LED_COUNT) {
      sendToLog("LED SysEx: led " + std::to_string(led) + " is out of range; ignoring");
      continue;
    }
    byte hueData = data[idx + 2] & 0x7F;
    byte satData = data[idx + 3] & 0x7F;
    byte valData = data[idx + 4] & 0x7F;
    colorDef c = {
      static_cast<float>(hueData) * 360.0f / 127.0f,
      static_cast<byte>(2 * satData + (satData > 63 ? 1 : 0)),
      static_cast<byte>(2 * valData + (valData > 63 ? 1 : 0))
    };
    delegatedColors[led] = getLEDcode(c);
  }
}

void processDelegatedSysEx(const uint8_t* data, const unsigned int len) {
  if (len < 1) {
    return;
  }
  switch (data[0]) {
    case SYSEX_DELEGATED_ENTER:
      break;
    case SYSEX_DELEGATED_EXIT:
      toggleDelegated();
      break;
    case SYSEX_LED:
      processLedSysEx(&data[1], len - 1);
      break;
    default:
      sendToLog("ignoring unknown delegated SysEx code " + std::to_string(data[0]));
      break;
  }
}

bool processIncomingSysEx(const uint8_t* data, const unsigned int len) {
  if (reportDeviceIdentity(data, len)) {
    return true;
  }
  if (processPresetSyncSysEx(data, len)) {
    return true;
  }
  if ((len == 4) && (data[1] == 0x7D) && (data[2] == SYSEX_DELEGATED_ENTER)) {
    toggleDelegated();
    return true;
  }
  return false;
}

bool processIncomingDelegatedSysEx(const uint8_t* sysex, const unsigned int len) {
  if (len <= 3 || reportDeviceIdentity(sysex, len)) {
    return true;
  }
  if ((sysex[0] != 0xF0) || (sysex[len - 1] != 0xF7)) {
    sendToLog("invalid delegated SysEx received; ignoring");
    return true;
  }
  if (sysex[1] != 0x7D) {
    sendToLog("delegated incoming: ignoring SysEx vendor " + std::to_string(sysex[1]));
    return true;
  }
  if (processPresetSyncSysEx(sysex, len)) {
    return true;
  }
  processDelegatedSysEx(&sysex[2], len - 3);
  return true;
}

uint8_t midiDataLengthForStatus(uint8_t status) {
  switch (status & 0xF0) {
    case 0x80:
    case 0x90:
    case 0xA0:
    case 0xB0:
    case 0xE0:
      return 2;
    case 0xC0:
    case 0xD0:
      return 1;
    default:
      return 0;
  }
}

void processIncomingChannelMessage(uint8_t status, uint8_t data1, uint8_t data2, bool delegatedMode) {
  if (delegatedMode) {
    return;
  }

  switch (status & 0xF0) {
    case 0x80:
      applyExternalMidiToHex(data1, false);
      break;
    case 0x90:
      applyExternalMidiToHex(data1, data2 != 0);
      break;
    default:
      break;
  }
}

void dispatchIncomingSysEx(MidiInputParser& parser, bool delegatedMode) {
  if (delegatedMode) {
    processIncomingDelegatedSysEx(parser.sysex.data(), static_cast<unsigned int>(parser.sysex.size()));
  } else {
    processIncomingSysEx(parser.sysex.data(), static_cast<unsigned int>(parser.sysex.size()));
  }
  resetMidiInputParser(parser);
}

bool processIncomingMidiByte(MidiInputParser& parser, uint8_t value, bool delegatedMode) {
  if (value >= 0xF8) {
    return true;
  }

  if (parser.inSysEx) {
    if (value == 0xF0) {
      parser.sysex.clear();
    }
    if (parser.sysex.size() >= MIDI_SYSEX_BUFFER_MAX) {
      sendToLog("incoming SysEx exceeded buffer; discarded");
      resetMidiInputParser(parser);
      return true;
    }
    parser.sysex.push_back(value);
    if (value == 0xF7) {
      dispatchIncomingSysEx(parser, delegatedMode);
    }
    return true;
  }

  if (value == 0xF0) {
    resetMidiInputParser(parser);
    parser.inSysEx = true;
    parser.sysex.push_back(value);
    return true;
  }

  if (value & 0x80) {
    parser.status = value;
    parser.dataCount = 0;
    parser.dataNeeded = midiDataLengthForStatus(value);
    if (parser.dataNeeded > 0) {
      parser.runningStatus = value;
    } else {
      parser.runningStatus = 0;
    }
    return true;
  }

  if (parser.dataNeeded == 0) {
    if (parser.runningStatus == 0) {
      return true;
    }
    parser.status = parser.runningStatus;
    parser.dataNeeded = midiDataLengthForStatus(parser.status);
    parser.dataCount = 0;
  }

  if (parser.dataCount < sizeof(parser.data)) {
    parser.data[parser.dataCount++] = value & 0x7F;
  }

  if (parser.dataCount >= parser.dataNeeded) {
    processIncomingChannelMessage(parser.status, parser.data[0], parser.dataNeeded > 1 ? parser.data[1] : 0, delegatedMode);
    parser.dataCount = 0;
    parser.dataNeeded = midiDataLengthForStatus(parser.runningStatus);
    parser.status = parser.runningStatus;
  }

  return true;
}

bool processIncomingUsbMidi(bool delegatedMode) {
  bool processed = false;
  uint16_t drainedBytes = 0;
  while (MidiUSB.available() > 0 && drainedBytes < MIDI_INPUT_DRAIN_BYTE_LIMIT) {
    int value = MidiUSB.read();
    if (value < 0) {
      break;
    }
    ++drainedBytes;
    processed = processIncomingMidiByte(usbMidiInput, static_cast<uint8_t>(value), delegatedMode) || processed;
  }
  return processed || drainedBytes > 0;
}

bool processIncomingSerialMidi(bool delegatedMode) {
  bool processed = false;
  uint16_t drainedBytes = 0;
  while (Serial1.available() > 0 && drainedBytes < MIDI_INPUT_DRAIN_BYTE_LIMIT) {
    int value = Serial1.read();
    if (value < 0) {
      break;
    }
    ++drainedBytes;
    processed = processIncomingMidiByte(serialMidiInput, static_cast<uint8_t>(value), delegatedMode) || processed;
  }
  return processed || drainedBytes > 0;
}

bool processIncomingMIDIDelegated() {
  bool processed = false;
  if (midiD & MIDID_USB) {
    processed = processIncomingUsbMidi(true) || processed;
  }
  if (midiD & MIDID_SER) {
    processed = processIncomingSerialMidi(true) || processed;
  }
  return processed;
}

bool RAM_FUNC(processIncomingMIDI)() {
  if (delegatedControl) {
    return false;
  }
  bool processed = false;
  if (midiD & MIDID_USB) {
    processed = processIncomingUsbMidi(false) || processed;
  }
  if (midiD & MIDID_SER) {
    processed = processIncomingSerialMidi(false) || processed;
  }
  return processed;
}

void animateLEDs() {
  if (delegatedControl) {
    return;
  }
  for (byte i = 0; i < LED_COUNT; ++i) {
    h[i].animate = false;
  }
  switch (animationType) {
    case ANIMATE_BUTTON:
    case ANIMATE_NONE:
      break;
    case ANIMATE_STAR:
    case ANIMATE_SPLASH:
      animateRadial();
      break;
    case ANIMATE_ORBIT:
      animateOrbit();
      break;
    case ANIMATE_OCTAVE:
    case ANIMATE_BY_NOTE:
      animateMirror();
      break;
    case ANIMATE_BEAMS:
      animateStaticBeams();
      break;
    case ANIMATE_SPLASH_REVERSE:
    case ANIMATE_STAR_REVERSE:
      animateRadialReverse();
      break;
    case ANIMATE_MIDI_IN:
      for (byte i = 0; i < LED_COUNT; ++i) {
        if (h[i].externalNoteDepth > 0) {
          h[i].animate = true;
        }
      }
      break;
    default:
      break;
  }
}


#endif  // HEXBOARD_FIRMWARE_UNITY
