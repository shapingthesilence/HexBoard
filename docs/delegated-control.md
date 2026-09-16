# Delegated Control Developer Reference

Delegated control lets an external host treat the HexBoard as a raw button-and-LED surface. In this mode, the firmware sends button press/release events as MIDI note messages and accepts SysEx LED color updates from the host.

The mode is intentionally external-only:

- There is no OLED menu item.
- There is no `SettingKey`.
- There is no factory default, profile value, or save callback.
- The mode always starts disabled after boot.

## Source Locations

Primary implementation points:

- `DelegatedControlState` and `SYSEX_*` constants are declared in
  `src/firmware/hardware/GridState.h`; `GridState.cpp` owns
  `delegatedControlState` and note-map initialization.
- `processIncomingSysEx()`, `delegatedButtonEvent()`, `processDelegatedNoteMapSysEx()`, and `processLedSysEx()` live in `src/firmware/midi/DelegatedControl.cpp`.
- preset-sync message dispatch lives in `src/firmware/storage/PresetSync.cpp`, with protocol/object helpers in the neighboring `PresetSync*.cpp` files.
- `processIncomingMIDI()` lives in `src/firmware/midi/MidiInput.cpp`.
- `readHexes()` and `updateWheels()` live in `src/firmware/hardware/GridScanRotary.cpp`.
- delegated encoder event handling and the 5-second force-exit path live in `src/firmware/hardware/GridScanRotary.cpp`.
- delegated OLED drawing lives in `src/firmware/menu/MenuAndDisplay.cpp`.
- `lightUpLEDs()` lives in `src/firmware/hardware/LedRender.cpp`.
- `animateLEDs()` lives in `src/firmware/hardware/LedAnimations.cpp`.
- `arpeggiate()` lives in `src/firmware/synth/SynthVoiceAllocation.cpp`.
- `hexboardLoop()` lives in `src/firmware/app/Runtime.cpp` and owns MIDI polling in both normal and delegated modes.

## Runtime Behavior

When `delegatedControlState.active` is `false`, the firmware behaves normally.

When `delegatedControlState.active` is `true`:

- `readHexes()` sends physical button press/release events instead of command buttons, normal MIDI notes, or synth notes. Presses are immediate; releases require 3 ms of continuously unpressed matrix readings to reject switch bounce. This also applies outside delegated mode.
- `lightUpLEDs()` displays `delegatedControlState.ledHsv[]` directly instead of computed palette, wheel, scale, or animation colors, except while the local Advanced-menu `LED Test` selector is actively previewing a solid diagnostic color.
- `arpeggiate()` returns early, so the mono/arpeggiator held-note sequencer is not advanced while a host owns the surface.
- `updateWheels()` returns early.
- `animateLEDs()` returns early.
- `processIncomingMIDI()` reads and dispatches delegated messages on core 0.
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
Delegated-control command bytes `0x01` through `0x0B` remain live-surface
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
| `0x07` | `SYSEX_DELEGATED_SESSION_ENTER` | Host to device | Request an acknowledged session |
| `0x08` | Retired | — | Ignored; no heartbeat is used |
| `0x09` | `SYSEX_DELEGATED_SESSION_STATUS` | Device to host | Report active, busy, or ended session |
| `0x0A` | `SYSEX_DELEGATED_SESSION_EXIT` | Host to device | End only the matching session |
| `0x0B` | `SYSEX_DELEGATED_DISPLAY_ROTATION` | Host to device | Set transient OLED orientation for a matching session |

## Acknowledged Sessions and Manual Recovery

Learn uses protocol version `2` and a nonzero 28-bit token, encoded as four
7-bit bytes, most significant first (`t3 t2 t1 t0`). Frames:

```text
F0 7D 07 02 t3 t2 t1 t0 <optional printable app name> F7
F0 7D 09 02 t3 t2 t1 t0 <status> F7
F0 7D 0A t3 t2 t1 t0 F7
```

Status `1` acknowledges an active session, `0` reports its end, and `2` reports
busy. Fresh entry is rejected while any visible key is held or another host
owns the surface, including a legacy host. Repeating entry with the active
token is idempotent: notes and LEDs are preserved. Fresh entry stops existing
MIDI/synth output and resets the raw button map before ACK.

Sessions have no heartbeat or automatic expiry. Stop, scoped exit, legacy
exit, and a five-second encoder hold restore normal control and report status
`0` for the ended token. If a browser disappears without delivering exit,
the user holds the encoder to recover, then starts another session.

Scoped exit requires exactly four matching token bytes. Unknown versions,
zero entry tokens, malformed requests, and mismatched exit tokens have no
effect. An old token's delayed exit cannot end a newer session. Tokens live
only in RAM; sessions do not write settings or flash.

Hosts wait for matching status `1` before interpreting keys or driving LEDs.
Learn allows 2.5 seconds for this initial acknowledgement, then sends scoped
exit and reports the failed start. After acknowledgement it sends no periodic
session messages. It sends exit on Stop, view change, hidden tab, page exit,
connection failure, or failed writes. Browser unload delivery is best effort;
encoder hold is the recovery path.

Version `1` (the retired heartbeat protocol) is not accepted. A mismatched
app/firmware pair cannot start a session; update both together. Legacy `0x01`
entry remains supported without a timeout and retains legacy note-map behavior.

Core 0 owns all MIDI polling, parsing, note output, entry, and exit. The audio
core never reads MIDI streams. Each bounded drain stops when its mode changes;
entry and exit reset partial parser state without reopening USB or serial
endpoints. Encoder exit therefore does not transfer a live parser between cores.

## Temporary Display Orientation

After session acknowledgement, a host can send:

```text
F0 7D 0B t3 t2 t1 t0 <device-rotation> F7
```

The payload must contain exactly four matching token bytes and a rotation
`0..3`, using the same device-rotation convention as layout objects. Firmware
applies its hardware display offset on core 0 when redrawing the delegated
screen. Wrong tokens and invalid rotations are ignored. This command does not
write settings. Entry clears the override; exit restores
the saved display orientation, including while the OLED is asleep. Firmware
without `0x0B` support ignores the command and retains the saved orientation.

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

Entering delegated mode clears `delegatedControlState.ledHsv[]` to black, clears delegated
active-note tracking, wakes the OLED, and resets the MIDI parsers without
reinitializing USB or serial endpoints. `setupMIDI()` is boot-only. Legacy entry
does not reset the delegated note map. If the enter command is
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
profiles, or `/geometry/*.hgb`. A host can send the note map once and keep using it
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

Delegated mode is transient host state. Keep it separate from profile settings
and preset-sync transfers. See the [developer guide](developer-guide.md) for
cross-core ownership and [AGENTS.md](../AGENTS.md) for engineering constraints.

Avoid adding heavy work to delegated-mode button or LED paths. The value of this mode is low-latency host control, and large logs, heap allocation, or blocking operations will make external LED animation and raw input feel sluggish.
