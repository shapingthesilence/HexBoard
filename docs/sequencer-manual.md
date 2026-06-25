# HexBoard Sequencer Manual

The HexBoard sequencer is optional in the current firmware port. Default builds
compile it out. Builds made with `HEXBOARD_ENABLE_SEQUENCER=1` show a
`Sequencer` entry in the OLED menu.

This page is the dedicated home for sequencer behavior. The fuller existing
sequencer manual will be ported here later.

## Entering And Exiting

Open `Sequencer` from the main menu to enter Sequencer mode. Return to
`Keyboard` to exit Sequencer mode.

Exiting Sequencer mode stops sequencer playback and releases sequencer-held MIDI
notes.

## Current Behavior

The current sequencer is a simple 32-step MIDI sequencer. Select a step pad,
then press playable note keys to toggle tuning-relative notes into that step.
Each step can hold up to `6` notes.

Button `9` starts and stops playback. Playback uses the internal clock only,
runs through the active step range, and defaults to `120 BPM` with each step
lasting one 16th note. Open `Playback Settings` from the Sequencer page to edit
four volatile controls:

- `Steps`: active loop length, `1` through `32`, default `32`.
- `Direction`: `Forward`, `Backward`, `Ping-Pong`, `Random`, `Brownian`, or
  `Drunk`, default `Forward`.
- `Tempo`: internal tempo, `1` through `255` BPM, default `120`.
- `Tap Preview`: `Off` or `On`, default `On`.

Open `Seq Lights` from the Sequencer page to edit three profile-backed light
preferences:

- `Accent Every`: `Off` or `2` through `8`, default `4`. Accents start at step
  `1`, so `4` accents steps `1`, `5`, `9`, and so on.
- `Step Color`: `Note` or `Regular`, default `Regular`.
- `Step Hue`: `Red`, `Orange`, `Yellow`, `Lime`, `Green`, `Teal`, `Cyan`,
  `Lt Blue`, `Blue`, `Indigo`, `Purple`, `Magenta`, or `Pink`, default
  `Indigo`. This item is shown only when `Step Color` is `Regular`.

Programmed steps send MIDI using the current tuning, transpose, MIDI routing,
and MPE settings. Empty steps advance silently.

Lower-grid playable note keys audition MIDI while Sequencer mode is active.
With no step selected, a note press auditions only. With a step selected, the
same note press auditions and toggles that tuning-relative pitch in the selected
step. Audition is MIDI-only for now; onboard synth and OB Synth preview are not
part of this slice. Releasing the key releases the sequencer-managed audition
note, and panic, playback changes, or leaving Sequencer mode clears any held
sequencer notes.

When `Tap Preview` is `On`, selecting a programmed step previews its stored note
or chord through MIDI. When it is `Off`, step selection still updates the Edit
overlay without playing preview notes. Probability does not affect preview yet.

Selecting a step shows a compact Edit overlay:

- `Edit #NN`
- `L <length>% V <velocity> P <probability>%`
- the selected step's notes, or `--` when empty

Programmed steps show all stored notes, sorted low-to-high, up to the current
six-note step limit. The note area stays on one line when labels fit and wraps
to a second line when needed. `12 EDO` labels use familiar names such as `C3`;
other tunings use numeric `step.octave` labels.

Button `19` clears the selected step after the current confirm-hold gesture.

Sequencer LEDs show selected steps, programmed steps, accents, the clear
button, transport state, and the current play position. Button `9` is red when
stopped and green while playing. Step LEDs beyond the active `Steps` range stay
off even if those steps contain notes. Empty unselected non-accented steps stay
off, while empty accented steps are visible at medium neutral brightness.
Selected or playing empty steps stay visibly highlighted.

Programmed steps use a brightness ladder: normal programmed steps are medium,
selected or accented programmed steps are high, and the current playing
programmed step is highest. Accents change brightness only; they do not change
hue. In `Step Color = Regular`, programmed steps use the selected `Step Hue`.
In `Step Color = Note`, programmed steps use the stored step's lowest note and
the current keyboard color palette, including color mode and ColorByKey.

Patterns and Playback Settings are not persistent yet. Rebooting clears
programmed sequencer steps and restores `Steps`, `Direction`, `Tempo`, and
`Tap Preview` to their defaults. `Seq Lights` preferences are saved in the
current board profile and are not stored in sequence files.

## Not Yet Ported

The current sequencer slice does not include persistence, save/load/browser
flows, external MIDI clock, MIDI start/stop/clock send, onboard synth playback,
onboard synth or OB Synth audition/preview, Play Type settings, probability
playback behavior, ties, backup tools, exact edit screens, or sequence-file
persistence.
