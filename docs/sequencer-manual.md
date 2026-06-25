# HexBoard Sequencer Manual

The HexBoard sequencer is optional in the current firmware port. Default builds
compile it out. Builds made with `HEXBOARD_ENABLE_SEQUENCER=1` show a
`Sequencer` entry in the OLED menu.

This page is the dedicated home for sequencer behavior. The fuller existing
sequencer manual will be ported here later.

## Entering And Exiting

Open `Sequencer` from the main menu to enter Sequencer mode. Return to
`Keyboard` to exit Sequencer mode.

Exiting Sequencer mode stops sequencer playback and releases sequencer-held
notes.

## Current Behavior

The current sequencer is a simple 32-step sequencer with MIDI or onboard synth
output. Select a step pad, then press playable note keys to enter
tuning-relative notes into that step. Each step can hold up to `6` notes.

Button `9` starts and stops playback. Playback uses the internal clock only,
runs through the active step range, and defaults to `120 BPM` with each step
lasting one 16th note. Open `Playback Settings` from the Sequencer page to edit
these playback controls:

- `Steps`: active loop length, `1` through `32`, default `32`.
- `Direction`: `Forward`, `Backward`, `Ping-Pong`, `Random`, `Brownian`, or
  `Drunk`, default `Forward`.
- `Tempo`: internal tempo, `1` through `255` BPM, default `120`.
- `Play Type`: `MIDI` or `OB Synth`, default `MIDI`.
- `Tap Preview`: `Off` or `On`, default `On`.
- `Monophonic`: `Off` or `On`, default `Off`.

`Steps`, `Direction`, `Tempo`, and `Play Type` are sequence-owned values and
are saved in sequence files. `Tap Preview` and `Monophonic` are saved in the
current board profile, not in sequence files.

Open `Seq Lights` from the Sequencer page to edit three profile-backed light
preferences:

- `Accent Every`: `Off` or `2` through `8`, default `4`. Accents start at step
  `1`, so `4` accents steps `1`, `5`, `9`, and so on.
- `Step Color`: `Note` or `Regular`, default `Regular`.
- `Step Hue`: `Red`, `Orange`, `Yellow`, `Lime`, `Green`, `Teal`, `Cyan`,
  `Lt Blue`, `Blue`, `Indigo`, `Purple`, `Magenta`, or `Pink`, default
  `Indigo`. This item is shown only when `Step Color` is `Regular`.

When `Play Type` is `MIDI`, programmed steps send MIDI using the current
tuning, transpose, MIDI routing, and MPE settings. When `Play Type` is
`OB Synth`, programmed steps use the onboard synth engine with the shared synth
settings from Synth Options. Empty steps, zero-length steps,
probability-skipped steps, and tied steps without an active source advance
silently in both modes.

Lower-grid playable note keys audition through the current `Play Type` while
Sequencer mode is active. With no step selected, a note press auditions only.
With a step selected and `Monophonic` Off, the same note press auditions and
toggles that tuning-relative pitch in the selected step. With `Monophonic` On,
pressing a pitch already in the selected step removes it; pressing a different
pitch replaces the selected step's notes with only that pitch. Turning
`Monophonic` On does not rewrite existing chord steps. Releasing the key
releases the sequencer-managed audition note, and panic, playback changes, or
leaving Sequencer mode clears any held sequencer notes.

When `Tap Preview` is `On`, selecting a programmed step previews its stored note
or chord through the current `Play Type`. When it is `Off`, step selection still
updates the Edit overlay without playing preview notes. Probability affects
transport playback only; tap preview ignores probability. Tied steps stay
silent during tap preview because transport treats them as continuations rather
than new note starts.

Selecting a step shows a compact Edit overlay:

- `Edit #NN`
- `L <length>% V <velocity> P <probability>%`
- the selected step's notes, or `--` when empty

Programmed steps show all stored notes, sorted low-to-high, up to the current
six-note step limit. Tied steps show `T` instead of their stored notes. The note
area stays on one line when labels fit and wraps to a second line when needed.
`12 EDO` labels use familiar names such as `C3`; other tunings use numeric
`step.octave` labels.

Turning the encoder while a step is selected changes that step's length through
the quick choices `0`, `25`, `50`, `75`, `100`, `150`, `200`, `250`, `300`,
`350`, `400`, `500`, `600`, `700`, `800`, `900`, and `1000` percent. Pressing
the encoder while a step is selected deselects the step and returns to the
normal Sequencer menu view.

Button `19` is the blue action key. A short press restores the selected step to
the state it had when selected, including notes, length, velocity, probability,
and Tie. Holding it for about one second clears the selected step's notes and
Tie while leaving length, velocity, and probability unchanged. After a clear,
the blue action key can restore the cleared state.

Button `29` opens the Step Tools picker for the selected step. If no step is
selected, it shows `Select step` / `Then open tools` instead. The picker offers:

- `Len`: exact length entry with separate current and new values, digit keys,
  backspace, cancel, clamp-to-`1000`, and encoder-save.
- `Vel`: encoder editing through `0`, `5`, `10`, ..., `125`, `127`.
- `Oct+` / `Oct-`: transpose all notes in the selected step by one current
  tuning cycle without leaving displayed octave range `0` through `9`.
- `Prob`: encoder editing through `0`, `5`, `10`, ..., `100` percent.
- `Tie`: toggle the selected step's Tie flag.
- `Copy`: copy notes, length, velocity, probability, and Tie into a tapped
  destination step, then continue editing that destination.
- `Cancel/Finished`: return to the normal selected-step edit overlay.

Exact velocity and probability screens let step pads switch the edited step and
reload that step's saved value. Lower note-entry keys do not add or remove
notes while tools, exact editors, copy target selection, or temporary tools
status messages are open.

Transport playback uses each step's length, velocity, probability, and Tie.
Probability applies to the whole step during transport only: `0%` never starts
the step, and `100%` always starts it. Length `0%` is silent, lengths below
`100%` release before the next step, `100%` releases at the next step boundary
before the next non-tied step starts, and longer lengths can continue across
later steps. A tied step does not start its own notes; it continues the nearest
earlier eligible non-tied step from the same pattern pass. Tie does not wrap
from the end of the active pattern back to step `1`.

Sequencer LEDs show selected steps, programmed steps, accents, the clear
button, transport state, and the current play position. Button `9` is red when
stopped and green while playing. Step LEDs beyond the active `Steps` range stay
off even if those steps contain notes. Empty unselected non-accented steps stay
off, while empty accented steps are visible at medium neutral brightness.
Selected steps blink roughly `600ms` on and `200ms` off, including empty
selected steps. Playing empty steps stay visibly highlighted.

Programmed steps use a brightness ladder: normal programmed steps are medium,
selected or accented programmed steps are high, and the current playing
programmed step is highest. Accents change brightness only; they do not change
hue. In `Step Color = Regular`, programmed steps use the selected `Step Hue`.
In `Step Color = Note`, programmed steps use the stored step's lowest note and
the current keyboard color palette, including color mode and ColorByKey.

## Files And Persistence

Open `File Management` from the Sequencer page for `New`, `Save`, `Save New`,
`Load`, `Revert`, `Create Folder`, and `Rename/Delete`.

Sequence files live under `/Sequences` and use the `.hbseq` extension. The file
browser scans only the current folder. Folders appear before sequence files;
selecting a folder enters it, and the back row moves up to the parent folder.
`Save New` saves into the current folder after naming the sequence.

`New` stops playback, releases sequencer-held notes, clears all sequence-owned
data to defaults, clears the current file path, and clears the dirty title
marker. It preserves profile-backed `Tap Preview`, `Monophonic`, and
`Seq Lights`.

`Save` writes the current file when one is loaded. If no file is loaded, it
opens the same folder-selection and naming flow as `Save New`. `Save New`
always prompts for a new sequence name, appends `.hbseq` internally, sets the
new file as current, and clears the dirty marker after a successful save.

`Load` stops playback, releases sequencer-held notes, loads the chosen `.hbseq`
file, makes it the current file, and clears the dirty marker. `Revert` reloads
the current file; when there is no current file, it resets to a blank/default
sequence. If the remembered startup file is missing or invalid, startup clears
the remembered path and leaves a blank/default sequence.

The sequencer remembers the current sequence path in `/Sequences/.current`.
After settings/profile restore during startup, the firmware reloads that file
when it exists and parses successfully. Profile-backed settings are not
overwritten by the sequence file.

The Sequencer page title reads `Sequencer` when no file is loaded. When a file
is loaded, it shows `Seq-NAME`. Unsaved sequence-owned changes show a dirty
marker, for example `Seq-*NAME`. The marker clears after successful `Save`,
`Save New`, `Load`, `Revert`, or `New`.

The naming screen accepts letters, numbers, spaces, and hyphen, up to `20`
visible characters. Duplicate names are rejected in the target folder. Cancel
leaves the file, folder, and current-path state unchanged.

Renaming supports sequence files and folders. If the current file is renamed,
or a containing folder is renamed, the remembered current path is repaired.
Deleting supports sequence files and folders; folder delete is recursive.
Deleting the current file, or a folder containing it, clears the current path.

Saved sequence files store:

- 32 step records with tuning-relative pitch-step values and note counts
- per-step length, velocity, probability, and Tie
- `Tempo`
- active `Steps`
- `Direction`
- `Play Type`

Sequence files do not store selected step, undo/tool/naming/browser state,
overlay messages, active note handles, transport timing, dirty state,
`Tap Preview`, `Monophonic`, or `Seq Lights`.

## Not Yet Ported

The current sequencer slice does not include external MIDI clock, MIDI
start/stop/clock send, USB Backup, desktop backup scripts or launchers, or the
performance monitor overlay.
