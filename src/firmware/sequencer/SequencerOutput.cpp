#include "SequencerOutput.h"

#include "../config/FeatureFlags.h"

#include <limits>

#if HEXBOARD_ENABLE_SEQUENCER
#include "SequencerPlaybackSettings.h"
#include "../midi/MidiRouting.h"

namespace sequencer {
namespace {

byte displayMidiNoteForPitch(float midiPitch) {
  if (midiPitch <= 0.0f) {
    return 0;
  }
  if (midiPitch >= 127.0f) {
    return 127;
  }
  return static_cast<byte>(roundf(midiPitch));
}

bool startSynthOutputNote(int16_t pitchSteps, byte velocity, SynthPreviewNoteHandle& handle) {
  int32_t relativeSteps = currentPitchStepsFromReference(pitchSteps);
  if (relativeSteps < std::numeric_limits<int16_t>::min() ||
      relativeSteps > std::numeric_limits<int16_t>::max()) {
    return false;
  }

  int16_t relative = static_cast<int16_t>(relativeSteps);
  float frequency = stepsToFrequency(relative);
  if (frequency <= 0.0f) {
    return false;
  }

  float midiPitch = stepsToMIDI(relative);
  return startSynthPreviewNote(pitchSteps, frequency, displayMidiNoteForPitch(midiPitch), velocity, handle);
}

}  // namespace

bool startOutputNote(int16_t pitchSteps, byte velocity, SequencerOutputNoteHandle& handle) {
  handle = SequencerOutputNoteHandle{};
  if (playType() == kPlayTypeObSynth) {
    if (!startSynthOutputNote(pitchSteps, velocity, handle.synth)) {
      return false;
    }
    handle.active = true;
    handle.route = SequencerOutputRoute::ObSynth;
    return true;
  }

  if (!startMidiNote(pitchSteps, velocity, handle.midi)) {
    return false;
  }
  handle.active = true;
  handle.route = SequencerOutputRoute::Midi;
  return true;
}

void stopOutputNote(SequencerOutputNoteHandle& handle) {
  if (!handle.active) {
    return;
  }

  if (handle.route == SequencerOutputRoute::ObSynth) {
    stopSynthPreviewNote(handle.synth);
  } else {
    stopMidiNote(handle.midi);
  }
  handle = SequencerOutputNoteHandle{};
}

}  // namespace sequencer
#else
namespace sequencer {

bool startOutputNote(int16_t /*pitchSteps*/, byte /*velocity*/, SequencerOutputNoteHandle& handle) {
  handle = SequencerOutputNoteHandle{};
  return false;
}

void stopOutputNote(SequencerOutputNoteHandle& handle) {
  handle = SequencerOutputNoteHandle{};
}

}  // namespace sequencer
#endif
