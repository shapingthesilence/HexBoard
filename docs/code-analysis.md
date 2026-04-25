# HexBoard Firmware Code Analysis

> File: `src/HexBoard.ino`
> Current shape: one Arduino sketch, about `7,300` lines
> Target: Generic RP2040 at `200 MHz`, `16 MB` flash split as `8 MB` sketch / `8 MB` LittleFS, TinyUSB, Generic SPI `/4` boot2, NeoPixels, SH1107 OLED, rotary encoder, piezo output, and hardware `V1.2` audio jack support

This document describes the current firmware structure. It intentionally avoids exact line-number references because the sketch changes often. Use the `// @...` section tags in `src/HexBoard.ino` and `rg` searches as the source navigation method.

## Architecture Overview

HexBoard is a hexagonal MIDI controller and standalone synth. The firmware is intentionally maintained as one large `.ino` file for Arduino compatibility, but the source is divided into subsystem sections.

The runtime model is:

| Runtime area | Responsibilities |
| --- | --- |
| Core 0 `setup()` | USB/MIDI startup, LittleFS, hardware detection, settings load, LEDs, OLED, menu, runtime sync |
| Core 0 `loop()` | timing, button scan, note lifecycle, arpeggiator, wheels, MIDI input, animation, LED refresh, menu click handling, auto-save |
| Core 1 `setup1()` | synth PWM and hardware alarm setup |
| Core 1 `loop1()` | rotary quadrature polling and delegated MIDI polling while delegated mode is active |
| Timer ISR `poll()` | audio sample generation and PWM output |

High-level musical flow:

```text
button matrix -> readHexes()
              -> tryMIDInoteOn/Off() -> USB/serial MIDI
              -> trySynthNoteOn/Off() -> envelope commands -> poll() ISR -> PWM audio
              -> LED state -> lightUpLEDs()
              -> played-note snapshot -> drawPlayedNotesOverlay()

rotary encoder -> readKnob() on core 1 -> dealWithRotary() on core 0 -> GEM menu

external host SysEx -> delegated control -> raw button events and host-driven LEDs
```

## Source Section Map

The current source uses these section tags and blocks:

| Section | Purpose |
| --- | --- |
| `@readme` | build target and repository notes |
| `@init` | includes, platform macros, forward declarations |
| `@helpers` | utility helpers such as positive modulo and MIDI mapping helpers |
| `@defaults` | runtime defaults and option constants |
| `@microtonal` | tuning definitions, waveform metadata, custom EDO support |
| `@layout` | isomorphic layout definitions |
| `@scales` | scale definitions |
| `@palettes` | palette constants and color conversion helpers |
| `@presets` | `presetDef`, tuning/layout/scale accessors, current preset |
| `@diagnostics` | debug logging and ISR profiling |
| `@timing` | microsecond clock reads and loop timing |
| `@gridSystem` | scan matrix, `buttonDef`, command buttons, wheels, delegated globals |
| `@LED` | color modes, LED cache generation, LED rendering |
| `@MIDI` | USB/serial MIDI, MPE, external MIDI input, delegated SysEx protocol, played-note overlay state |
| `@synth` | oscillator, envelope, PWM, polyphony, arpeggiator support |
| `@animate` | LED animations |
| `@assignment` | layout, scale, pitch, frequency, and reverse MIDI mapping |
| settings block | LittleFS settings header, profiles, defaults, persistence |
| `@menu` | OLED setup, played-note overlay drawing, GEM menu pages, options, callbacks, preview behavior |
| `@interface` | matrix scan, rotary encoder, panic behavior |
| `@mainLoop` | Arduino setup/loop functions for both cores |

## Core Data Structures

### `buttonDef h[BTN_COUNT]`

`h[]` is the central runtime state for the scan matrix. Current constants are:

- `LED_COUNT = 140`
- `COLCOUNT = 10`
- `ROWCOUNT = 16`
- `BTN_COUNT = 160`
- `FIRST_FLAG_BUTTON_INDEX = LED_COUNT`

Visible buttons are indices `0` through `139`. Matrix slots `140` through `159` are internal flags and hardware-detection positions, not playable hexes.

Each `buttonDef` stores:

- scan state (`btnState`)
- hex coordinates
- command-vs-note status
- assigned MIDI note, channel, pitch bend, and extended MIDI index
- synth channel owner data
- frequency and just-intonation adjustment
- cached LED colors
- external MIDI animation depth

### Command Buttons And Wheels

Seven visible buttons are reserved as command buttons:

- `CMDBTN_0`, `CMDBTN_1`, `CMDBTN_2`: velocity wheel
- `CMDBTN_3`: toggles modulation wheel vs pitch-bend wheel
- `CMDBTN_4`, `CMDBTN_5`, `CMDBTN_6`: modulation or pitch bend

The wheels are implemented with `wheelDef`. Their snap/sticky behavior and speeds are menu-backed settings.

### Current Preset

`presetDef current` owns the active musical mapping:

- tuning
- layout
- scale
- key offset
- transpose offset

Pitch-related code should go through this object instead of duplicating tuning/layout math.

### Persisted Settings

Settings are stored in:

```cpp
uint8_t settingsProfiles[PROFILE_COUNT][NUM_SETTINGS];
uint8_t* settings;
```

There are `9` profiles. Slot `0` is the boot and auto-save slot. `NUM_SETTINGS` is derived from `SettingKey::NumSettings`, so adding settings requires updating the enum, defaults, runtime sync, and menu wiring together.

### Dynamic Containers Still In Runtime Paths

The current code still uses dynamic containers in some live paths:

- `std::vector<byte> pressedKeyIDs`
- `std::array<std::vector<uint8_t>, 128> midiNoteToHexIndices`
- dynamic-just-intonation ratio storage
- synth release/retry queue-like state

Do not assume heap allocation has been eliminated from timing-sensitive paths. If timing glitches or memory fragmentation show up, these are among the first areas to inspect.

## Startup Sequence

Core 0 setup currently:

1. initializes TinyUSB when required by the board core
2. disables the synth alarm IRQ before setup is complete
3. starts MIDI interfaces
4. waits up to about `2` seconds for USB enumeration before flash access
5. mounts LittleFS
6. configures I2C
7. configures scan pins and grid state
8. detects hardware revision
9. loads settings
10. starts LEDs, display, rotary input, and menu objects
11. applies hardware-specific menu behavior
12. syncs saved settings to runtime globals
13. recomputes pitch bend factors

The USB wait matters because RP2040 flash operations can starve USB interrupt handling.

## Main Loop Responsibilities

Core 0 loop is deliberately broad but should remain bounded:

- updates timing
- processes synth release cleanup
- handles pending release retries
- runs OLED screen saver logic
- scans buttons
- runs arpeggiator state
- updates command-button wheels
- processes incoming MIDI
- advances LED animations
- renders LEDs
- processes rotary button/menu events
- draws the optional played-note OLED overlay
- runs debounced auto-save

Core 1 loop stays narrow:

- polls delegated SysEx while delegated mode is active
- polls rotary quadrature state

Heavy work, blocking waits, large debug bursts, and new heap allocations in either loop can cause sluggish controls, LED jitter, or audio artifacts.

## Pitch, Layout, And Scale Assignment

The mapping chain is:

1. `applyLayout()` computes `stepsFromC` from layout vectors, mirroring, and rotation.
2. `applyScale()` marks whether each playable hex is in the active scale.
3. `assignPitches()` computes MIDI note, extended MIDI index, channel, bend, and synth frequency.

Common refresh functions:

| Function | Use when |
| --- | --- |
| `applyScale()` | key, scale, scale-lock, or in-scale logic changes |
| `assignPitches()` | transpose or pitch math changes without moving button positions |
| `updateLayoutAndRotate()` | layout, mirror, or rotation changes |
| `refreshMidiRouting()` | MPE, MIDI channel, or microtonal routing rules change |

Using the wrong refresh path creates stale LEDs, stale MIDI note assignments, or bad synth frequencies.

## MIDI System

The firmware sends and receives MIDI through both:

- USB MIDI via TinyUSB
- serial MIDI through `Serial1`

`withMIDI()` wraps operations that should apply to the enabled destinations. Hardware `V1.2` enables both USB and serial by default through hardware setup.

The MIDI routing model includes:

- normal single-channel MIDI
- extended standard MIDI where out-of-range musical indices are folded across MIDI channels
- MPE with per-note pitch bend
- optional extra MPE messages such as channel pressure and CC74
- incoming MIDI note handling for LED animation
- General MIDI and Roland MT-32 program-change menu tables stored in flash
- optional played-note OLED overlay updates from note on/off state

### MPE Channel Pool

MPE channels are tracked with:

```cpp
uint16_t mpeChannelBitmap;
```

`resetMPEChannelPool()` populates the bitmap from the configured low/high channel range. `takeMPEChannel()` uses `__builtin_ctz()` to claim the lowest available bit, and `releaseMPEChannel()` returns a channel to the pool.

This replaces slower sorted-container behavior, but it still depends on correct reset/release behavior in the note lifecycle.

### Dynamic Just Intonation

Dynamic just intonation is applied in the MIDI note-on path. The current reference key tracking uses `pressedKeyIDs`, and note-off currently removes from that list with `pop_back()`. That means release-order behavior is still worth reviewing if dynamic JI behaves unexpectedly.

## Delegated Control

Delegated control is an external-only host integration mode. It has no menu item, no `SettingKey`, no profile storage, and always starts disabled on boot.

When active:

- raw button press/release events are sent to the host
- normal note playback is paused
- arpeggiator and command wheels are paused
- firmware animations are paused
- `lightUpLEDs()` renders only the host-provided delegated LED buffer
- incoming delegated SysEx is polled from core 1

The protocol is documented in `docs/delegated-control.md`. Keep it isolated from settings and user menu code unless the product decision changes.

## Played Note OLED Overlay

`DisplayNotes` is a normal persisted Advanced-menu setting. When enabled, MIDI note on/off updates mark a small OLED overlay dirty. `drawPlayedNotesOverlay()` runs from the main loop after menu input handling and renders up to `6` unique active notes.

Display behavior:

- `12 EDO` notes render as chromatic note names with octave numbers.
- Other tunings render as `step.octave`.
- The overlay stays visible briefly after release.
- A short release grace period prevents chords from visually shrinking while a player releases notes unevenly.
- If the OLED screensaver is active, a note press can temporarily wake the display and return it to dimmed state afterward.

The overlay is independent from delegated control. In delegated mode, normal note lifecycle is paused, so the overlay has no active notes to display.

## LED And Color System

The LED pipeline uses cached per-button colors:

- `LEDcodeRest`
- `LEDcodeDim`
- `LEDcodeOff`
- `LEDcodePlay`
- `LEDcodeAnim`

`setLEDcolorCodes()` recomputes those caches. Call it after changes that affect palette, scale, tuning relationships, key-centered color placement, brightness, or color mode.

`lightUpLEDs()` writes the final frame into the NeoPixel buffer and then calls `applyLedCurrentLimitToFrame()` before `strip.show()`. The limiter uses a rough WS2812 estimate of `20 mA` per color channel at full scale plus `1 mA` idle per LED, then scales the final RGB bytes if the configured `LED Limit` budget would be exceeded. `decodeLedCurrentLimitMilliamps()` maps the visible USB-side menu labels through a laptop-side meter calibration table: `250 mA -> 250`, `500 mA -> 500`, `750 mA -> 900`, `1.0 A -> 1350`, `1.5 A -> 2000`, `2.0 A -> 3150`, and `3.0 A -> 5000` internal limiter milliamps. The `1.5 A` menu value is now the factory default because it preserves the old `2.0 A` limiter behavior. Because the scaling happens at the final frame stage, it also affects delegated-control LED frames.

Current color modes include:

- `Rainbow`
- `Tiered`
- `Alt`
- `Fifths`
- `Piano`
- `Alt Piano`
- `Filament`
- `Diatonic`

Current animation modes include button, star, splash, orbit, octave, by-note, beams, reversed star/splash variants, MIDI-in highlighting, and none.

`applyNotePixelColor()` intentionally excludes normal "note is playing" LED behavior during `ANIMATE_MIDI_IN`, so external MIDI highlighting is not overwritten by the usual play color path.

## Synth Engine

The onboard synth is independent from MIDI output. Playback modes are:

- `Off`
- `Mono`
- `Arp'gio`
- `Poly`

Key implementation facts:

- `POLYPHONY_LIMIT` is `8`.
- `PWM_BITS` defaults to `10`.
- `8`-bit PWM remains available as a source-level fallback. Switching from `8`
  to `10` bits lowers the carrier from about `392 kHz` to `98 kHz` at the
  project's `200 MHz` build target, which can make high-register sine tones
  harsher on the jack output.
- The oscillator counter is `uint16_t`, so phase wraps over a 16-bit range.
- `WAVEFORM_SINE` linearly interpolates between adjacent wavetable entries
  using the low `8` bits of phase; `STRINGS` and `CLARINET` still use direct
  table lookup.
- Envelope commands are shared through value arrays plus published/consumed sequence counters.
- Voice-free notifications use their own published/consumed sequence counters.
- Channel ownership uses atomic state to coordinate loop code with the ISR-adjacent audio path.
- `flashWriteInProgress` mutes output during flash writes because RP2040 flash operations disable interrupts.

Synth changes need extra review when they touch:

- timer alarm setup
- ISR runtime cost
- envelope command publishing or consumption
- channel ownership
- release retry behavior
- flash-save muting
- hardware `V1.1` vs `V1.2` output behavior

## Settings Persistence

Settings are stored in LittleFS at `/settings.dat`.

The current `SettingsHeader` contains:

- magic bytes `STG`
- settings file version
- default profile index field
- CRC32 of all profile data bytes

`CURRENT_SETTINGS_VERSION` is currently `3`, and `PROFILE_COUNT` is `9`.

The LED current-limit calibration changed without a settings-version bump because the persisted byte layout did not change. Existing saved profiles keep their selected `LedCurrentLimitMode`, but the runtime budget for each numbered mode now follows the calibrated table above.

Load behavior:

- missing settings file creates factory defaults and saves them
- magic mismatch restores defaults
- version `2` files migrate to version `3` by appending the new LED current-limit setting with its factory default
- unknown version mismatches restore defaults
- short read restores defaults
- CRC32 mismatch restores defaults
- successful load activates the boot/default profile slot
- on hardware `V1.2`, the stored `AudioDestination` byte is interpreted as a
  jack-default `Buzzer` toggle, with legacy selector values mapped by the old
  piezo bit

Save behavior:

- manual saves write immediately
- auto-save is debounced for about `10` seconds
- auto-save snapshots the current runtime settings into profile `0`
- flash writes go through `flashSafeSave()` so the synth is muted before interrupts are blocked

If `SettingKey` entries are added, removed, or reordered, update the version and decide whether defaults-only fallback is acceptable or whether a migration is needed.

## Menu System

The GEM menu is built around persistent callback metadata:

1. `SettingKey` entry
2. factory default
3. runtime sync in `syncSettingsToRuntime()`
4. `PersistentCallbackInfo`
5. `GEMItem`
6. page insertion in `setupMenu()`
7. optional preview callback
8. optional post-change recomputation hook

Current top-level user pages are:

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

The `Buzzer` toggle is inserted only on hardware `V1.2`.

## Input Interface And Panic Behavior

`readHexes()` scans the matrix with direct GPIO register access. It normally routes changed button states through note and command-button handlers.

When delegated control is active, `readHexes()` sends raw button events instead and does not trigger normal note lifecycle behavior.

The rotary encoder is polled on core 1 and consumed on core 0. Holding the encoder button for about `2` seconds triggers panic behavior to clear active notes and output state.

## Current Risk Areas

- The single-file structure makes cross-subsystem side effects easy to miss.
- Dynamic containers still exist in live paths.
- Dynamic JI release tracking assumes a simple pressed-key ordering.
- Settings schema changes currently fall back to defaults on version mismatch rather than migrating.
- Flash writes still pause interrupt-driven audio, even though the code mutes before saving.
- Delegated-control input is intentionally external-facing, so SysEx parsing should stay bounds-checked and isolated.
- Hardware-version behavior is mixed into runtime/menu setup and needs testing on both revisions.

## Verification Checklist For Firmware Changes

Run or manually verify the areas your change touches:

- compile with the same board options as `Makefile`
- keep `Generic SPI /4` boot2 for `200 MHz` builds; `Generic SPI /2` can overclock external flash and crash at runtime
- boot with no settings file
- boot with existing settings file
- profile save/load and auto-save
- normal MIDI note on/off
- MPE mode and configured MPE channel range
- synth off, mono, arpeggio, and poly modes
- command-button wheels
- rotary panic stop
- color modes, including `Tiered` and `Diatonic`
- `ANIMATE_MIDI_IN` if external MIDI display behavior changed
- `DisplayNotes` overlay in `12 EDO`, a non-12 tuning, chord release, and screensaver wake
- delegated-control enter, LED update, button event, and exit SysEx

For docs-only changes, a compile is not necessary, but keep terminology aligned with `src/HexBoard.ino`.
