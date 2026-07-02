#pragma once

#include "../FirmwareModule.h"
#include "../synth/SynthAudio.h"
#include "SequencerMidi.h"

namespace sequencer {

enum class SequencerOutputRoute : byte {
  Midi,
  ObSynth
};

struct SequencerOutputNoteHandle {
  bool active = false;
  SequencerOutputRoute route = SequencerOutputRoute::Midi;
  SequencerMidiNoteHandle midi;
  SynthPreviewNoteHandle synth;
};

bool startOutputNote(int16_t pitchSteps, byte velocity, SequencerOutputNoteHandle& handle);
void stopOutputNote(SequencerOutputNoteHandle& handle);

}  // namespace sequencer
