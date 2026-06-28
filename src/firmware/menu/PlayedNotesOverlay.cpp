#include "../FirmwareModule.h"
#include "PlayedNotesOverlay.h"
#include "MenuAndDisplay.h"
#include "../app/DiagnosticsTiming.h"
#include "../app/PlatformCommon.h"
#include "../hardware/GridState.h"
#include "../sequencer/SequencerManagedNotes.h"
#include "../sequencer/SequencerMode.h"
#include "../sequencer/SequencerOverlay.h"

// --- Note display overlay when pressing keys ---
byte noteDisplayMode = NOTE_DISPLAY_OFF;
bool noteOverlayVisible = false;
bool noteBadgeVisible = false;
bool noteOverlayDirty = true;
bool noteOverlayTemporaryWake = false;
bool noteOverlayWokeDisplayFromSleep = false;
uint64_t noteOverlayHoldUntil = 0;
uint64_t noteOverlayReleaseGraceUntil = 0;
int16_t displayedNotes[DISPLAYED_NOTES_MAX] = {
  DISPLAYED_NOTE_UNUSED, DISPLAYED_NOTE_UNUSED, DISPLAYED_NOTE_UNUSED,
  DISPLAYED_NOTE_UNUSED, DISPLAYED_NOTE_UNUSED, DISPLAYED_NOTE_UNUSED
};
char noteBadgeText[PLAYED_NOTE_TEXT_MAX] = "";

const char* const chromaticNames[12] = {
  "C", "C#", "D", "Eb", "E", "F",
  "F#", "G", "G#", "A", "Bb", "B"
};

struct ChordPattern {
  uint16_t intervals;
  const char* suffix;
};

constexpr uint16_t chordIntervalBit(byte interval) {
  return static_cast<uint16_t>(1U << interval);
}

const ChordPattern chordPatterns[] = {
  { chordIntervalBit(0) | chordIntervalBit(2) | chordIntervalBit(4) | chordIntervalBit(7) | chordIntervalBit(9) | chordIntervalBit(11), "maj13" },
  { chordIntervalBit(0) | chordIntervalBit(2) | chordIntervalBit(4) | chordIntervalBit(7) | chordIntervalBit(9) | chordIntervalBit(10), "13" },
  { chordIntervalBit(0) | chordIntervalBit(2) | chordIntervalBit(3) | chordIntervalBit(7) | chordIntervalBit(9) | chordIntervalBit(10), "m13" },
  { chordIntervalBit(0) | chordIntervalBit(2) | chordIntervalBit(4) | chordIntervalBit(5) | chordIntervalBit(7) | chordIntervalBit(10), "11" },
  { chordIntervalBit(0) | chordIntervalBit(2) | chordIntervalBit(3) | chordIntervalBit(5) | chordIntervalBit(7) | chordIntervalBit(10), "m11" },
  { chordIntervalBit(0) | chordIntervalBit(2) | chordIntervalBit(4) | chordIntervalBit(7) | chordIntervalBit(11), "maj9" },
  { chordIntervalBit(0) | chordIntervalBit(2) | chordIntervalBit(4) | chordIntervalBit(7) | chordIntervalBit(10), "9" },
  { chordIntervalBit(0) | chordIntervalBit(2) | chordIntervalBit(3) | chordIntervalBit(7) | chordIntervalBit(10), "m9" },
  { chordIntervalBit(0) | chordIntervalBit(2) | chordIntervalBit(3) | chordIntervalBit(7) | chordIntervalBit(11), "mMaj9" },
  { chordIntervalBit(0) | chordIntervalBit(2) | chordIntervalBit(4) | chordIntervalBit(7) | chordIntervalBit(9), "6/9" },
  { chordIntervalBit(0) | chordIntervalBit(2) | chordIntervalBit(3) | chordIntervalBit(7) | chordIntervalBit(9), "m6/9" },
  { chordIntervalBit(0) | chordIntervalBit(2) | chordIntervalBit(4) | chordIntervalBit(7), "add9" },
  { chordIntervalBit(0) | chordIntervalBit(2) | chordIntervalBit(3) | chordIntervalBit(7), "madd9" },
  { chordIntervalBit(0) | chordIntervalBit(4) | chordIntervalBit(7) | chordIntervalBit(11), "maj7" },
  { chordIntervalBit(0) | chordIntervalBit(4) | chordIntervalBit(7) | chordIntervalBit(10), "7" },
  { chordIntervalBit(0) | chordIntervalBit(3) | chordIntervalBit(7) | chordIntervalBit(10), "m7" },
  { chordIntervalBit(0) | chordIntervalBit(3) | chordIntervalBit(7) | chordIntervalBit(11), "mMaj7" },
  { chordIntervalBit(0) | chordIntervalBit(3) | chordIntervalBit(6) | chordIntervalBit(10), "m7b5" },
  { chordIntervalBit(0) | chordIntervalBit(3) | chordIntervalBit(6) | chordIntervalBit(9), "dim7" },
  { chordIntervalBit(0) | chordIntervalBit(4) | chordIntervalBit(8) | chordIntervalBit(10), "aug7" },
  { chordIntervalBit(0) | chordIntervalBit(4) | chordIntervalBit(8) | chordIntervalBit(11), "augMaj7" },
  { chordIntervalBit(0) | chordIntervalBit(5) | chordIntervalBit(7) | chordIntervalBit(10), "7sus4" },
  { chordIntervalBit(0) | chordIntervalBit(2) | chordIntervalBit(7) | chordIntervalBit(10), "7sus2" },
  { chordIntervalBit(0) | chordIntervalBit(4) | chordIntervalBit(7) | chordIntervalBit(9), "6" },
  { chordIntervalBit(0) | chordIntervalBit(3) | chordIntervalBit(7) | chordIntervalBit(9), "m6" },
  { chordIntervalBit(0) | chordIntervalBit(4) | chordIntervalBit(7), "" },
  { chordIntervalBit(0) | chordIntervalBit(3) | chordIntervalBit(7), "m" },
  { chordIntervalBit(0) | chordIntervalBit(3) | chordIntervalBit(6), "dim" },
  { chordIntervalBit(0) | chordIntervalBit(4) | chordIntervalBit(8), "aug" },
  { chordIntervalBit(0) | chordIntervalBit(2) | chordIntervalBit(7), "sus2" },
  { chordIntervalBit(0) | chordIntervalBit(5) | chordIntervalBit(7), "sus4" }
};
const byte CHORD_PATTERN_COUNT = sizeof(chordPatterns) / sizeof(chordPatterns[0]);

// The overlay renderer is shared by keyboard notes and Sequencer lower-grid
// audition notes; Sequencer supplies snapshots through a narrow source API.
enum class PlayedNoteDisplaySource : byte {
  None,
  Keyboard,
  Sequencer
};

void clearDisplayedNotes(int16_t* notes);
void copyDisplayedNotes(int16_t* destination, const int16_t* source);
byte rebuildDisplayedNotes(int16_t* notes);
byte displayedNoteCount(const int16_t* notes);
bool displayedNotesEqual(const int16_t* first, const int16_t* second);
bool buildDisplayedChordName(const int16_t* notes, byte count, char* chordText, size_t chordTextSize);
bool newestHeldDisplayedPitch(int16_t& displayedPitchOut);
PlayedNoteDisplaySource activePlayedNoteDisplaySource();
byte rebuildDisplayedNotesForSource(PlayedNoteDisplaySource source, int16_t* notes);
bool newestHeldDisplayedPitchForSource(PlayedNoteDisplaySource source, int16_t& displayedPitchOut);
void formatDisplayedPitchNumber(int16_t displayedPitch, char* noteText, size_t noteTextSize);
void formatDisplayedPitchLabel(int16_t displayedPitch, char* noteText, size_t noteTextSize);
void formatDisplayedPitch(int16_t displayedPitch, char* noteText, size_t noteTextSize);
void restorePlayedNotesUnderlyingDisplay();
void drawCompactPlayedNoteBadgeFrame(const char* noteText);
void drawCompactPlayedNoteBadge(PlayedNoteDisplaySource source);
extern bool screenSaverOn;

byte normalizeNoteDisplayMode(byte mode) {
  switch (mode) {
    case NOTE_DISPLAY_OFF:
    case NOTE_DISPLAY_LABEL:
    case NOTE_DISPLAY_NUMBER:
      return mode;
    default:
      return NOTE_DISPLAY_LABEL;
  }
}

bool noteDisplayEnabled() {
  return noteDisplayMode != NOTE_DISPLAY_OFF;
}

bool setNoteOverlayTemporaryWake(bool enabled) {
  noteOverlayTemporaryWake = enabled;
  if (enabled) {
    noteOverlayWokeDisplayFromSleep = screenSaverOn;
    if (screenSaverOn) {
      screenSaverOn = 0;
      u8g2.setContrast(CONTRAST_AWAKE);
    }
    return false;
  }

  bool returnedToSleep = noteOverlayWokeDisplayFromSleep && screenTime > screenSaverTimeout;
  if (returnedToSleep && !screenSaverOn) {
    screenSaverOn = 1;
    u8g2.setContrast(CONTRAST_SCREENSAVER);
    u8g2.clear();
  }
  noteOverlayWokeDisplayFromSleep = false;
  return returnedToSleep;
}

void dismissPlayedNotesOverlayForMenuInput() {
  if (!noteOverlayTemporaryWake && !noteOverlayVisible) {
    return;
  }

  screenTime = 0;
  if (screenSaverOn) {
    screenSaverOn = 0;
    u8g2.setContrast(CONTRAST_AWAKE);
  }
  noteOverlayTemporaryWake = false;
  noteOverlayWokeDisplayFromSleep = false;
  noteOverlayVisible = false;
  noteOverlayHoldUntil = 0;
  noteOverlayReleaseGraceUntil = 0;
  clearDisplayedNotes(displayedNotes);
  noteOverlayDirty = true;
}

void clearDisplayedNotes(int16_t* notes) {
  for (byte i = 0; i < DISPLAYED_NOTES_MAX; i++) {
    notes[i] = DISPLAYED_NOTE_UNUSED;
  }
}

void copyDisplayedNotes(int16_t* destination, const int16_t* source) {
  for (byte i = 0; i < DISPLAYED_NOTES_MAX; i++) {
    destination[i] = source[i];
  }
}

byte insertDisplayedNoteSorted(int16_t* notes, byte count, int16_t displayedPitch) {
  for (byte i = 0; i < count; i++) {
    if (notes[i] == displayedPitch) {
      return count;
    }
  }

  byte insertAt = 0;
  while (insertAt < count && notes[insertAt] < displayedPitch) {
    insertAt++;
  }

  if (count < DISPLAYED_NOTES_MAX) {
    for (byte i = count; i > insertAt; i--) {
      notes[i] = notes[i - 1];
    }
    notes[insertAt] = displayedPitch;
    return count + 1;
  }

  if (insertAt < DISPLAYED_NOTES_MAX) {
    for (byte i = DISPLAYED_NOTES_MAX - 1; i > insertAt; i--) {
      notes[i] = notes[i - 1];
    }
    notes[insertAt] = displayedPitch;
  }

  return count;
}

byte rebuildDisplayedNotes(int16_t* notes) {
  clearDisplayedNotes(notes);
  byte out = 0;
  for (byte i = 0; i < LED_COUNT; i++) {
    if (h[i].isCmd || h[i].MIDIch == 0) {
      continue;
    }

    int16_t displayedPitch = h[i].stepsFromC + current.transpose;
    out = insertDisplayedNoteSorted(notes, out, displayedPitch);
  }
  return out;
}

byte displayedNoteCount(const int16_t* notes) {
  byte count = 0;
  for (byte i = 0; i < DISPLAYED_NOTES_MAX; i++) {
    if (notes[i] != DISPLAYED_NOTE_UNUSED) {
      count++;
    }
  }
  return count;
}

bool displayedNotesEqual(const int16_t* first, const int16_t* second) {
  for (byte i = 0; i < DISPLAYED_NOTES_MAX; i++) {
    if (first[i] != second[i]) {
      return false;
    }
  }
  return true;
}

PlayedNoteDisplaySource activePlayedNoteDisplaySource() {
  if (!sequencerModeActive()) {
    return PlayedNoteDisplaySource::Keyboard;
  }

  if (!sequencer::sequencerPlayedNoteDisplayEligible()) {
    return PlayedNoteDisplaySource::None;
  }

  if (sequencer::sequencerPlayedNoteDisplayActive()
      || noteOverlayTemporaryWake
      || noteOverlayVisible
      || noteBadgeVisible
      || displayedNoteCount(displayedNotes) > 0) {
    return PlayedNoteDisplaySource::Sequencer;
  }
  return PlayedNoteDisplaySource::None;
}

byte rebuildDisplayedNotesForSource(PlayedNoteDisplaySource source, int16_t* notes) {
  switch (source) {
    case PlayedNoteDisplaySource::Keyboard:
      return rebuildDisplayedNotes(notes);
    case PlayedNoteDisplaySource::Sequencer:
      return sequencer::rebuildSequencerPlayedNoteDisplay(notes, DISPLAYED_NOTES_MAX);
    case PlayedNoteDisplaySource::None:
    default:
      clearDisplayedNotes(notes);
      return 0;
  }
}

bool newestHeldDisplayedPitchForSource(PlayedNoteDisplaySource source, int16_t& displayedPitchOut) {
  switch (source) {
    case PlayedNoteDisplaySource::Keyboard:
      return newestHeldDisplayedPitch(displayedPitchOut);
    case PlayedNoteDisplaySource::Sequencer:
      return sequencer::newestSequencerPlayedNoteDisplayPitch(displayedPitchOut);
    case PlayedNoteDisplaySource::None:
    default:
      return false;
  }
}

uint16_t pitchClassMaskRelativeToRoot(uint16_t pitchClassMask, byte rootPitchClass) {
  uint16_t relativeMask = 0;
  for (byte pitchClass = 0; pitchClass < 12; pitchClass++) {
    if (pitchClassMask & chordIntervalBit(pitchClass)) {
      relativeMask |= chordIntervalBit(positiveMod(pitchClass - rootPitchClass, 12));
    }
  }
  return relativeMask;
}

const char* matchedChordSuffix(uint16_t pitchClassMask, byte rootPitchClass) {
  uint16_t relativeMask = pitchClassMaskRelativeToRoot(pitchClassMask, rootPitchClass);
  for (byte i = 0; i < CHORD_PATTERN_COUNT; i++) {
    if (chordPatterns[i].intervals == relativeMask) {
      return chordPatterns[i].suffix;
    }
  }
  return nullptr;
}

bool writeChordName(uint16_t pitchClassMask, byte rootPitchClass, byte bassPitchClass, char* chordText, size_t chordTextSize) {
  const char* suffix = matchedChordSuffix(pitchClassMask, rootPitchClass);
  if (suffix == nullptr) {
    return false;
  }

  const char* rootName = chromaticNames[rootPitchClass];
  if (bassPitchClass == rootPitchClass) {
    snprintf(chordText, chordTextSize, "%s%s", rootName, suffix);
  } else {
    snprintf(chordText, chordTextSize, "%s%s/%s", rootName, suffix, chromaticNames[bassPitchClass]);
  }
  return true;
}

bool tuningSupportsChordNames() {
  const tuningDef& tuning = current.tuning();
  float stepDelta = tuning.stepSize - 100.0f;
  if (stepDelta < 0.0f) {
    stepDelta = -stepDelta;
  }
  return tuning.cycleLength == 12 && stepDelta < 0.01f;
}

bool buildDisplayedChordName(const int16_t* notes, byte count, char* chordText, size_t chordTextSize) {
  if (!tuningSupportsChordNames() || chordTextSize == 0) {
    return false;
  }

  chordText[0] = '\0';
  uint16_t pitchClassMask = 0;
  byte pitchClassOrder[12];
  byte pitchClassCount = 0;
  byte bassPitchClass = 0;
  bool hasBass = false;

  for (byte i = 0; i < count; i++) {
    if (notes[i] == DISPLAYED_NOTE_UNUSED) {
      continue;
    }

    byte pitchClass = positiveMod(notes[i], 12);
    if (!hasBass) {
      bassPitchClass = pitchClass;
      hasBass = true;
    }

    uint16_t bit = chordIntervalBit(pitchClass);
    if (!(pitchClassMask & bit)) {
      pitchClassMask |= bit;
      pitchClassOrder[pitchClassCount++] = pitchClass;
    }
  }

  if (pitchClassCount < 3) {
    return false;
  }

  if (writeChordName(pitchClassMask, bassPitchClass, bassPitchClass, chordText, chordTextSize)) {
    return true;
  }

  for (byte i = 0; i < pitchClassCount; i++) {
    if (pitchClassOrder[i] != bassPitchClass &&
        writeChordName(pitchClassMask, pitchClassOrder[i], bassPitchClass, chordText, chordTextSize)) {
      return true;
    }
  }

  return false;
}

bool newestHeldDisplayedPitch(int16_t& displayedPitchOut) {
  bool found = false;
  uint64_t newestPressTime = 0;
  for (byte i = 0; i < LED_COUNT; i++) {
    if (h[i].isCmd || h[i].MIDIch == 0) {
      continue;
    }

    if (!found || h[i].timePressed >= newestPressTime) {
      newestPressTime = h[i].timePressed;
      displayedPitchOut = h[i].stepsFromC + current.transpose;
      found = true;
    }
  }
  return found;
}

void formatDisplayedPitchNumber(int16_t displayedPitch, char* noteText, size_t noteTextSize) {
  int cycleLength = current.tuning().cycleLength;
  if (cycleLength <= 0) {
    snprintf(noteText, noteTextSize, "?");
    return;
  }
  int step = positiveMod(displayedPitch, cycleLength);
  int octave = ((displayedPitch - step) / cycleLength) + 4;
  snprintf(noteText, noteTextSize, "%d.%d", step, octave);
}

void formatDisplayedPitchLabel(int16_t displayedPitch, char* noteText, size_t noteTextSize) {
  int cycleLength = current.tuning().cycleLength;
  if (cycleLength <= 0) {
    snprintf(noteText, noteTextSize, "?");
    return;
  }

  int step = positiveMod(displayedPitch, cycleLength);
  const char* label = current.tuning().keyChoices[step].name;
  while (label && *label == ' ') {
    ++label;
  }
  if (!label || label[0] == '\0') {
    formatDisplayedPitchNumber(displayedPitch, noteText, noteTextSize);
    return;
  }
  int octave = ((displayedPitch - step) / cycleLength) + 4;
  snprintf(noteText, noteTextSize, "%.*s%d", static_cast<int>(TUNING_KEY_LABEL_LENGTH - 1), label, octave);
}

void formatDisplayedPitch(int16_t displayedPitch, char* noteText, size_t noteTextSize) {
  if (noteDisplayMode == NOTE_DISPLAY_NUMBER) {
    formatDisplayedPitchNumber(displayedPitch, noteText, noteTextSize);
  } else {
    formatDisplayedPitchLabel(displayedPitch, noteText, noteTextSize);
  }
}

void drawCompactPlayedNoteBadgeFrame(const char* noteText) {
  if (!noteText || noteText[0] == '\0') {
    return;
  }

  int badgeX = u8g2.getDisplayWidth() - PLAYED_NOTE_BADGE_WIDTH;
  if (badgeX < 0) {
    badgeX = 0;
  }

  u8g2.setDrawColor(0);
  u8g2.drawBox(badgeX, 0, PLAYED_NOTE_BADGE_WIDTH, PLAYED_NOTE_BADGE_HEIGHT);
  u8g2.setDrawColor(1);
  u8g2.setFont(u8g2_font_logisoso16_tf);
  int noteWidth = u8g2.getStrWidth(noteText);
  int noteX = u8g2.getDisplayWidth() - noteWidth - PLAYED_NOTE_BADGE_MARGIN;
  if (noteX < 0) {
    noteX = 0;
  }
  u8g2.drawStr(noteX, PLAYED_NOTE_BADGE_BASELINE, noteText);
}

void drawPlayedNoteBadgeOnMenuFrame() {
  if (sequencerModeActive()) {
    sequencer::clearSequencerIdleDisplayBlanked();
  }

  if (!noteDisplayEnabled()
      || noteOverlayTemporaryWake
      || noteOverlayVisible
      || !noteBadgeVisible
      || noteBadgeText[0] == '\0'
      || screenSaverOn) {
    return;
  }

  drawCompactPlayedNoteBadgeFrame(noteBadgeText);
}

void restorePlayedNotesUnderlyingDisplay() {
  if (sequencerModeActive()) {
    restoreSequencerDisplayAfterPlayedNotesOverlay();
  } else {
    restoreInteractiveMenuDisplay();
  }
}

void drawCompactPlayedNoteBadge(PlayedNoteDisplaySource source) {
  int16_t displayedPitch = 0;
  if (!newestHeldDisplayedPitchForSource(source, displayedPitch)) {
    if (noteBadgeVisible) {
      noteBadgeVisible = false;
      noteBadgeText[0] = '\0';
      noteOverlayDirty = false;
      restorePlayedNotesUnderlyingDisplay();
    } else {
      noteOverlayDirty = false;
    }
    return;
  }

  char latestNoteText[sizeof(noteBadgeText)];
  formatDisplayedPitch(displayedPitch, latestNoteText, sizeof(latestNoteText));
  if (!noteOverlayDirty && noteBadgeVisible && strcmp(noteBadgeText, latestNoteText) == 0) {
    return;
  }

  strncpy(noteBadgeText, latestNoteText, sizeof(noteBadgeText));
  noteBadgeText[sizeof(noteBadgeText) - 1] = '\0';
  noteBadgeVisible = true;
  noteOverlayVisible = false;
  noteOverlayDirty = false;

  drawCompactPlayedNoteBadgeFrame(noteBadgeText);
  u8g2.sendBuffer();
}

void onToggleDisplayPlayedNotes() {
  if (!noteDisplayEnabled() && (noteOverlayVisible || noteBadgeVisible || noteOverlayTemporaryWake)) {
    noteOverlayVisible = false;
    noteBadgeVisible = false;
    noteOverlayDirty = false;
    bool returnedToSleep = setNoteOverlayTemporaryWake(false);
    noteOverlayHoldUntil = 0;
    noteOverlayReleaseGraceUntil = 0;
    noteBadgeText[0] = '\0';
    clearDisplayedNotes(displayedNotes);
    if (!returnedToSleep) {
      restorePlayedNotesUnderlyingDisplay();
    }
  } else if (noteDisplayEnabled()) {
    noteOverlayDirty = true;
  }
}

void drawPlayedNotesOverlay() {
  if (delegatedControl) {
    return;
  }

  PlayedNoteDisplaySource source = activePlayedNoteDisplaySource();

  if (!noteDisplayEnabled() || source == PlayedNoteDisplaySource::None) {
    if (noteBadgeVisible || noteOverlayVisible || noteOverlayTemporaryWake) {
      noteBadgeVisible = false;
      noteOverlayVisible = false;
      noteOverlayDirty = false;
      noteBadgeText[0] = '\0';
      bool returnedToSleep = setNoteOverlayTemporaryWake(false);
      noteOverlayHoldUntil = 0;
      noteOverlayReleaseGraceUntil = 0;
      clearDisplayedNotes(displayedNotes);
      if (!returnedToSleep) {
        restorePlayedNotesUnderlyingDisplay();
      }
    }
    return;
  }

  if (screenSaverOn && !noteOverlayTemporaryWake) {
    return;
  }

  if (!noteOverlayTemporaryWake) {
    drawCompactPlayedNoteBadge(source);
    return;
  }

  int16_t activeDisplayedNotes[DISPLAYED_NOTES_MAX];
  byte activeCount = rebuildDisplayedNotesForSource(source, activeDisplayedNotes);
  byte countBefore = displayedNoteCount(displayedNotes);
  bool snapshotChanged = false;

  if (activeCount > 0) {
    bool notesChanged = !displayedNotesEqual(displayedNotes, activeDisplayedNotes);
    bool shouldDelayChordShrink = notesChanged &&
                                  activeCount < countBefore &&
                                  countBefore > 0 &&
                                  runTime <= noteOverlayReleaseGraceUntil;

    if (!shouldDelayChordShrink && notesChanged) {
      copyDisplayedNotes(displayedNotes, activeDisplayedNotes);
      snapshotChanged = true;
    }

    noteOverlayHoldUntil = runTime + DISPLAYED_NOTES_HOLD_MICROS;
    if (!shouldDelayChordShrink) {
      noteOverlayReleaseGraceUntil = 0;
    }
  }

  byte count = displayedNoteCount(displayedNotes);

  if (activeCount == 0 && (count == 0 || runTime > noteOverlayHoldUntil)) {
    bool returnedToSleep = setNoteOverlayTemporaryWake(false);
    noteOverlayHoldUntil = 0;
    noteOverlayReleaseGraceUntil = 0;
    clearDisplayedNotes(displayedNotes);
    if (noteOverlayVisible) {
      noteOverlayVisible = false;
      noteOverlayDirty = false;
      if (!returnedToSleep) {
        restorePlayedNotesUnderlyingDisplay();
      }
    }
    return;
  }

  if (!noteOverlayDirty && noteOverlayVisible && !snapshotChanged) {
    return;
  }

  noteOverlayVisible = true;
  noteBadgeVisible = false;
  noteBadgeText[0] = '\0';
  noteOverlayDirty = false;

  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_6x13_tf);
  u8g2.drawStr(8, 16, "Now Playing");

  for (byte i = 0; i < count; i++) {
    int16_t displayedPitch = displayedNotes[i];
    char noteText[PLAYED_NOTE_TEXT_MAX];
    formatDisplayedPitch(displayedPitch, noteText, sizeof(noteText));

    byte col = i % 3;
    byte row = i / 3;
    int x = PLAYED_NOTE_COLUMN_X[col];
    int y = 34 + (row * 26);

    u8g2.setFont(u8g2_font_logisoso16_tf);
    u8g2.drawStr(x, y, noteText);
  }

  char chordText[CHORD_NAME_MAX];
  if (buildDisplayedChordName(displayedNotes, count, chordText, sizeof(chordText))) {
    u8g2.setFont(u8g2_font_logisoso16_tf);
    int chordWidth = u8g2.getStrWidth(chordText);
    if (chordWidth > u8g2.getDisplayWidth()) {
      u8g2.setFont(u8g2_font_6x13_tf);
      chordWidth = u8g2.getStrWidth(chordText);
    }

    int chordX = (u8g2.getDisplayWidth() - chordWidth) / 2;
    if (chordX < 0) {
      chordX = 0;
    }
    u8g2.drawStr(chordX, PLAYED_CHORD_Y, chordText);
  }

  u8g2.sendBuffer();
}
