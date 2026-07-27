#include "../FirmwareModule.h"
#include "LedAnimations.h"
#include "GridState.h"
#include "../app/DiagnosticsTiming.h"
#include "../app/PlatformCommon.h"
#include "../app/RuntimeDefaults.h"
#include "../tuning/Tuning.h"

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

bool hexCanOriginateAnimation(byte hexIndex) {
  return !h[hexIndex].isCmd
         && h[hexIndex].note != UNUSED_NOTE
         && (h[hexIndex].inScale || !scaleLock);
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
  if (animationType == ANIMATE_OCTAVE) {
    bool heldPitchClass[MAX_SCALE_DIVISIONS] = {};
    uint8_t cycleLength = current.tuning().cycleLength;
    if (cycleLength == 0 || cycleLength > MAX_SCALE_DIVISIONS) {
      return;
    }

    for (byte i = 0; i < LED_COUNT; ++i) {
      if (hexCanOriginateAnimation(i) && h[i].MIDIch) {
        heldPitchClass[positiveMod(h[i].stepsFromC, cycleLength)] = true;
      }
    }
    for (byte j = 0; j < LED_COUNT; ++j) {
      if (!h[j].isCmd && !h[j].MIDIch && heldPitchClass[positiveMod(h[j].stepsFromC, cycleLength)]) {
        h[j].animate = true;
      }
    }
    return;
  }

  std::array<int16_t, LED_COUNT> heldSteps = {};
  uint8_t heldStepCount = 0;
  for (byte i = 0; i < LED_COUNT; ++i) {
    if (!hexCanOriginateAnimation(i) || !h[i].MIDIch) {
      continue;
    }
    bool alreadyTracked = false;
    for (uint8_t stepIndex = 0; stepIndex < heldStepCount; ++stepIndex) {
      if (heldSteps[stepIndex] == h[i].stepsFromC) {
        alreadyTracked = true;
        break;
      }
    }
    if (!alreadyTracked && heldStepCount < heldSteps.size()) {
      heldSteps[heldStepCount++] = h[i].stepsFromC;
    }
  }

  for (byte j = 0; j < LED_COUNT; ++j) {
    if (h[j].isCmd || h[j].MIDIch) {
      continue;
    }
    for (uint8_t stepIndex = 0; stepIndex < heldStepCount; ++stepIndex) {
      if (heldSteps[stepIndex] == h[j].stepsFromC) {
        h[j].animate = true;
        break;
      }
    }
  }
}
void animateOrbit() {
  const byte SLOW_FACTOR = 1;   // Slowdown factor for animation

  for (byte i = 0; i < LED_COUNT; ++i) {   // Check every hex
    if (!hexCanOriginateAnimation(i) || !h[i].MIDIch) {
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
    if (!hexCanOriginateAnimation(i)) {
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
    if (!hexCanOriginateAnimation(i)) {
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
    if (!hexCanOriginateAnimation(i)) {
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
