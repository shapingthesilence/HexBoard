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

When you power on HexBoard, it loads your saved setup, starts the OLED menu, runs a smooth rainbow splash, and fades into the normal resting LED state.

If saved settings are missing or unreadable, HexBoard restores factory defaults and saves a fresh default setup.

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

The `DisplayNotes` option in `Advanced` controls the OLED played-note overlay.
Set it to `Off`, `Label`, `Number`, or `MIDI`. `Label` shows the active tuning's note
labels with octave numbers, including labels provided by user geometry objects.
Custom note labels are limited to `7` characters so they fit the on-device Key
selector. The main-menu `Key` selector uses those same active tuning labels.
`Number` shows scale step and octave values such as `7.4`. `MIDI` shows the
current MIDI note number, such as `60` for middle C in standard tuning.

While the menu is visible, the top-right corner shows only the most recent held
note. The badge is composited into normal menu redraws so menu updates do not
momentarily erase it. If the OLED screensaver is active, playing a note can wake
a larger `Now Playing` display that shows up to `6` unique played notes from
lowest to highest. Turning or pressing the encoder returns to the menu display.
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
When a played-note badge is present, the readout refreshes less often so wheel
movement stays steady while notes are held.

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

Normal menu pages use a single-line `6x12` title in an `18`-pixel header.
Expanding the header from `10` to `18` pixels consumes the eight pixels that
were unused below the old list, so all `11` menu rows still fit on the
`128x128` display. The root page title is the compact `HexBoard` so it fits the
larger font cleanly. Titles are centered, and the divider sits at row `15`,
leaving two clear pixels before the first menu-row highlight begins.

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

Developer builds compiled with `HEXBOARD_ENABLE_SEQUENCER=1` also show a main
menu item named `Sequencer` above `Settings`. Default firmware builds may not include it. For
sequencer information, see the [Sequencer Manual](sequencer/manuals/sequencer_manual.txt).
Sequencer-enabled builds also include `File Management` -> `USB Backup` for
using the desktop HexBoard Backup GUI with saved `.hbseq` sequences.
<!-- Agent note: Do not add sequencer behavior details here unless explicitly requested. Keep detailed sequencer information under docs/sequencer/. -->

`Synth:<current preset>` opens the synth preset load menu from the top level.
If the runtime synth sound has changed since the loaded preset was selected or
saved, the preset name is shown with a leading `*`.
Rows that open virtual browsers, including tuning/layout/scale, synth preset,
and wavetable browsers, use the same right-side arrow cue as folder/submenu
rows. Inside those browsers, folders keep that right-side arrow and selectable
actions or entries use the action arrow. The currently loaded row uses a
diamond in the left action-icon slot. Virtual browsers use the same single-line
large header for the current browser action; folder paths are not shown in the
header. When the selector rests on
one of those launcher rows, long current names begin scrolling after `1.5`
seconds and advance one character every `250` ms. The final scroll position
pauses for `1` second before the name returns to the beginning and waits again.
Scrolling pauses while the played-note badge or full-screen played-note overlay
is shown.

### Tuning

Use this section to choose the tuning or geometry bundle the whole board runs
on. The page is a GEM-style virtual list backed by the editable geometry
catalog: supplied factory tunings appear at the tuning root in their original
factory order, and additional saved tunings can be organized into folders.
Tuning names and folders are kept in a small menu index, so scrolling does not
read the filesystem. Scrolling follows normal GEM list behavior, including page jumps at
the 11 visible-row boundary. The active tuning shows a diamond in the left
action-icon slot when it appears in the list. Selecting a tuning also loads the
first linked layout, scale, color map, and matching explicit button map so the
board is immediately playable.

Dynamic JI controls live under `Editor`.

When MPE is active, Dynamic JI and JI BPM Sync send the closest MIDI note for
the final retuned pitch, then use pitch bend only for the remaining fractional
part. The onboard synth uses the computed JI cents directly, so its JI pitch
resolution is not limited by the `MPE Bend` setting.

Scala/cents-table tunings imported from the web app are loadable runtime
tunings. The firmware does not parse `.scl` text itself; the web app converts
the import to a `UserTuning` cents table, and the synth plus MIDI/MPE pitch
paths use that table when the tuning is applied.

Changing tuning also resets:

- Layout to the first saved layout linked to that tuning
- Scale to the first saved scale linked to that tuning
- Key to `C`

### Layout

Use this page to choose how pitch moves across the hex grid. After a tuning is
selected, factory and saved layouts linked to that tuning appear in a
GEM-style virtual list as flat entries. The active layout shows a diamond in
the left action-icon slot when it appears in the list.

Choosing a layout remaps button pitches, loads that layout's matching explicit
button map when one exists, and reloads that layout's default device
orientation: portrait layouts use `0`, and landscape layouts use `90`.
Only the active tuning's layout and scale names are cached. Changing tunings may
briefly pause while that bundle is loaded; subsequent layout/scale browsing does
not read the filesystem.

Layout rotation, flip, and display rotation controls live under `Editor`.

### Scale

Use this page to choose the active scale. After a tuning is selected, factory
and saved scales linked to that tuning appear in a GEM-style virtual list as
flat entries. The active scale shows a diamond in the left action-icon slot
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

`LED Limit` helps prevent power problems by lowering LED output when a bright setting would draw too much current. This matters most in bright modes such as `Filament` and `Diatonic`. `Off` leaves the LEDs uncapped and can cause resets at extreme brightness. The numbered limits use hardware-specific calibration tables for `V1.1` and `V1.2` boards. The factory default is `1.5 A`, calibrated to provide a similar actual USB-side draw on both hardware revisions and stable behavior on most power supplies.

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
tables use simpler ratios; higher-limit tables preserve the broader legacy
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
instead of the jack. When the buzzer is off, the piezo pin is held low; when the
jack is inactive, it stays centered at its PWM midpoint.

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

In `Poly`, playing more than `8` overlapping synth notes steals an existing
voice. HexBoard protects the lowest held note, then prefers to replace the
oldest duplicate note, the oldest released note still fading out, and finally
the oldest remaining held note. The stolen voice fades out over `64` audio
samples before the new note starts, which keeps dense playing from clicking.

`Porta` appears for the two mono modes. It sets the pitch-glide time from
`0 ms` through `4 s`. With `MonoRtg`, the envelope restarts but the pitch can
still glide. With `MonoLeg`, held note changes keep the envelope running and
use the selected glide time.

`Arp Speed` and `Arp Dir` appear for `Arp'gio`. The arpeggiator sorts by the
actual assigned note/frequency for `Up`, `Down`, `UpDown`, and `DownUp`; it can
also follow `Played`, `RevPlay`, or `Random` order. `Played` means the order in
which held notes were pressed, not the physical button numbers.

`WT:...` shows the currently loaded wavetable and opens a virtual load list.
Basic Shapes is the built-in rescue table. Supplied factory wavetables appear
in the root directory, while user-imported wavetables can be organized into
folders. All are ordinary editable files. The active
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
saved through the web app. New imports default to the `User` folder and are
uploaded to HexBoard so they can be heard on the hardware immediately. If a
preset references a wavetable that is not installed on the HexBoard, the synth
loads `Basic Shapes` instead until a matching folder/name wavetable is added.

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
`0 ms` to `4 s`, with extra points in the short and medium ranges for finer
synth shaping. Amp-envelope timing is smoothed across synth control ticks to keep
the synth responsive under heavy polyphony while preserving smooth fades.

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
`Editor` -> `Synth` both open synth preset load lists. `Save Preset` and the
preset load lists use synth-only preset libraries with room for up to `128`
device presets. Presets are stored separately from the main settings file as
named, foldered synth sounds. The device remembers which synth preset or
`Blank` state was last loaded, while the normal settings auto-save stores any
unsaved edits so the preset label can still show as modified after restart. On
the device, presets appear in a virtual folder browser; `New Preset` saves into
the currently open folder. The factory image includes its preset library as
ordinary editable records, including `Soft String Pad` under `Pads` and
`Bright Mono Lead` under `Leads`. They can be changed or erased like any other
preset. The web app shows the foldered library and can create foldered presets.
The load list also includes `Blank`. Loading from the top-level `Synth` item
returns to the main menu; loading or saving from `Editor` -> `Synth` returns to
`Synth`. Loading a preset changes only the current synth parameters and
wavetable reference, which can still be auto-saved by the normal settings
system. The currently loaded catalog preset shows a diamond in the left
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

### Settings

`Settings` contains MIDI setup, command-wheel behavior, and the `Advanced`
maintenance page.

#### MIDI

These controls set how HexBoard talks to external MIDI gear and music software.

Options include:

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

Most users can leave `MPE Mode` on `Auto`. Use `MPE Bend`, `MPE Low Ch`, and `MPE High Ch` when matching HexBoard to an MPE synth or plugin. `RolandMT32` and `GeneralMidi` send preset-selection messages for compatible external devices.

#### Control Wheel

These controls adjust how quickly the command-button wheels move and whether they snap back.

Options include:

- `Vel Wheel`
- `PB Wheel`
- `Mod Wheel`
- `Pitch Bend`: `Springy` or `Sticky`
- `Mod Wheel`: `Springy` or `Sticky`

Wheel speed choices run from `TooSlow`, `Turtle`, `Slow`, `Medium`, `Fast`,
`Cheetah`, and `VeryFast` to `Instant`. `Fast` is the previous `Medium` speed;
`TooSlow` is a new slower option. Factory defaults use `Medium` for all three
wheel speeds.

The onboard synth smooths pitch-bend wheel changes, phase-warp depth, and
vibrato depth internally so button-controlled bends and warp changes do not jump
as hard between command-wheel updates. External MIDI still receives the normal
pitch-bend and modulation messages.

### External Delegated Control

Some external software can temporarily take over HexBoard as a button-and-light surface. In that mode, normal playing, arpeggiation, control wheels, and built-in LED animations are paused while the host controls the surface.

Delegated control is only for compatible host software. It is not shown in the OLED menu, is not saved in profiles, and starts disabled every time HexBoard boots. Host-driven LEDs still respect `Brightness` and `LED Limit`.

Compatible hosts can assign delegated MIDI channel/note output per visible key.
If the host does not send a mapping, keys use the standard delegated
button-index encoding. These delegated assignments stay in RAM across delegated
LED updates and delegated enter/exit cycles. They reset on power cycle or host
reset.

When delegated mode starts, the OLED shows `Delegated Control Mode` and, when
provided by the host, the controlling app name. The normal menu is disabled.
Encoder turns and encoder button press/release events are sent to the host; the
saved `Invert Encoder` setting reverses the normal direction selected for the
detected hardware revision. The OLED
screensaver still blanks the display after inactivity and only encoder activity
wakes it again. Hold the encoder button for about `5` seconds to force HexBoard
out of delegated mode.

### Companion Web App

A browser-based HexBoard Sync app lives in this repository. It uses Web MIDI
SysEx to edit and sync tunings/layouts, color maps, explicit button maps, synth
presets, and user wavetables.

The app requires a Web MIDI SysEx-capable browser, usually Chrome or Edge, from
`localhost` or HTTPS. Use `Connect HexBoard` in the top bar. The app checks the
connected device's preset-sync support and connects automatically when exactly
one compatible HexBoard replies; a device selector appears when multiple
compatible boards are connected. The top tabs open `Tunings & Layouts` by
default, followed by `Synth Editor` and `Profiles`.

In the tuning/layout editor, you can create EDO tunings, equal-step tunings,
Scala `.scl` imports, vector layouts, scales, custom scale-degree colors, and
per-button pitch, color, direct-MIDI, or chord overrides. Work through `Library`, `Tuning`, `Layout`, and
`Scale & color` from left to right. `Library` provides the full-width computer
and HexBoard file-management view; the three editing steps keep the board
preview visible while their focused controls appear beside it. Sync and save
actions remain at the top of the geometry studio. The preview's `Paint keys`
tool can target either button color overrides or scale-degree palette colors
while `Custom` color mode is active. Painting a scale degree clears matching
button color overrides in the active layout so the palette color takes effect
immediately. Expand `Key inspector` to turn a key on or off, optionally override
its generated pitch, or change between its scale-degree color and a per-key
color. Shift-click selects a continuous range, while Control-click or
Command-click toggles individual keys; the bulk controls transpose or reset the
selection together. Selected keys use green rings around slightly smaller key
faces, the primary key used by the inspector has a gold ring, and the toolbar
reports the current selection count. Selection status and `Deselect All` live
in the layout-transform toolbar; clearing the selection disables its transform
buttons until another key is selected. The collapsed `Advanced output` section keeps ordinary
tuned-note editing simple while allowing a key to send a fixed MIDI note and
channel or a reusable chord shape of up to four tones. Chord intervals can use
the current tuning's steps or ordinary MIDI semitones. The inspector uses a visual color picker; derived layout step and scale
degree values are read-only facts, and cents-from-reference information is under
`Advanced pitch details`. `Reset all key overrides` restores the selected key to
the active layout and palette. Encoded object data is under the collapsed
`Developer details` panel.
The Layout sidebar contains the four-way `Device rotation` setting. Musical
layout edits live in the toolbar directly below the color-paint toolbar: `−1`
and `+1` transpose, counterclockwise/clockwise curved arrows, horizontal and
vertical mirror icons, and undo/redo. The gold primary key is the transform
center. With one key or all 133 playable keys selected, these controls rewrite
the generated layout and move all pitch, color, role, and action overrides with
it. With any smaller multi-selection, rotation, mirror, and transpose create or
move per-key overrides instead. Overrides temporarily moved beyond the visible
board are retained in the bundle and can return with undo or a later transform.
Horizontal and vertical mirror icons follow the displayed device orientation,
so their underlying grid axis changes at 90° and 270° device rotations. Undo
and redo also cover color-paint operations; one continuous pointer drag is one
history step. EDO
tunings are stored as an exact period divided by the selected division count;
the displayed decimal step size is informational and does not accumulate
rounding error across periods. Sync sends periods, fixed step sizes, Scala
intervals, and reference frequency at the firmware's native 32-bit floating-
point precision. Milli-cent and milli-hertz values remain in the object only
for compatibility with older firmware.
`Live send` previews compatible edits on the connected HexBoard without saving
them to flash. `Save to computer` stores the bundle in browser storage, and
`Save to HexBoard` writes the complete bundle, then applies its active tuning,
layout, scale, colors, and button map so the preview and device menu agree. The
saved bundle appears in the on-device `Tuning`, `Layout`, and `Scales`
browsers. HexBoard stores up to 64 complete geometry bundles; one tuning plus
its palette and all linked layouts/scales counts as one bundle. Tuning division
and scale-cycle lengths may be from 1 through 128. Saving or erasing a bundle
changes only that bundle's file; the other geometry bundles are not rewritten.
The editor's `Default color mode` selector is saved with each bundle and is
applied when that tuning loads. The supplied `12 EDO (Normal)` bundle defaults
to `Rainbow`.

In the Library step, drag bundle rows to reorder them. Computer Library order is
saved in the browser. Dragging HexBoard Library rows updates the device menu
order after a 2 second quiet period, so several quick drops produce one small
order-file flash write rather than rewriting geometry bundles.

Library folder rows begin with the visually distinct system views `All` and
`Root`, followed by user folders. New folders belong to the
computer library and stay available between sessions. An empty computer folder
can be deleted from the folder controls; move or erase its bundles first when it
is not empty. HexBoard folders are derived from the saved items on the device,
so a device folder disappears automatically after its last item is moved or
erased.

In the synth editor, you can manage synth presets and user wavetables. Presets
can be saved on the computer, uploaded to HexBoard, downloaded from HexBoard,
exported/imported as JSON, opened for audition, erased, and organized into
folders. Wavetables can be imported from Serum/Vital `.wav` files or HexBoard
`.hexwav` files, uploaded, downloaded, exported, renamed, moved, and selected
for the open preset. Short HexBoard `.hexwav` files with fewer than 16
512-sample frames are interpolated to the 16 frames the device uses.
Preset and wavetable libraries use the same `All` and `Root` system views.
Empty computer folders have explicit create and delete controls and persist
between browser sessions. The firmware-resident `Basic Shapes` fallback appears
in `Root` like the other root-level wavetables; its internal storage path is not
shown as a folder. New wavetable imports start in `Root` unless another folder
is selected.

`HexBoard Wavetables` is refreshed from the connected device; if a preset
references a computer-only wavetable, saving that preset to HexBoard offers to
upload the wavetable first.

Single live synth-parameter edits do not show the `MIDI SysEx` transfer screen,
do not mute audio, and are saved by the normal debounced auto-save path. Larger
object transfers, such as full preset saves or wavetable imports, show `MIDI
SysEx` on the HexBoard with the object type, upload/download direction, byte
count, percentage, and a progress bar. This includes large wavetable transfers
and complete geometry-bundle saves. Transfers that save to flash mute audio for
the transfer window and briefly pause normal menu/button/LED work while the
transfer is serviced.

### Transpose

`Transpose` shifts sounded pitch without changing the visual layout.

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
- Loading a slot immediately replaces the current setup, including the selected wavetable
- Saving stores the current setup, including the selected wavetable, in the chosen slot

#### Advanced

This page contains maintenance and system settings:

- `Firmware 2.0 beta 2` version label
- Hardware revision
- `Invert Encoder`: reverse the detected hardware revision's normal direction
- `ColorByKey`
- `DisplayNotes`: `Off`, `Label`, `Number`, or `MIDI`
- `Boot Anim`
- `Reset Defaults`
- `Update Firmware`
- `Serial Debug`
- `LED Test`

`ColorByKey` makes compatible color modes follow the selected key.

`Boot Anim` controls the startup LED animation. Turn it off for the fastest,
quietest visual boot.

`Serial Debug` opens a runtime-only submenu. Turn `Enabled` on to reveal message
categories: `General Log` controls the normal verbose firmware log, `Min Heap`
prints current/minimum free heap while the system runs normally, and `Audio Stats`
prints audio CPU for the last reporting window, the worst CPU reading since
Serial Debug was enabled, and audio underrun/overrun/max-block counters. These
debug choices are not saved to profiles and reset on reboot.

`LED Test` is temporary and is not saved in profiles. Enter it and scroll through `Red`, `Green`, `Blue`, or `White` to light every LED immediately. Leaving the selector snaps it back to `Off` and restores the normal LED display. This is useful for diagnosing LED health or for *very* harsh mood lighting.

## Saving Settings

HexBoard saves settings to onboard storage.

What to expect:

- Changes become ready to save immediately
- If `Auto-Save` is enabled, HexBoard saves after about `10 seconds` of inactivity
- Manual profile saves write immediately
- Flash writes briefly show `Saving to flash.` / `Audio muted.` on the OLED,
  fade audio down/up, hold the physical audio outputs idle while flash is busy,
  keep the save message visible for up to about `700 ms`, and return to
  the active menu, browser, or sleeping OLED state afterward
- Current synth preset and wavetable reference files are only rewritten when
  their stored value changes
- If a storage file is invalid, HexBoard briefly shows `Storage warning`, uses
  the safe fallback for that store, and continues starting. If LittleFS cannot
  mount, saving remains disabled for that boot
- Saving may mute the onboard synth very briefly

## Microtonal And MPE Behavior

HexBoard supports standard `12 EDO` and many non-12-EDO tunings. Depending on the tuning and menu settings, HexBoard may:

- Send normal single-channel MIDI
- Use multiple MIDI channels for wider note ranges
- Use MPE for microtonal pitch bends

In `Auto` mode, standard `12 EDO` generally stays in normal MIDI mode, while microtonal setups may switch to MPE automatically.

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
- Active synth preset: `Soft String Pad`
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
- Synth presets: `Soft String Pad` and `Bright Mono Lead` restored as editable slots
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
settings, presets, wavetables, layouts, samples, and sequences, then installs a
complete factory library. Use `HexBoard_Update.uf2` to update compatible 2.x
firmware without changing LittleFS.

Boot only mounts and reads LittleFS; it does not format, migrate, or create
factory files. If a saved store is invalid, the OLED briefly identifies the
affected file and the board continues with safe defaults. USB serial prints a
more detailed validation reason. If LittleFS cannot mount, the board uses its
minimal compiled 12 EDO geometry rescue bundle and Basic Shapes, and disables
saving. Normal factory geometry is read from independent `/geometry/*.hgb`
bundle files; only selected records are decoded into runtime RAM. Named synth
presets are also stored as independent `/presets/*.hsp` files, so saving one
preset does not rewrite the rest of the preset library.

How to update:

1. Plug your HexBoard into your computer.
2. Navigate to `Advanced` -> `Update Firmware` in the menu.
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

If HexBoard is powered by a computer that is asleep, closed, or otherwise not actively reading its USB MIDI port, the firmware keeps local scanning and synth playback responsive by dropping live USB MIDI packets after a short retry and backing off before trying that endpoint again. Open the computer, connect to an active MIDI host, use a powered hub, or use a battery bank if you need stable USB power without a live MIDI receiver.

### A tuning change reshuffled everything

That is expected. HexBoard resets layout, scale, and key to known-valid values when the tuning changes.
