# HexBoard User Manual

## What HexBoard Is

HexBoard is a 140-button hexagonal MIDI controller and instrument. It can act as:

- A USB and serial MIDI controller
- A microtonal and isomorphic keyboard
- A standalone synth with mono retrigger, mono legato, polyphonic, and arpeggiated playback
- A visual performance surface with per-key LEDs, animations, scales, and color modes

This manual focuses on playing and configuring HexBoard.

## Basic Hardware Layout

The playing surface has:

- `133` musical note buttons
- `7` command buttons in the offset bottom-left column area
- A rotary encoder with a push switch
- A monochrome OLED menu display
- One LED under each button

The seven command buttons are for live controls such as velocity, modulation, and pitch bend. They do not play notes.

## Power-Up And Normal Operation

When you power on HexBoard, it loads your saved setup while running a smooth rainbow splash, then fades into the normal resting LED state. The OLED menu appears when startup is complete and its controls are ready to use.

If saved settings are missing or unreadable, HexBoard uses safe defaults and
reports the problem under `Settings` -> `Advanced` -> `Storage Status`. Save a
profile to keep the fallback setup, or make changes with Auto-Save enabled.
Saving is unavailable if onboard storage cannot be opened.

On first boot with no saved settings yet, the board also lights all LEDs at a moderate white level for about `2 seconds` before the rainbow splash. This helps you spot missing pixels, weak LEDs, or uneven white balance.

## Playing Notes

Most buttons are note buttons. What each button plays depends on:

- The selected tuning
- The selected layout
- The selected key
- The transpose value
- Whether scale lock is enabled

If `Scale Lock` is off, every note button can play. If `Scale Lock` is on, only notes in the active scale respond.

### Played Note Display

The `DisplayNotes` option in `Settings` controls the OLED played-note overlay.
Set it to `Off`, `Label`, `Number`, or `MIDI`. `Label` shows the active tuning's note
labels with octave numbers, including custom labels.
Custom note labels are limited to `7` characters. The main-menu `Key` selector
uses those labels for tunings through 255 divisions; larger tunings use numeric
root steps so every division remains selectable.
`Number` shows scale step and octave values such as `7.4`. `MIDI` shows the
current MIDI note number, such as `60` for middle C in standard tuning.

While the menu is visible, the top-right corner shows only the most recent held
note. During very rapid playing, the displayed note may lag slightly behind. If
the OLED screensaver is active,
playing a note can wake a larger `Now Playing` display that shows up to `6`
unique played notes from lowest to highest. Turning or pressing the encoder
returns to the menu display.
While the velocity, modulation, or pitch-bend readout is active, played notes
stay in the compact badge instead of taking over the whole screen.
If the OLED was asleep and notes are still held when that readout clears,
HexBoard returns to the larger `Now Playing` display until the notes are
released.
Recognized chord names appear near the bottom of that larger display only for
`12 EDO`. In Sequencer mode, the same display applies to lower-grid audition
notes when no step is selected; if selected-step edit focus was closed and the
sequencer display is blank, audition notes use the larger overlay and return to
blank afterward instead of redrawing the menu. Selected-step entry, tap preview,
and transport playback keep the Sequencer screens focused instead.
`DisplayNotes` defaults to `Label`.

## Live Performance Controls

### Command Buttons

The seven reserved command buttons are split into three groups:

- Top group of `3`: velocity wheel controls
- Middle single button: toggles whether the bottom group controls modulation or pitch bend
- Bottom group of `3`: modulation or pitch-bend wheel controls

The wheel behavior depends on menu settings:

- `Springy`: returns to its default value when released
- `Sticky`: holds its last value

When a command-wheel value changes, the OLED briefly shows a full-screen
readout with the control name, the current value, and a simple meter. Velocity
and modulation show raw `0`-`127` values. Pitch bend shows a centered percentage
from `-100%` to `+100%`. The readout updates smoothly while a held wheel button
moves the value, and clears after about `3 seconds`, or sooner if another menu,
list, Sequencer, delegated-control, save, or transfer screen updates the
display. Command-wheel feedback does not reset the OLED menu screensaver timer;
the menu still falls asleep about `30 seconds` after the last encoder action.

### Rotary Encoder

The encoder controls the OLED menu:

- Turn: move up or down in menus
- Press: confirm / enter
- Hold for about `2 seconds`: panic stop

The panic stop sends note-off style cleanup and clears active output. It is the fastest way to recover from stuck notes or a hung performance state.

## OLED Menu Overview

The OLED menu powers down after about `30 seconds` without encoder/menu
activity. Turning or pressing the encoder wakes it. Temporary note,
command-wheel, delegated-control, save, and transfer screens may wake the panel
long enough to show feedback, then return it to sleep if the menu timer had
already expired.

The main menu includes:

- `Tuning:<current>`
- `Layout:<current>`
- `Key`
- `Scale:<current>`
- `Scale Lock`
- `Synth:<current preset>`
- `Lights & Colors`
- `Transpose`
- `Editor`
- `Profiles`
- `Settings`

If your firmware includes the optional Sequencer, a `Sequencer` item appears
above `Settings`. For sequencer information, see the
[Sequencer Manual](sequencer/manuals/sequencer_manual.txt). These versions also
include `File Management` -> `USB Backup` for
using the desktop HexBoard Backup GUI with saved `.hbseq` sequences.

`Synth:<current preset>` opens the synth preset load menu from the top level.
If the current synth sound has changed since the loaded preset was selected or
saved, the preset name is shown with a leading `*`.
Library browsers use arrows for folders and actions, and a diamond marks the
loaded item. Long names scroll when you leave the selection on them.

### Tuning

Use this section to choose the tuning for the whole board. Supplied factory
tunings appear at the root in their original order, and additional saved
tunings can be organized into folders. The active tuning shows a diamond in the left
action-icon slot when it appears in the list. Selecting a tuning also loads the
first linked layout, scale, colors, and custom key assignments so the
board is immediately playable.

Dynamic JI controls live under `Editor`.

When MPE is active, Dynamic JI and JI BPM Sync send the closest MIDI note for
the final retuned pitch, then use pitch bend only for the remaining fractional
part. The onboard synth uses the computed JI cents directly, so its JI pitch
resolution is not limited by the `MPE Bend` setting.

Scala `.scl` and cents-table tunings imported through HexBoard Sync can be
selected and played like other tunings.

Changing tuning also resets:

- Layout to the first saved layout linked to that tuning
- Scale to the first saved scale linked to that tuning
- Key to the tuning’s saved default key

### Layout

Use this page to choose how pitch moves across the hex grid. Factory and saved
layouts linked to the active tuning appear in a list. The active layout shows a diamond in
the left action-icon slot when it appears in the list.

Choosing a layout remaps button pitches, loads its custom key assignments when
present, and restores that layout's default device
rotation in 90-degree steps.

Layout rotation, flip, and display rotation controls live under `Editor`.

### Scale

Use this page to choose the active scale. Factory and saved scales linked to the
active tuning appear in a list. The active scale shows a diamond in the left action-icon slot
when it appears in the list.

Choosing a scale updates scale membership while keeping the current user tuning,
layout, color map, and button map active. `Key` and `Scale Lock` are on the main
menu.

When `Scale Lock` is enabled, out-of-scale notes stop responding to presses.

### Lights & Colors

This page controls LED appearance.

Options include:

- `Color Mode`
- `Brightness`
- `LED Limit`
- `Animation`
- `Rest Bright`
- `Dim Bright`

Available color modes are `Rainbow`, `Diatonic`, `Alt`, `Fifths`, `Piano`, `Alt Piano`, `Filament`, and `Custom`. `Custom` shows a scale-degree color scheme loaded from the web editor. The animation list includes button, octave, by-note, star, splash, orbit, beams, reversed variants, and MIDI-in highlighting.

`Settings` -> `ColorByKey` moves the palette origin with the selected musical
key for every palette-derived color mode. When it is off, those colors remain
anchored to C. Direct per-button colors in `Custom` mode remain attached to
their assigned buttons.

Buttons whose tuned notes fall outside the playable MIDI range remain unlit so
they are not mistaken for playable keys, and pressing them produces no MIDI or
synth response or animation. LED animations started by other playable keys can
still light them. An active per-button color override in `Custom` mode takes
precedence and keeps its assigned resting color.

`LED Limit` helps prevent power problems by lowering LED output when a bright setting would draw too much current. This matters most in bright modes such as `Filament` and `Diatonic`. `Off` leaves the LEDs uncapped and can cause resets at extreme brightness. The numbered limits use hardware-specific calibration tables for `V1.1` and `V1.2` boards. The factory default is `1.5 A`, calibrated to provide a similar actual USB-side draw on both hardware revisions and stable behavior on most power supplies.

### Transpose

`Transpose` shifts sounded pitch without changing the visual layout.

### Editor

`Editor` contains fine controls that shape how the current setup behaves without
choosing a new tuning, layout, scale, or profile.

Options include:

- `Synth`
- `Dynamic JI`
- `JI Table` when `Dynamic JI` is enabled
- `JI BPM Sync`
- `Beat BPM` when `JI BPM Sync` is enabled
- `BPM Mult.` when `JI BPM Sync` is enabled
- `Layout Rot`
- `Flip L/R`
- `Flip U/D`
- `Device Rot`

`JI Table` selects the maximum prime limit used by Dynamic JI ratio matching:
`3Limit`, `5Limit`, `7Limit`, and higher options through `41Limit`. Lower-limit
tables use simpler ratios; higher-limit tables preserve the broader
candidate set.

`Beat BPM` and `BPM Mult.` control the BPM-synced retuning grid and are hidden
when `JI BPM Sync` is off.

`Layout Rot` rotates the musical axes in 60-degree steps. `Flip L/R` mirrors
the layout around the middle key, physical button `65`. `Flip U/D` mirrors the
layout vertically across the grid. `Device Rot` changes the physical
device/display orientation through `0`, `90`, `180`, and `270` degrees without
changing the musical layout. User layouts can provide defaults for all four
fields; the menu keeps the names distinct because device rotation never changes
which pitch a physical key plays.

#### Synth

This page controls the onboard synth.

Options include:

- `Synth Mode`: `Off`, `MonoRtg`, `MonoLeg`, `Arp'gio`, `Poly`
- `Volume`
- `Buzzer` on hardware `V1.2`
- `Arp Speed` when `Arp'gio` is selected
- `Arp Dir` when `Arp'gio` is selected
- `Porta` when a mono mode is selected
- `WT:...` current-wavetable load menu
- `WT Pos`
- `Drive`
- `Amp Env`
- `FX Env 1`
- `FX Env 2`
- `LFO`
- `Wheel FX`
- `Wheel Amt`
- `Vib Speed`
- `Tempo`
- `Metronome`
- `Time Sig`
- `Preset:<current preset>`
- `Save Preset`

On hardware `V1.1`, the onboard synth plays through the piezo buzzer when the
synth is active. There is no headphone-jack output path and no `Buzzer` menu
toggle.

On hardware `V1.2`, the headphone jack is active by default and an extra
`Buzzer` toggle appears. Turning `Buzzer` on switches synth output to the piezo
instead of the jack.

`Volume` limits the active synth output from `25%` to `100%` in `5%` steps. The
headphone jack and piezo each have their own saved value, so changing `Buzzer`
recalls the volume for that output.

#### Synth Terms In Plain Language

The onboard synth is a simple sound generator inside HexBoard. It is separate
from MIDI output, so you can use the onboard synth, external MIDI gear, or both.
Turning the synth `Off` does not disable external MIDI. The onboard synth follows
HexBoard's tuning directly; MPE settings are for external MIDI receivers.

`Synth Mode` chooses how notes are played:

- `Off`: no onboard synth sound
- `MonoRtg`: one note at a time, restarting the amp envelope when the active note changes
- `MonoLeg`: one note at a time, sliding to newly held notes without restarting the amp envelope while another note is still held
- `Arp'gio`: cycles through held notes rhythmically
- `Poly`: plays chords, up to `8` notes at a time - a bit quieter due to headroom needed

In `Poly`, playing more than `8` overlapping notes causes HexBoard to reuse an
existing voice while favoring the lowest held note.

`Porta` appears for the two mono modes. It sets the pitch-glide time from
`0 ms` through `4 s`. With `MonoRtg`, the envelope restarts but the pitch can
still glide. With `MonoLeg`, held note changes keep the envelope running and
use the selected glide time.

`Arp Speed` and `Arp Dir` appear for `Arp'gio`. The arpeggiator sorts by the
actual assigned note/frequency for `Up`, `Down`, `UpDown`, and `DownUp`; it can
also follow `Played`, `RevPlay`, or `Random` order. `Played` means the order in
which held notes were pressed, not the physical button numbers.

`WT:...` shows the currently loaded wavetable and opens its library.
Basic Shapes is the built-in rescue table. Supplied factory wavetables appear
in the root directory, while user-imported wavetables can be organized into
folders. Factory wavetables other than Basic Shapes can be edited or erased. The active
wavetable shows a diamond in the left action-icon slot when it appears in the
list. The factory image includes:

- `Basic Shapes`: sine, triangle, saw, and square anchors
- `Classic`: strings and clarinet anchors
- `Vowels`: the factory vowel wavetable
- `HarshDigitalBois`: bright or sync-like MP waves
- `RustyBlade`: buzzy and rough MP waves
- `RoundThe808`: rounded and 808-like MP waves
- `GlassyBells`: glassy and bell-like MP waves

Everything in this list except Basic Shapes can be edited or erased like an
imported wavetable. Reinstall the Factory UF2 to restore the supplied library.

User-imported wavetables appear in the same `WT:...` browser after they are
saved through the web app. New imports default to `Root` unless another folder
is selected. When connected, the app uploads them for immediate audition. If a
preset references a wavetable name that is not installed on the HexBoard, the
synth loads `Basic Shapes` and shows the required name for two seconds with an
instruction to upload it using HexBoard Sync. Wavetable names are unique across
the whole device; folders organize the library but do not affect preset
matching.

`WT Pos` chooses the starting frame for wavetable waveforms. On device, the menu
shows frames `1` through `16`; frame `1` is the first frame and frame `16` is
the last frame. These menu positions land directly on the named frame; modulation
can still add to or subtract from this base position, so setting `WT Pos` above
frame `1` lets a negative envelope or LFO amount move backward through the
wavetable.

`Drive` adds soft saturation after the voices are mixed:

- `Off`: clean output, and the factory default
- `Warm`: a clear push that adds body
- `Edge`: obvious bite and clipping
- `Dirty`: stronger saturation for rougher synth tones

`Amp Env` opens the amp-envelope page. `Attack`, `Hold`, `Decay`, `Sustain`,
and `Release` shape the loudness of each note. Envelope time choices run from
`0 ms` to `4 s`.

- `Attack`: how quickly the sound fades in after pressing a note
- `Hold`: how long the envelope stays at full level before decaying
- `Decay`: how quickly the first hit settles down to the held level
- `Sustain`: how loud the note stays while you keep holding it
- `Release`: how long the sound fades out after you let go

`FX Env 1` and `FX Env 2` open separate modulation-envelope pages. Each page has
`Target`, `Amount`, `Attack`, `Hold`, `Decay`, `Sustain`, and `Release`.

`LFO` opens the synth LFO page. `Target` uses the same targets as `Wheel FX`;
`Amount` is bipolar from `-100%` through `Off` to `+100%`, with fine `1%`
steps around `Off`; `Wave` selects `Sine`, `Triangl`, `Saw`, `Square`, `Noise`,
or `Smooth`; and `Speed` ranges from `0.05 Hz` to `20 Hz`, with extra slow
choices below `1 Hz` for gradual wavetable or phase-warp movement. `Noise` is
stepped random modulation; `Smooth` glides between random levels.

`Target` chooses `Vibrato`, `Pitch`, `WT Pos`, `FoldWrp`, `DutyWrp`, or
`PolyWrp`. The wheel, both FX envelopes, and the LFO can choose the same target;
their amounts add together and clamp at the maximum effect depth instead of
replacing each other.

`Amount` controls how strongly the envelope affects the target, with the same
fine low-depth choices as the LFO amount. Positive amounts push the target in
one direction; negative amounts use the same AHDSR shape and push the target in
the opposite direction. Pitch, phase warp, and wavetable position
return smoothly to their base values as the FX envelope falls back to zero. Negative
`Vibrato` is different: vibrato is the resting sound, and the envelope pulls it
down as the envelope level rises. The default FX envelope times are `0 ms`, and
default sustain is `0%`, so the FX envelopes do nothing until you shape them.

`Wheel FX` chooses how the mod wheel affects the onboard synth:

- `Vibrato`: adds pitch vibrato to the active synth voices
- `Pitch`: bends pitch up with the wheel or positive FX amounts, and down with negative FX amounts. Full-depth pitch modulation spans about `+/-24` semitones.
- `WT Pos`: scans the selected wavetable forward or backward from the base `WT Pos`
- `FoldWrp`: applies the original folded phase-warp color movement across the onboard waveforms
- `DutyWrp`: shifts the two halves of the oscillator cycle in opposite directions for a sharper duty-style phase warp
- `PolyWrp`: applies a smoother polynomial phase warp that bends most strongly inside each half-cycle

External MIDI still receives normal mod-wheel `CC 1` messages. `Vib Speed` sets
the onboard vibrato LFO speed from `1 Hz` to `12 Hz` for wheel or envelope
vibrato. The `Noise` speed after `12 Hz` uses smooth random vibrato at the same
12 Hz rate. `Wheel Amt` scales how strongly the mod wheel affects its target.

`Tempo` is shared by the arpeggiator and metronome. `Metronome` has four modes:

- `Off`: no metronome
- `Beep`: a short metronome beep on each beat through the active synth output
- `Bright`: strongly dims the LED frame between beats and returns toward the selected brightness on each beat
- `Side Btns`: the seven side command buttons flash green on the first beat and red on the other beats

`Time Sig` sets the metronome accent cycle and beat length. The first beat of
each measure is accented.

The top-level `Synth:<preset>` item and the `Preset:<preset>` item inside
`Editor` -> `Synth` both open synth preset load lists. The library holds up to
`128` named presets organized in folders. Each settings profile remembers its selected
synth preset or `Blank` state. Auto-save and manual profile saves also preserve
unsaved synth edits without overwriting the named preset, so the preset label
can still show as modified after restart. On
the device, presets appear in a folder browser; `New Preset` saves into
the currently open folder. The supplied presets are organized into `Basses`,
`Leads`, `Pads`, and `Plucks`. They can be changed or erased like any other
preset. The web app
shows folders with preset counts. Search
narrows the compact preset list within the selected folder. Open a preset from
its name or use its more-actions menu for rename, move, copy, export, and
delete. The app can also create foldered presets.
`Rename / Move` changes a saved Browser or HexBoard preset in place, so changing
its name or folder does not require making a copy and deleting the old preset.
If the destination already contains a preset with the same name, the app shows
which preset will be replaced and requires confirmation. `Delete` also requires
confirmation and states that it cannot be undone.

Use the selection boxes in either preset library for batch work. The batch
toolbar appears after at least one preset is selected. `Select shown`
selects the presets visible under the current folder filter. The selected
presets can be copied together to the other library or exported as one JSON
library file. `Import Preset Files` accepts several individual preset files, a
bulk library file, or both in one file selection. Before a batch import or copy,
the app lists how many existing destination presets will be replaced and waits
for confirmation.

The load list also includes `Blank`. Loading from the top-level `Synth` item
returns to the main menu; loading or saving from `Editor` -> `Synth` returns to
`Synth`. Loading a preset changes only the current synth parameters and
wavetable reference, which can still be preserved by profile auto-save. The
currently loaded catalog preset shows a diamond in the left
action-icon slot when it appears in the load list; `Blank`, `New Preset`, and
the unselected `Current` state are not marked.

Short `Attack` feels immediate. Long `Attack` fades in. `Hold` keeps the initial
peak longer before decay. Low `Sustain` makes a note fade away even while you
hold it. High `Sustain` keeps the note steady. Short `Release` stops quickly.
Long `Release` leaves a tail after release.

#### Beginner Synth Recipes

Use these as starting points, then adjust by ear.

| Sound | Synth Mode | Wavetable / WT Pos | Attack | Hold | Decay | Sustain | Release | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Plucky | `Poly` or `MonoRtg` | `Basic Shapes` around frame `1` to `11` | `0 ms` or `5 ms` | `0 ms` | `50 ms` to `200 ms` | `0%` or `10%` | `50 ms` to `200 ms` | Fast start, quick fade, little held level |
| Smooth pad | `Poly` | `Basic Shapes` at frame `1` or `Classic` at frame `1` | `200 ms` to `1 s` | `0 ms` | `500 ms` to `1 s` | `75%` or `100%` | `500 ms` to `2 s` | Slow fade-in and long release |
| Lead | `MonoRtg` or `MonoLeg` | `Basic Shapes` around frame `11` to `16` | `0 ms` or `10 ms` | `0 ms` to `50 ms` | `50 ms` to `200 ms` | `75%` or `100%` | `50 ms` to `200 ms` | Use `Porta` for glide or keep it at `0 ms` for immediate melodies |
| Chime or bell | `Poly` | `GlassyBells` or `RoundThe808` | `0 ms` or `5 ms` | `0 ms` | `500 ms` to `1 s` | `0%` | `500 ms` to `2 s` | Rings out after the initial hit |
| Arpeggio | `Arp'gio` | `Basic Shapes` around frame `11` or `HarshDigitalBois` | `0 ms` or `5 ms` | `0 ms` | `50 ms` to `200 ms` | `0%` to `25%` | `20 ms` to `100 ms` | Use `Arp Speed`, `Arp Dir`, and `Tempo` for rhythm |

For a sharper sound, use `Basic Shapes` at a higher `WT Pos` frame or one of
the `HarshDigitalBois` or `RustyBlade` frames, and keep `Attack` short. For a
smoother sound, use `Basic Shapes` near frame `1` or `Classic`, then increase
`Attack` and `Release`.

If a sound feels too clicky, raise `Attack` one step. If notes smear together,
lower `Release`. If a pluck does not fade away enough, lower `Sustain` or lower
`Decay`. If a held note disappears too quickly, raise `Decay`.

To add motion without touching the mod wheel, put one FX envelope on a short
transient and leave the wheel on the effect you want under your hand. For
example, `Wheel FX` = `FoldWrp`, `FX Env 1 Target` = `Vibrato`, `Amount` = `+50%`,
`Decay` around `100 ms`, and `Sustain` = `0%` adds a short vibrato chirp at the
start of each note. For a falling pitch tail, try `FX Env 2 Target` = `Pitch`,
`Amount` = `-25%`, `Sustain` = `100%`, and a longer `Release`.

### Profiles

HexBoard supports `9` profile slots:

- `Boot/Auto-Save`
- `Slot 1`
- `Slot 2`
- `Slot 3`
- `Slot 4`
- `Slot 5`
- `Slot 6`
- `Slot 7`
- `Slot 8`

How it behaves:

- `Auto-Save` is at the top of the `Profiles` menu
- Load rows appear next: `Load Boot/Auto-Save`, `Load Slot 1`, and so on
- Save rows appear below the load rows: `Save Boot/Auto-Save`, `Save Slot 1`, and so on
- Auto-save always snapshots the current setup back into the `Boot/Auto-Save` profile
- Loading a slot immediately replaces the current setup, including its tuning,
  layout, scale, color mode, MIDI settings, and selected wavetable
- Saving stores the current setup, including those tuning, layout, and wavetable
  selections, in the chosen slot

### Settings

`Settings` is one scrolling page. Its rows appear in this order:

- `MIDI Channel`
- `MPE Mode`
- `MPE Bend`
- `MPE Low Ch`
- `MPE High Ch`
- `MPE Low Priority`
- `Extra MPE`
- `CC 74 Value`
- `RolandMT32`
- `GeneralMidi`
- `Vel Wheel`
- `PB Wheel`
- `Mod Wheel`
- `Pitch Bend`
- `Mod Wheel`
- `ColorByKey`
- `DisplayNotes`
- `Advanced`

The first ten rows control how HexBoard talks to external MIDI gear and music
software. Most users can leave `MPE Mode` on `Auto`. Use `MPE Bend`, `MPE Low
Ch`, and `MPE High Ch` when matching HexBoard to an MPE synth or plugin.
`RolandMT32` and `GeneralMidi` send preset-selection messages for compatible
external devices.

`Vel Wheel`, `PB Wheel`, and the first `Mod Wheel` row set how quickly the
command-button wheels move. Speed choices run from `TooSlow`, `Turtle`, `Slow`,
`Medium`, `Fast`, `Cheetah`, and `VeryFast` to `Instant`. All three default to
`Medium`.

`Pitch Bend` and the second `Mod Wheel` row choose whether each control is
`Springy` or `Sticky`. `Springy` returns to its default value when released;
`Sticky` holds its last value.

`ColorByKey` makes palette-derived color modes follow the selected musical key.
When it is off, their color origin remains anchored to C. `DisplayNotes`
controls the played-note display described above.

#### Advanced

Select `Advanced` for these maintenance and system rows:

- Firmware version label
- `Hardware`
- `Invert Encoder`
- `Button Encoder`
- `Boot Anim`
- `Storage Status`
- `Reset Defaults`
- `Update Firmware`
- `Serial Debug`
- `LED Test`

`Invert Encoder` reverses the normal encoder direction for your hardware.
`Button Encoder` enables command-button rotation (off by default). Hold the
bottom command button and press the top command button for counterclockwise/
menu up, or the second command button from the top for clockwise/menu down.
Each press moves one step, independent of `Invert Encoder`. While enabled, the
bottom command button remains usable for its normal command-wheel function as
well as acting as the modifier; the top two command buttons are used only for
menu navigation while it is held. Release the bottom command button to use all
three normally. This shortcut is available in music and sequencer modes,
outside transfers; delegated control retains its own button handling.

`Boot Anim` controls the startup LED animation; turn it off for the fastest,
quietest visual boot. `Storage Status` shows `Storage OK` or the storage issues
found during startup.

`Serial Debug` provides diagnostic output for development and support. Leave it
disabled during normal use unless a troubleshooting guide asks you to enable
it. The page initially shows `Enabled`; turning it on reveals `General Log`,
`Min Heap`, and `Audio Stats`. These choices reset when HexBoard restarts.

`LED Test` is temporary and is not saved in profiles. Enter it and scroll
through `Red`, `Green`, `Blue`, or `White` to light every LED immediately.
Leaving the selector resets it to `Off` and restores the normal LED display.

### External Delegated Control

Some external software can temporarily take over HexBoard as a button-and-light surface. In that mode, normal playing, arpeggiation, control wheels, and built-in LED animations are paused while the host controls the surface.

Delegated control is only for compatible host software. It is not shown in the OLED menu, is not saved in profiles, and starts disabled every time HexBoard boots. Host-driven LEDs still respect `Brightness` and `LED Limit`.

Compatible hosts can assign MIDI output to individual keys. These assignments
remain available while delegated mode is in use and reset after a power cycle
or host reset.

When delegated mode starts, the OLED shows `Delegated Control Mode` and, when
provided by the host, the controlling app name. The normal menu is disabled.
Encoder turns and encoder button press/release events are sent to the host; the
saved `Invert Encoder` setting reverses the normal direction selected for the
detected hardware revision. The OLED
screensaver still blanks the display after inactivity and only encoder activity
wakes it again. Hold the encoder button for about `5` seconds to force HexBoard
out of delegated mode.

### Companion Web App

HexBoard Sync edits tunings, layouts, scales, colors, key assignments, synth
presets, and wavetables. You can keep drafts in the browser, export backups,
preview changes on a connected board, and save them to its library.

See the [HexBoard Sync guide](web-app-guide.md) for connection, editing, and
library workflows.

## Saving Settings

HexBoard saves settings to onboard storage.

What to expect:

- Changes become ready to save immediately
- If `Auto-Save` is enabled, HexBoard saves after about `10 seconds` of inactivity
- Manual profile saves happen immediately
- While saving, the OLED briefly shows `Saving to flash.` and `Audio muted.`
- Saving may mute the onboard synth and pause controls very briefly
- If stored data cannot be read, HexBoard uses a safe fallback and reports the
  affected item under `Settings` -> `Advanced` -> `Storage Status`
- If onboard storage is unavailable, saving remains disabled until the next
  restart

## Microtonal And MPE Behavior

HexBoard supports standard `12 EDO` and many non-12-EDO tunings. Depending on the tuning and menu settings, HexBoard may:

- Send normal single-channel MIDI
- Use multiple MIDI channels for wider note ranges
- Use MPE for microtonal pitch bends

In `Auto` mode, standard `12 EDO` generally stays in normal MIDI mode, while
microtonal setups may switch to MPE automatically. The `MIDI Channel` row is the
note channel for single-channel mode. In MPE mode, channel `1` is the zone
master and notes begin at `MPE Low Ch` (channel `2` by default), so a saved and
displayed `MIDI Channel` of `1` does not mean MPE notes will be sent on channel
`1`.

For DAW, plugin, and hardware synth setup, including pitch-bend range matching
and channel-zone examples, see the [MPE Microtonal Setup Guide](mpe-microtonal-setup.md).

## Factory Defaults

Important factory defaults include:

- Tuning: factory-library `12 EDO (Normal)`
- Layout: its `Wicki-Hayden` layout
- Device Rot: `0`
- Scale: chromatic / none
- MIDI channel: `1`
- MPE mode: `Auto`
- Active synth preset: `Lo-Fi Synth Strings`
- Synth: `Poly`
- Synth output volume: `100%` for headphone and piezo
- Wavetable: `/Classic`
- WT Pos: frame `1`
- Drive: `Off`
- Wheel FX: `FoldWrp`
- Wheel Amt: `100%`
- Vibrato speed: `6 Hz`
- Amp Env Hold: `0 ms`
- FX Env 1: `Vibrato`, `+100%`, `0 ms` attack, `0 ms` hold, `0 ms` decay, `0%` sustain, `0 ms` release
- FX Env 2: `Pitch`, `+100%`, `0 ms` attack, `0 ms` hold, `0 ms` decay, `0%` sustain, `0 ms` release
- Synth presets: `16` editable factory presets organized by sound category
- Boot animation: `On`
- Metronome: `Off`
- Time signature: `4/4`
- LED brightness: `Dim`
- LED limit: `1500 mA`
- Animation: `Button`
- Display notes: `Label`
- Auto-save: `On`

## Updating Firmware

Use `HexBoard_Factory.uf2` for a factory installation. It erases all saved
settings, presets, wavetables, tunings, layouts, and sequences, then installs a
complete factory library. Use `HexBoard_Update.uf2` to update firmware without
changing your library. Settings from an incompatible beta may return to their
defaults, while compatible presets, wavetables, tunings, and sequences remain
available.

If stored content cannot be read after an update, HexBoard continues with safe
defaults and reports the affected item under `Settings` -> `Advanced` ->
`Storage Status`. If onboard storage is unavailable, it starts with the built-in
12 EDO tuning and `Basic Shapes`, and saving remains disabled until the next
restart.

How to update:

1. Plug your HexBoard into your computer.
2. Navigate to `Settings` -> `Advanced` -> `Update Firmware` in the menu.
3. The HexBoard shows `Ready to update! Copy the .uf2 file to the RPI-RP2 drive on your computer.`
4. Drag the `.uf2` file onto the `RPI-RP2` drive.
5. The HexBoard will automatically reboot with the new firmware.

Need bootloader recovery?

Hold the bootloader button while plugging it in:

- Hardware `1.1`: The button is next to the USB port.
- Hardware `1.2`: The button is hidden on the bottom. Press it with a paperclip near the ports while plugging the board in.

The board should appear as a removable USB drive. Drag the `.uf2` firmware file onto that drive, and the drive should eject when the board reboots into the new firmware.

## Troubleshooting

### Stuck notes

- Hold the encoder for about `2 seconds` to trigger panic stop

### Notes do not play

Check:

- `Scale Lock` is not hiding the notes you expect
- The synth is not set to `Off` if you expect onboard sound
- Your MIDI host is listening on the selected channel
- Your MPE range matches the receiving software or hardware

### LEDs changed but pitch did not

That is expected when you only changed color, brightness, or animation settings. Pitch changes come from tuning, layout, key, scale lock, and transpose settings.

### The board resets when lots of LEDs turn white

That usually means the LED draw is too high for the current power source. Lower `Brightness`, lower `Rest Bright`, or (most importantly) set `LED Limit` in `Lights & Colors` to a safer value such as `500 mA`, `1.0 A`, or the factory-default `1.5 A`.

### The board feels laggy when plugged into a sleeping or closed computer

If HexBoard is powered by a sleeping or closed computer, its USB MIDI
connection may become slow or unavailable. Wake the computer, connect to an
active MIDI host, use a powered hub, or use a battery bank if you need stable
USB power without a live MIDI receiver.

### A tuning change reshuffled everything

That is expected. HexBoard resets layout, scale, and key to known-valid values when the tuning changes.
