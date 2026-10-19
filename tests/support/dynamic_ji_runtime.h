#pragma once

// Host boundary for the unmodified JI and MIDI-dispatch translation units.
// Only hardware, transport and unrelated mapped-action services are replaced.
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <limits>
#include <string>
#include <utility>
#include <vector>

using byte = uint8_t;
#define RAM_FUNC(name) name
#define sendToLog(message) do {} while (0)
constexpr byte LED_COUNT = 140, BTN_COUNT = 160, UNUSED_NOTE = 128;
constexpr byte MIDI_CHANNEL_MIN = 1, MIDI_CHANNEL_COUNT = 16;
constexpr unsigned MIDI_NOTES_PER_CHANNEL = 128;
constexpr unsigned USER_GEOMETRY_MAX_CHORD_TONES = 8;
constexpr byte PRESET_SYNC_BUTTON_OUTPUT_TUNED = 0;
constexpr byte PRESET_SYNC_BUTTON_OUTPUT_DIRECT_MIDI = 1;
constexpr byte PRESET_SYNC_CHORD_PITCH_TUNING_STEPS = 0;

struct TestKey {
  byte note = UNUSED_NOTE, MIDIch = 0, mappedMidiChannel = 0;
  byte activeMidiNote = UNUSED_NOTE, synthCh = 0;
  int16_t stepsFromC = 0, bend = 0, activePitchBend = 0, jiRetune = 0;
  float frequency = 0, midiPitch = 0, jiRetuneCents = 0, jiFrequencyMultiplier = 1;
  uint64_t timePressed = 0;
};
inline TestKey h[BTN_COUNT];
inline bool useDynamicJustIntonation = false, useJustIntonationBPM = false;
inline byte dynamicJIRatioTable = 41, justIntonationBPM = 60, justIntonationBPM_Multiplier = 1;
inline byte MPEpitchBendSemis = 48, MPEpitchBendsNeeded = 255;
inline bool standardMidiMicrotonalActive = false, mpeChannelQueueActive = true, extraMPE = false;
inline byte defaultMidiChannel = 1, standardMidiBaseChannel = 1;
inline byte mpeLowestChannel = 2, mpeHighestChannel = 16, CC74value = 64;
inline struct { int curValue = 100; } velWheel;
inline uint64_t noteOverlayReleaseGraceUntil = 0, runTime = 0;
constexpr uint64_t DISPLAYED_NOTES_RELEASE_GRACE_MICROS = 100000;
inline bool screenSaverOn = false;
inline float testReferenceHz = 440, testStepCents = 100;
inline float testPeriodCents = 1200;
inline std::vector<float> testCentsTable;
inline uint64_t testRatioCalls = 0;
inline float ratioToCents(float ratio) {
  ++testRatioCalls;
  return 1200.0f * (std::log(ratio) / std::log(2.0f));
}
inline int32_t currentPitchStepsFromReference(int16_t steps) { return steps; }
inline float stepsToCentsFromReference(int16_t steps) {
  if (testCentsTable.empty()) return steps * testStepCents;
  const int length = static_cast<int>(testCentsTable.size());
  const int period = static_cast<int>(std::floor(static_cast<float>(steps) / length));
  return period * testPeriodCents + testCentsTable[steps - period * length];
}
inline float currentTuningReferenceHz() { return testReferenceHz; }
inline float currentTuningNominalStepSizeCents() { return testStepCents; }
inline byte currentTuningReferenceMidiNote() { return 69; }
inline float MIDItoFreq(float midi) { return 440 * std::exp2((midi - 69) / 12); }
inline float stepsToFrequency(int16_t steps) {
  return testReferenceHz * std::exp2(stepsToCentsFromReference(steps) / 1200);
}
inline float stepsToMIDI(int16_t steps) {
  return 69 + 12 * std::log2(stepsToFrequency(steps) / 440);
}
inline int positiveMod(int value, int divisor) { return (value % divisor + divisor) % divisor; }
inline bool isValidMidiChannel(byte channel) { return channel >= 1 && channel <= 16; }
inline void mapExtendedMidiNote(int32_t index, byte base, byte& note, byte& channel) {
  note = positiveMod(index, 128); channel = base;
}
inline uint16_t testChannelMask = 0xfffe;
inline byte mpePlayableChannelCount() { return mpeHighestChannel - mpeLowestChannel + 1; }
inline byte takeMPEChannel() {
  for (byte ch = mpeLowestChannel; ch <= mpeHighestChannel; ++ch) {
    if (testChannelMask & (1u << (ch - 1))) {
      testChannelMask &= ~(1u << (ch - 1));
      return ch;
    }
  }
  return 0;
}
inline void releaseMPEChannel(byte ch) { testChannelMask |= 1u << (ch - 1); }
struct TestMidiEvent { bool on; byte note, channel; int16_t bend; };
inline std::vector<TestMidiEvent> testMidiEvents;
inline int16_t testLastBend[16] = {};
struct TestMidi {
  void sendPerNotePitchBend(int16_t bend, byte ch) { testLastBend[ch - 1] = bend; }
  void sendAfterTouch(int, byte) {}
  void sendControlChange(int, int, byte) {}
  void sendNoteOn(byte note, int, byte ch) {
    testMidiEvents.push_back({true, note, ch, testLastBend[ch - 1]});
  }
  void sendNoteOff(byte note, int, byte ch) { testMidiEvents.push_back({false, note, ch, 0}); }
};
template <class Callback> void withMIDI(Callback callback) { TestMidi midi; callback(midi); }
inline bool testReleaseSucceeds = true;
inline bool sendNoteOffToConfiguredMidiOutputs(byte note, int velocity, byte ch) {
  if (!testReleaseSucceeds) return false;
  withMIDI([&](auto& m) { m.sendNoteOff(note, velocity, ch); });
  return true;
}
inline bool finishMPEChannelRelease(byte ch, byte note, uint64_t) {
  if (!sendNoteOffToConfiguredMidiOutputs(note, 0, ch)) return false;
  releaseMPEChannel(ch);
  return true;
}
inline bool noteDisplayEnabled() { return false; }
inline void schedulePlayedNotesOverlayUpdate(bool) {}
struct SynthPreviewNoteHandle {};
inline void stopSynthPreviewNote(SynthPreviewNoteHandle&) {}
inline void startSynthPreviewNote(int16_t, float, byte, int, SynthPreviewNoteHandle&) {}
struct UserGeometryChordAction {
  bool active = false;
  byte id = 0, pitchMode = 0, toneCount = 0, midiChannel = 1;
  int16_t intervals[USER_GEOMETRY_MAX_CHORD_TONES] = {};
};
inline struct {
  bool active = false;
  byte buttonOutputMode[LED_COUNT] = {}, buttonMidiNote[LED_COUNT] = {};
  byte buttonMidiChannel[LED_COUNT] = {}, buttonChordActionId[LED_COUNT] = {};
  byte buttonChordRootMidiNote[LED_COUNT] = {};
  std::array<UserGeometryChordAction, 1> chordActions;
} userGeometryRuntime;
