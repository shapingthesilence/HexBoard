# User Course Files

User operation belongs in the [web guide](web-app-guide.md#creating-and-sharing-courses).
This reference describes the implemented browser format and evaluation rules.

## Portable format

A `.hexcourse.json` file has `format: "hexboard.course.v1"`, `id`, positive
integer `revision`, `title`, optional-empty `author`, `bundle`, optional
`layoutId`, and `lessons`. The embedded `bundle` uses the existing normalized
[TuningBundle](../web/src/catalogs/layoutsCatalog.ts) shape: tuning definition,
reference frequency, palette, layouts (including explicit button overrides),
scales, and active layout/scale IDs. It is a snapshot, independent of the
recipient's device library. Courses do not perform device storage writes.

`layoutId` requires an included layout. Without it, the player offers included
layouts and already-loaded layouts with the identical tuning definition.
Fingering rules apply only to the layout ID for which they were authored.

Each lesson contains:

| Field | Meaning |
| --- | --- |
| `id`, `title`, `section`, `instruction` | Identity and plain-text teaching content |
| `targets` | Ordered pitch arrays: one pitch for a melody, several for a chord, empty for a timed rest |
| `timing` (optional) | Integer `bpm` (40–180) and a `beats` array with one duration per target |
| `fingerings` (optional) | Per-layout `{layoutId, steps}` entries, with one cue array per target |

Pitches are MIDI-equivalent numbers in 0–127, including fractional values for
microtonal pitches. They specify exact pitches, not octave-independent classes.
Durations are 0.25–8 beats in quarter-beat increments. Untimed lessons cannot
contain rests. Each cue has a target `note`, optional physical `button` index,
optional `hand` (`left`/`right`), optional `finger` (1–5), and optional
`acceptDuplicates` (defaults true). A button must resolve to that note in its
embedded layout; command/disabled/chord-action keys cannot be assigned.

Import limits: 2 MB per file, 100 lessons per course, 256 targets per lesson,
10 distinct notes per chord, and 50 courses in the browser library. Validation
requires each lesson to fit its required layout, or at least one included layout
when unrestricted. The player rechecks range for the chosen layout.
Invalid files report an error; invalid stored course entries are skipped without
removing valid entries. Imported content with an existing ID but different
content receives a new course ID, preserving the local original.

## Timing and key evaluation

Free lessons wait for correct notes. Single-note targets allow overlap. Chords
require their target pitches held together with unrelated pitches released;
common tones may remain held between chords. When a cue disallows duplicates,
the specified physical key is required. Hand/finger labels are instructional
only: the hardware cannot identify which hand or finger pressed a key.

Timed lessons share the metronome's audio/performance clock mapping. Four clicks
count in; each target starts at the cumulative sum of prior beat durations.
Onset windows extend at most half a beat on either side, narrowed at neighboring
subdivision boundaries. A hit advances the visual cue immediately without
moving later scheduled targets. Silence advances missed targets. Attacks during
rests or between valid onset windows count as extra attempts; previously held
notes can ring through a rest. Note-off duration is not graded.

Timed chords require simultaneous target membership and at least one fresh
attack within their window. Timing uses the largest absolute error among their
new attacks and any final release needed to remove an unrelated note. Quiet
rests receive credit when their interval ends. The grade rewards timing and
penalizes misses/extras. A timed course run records completion only when every
step is satisfied and the score is at least 75. Independent completion also
requires zero extra attempts and no hints/demonstration during the run.

Progress for user lessons is keyed by course ID, revision, and lesson ID, with
separate results per tuning/layout ID. Saving edits increments the revision;
previous completion cannot silently count toward a changed lesson. Course
exports do not contain learner progress; that has its own backup workflow.

## Authoring ownership

- `web/src/learn/courseFiles.ts`: portable schema validation, phrase parsing,
  cue matching, and per-course progress IDs.
- `web/src/learn/CourseEditor.tsx`: authoring UI, browser audio and delegated
  recording-session lifecycle.
- `web/src/learn/phraseRecorder.ts`: raw-key capture, grouping, onset timing,
  quarter-beat quantization, and physical-key preferences.
- `web/src/learn/beginnerCourse.ts`: bundled lessons and free chord evaluation.
- `web/src/learn/scalePractice.ts`: scheduled pitch/chord/rest evaluation.

Recording captures raw key IDs through the same acknowledged version-2 session
as practice. The browser interprets them through the author's chosen embedded
layout, plays sound, and paints held-key LEDs. Melody mode captures every fresh
attack without a release barrier. Chord mode groups attacks until all keys are
released. Timed capture quantizes onset spacing to quarter beats, clamped to
0.25–8 beats; the last release sets the final duration. Authors can edit durations
and insert explicit rests afterward. Stopping flushes a pending final chord.
Recording ends on Finish, encoder exit, disconnect, hidden tab, page exit,
cancel, or unmount. Saving is disabled while recording.
