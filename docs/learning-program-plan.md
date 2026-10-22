# HexBoard Learning Roadmap

This roadmap describes product direction and proposed work. Current operation
belongs in the [web guide](web-app-guide.md#learning-your-first-scale), course
schemas and grading in the [course reference](course-format.md), and device
sessions in [delegated control](delegated-control.md). The [curriculum](curriculum.md)
owns included courses, planned content, and teaching acceptance criteria.

## Product direction

Teach through short explanations, demonstrations, musical practice, and useful
feedback. Start with standard 12-EDO. Musical understanding should carry across
layouts; physical fluency is tracked separately for each layout. Favor personal
improvement, recall, and independence from hints over rankings or punitive streaks.

Expand the existing Scale practice, Courses, and Progress sections only when
learner and hardware review establishes a useful next step. Course completion
alone does not establish ergonomic suitability or lasting mastery. Keep
microtonal teaching as a later branch of the shared foundation.

## Proposed milestones

| Work | Scope | Acceptance |
| --- | --- | --- |
| Foundation content | Complete the remaining initial pathway in the curriculum reference | Beginners play familiar phrases without continuous hints; routes and difficulty progression are reviewed on hardware |
| Practice expansion | Normal instrument practice, broader rhythm exercises, inversions, and review | Feedback remains useful across layouts and tempos |
| Song trainer | Curated pieces, MIDI import, part selection, passage looping, tempo adjustment, and transposition | Supported imports yield playable, correctly timed exercises |
| Tuning-specific teaching | Authored explanations and exercises for other tunings | Build on existing tuning-aware practice without fragmenting the beginner path |

These are proposed extensions, not supported product contracts. Authored song
segments and static microtonal practice already use the current course/practice
runtime; they do not imply MIDI-file import or a separate Songs section.

## Instrument practice proposal

Listen to normal outgoing MIDI while the HexBoard plays normally. Evaluate
musical output without inferring which duplicate physical key was pressed.
Confirm that lesson configuration matches the live instrument settings.
Additional physical-key telemetry needs a separate firmware design.

## MIDI song trainer proposal

Import a `.mid`, select a part and short passage, preview its range/difficulty,
then adjust tempo, transpose, and loop it. Normalize events into the course
exercise engine rather than creating a separate evaluator. If notes do not fit,
offer another register, transposition, or passage; never silently fold octaves.

Start with Standard MIDI File formats 0 and 1, tempo maps, melodies, and simple
chord parts. Handle or flag unsupported timing, percussion, sustain, pitch bends,
malformed files, and unplayable passages. Never forward imported SysEx as device
commands. Chord labels and fingerings are editable suggestions. Use the
[Standard MIDI Files specification](https://midi.org/standard-midi-files-specification).
