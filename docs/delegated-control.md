# Delegated Control Developer Reference

Delegated control lets an external host treat the HexBoard as a raw button-and-LED surface. In this mode, the firmware sends button press/release events as MIDI note messages and accepts SysEx LED color updates from the host.

The mode is intentionally external-only:

- There is no OLED menu item.
- There is no `SettingKey`.
- There is no factory default, profile value, or save callback.
- The mode always starts disabled after boot.

## Source Locations

Primary implementation points in `src/HexBoard.ino`:

- `delegatedControl`, `delegatedColors`, and `SYSEX_*` constants live near the grid/wheel globals.
- `processIncomingSysEx()` handles external entry while the firmware is in normal mode.
- `processIncomingMIDIDelegated()` handles delegated-mode SysEx on core 1.
- `delegatedButtonEvent()` converts raw button events to MIDI notes.
- `processLedSysEx()` converts host LED color records into cached NeoPixel colors.
- `readHexes()`, `lightUpLEDs()`, `arpeggiate()`, `updateWheels()`, `animateLEDs()`, and `loop1()` contain runtime gates for delegated mode.

The root `HexBoard.ino` file is currently kept in sync with `src/HexBoard.ino`, but `src/HexBoard.ino` is the build target used by the `Makefile`.

## Runtime Behavior

When `delegatedControl` is `false`, the firmware behaves normally.

When `delegatedControl` is `true`:

- `readHexes()` sends raw button press/release events instead of command buttons, MIDI notes, or synth notes.
- `lightUpLEDs()` displays `delegatedColors[]` directly instead of computed palette, wheel, scale, or animation colors.
- `arpeggiate()` returns early.
- `updateWheels()` returns early.
- `animateLEDs()` returns early.
- `processIncomingMIDI()` returns early on core 0.
- `loop1()` calls `processIncomingMIDIDelegated()` so incoming delegated SysEx can be handled on core 1.

The rotary menu is not explicitly disabled in delegated mode. There is no delegated-control menu item, so a user cannot toggle the mode from the device UI.

## SysEx Framing

The firmware uses the development/educational manufacturer ID `0x7D`.

All delegated-control SysEx messages use this outer form:

```text
F0 7D <command> <payload...> F7
```

The command byte is one of:

| Command | Name | Direction | Meaning |
| --- | --- | --- | --- |
| `0x01` | `SYSEX_DELEGATED_ENTER` | Host to device | Enter delegated mode |
| `0x02` | `SYSEX_DELEGATED_EXIT` | Host to device | Exit delegated mode |
| `0x03` | `SYSEX_LED` | Host to device | Update one or more LEDs |

## Entering And Exiting

Enter delegated mode:

```text
F0 7D 01 F7
```

Exit delegated mode:

```text
F0 7D 02 F7
```

Entering delegated mode clears `delegatedColors[]` to black and calls `setupMIDI()` to reset MIDI parser state. The enter command is a no-op if received after delegated mode is already active.

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

The MIDI library adds the SysEx boundaries when sending. The manufacturer ID is currently `0x7D`; replace it if the project gets an assigned manufacturer ID.

## Button Event Output

In delegated mode, every new press and release from the scan matrix is encoded as a MIDI note message.

Encoding:

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

Host applications should treat indices `0` through `139` as the visible HexBoard controls. The firmware scan matrix has `BTN_COUNT` logical slots, and slots above `LED_COUNT` are internal hardware-detection/bookkeeping positions.

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
- The final delegated LED frame still passes through the normal calibrated LED current limiter, so the active `LED Limit` menu setting can dim host-driven colors to stay under the configured USB-side budget.

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
- settings version/migration behavior

Avoid adding heavy work to delegated-mode button or LED paths. The value of this mode is low-latency host control, and large logs, heap allocation, or blocking operations will make external LED animation and raw input feel sluggish.
