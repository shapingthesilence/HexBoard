#include "SequencerMidi.h"

#include "../config/FeatureFlags.h"

#if HEXBOARD_ENABLE_SEQUENCER
#include "../app/PlatformCommon.h"
#include "../app/RuntimeDefaults.h"
#include "../hardware/GridState.h"
#include "../midi/MidiRouting.h"
#include "../midi/MidiTransport.h"
#include "../tuning/Tuning.h"

namespace sequencer {
namespace {

int16_t pitchBendForMidiPitch(float midiPitch, byte midiNote) {
  float residualCents = (midiPitch - static_cast<float>(midiNote)) * 100.0f;
  float bendScale = 8192.0f / (100.0f * static_cast<float>(MPEpitchBendSemis));
  int32_t bend = static_cast<int32_t>(roundf(residualCents * bendScale));
  return static_cast<int16_t>(std::clamp<int32_t>(bend, -8192, 8191));
}

byte nearestMidiNoteForPitch(float midiPitch) {
  if (midiPitch <= 0.0f) {
    return 0;
  }
  if (midiPitch >= 127.0f) {
    return 127;
  }
  return static_cast<byte>(roundf(midiPitch));
}

bool resolvePitchToMidi(
  int16_t pitchSteps,
  byte& noteOut,
  byte& channelOut,
  int16_t& bendOut,
  bool& releaseMidiChannelOut) {
  bendOut = 0;
  releaseMidiChannelOut = false;

  int32_t relativeSteps = currentPitchStepsFromReference(pitchSteps);
  if (standardMidiMicrotonalActive) {
    int32_t midiIndex = static_cast<int32_t>(currentTuningReferenceMidiNote()) + relativeSteps;
    mapExtendedMidiNote(midiIndex, standardMidiBaseChannel, noteOut, channelOut);
    return isValidMidiChannel(channelOut);
  }

  float midiPitch = stepsToMIDI(static_cast<int16_t>(relativeSteps));
  if (midiPitch < 0.0f || midiPitch >= 128.0f) {
    return false;
  }
  noteOut = nearestMidiNoteForPitch(midiPitch);

  if (MPEpitchBendsNeeded == 1) {
    channelOut = isValidMidiChannel(defaultMidiChannel) ? defaultMidiChannel : MIDI_CHANNEL_MIN;
    return true;
  }

  uint8_t availableChannels = mpePlayableChannelCount();
  if (availableChannels == 0) {
    return false;
  }

  if (mpeChannelQueueActive) {
    channelOut = takeMPEChannel();
    if (!channelOut) {
      return false;
    }
    releaseMidiChannelOut = true;
  } else {
    channelOut = static_cast<byte>(mpeLowestChannel + positiveMod(pitchSteps, availableChannels));
  }

  bendOut = pitchBendForMidiPitch(midiPitch, noteOut);
  return isValidMidiChannel(channelOut);
}

}  // namespace

bool startMidiNote(int16_t pitchSteps, byte velocity, SequencerMidiNoteHandle& handle) {
  handle = SequencerMidiNoteHandle{};
  handle.pitchSteps = pitchSteps;

  byte midiNote = 0;
  byte midiChannel = 0;
  int16_t pitchBend = 0;
  bool releaseMidiChannel = false;
  if (!resolvePitchToMidi(pitchSteps, midiNote, midiChannel, pitchBend, releaseMidiChannel)) {
    return false;
  }

  if (MPEpitchBendsNeeded != 1) {
    withMIDI([&](auto& M) { M.sendPitchBend(pitchBend, midiChannel); });
    if (extraMPE) {
      withMIDI([&](auto& M) {
        M.sendAfterTouch(velWheel.curValue, midiChannel);
        M.sendControlChange(74, CC74value, midiChannel);
      });
    }
  }

  byte safeVelocity = velocity == 0 ? 1 : velocity;
  withMIDI([&](auto& M) { M.sendNoteOn(midiNote, safeVelocity, midiChannel); });

  handle.active = true;
  handle.releaseMidiChannel = releaseMidiChannel;
  handle.midiNote = midiNote;
  handle.midiChannel = midiChannel;
  return true;
}

void stopMidiNote(SequencerMidiNoteHandle& handle) {
  if (!handle.active) {
    return;
  }

  if (isValidMidiChannel(handle.midiChannel)) {
    withMIDI([&](auto& M) { M.sendNoteOff(handle.midiNote, 0, handle.midiChannel); });
    if (handle.releaseMidiChannel) {
      if (extraMPE) {
        withMIDI([&](auto& M) {
          M.sendAfterTouch(0, handle.midiChannel);
          M.sendControlChange(74, CC74value, handle.midiChannel);
        });
      }
      releaseMPEChannel(handle.midiChannel);
    }
  }

  handle = SequencerMidiNoteHandle{};
}

void sendMidiClockPulse() {
  sendRealTimeToConfiguredMidiOutputs(0xF8);
}

void sendMidiTransportStart() {
  sendRealTimeToConfiguredMidiOutputs(0xFA);
}

void sendMidiTransportStop() {
  sendRealTimeToConfiguredMidiOutputs(0xFC);
}

}  // namespace sequencer
#else
namespace sequencer {

bool startMidiNote(int16_t /*pitchSteps*/, byte /*velocity*/, SequencerMidiNoteHandle& handle) {
  handle = SequencerMidiNoteHandle{};
  return false;
}

void stopMidiNote(SequencerMidiNoteHandle& handle) {
  handle = SequencerMidiNoteHandle{};
}

void sendMidiClockPulse() {
}

void sendMidiTransportStart() {
}

void sendMidiTransportStop() {
}

}  // namespace sequencer
#endif
