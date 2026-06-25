#pragma once

#include "../FirmwareModule.h"

namespace sequencer {

enum class SequencerManagedNoteRole : byte {
  Audition,
  Preview,
  Playback
};

bool startManagedNote(int16_t pitchSteps, byte velocity, SequencerManagedNoteRole role);
void stopManagedNote(int16_t pitchSteps, SequencerManagedNoteRole role);
bool sequencerPlayedNoteDisplayEligible();
bool sequencerPlayedNoteDisplayActive();
byte rebuildSequencerPlayedNoteDisplay(int16_t* notes, byte maxCount);
bool newestSequencerPlayedNoteDisplayPitch(int16_t& displayedPitchOut);
void stopAuditionNotes();
void stopPreviewNotes();
void stopPlaybackNotes();
void stopAllManagedNotes();
void serviceManagedNotes();
void previewStep(byte stepIndex);

}  // namespace sequencer
