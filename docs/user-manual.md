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
Set it to `Off`, `Label`, or `Number`. `Label` shows the active tuning's note
labels with octave numbers, including labels provided by user geometry objects.
Custom note labels are limited to `7` characters so they fit the on-device Key
selector. `Number` shows scale step and octave values such as `7.4`.

While the menu is visible, the top-right corner shows only the most recent held note. If the OLED screensaver is active, playing a note can wake a larger `Now Playing` display that shows up to `6` unique played notes from lowest to highest. Turning or pressing the encoder returns to the menu display. Recognized chord names appear near the bottom of that larger display only for `12 EDO`. `DisplayNotes` defaults to `Label`.

## Live Performance Controls

### Command Buttons

The seven reserved command buttons are split into three groups:

- Top group of `3`: velocity wheel controls
- Middle single button: toggles whether the bottom group controls modulation or pitch bend
- Bottom group of `3`: modulation or pitch-bend wheel controls

The wheel behavior depends on menu settings:

- `Springy`: returns to its default value when released
- `Sticky`: holds its last value

### Rotary Encoder

The encoder controls the OLED menu:

- Turn: move up or down in menus
- Press: confirm / enter
- Hold for about `2 seconds`: panic stop

The panic stop sends note-off style cleanup and clears active output. It is the fastest way to recover from stuck notes or a hung performance state.

## OLED Menu Overview

The main menu includes:

- `Tuning:<current>`
- `Layout:<current>`
- `Key`
- `Scale:<current>`
- `Scale Lock`
- `Synth:<current preset>`
- `Lights & Colors`
- `Transpose`
- `Options`
- `Load Profile`
- `Save Profile`
- `Synth Editor`

`Synth:<current preset>` opens the synth preset load menu from the top level.
If the runtime synth sound has changed since the loaded preset was selected or
saved, the preset name is shown with a leading `*`.
Rows that open virtual browsers, including tuning/layout/scale, synth preset,
and wavetable browsers, use the same right-side arrow cue as folder/submenu
rows. Inside those browsers, folders keep that right-side arrow and selectable
actions or entries use the action arrow. When the selector rests on one of
those launcher rows, long current names begin scrolling after `1.5` seconds and
advance one character every `250` ms. The final scroll position pauses for
`1` second before the name returns to the beginning and waits again. Scrolling
pauses while the played-note badge or full-screen played-note overlay is shown.

### Tuning

Use this section to choose the tuning or geometry bundle the whole board runs
on. The page is a GEM-style virtual list backed by geometry objects: factory
tunings appear at the root, and saved user tunings can be organized into
folders. Scrolling follows normal GEM list behavior, including page jumps at
the 11 visible-row boundary. Selecting a tuning also loads the first linked
layout, scale, color map, and matching explicit button map so the board is
immediately playable.

The Dynamic JI controls are temporarily not in this page while the menu layout
is being simplified for the 2.0 release.

`JI Table` selects the maximum prime limit used by Dynamic JI ratio matching:
`3Limit`, `5Limit`, `7Limit`, and higher options through `41Limit`. Lower-limit
tables use simpler ratios; higher-limit tables preserve the broader legacy
candidate set.

`Beat BPM` and `BPM Mult.` control the BPM-synced retuning grid and are hidden
when `JI BPM Sync` is off.

When MPE is active, Dynamic JI and JI BPM Sync send the closest MIDI note for
the final retuned pitch, then use pitch bend only for the remaining fractional
part. The onboard synth uses the computed JI cents directly, so its JI pitch
resolution is not limited by the `MPE Bend` setting.

Scala/cents-table tunings can be saved to HexBoard from the web app, but they
do not appear as loadable runtime tunings yet because firmware still needs
table-backed pitch lookup.

Changing tuning also resets:

- Layout to the first saved layout linked to that tuning
- Scale to the first saved scale linked to that tuning
- Key to `C`

### Layout

Use this page to choose how pitch moves across the hex grid. After a tuning is
selected, factory and saved layouts linked to that tuning appear in a
GEM-style virtual list as flat entries.

Choosing a layout remaps button pitches, loads that layout's matching explicit
button map when one exists, and reloads that layout's default device
orientation: portrait layouts use `0`, and landscape layouts use `90`.

The mirror and rotation editor controls are temporarily not in this page while
the menu layout is being simplified for the 2.0 release.

### Scale

Use this page to choose the active scale. After a tuning is selected, factory
and saved scales linked to that tuning appear in a GEM-style virtual list as
flat entries.

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

### Synth Editor

This page controls the onboard synth.

Options include:

- `Synth Mode`: `Off`, `MonoRtg`, `MonoLeg`, `Arp'gio`, `Poly`
- `Arp Speed` when `Arp'gio` is selected
- `Arp Dir` when `Arp'gio` is selected
- `Porta` when a mono mode is selected
- `WT:...` current-wavetable load menu
- `WT Pos`
- `Drive`
- `Wheel FX`
- `Wheel Amt`
- `Vib Speed`
- `Amp Atk`
- `Amp Hold`
- `Amp Dec`
- `Amp Sus`
- `Amp Rel`
- `FX Env 1`
- `FX Env 2`
- `LFO`
- `Tempo`
- `Metronome`
- `Time Sig`
- `Load Preset`
- `Save Preset`

On hardware `V1.1`, the onboard synth plays through the piezo buzzer when the
synth is active. There is no headphone-jack output path and no `Buzzer` menu
toggle.

On hardware `V1.2`, the headphone jack is active by default and an extra
`Buzzer` toggle appears. Turning `Buzzer` on switches synth output to the piezo
instead of the jack. When the buzzer is off, the piezo pin is held low; when the
jack is inactive, it stays centered at its PWM midpoint. The `Advanced` menu also
has `HP Vol Cap`, which limits only the headphone-jack output from `25%` to
`100%` in `5%` steps.

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
Built-in tables appear at the root, and user-imported wavetables can be
organized into folders.
Built-in compatibility tables include:

- `Basic Shapes`: sine, triangle, saw, and square anchors
- `Classic`: strings and clarinet anchors
- `Vowels`: the factory vowel wavetable
- `HarshDigitalBois`: bright or sync-like MP waves
- `RustyBlade`: buzzy and rough MP waves
- `RoundThe808`: rounded and 808-like MP waves
- `GlassyBells`: glassy and bell-like MP waves

Old presets that used the previous `Waveform` selector are migrated by choosing
one of these tables and setting `WT Pos` to the matching anchor. The old
`Hybrid` waveform now maps to `Basic Shapes` at `0%`.

User-imported wavetables appear in the same `WT:...` browser after they are
saved through the web app. If a preset references a wavetable that is not
installed on the HexBoard, the synth loads `Basic Shapes` instead until a matching
folder/name wavetable is added.

`WT Pos` chooses the starting frame for wavetable waveforms. On device, the menu
shows frames `1` through `16`; frame `1` is the first frame and frame `16` is
the last frame. Modulation can add to or subtract from this base position, so
setting `WT Pos` above frame `1` lets a negative envelope or LFO amount move
backward through the wavetable.

`Drive` adds soft saturation after the voices are mixed:

- `Off`: clean output, and the factory default
- `Warm`: a clear push that adds body
- `Edge`: obvious bite and clipping
- `Dirty`: stronger saturation for rougher synth tones

`Wheel FX` chooses how the mod wheel affects the onboard synth:

- `Vibrato`: adds pitch vibrato to the active synth voices
- `Pitch`: bends pitch up with the wheel or positive FX amounts, and down with negative FX amounts. Full-depth pitch modulation spans about `+/-24` semitones.
- `WT Pos`: scans the selected wavetable forward or backward from the base `WT Pos`
- `FoldWrp`: applies the original folded phase-warp color movement across the onboard waveforms
- `DutyWrp`: shifts the two halves of the oscillator cycle in opposite directions for a sharper duty-style phase warp
- `PolyWrp`: applies a smoother polynomial phase warp that bends most strongly inside each half-cycle

External MIDI still receives normal mod-wheel `CC 1` messages. `Vib Speed` sets
the onboard vibrato LFO speed from `1 Hz` to `12 Hz` for wheel or envelope
vibrato. `Wheel Amt` scales how strongly the mod wheel affects its target.

`LFO` opens the synth LFO page. `Target` uses the same targets as `Wheel FX`;
`Amount` is bipolar from `-100%` through `Off` to `+100%`; `Wave` selects
`Sine`, `Triangl`, `Saw`, or `Square`; and `Speed` ranges from `0.05 Hz` to
`20 Hz`, with extra slow choices below `1 Hz` for gradual wavetable or phase-warp
movement.

`Tempo` is shared by the arpeggiator and metronome. `Metronome` has four modes:

- `Off`: no metronome
- `Beep`: a short metronome beep on each beat through the active synth output
- `Bright`: strongly dims the LED frame between beats and returns toward the selected brightness on each beat
- `Side Btns`: the seven side command buttons flash green on the first beat and red on the other beats

`Time Sig` sets the metronome accent cycle and beat length. The first beat of
each measure is accented.

`Amp Atk`, `Amp Hold`, `Amp Dec`, `Amp Sus`, and `Amp Rel` shape the loudness of
each note. These five controls are often called the amp envelope.
Envelope time choices run from `0 ms` to `4 s`, with extra points in the short
and medium ranges for finer synth shaping. The longest envelope choices use
slightly coarser internal timing to keep the synth responsive under heavy
polyphony.

- `Attack`: how quickly the sound fades in after pressing a note
- `Hold`: how long the envelope stays at full level before decaying
- `Decay`: how quickly the first hit settles down to the held level
- `Sustain`: how loud the note stays while you keep holding it
- `Release`: how long the sound fades out after you let go

`FX Env 1` and `FX Env 2` open separate modulation-envelope pages. Each page has
`Target`, `Amount`, `Attack`, `Hold`, `Decay`, `Sustain`, and `Release`.

`Target` chooses `Vibrato`, `Pitch`, `WT Pos`, `FoldWrp`, `DutyWrp`, or
`PolyWrp`. The wheel, both FX envelopes, and the LFO can choose the same target;
their amounts add together and clamp at the maximum effect depth instead of
replacing each other.

`Amount` controls how strongly the envelope affects the target. Positive amounts
push the target in one direction; negative amounts use the same AHDSR shape and
push the target in the opposite direction. Pitch, phase warp, and wavetable position
return smoothly to their base values as the FX envelope falls back to zero. Negative
`Vibrato` is different: vibrato is the resting sound, and the envelope pulls it
down as the envelope level rises. The default FX envelope times are `0 ms`, and
default sustain is `0%`, so the FX envelopes do nothing until you shape them.

The top-level `Synth:<preset>` item and the `Load Preset` item inside
`Synth Editor` both open synth preset load lists. `Save Preset` and
`Load Preset` use synth-only preset libraries with room for
up to `128` device presets. Presets are stored separately from the main settings
file as named, foldered synth sounds and do not remember which preset was last
loaded. On the device, presets appear in a virtual folder browser; `New Preset`
saves into the currently open folder. Factory presets are copied into normal
editable root-folder preset slots
when defaults are restored, so they can be changed or erased like any other
preset and restored later by Reset Defaults or from the web editor's browser
library. The web app still shows the foldered library and can create foldered
presets.
`Load Preset` also includes `Blank`. Loading from the top-level `Synth` item
returns to the main menu; loading or saving from `Synth Editor` returns to
`Synth Editor`. Loading a preset changes only the current synth parameters and
wavetable reference, which can still be auto-saved by the normal settings
system.

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

### Options

`Options` contains MIDI setup, command-wheel behavior, and the `Advanced`
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
saved `Invert Encoder` setting still controls turn direction. The OLED
screensaver still blanks the display after inactivity and only encoder activity
wakes it again. Hold the encoder button for about `5` seconds to force HexBoard
out of delegated mode.

### Companion Web App

A browser-based HexBoard Sync app is being developed in this repository. Its
first target is preset, tuning/layout, color-map, button-map, and synth-preset
editing over Web MIDI SysEx. Firmware currently implements synth preset sync,
named synth-wavetable import/read/write/delete, storage/list/read/write/delete for user
geometry objects in `/layouts.dat`, read-only factory tuning/layout/scale
geometry objects, virtual on-device `Tuning`, `Layout`, and `Scales` browsers
backed by geometry objects, and live Apply for generated
EDO/equal-step geometry bundles. Scala/cents-table tuning objects can be saved
and verified, but live Scala playback still needs a broader firmware
tuning-system overhaul.

The `Tunings & Layouts` tab is a browser-side musical geometry editor. It saves
geometry bundles in browser storage and can import/export those bundles as JSON.
Each bundle contains one tuning, one custom scale-degree color palette, one
default color mode, one or more layouts, and one or more scales. `Custom`
uses the bundle's scale-degree palette; the other default color mode choices
preview the same generated hues as the device menu at full brightness and apply
the corresponding generated modes on the device. The active
layout still starts from an across/up-right vector, and the center key can be
chosen from the visual board or typed by button index. The editor places a
left sidebar beside the preview using the same left-to-right proportions as the
synth preset editor. At the top of `Geometry Bundles`, `File Manager` contains
the foldered `Computer Library` and `HexBoard Library` sections, while `Editor`
contains bundle metadata plus the `Tuning`, `Layouts`, and `Scales` subtabs for
the open bundle. In `Editor`, `Live send` previews compatible EDO/equal-step
bundle edits on the connected device's runtime without saving them to flash.
`Save to Computer` stores the bundle in browser storage, while `Save to
HexBoard` writes the bundle's user tuning, layouts, scales, color map, and
explicit button map into the selected folder on the device. The HexBoard
library lists factory and saved tuning entries by folder because firmware
stores the unpacked geometry objects rather than a single editable bundle
object. Factory entries are read-only: they can be opened, downloaded, and
exported as bundle JSON, but the web app disables erase for them. Saved user
entries can also be erased from the device. On the device, the tuning appears
under `Tuning`, its linked layouts appear under `Layout` after that tuning is
selected, and its linked scales appear under `Scales`; the device browser keeps
factory and saved entries flat. The larger HexBoard preview plus selected-key
inspector stay on
the right, with the selected-key
inspector below the board. The encoded-object debug
readout sits at the bottom of the editor page. The rotation control is a
four-step device orientation preview: `0`, `90`, `180`, or `270` degrees. It is
intended to line up with the firmware `Device Rot` setting, not to rotate the
musical axes around individual hexagons. Focusing the center, across, or
up-right layout fields highlights the relevant preview key relationship. The
axis field labels follow the four-way preview rotation; for example, at `90`
degrees, across is shown as `Down` and up-right is shown as `Down-right`.
The preview toolbar includes the bundle-level default color mode selector.
When that mode is `Custom`, the preview also has a `Paintbrush` mode: choose a
brush color, enable the tool, then click or drag across keys to write manual
per-button color overrides without selecting each key in the inspector. The
`Eyedropper` tool temporarily overrides the paintbrush so the
next preview key clicked becomes the brush color. `Reset Colors` asks for
confirmation, then clears all per-button color overrides in the active layout
so keys return to their scale-degree colors while note and role overrides stay
unchanged. Preview hexagons render with solid, full-bright color fills and outlined white labels
so the displayed hue remains accurate and readable. A sun/moon button in the app header switches the web app between
light and dark themes. When a compatible bundle is applied to HexBoard, `Custom`
scale-degree colors and Custom-mode per-button colors use the selected color as the
active/play target, but the resting hardware LEDs are capped to the same normal
brightness level used by generated modes such as `Rainbow` so animations have
brighter headroom.

The tuning editor can create EDO tunings, equal cents-per-step tunings, and
Scala `.scl` imports. EDO and cents-per-step tunings include editable note
labels and an `A = x Hz` reference pitch; note labels default to an A-first
pitch-label sequence and validate like included degrees when the field is exited. The cents-per-step
editor takes only step size and cycle length; its period is derived from those
two fields. Scala import derives period, cycle length, labels, and reference
pitch from the imported file path as support is added, so the Scala editor does
not expose those fields. Scala text is parsed in the web app and stored in the
bundle as cents data, but full Scala playback and sync compatibility still
require firmware tuning-system work. The preview uses the current `133` note-key
hardware shape and omits the seven command buttons so geometry editing stays
focused on playable notes. The selected-key inspector shows the resolved note
label, A4-relative step/cents offset, and frequency for the selected key, and has a `Color source` dropdown:
`Scale degree` edits the palette color for the generated degree, while
`Button override` edits only the selected button's color and is available only
when the default color mode is `Custom`. `Note source` can
lock an individual button to a fixed `steps from C` value; those manual note
positions are meant to stay fixed when root note or transposition changes.
Scales are edited as included scale degrees only. `All Notes` is always present
as the default scale, always includes every degree for the current division
count, and cannot be edited or deleted. The included-degrees field can
hold incomplete text while typing; if it still contains invalid text when focus
leaves the field, the editor marks it red and reports the validation error.
Button roles can be marked as note or unused in the exported web model. Applying
a compatible bundle sends the active tuning, active layout, active scale,
scale-degree color map, and active layout's explicit button map to the live
runtime. Saving to HexBoard stores all bundle objects in `/layouts.dat` and
rebuilds the on-device geometry menus.

The synth preset editor includes preset name/folder selection, a wavetable
folder/name selector, Drive and AHDSR sliders, FX envelope AHDSR controls, mono
portamento, arpeggiator direction/speed/tempo, and other main synth parameter
controls. The synth library has a top selector for `Presets` and `Wavetables`.
Both views have a `Computer Library` for browser-saved/imported items and a
`HexBoard Library` loaded from the connected device through SysEx.

In `Presets`, items can be opened, erased, exported as JSON files, imported
from JSON files, uploaded to HexBoard, downloaded back to the computer library,
refreshed from the device, and dragged between library areas or into folder
targets. Folder buttons filter each library area; clicking the active folder
again clears the filter and shows all presets in that area.

In `Wavetables`, imported or downloaded tables can be uploaded to HexBoard,
downloaded to the computer library, exported as `.hexwav` wavetable files,
renamed, moved to a different folder, erased, or selected with `Use` for the
open preset. Refreshing the HexBoard wavetable list reads only device metadata;
full sample data transfers start only when `Download` or `Export` is chosen.
Those explicit wavetable reads are large chunked transfers, and HexBoard streams
the sample file during the transfer instead of preloading the whole object first.
The browser wavetable library is also seeded with the same factory built-in
tables that ship in firmware flash. `Basic Shapes` and `Classic` are rendered
from firmware anchor waves, and the other factory tables are rendered from the
default wavetable WAV sources. These factory tables use `16`-frame bases plus
the same six fixed mip levels as imported wavetables, so they can be previewed,
exported, edited, uploaded, or restored through the web editor like normal
wavetable entries.
The web app trims preset and wavetable names/folders to the device's fixed text
fields before upload so long browser-side labels do not break transfers.
Presets store the wavetable folder/name rather than a private copy of the
wavetable data, so a shared preset that needs a third-party table will work once
a wavetable with the same folder and name is installed on the HexBoard.

When the Synth Presets tab opens with a HexBoard input connected, the editor
requests the current HexBoard synth patch instead of sending one of the browser
sample presets. Choosing `Open` on a preset loads it onto the HexBoard
immediately for auditioning. When `Live send` is on, later editor changes are
sent as apply-only preset-sync messages over the active MIDI transport; they are
temporary, including name and folder changes, and are not immediate flash
saves. `Save to Computer` and `Save to HexBoard` create a new preset when the
folder/name is unique. If the target library already has the same folder/name,
the app asks before overwriting that preset. Device saves wait for the HexBoard
to acknowledge the write through the flash commit before the app refreshes the
`HexBoard Library`.

`Import Wavetable` is in the `Wavetables` library view. It opens an import
dialog with a file-type selector for Serum/Vital `.wav` tables or HexBoard
`.hexwav` tables. Serum/Vital imports read the source frames and render the
table down to the firmware's `16 x 512` base table, then build six fixed
`512`-sample mip levels with harmonic limits `192`, `96`, `48`, `24`, `12`, and `6`.
HexBoard `.hexwav` files are 8-bit mono WAV containers that contain either this
full fixed-mip table or an older base-only table that the app upgrades on
import.
The import dialog always stages the selected file into a waveform preview
before committing it; the frame slider chooses which rendered frame is shown
and the mip slider chooses which stored level is shown.
The `Import` button at the bottom saves the previewed table. Serum/Vital
conversion options include nearest or interpolated frame reduction, per-frame
or whole-table normalization, a Smooth checkbox that softens each rendered
frame, and optional dither. `.hexwav` imports preview the stored HexBoard
sample data, so those conversion controls are disabled for that file type.
Imported tables are saved by the selected name/folder in the browser wavetable
library, uploaded to HexBoard, and used by the open preset with `WT Pos = 0`.

The HexBoard stores named wavetable references separately from the byte-oriented
settings data. Rebooting, loading a preset, or loading a saved profile restores
the expected folder/name wavetable instead of falling back to `Basic Shapes`.

The app requires a Web MIDI SysEx-capable browser such as Chrome or Edge running
from `localhost` or HTTPS. Use `Connect HexBoard` in the top bar; the app sends
the preset-sync hello inquiry, checks the returned protocol and synth preset
schema, and connects automatically when one compatible HexBoard replies. A
device selector appears only when multiple compatible HexBoards are connected.
Live parameter editing can work with output only, but loading the current patch
and reading the `HexBoard Library` require the matching input port that receives
HexBoard SysEx replies.

Single synth-parameter edits from the web editor are sent as compact live
updates. They do not show the `MIDI SysEx Transfer` screen, do not pause
button/LED/menu work, and are marked for the normal debounced auto-save path
the same way on-device synth menu edits are. They only restart active synth
notes for parameters whose matching on-device menu control also restarts notes,
such as `Synth Mode`.

While a chunked preset-sync SysEx object transfer is active, such as opening or
saving a full preset or importing a wavetable, the HexBoard display shows
`MIDI SysEx Transfer` and pauses normal menu/button/LED work while it services
incoming MIDI. The message clears when the transfer is idle or times out. If the
OLED screensaver was already active, HexBoard returns to that dimmed/cleared
state after the transfer instead of waking the menu.

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
`TooSlow` is a new slower option.

The onboard synth smooths pitch-bend wheel changes, phase-warp depth, and
vibrato depth internally so button-controlled bends and warp changes do not jump
as hard between command-wheel updates. External MIDI still receives the normal
pitch-bend and modulation messages.

### Transpose

`Transpose` shifts sounded pitch without changing the visual layout.

### Load Profile And Save Profile

HexBoard supports `9` profile slots:

- `Boot/Auto-Save Slot`
- `Slot 1`
- `Slot 2`
- `Slot 3`
- `Slot 4`
- `Slot 5`
- `Slot 6`
- `Slot 7`
- `Slot 8`

How it behaves:

- Auto-save always snapshots the current setup back into the `Boot/Auto-Save Slot`
- Loading a slot immediately replaces the current setup, including the selected wavetable
- Saving stores the current setup, including the selected wavetable, in the chosen slot

#### Advanced

This page contains maintenance and system settings:

- `Firmware 1.4 alpha` version label
- Hardware revision
- `Invert Encoder`
- `ColorByKey`
- `DisplayNotes`: `Off`, `Label`, or `Number`
- `Boot Anim`
- `HP Vol Cap` on hardware `V1.2`
- `Reset Defaults`
- `Update Firmware`
- `Serial Debug`
- `Stability`
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

`Stability` launches a temporary benchmark and is not saved in profiles. It
loads a worst-case runtime synth patch, starts eight high notes, forces regular
voice steals, sweeps modulation and pitch bend, keeps LEDs/display/menu/sync
services running, and shows live underrun, audio-overrun, minimum-free-heap, max
audio-block time, and last Core 0/Core 1 task labels. Hold the encoder button
for about `5` seconds to exit. If runtime `Serial Debug` was enabled when the
benchmark started, normal debug category output is suppressed during the run and
compact benchmark status/summary lines are sent instead.

`LED Test` is temporary and is not saved in profiles. Enter it and scroll through `Red`, `Green`, `Blue`, or `White` to light every LED immediately. Leaving the selector snaps it back to `Off` and restores the normal LED display. This is useful for diagnosing LED health or for *very* harsh mood lighting.

## Saving Settings

HexBoard saves settings to onboard storage.

What to expect:

- Changes become ready to save immediately
- If `Auto-Save` is enabled, HexBoard saves after about `10 seconds` of inactivity
- Manual profile saves write immediately
- Flash writes briefly show `Saving` / `Writing flash` / `Audio muted` on the
  OLED, fade audio down/up so the required flash-write mute is less abrupt, and
  return to the active menu or browser afterward
- If saved settings cannot be read, HexBoard restores factory defaults
- This release also resets older settings-schema files to factory defaults
- Saving may mute the onboard synth very briefly

## Microtonal And MPE Behavior

HexBoard supports standard `12 EDO` and many non-12-EDO tunings. Depending on the tuning and menu settings, HexBoard may:

- Send normal single-channel MIDI
- Use multiple MIDI channels for wider note ranges
- Use MPE for microtonal pitch bends

In `Auto` mode, standard `12 EDO` generally stays in normal MIDI mode, while microtonal setups may switch to MPE automatically.

For DAW, plugin, and hardware synth setup, including pitch-bend range matching and channel-zone examples, see `docs/mpe-microtonal-setup.md`.

## Factory Defaults

Important factory defaults include:

- Tuning: built-in `12 EDO`
- Layout: first built-in 12-EDO layout
- Device Rot: `0`
- Scale: chromatic / none
- MIDI channel: `1`
- MPE mode: `Auto`
- Synth: `Poly`
- Wavetable: `Basic Shapes`
- WT Pos: frame `1`
- Drive: `Off`
- Wheel FX: `FoldWrp`
- Wheel Amt: `100%`
- Vibrato speed: `6 Hz`
- Amp Hold: `0 ms`
- FX Env 1: `Vibrato`, `+100%`, `0 ms` attack, `0 ms` hold, `0 ms` decay, `0%` sustain, `0 ms` release
- FX Env 2: `Pitch`, `+100%`, `0 ms` attack, `0 ms` hold, `0 ms` decay, `0%` sustain, `0 ms` release
- Synth presets: `Soft String Pad` and `Bright Mono Lead` restored as editable slots
- Boot animation: `On`
- Metronome: `Off`
- Time signature: `4/4`
- LED brightness: `Dim`
- LED limit: `Off`
- Animation: `Button`
- Display notes: `On`
- Auto-save: `On`

## Updating Firmware

How to update:

1. Plug your HexBoard into your computer.
2. Navigate to `Advanced` -> `Update Firmware` in the menu.
3. The HexBoard will show up as a USB drive.
4. Drag the `.uf2` file onto the drive.
5. The HexBoard will automatically reboot with the new firmware.

Need a backup method?

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
