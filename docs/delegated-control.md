# Delegated Control Developer Reference

Delegated control lets an external host treat the HexBoard as a raw button-and-LED surface. In this mode, the firmware sends button press/release events as MIDI note messages and accepts SysEx LED color updates from the host.

The mode is intentionally external-only:

- There is no OLED menu item.
- There is no `SettingKey`.
- There is no factory default, profile value, or save callback.
- The mode always starts disabled after boot.

## Source Locations

Primary implementation points:

- `delegatedControl`, `delegatedColors`, delegated note-map state, and `SYSEX_*` constants live in `src/firmware/hardware/GridState.cpp`.
- `processIncomingSysEx()`, `delegatedButtonEvent()`, `processDelegatedNoteMapSysEx()`, and `processLedSysEx()` live in `src/firmware/midi/DelegatedControl.cpp`.
- preset-sync message dispatch lives in `src/firmware/storage/PresetSync.cpp`, with protocol/object helpers in the neighboring `PresetSync*.cpp` files.
- `processIncomingMIDIDelegated()` lives in `src/firmware/midi/MidiInput.cpp`.
- `readHexes()` and `updateWheels()` live in `src/firmware/hardware/GridScanRotary.cpp`.
- delegated encoder event handling and the 5-second force-exit path live in `src/firmware/hardware/GridScanRotary.cpp`.
- delegated OLED drawing lives in `src/firmware/menu/MenuAndDisplay.cpp`.
- `lightUpLEDs()` lives in `src/firmware/hardware/LedRender.cpp`.
- `animateLEDs()` lives in `src/firmware/hardware/LedAnimations.cpp`.
- `arpeggiate()` lives in `src/firmware/synth/SynthVoiceAllocation.cpp`.
- `hexboardLoop1()` lives in `src/firmware/app/Runtime.cpp` and contains the delegated-mode core-1 MIDI polling gate.

`HexBoard.ino` is the root Arduino sketch used by the `Makefile`; firmware implementation lives under `src/firmware/`. Generated files under `build/` should not be edited as source.

## Runtime Behavior

When `delegatedControl` is `false`, the firmware behaves normally.

When `delegatedControl` is `true`:

- `readHexes()` sends raw button press/release events instead of command buttons, MIDI notes, or synth notes.
- `lightUpLEDs()` displays `delegatedColors[]` directly instead of computed palette, wheel, scale, or animation colors, except while the local Advanced-menu `LED Test` selector is actively previewing a solid diagnostic color.
- `arpeggiate()` returns early, so the mono/arpeggiator held-note sequencer is not advanced while a host owns the surface.
- `updateWheels()` returns early.
- `animateLEDs()` returns early.
- `processIncomingMIDI()` returns early on core 0.
- `loop1()` calls `processIncomingMIDIDelegated()` so incoming delegated SysEx can be handled on core 1.
- the OLED shows `Delegated Control Mode`, the optional host application name,
  and a bottom prompt explaining the encoder hold-to-exit gesture while awake.
- the normal menu is disabled; encoder turns and button presses are forwarded
  to the host instead.

The OLED screensaver timer still runs in delegated mode. After the display
times out, host LED/key activity and delegated SysEx do not wake it; only
encoder activity wakes and redraws the delegated screen. Holding the encoder
button for about `5` seconds forces delegated mode to exit.

## SysEx Framing

The firmware uses the development/educational manufacturer ID `0x7D`.

All delegated-control SysEx messages use this outer form:

```text
F0 7D <command> <payload...> F7
```

The preset-sync protocol is intentionally separate and uses the family form
`F0 7D 10 <protocol...> F7`; see `docs/preset-sync-sysex.md`.
Delegated-control command bytes `0x01` through `0x06` remain live-surface
commands, not preset-sync messages.

The command byte is one of:

| Command | Name | Direction | Meaning |
| --- | --- | --- | --- |
| `0x01` | `SYSEX_DELEGATED_ENTER` | Host to device | Enter delegated mode |
| `0x02` | `SYSEX_DELEGATED_EXIT` | Host to device | Exit delegated mode |
| `0x03` | `SYSEX_LED` | Host to device | Update one or more LEDs |
| `0x04` | `SYSEX_DELEGATED_NOTE_MAP` | Host to device | Assign delegated MIDI channel/note output for one or more visible keys |
| `0x05` | `SYSEX_DELEGATED_NOTE_MAP_RESET` | Host to device | Restore delegated key output to the default button-index encoding |
| `0x06` | `SYSEX_DELEGATED_ENCODER_EVENT` | Device to host | Report encoder navigation events |

## Entering And Exiting

Enter delegated mode:

```text
F0 7D 01 F7
```

Enter delegated mode with an application name:

```text
F0 7D 01 <printable-ascii-app-name> F7
```

Exit delegated mode:

```text
F0 7D 02 F7
```

Entering delegated mode clears `delegatedColors[]` to black, clears delegated
active-note tracking, wakes the OLED, and calls `setupMIDI()` to reset MIDI
parser state. It does not reset the delegated note map. If the enter command is
received while delegated mode is already active, active delegated notes are
released first and the delegated control surface state is reset without clearing
the note map.

The optional application name payload is printable `7`-bit ASCII. Firmware keeps
up to `20` visible characters and displays the name under `Delegated Control
Mode`. If the host omits a valid name, the display uses `Host Application`.

Exiting delegated mode sends note-off messages for active delegated notes and
then returns to normal HexBoard behavior. It does not reset the delegated note
map.

## Encoder Event Output

In delegated mode, the encoder does not drive the normal GEM menu. It sends
device-to-host SysEx messages so a delegated app can use it for navigation:

```text
F0 7D 06 <event> F7
```

Events:

| Event | Meaning |
| --- | --- |
| `0x01` | Encoder up |
| `0x02` | Encoder down |
| `0x03` | Encoder button press |
| `0x04` | Encoder button release |

Encoder up/down follows the saved `Invert Encoder` setting, matching normal menu
navigation direction. Encoder press, release, and rotation wake the delegated
OLED screen and reset its screensaver timer. Holding the encoder button for
about `5` seconds sends a button-release event, exits delegated mode locally,
and suppresses the release from opening the normal menu.

## Device Identity

The firmware responds to MIDI device identity requests in both normal and delegated mode.

Request:

```text
F0 7E <device-id> 06 01 F7
```

Response payload:

```text
7E 00 06 02 7D 01 00 01 00 <hardware-version> 00 00 00
```

HexBoard's MIDI output wrapper adds the SysEx boundaries when sending. The manufacturer ID is currently `0x7D`; replace it if the project gets an assigned manufacturer ID.

## Button Event Output

In delegated mode, every new press and release from the visible key surface is
encoded as a MIDI note message.

Default encoding:

- `channel = buttonIndex / 100 + 1`
- `note = buttonIndex % 100`
- Press: `NoteOn(note, 127, channel)`
- Release: `NoteOff(note, 0, channel)`

Examples:

| Button index | Press event |
| --- | --- |
| `0` | Note On, channel `1`, note `0`, velocity `127` |
| `60` | Note On, channel `1`, note `60`, velocity `127` |
| `130` | Note On, channel `2`, note `30`, velocity `127` |

Host applications should treat indices `0` through `139` as the visible
HexBoard controls. The firmware scan matrix has `BTN_COUNT` logical slots, and
slots above `LED_COUNT` are internal hardware-detection/bookkeeping positions.
Those internal slots are not assignable through the delegated note map.

## MIDI Note Map Payload

`SYSEX_DELEGATED_NOTE_MAP` accepts zero or more 4-byte records:

```text
F0 7D 04 <record> [<record> ...] F7
```

Each record:

| Byte | Meaning | Range |
| --- | --- | --- |
| `0` | Button index high 7 bits | `0..127` |
| `1` | Button index low 7 bits | `0..127` |
| `2` | MIDI channel | `1..16` |
| `3` | MIDI note | `0..127` |

Button index is decoded as:

```cpp
button = (record[0] << 7) + record[1];
```

Duplicate button records are allowed; the last valid record wins. Records with
button indices outside `0..139` or channels outside `1..16` are logged and
ignored. Malformed trailing bytes are ignored because the parser only processes
complete 4-byte records.

Example: map button `60` to middle C on channel `1`:

```text
F0 7D 04 00 3C 01 3C F7
```

Example: map command button `120` to note `36` on channel `16`:

```text
F0 7D 04 00 78 10 24 F7
```

Reset the whole delegated note map to the default button-index encoding:

```text
F0 7D 05 F7
```

Mappings are RAM-resident runtime state. They are not saved to settings,
profiles, or `/layouts.dat`. A host can send the note map once and keep using it
across delegated LED updates and delegated enter/exit cycles. The map resets
only on power cycle/boot or `SYSEX_DELEGATED_NOTE_MAP_RESET`.

When a key is pressed, firmware stores the actual delegated channel and note
sent for that press. The matching release uses the stored channel and note, even
if the host remaps or resets that key while it is held. This prevents stuck
notes during live remapping.

## LED Update Payload

`SYSEX_LED` accepts zero or more 5-byte LED records:

```text
F0 7D 03 <record> [<record> ...] F7
```

Each record:

| Byte | Meaning | Range |
| --- | --- | --- |
| `0` | LED index high 7 bits | `0..127` |
| `1` | LED index low 7 bits | `0..127` |
| `2` | Hue | `0..127` |
| `3` | Saturation | `0..127` |
| `4` | Value | `0..127` |

LED index is decoded as:

```cpp
led = (record[0] << 7) + record[1];
```

Color conversion:

- Hue maps linearly from `0..127` to `0..360` degrees.
- Saturation maps from `0..127` to approximately `0..255`.
- Value maps from `0..127` to approximately `0..255`.
- The resulting HSV is converted through the normal `getLEDcode()` path, so global brightness and gamma correction still apply.
- The final delegated LED frame still passes through the normal hardware-calibrated LED current limiter, so the active `LED Limit` menu setting can dim host-driven colors to stay under the configured USB-side budget.

Example: set LED `5` to full red:

```text
F0 7D 03 00 05 00 7F 7F F7
```

Example: set LED `130` to full red:

```text
F0 7D 03 01 02 00 7F 7F F7
```

Malformed trailing bytes are ignored because `processLedSysEx()` only processes complete 5-byte records. Out-of-range LED indices are logged and ignored.

## Development Notes

Keep delegated control separate from user settings unless there is a clear product reason to persist it. If a future change persists delegated mode, update all of these places deliberately:

- `SettingKey`
- `factoryDefaults`
- `syncSettingsToRuntime()`
- menu callback wiring, if any
- settings-version compatibility behavior

Avoid adding heavy work to delegated-mode button or LED paths. The value of this mode is low-latency host control, and large logs, heap allocation, or blocking operations will make external LED animation and raw input feel sluggish.
