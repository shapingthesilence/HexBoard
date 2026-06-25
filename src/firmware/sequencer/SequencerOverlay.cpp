#include "SequencerOverlay.h"

#include "../config/FeatureFlags.h"

#if HEXBOARD_ENABLE_SEQUENCER
#include "SequencerPerformanceMonitor.h"
#include "SequencerState.h"
#include "SequencerTools.h"
#include "../app/DiagnosticsTiming.h"
#include "../app/PlatformCommon.h"
#include "../menu/MenuAndDisplay.h"
#include "../model/ScalePalettePreset.h"
#include "../tuning/Tuning.h"

extern bool screenSaverOn;

namespace sequencer {
namespace {

constexpr uint8_t kOverlayUsableWidthPixels = 116;
constexpr uint8_t kOverviewUsableWidthPixels = 124;
constexpr int kOverviewFirstLineY = 12;
constexpr int kOverviewMaxBaselineY = 120;
constexpr int kOverviewSecondLineOffset = 12;
constexpr int kOverviewSingleStepAdvance = 14;
constexpr int kOverviewDoubleStepAdvance = 24;
constexpr byte kNoteLineSize = 24;

bool overlayVisible = false;
bool overlayDirty = true;
bool overviewShown = false;
byte overviewStartStep = 0;

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

bool appendOverviewLabelToLine(char* line, size_t lineSize, const char* label) {
  if (line == nullptr || lineSize == 0 || label == nullptr || label[0] == '\0') {
    return false;
  }

  char candidate[kNoteLineSize];
  snprintf(candidate, sizeof(candidate), "%s%s%s", line, (line[0] != '\0') ? " " : "", label);
  if (strlen(candidate) >= lineSize) {
    return false;
  }

  u8g2.setFont(u8g2_font_6x13_tf);
  if (u8g2.getStrWidth(candidate) > kOverviewUsableWidthPixels) {
    return false;
  }

  snprintf(line, lineSize, "%s", candidate);
  return true;
}

void fillOverlayNoteLines(const SequencerStep& target, char* lineOne, size_t lineOneSize, char* lineTwo, size_t lineTwoSize) {
  lineOne[0] = '\0';
  lineTwo[0] = '\0';

  if (target.tie) {
    snprintf(lineOne, lineOneSize, "T");
    return;
  }

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

void fillOverviewStepLines(byte stepIndex, char* lineOne, size_t lineOneSize, char* lineTwo, size_t lineTwoSize) {
  if (lineOne == nullptr || lineTwo == nullptr || lineOneSize == 0 || lineTwoSize == 0) {
    return;
  }

  lineOne[0] = '\0';
  lineTwo[0] = '\0';
  if (stepIndex >= kStepCount) {
    return;
  }

  const SequencerStep& target = step(stepIndex);
  if (target.tie) {
    snprintf(lineOne, lineOneSize, "%02u T", static_cast<unsigned>(stepIndex + 1));
    return;
  }

  if (target.noteCount == 0) {
    snprintf(lineOne, lineOneSize, "%02u _", static_cast<unsigned>(stepIndex + 1));
    return;
  }

  snprintf(lineOne, lineOneSize, "%02u", static_cast<unsigned>(stepIndex + 1));

  char noteLabel[12];
  for (byte i = 0; i < target.noteCount && i < kMaxNotesPerStep; ++i) {
    formatStepNoteLabel(target.pitchSteps[i], noteLabel, sizeof(noteLabel));
    if (!appendOverviewLabelToLine(lineOne, lineOneSize, noteLabel)) {
      if (lineTwo[0] == '\0') {
        snprintf(lineTwo, lineTwoSize, "   ");
      }
      appendOverviewLabelToLine(lineTwo, lineTwoSize, noteLabel);
    }
  }
}

byte countOverviewStepsThatFit(byte firstStep) {
  if (firstStep >= kStepCount) {
    return 0;
  }

  u8g2.setFont(u8g2_font_6x13_tf);
  int y = kOverviewFirstLineY;
  byte count = 0;
  char lineOne[kNoteLineSize];
  char lineTwo[kNoteLineSize];

  for (byte stepIndex = firstStep; stepIndex < kStepCount; ++stepIndex) {
    fillOverviewStepLines(stepIndex, lineOne, sizeof(lineOne), lineTwo, sizeof(lineTwo));
    bool usesSecondLine = lineTwo[0] != '\0';
    int lastBaseline = usesSecondLine ? (y + kOverviewSecondLineOffset) : y;
    if (lastBaseline > kOverviewMaxBaselineY) {
      break;
    }

    ++count;
    y += usesSecondLine ? kOverviewDoubleStepAdvance : kOverviewSingleStepAdvance;
  }

  return (count > 0) ? count : 1;
}

void keepOverlayDisplayAwake() {
  screenTime = 0;
  if (::screenSaverOn) {
    ::screenSaverOn = false;
    u8g2.setContrast(CONTRAST_AWAKE);
  }
}

void drawPerformanceMonitorOverlay() {
  refreshPerformanceMonitorStats(false);
  const SequencerPerformanceSnapshot& stats = performanceMonitorSnapshot();

  char cpuLine[20];
  char memoryLine[24];
  char storageLine[24];
  char midiQueueLine[20];
  char midiStateLine[24];
  char usedLabel[10];
  char totalLabel[10];

  snprintf(cpuLine, sizeof(cpuLine), "AudioEng %u%%", static_cast<unsigned>(stats.audioEnginePercent));

  formatPerformanceMonitorByteLabel(stats.heapUsedBytes, usedLabel, sizeof(usedLabel));
  formatPerformanceMonitorByteLabel(stats.heapTotalBytes, totalLabel, sizeof(totalLabel));
  snprintf(memoryLine, sizeof(memoryLine), "Mem %s/%s", usedLabel, totalLabel);

  if (stats.storageAvailable) {
    formatPerformanceMonitorByteLabel(stats.storageUsedBytes, usedLabel, sizeof(usedLabel));
    formatPerformanceMonitorByteLabel(stats.storageTotalBytes, totalLabel, sizeof(totalLabel));
    snprintf(storageLine, sizeof(storageLine), "FS  %s/%s", usedLabel, totalLabel);
  } else {
    snprintf(storageLine, sizeof(storageLine), "FS  unavailable");
  }

  snprintf(midiQueueLine, sizeof(midiQueueLine), "MIDI Q %u", static_cast<unsigned>(stats.midi.pendingBytes));
  snprintf(midiStateLine,
           sizeof(midiStateLine),
           "Drop %u Late %u",
           static_cast<unsigned>(stats.midi.droppedBacklogEpisodes),
           static_cast<unsigned>(stats.midi.lateBacklogEpisodes));

  overlayVisible = true;
  overlayDirty = false;

  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_6x13_tf);
  u8g2.drawStr(8, 16, cpuLine);
  u8g2.drawStr(8, 36, memoryLine);
  u8g2.drawStr(8, 56, storageLine);
  u8g2.drawStr(8, 76, midiQueueLine);
  u8g2.drawStr(8, 96, midiStateLine);
  u8g2.sendBuffer();
}

void drawOverviewOverlay() {
  overlayVisible = true;
  overlayDirty = false;

  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_6x13_tf);

  int y = kOverviewFirstLineY;
  char lineOne[kNoteLineSize];
  char lineTwo[kNoteLineSize];
  for (byte stepIndex = overviewStartStep; stepIndex < kStepCount; ++stepIndex) {
    fillOverviewStepLines(stepIndex, lineOne, sizeof(lineOne), lineTwo, sizeof(lineTwo));
    bool usesSecondLine = lineTwo[0] != '\0';
    int lastBaseline = usesSecondLine ? (y + kOverviewSecondLineOffset) : y;
    if (lastBaseline > kOverviewMaxBaselineY) {
      break;
    }

    u8g2.drawStr(4, y, lineOne);
    if (usesSecondLine) {
      u8g2.drawStr(4, y + kOverviewSecondLineOffset, lineTwo);
    }
    y += usesSecondLine ? kOverviewDoubleStepAdvance : kOverviewSingleStepAdvance;
  }

  u8g2.sendBuffer();
}

}  // namespace

void markOverlayDirty() {
  overlayDirty = true;
}

void hideSelectedStepOverlay() {
  bool wasVisible = overlayVisible;
  overlayVisible = false;
  overlayDirty = false;
  if (wasVisible) {
    u8g2.clearBuffer();
    u8g2.sendBuffer();
  }
}

void resetOverlayState() {
  overlayVisible = false;
  overlayDirty = true;
  overviewShown = false;
  overviewStartStep = 0;
  resetPerformanceMonitorState();
}

bool overviewActive() {
  return overviewShown;
}

void showOverviewPage(bool advancePage) {
  if (advancePage && overviewShown) {
    byte displayedCount = countOverviewStepsThatFit(overviewStartStep);
    byte nextStart = static_cast<byte>(overviewStartStep + displayedCount);
    overviewStartStep = (nextStart < kStepCount) ? nextStart : 0;
  } else {
    overviewStartStep = 0;
  }

  overviewShown = true;
  overlayVisible = false;
  overlayDirty = true;
}

void hideOverview() {
  if (!overviewShown) {
    return;
  }

  overviewShown = false;
  overviewStartStep = 0;
  overlayVisible = false;
  overlayDirty = true;
  if (!hasSelectedStep() && toolMode() == SequencerToolMode::Normal) {
    menu.drawMenu();
  }
}

void drawSequencerOverlay() {
  SequencerToolMode mode = toolMode();

  if (performanceMonitorActive()) {
    keepOverlayDisplayAwake();
    drawPerformanceMonitorOverlay();
    return;
  }

  if (overviewShown) {
    if (!overlayDirty && overlayVisible) {
      return;
    }
    keepOverlayDisplayAwake();
    drawOverviewOverlay();
    return;
  }

  if (!hasSelectedStep() && mode != SequencerToolMode::StatusMessage) {
    if (overlayVisible) {
      hideSelectedStepOverlay();
    }
    return;
  }

  if (!overlayDirty && overlayVisible && mode != SequencerToolMode::ExactLength) {
    return;
  }

  keepOverlayDisplayAwake();

  char headerLabel[20];
  char infoLine[32];
  char noteLineOne[kNoteLineSize];
  char noteLineTwo[kNoteLineSize];
  noteLineOne[0] = '\0';
  noteLineTwo[0] = '\0';

  if (mode == SequencerToolMode::StatusMessage) {
    overlayVisible = true;
    overlayDirty = false;

    u8g2.clearBuffer();
    u8g2.setFont(u8g2_font_6x13_tf);
    u8g2.drawStr(20, 18, statusLineOne());
    u8g2.drawStr(2, 42, statusLineTwo());
    u8g2.sendBuffer();
    return;
  }

  if (!hasSelectedStep()) {
    return;
  }

  byte stepIndex = static_cast<byte>(selectedStepIndex());
  int8_t sourceStepIndex = overlaySourceStepIndex();
  if (sourceStepIndex < 0 || sourceStepIndex >= static_cast<int8_t>(kStepCount)) {
    sourceStepIndex = selectedStepIndex();
  }
  const SequencerStep& target = step(static_cast<byte>(sourceStepIndex));

  if (mode == SequencerToolMode::ExactLength) {
    char currentValueLabel[8];
    char newValueLabel[8];
    snprintf(headerLabel, sizeof(headerLabel), "Exact Length #%02u", static_cast<unsigned>(stepIndex + 1));
    snprintf(currentValueLabel, sizeof(currentValueLabel), "%u", static_cast<unsigned>(exactLengthOriginal()));
    if (exactLengthBufferLength() > 0) {
      snprintf(newValueLabel, sizeof(newValueLabel), "%s", exactLengthBuffer());
    } else {
      newValueLabel[0] = '\0';
    }
    if (((runTime / 400000ULL) % 2ULL) == 0ULL && strlen(newValueLabel) < sizeof(newValueLabel) - 1) {
      size_t newLength = strlen(newValueLabel);
      newValueLabel[newLength] = '_';
      newValueLabel[newLength + 1] = '\0';
    }

    overlayVisible = true;
    overlayDirty = false;

    u8g2.clearBuffer();
    u8g2.setFont(u8g2_font_6x13_tf);
    u8g2.drawStr(2, 12, headerLabel);
    u8g2.drawStr(8, 24, "Current:");
    u8g2.drawStr(8, 38, "New:");
    u8g2.setFont(u8g2_font_7x14_tf);
    u8g2.drawStr(68, 25, currentValueLabel);
    u8g2.drawStr(68, 39, newValueLabel);
    u8g2.setFont(u8g2_font_6x13_tf);
    u8g2.drawStr(8, 54, "0 1 2 3 4");
    u8g2.drawStr(8, 68, "5 6 7 8 9");
    u8g2.setFont(u8g2_font_5x8_tf);
    u8g2.drawStr(8, 82, "<- CANCEL");
    u8g2.drawStr(8, 98, "Press encoder");
    u8g2.drawStr(8, 110, "to save");
    u8g2.sendBuffer();
    return;
  }

  if (mode == SequencerToolMode::ExactVelocity || mode == SequencerToolMode::ExactProbability) {
    bool probabilityMode = (mode == SequencerToolMode::ExactProbability);
    char valueLabel[8];
    snprintf(headerLabel, sizeof(headerLabel), probabilityMode ? "Prob #%02u" : "Vel #%02u",
             static_cast<unsigned>(stepIndex + 1));
    snprintf(infoLine, sizeof(infoLine), "L %u%% V %u P %u%%",
             static_cast<unsigned>(target.gatePercent),
             static_cast<unsigned>(probabilityMode ? target.velocity : velocityDisplay()),
             static_cast<unsigned>(probabilityMode ? probabilityDisplay() : target.probability));
    if (probabilityMode) {
      snprintf(valueLabel, sizeof(valueLabel), "%u%%", static_cast<unsigned>(probabilityDisplay()));
    } else {
      snprintf(valueLabel, sizeof(valueLabel), "%u", static_cast<unsigned>(velocityDisplay()));
    }
    fillOverlayNoteLines(target, noteLineOne, sizeof(noteLineOne), noteLineTwo, sizeof(noteLineTwo));

    overlayVisible = true;
    overlayDirty = false;

    u8g2.clearBuffer();
    u8g2.setFont(u8g2_font_6x13_tf);
    u8g2.drawStr(probabilityMode ? 18 : 24, 14, headerLabel);
    u8g2.drawStr(2, 30, infoLine);
    u8g2.drawStr(12, 48, noteLineOne);
    if (noteLineTwo[0] != '\0') {
      u8g2.drawStr(12, 60, noteLineTwo);
    }
    u8g2.drawStr(probabilityMode ? 40 : 44, 82, valueLabel);
    u8g2.setFont(u8g2_font_5x8_tf);
    u8g2.drawStr(8, 98, probabilityMode ? "Turn +/-5%" : "Turn +/-5");
    u8g2.drawStr(8, 116, "Press encoder to save");
    u8g2.sendBuffer();
    return;
  }

  if (mode == SequencerToolMode::ToolsPicker) {
    snprintf(headerLabel, sizeof(headerLabel), "Tools #%02u", static_cast<unsigned>(stepIndex + 1));
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
    u8g2.drawStr(8, 80, "Len Vel Oct+ Oct-");
    u8g2.drawStr(8, 92, "Prob Tie Copy");
    u8g2.drawStr(8, 104, "Cancel/Finished");
    u8g2.sendBuffer();
    return;
  }

  if (mode == SequencerToolMode::CopyTarget && copySourceStepIndex() >= 0) {
    snprintf(headerLabel, sizeof(headerLabel), "Copy #%02u", static_cast<unsigned>(copySourceStepIndex() + 1));
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
    u8g2.drawStr(8, 88, "Tap target step");
    u8g2.drawStr(8, 100, "Tools/enc = exit");
    u8g2.sendBuffer();
    return;
  }

  if (mode == SequencerToolMode::QuickLength) {
    fillOverlayNoteLines(target, noteLineOne, sizeof(noteLineOne), noteLineTwo, sizeof(noteLineTwo));
    overlayVisible = true;
    overlayDirty = false;

    u8g2.clearBuffer();
    u8g2.setFont(u8g2_font_6x13_tf);
    u8g2.drawStr(20, 18, "Step Length");
    snprintf(infoLine, sizeof(infoLine), "Length %u%%", static_cast<unsigned>(quickLengthDisplay()));
    u8g2.drawStr(2, 54, infoLine);
    u8g2.drawStr(12, 96, noteLineOne);
    if (noteLineTwo[0] != '\0') {
      u8g2.drawStr(12, 112, noteLineTwo);
    }
    u8g2.sendBuffer();
    return;
  }

  if (mode == SequencerToolMode::StepCleared) {
    overlayVisible = true;
    overlayDirty = false;

    snprintf(headerLabel, sizeof(headerLabel), "Erased #%02u", static_cast<unsigned>(stepIndex + 1));
    u8g2.clearBuffer();
    u8g2.setFont(u8g2_font_6x13_tf);
    u8g2.drawStr(20, 18, headerLabel);
    u8g2.drawStr(2, 38, "Press blue key");
    u8g2.drawStr(2, 52, "to undo.");
    u8g2.drawStr(2, 74, "Press blinking");
    u8g2.drawStr(2, 88, "key to exit.");
    u8g2.sendBuffer();
    return;
  }

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

bool overviewActive() {
  return false;
}

void showOverviewPage(bool /*advancePage*/) {
}

void hideOverview() {
}

void drawSequencerOverlay() {
}

}  // namespace sequencer
#endif
