#include "SequencerOverlay.h"

#include "../config/FeatureFlags.h"

#if HEXBOARD_ENABLE_SEQUENCER
#include "SequencerState.h"
#include "../app/PlatformCommon.h"
#include "../menu/MenuAndDisplay.h"
#include "../model/ScalePalettePreset.h"
#include "../tuning/Tuning.h"

extern bool screenSaverOn;

namespace sequencer {
namespace {

constexpr uint8_t kOverlayUsableWidthPixels = 116;
constexpr byte kNoteLineSize = 24;

bool overlayVisible = false;
bool overlayDirty = true;

const char* const kChromaticNames[12] = {
  "C", "C#", "D", "Eb", "E", "F",
  "F#", "G", "G#", "A", "Bb", "B"
};

void formatStepNoteLabel(int16_t pitchSteps, char* out, size_t outSize) {
  if (out == nullptr || outSize == 0) {
    return;
  }

  int displayedPitch = static_cast<int>(pitchSteps) + current.transpose;
  if (current.tuningIndex == TUNING_12EDO) {
    int midiNote = displayedPitch + 60;
    int pitchClass = positiveMod(midiNote, 12);
    int octave = ((midiNote - pitchClass) / 12) - 1;
    snprintf(out, outSize, "%s%d", kChromaticNames[pitchClass], octave);
    return;
  }

  int cycleLength = current.tuning().cycleLength;
  if (cycleLength <= 0) {
    snprintf(out, outSize, "?");
    return;
  }

  int step = positiveMod(displayedPitch, cycleLength);
  int octave = ((displayedPitch - step) / cycleLength) + 4;
  snprintf(out, outSize, "%d.%d", step, octave);
}

bool appendOverlayLabelToLine(char* line, size_t lineSize, const char* label) {
  if (line == nullptr || lineSize == 0 || label == nullptr || label[0] == '\0') {
    return false;
  }

  char candidate[kNoteLineSize];
  snprintf(candidate, sizeof(candidate), "%s%s%s", line, (line[0] != '\0') ? " " : "", label);
  if (strlen(candidate) >= lineSize) {
    return false;
  }

  u8g2.setFont(u8g2_font_6x13_tf);
  if (u8g2.getStrWidth(candidate) > kOverlayUsableWidthPixels) {
    return false;
  }

  snprintf(line, lineSize, "%s", candidate);
  return true;
}

void fillOverlayNoteLines(const SequencerStep& target, char* lineOne, size_t lineOneSize, char* lineTwo, size_t lineTwoSize) {
  lineOne[0] = '\0';
  lineTwo[0] = '\0';

  if (target.noteCount == 0) {
    snprintf(lineOne, lineOneSize, "--");
    return;
  }

  char noteLabel[12];
  for (byte i = 0; i < target.noteCount && i < kMaxNotesPerStep; ++i) {
    formatStepNoteLabel(target.pitchSteps[i], noteLabel, sizeof(noteLabel));
    if (!appendOverlayLabelToLine(lineOne, lineOneSize, noteLabel)) {
      appendOverlayLabelToLine(lineTwo, lineTwoSize, noteLabel);
    }
  }
}

}  // namespace

void markOverlayDirty() {
  overlayDirty = true;
}

void hideSelectedStepOverlay() {
  overlayVisible = false;
  overlayDirty = false;
  menu.drawMenu();
}

void resetOverlayState() {
  overlayVisible = false;
  overlayDirty = true;
}

void drawSequencerOverlay() {
  if (!hasSelectedStep()) {
    if (overlayVisible) {
      hideSelectedStepOverlay();
    }
    return;
  }

  if (!overlayDirty && overlayVisible) {
    return;
  }

  screenTime = 0;
  if (::screenSaverOn) {
    ::screenSaverOn = false;
    u8g2.setContrast(CONTRAST_AWAKE);
  }

  byte stepIndex = static_cast<byte>(selectedStepIndex());
  const SequencerStep& target = step(stepIndex);

  char headerLabel[20];
  char infoLine[32];
  char noteLineOne[kNoteLineSize];
  char noteLineTwo[kNoteLineSize];
  snprintf(headerLabel, sizeof(headerLabel), "Edit #%02u", static_cast<unsigned>(stepIndex + 1));
  snprintf(infoLine, sizeof(infoLine), "L %u%% V %u P %u%%",
           static_cast<unsigned>(target.gatePercent),
           static_cast<unsigned>(target.velocity),
           static_cast<unsigned>(target.probability));
  fillOverlayNoteLines(target, noteLineOne, sizeof(noteLineOne), noteLineTwo, sizeof(noteLineTwo));

  overlayVisible = true;
  overlayDirty = false;

  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_6x13_tf);
  u8g2.drawStr(20, 14, headerLabel);
  u8g2.drawStr(2, 30, infoLine);
  u8g2.drawStr(12, 48, noteLineOne);
  if (noteLineTwo[0] != '\0') {
    u8g2.drawStr(12, 60, noteLineTwo);
  }
  u8g2.sendBuffer();
}

}  // namespace sequencer
#else
namespace sequencer {

void markOverlayDirty() {
}

void hideSelectedStepOverlay() {
}

void resetOverlayState() {
}

void drawSequencerOverlay() {
}

}  // namespace sequencer
#endif
