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

Button `9` is Play/Stop. A short press starts and stops local playback. If a
step is selected, the short press first closes that selected-step edit focus,
blanking the sequencer display, then toggles transport. Playback runs through
the active step range, and each step is one 16th note. Open `Playback Settings`
from the Sequencer page to edit these playback controls:

- `Steps`: active loop length, `1` through `32`, default `32`.
- `Direction`: `Forward`, `Backward`, `Ping-Pong`, `Random`, `Brownian`, or
  `Drunk`, default `Forward`.
- `Tempo`: internal tempo, `1` through `255` BPM, default `120`.
- `Play Type`: `MIDI` or `OB Synth`, default `MIDI`.
- `MIDI Sync`: opens `Clock Source`, `Send Clock`, and `Send Transport`.
- `Tap Preview`: `Off` or `On`, default `On`.
- `Monophonic`: `Off` or `On`, default `Off`.

`Steps`, `Direction`, `Tempo`, and `Play Type` are sequence-owned values and
are saved in sequence files. `Clock Source`, `Send Clock`, `Send Transport`,
`Tap Preview`, and `Monophonic` are saved in the current board profile, not in
sequence files.

When `Clock Source` is `Internal`, `Tempo` is the active clock and button `9`
starts or stops the sequencer as before. When `Clock Source` is `External MIDI`,
incoming MIDI Clock pulses drive playback instead: every six `0xF8` pulses
advance one sequencer step. Incoming MIDI Start `0xFA` starts from the
beginning, Stop `0xFC` stops playback and releases sequencer playback notes,
and Continue `0xFB` follows the current firmware's old-sequencer-compatible
start-like resume behavior. `Tempo` remains stored and displayed, but it does
not advance steps while External MIDI clock is selected.

`Send Clock` and `Send Transport` both default to `Off`. They only apply while
`Clock Source` is `Internal`: `Send Clock` emits six MIDI Clock pulses per
sequencer step while local transport is running, and `Send Transport` makes
local Play/Stop send MIDI Start/Stop. External MIDI transport receive does not
echo outbound realtime messages.

Hold Play/Stop for about two seconds to show the temporary Performance Monitor.
It stays visible only while Play/Stop remains held, does not toggle transport
when the hold is consumed, and returns to the previous sequencer view when
released. File Management and naming screens remain modal, so this gesture does
not run while those workflows are active.

The Performance Monitor shows:

- `AudioEng`: approximate audio engine load percentage from the existing audio
  ISR profile.
- `Mem`: heap used versus total heap.
- `FS`: LittleFS used versus total storage, or `FS  unavailable` when storage
  information cannot be read.
- `MIDI Q`: current pending incoming MIDI bytes.
- `Drop` and `Late`: receive-stress episode counters for MIDI backlog pressure,
  not exact hardware packet-loss counters.

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
If `DisplayNotes` is enabled, those no-selection audition notes also drive the
normal compact played-note badge when the Sequencer menu is visible. If the
OLED screensaver is active, or if the sequencer display is blank after closing
selected-step edit focus, they use the full `Now Playing` overlay and return to
that blank display afterward. The overlay uses the same label/number mode,
six-note cap, release timing, and 12-EDO chord names as Keyboard mode.
With a step selected and `Monophonic` Off, the same note press auditions and
toggles that tuning-relative pitch in the selected step. With `Monophonic` On,
pressing a pitch already in the selected step removes it; pressing a different
pitch replaces the selected step's notes with only that pitch. Turning
`Monophonic` On does not rewrite existing chord steps. Releasing the key
releases the sequencer-managed audition note, and panic, playback changes, or
leaving Sequencer mode clears any held sequencer notes. Selected-step entry,
tap preview, and transport playback do not drive the played-note overlay.

When `Tap Preview` is `On`, selecting a programmed step previews its stored note
or chord through the current `Play Type`. When it is `Off`, step selection still
updates the Edit overlay without playing preview notes. Probability affects
transport playback only; tap preview ignores probability. Tied steps stay
silent during tap preview because transport treats them as continuations rather
than new note starts.

Button `18`, the 9th key on the second row, opens the Overview screen. The
Overview has no title bar and packs as many steps as fit on the OLED at once:

```text
01 C4 E4 G4
   B4 D5 F5
02 _
03 A2 C3 E3
04 T
```

Press button `18` again while the Overview is open to advance to the next
packed page; repeated presses cycle through the full 32-step pattern and wrap
back to step `1`. Empty steps show `_`, tied steps show `T`, and chord notes
display low-to-high. A chord stays on one line when the note labels fit and
continues on a second indented line only when needed. In `12 EDO`, note labels
use names such as `C4`; other tunings use `step.octave` labels such as `7.4`.
Pressing a step pad or lower note-entry key hides the Overview first, then
continues the normal selection, tap-preview, audition, or note-edit action.
Button `18` stays medium white while idle and becomes brighter white while the
Overview is open.

Selecting a step shows a compact Edit overlay:

- `Edit #NN`
- `L <length>% V <velocity> P <probability>%`
- the selected step's notes, or `--` when empty

Programmed steps show all stored notes, sorted low-to-high, up to the current
six-note step limit. Tied steps show `T` instead of their stored notes. The note
area stays on one line when labels fit and wraps to a second line when needed.
`12 EDO` labels use familiar names such as `C3`; other tunings use numeric
`step.octave` labels.

Pressing the selected step pad again closes edit focus and blanks the sequencer
display instead of returning to the Sequencer menu. The next step selection,
Overview, Tools, or menu action draws its normal screen.

Turning the encoder while a step is selected changes that step's length through
the quick choices `0`, `25`, `50`, `75`, `100`, `150`, `200`, `250`, `300`,
`350`, `400`, `500`, `600`, `700`, `800`, `900`, and `1000` percent. Pressing
the encoder while a step is selected deselects the step and blanks the
sequencer display.

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
`Clock Source`, plus `Seq Lights`.

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
`Clock Source`, `Tap Preview`, `Monophonic`, or `Seq Lights`.

## Not Yet Ported

The current sequencer slice does not include USB Backup or desktop backup
scripts and launchers.
