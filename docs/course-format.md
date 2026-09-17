# User Course Files

User operation belongs in the [web guide](web-app-guide.md#creating-and-sharing-courses).
This reference describes the implemented browser format and evaluation rules.

## Portable format

A `.hexcourse.json` file has `format: "hexboard.course.v2"`, `id`, positive
integer `revision`, `title`, optional-empty `author`, `bundle`, optional
`layoutId`, and `lessons`. The embedded `bundle` uses the existing normalized
[TuningBundle](../web/src/catalogs/layoutsCatalog.ts) shape: tuning definition,
reference frequency, palette, layouts (including explicit button overrides),
scales, and active layout/scale IDs. It is a snapshot, independent of the
recipient's device library. Courses do not perform device storage writes.

`layoutId` requires an included layout. Without it, the player offers included
layouts only. The author explicitly selects tuning, layouts, and relevant scales
from the browser library or the connected HexBoard library. Loading a layout
elsewhere in Learn never adds it to a course. Device reads remain lazy: names
first, then only the selected definitions.
Fingering rules apply only to the layout ID for which they were authored.

Each lesson contains:

| Field | Meaning |
| --- | --- |
| `id`, `title`, `section`, `instruction` | Identity and plain-text teaching content |
| `targets` | Ordered pitch arrays: one pitch for a melody, several for a chord, empty for a timed rest |
| `timing` (optional) | Integer `goalBpm` (20–300), `beats` onset spacing per step, optional per-note `holdBeats` |
| `timeSignature` (optional) | `{numerator, denominator}`; numerator 1–16, denominator 2, 4, 8, or 16; defaults to 4/4 |
| `fingerings` (optional) | Per-layout `{layoutId, steps}` entries, with one cue array per target |

Pitches are MIDI-equivalent numbers in 0–127, including fractional values for
microtonal pitches. They specify exact pitches, not octave-independent classes.
All timing values use quarter-note units, regardless of time signature. Step
spacing is 0.25–8 quarter notes in sixteenth-note increments. Meter controls
bar grouping in the roll and does not change grading, tempo units, or count-in. Untimed lessons cannot
contain rests. `holdBeats`, when present, has one array per step and one
0.25–32 beat value per pitch (an empty array for a rest). Omitted holds default
to the step spacing. Holds may overlap later onsets and affect demonstration
playback only; they are not graded. Each cue has a target `note`, optional physical `button` index,
optional `hand` (`left`/`right`), optional `finger` (1–5), and optional
`acceptDuplicates` (defaults true). A button must resolve to that note in its
embedded layout; command/disabled/chord-action keys cannot be assigned.

Import limits: 2 MB per file, 100 lessons per course, 256 targets per lesson,
10 distinct notes per chord, and 50 courses in the browser library. Validation
requires each lesson to fit its required layout, or at least one included layout
when unrestricted. The player rechecks range for the chosen layout.
Invalid files report an error; invalid stored course entries are skipped without
removing valid entries. Importing an existing course ID presents Update existing, Keep both, and Cancel.
Update retains the course and lesson IDs; Keep both generates a new course ID.
The dialog shows incoming and local revisions. Importing never removes a
recovery draft. Only this v2 format is supported.

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
step is satisfied, the score is at least 75, and learner-selected `practiceBpm`
is at least the authored `goalBpm`. Practice accepts 20–300 BPM and slower runs
receive normal scoring without completion. Practice tempo is player state, not
course content. Independent completion also
requires zero extra attempts and no hints/demonstration during the run.

## Identity, progress, and storage

Course and lesson IDs remain stable during editing. Course `revision` increases
when a saved course is edited, but it does not define assessment compatibility.
Progress uses course ID, lesson ID, and a deterministic assessment fingerprint
of target pitch sets, onset spacing, goal tempo, strict physical-key rules, and
required-layout constraint. Titles, explanations, lesson order, hand/finger
advice, time signatures, accepted duplicate preferences, and playback-only holds
are excluded.
Changing one lesson cannot invalidate another lesson's progress.

Layout results also include a fingerprint of resolved physical-key pitches.
Adding a supported layout preserves results on existing layouts; changing a
layout's note mapping invalidates only results on that mapping. Renaming layouts
or changing their colors does not change assessment compatibility. The two
32-bit content hashes are compatibility identifiers, not cryptographic signatures.
Passed runs retain best passing score, highest passed BPM, fewest mistakes, and
independent completion. Course exports exclude learner progress.

`courseStorage.ts` owns IndexedDB `hexboard-learning-v2`, with separate `courses`
and `drafts` object stores. Each edited draft is saved asynchronously in order.
The editor distinguishes draft status from saved course status and offers
recovery, export backup, Undo/Redo (20 edits), and a close warning. Saving the
course validates the file before replacing the saved record and removing its
draft. Failed writes remain visible. Drafts are not a cross-device backup.
Small learner preferences and progress remain in localStorage; progress has a
separate export/import workflow. Course deletion retains recovery drafts.

## Authoring and performance views

`courseTimeline.ts` projects canonical `targets` and `timing` into note events
for the piano roll. Dragging moves pitch/onset; the right edge changes hold.
Edits immediately rebuild the canonical steps, grouping simultaneous notes,
retaining rests and per-note cues, and splitting long empty gaps. No second
piano-roll data model is persisted. Double-click or Command/Ctrl-click adds a
note; Backspace/Delete removes the selected voice without shifting later music.
The roll extends automatically and snaps to quarter, eighth, or sixteenth notes.
The default snap is an eighth note. Free-timing editing uses the same roll,
with fixed quarter-note columns and holds, compacting empty gaps when notes
are edited; it does not introduce timing data into untimed lessons.
Fractional pitches remain exact. Selection identifies a step and voice, shared
by the roll, preferred-key board, and clickable hand panels. Library selection
uses a modal overlay. New lessons and added steps start empty; drafts may be
incomplete, but saved courses require valid, nonempty musical content.
`lessonPreview.ts` derives preview gates from the same canonical data, ending an
earlier overlapping gate before retriggering its pitch. Preview audio and timers
stop on explicit stop, tab hiding, page exit, or editor unmount.
Lesson duplication creates a new lesson ID; reordering preserves IDs and cues.

Performance uses the rotated HexBoard map. Target outlines appear at most one quarter note before their scheduled onset
and converge at that onset, with chord cues sharing a timestamp. Every upcoming
onset in that window can show a cue concurrently, including repeated pitches.
Each step uses its own preferred-button assignments. `TimingCue.tsx` animates
SVG attributes with requestAnimationFrame and honors reduced-motion preference.
LED messages remain state-driven, batched, and deduplicated; no animation frames
are streamed to the board.

Delegated control belongs to the Learn session. Changing lessons stops browser
voices, timers, and the metronome, clears evaluation state, and repaints the
next lesson without entering/exiting the device session. `LearnInputGate`
retains physical held keys across this reset and blocks input until all have
been released. Stop, leaving Learn, device disconnect, page lifecycle cleanup,
or an unrecoverable error closes the session. Ungraded synth play uses the same
audio/session owner; ready, free-play, and completed states accept notes without
advancing evaluation or changing progress. Changing lessons resets hints.
During hinted course practice, held pitches outside the current target use
background light instead of held light. `FingerHands.tsx` renders authoring and
player cues; a finger with one distinct assigned pitch uses that pitch color. Recording has an explicit Stop
recording action and preserves captured work in a recovery draft.

Absolute LED brightness uses the stored hardware setting and normal firmware
brightness/current/gamma processing. Targets send full 7-bit value 127; held
keys use 116; non-recommended duplicates and ordinary background keys both use
`127 * (1 - contrast/100)`. Contrast is a browser learner preference, 25–85%,
default 50% (rounded background value 64). Hue and saturation still follow pitch colors.
Contrast and practice tempo never enter course files.

## Authoring ownership

- `web/src/learn/courseFiles.ts`: portable schema validation, phrase parsing,
  cue matching, and per-course progress IDs.
- `web/src/learn/CourseEditor.tsx`: authoring UI, browser audio and delegated
  recording-session lifecycle.
- `web/src/learn/phraseRecorder.ts`: raw-key capture, grouping, onset timing,
  selectable quarter/eighth/sixteenth quantization (default eighth), per-note holds, and physical-key preferences.
- `web/src/learn/beginnerCourse.ts`: bundled lessons and free chord evaluation.
- `web/src/learn/scalePractice.ts`: scheduled pitch/chord/rest evaluation.

Recording captures raw key IDs through the same acknowledged version-2 session
as practice. The browser interprets them through the author's chosen embedded
layout, plays sound, and paints held-key LEDs. Melody mode captures every fresh
attack without a release barrier. Chord mode groups attacks until all keys are
released. Timed capture quantizes onset spacing to quarter beats, clamped to
0.25–8 beats; the last release sets the final duration. Authors can edit durations
and insert explicit rests afterward. Stopping flushes a pending final chord.
Recording ends on Stop recording, encoder exit, disconnect, hidden tab, page exit,
cancel, or unmount. Saving is disabled while recording.

## Built-in course button recommendations

`compactCourseKeys.ts` selects one physical button per pitch for each starter
layout, minimizing the overall span and then pairwise travel using a bounded
multi-start refinement. The beginner pitch set also seeds the intermediate
course, keeping the chosen buttons stable between lessons and courses. These
are layout-specific `fingerings` with `acceptDuplicates: true`, so recommendations
do not impose new grading restrictions or invalidate existing beginner progress.
The intermediate course uses the portable v2 format and normal assessment
fingerprints for progress. Its first eight lessons have recommendations; the
explicit duplicate-button lesson and following phrase omit them. Exports carry
the computed button assignments and layout definitions like any authored course.
