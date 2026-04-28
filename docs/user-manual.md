# HexBoard User Manual

## What HexBoard Is

HexBoard is a 140-button hexagonal MIDI controller built around an RP2040. The firmware in `src/HexBoard.ino` lets the board act as:

- A USB and serial MIDI controller
- A microtonal and isomorphic keyboard
- A standalone synth with mono, polyphonic, and arpeggiated playback
- A visual performance surface with per-key LEDs, animations, scales, and color modes

This manual focuses on how to use the current firmware, not how to modify it.

## Basic Hardware Layout

The firmware treats the surface as:

- `133` musical note buttons
- `7` dedicated command buttons in the offset bottom-left column area
- `1` rotary encoder with push switch
- `1` monochrome OLED menu display
- `140` LEDs, one per button

The seven command buttons are reserved by the firmware for live control rather than note entry.

## Power-Up And Normal Operation

On boot, the firmware:

1. Starts USB MIDI
2. Waits briefly for USB enumeration before flash access
3. Mounts the onboard LittleFS file system
4. Detects the hardware revision
5. Loads saved settings and profiles
6. Builds the OLED menu
7. Applies the active tuning, layout, scale, LED state, MIDI routing, and synth settings
8. Runs the boot LED self-check and fades into the normal resting LED state

If no valid settings file is found, or if the settings file fails version or CRC validation, the board restores factory defaults and creates a fresh settings file.

When an existing settings file is present, normal startup runs a smooth rainbow splash.

On first boot, when `/settings.dat` is missing, the board first fades all LEDs into a moderate white diagnostic level and holds it for about `2 seconds` before the splash. This makes missing pixels, weak LEDs, or uneven white balance easier to spot after flashing a fresh board.

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

The overlay shows up to `6` unique played notes, gives wider microtonal labels a little more room, stays visible briefly after release, and can temporarily wake the OLED from screensaver dimming. If you are using the onboard synth and want the smoothest sound, leave `DisplayNotes` off. It is off by default.

## Live Performance Controls

### Command Buttons

The seven reserved command buttons are split into three groups:

- Bottom group of `3`: velocity wheel controls
- Middle single button: toggles whether the top group controls modulation or pitch bend
- Top group of `3`: modulation or pitch-bend wheel controls

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

The main menu is built from these sections:

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

Changing layout remaps button pitches and refreshes the display rotation.

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

`LED Limit` applies a brightness cap after the frame is rendered. In bright modes, especially `Filament` and `Diatonic`, the board may dim the whole frame slightly instead of trying to drive every LED at full requested power. `Off` leaves the LEDs fully uncapped which *will* cause crashes/brownouts at the most extreme settings. The numbered limits are calibrated to keep power draw under the stated value. The factory default is `1.5 A`, which is stable on most power supplies.

### Synth Options

This page controls the onboard synth.

Options include:

- `Synth Mode`: `Off`, `Mono`, `Arp'gio`, `Poly`
- `Waveform`
- `Attack`
- `Decay`
- `Sustain`
- `Release`
- `Arp Speed`
- `Arp BPM`

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

`Attack`, `Decay`, `Sustain`, and `Release` shape the loudness of each note.
These four controls are often called the envelope.

- `Attack`: how quickly the sound fades in after pressing a note
- `Decay`: how quickly the first hit settles down to the held level
- `Sustain`: how loud the note stays while you keep holding it
- `Release`: how long the sound fades out after you let go

Short `Attack` feels immediate. Long `Attack` fades in. Low `Sustain` makes a
note fade away even while you hold it. High `Sustain` keeps the note steady.
Short `Release` stops quickly. Long `Release` leaves a tail after release.

#### Beginner Synth Recipes

Use these as starting points, then adjust by ear.

| Sound | Synth Mode | Waveform | Attack | Decay | Sustain | Release | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Plucky | `Poly` or `Mono` | `Hybrid`, `Triangl`, or `Sine` | `0 ms` or `5 ms` | `50 ms` to `200 ms` | `0%` or `10%` | `50 ms` to `200 ms` | Fast start, quick fade, little held level |
| Smooth pad | `Poly` | `Sine`, `Triangl`, or `Strings` | `200 ms` to `1 s` | `500 ms` to `1 s` | `75%` or `100%` | `500 ms` to `2 s` | Slow fade-in and long release |
| Lead | `Mono` | `Hybrid`, `Saw`, or `Square` | `0 ms` or `10 ms` | `50 ms` to `200 ms` | `75%` or `100%` | `50 ms` to `200 ms` | Immediate and steady for melodies |
| Chime or bell | `Poly` | `Sine` or `Triangl` | `0 ms` or `5 ms` | `500 ms` to `1 s` | `0%` | `500 ms` to `2 s` | Rings out after the initial hit |
| Arpeggio | `Arp'gio` | `Hybrid`, `Square`, or `Saw` | `0 ms` or `5 ms` | `50 ms` to `200 ms` | `0%` to `25%` | `20 ms` to `100 ms` | Use `Arp Speed` and `Arp BPM` for rhythm |

For a sharper sound, use a brighter waveform such as `Saw`, `Square`, or
`Hybrid`, and keep `Attack` short. For a smoother sound, use `Sine`,
`Triangl`, or `Strings`, then increase `Attack` and `Release`.

If a sound feels too clicky, raise `Attack` one step. If notes smear together,
lower `Release`. If a pluck does not fade away enough, lower `Sustain` or lower
`Decay`. If a held note disappears too quickly, raise `Decay`.

### MIDI Options

This page controls MIDI routing and microtonal behavior.

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

Notes:

- `MPE Mode` can be `Auto`, `Disable`, or `Force`
- `Extra MPE` enables additional per-note messages such as channel pressure and CC74
- The MT-32 and General MIDI entries send program changes

### External Delegated Control

Host software can switch HexBoard into delegated control with SysEx. In that mode, normal note playback, arpeggiation, control wheels, and firmware LED rendering are paused while the host receives raw button events and drives all LEDs.

Delegated control is intentionally not exposed in the OLED menu and is not saved in profiles. It starts disabled on boot and must be entered again by the external host. Host-driven LEDs still pass through the normal `Brightness` and `LED Limit` output path. Developer details are in `docs/delegated-control.md`.

### Control Wheel

This page adjusts how quickly the command-button wheels move and whether they snap back.

Options include:

- `Vel Wheel`
- `PB Wheel`
- `Mod Wheel`
- `Pitch Bend`: `Springy` or `Sticky`
- `Mod Wheel`: `Springy` or `Sticky`

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

Important behavior:

- Auto-save always snapshots the current setup back into the `Boot/Auto-Save Slot`
- Loading a slot immediately replaces the active runtime settings
- Saving writes the current runtime settings into the chosen slot

### Advanced

This page contains maintenance and system settings:

- Firmware version
- Hardware revision
- `Invert Encoder`
- `ColorByKey`
- `DisplayNotes`
- `Reset Defaults`
- `Update Firmware`
- `Serial Debug`
- `LED Test`

`ColorByKey` changes whether palette placement starts from the selected key center.

`LED Test` is temporary and is not saved in profiles. Enter it and scroll through `Red`, `Green`, `Blue`, or `White` to light every LED immediately. Leaving the selector snaps it back to `Off` and restores the normal LED display. This is useful for diagnosing LED health or for *very* harsh mood lighting.

## Settings Persistence

Settings are stored in onboard flash using LittleFS.

Current behavior:

- Changes are marked dirty immediately
- If `Auto-Save` is enabled, the firmware writes after about `10 seconds` of inactivity
- Manual profile saves write immediately
- Saved profiles are protected by a settings header, version byte, and CRC32
- Invalid or corrupted settings files are replaced with factory defaults
- Flash writes mute audio briefly to avoid synth glitches during the write

## Microtonal And MPE Behavior

HexBoard supports standard 12-EDO and many non-12-EDO tunings. Depending on the tuning and menu settings, the firmware may:

- Use standard single-channel MIDI
- Use multi-channel standard MIDI for extended note ranges
- Use MPE with per-note pitch bend

In `Auto` mode, standard 12-EDO generally stays in regular MIDI mode, while microtonal use cases may switch to MPE behavior automatically.

For DAW, plugin, and hardware synth setup, including pitch-bend range matching and channel-zone examples, see `docs/mpe-microtonal-setup.md`.

## Factory Defaults

Important defaults in the current firmware include:

- Tuning: `12 EDO`
- Layout: first 12-EDO layout
- Scale: chromatic / none
- MIDI channel: `1`
- MPE mode: `Auto`
- Synth: `Off`
- Waveform: `Hybrid`
- LED brightness: `Dim`
- LED limit: `Off`
- Animation: `Button`
- Display notes: `Off`
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

The repository `README.md` also documents the bootloader-based update path.

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

That is expected. The firmware intentionally resets layout, scale, and key to known-valid values when the tuning changes.
