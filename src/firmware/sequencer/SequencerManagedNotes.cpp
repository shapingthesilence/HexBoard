#include "SequencerManagedNotes.h"

#include "../config/FeatureFlags.h"
#include "../menu/PlayedNotesOverlay.h"
#include "../model/ScalePalettePreset.h"

#if HEXBOARD_ENABLE_SEQUENCER
#include "SequencerOutput.h"
#include "SequencerOverlay.h"
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
  uint64_t auditionStartedAt = 0;
  SequencerOutputNoteHandle handle;
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

bool auditionNoteVisible(const ManagedHeldNote& heldNote) {
  return heldNote.active && heldNote.auditionCount > 0;
}

byte insertSequencerDisplayedNoteSorted(int16_t* notes, byte count, byte maxCount, int16_t displayedPitch) {
  for (byte i = 0; i < count; ++i) {
    if (notes[i] == displayedPitch) {
      return count;
    }
  }

  byte insertAt = 0;
  while (insertAt < count && notes[insertAt] < displayedPitch) {
    ++insertAt;
  }

  if (count < maxCount) {
    for (byte i = count; i > insertAt; --i) {
      notes[i] = notes[i - 1];
    }
    notes[insertAt] = displayedPitch;
    return static_cast<byte>(count + 1);
  }

  if (insertAt < maxCount) {
    for (byte i = static_cast<byte>(maxCount - 1); i > insertAt; --i) {
      notes[i] = notes[i - 1];
    }
    notes[insertAt] = displayedPitch;
  }

  return count;
}

void notifyAuditionDisplayStart() {
  if (!sequencerPlayedNoteDisplayEligible()) {
    return;
  }

  if (noteDisplayEnabled() && (screenSaverOn || sequencerIdleDisplayBlanked())) {
    setNoteOverlayTemporaryWake(true);
  }
  noteOverlayReleaseGraceUntil = 0;
  noteOverlayDirty = true;
}

void notifyAuditionDisplayStop() {
  if (!sequencerPlayedNoteDisplayEligible()) {
    return;
  }

  noteOverlayReleaseGraceUntil = runTime + DISPLAYED_NOTES_RELEASE_GRACE_MICROS;
  noteOverlayDirty = true;
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
    if (!startOutputNote(pitchSteps, velocity, heldNote.handle)) {
      heldNote = ManagedHeldNote{};
      return false;
    }
  }

  if (count < 255) {
    ++count;
  }
  if (role == SequencerManagedNoteRole::Audition) {
    heldNote.auditionStartedAt = runTime;
    notifyAuditionDisplayStart();
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
  bool auditionDropped = role == SequencerManagedNoteRole::Audition && count > 0;
  if (count > 0) {
    --count;
  }

  if (auditionDropped) {
    notifyAuditionDisplayStop();
  }

  if (heldNote.auditionCount == 0 && heldNote.previewCount == 0 && heldNote.playbackCount == 0) {
    stopOutputNote(heldNote.handle);
    heldNote = ManagedHeldNote{};
  }
}

bool sequencerPlayedNoteDisplayEligible() {
  return !hasSelectedStep();
}

bool sequencerPlayedNoteDisplayActive() {
  if (!sequencerPlayedNoteDisplayEligible()) {
    return false;
  }

  for (byte i = 0; i < kManagedNoteSlots; ++i) {
    if (auditionNoteVisible(heldNotes[i])) {
      return true;
    }
  }
  return false;
}

byte rebuildSequencerPlayedNoteDisplay(int16_t* notes, byte maxCount) {
  if (notes == nullptr || maxCount == 0) {
    return 0;
  }

  for (byte i = 0; i < maxCount; ++i) {
    notes[i] = DISPLAYED_NOTE_UNUSED;
  }

  if (!sequencerPlayedNoteDisplayEligible()) {
    return 0;
  }

  byte out = 0;
  for (byte i = 0; i < kManagedNoteSlots; ++i) {
    if (!auditionNoteVisible(heldNotes[i])) {
      continue;
    }
    int16_t displayedPitch = static_cast<int16_t>(heldNotes[i].pitchSteps + current.transpose);
    out = insertSequencerDisplayedNoteSorted(notes, out, maxCount, displayedPitch);
  }
  return out;
}

bool newestSequencerPlayedNoteDisplayPitch(int16_t& displayedPitchOut) {
  if (!sequencerPlayedNoteDisplayEligible()) {
    return false;
  }

  bool found = false;
  uint64_t newestPressTime = 0;
  for (byte i = 0; i < kManagedNoteSlots; ++i) {
    if (!auditionNoteVisible(heldNotes[i])) {
      continue;
    }
    if (!found || heldNotes[i].auditionStartedAt >= newestPressTime) {
      newestPressTime = heldNotes[i].auditionStartedAt;
      displayedPitchOut = static_cast<int16_t>(heldNotes[i].pitchSteps + current.transpose);
      found = true;
    }
  }
  return found;
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
  bool hadAuditionDisplayNotes = sequencerPlayedNoteDisplayActive();
  clearPreviewGroup();
  for (byte i = 0; i < kManagedNoteSlots; ++i) {
    if (heldNotes[i].active) {
      stopOutputNote(heldNotes[i].handle);
      heldNotes[i] = ManagedHeldNote{};
    }
  }
  if (hadAuditionDisplayNotes) {
    notifyAuditionDisplayStop();
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

bool sequencerPlayedNoteDisplayEligible() {
  return false;
}

bool sequencerPlayedNoteDisplayActive() {
  return false;
}

byte rebuildSequencerPlayedNoteDisplay(int16_t* notes, byte maxCount) {
  if (notes != nullptr) {
    for (byte i = 0; i < maxCount; ++i) {
      notes[i] = DISPLAYED_NOTE_UNUSED;
    }
  }
  return 0;
}

bool newestSequencerPlayedNoteDisplayPitch(int16_t& /*displayedPitchOut*/) {
  return false;
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
