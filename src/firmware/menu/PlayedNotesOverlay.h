#pragma once

#include "../FirmwareModule.h"

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
constexpr byte PLAYED_NOTE_TEXT_MAX = 12;
constexpr byte NOTE_DISPLAY_OFF = 0;
constexpr byte NOTE_DISPLAY_LABEL = 1;
constexpr byte NOTE_DISPLAY_NUMBER = 2;

extern byte noteDisplayMode;
extern bool noteOverlayVisible;
extern bool noteBadgeVisible;
extern bool noteOverlayDirty;
extern bool noteOverlayTemporaryWake;
extern bool noteOverlayWokeDisplayFromSleep;
extern uint64_t noteOverlayHoldUntil;
extern uint64_t noteOverlayReleaseGraceUntil;
extern int16_t displayedNotes[DISPLAYED_NOTES_MAX];
extern char noteBadgeText[PLAYED_NOTE_TEXT_MAX];
extern bool screenSaverOn;

byte normalizeNoteDisplayMode(byte mode);
bool noteDisplayEnabled();
bool setNoteOverlayTemporaryWake(bool enabled);
void dismissPlayedNotesOverlayForMenuInput();
void drawPlayedNotesOverlay();
void onToggleDisplayPlayedNotes();
