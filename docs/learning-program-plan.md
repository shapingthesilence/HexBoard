# HexBoard Learning Program

## Status and scope

Milestone 1 is implemented as a prototype: scale practice defaulting to C major,
Wicki-Hayden, Harmonic Table, and Gerhard layouts, compatible tuning-bundle import, browser sound,
demonstration, on-screen and physical-key practice, LED hints, and repetition
without hints, adjustable background contrast, repeated scale patterns, run timing,
graded beat practice, selectable color modes, and lazy device library loading.
EDO, equal-step, and cents-table tunings can use the same practice engine.
Firmware uses acknowledged sessions with manual
encoder recovery and no heartbeat.
Real hardware acceptance remains required before a validated device release.

The current curriculum buildout includes First Steps, Isomorphic Movement, and
Rhythm Fundamentals: 44 practice exercises and four short reading pages across
three layouts. The [curriculum plan](curriculum.md) owns the current inventory,
full twelve-course pathway, authoring rules, manual-derived route guidance, and
learner acceptance criteria. The remaining nine courses are planned.

User-authored courses are also implemented with a canonical timed piano roll,
independent playback holds, goal/practice tempo, recoverable IndexedDB drafts,
explicit tuning/layout embedding, direct note editing, time signatures, preview
playback, board/hand assignment panels, per-lesson assessment fingerprints, and a
Learn-scoped device session: self-contained course files,
optional required layouts, hand/finger cues, preferred physical keys, timed
melodies/chords/rests, and direct HexBoard phrase recording. Short song segments
can be recorded or entered as phrases. Authoring also includes triplet grids, group movement and copy/paste, Markdown pages and introductions, a draggable section outline, learner preview, layout transposition, compatibility reports, and compact completion policies. See the [course contract](course-format.md).

Milestones 3–5 remain proposals beyond these pieces; scale rhythm practice,
static microtonal practice, and authored song segments have been brought forward. Current operation belongs
in the [web guide](web-app-guide.md#learning-your-first-scale); the implemented
wire contract belongs in [delegated control](delegated-control.md).

## Product direction

Build a Learn section with short explanations, demonstrations, practice games,
and useful feedback. Start with standard 12-EDO. Lessons describe musical
targets; the app translates those targets into the selected layout. Musical
understanding carries across layouts; physical fluency is tracked separately
for each layout.

The implemented sections are Scale practice, Courses, and Progress.
Songs remains a later milestone.
A typical lesson takes about five minutes:

1. Explain one musical idea when it becomes useful.
2. Demonstrate it with sound and highlighted keys.
3. Let the learner play at their own pace, waiting for correct answers.
4. Repeat with fewer hints.
5. Offer a timing challenge and specific feedback once the learner is ready.

## Curriculum

Build the core path in this order: First Steps → Isomorphic Movement → Rhythm →
Major Scale Fluency → Fingering/Technique → Chords/Arpeggios → Progressions/Voice
Leading → Putting It Together. Follow with Melody/Phrasing, Minor/Improvisation,
Two-Hand Playing, and Isomorphic Transposition. Keep microtonality as a later
branch. See the [curriculum plan](curriculum.md) for sequences and current scope.

## Layout independence

Each exercise specifies musical answers and matching rules. Finding C can
accept any octave; an ascending scale requires pitches in order; an inversion
lesson can require a specific bass; a fingering lesson can require a physical
route. Suggested fingerings accept equivalent pitches unless the task teaches
a particular route. Initial suggestions should use simple proximity/reach
rules and should not claim to be optimal fingerings.

The resolver accounts for generated intervals, rotation, mirroring, explicit
pitch and direct-MIDI overrides, disabled keys, and duplicate pitches. Device
rotation changes display orientation, not physical key identities. Check the
entire passage's range before beginning. Offer another register, transposition,
or passage in later milestones; never silently fold missing notes into another
octave. One-button chords can count in accompaniment tasks but cannot satisfy
tasks about constructing chords or individually playing scale tones.

The default is C4 through C5 in 12-EDO. Selected scales use their tuning degrees,
reference frequency, root, and period; periods need not be octaves. Imported
bundles and device definitions use the same resolver. Imports last for the
current Learn view. Device live
settings are not read or changed to select a lesson layout: raw key IDs are
interpreted using the layout selected in Learn. Command and chord keys are
unavailable for scale practice. Side function keys are omitted from the web
map. Color modes use the selected tuning and palette; lesson feedback changes
brightness and outlines. The OLED temporarily follows the
selected layout orientation and restores its saved orientation on exit.

## Playing modes

**Guided learning:** raw hardware key IDs, host-controlled LEDs, browser audio.
The app identifies physical keys even when pitches repeat. Normal instrument
controls are suspended while the host owns the surface. This is the prototype's
device mode.

**Instrument practice (proposed):** listen to normal outgoing MIDI while the
HexBoard plays normally. Evaluate musical output; do not infer which duplicate
key was pressed. Confirm that practice configuration and live instrument
settings match. Additional key telemetry would require a separate firmware design.

## Games and feedback

Reusable games: note hunt, scale trail, chord builder, progression loop, and
listen-and-repeat. Introduce rhythm after successful untimed practice. Track
pitch accuracy, timing, and independence from hints separately. Favor personal
improvement and review over speed-based rankings or punitive streaks. Feedback
should name the next useful action, such as practicing the transition into F.
Local progress with export/import precedes any account system.

The prototype checks new note attacks in order, allows overlapping notes,
accepts every key producing the exact requested pitch, and counts extra attempts.
It now supports ascending, descending, round-trip, and thirds patterns, repeated
run timing, and fixed-tempo beat grades. Beat cues advance immediately on a
correct press while grading retains fixed beat windows. Course chord targets
require simultaneous pitch sets, allowing shared tones between chords. Local
progress records completion per layout and independent runs (zero mistakes,
no hints or demonstration). It does not infer lasting mastery from one run.

## MIDI song trainer (proposed)

Import a `.mid`, select a part, preview range/difficulty, select a short
passage, adjust tempo or transpose, and loop it. Normalize musical events into
the same exercise engine as authored lessons. Start with Standard MIDI File
formats 0 and 1, tempo maps, melodies, and simple chord parts. Handle or flag
unsupported timing, percussion, sustain, pitch bends, malformed files, and
unplayable passages. Never forward imported SysEx as device commands. Chord
labels and fingerings are editable suggestions. Follow the
[Standard MIDI Files specification](https://midi.org/standard-midi-files-specification).

## Technical ownership

- `web/src/learn/courseFiles.ts`, `CourseEditor.tsx`, `phraseRecorder.ts`: portable course authoring and recording; see the course contract.
- `web/src/learn/curriculumCourses.ts`, `curriculumKeys.ts`: built-in teaching sequence and manual-derived physical routes.
- `web/src/learn/beginnerCourse.ts`: chord evaluation and local progress schema.
- `web/src/learn/deviceLibrary.ts`: lazy names/definitions and connection cache.
- `web/src/catalogs/deviceGeometry.ts`: shared device object decoder.
- `web/src/learn/tuningPractice.ts`: reference-relative pitches, scale degrees, and labels.
- `web/src/learn/majorScale.ts`: layout adapter, evaluation,
  and hint states.
- `web/src/catalogs/layoutKey.ts`: shared generated/manual pitch precedence
  for learning and editing; transforms remain in `hexBoardGeometry.ts`.
- `web/src/learn/delegatedSession.ts`: acknowledgement, scoped exit, input
  decoding, bounded LED batches, and cleanup.
- `web/src/views/Learn.tsx`: lesson flow and audio/screen lifecycle.
- `web/src/audio/synthPreview.ts`: shared browser audio engine.
- `web/src/learn/scalePractice.ts`: patterns and fixed-grid beat evaluation.
- `web/src/learn/practiceMetronome.ts`: scheduled clicks and audio clock mapping.
- Firmware `midi/DelegatedControl.cpp`: protocol/runtime session ownership.

Extract a general target/evaluation model as additional exercise requirements
become concrete. Rhythm scoring uses receive timestamps preserved through
the MIDI transport. Content and progress storage should remain separate from
musical layouts and editor drafts.

## Session recovery

Device lessons request a version-2 session and wait for a matching
acknowledgement. A per-session token prevents delayed exits from controlling a
newer session. Matching repeated entry is idempotent; another owner or held
keys produces a busy response. Core 0 owns MIDI input and all session
transitions in both modes.

The browser ends sessions on Stop, leaving Learn, hidden tab, page exit,
disconnect, or failed writes. Startup requires an ACK within 2.5 seconds.
There is no heartbeat or firmware expiry. If browser cleanup is not delivered,
hold the encoder for five seconds to restore instrument control, then restart
the lesson. Legacy entry remains supported. The retired version-1 heartbeat
protocol is rejected, so update the web app and firmware together. No settings
layout or flash writes are introduced.

## Milestones and acceptance

| Milestone | Scope | Acceptance |
| --- | --- | --- |
| 1: working prototype | One guided scale, repeated patterns, beat grading, browser audio, LEDs, session ownership | Complete the same lesson on all three default layouts; prove encoder exit and re-entry on hardware |
| 2: foundation content | First three courses implemented; remaining core courses planned in the curriculum reference | Beginner completes original mini pieces without hints; physical routes reviewed on hardware |
| 3: practice expansion | Normal instrument mode, broader rhythm exercises, inversions, review | Feedback remains useful across layouts and tempos |
| 4: song trainer | Curated pieces, MIDI import, part selection, passage looping | Supported imports yield playable, correctly timed exercises |
| 5: tuning-specific teaching | Authored explanations and exercises for other tunings | Build on the implemented tuning-aware scale practice |

## Verification

Automated coverage includes baseline layouts, transformed ranges, duplicate
pitches, overrides, unsupported actions, missing notes, overlapping attacks,
releases, hints, acknowledgement gating, foreign tokens, missing firmware
support, manual exit/re-entry status, LED batches, pattern timing, beat windows,
missed notes, immediate beat cues, extra attempts, metronome scheduling/cleanup,
every course lesson on each starter layout, simultaneous chords, common tones,
and progress validation.
Run web tests/build, factory generator, and `git diff --check`; run firmware `make` when firmware changes.

Hardware acceptance must check all three layouts with real key/LED identities,
browser audio latency, held-key releases, encoder force-exit, lost USB, abrupt
browser termination followed by encoder hold, re-entry, version mismatch,
contrast adjustment, audible beat timing, and normal playing after exit. Automated
transports cannot establish USB, cross-core, or audio timing.
