#pragma once

#include "../FirmwareModule.h"

namespace sequencer {

struct SequencerMidiNoteHandle {
  bool active = false;
  bool releaseMidiChannel = false;
  int16_t pitchSteps = 0;
  byte midiNote = 0;
  byte midiChannel = 0;
};

bool startMidiNote(int16_t pitchSteps, byte velocity, SequencerMidiNoteHandle& handle);
void stopMidiNote(SequencerMidiNoteHandle& handle);
void sendMidiClockPulse();
void sendMidiTransportStart();
void sendMidiTransportStop();

}  // namespace sequencer
