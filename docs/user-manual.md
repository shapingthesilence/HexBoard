# HexBoard User Manual

## What HexBoard Is

HexBoard is a 140-button hexagonal MIDI controller and instrument. It can act as:

- A USB and serial MIDI controller
- A microtonal and isomorphic keyboard
- A standalone synth with mono, polyphonic, and arpeggiated playback
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

The `DisplayNotes` option in `Advanced` can show a temporary `Now Playing` overlay on the OLED while notes are held. In `12 EDO`, notes display as names such as `C4` or `Eb5`. In other tunings, notes display as step-and-octave values such as `7.4`.

The overlay shows up to `6` unique played notes from lowest to highest, gives wider microtonal labels a little more room, stays visible briefly after release, and can temporarily wake the OLED from screensaver dimming. In `12 EDO`, recognized chord names appear near the bottom of the OLED. It is on by default.

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

- `Tuning`
- `Layout`
- `Scales`
- `Color Options`
- `Synth Options`
- `MIDI Options`
- `Control Wheel`
- `Transpose`
- `Save`
- `Load`
- `Advanced`

### Tuning

Use this section to choose the pitch system the whole board runs on.

You can change:

- The active tuning
- `Dynamic JI`
- `JI BPM Sync`
- `Beat BPM`
- `BPM Mult.`

Changing tuning also resets:

- Layout to the first valid layout for that tuning
- Scale to chromatic / none
- Key to `C`

### Layout

Use this page to change how pitch moves across the hex grid.

Options include:

- Layout choice
- `Mirror Ver.`
- `Mirror Hor.`
- `Rotate`

Changing layout remaps button pitches. The screen orientation may also change to match the selected layout.

### Scales

Use this page to constrain the playable notes and recolor the surface.

Options include:

- Key
- `Scale Lock`
- Scale selection

When `Scale Lock` is enabled, out-of-scale notes stop responding to presses.

### Color Options

This page controls LED appearance.

Options include:

- `Color Mode`
- `Brightness`
- `LED Limit`
- `Animation`
- `Rest Bright`
- `Dim Bright`

Available color modes are `Rainbow`, `Tiered`, `Alt`, `Fifths`, `Piano`, `Alt Piano`, `Filament`, and `Diatonic`. The animation list includes button, octave, by-note, star, splash, orbit, beams, reversed variants, and MIDI-in highlighting.

`LED Limit` helps prevent power problems by lowering LED output when a bright setting would draw too much current. This matters most in bright modes such as `Filament` and `Diatonic`. `Off` leaves the LEDs uncapped and can cause resets at extreme brightness. The factory default is `1.5 A`, which is stable on most power supplies.

### Synth Options

This page controls the onboard synth.

Options include:

- `Synth Mode`: `Off`, `Mono`, `Arp'gio`, `Poly`
- `Waveform`
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
- `Presets`
- `Arp Speed`
- `Tempo`
- `Metronome`
- `Time Sig`

On hardware `V1.1`, the onboard synth plays through the piezo buzzer when the
synth is active. There is no headphone-jack output path and no `Buzzer` menu
toggle.

On hardware `V1.2`, the headphone jack is active by default and an extra
`Buzzer` toggle appears. Turning `Buzzer` on adds the piezo on top of the jack
output.

#### Synth Terms In Plain Language

The onboard synth is a simple sound generator inside HexBoard. It is separate
from MIDI output, so you can use the onboard synth, external MIDI gear, or both.
Turning the synth `Off` does not disable external MIDI. The onboard synth follows
HexBoard's tuning directly; MPE settings are for external MIDI receivers.

`Synth Mode` chooses how notes are played:

- `Off`: no onboard synth sound
- `Mono`: one note at a time, useful for lead lines
- `Arp'gio`: cycles through held notes rhythmically
- `Poly`: plays chords, up to `8` notes at a time - a bit quieter due to headroom needed

`Waveform` is the basic tone color before the volume shape is applied:

- `Sine`: soft, round, clean
- `Triangl`: mellow, but a little clearer than sine
- `Square`: hollow, buzzy, game-like
- `Saw`: bright, edgy, brassy
- `Hybrid`: general-purpose default that changes character across pitch ranges
- `Strings`: smoother, string-like color
- `Clrinet`: reed-like, nasal color

`Drive` adds soft saturation after the voices are mixed:

- `Off`: clean output, and the factory default
- `Warm`: a clear push that adds body
- `Edge`: obvious bite and clipping
- `Dirty`: stronger saturation for rougher synth tones

`Wheel FX` chooses how the mod wheel affects the onboard synth:

- `Tone`: sweeps pulse width on `Square` and adds phase-warp color to the other waveforms
- `Vibrato`: adds pitch vibrato to the active synth voices
- `Pitch`: bends pitch up with the wheel or positive FX amounts, and down with negative FX amounts

External MIDI still receives normal mod-wheel `CC 1` messages. `Vib Speed` sets
the onboard vibrato LFO speed for wheel or envelope vibrato. `Wheel Amt` scales
how strongly the mod wheel affects its target.

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
and medium ranges for finer synth shaping.

- `Attack`: how quickly the sound fades in after pressing a note
- `Hold`: how long the envelope stays at full level before decaying
- `Decay`: how quickly the first hit settles down to the held level
- `Sustain`: how loud the note stays while you keep holding it
- `Release`: how long the sound fades out after you let go

`FX Env 1` and `FX Env 2` open separate modulation-envelope pages. Each page has
`Target`, `Amount`, `Attack`, `Hold`, `Decay`, `Sustain`, and `Release`.

`Target` chooses `Tone`, `Vibrato`, or `Pitch`. The wheel and both FX envelopes
can choose the same target; their amounts add together and clamp at the maximum
effect depth instead of replacing each other.

`Amount` controls how strongly the envelope affects the target. Positive amounts
push the target in one direction; negative amounts use the same AHDSR shape and
push the target in the opposite direction. Pitch and tone return smoothly to the
played note and base tone as the FX envelope falls back to zero. The default FX
envelope times are `0 ms`, and default sustain is `0%`, so the FX envelopes do
nothing until you shape them.

`Presets` opens synth-only save/load slots. Presets are stored separately from
the main settings file and do not remember which preset was last loaded. Loading
a preset changes the current synth parameters, which can still be auto-saved by
the normal settings system.

Short `Attack` feels immediate. Long `Attack` fades in. `Hold` keeps the initial
peak longer before decay. Low `Sustain` makes a note fade away even while you
hold it. High `Sustain` keeps the note steady. Short `Release` stops quickly.
Long `Release` leaves a tail after release.

#### Beginner Synth Recipes

Use these as starting points, then adjust by ear.

| Sound | Synth Mode | Waveform | Attack | Hold | Decay | Sustain | Release | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Plucky | `Poly` or `Mono` | `Hybrid`, `Triangl`, or `Sine` | `0 ms` or `5 ms` | `0 ms` | `50 ms` to `200 ms` | `0%` or `10%` | `50 ms` to `200 ms` | Fast start, quick fade, little held level |
| Smooth pad | `Poly` | `Sine`, `Triangl`, or `Strings` | `200 ms` to `1 s` | `0 ms` | `500 ms` to `1 s` | `75%` or `100%` | `500 ms` to `2 s` | Slow fade-in and long release |
| Lead | `Mono` | `Hybrid`, `Saw`, or `Square` | `0 ms` or `10 ms` | `0 ms` to `50 ms` | `50 ms` to `200 ms` | `75%` or `100%` | `50 ms` to `200 ms` | Immediate and steady for melodies |
| Chime or bell | `Poly` | `Sine` or `Triangl` | `0 ms` or `5 ms` | `0 ms` | `500 ms` to `1 s` | `0%` | `500 ms` to `2 s` | Rings out after the initial hit |
| Arpeggio | `Arp'gio` | `Hybrid`, `Square`, or `Saw` | `0 ms` or `5 ms` | `0 ms` | `50 ms` to `200 ms` | `0%` to `25%` | `20 ms` to `100 ms` | Use `Arp Speed` and `Tempo` for rhythm |

For a sharper sound, use a brighter waveform such as `Saw`, `Square`, or
`Hybrid`, and keep `Attack` short. For a smoother sound, use `Sine`,
`Triangl`, or `Strings`, then increase `Attack` and `Release`.

If a sound feels too clicky, raise `Attack` one step. If notes smear together,
lower `Release`. If a pluck does not fade away enough, lower `Sustain` or lower
`Decay`. If a held note disappears too quickly, raise `Decay`.

To add motion without touching the mod wheel, put one FX envelope on a short
transient and leave the wheel on the effect you want under your hand. For
example, `Wheel FX` = `Tone`, `FX Env 1 Target` = `Vibrato`, `Amount` = `+50%`,
`Decay` around `100 ms`, and `Sustain` = `0%` adds a short vibrato chirp at the
start of each note. For a falling pitch tail, try `FX Env 2 Target` = `Pitch`,
`Amount` = `-25%`, `Sustain` = `100%`, and a longer `Release`.

### MIDI Options

This page controls how HexBoard talks to external MIDI gear and music software.

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

### Control Wheel

This page adjusts how quickly the command-button wheels move and whether they snap back.

Options include:

- `Vel Wheel`
- `PB Wheel`
- `Mod Wheel`
- `Pitch Bend`: `Springy` or `Sticky`
- `Mod Wheel`: `Springy` or `Sticky`

The onboard synth smooths pitch-bend wheel changes, pulse-width modulation, and
vibrato depth internally so button-controlled bends and tone changes do not jump
as hard between command-wheel updates. External MIDI still receives the normal
pitch-bend and modulation messages.

### Transpose

`Transpose` shifts sounded pitch without changing the visual layout.

### Save And Load

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
- Loading a slot immediately replaces the current setup
- Saving stores the current setup in the chosen slot

### Advanced

This page contains maintenance and system settings:

- Firmware version
- Hardware revision
- `Invert Encoder`
- `ColorByKey`
- `DisplayNotes`
- `Boot Anim`
- `Reset Defaults`
- `Update Firmware`
- `Serial Debug`
- `ISR Profile`
- `LED Test`

`ColorByKey` makes compatible color modes follow the selected key.

`Boot Anim` controls the startup LED animation. Turn it off for the fastest,
quietest visual boot.

`ISR Profile` is a temporary diagnostic toggle and is not saved in profiles. To measure audio interrupt timing, leave `Serial Debug` on, turn `ISR Profile` on, play the scenario you want to test, then turn `ISR Profile` off. HexBoard logs `min/avg/max/count` timing, overrun count, and context for the slowest captured audio ISR sample.

`LED Test` is temporary and is not saved in profiles. Enter it and scroll through `Red`, `Green`, `Blue`, or `White` to light every LED immediately. Leaving the selector snaps it back to `Off` and restores the normal LED display. This is useful for diagnosing LED health or for *very* harsh mood lighting.

## Saving Settings

HexBoard saves settings to onboard storage.

What to expect:

- Changes become ready to save immediately
- If `Auto-Save` is enabled, HexBoard saves after about `10 seconds` of inactivity
- Manual profile saves write immediately
- If saved settings cannot be read, HexBoard restores factory defaults
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

- Tuning: `12 EDO`
- Layout: first 12-EDO layout
- Scale: chromatic / none
- MIDI channel: `1`
- MPE mode: `Auto`
- Synth: `Off`
- Waveform: `Hybrid`
- Drive: `Off`
- Wheel FX: `Tone`
- Wheel Amt: `100%`
- Vibrato speed: `6 Hz`
- Amp Hold: `0 ms`
- FX Env 1: `Vibrato`, `+100%`, `0 ms` attack, `0 ms` hold, `0 ms` decay, `0%` sustain, `0 ms` release
- FX Env 2: `Pitch`, `+100%`, `0 ms` attack, `0 ms` hold, `0 ms` decay, `0%` sustain, `0 ms` release
- Synth presets: empty until saved
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

That usually means the LED draw is too high for the current power source. Lower `Brightness`, lower `Rest Bright`, or (most importantly) set `LED Limit` in `Color Options` to a safer value such as `500 mA`, `1.0 A`, or the factory-default `1.5 A`.

### A tuning change reshuffled everything

That is expected. HexBoard resets layout, scale, and key to known-valid values when the tuning changes.
