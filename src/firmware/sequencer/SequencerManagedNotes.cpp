#include "SequencerManagedNotes.h"

#include "../config/FeatureFlags.h"

#if HEXBOARD_ENABLE_SEQUENCER
#include "SequencerMidi.h"
#include "SequencerPlaybackSettings.h"
#include "SequencerState.h"
#include "../app/DiagnosticsTiming.h"

namespace sequencer {
namespace {

constexpr byte kManagedNoteSlots = 24;

struct ManagedHeldNote {
  bool active = false;
  int16_t pitchSteps = 0;
  byte auditionCount = 0;
  byte previewCount = 0;
  byte playbackCount = 0;
  SequencerMidiNoteHandle handle;
};

struct PreviewGroup {
  bool active = false;
  uint64_t noteOffAt = 0;
  int16_t pitchSteps[kMaxNotesPerStep] = {};
  byte noteCount = 0;
};

ManagedHeldNote heldNotes[kManagedNoteSlots];
PreviewGroup previewGroup;

byte& roleCount(ManagedHeldNote& heldNote, SequencerManagedNoteRole role) {
  switch (role) {
    case SequencerManagedNoteRole::Audition:
      return heldNote.auditionCount;
    case SequencerManagedNoteRole::Preview:
      return heldNote.previewCount;
    case SequencerManagedNoteRole::Playback:
    default:
      return heldNote.playbackCount;
  }
}

int findHeldNote(int16_t pitchSteps) {
  for (byte i = 0; i < kManagedNoteSlots; ++i) {
    if (heldNotes[i].active && heldNotes[i].pitchSteps == pitchSteps) {
      return i;
    }
  }
  return -1;
}

int allocateHeldNote(int16_t pitchSteps) {
  for (byte i = 0; i < kManagedNoteSlots; ++i) {
    if (!heldNotes[i].active) {
      heldNotes[i] = ManagedHeldNote{};
      heldNotes[i].active = true;
      heldNotes[i].pitchSteps = pitchSteps;
      return i;
    }
  }
  return -1;
}

void stopRoleNotes(SequencerManagedNoteRole role) {
  for (byte i = 0; i < kManagedNoteSlots; ++i) {
    while (heldNotes[i].active && roleCount(heldNotes[i], role) > 0) {
      stopManagedNote(heldNotes[i].pitchSteps, role);
    }
  }
}

void clearPreviewGroup() {
  previewGroup = PreviewGroup{};
}

}  // namespace

bool startManagedNote(int16_t pitchSteps, byte velocity, SequencerManagedNoteRole role) {
  int slotIndex = findHeldNote(pitchSteps);
  if (slotIndex < 0) {
    slotIndex = allocateHeldNote(pitchSteps);
  }
  if (slotIndex < 0) {
    return false;
  }

  ManagedHeldNote& heldNote = heldNotes[slotIndex];
  byte& count = roleCount(heldNote, role);
  if (heldNote.auditionCount == 0 && heldNote.previewCount == 0 && heldNote.playbackCount == 0) {
    if (!startMidiNote(pitchSteps, velocity, heldNote.handle)) {
      heldNote = ManagedHeldNote{};
      return false;
    }
  }

  if (count < 255) {
    ++count;
  }
  return true;
}

void stopManagedNote(int16_t pitchSteps, SequencerManagedNoteRole role) {
  int slotIndex = findHeldNote(pitchSteps);
  if (slotIndex < 0) {
    return;
  }

  ManagedHeldNote& heldNote = heldNotes[slotIndex];
  byte& count = roleCount(heldNote, role);
  if (count > 0) {
    --count;
  }

  if (heldNote.auditionCount == 0 && heldNote.previewCount == 0 && heldNote.playbackCount == 0) {
    stopMidiNote(heldNote.handle);
    heldNote = ManagedHeldNote{};
  }
}

void stopAuditionNotes() {
  stopRoleNotes(SequencerManagedNoteRole::Audition);
}

void stopPreviewNotes() {
  if (previewGroup.active) {
    for (byte i = 0; i < previewGroup.noteCount && i < kMaxNotesPerStep; ++i) {
      stopManagedNote(previewGroup.pitchSteps[i], SequencerManagedNoteRole::Preview);
    }
  }
  clearPreviewGroup();
  stopRoleNotes(SequencerManagedNoteRole::Preview);
}

void stopPlaybackNotes() {
  stopRoleNotes(SequencerManagedNoteRole::Playback);
}

void stopAllManagedNotes() {
  clearPreviewGroup();
  for (byte i = 0; i < kManagedNoteSlots; ++i) {
    if (heldNotes[i].active) {
      stopMidiNote(heldNotes[i].handle);
      heldNotes[i] = ManagedHeldNote{};
    }
  }
}

void serviceManagedNotes() {
  if (previewGroup.active && runTime >= previewGroup.noteOffAt) {
    stopPreviewNotes();
  }
}

void previewStep(byte stepIndex) {
  stopPreviewNotes();
  if (stepIndex >= kStepCount) {
    return;
  }

  const SequencerStep& target = step(stepIndex);
  if (target.tie || target.noteCount == 0 || target.gatePercent == 0) {
    return;
  }

  uint64_t gateMicros = (playbackStepDurationMicros() * static_cast<uint64_t>(target.gatePercent)) / 100ULL;
  if (gateMicros == 0) {
    gateMicros = 1;
  }

  previewGroup.active = true;
  previewGroup.noteOffAt = runTime + gateMicros;
  previewGroup.noteCount = 0;
  for (byte i = 0; i < target.noteCount && i < kMaxNotesPerStep; ++i) {
    if (startManagedNote(target.pitchSteps[i], target.velocity, SequencerManagedNoteRole::Preview)) {
      previewGroup.pitchSteps[previewGroup.noteCount++] = target.pitchSteps[i];
    }
  }

  if (previewGroup.noteCount == 0) {
    clearPreviewGroup();
  }
}

}  // namespace sequencer
#else
namespace sequencer {

bool startManagedNote(int16_t /*pitchSteps*/, byte /*velocity*/, SequencerManagedNoteRole /*role*/) {
  return false;
}

void stopManagedNote(int16_t /*pitchSteps*/, SequencerManagedNoteRole /*role*/) {
}

void stopAuditionNotes() {
}

void stopPreviewNotes() {
}

void stopPlaybackNotes() {
}

void stopAllManagedNotes() {
}

void serviceManagedNotes() {
}

void previewStep(byte /*stepIndex*/) {
}

}  // namespace sequencer
#endif
