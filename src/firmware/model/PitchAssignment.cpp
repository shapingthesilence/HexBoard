#include "../FirmwareModule.h"
#include "PitchAssignment.h"
#include "../app/DiagnosticsTiming.h"
#include "../app/PlatformCommon.h"
#include "../app/RuntimeDefaults.h"
#include "../hardware/GridState.h"
#include "../hardware/LedRender.h"
#include "../midi/MidiRouting.h"
#include "../tuning/DynamicJustIntonation.h"

namespace {
int16_t layoutStepsForDelta(int8_t distCol, int8_t distRow, int8_t acrossSteps, int8_t dnLeftSteps) {
  return ((distCol * acrossSteps) + (distRow * (acrossSteps + (2 * dnLeftSteps)))) / 2;
}

void mirrorLayoutUpDown(int8_t& acrossSteps, int8_t& dnLeftSteps) {
  dnLeftSteps = -(acrossSteps + dnLeftSteps);  // y = -(x + y)
}

void mirrorLayoutLeftRight(int8_t& acrossSteps, int8_t& dnLeftSteps) {
  dnLeftSteps = acrossSteps + dnLeftSteps;  // y = x + y
  acrossSteps = -acrossSteps;               // x = -x
}

void rotateLayoutClockwise(int8_t& acrossSteps, int8_t& dnLeftSteps) {
  int8_t keyOffsetY = dnLeftSteps;
  int8_t keyOffsetX = acrossSteps;
  dnLeftSteps = keyOffsetX + keyOffsetY;
  keyOffsetY = dnLeftSteps;
  dnLeftSteps = -acrossSteps;
  acrossSteps = keyOffsetY;
}
}  // namespace

// @assignment
/*
    This section of the code contains broad
    procedures for assigning musical notes
    and related values to each button
    of the hex grid.
  */
// run this if the layout, key, or transposition changes, but not if color or scale changes
void assignPitches() {
  sendToLog("assignPitch was called:");
  for (auto& bucket : midiNoteToHexIndices) {
    bucket.clear();
  }
  int32_t lowestMidiIndex = std::numeric_limits<int32_t>::max();
  for (byte i = 0; i < LED_COUNT; i++) {
    if (!(h[i].isCmd)) {
      // Runtime tunings define which board step is the reference MIDI note.
      // Scale key changes do not alter the played pitch grid.
      int32_t relativeSteps = currentPitchStepsFromReference(h[i].stepsFromC);
      int32_t midiIndex = static_cast<int32_t>(currentTuningReferenceMidiNote()) + relativeSteps;
      h[i].midiNoteIndex = midiIndex;
      if (standardMidiMicrotonalActive && midiIndex < lowestMidiIndex) {
        lowestMidiIndex = midiIndex;
      }
    }
  }

  if (standardMidiMicrotonalActive && lowestMidiIndex != std::numeric_limits<int32_t>::max()) {
    int32_t offset = midiChannelOffset(lowestMidiIndex);
    int32_t baseIndex = positiveMod(static_cast<int>(defaultMidiChannel - 1 - offset), 16);
    standardMidiBaseChannel = static_cast<byte>(baseIndex + 1);
  } else {
    standardMidiBaseChannel = defaultMidiChannel;
  }

  for (byte i = 0; i < LED_COUNT; i++) {
    if (!(h[i].isCmd)) {
      int32_t relativeSteps = currentPitchStepsFromReference(h[i].stepsFromC);
      float N = stepsToMIDI(static_cast<int16_t>(relativeSteps));
      float targetFrequency = stepsToFrequency(static_cast<int16_t>(relativeSteps));
      h[i].midiPitch = N;
      if (standardMidiMicrotonalActive) {
        byte mappedNote = 0;
        byte mappedChannel = 0;
        mapExtendedMidiNote(h[i].midiNoteIndex, standardMidiBaseChannel, mappedNote, mappedChannel);
        h[i].note = mappedNote;
        h[i].bend = 0;
        h[i].frequency = targetFrequency;
        h[i].mappedMidiChannel = mappedChannel;
      } else {
        h[i].mappedMidiChannel = 0;
        if (N < 0 || N >= 128) {
          h[i].note = UNUSED_NOTE;
          h[i].bend = 0;
          h[i].frequency = 0.0;
        } else {
          h[i].note = ((N >= 127) ? 127 : round(N));
          h[i].bend = (ldexp(N - h[i].note, 13) / MPEpitchBendSemis);
          h[i].frequency = targetFrequency;
        }
      }
      h[i].jiRetune = 0;
      h[i].jiRetuneCents = 0.0f;
      h[i].activePitchBend = 0;
      h[i].activeMidiNote = UNUSED_NOTE;
      h[i].jiFrequencyMultiplier = 1.0f;
      if (h[i].note < 128) {
        midiNoteToHexIndices[h[i].note].push_back(i);
      }
      h[i].externalNoteDepth = 0;
      sendToLog(
        "hex #" + std::to_string(i) + ", " + "steps=" + std::to_string(h[i].stepsFromC) + ", " + "isCmd? " + std::to_string(h[i].isCmd) + ", " + "note=" + std::to_string(h[i].note) + ", " + "bend=" + std::to_string(h[i].bend) + ", " + "freq=" + std::to_string(h[i].frequency) + ", " + "inScale? " + std::to_string(h[i].inScale) + ".");
    }
  }
  sendToLog("assignPitches complete.");
}

void refreshMidiRouting() {
  syncDynamicJIRatioCandidates();
  resetTuningMIDI();
  assignPitches();
}

/*
    Returns true when the hex's pitch class belongs
    to the currently selected scale. Pulling this
    logic into one helper keeps applyScale() easy to
    read for beginners.
  */
bool hexIsInCurrentScale(byte hexIndex) {
  if (current.scale().tuning == ALL_TUNINGS) {
    return true;
  }

  byte degree = current.keyDegree(h[hexIndex].stepsFromC);
  if (degree == 0) {
    return true;  // The root is always in the scale.
  }

  byte accumulatedSteps = 0;
  byte patternIndex = 0;
  while (degree > accumulatedSteps) {
    accumulatedSteps += current.scale().pattern[patternIndex];
    ++patternIndex;
  }
  return accumulatedSteps == degree;
}

void applyScale() {
  sendToLog("applyScale was called:");
  for (byte i = 0; i < LED_COUNT; ++i) {
    if (!h[i].isCmd) {
      h[i].inScale = hexIsInCurrentScale(i);
      sendToLog(
        "hex #" + std::to_string(i) + ", " + "steps=" + std::to_string(h[i].stepsFromC) + ", " + "isCmd? " + std::to_string(h[i].isCmd) + ", " + "note=" + std::to_string(h[i].note) + ", " + "inScale? " + std::to_string(h[i].inScale) + ".");
    }
  }
  setLEDcolorCodes();
  sendToLog("applyScale complete.");
}

void restoreDefaultVisibleButtonRoles() {
  for (byte i = 0; i < LED_COUNT; ++i) {
    h[i].isCmd = false;
    h[i].note = UNUSED_NOTE;
  }
  for (byte c = 0; c < CMDCOUNT; ++c) {
    h[assignCmd[c]].isCmd = true;
    h[assignCmd[c]].note = CMDB + c;
  }
}

void applyUserGeometryButtonOverrides() {
  if (!userGeometryRuntimeActive) {
    return;
  }
  for (byte i = 0; i < LED_COUNT; ++i) {
    if (userGeometryRuntimeButtonRoleOverride[i]) {
      if (userGeometryRuntimeButtonRole[i] == 2) {
        h[i].isCmd = true;
        h[i].note = UNUSED_NOTE;
        for (byte c = 0; c < CMDCOUNT; ++c) {
          if (assignCmd[c] == i) {
            h[i].note = CMDB + c;
            break;
          }
        }
      } else if (userGeometryRuntimeButtonRole[i] == 1 && !userGeometryRuntimeButtonDisabled[i]) {
        h[i].isCmd = false;
        h[i].note = UNUSED_NOTE;
      } else {
        h[i].isCmd = true;
        h[i].note = UNUSED_NOTE;
      }
    }
    if (!h[i].isCmd && userGeometryRuntimeButtonNoteOverride[i]) {
      h[i].stepsFromC = userGeometryRuntimeButtonStepsFromC[i];
    }
  }
}

void applyLayout() {  // call this function when the layout changes
  sendToLog("buildLayout was called:");
  if (userGeometryRuntimeActive) {
    restoreDefaultVisibleButtonRoles();
  }
  ///////////////////////////////////////////////////////////////////////////////////////
  int8_t acrossSteps = current.layout().acrossSteps;  // x
  int8_t dnLeftSteps = current.layout().dnLeftSteps;  // y
  if (mirrorUpDown) {
    mirrorLayoutUpDown(acrossSteps, dnLeftSteps);
  }

  int8_t unmirroredAcrossSteps = acrossSteps;
  int8_t unmirroredDnLeftSteps = dnLeftSteps;
  if (mirrorLeftRight) {
    mirrorLayoutLeftRight(acrossSteps, dnLeftSteps);
  }
  for (byte rotations = 0; rotations < layoutRotation; rotations++) {
    rotateLayoutClockwise(acrossSteps, dnLeftSteps);
    rotateLayoutClockwise(unmirroredAcrossSteps, unmirroredDnLeftSteps);
  }
  ////////////////////////////////////////////////////////////////////////////////////////
  int16_t mirrorLeftRightOffset = 0;
  if (mirrorLeftRight && HEXBOARD_CENTER_BUTTON < LED_COUNT) {
    int8_t centerDistCol = h[HEXBOARD_CENTER_BUTTON].coordCol - h[current.layout().hexMiddleC].coordCol;
    int8_t centerDistRow = h[HEXBOARD_CENTER_BUTTON].coordRow - h[current.layout().hexMiddleC].coordRow;
    mirrorLeftRightOffset = layoutStepsForDelta(centerDistCol, centerDistRow, unmirroredAcrossSteps, unmirroredDnLeftSteps)
                            - layoutStepsForDelta(centerDistCol, centerDistRow, acrossSteps, dnLeftSteps);
  }
  for (byte i = 0; i < LED_COUNT; i++) {
    if (!(h[i].isCmd)) {
      int8_t distCol = h[i].coordCol - h[current.layout().hexMiddleC].coordCol;
      int8_t distRow = h[i].coordRow - h[current.layout().hexMiddleC].coordRow;
      h[i].stepsFromC = layoutStepsForDelta(distCol, distRow, acrossSteps, dnLeftSteps) + mirrorLeftRightOffset;
      sendToLog(
        "hex #" + std::to_string(i) + ", " + "steps from C4=" + std::to_string(h[i].stepsFromC) + ".");
    }
  }
  applyUserGeometryButtonOverrides();
  applyScale();     // when layout changes, have to re-apply scale and re-apply LEDs
  assignPitches();  // same with pitches
  sendToLog("buildLayout complete.");
}
