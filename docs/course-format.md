# User Course Files

User operation belongs in the [web guide](web-app-guide.md#creating-and-sharing-courses).
This reference describes the implemented browser format and evaluation rules.

## Portable format

A `.hexcourse.json` file has `format: "hexboard.course.v4"`, `id`, positive
integer `revision`, `title`, optional-empty `author`, `bundle`, optional
`layoutId`, optional Markdown `description` (up to 50,000 characters), and `lessons`. The embedded `bundle` uses the existing normalized
[TuningBundle](../web/src/catalogs/layoutsCatalog.ts) shape: tuning definition,
reference frequency, palette, layouts (including explicit button overrides),
scales, and active layout/scale IDs. It is a snapshot, independent of the
recipient's device library. Courses do not perform device storage writes.

Legacy course-level `layoutId` requires an included layout and remains readable. New course editing uses the included layout set directly. Without a lesson-level requirement, the player offers included
layouts only. The author explicitly selects tuning, layouts, and relevant scales
from the browser library or the connected HexBoard library. Loading a layout
elsewhere in Learn never adds it to a course. Device reads remain lazy: names
first, then only the selected definitions.
Fingering rules apply only to the layout ID for which they were authored.

Practice lessons (`kind` omitted or `"practice"`) contain:

| Field | Meaning |
| --- | --- |
| `id`, `title`, `section`, `instruction` | Identity and plain-text teaching content |
| `targets` | Ordered pitch arrays: one pitch for a melody, several for a chord, empty for a timed rest |
| `timing` (optional) | Integer `goalBpm` (20–300), `beats` onset spacing per step, optional per-note `holdBeats` |
| `timeSignature` (optional) | `{numerator, denominator}`; numerator 1–16, denominator 2, 4, 8, or 16; defaults to 4/4 |
| `layoutId` (optional) | Requires an included layout for this practice lesson; participates in its assessment fingerprint |
| `repetitions` (optional) | 1–100 consecutive passing, mistake-free runs; omitted means one passing run |
| `assessment` (optional) | `requireButtons` (default false), `graded` (default true), `passingScore` (0–100, default 75), `trackIndependence` (default true) |
| `fingerings` (optional) | Per-layout `{layoutId, steps}` entries, with one cue array per target |

Content pages use `kind: "content"`, identity/title/section, and `markdown` (up to 50,000 characters). They normalize to empty targets and have no grading or completion requirement. Course descriptions and pages render headings, paragraphs, lists, blockquotes, fenced code, emphasis, inline code, and safe web/mail links. Raw HTML is escaped.

Pitches are MIDI-equivalent numbers in 0–127, including fractional values for
microtonal pitches. Targets specify exact demonstration pitches; optional answer rules can accept octave-independent classes.
All timing values use quarter-note units, regardless of time signature. Step
spacing is 1/12–8 quarter notes on a 1/12-quarter-note grid (supporting straight and triplet subdivisions). Meter controls
bar grouping in the roll and does not change grading, tempo units, or count-in. Untimed lessons cannot
contain rests. `holdBeats`, when present, has one array per step and one
1/12–32 beat value per pitch (an empty array for a rest). Omitted holds default
to the step spacing. Holds may overlap later onsets. They affect demonstration playback and, when
`timing.gradeDuration` is true, release grading. Each cue has a target `note`, optional physical `button` index,
optional `hand` (`left`/`right`), optional `finger` (1–5), and optional
`acceptDuplicates` (defaults true). A button index must exist in its embedded layout. Pitch mismatches are compatibility warnings; the editor only offers matching playable keys for new assignments.

Import limits: 2 MB per file, 100 lessons per course, 256 targets per lesson,
10 distinct notes per chord, and 50 courses in the browser library. Compatibility reporting lists missing pitches and stale button assignments for every lesson/layout pair without blocking saving. The player checks the chosen layout before starting.
Invalid files report an error; invalid stored course entries are skipped without
removing valid entries. Importing an existing course ID presents Update existing, Keep both, and Cancel.
Update retains the course and lesson IDs; Keep both generates a new course ID.
The dialog shows incoming and local revisions. Importing never removes a
recovery draft. v2, v3, and v4 imports are supported; exports use v4. Older apps reject v4 rather than silently ignoring its grading rules.

## Timing and key evaluation

Free lessons and the bottom **Step** position of a timed lesson's practice-tempo
slider wait for correct notes without metronome clicks. Step mode skips silent
rests and reveals subsequent steps only after the current target is satisfied;
it does not count as timed completion. The example plays at the goal BPM in
this mode. Text phrase inputs also accept exact numeric pitches such as `@60.5`. Single-note targets allow overlap. Chords
require their target pitches held together with unrelated pitches released;
common tones may remain held between chords. When `assessment.requireButtons`
is true, recommended physical keys are required for pitches that have assignments. Hand/finger labels are instructional
only: the hardware cannot identify which hand or finger pressed a key.

Timed lessons share the metronome's audio/performance clock mapping. Four clicks
count in; each target starts at the cumulative sum of prior beat durations.
Onset windows extend at most half a beat on either side, narrowed at neighboring
subdivision boundaries. A hit advances the visual cue immediately without
moving later scheduled targets. Silence advances missed targets. Attacks during
rests or between valid onset windows count as extra attempts; previously held
notes can ring through a rest in the default onset-only mode.

Timed chords require simultaneous target membership and at least one fresh
attack within their window. Timing uses the largest absolute error among their
new attacks and any final release needed to remove an unrelated note. Quiet
rests receive credit when their interval ends. The grade rewards timing and
penalizes misses/extras. A timed course run records completion only when every
step is satisfied, the score reaches `assessment.passingScore` (75 by default), and learner-selected `practiceBpm`
is at least the authored `goalBpm`. Practice accepts 20–300 BPM and slower runs
receive normal scoring without completion. Practice tempo is player state, not
course content. Independent completion also
requires zero extra attempts and no hints/demonstration during the run.

Ungraded practice (`graded: false`) still follows its target sequence, shows no run grade, and writes no completion progress. `assessment.requireButtons` is a lesson-wide policy authored in Lesson Settings. An explicit false overrides old per-cue strictness. Files with strict `acceptDuplicates: false` cues and no lesson policy import with `requireButtons: true`, applying the requirement to all assigned keys in that lesson. Hand/finger advice remains optional. `trackIndependence: false` records ordinary completion only. When `repetitions` is present, passing runs must also have no mistakes, misses, or extras. Streaks reset on a failed run, stopping/restarting, changing lesson/layout, or changing hints. They last only for the active practice session.

## Alternative answers and release grading

`answers`, when present, contains one rule per target step; `null` keeps exact
pitch matching. Rests must use `null`. A rule replaces the accepted pitches;
`targets` remain the demonstration and piano-roll content. Two rule forms exist:

- `{ "voicings": [[60,64,67], [64,67,72]] }` accepts either complete listed
  voicing. List 1–64 voicings with the same voice count as the target; pitches
  from different voicings cannot be combined into an unlisted answer.
- `{ "pitchClasses": [0,4,7], "min": 48, "max": 84, "period": 12 }` accepts
  one distinct pitch per class, anywhere in the inclusive range, including
  inversions. `[0]` accepts any C in that range. Classes are distinct values
  from zero up to (excluding) the period, default 12 semitones; custom periods
  support fractional pitches. Every class must occur in the range.

Both graders use these rules. Chords reject unrelated pitches and extra octave
doublings; physical duplicates of the same pitch do not add voices. Single-note
answers continue to allow legato. Compatibility requires one complete playable
answer on a layout. Hints display available answer pitches. Assigned button
requirements apply to their exact pitches; alternative pitches without assignments
remain unrestricted. Reordering steps carries answer rules. Roll edits preserve
rules when the entire pitch group survives together; changing or splitting a
pitch group clears its rule. Phrase replacement and recording clear old rules.

`timing.gradeDuration` defaults false. When true, each accepted voice must have a
fresh onset and a release at its scheduled onset plus `holdBeats` (or step spacing
if omitted). For alternatives, hold index follows the listed voicing order or
pitch-class order, not sorted sounding pitches. `releaseWindowBeats` defaults
0.25 and accepts 0.05–1 quarter notes on either side. Each early, late, or missing
release counts once, lowers the score, and prevents completion. The run continues
through the final written hold and release window, including trailing rests.
Shared chord tones must be rearticulated in this mode; use a single long note for
a sustained voice. Step practice does not grade releases. On-screen duration
practice uses click-to-hold/click-to-release, as chord practice does.

## Exploration activities

`kind: "exploration"` has identity/title/section/instruction, optional `layoutId`,
and an `exploration` object. Import normalizes targets to `[]` and grading to
false. It has no fixed sequence, score, or completion achievement:

```json
{
  "durationSeconds": 60,
  "min": 48, "max": 84,
  "pitchClasses": [0,2,4,5,7,9,11],
  "highlighted": [60,64,67],
  "accompaniment": {"bpm": 80, "chords": [[48,55], [53,60]], "beats": [4,4]}
}
```

Duration is 1–3600 seconds. Range uses MIDI-equivalent pitches. Optional classes
use the same default 12-semitone period as answer rules; omit them to allow all
pitches in range. Optional highlighted pitches must belong to the allowed set.
The board distinguishes chord tones from the other suggested scale notes. Notes
outside the set remain audible with gentle feedback and no penalty.

Accompaniment supports 1–64 chords, including empty rest chords, with matching
0.125–32 beat lengths and 20–300 BPM. A one-chord loop sustains a drone. Playback
uses a separate synth voice source so student releases cannot cut off the drone.
An absolute clock selects the current chord, skipping elapsed changes after a
late frame. Ending, stopping, changing lessons, hiding the tab, or disconnecting
stops accompaniment. Exploration finishes after its duration even without input.

## Identity, progress, and storage

Course and lesson IDs remain stable during editing. Course `revision` increases
when a saved course is edited, but it does not define assessment compatibility.
Progress uses course ID, lesson ID, and a deterministic assessment fingerprint
of target pitch sets, alternative answer rules, onset spacing, goal tempo, assessed holds and release tolerance, strict physical-key rules, and
required-layout constraint, assessment settings, and repetition requirement. Titles, explanations, lesson order, hand/finger
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
draft. Opening a saved course for editing reads drafts again and prompts when
one shares its ID; the course menu lists only drafts without a saved course.
Failed writes remain visible. Drafts are not a cross-device backup.
Small learner preferences and progress remain in localStorage; progress has a
separate export/import workflow. Course deletion retains recovery drafts.

## Authoring and performance views

`courseTimeline.ts` projects canonical `targets` and `timing` into note events
for the piano roll. Dragging moves pitch/onset; the right edge changes hold.
Edits immediately rebuild the canonical steps, grouping simultaneous notes,
retaining rests and per-note cues, and splitting long empty gaps. No second
piano-roll data model is persisted. Double-click or Command/Ctrl-click adds a
note; Backspace/Delete removes the selected voice without shifting later music.
Drag empty space to select a group, then drag a selected note to move the group. Single-note onset snapping is absolute. Copy/paste uses an app-local clipboard, retaining each layout’s separate button/hand/finger cues; paste follows the cursor until clicked, and Escape cancels. Transposed paste selects one board-coordinate displacement per layout, maximizing retained valid buttons and then minimizing travel. Unmappable buttons are cleared while finger/hand advice remains. Pitch edits clear stale preferred buttons on moved notes.
The roll extends automatically and snaps to quarter, eighth, or sixteenth notes, including triplets. Independent X and Y controls adjust beat width and pitch-row height without changing saved note timing or pitch.
The default snap is an eighth note. Free-timing editing uses the same roll,
with fixed quarter-note columns and holds, compacting empty gaps when notes
are edited; it does not introduce timing data into untimed lessons.
Fractional pitches remain exact. Selection identifies a step and voice, shared
by the roll, preferred-key board, and clickable hand panels. Library selection
uses a modal overlay. New lessons and added steps start empty; drafts may be
incomplete, but saved practice lessons require valid, nonempty musical content. Content pages can be text-only.
`lessonPreview.ts` derives preview gates from the same canonical data, ending an
earlier overlapping gate before retriggering its pitch. Preview audio and timers
stop on explicit stop, tab hiding, page exit, or editor unmount.
Lesson duplication creates a new lesson ID; reordering preserves IDs and cues. The always-visible outline groups lessons by section name and supports dragging lessons between sections or moving a section with all its lessons. The Section combo accepts existing or new names. Learner preview runs the draft through Learn without persisting progress. Layout transposition shifts the embedded mapping by whole tuning steps, leaving lesson pitches and cues unchanged for compatibility review. Course `layoutTranspositions` stores an optional map of included layout IDs to integer offsets (−127 through 127), so the control remains absolute across reopening and export/import. Existing files without offsets use their embedded mapping as zero. Compatibility reporting excludes layouts a lesson does not allow.

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
advancing evaluation or changing progress. Changing lessons resets hints. Switching an allowed layout restarts the run, resets its streak, updates display rotation, and retains the physical-key release barrier. A lesson layout requirement overrides a legacy course-level requirement. Course introductions render before practice and do not count toward completion.
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
  selectable straight/triplet quarter/eighth/sixteenth quantization (default eighth), per-note holds, and physical-key preferences.
- `web/src/learn/beginnerCourse.ts`: bundled lessons and free chord evaluation.
- `web/src/learn/scalePractice.ts`: scheduled pitch/chord/rest evaluation.

Recording captures raw key IDs through the same acknowledged version-2 session
as practice. The browser interprets them through the author's chosen embedded
layout, plays sound, and paints held-key LEDs. Melody mode captures every fresh
attack without a release barrier. Chord mode groups attacks until all keys are
released. Timed capture quantizes onset spacing to the selected division, clamped to
the selected minimum through 8 beats; the last release sets the final duration. Authors can edit durations
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
The intermediate course uses the portable v3 format and normal assessment
fingerprints for progress. Its first eight lessons have recommendations; the
explicit duplicate-button lesson and following phrase omit them. Exports carry
the computed button assignments and layout definitions like any authored course.

Tuning replacement checks existing pitches against the new tuning’s pitch lattice, independent of layout range. Incompatible replacements remain staged until the author confirms clearing twice. Revert leaves the course untouched; confirmation clears practice targets/timing holds/fingerings while retaining content pages and teaching text.

`noteAudition.ts` owns short, monophonic piano-roll previews. It reuses one synth while editing, cancels superseded startup requests, and closes with editor playback/lifecycle cleanup. Playback and recording Stop controls sit outside disabled editing fieldsets.
