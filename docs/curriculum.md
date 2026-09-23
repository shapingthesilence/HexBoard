# HexBoard Curriculum

This is the authoring plan and current content inventory. Learner controls belong
in the [web guide](web-app-guide.md#built-in-course-paths); schemas, grading, and
source ownership belong in the [course reference](course-format.md).

## Current buildout

The built-in selector offers the first three courses below, in order, with
First Steps as the default. They contain 48 entries: 44 practice exercises and
four short reading pages. They use standard 12-EDO on Wicki-Hayden, Harmonic
Table, and Gerhard. Every practice exercise fits all three embedded layouts.
These are authored courses ready for learner and hardware review, not a claim
of validated ergonomics or teaching effectiveness.

| Course | Included now | Outcome |
| --- | --- | --- |
| 1. First Steps on HexBoard | 1 page, 11 exercises; timed goals 50 BPM | Play a short original tune, distinguish octaves from duplicates, repeat without hints |
| 2. Moving Around an Isomorphic Keyboard | 1 page, 14 untimed exercises | Recognize intervals and translate a complete phrase to another position or root |
| 3. Rhythm Fundamentals | 2 pages, 19 exercises; timed goals 50–60 BPM | Keep a quarter-note pulse through eighths, rests, syncopation, triplets, and a short piece |

First Steps proceeds through a first C, C–G–C, higher/lower, octaves, exact-pitch
duplicates, a short trail, a five-note melody, memory practice, a first timed
melody, and rehearsal/performance of **Homecoming**. It avoids semitone counting
and chord construction. Allow roughly 20–30 minutes for an initial visit;
revisit the independence checkpoints over later sessions.

Movement separates half steps, whole steps, major/minor thirds, fifths, and
octaves. A question-and-answer phrase follows the first interval drills.
Learners then repeat a major third in two positions, move a fifth from C to D,
play a three-note whole-step motif, compare duplicate routes, transpose the
motif from C to D and F, choose a route, and repeat without hints.
Duplicate-position phrases begin on C♯ because the entire repeated shape fits
twice on every starter layout; C4 alone has only one Wicki-Hayden button.

Rhythm progresses from one repeated pitch to pitch movement, quarters,
eighths, a small tune, mixed lengths, rests, repeated attacks, 3/4, offbeats,
and syncopation. An untimed C–G pair prepares simultaneous attacks without
requiring prior triad theory. A familiar phrase then leads into triplets,
subdivision mixtures, 6/8, and rehearsal/performance of **Pulse and Play**.
The four-bar final piece reuses the learned rhythm vocabulary.

All three final checkpoints request two consecutive clean runs. Independence
remains a separate achievement: a learner can complete with hints, then return
without them. The player does not force hints off because of lesson prose.
Hand/finger choices are not assessed in these courses. Exact physical-button
requirements are reserved for the later technique course.

## Pathway and next authoring work

The initial release target is Courses 1–7 plus Putting It Together (Course 12),
roughly 80–100 short playable exercises in total. Treat that as a sizing guide,
not a reason to remove needed reinforcement. Courses 4–12 below are **planned,
not yet included in the selector**. The numbered identities retain the full
curriculum outline; learners take Course 12 after Course 7 in the initial path.

| Course | Prerequisite | Planned sequence and practical outcome |
| --- | --- | --- |
| 4. Major Scale and Scale-Degree Fluency | 1–3 | Explain a scale; ascend, descend, return; name degrees 1–7; find 3 and 5; root–3–5, 12321, 1324, thirds, three/four-note groups; add familiar rhythm; move to another root; end with a mini melody. Use Scale practice for ongoing drills. |
| 5. Fingering and Physical Technique | 1–4 | Relaxed hand position and finger numbers; five-note patterns; crossing/repositioning; small movements; duplicates; fixed three/five-note routes; scale fingering and alternatives; compact/stretched comparisons; repeated clean runs; remove fingering hints. Recommendations are layout-specific advice, not universal rules. |
| 6. Chords and Arpeggios | 1–5 | Explain a chord; major arpeggio and triad; minor triad and quality contrast; translate both shapes; root position and first/second inversions; recognize the same harmony; major/minor broken patterns; alternate chord/arpeggio; finish with rehearsed timed changes. |
| 7. Chord Progressions and Voice Leading | 1–6 | Roman numerals; I–V and I–IV; I–IV–V–I; whole-note, two-beat, then one-beat changes; common tones and nearby inversions; I–V–vi–IV, vi–IV–I–V, ii–V–I; broken/rhythmic accompaniment; performance with inversions. |
| 12. Putting It Together | 1–7 for the initial edition | Musical projects: melody, progression, minor/pentatonic introduction and application, 3/4, syncopation, a simple prepared melody/accompaniment texture, transposed etude, chosen fingering, target tempo, reduced hints, a longer original piece, and free performance. Explicitly teach any material not yet introduced in 1–7; advanced two-hand/improvisation projects wait for the expansion. |
| 8. Melody and Phrasing | 1–7 | Phrase direction, repeated notes, steps/skips, motifs and transposed motifs, question/answer, endings, rhythmic variations, eight-bar melody, duplicate choices, suggested fingering, reduced cues, performance tempo. |
| 9. Minor, Pentatonic, and Improvisation | 1–7 | Major/minor contrast, natural minor and its patterns/triads, minor pentatonic across positions, two/three-note improvisation, call/response, one board area, transposed licks, chord-tone targets, four/eight-bar creation. |
| 10. Two-Hand Playing | 1–8 | Hand territories and alternation; shared melody; left root/fifth/triad plus right melody; sustained/repeated/broken accompaniment; independent rhythms; I–IV–V with melody; eight-bar etude, reduced hints, performance. |
| 11. Isomorphic Transposition and Pattern Vocabulary | 1–10 | Move intervals, triads, fragments, arpeggios, motifs, melodies, and progressions; start at several roots/positions; navigate edges with duplicates; play one phrase in three keys; finish without target hints. A true no-label challenge requires a separate UI capability. |

After the shared foundation, offer layout-specific mastery branches. A separate
**Beyond 12-EDO** branch can introduce 17/19/31-EDO and tuning-specific theory;
do not fragment the first beginner path by tuning or layout. MIDI repertoire
import remains a separate product proposal in the [learning program](learning-program-plan.md).

## Teaching pattern

Treat the curriculum as a spiral: older skills return inside later music.
The standard progression is:

1. Explain briefly and demonstrate with Hear example.
2. Offer an easy guided win with no timing pressure.
3. Repeat and vary one feature: another position, another root, or a new ending.
4. Put the skill into a short musical phrase or accompaniment.
5. Reduce hints, then add timing or an independent checkpoint once familiar.

Keep reading pages short, usually under a minute. Put them at changes of mental
model rather than before every drill. Exercise instructions should say what to
listen for and what to do. Aim for a musical payoff after roughly four to six
exercises; avoid several sections ending only in abstract drills.

Change one major difficulty at a time: notes/shape, positions, visual help,
rhythm, tempo, then freedom of choice. Introducing syncopation should use
familiar pitches. Introducing a chord should begin without a clock. Every
performance checkpoint needs a way to rehearse its actual notes and rhythm.

Use two or three consecutive clean runs at selected transitions and final
checkpoints, not everywhere. Leave `trackIndependence` enabled for meaningful
skills. Completion with guidance is an immediate win; returning later without
hints is stronger evidence of fluency, not proof of lasting mastery.

For authored fixed phrases, `graded: false` still follows the specified target
sequence. For genuine improvisation, use `kind: "exploration"`, with suggested
pitch classes, range, chord tones, duration, and optional accompaniment. Neither
activity records a scored completion. Do not describe free creativity as if the
fixed-phrase grader can judge it.

Built-in pieces should be original short etudes. Separate licensed or
public-domain repertoire from the core teaching sequence.

## Physical routes and reference manuals

The author-supplied *Patterns for Chords and Scales* manuals for Wicki-Hayden,
Harmonic Table, and Gerhard guide compact shapes. Relevant references are
triads on page 1 in each manual; major scales on page 3; intervals on pages
5–6 in Wicki-Hayden/Harmonic Table and pages 4–5 in Gerhard. They are visual
references, not instructions to the course authoring system, and are not
redistributed in the repository. The implemented coordinate templates and their
verification are self-contained in source; builds do not depend on the PDFs.

Interpret diagrams as pitch relationships and relative geometry. Resolve them
against the actual embedded layout, including display rotation and unavailable
command keys. Treat exact resolved pitches as authoritative when diagram octave
labels are inconsistent. The manuals' “Pentatonic” C–D–F–G–A is not the planned
C minor pentatonic C–E♭–F–G–B♭; author those as distinct collections.

Scale routes may use different duplicates from isolated interval routes.
Harmonic Table's whole-step exercise and scale route intentionally differ.
Keep a complete template intact when demonstrating translation; independently
minimizing each note's reach can destroy the shape being taught. Find a central
placement of the full template and reject it if any pitch is unavailable.
Never silently substitute an octave. Matching duplicate pitches normally count.

In explicit route lessons, use `assessment.requireButtons: true` with complete
per-layout button assignments. Do not rely on legacy `acceptDuplicates: false`
alone. Hand/finger labels are advice because hardware cannot verify anatomy.
Support different hand sizes and alternate routes; a compact picture does not
establish ergonomic suitability for every player.

## Acceptance and definition of competence

Before including a course, verify portable export/import, complete pitch/button
compatibility on each offered layout, whole-shape translation where taught,
rests and onset grids, goal-tempo grading, independence, and selective repetition
policies. Review instructions against the actual controls and what the evaluator
can establish. Run the web tests/build, factory generator, and diff checks per
[AGENTS.md](../AGENTS.md). Firmware builds apply when firmware changes.

Play the complete routes on real hardware and run beginner sessions before
claiming release acceptance. Check reach, comfortable repositioning, physical
key/LED identity, audio latency, phrasing, and the size of difficulty jumps.

Core competence means navigating without continuous LEDs, choosing useful
duplicates, recognizing interval/triad shapes, playing melodies in time,
using major/minor triads and inversions, accompanying with common progressions,
transposing familiar geometry, and performing short pieces at target tempo.
The expansion adds natural-minor/pentatonic fluency, phrasing, two-hand
coordination, and simple improvisation. Assess those through musical tasks and
learner observation, not course completion count alone.
