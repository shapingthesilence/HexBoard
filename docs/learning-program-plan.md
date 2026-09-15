# HexBoard Learning Program

## Status and scope

Milestone 1 is implemented as a prototype: one C-major scale lesson,
Wicki-Hayden, Harmonic Table, and Janko layouts, compatible tuning-bundle import, browser sound,
demonstration, on-screen and physical-key practice, LED hints, and repetition
without hints. Firmware adds an acknowledged, expiring delegated session.
Real hardware acceptance remains required before a validated device release.

Milestones 2–5 are proposals, not supported features. Current operation belongs
in the [web guide](web-app-guide.md#learning-your-first-scale); the implemented
wire contract belongs in [delegated control](delegated-control.md).

## Product direction

Build a Learn section with short explanations, demonstrations, practice games,
and useful feedback. Start with standard 12-EDO. Lessons describe musical
targets; the app translates those targets into the selected layout. Musical
understanding carries across layouts; physical fluency is tracked separately
for each layout.

The planned sections are Course, Practice, Songs, and Progress. The prototype
opens directly into its single lesson instead of exposing unfinished sections.
A typical lesson takes about five minutes:

1. Explain one musical idea when it becomes useful.
2. Demonstrate it with sound and highlighted keys.
3. Let the learner play at their own pace, waiting for correct answers.
4. Repeat with fewer hints.
5. Offer a timing challenge and specific feedback once the learner is ready.

## Curriculum

| Stage | Concepts | Practice |
| --- | --- | --- |
| Meet your HexBoard | Layout directions, duplicate pitches, octaves, controls | Find a note, find another occurrence, match a pitch |
| Intervals | Semitones, whole tones, thirds, fifths, octaves | Find an interval, hear and repeat, move a pattern |
| Scales | Major, minor pentatonic, natural minor, scale degrees | Ascending/descending scales, missing degrees, melodic patterns |
| Chords | Major/minor triads, inversions, arpeggios | Build a chord, change quality, find another voicing |
| Progressions | I–IV–V–I, I–V–vi–IV, later ii–V–I | Change on the beat, retain common tones, choose nearby voicings |
| Application | Rhythm, phrasing, accompaniment, improvisation | Echo phrases, short songs, play over a progression |

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

The prototype uses C4 through C5 at standard concert pitch. Compatible imported
bundles use 12-EDO with an octave period and the same C-based reference anchor
as the factory tuning. Imports last for the current Learn view. Device live
settings are not read or changed to select a lesson layout: raw key IDs are
interpreted using the layout selected in Learn. Command and chord keys are
unavailable for scale practice. Side function keys are omitted from the web
map. Playable notes retain their Rainbow-mode hue across octaves; lesson
feedback changes brightness and outlines. The OLED temporarily follows the
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

The prototype checks one clean note attack at a time, requires releases,
accepts every key producing the exact requested pitch, and counts extra attempts.
It does not grade timing, persist mastery, or infer learning from a single run.

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

- `web/src/learn/majorScale.ts`: musical targets, layout adapter, evaluation,
  and hint states.
- `web/src/catalogs/layoutKey.ts`: shared generated/manual pitch precedence
  for learning and editing; transforms remain in `hexBoardGeometry.ts`.
- `web/src/learn/delegatedSession.ts`: acknowledgement, heartbeats, input
  decoding, bounded LED batches, and cleanup.
- `web/src/views/Learn.tsx`: lesson flow and audio/screen lifecycle.
- `web/src/audio/synthPreview.ts`: shared browser audio engine.
- Firmware `midi/DelegatedControl.cpp`: protocol/runtime lease ownership;
  `DelegatedLease.h`: allocation-free clock/token state.

Extract a general target/evaluation model as additional exercise requirements
become concrete. Rhythm scoring needs receive timestamps preserved through
the MIDI transport. Content and progress storage should remain separate from
musical layouts and editor drafts.

## Session recovery

Device lessons request a versioned session and wait for a matching
acknowledgement. A heartbeat every second keeps the session alive. Five seconds
without a valid heartbeat makes firmware release delegated notes and restore
normal control. A per-session token prevents delayed heartbeats/exits from
controlling a newer session. Matching repeated entry is idempotent; another
owner or held keys produces a busy response.

The browser ends sessions on Stop, view change, hidden tab, page exit,
disconnect, failed writes, or missing acknowledgements. Browser cleanup is
best effort; firmware expiry covers crashes and frozen event loops. Encoder
hold remains available. Legacy entry stays unleased. Old firmware ignores the
new entry command, so the app fails to start instead of taking over without
recovery. No settings layout or flash writes are introduced.

## Milestones and acceptance

| Milestone | Scope | Acceptance |
| --- | --- | --- |
| 1: working prototype | One guided scale, browser audio, LEDs, safe session ownership | Complete the same lesson on all three default layouts; prove lost-host recovery on hardware |
| 2: beginner release | About 12–15 lessons, triads, one progression, local progress | Beginner completes a short musical exercise with hints removed |
| 3: practice expansion | Normal instrument mode, rhythm scoring, inversions, review | Feedback remains useful across layouts and tempos |
| 4: song trainer | Curated pieces, MIDI import, part selection, passage looping | Supported imports yield playable, correctly timed exercises |
| 5: other tunings | Tuning-specific intervals and scales | Targets use degrees/pitch relationships without assuming 12 notes |

## Verification

Automated coverage includes baseline layouts, transformed ranges, duplicate
pitches, overrides, unsupported actions, missing notes, clean attacks,
releases, hints, acknowledgement gating, foreign tokens, missing firmware
support, connection loss, manual exit status, LED batches, and clock wraparound.
Run web tests/build, factory generator, firmware `make`, and `git diff --check`.

Hardware acceptance must check both layouts with real key/LED identities,
browser audio latency, held-key releases, encoder force-exit, lost USB, abrupt
browser termination, frozen heartbeats, re-entry, old firmware, and normal
playing after recovery. Key/LED activity must not renew the lease. Automated
transports cannot establish USB, cross-core, or audio timing.
