#if HEXBOARD_FIRMWARE_UNITY

#include "../FirmwareModule.h"

// --- Note display overlay when pressing keys ---
constexpr byte DISPLAYED_NOTES_MAX = 6;
constexpr int16_t DISPLAYED_NOTE_UNUSED = INT16_MIN;
constexpr uint64_t DISPLAYED_NOTES_HOLD_MICROS = 2000000ULL;
constexpr uint64_t DISPLAYED_NOTES_RELEASE_GRACE_MICROS = 80000ULL;
constexpr int PLAYED_NOTE_COLUMN_X[3] = { 0, 44, 88 };
constexpr int PLAYED_CHORD_Y = 92;
constexpr int PLAYED_NOTE_BADGE_WIDTH = 42;
constexpr int PLAYED_NOTE_BADGE_HEIGHT = 20;
constexpr int PLAYED_NOTE_BADGE_MARGIN = 2;
constexpr int PLAYED_NOTE_BADGE_BASELINE = 0;
constexpr byte CHORD_NAME_MAX = 18;
bool displayPlayedNotes = false;
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
char noteBadgeText[12] = "";

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

void clearDisplayedNotes(int16_t* notes);
void copyDisplayedNotes(int16_t* destination, const int16_t* source);
byte rebuildDisplayedNotes(int16_t* notes);
byte displayedNoteCount(const int16_t* notes);
bool displayedNotesEqual(const int16_t* first, const int16_t* second);
bool buildDisplayedChordName(const int16_t* notes, byte count, char* chordText, size_t chordTextSize);
bool newestHeldDisplayedPitch(int16_t& displayedPitchOut);
void formatDisplayedPitch(int16_t displayedPitch, char* noteText, size_t noteTextSize);
void drawCompactPlayedNoteBadge();
void drawPlayedNotesOverlay();
void onToggleDisplayPlayedNotes();
bool setNoteOverlayTemporaryWake(bool enabled);
extern bool screenSaverOn;
#endif  // HEXBOARD_FIRMWARE_UNITY
