# HexBoard Firmware Code Analysis

> File: `src/HexBoard.ino`
> Current shape: one Arduino sketch, about `7,300` lines
> Target: Generic RP2040 at `250 MHz`, `16 MB` flash split as `8 MB` sketch / `8 MB` LittleFS, Pico SDK USB with `HexBoard` USB descriptors, Generic SPI `/4` boot2, NeoPixels, SH1107 OLED, rotary encoder, piezo output, and hardware `V1.2` audio jack support

This document describes the current firmware structure. It intentionally avoids exact line-number references because the sketch changes often. Use the `// @...` section tags in `src/HexBoard.ino` and `rg` searches as the source navigation method.

## Architecture Overview

HexBoard is a hexagonal MIDI controller and standalone synth. The firmware is intentionally maintained as one large `.ino` file for Arduino compatibility, but the source is divided into subsystem sections.

The repository now also contains an isolated `web/` companion app scaffold. It
is used to develop preset-sync workflows against the SysEx protocol. Firmware
currently supports the synth preset subset; the remaining object classes are
still web/mock-side scaffolding.

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

The wheels are implemented with `wheelDef`. Their snap/sticky behavior and speeds are menu-backed settings. The `TooSlow` speed uses stored value `0` for velocity/mod wheels and updates one step every two command-message cooldown windows; positive speed values update once per cooldown. Pitch-bend `TooSlow` is stored as exponent `6`, producing a step of `64`.

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

### RAM-Resident Hot Paths

The RP2040 executes normal code from external flash through XIP, so a few
latency-sensitive functions are explicitly placed in SRAM with `RAM_FUNC`.
Current RAM-resident HexBoard functions include:

- synth/audio ISR support: `poll()`, `readClock()`,
  `writeAudioOutputLevels()`, `publishVoiceFreed()`,
  `smoothedSynthModValue()`, `setSynthFreq()`, `beginEnvelopeAttack()`,
  `beginEnvelopeRelease()`, `processEnvelopeReleases()`, and
  `retryPendingReleases()`
- note and synth-control dispatch: `tryMIDInoteOn()`, `tryMIDInoteOff()`,
  `takeMPEChannel()`, `releaseMPEChannel()`, `trySynthNoteOn()`,
  `trySynthNoteOff()`, `replaceMonoSynthWith()`, `resetSynthFreqs()`,
  `updateSynthWithNewFreqs()`, and `arpeggiate()`
- loop hot paths: `readHexes()`, `updateWheels()`, `wheelDef::setTargetValue()`,
  `wheelDef::updateValue()`, `readKnob()`, and the small command-button
  handlers
- compact LED frame helpers: `lightUpLEDs()`, `applyNotePixelColor()`,
  `applyLedCurrentLimitToFrame()`, `resetVelocityLEDs()`,
  `resetWheelLEDs()`, and `getLEDcode()`

`poll()` also reads the polyphony attenuation table from SRAM. Release-start
increments are read from 256-entry 16-bit RAM tables for the amp and FX
envelopes, generated when envelope settings change, avoiding unsigned division
in the audio ISR. Piezo output scaling uses fixed-point reciprocal math instead
of the signed division helper.

This deliberately does not move the OLED menu and note-overlay drawing stack.
Those paths mostly call GEM/U8g2 routines and send data over I2C, so wholesale
RAM placement would consume much more SRAM than the selected hot-path pass.
After the coarser AHDSR release-table pass, `make` reports about `106 KB` of
globals and about `156 KB` remaining for local variables, heap, and stacks.

### ISR Profiling Diagnostic

The `Advanced` page exposes a transient `ISR Profile` toggle backed by the
existing audio ISR profiling counters. Turning it on resets the counters and
starts measurement. Turning it off stops profiling and logs `min/avg/max/count`,
overrun count, release-start count, piezo-scaling sample count, and the active
voice count/flag context for the slowest captured sample. Logs go through
`sendToLog()`, so `Serial Debug` must be enabled to see the result.

The profiler state is not a `SettingKey`, is not persisted in profiles, and does
not require a settings-version bump.

## Startup Sequence

Core 0 setup currently:

1. sets USB manufacturer/product descriptors to `HexBoard`
2. starts USB serial logging
3. disables the synth alarm IRQ before setup is complete
4. starts Pico SDK USB MIDI and serial MIDI interfaces
5. waits up to about `2` seconds for USB MIDI enumeration before flash access
6. mounts LittleFS
7. configures I2C
8. configures scan pins and grid state
9. detects hardware revision
10. loads settings
11. starts LEDs, display, rotary input, and menu objects
12. applies hardware-specific menu behavior
13. syncs saved settings to runtime globals
14. recomputes pitch bend factors
15. runs the fixed-time boot LED self-check

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

Normal incoming MIDI drains all currently available queued events for each enabled interface. During `ANIMATE_MIDI_IN`, LED refresh is briefly coalesced after incoming NoteOn/NoteOff state changes so dense host bursts can render as a batch instead of one visible strip update per event.

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

- USB MIDI through the Arduino-Pico `MIDIUSB` wrapper on the Pico SDK USB stack
- serial MIDI through `Serial1`

The USB device manufacturer/product descriptors and MIDI interface name are set
to `HexBoard` before MIDI registration. `withMIDI()` wraps output operations
that should apply to the enabled destinations. Hardware `V1.2` enables both USB
and serial by default through hardware setup. Incoming USB and serial MIDI share
a HexBoard-owned byte parser for SysEx, running status, and NoteOn/NoteOff LED
animation.

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

The preset-sync SysEx protocol is documented in `docs/preset-sync-sysex.md`.
It reserves its own command family. Firmware currently implements the synth
preset subset for named/foldered preset list/read/write/delete and live preview;
profile transfer, future `/layouts.dat` user tuning/layout storage, scale color
maps, explicit button maps, and bundle sync remain draft.

The companion web app has protocol and catalog helpers for that draft under
`web/src/protocol/` and `web/src/catalogs/`, plus a mock MIDI transport under
`web/src/midi/` so host-side work can be tested before firmware support exists.
Real-device synth preset saves wait for ACK/NACK responses through
`WRITE_COMMIT`; library refresh requests list synth preset records one at a
time before reading each object body. The Device view exposes separate MIDI
output/input selection, explicitly opens selected Web MIDI ports, and blocks
device-library refresh when no input port is attached so reads are not blocked
by a guessed or missing input port. If an object body read fails, the web app
still displays the object-list metadata and reports the first full-read failure
in the sync status. The synth editor reads handle `0x3FFF` as a synthetic
current-runtime synth preset before enabling live sends, and selecting a preset
for editing sends an apply-only preview immediately. Literal `/`, `\`, and `%`
characters in web-app folder names are percent-escaped in device-facing folder
paths, so the on-device menu can display labels such as `Pads/Warm` without
splitting them into nested folders.

Firmware MIDI receive drains all currently available USB/serial bytes into the
HexBoard parser instead of relying on the Arduino MIDI library. When a
preset-sync frame is recognized, core 0 opens a modal transfer window, displays
`MIDI SysEx Transfer`, keeps pumping MIDI input, and resumes normal main-loop
work after an idle gap with no active object transfer, or after timeout clears
the active read/write transfer. Device-to-host reads are paced by host ACKs for
`READ_BEGIN`, each `DATA_CHUNK`, and `TRANSFER_END` so USB MIDI buffers do not
have to absorb the whole object transfer at once.

## Played Note OLED Overlay

`DisplayNotes` is a normal persisted Advanced-menu setting that is enabled by default. When enabled, MIDI note on/off updates mark a small OLED display region dirty. `drawPlayedNotesOverlay()` runs from the main loop after menu input handling. During normal menu display it draws only the newest currently held note as a top-right badge using the same large note font as the full overlay. During a temporary screensaver wake it renders the larger `Now Playing` overlay with up to `6` unique active notes.

Display behavior:

- `12 EDO` notes render as chromatic note names with octave numbers.
- Other tunings render as `step.octave`.
- Active notes are displayed from lowest to highest pitch; if more than `6` unique notes are active, the lowest `6` are shown.
- In `12 EDO`, the larger screensaver-wake overlay names common triads, sixth chords, seventh chords, ninth chords, and related suspended/extended chords below the note rows at a fixed position. Inversions use slash-bass notation when the detected root is not the lowest displayed pitch class.
- Encoder click/turn input dismisses the larger overlay immediately and returns to menu/badge mode.
- Note rows use stable fixed columns spread close to the OLED edges, so changing label widths do not shift note positions.
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

`lightUpLEDs()` writes the final frame into the NeoPixel buffer and then calls `applyLedCurrentLimitToFrame()` before `strip.show()`. The limiter uses a rough WS2812 estimate of `20 mA` per color channel at full scale plus `1 mA` idle per LED, then scales the final RGB bytes if the configured `LED Limit` budget would be exceeded. `decodeLedCurrentLimitMilliamps()` maps the visible USB-side menu labels through a hardware-specific meter calibration table. On `V1.2`, the internal limiter budgets are `250 mA -> 250`, `500 mA -> 500`, `750 mA -> 900`, `1.0 A -> 1350`, `1.5 A -> 2000`, `2.0 A -> 3150`, and `3.0 A -> 5000`. On `V1.1`, the budgets are `250 mA -> 600`, `500 mA -> 1160`, `750 mA -> 2100`, `1.0 A -> 3150`, `1.5 A -> 4600`, `2.0 A -> 7100`, and `3.0 A -> 8500`. The `1.5 A` menu value is the factory default because it preserves the old stable `V1.2` draw and is calibrated to land near that same actual draw on `V1.1`. Because the scaling happens at the final frame stage, it also affects delegated-control LED frames.

`ledTestMode` is a transient Advanced-menu selector, not persisted profile data. While it is `Red`, `Green`, `Blue`, or `White`, `lightUpLEDs()` renders that solid color across all `140` LEDs and skips the normal note/delegated frame for that loop. These diagnostic colors are direct raw RGB channel values from `strip.Color()`, not palette HSV values from `getLEDcode()`. The preview reset and save callback both set it back to `Off`, so leaving the selector restores normal rendering.

`runBootLedSelfCheck()` is a startup-only diagnostic path, not a menu animation mode. It runs after settings are synced and pitch-bend factors are recomputed, unless `BootAnimationEnabled` is off. Its colors are scaled through the saved/default `Brightness` and `Rest Bright` path. Normal boots skip RGB color-channel flashes and run a smooth rainbow splash based on hex-grid distance from `bootLedSplashCenterIndex()`, which is one physical hex to the right of the active layout center. On the default layout that makes the splash radiate from `D4` instead of `C4`. The command LEDs are excluded from the splash and receive a separate color fade from `setBootCommandButtonFade()`.

If `/settings.dat` is missing, `load_settings()` sets the RAM-only `settingsFileMissingOnBoot` flag before saving factory defaults. That boot gets an additional white diagnostic: `showFirstBootWhiteDiagnostic()` fades all LEDs to moderate white and holds for `2 seconds` before the normal splash. `fadeToNormalLedFrame()` crossfades from the final animation frame into the actual resting LED frame so the first loop render does not pop.

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

`ANIMATE_MIDI_IN` responds to incoming NoteOn/NoteOff state maintained by `externalNoteDepth`. The LED renderer waits up to a short coalescing window after MIDI-in changes, with a maximum defer guard, so a large chord can settle into one frame while continuous streams still repaint regularly.

## Synth Engine

The onboard synth is independent from MIDI output. Playback modes are:

- `Off`
- `Mono`
- `Arp'gio`
- `Poly`

Key implementation facts:

- `POLYPHONY_LIMIT` is `8`.
- `PWM_BITS` defaults to `10`.
- `8`, `9`, and `10` bit PWM builds are supported. `9`-bit mode is available
  as a midpoint between `8`-bit quantization noise and `10`-bit carrier
  artifacts.
- At the project's `250 MHz` build target, the carrier is about `488 kHz` in
  `8`-bit mode, `244 kHz` in `9`-bit mode, and `122 kHz` in `10`-bit mode.
  Lower carrier frequencies can make high-register sine tones harsher on the
  jack output.
- The oscillator counter is a `uint32_t` Q16.16 phase accumulator; the high `16`
  bits are the waveform phase and the low `16` bits carry fractional phase.
- Held notes use target oscillator increments that the audio ISR slews toward,
  so pitch-bend wheel updates do not reset phase or jump instantly in the
  onboard synth.
- `WAVEFORM_SINE` linearly interpolates between adjacent wavetable entries
  using the low `8` bits of phase. `STRINGS`, `CLARINET`, and the imported MP
  single-cycle waveforms still use direct table lookup.
- Imported MP single-cycle waveform tables are centered around byte value `128`
  and rotated to start at an upward zero crossing.
- `WAVEFORM_SQUARE` reads a synth-local smoothed modulation value for pulse
  width; external MIDI CC output still uses the command wheel's current value.
- Envelope commands are shared through value arrays plus published/consumed sequence counters.
- Voice-free notifications use their own published/consumed sequence counters.
- Channel ownership uses atomic state to coordinate loop code with the ISR-adjacent audio path.
- The piezo output uses a moving midpoint derived from voice envelope level, but
  metronome beeps force full temporary piezo headroom while audible so a
  note-less beep is not double-attenuated by that moving-midpoint stage.
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

`CURRENT_SETTINGS_VERSION` is currently `11`, and `PROFILE_COUNT` is `9`.

The LED current-limit calibration changed without a settings-version bump because the persisted byte layout did not change. Existing saved profiles keep their selected `LedCurrentLimitMode`, but the runtime budget for each numbered mode now follows the hardware-specific calibrated table above.

The Synth Options `Drive` control is persisted as `SynthDrive`. It defaults to `Off` and applies a RAM-resident soft-saturation stage after voice mixing when enabled. The enabled modes use increasing pre-gain so `Dirty` reaches heavier clipping than the lower settings.

The `Waveform` setting remains one persisted byte. The imported MP single-cycle
waveforms extended the valid value range without changing the settings layout.

The Synth Options wheel effect controls are persisted as `SynthModTarget`, `SynthModAmount`, and `SynthVibratoSpeed`. `SynthVibratoSpeed` stores a `1 Hz` through `12 Hz` table index and factory-defaults to `6 Hz`; version `10` and older files remap the old `4/6/8/10 Hz` indices. `Tone` remains the default wheel effect: it uses a wider pulse-width sweep for `Square`, a pronounced RAM-resident value curve for `Saw` that keeps the saw reset point fixed, and a stronger cheap RAM-resident phase warp for the other waveforms. `Vibrato` uses one shared RAM-resident phase accumulator and applies a small pitch offset to each active voice increment when the wheel or an FX envelope asks for vibrato. `Pitch` raises each active voice increment up to about one octave at full positive depth and lowers it up to about one octave at full negative FX depth.

The amp and FX envelopes are AHDSRs. The amp envelope adds `EnvelopeHoldIndex`; FX Env 1 adds `EffectEnvelopeHoldIndex`; FX Env 2 adds `EffectEnvelope2HoldIndex`. Hold runs between attack and decay at full envelope level. Envelope time settings use a `20`-entry table from `0 ms` through `4 s`; the runtime keeps 7 fractional level bits internally but converts to 16-bit audible level for mixing. Release tables intentionally use coarser 256-bucket timing so the `4 s` option remains available without the larger 1024-entry 32-bit tables. Version `9` and older files remap their old `10`-entry table indices during settings migration.

The two FX synth envelopes are persisted independently. FX Env 1 uses `EffectEnvelopeTarget`, `EffectEnvelopeAmount`, `EffectEnvelopeAttackIndex`, `EffectEnvelopeHoldIndex`, `EffectEnvelopeDecayIndex`, `EffectEnvelopeSustainLevel`, and `EffectEnvelopeReleaseIndex`; FX Env 2 uses the matching `EffectEnvelope2*` settings. The wheel and both FX envelopes can target the same parameter; `poll()` adds their signed target depths and clamps at `-127..127`, so sources stack instead of replacing each other. FX `Amount` is stored as a biased byte where `127` is off, values above `127` follow the envelope in the positive target direction, and values below `127` follow the same envelope level in the negative target direction. Negative vibrato is target-specific: it treats vibrato depth as the resting value and subtracts the envelope level, because negative LFO polarity is not musically useful. The factory defaults keep both FX envelopes inactive with all times at `0 ms` and sustain at `0%`.

`SynthAttackEffect` is now deprecated. The byte remains in the persisted settings layout so version `8` files can migrate by prefix copy, but the runtime and menu ignore it.

Synth presets are stored outside `/settings.dat` in `/synth_presets.dat` with magic `SYP`, version `6`, CRC32, and a counted catalog capped at `128` entries. Each entry has a valid flag, favorite flag, stable 16-byte object id, name, folder path, and the sound-focused synth setting bytes. A preset copies sound-focused synth settings into the active runtime/settings profile when loaded from the on-device menu, marks settings dirty for normal auto-save, and deliberately does not persist which preset was loaded. Web-app live preview applies a transferred synth preset to runtime without marking settings dirty, while save requests update `/synth_presets.dat`. The on-device save/load menus are rebuilt from the catalog as folder submenus; preset items inside those folders display only the preset name. Folder path separators are still `/`, but the firmware decodes `%2F`, `%5C`, and `%25` in menu labels so web-app folder names can contain literal slash, backslash, or percent characters. Rebuilds are requested from save/delete paths and serviced from the main loop after GEM input handling, with owned menu items removed from their parent pages before deletion. The load menu has a `Blank` item. Version `1` through `3` preset files are accepted as the old `8`-slot layout; version `1` files have saved envelope time indices remapped to the expanded time table, version `1` and `2` files remap legacy vibrato speed indices, version `4` fixed-slot files migrate saved presets into the root folder `/` with `Slot N` names, and version `5` fixed named/foldered arrays migrate into the counted version `6` catalog before being rewritten.

The Synth Options metronome controls are persisted as `MetronomeMode` and `MetronomeSignature`. The metronome shares `SynthBPM` with the arpeggiator, runs its beat scheduler on core 0, and feeds the beep mode into the RAM-resident audio ISR through a short countdown. `Bright` mode creates strong contrast by dimming the LED frame between beats and returning toward the selected brightness on each beat instead of boosting above the selected brightness. `Side Btns` mode flashes the seven command LEDs green on accented first beats and red on the other beats.

The Advanced-menu boot animation toggle is persisted as `BootAnimationEnabled`. It defaults on and skips `runBootLedSelfCheck()` when off.

The Advanced-menu headphone volume cap is persisted as `HeadphoneVolumeCap`.
It defaults to `100%`, is inserted into the menu only for hardware `V1.2`, and
scales only the centered headphone-jack sample before the `AJACK` PWM write.
The piezo path still uses the velocity wheel and envelope-derived amplitude
without this cap.

Load behavior:

- missing settings file sets `settingsFileMissingOnBoot`, creates factory defaults, and saves them
- magic mismatch restores defaults
- version `2` through `10` files migrate to version `11` by copying the older per-profile prefix, appending newer settings with factory defaults, remapping legacy envelope time indices when needed, and remapping legacy vibrato speed indices; version `7` profiles seed FX Env 1's new target from the old opposite-of-wheel behavior
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
- Unknown settings schema versions still fall back to defaults on version mismatch.
- Flash writes still pause interrupt-driven audio, even though the code mutes before saving.
- Delegated-control input is intentionally external-facing, so SysEx parsing should stay bounds-checked and isolated.
- Hardware-version behavior is mixed into runtime/menu setup and needs testing on both revisions.

## Verification Checklist For Firmware Changes

Run or manually verify the areas your change touches:

- compile with the same board options as `Makefile`
- keep `Generic SPI /4` boot2 for `250 MHz` builds; `Generic SPI /2` can overclock external flash and crash at runtime
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
- `DisplayNotes` compact menu badge, full screensaver-wake overlay in `12 EDO`, 12-EDO chord labels, a non-12 tuning, chord release, and screensaver wake
- delegated-control enter, LED update, button event, and exit SysEx

For docs-only changes, a compile is not necessary, but keep terminology aligned with `src/HexBoard.ino`.
