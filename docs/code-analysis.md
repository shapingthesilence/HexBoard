# HexBoard Firmware Code Analysis

> Entry point: `HexBoard.ino`
> Current shape: root Arduino sketch plus firmware modules under `src/firmware/`
> Target: Generic RP2040 at `250 MHz`, `16 MB` flash split as `8 MB` sketch / `8 MB` LittleFS, Pico SDK USB with `HexBoard` USB descriptors, Generic SPI `/4` boot2, NeoPixels, SH1107 OLED, rotary encoder, piezo output, and hardware `V1.2` audio jack support

This document describes the current firmware structure. It intentionally avoids exact line-number references because the source changes often. Use file names under `src/firmware/`, retained `// @...` section tags, and `rg` searches as the source navigation method.

## Architecture Overview

HexBoard is a hexagonal MIDI controller and standalone synth. The firmware uses a root Arduino sketch for lifecycle wrappers and modular implementation files under `src/firmware/`.

The repository now also contains an isolated `web/` companion app scaffold. It
is used to develop preset-sync workflows against the SysEx protocol. Firmware
currently supports the synth preset subset plus named synth-wavetable write/read
object; the remaining object classes are still web/mock-side scaffolding.

The runtime model is:

| Runtime area | Responsibilities |
| --- | --- |
| Core 0 `hexboardSetup()` via `setup()` | USB/MIDI startup, LittleFS, hardware detection, settings load, LEDs, OLED, menu, runtime sync |
| Core 0 `hexboardLoop()` via `loop()` | timing, button scan, note lifecycle, arpeggiator, wheels, MIDI input, animation, LED refresh, menu click handling, auto-save |
| Core 1 `hexboardSetup1()` via `setup1()` | synth PWM and DMA audio setup |
| Core 1 `hexboardLoop1()` via `loop1()` | audio buffer refill, rotary quadrature polling, and delegated MIDI polling while delegated mode is active |
| PWM-paced DMA | writes rendered audio blocks to the active PWM compare register |

High-level musical flow:

```text
button matrix -> readHexes()
              -> tryMIDInoteOn/Off() -> USB/serial MIDI
              -> trySynthNoteOn/Off() -> envelope commands -> audio block renderer -> DMA -> PWM audio
              -> LED state -> lightUpLEDs()
              -> played-note snapshot -> drawPlayedNotesOverlay()

rotary encoder -> readKnob() on core 1 -> dealWithRotary() on core 0 -> GEM menu

external host SysEx -> delegated control -> raw button events and host-driven LEDs
```

## Source Section Map

The current source is grouped by file:

| File | Purpose |
| --- | --- |
| `HexBoard.ino` | Arduino lifecycle wrappers only |
| `src/firmware/**/*.h` | cross-module APIs owned by each subsystem |
| `src/firmware/app/` | platform/common helpers, runtime defaults, diagnostics/timing, and lifecycle functions |
| `src/firmware/tuning/` | tuning tables, shared tuning math, and Dynamic JI retuning |
| `src/firmware/model/` | layout tables, scale/palette/preset models, and pitch assignment |
| `src/firmware/hardware/` | board constants, grid state, command buttons, scan/rotary input, LED rendering, and LED animations |
| `src/firmware/midi/` | USB/serial transport, MPE/routing, external MIDI LED state, delegated control, MIDI input parsing, and note dispatch |
| `src/firmware/synth/` | synth defaults, built-in waveforms, wavetable catalog, oscillator/render path, envelopes, PWM, DMA audio, polyphony, arpeggiator, and metronome |
| `src/firmware/storage/` | persistent data models, settings/profile persistence, synth preset/wavetable storage, and preset-sync handlers |
| `src/firmware/menu/` | OLED/GEM pages and callbacks, played-note overlay, synth preset menus, and synth wavetable menus |

## Core Data Structures

### `buttonDef h[BTN_COUNT]`

`h[]` is the central runtime state for the scan matrix. Stable board dimensions and pin assignments are declared in `src/firmware/hardware/HardwareConfig.h`. The `buttonDef`, `wheelDef`, command-button map, runtime user-geometry state, and delegated-control globals are declared in `src/firmware/hardware/GridState.h`; setup pin arrays stay private in `GridState.cpp`. Current board constants are:

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

There are `9` profiles. Slot `0` is the boot and auto-save slot. `NUM_SETTINGS` is derived from `SettingKey::NumSettings`, so adding settings requires updating the enum, defaults, runtime sync, and menu wiring together. Shared schema declarations live in `src/firmware/storage/PersistentDataModels.h`; `src/firmware/storage/Settings.cpp` owns the factory defaults table, auto-save state, dirty flag, and filesystem availability exposed through `Settings.h`.

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

- synth/audio renderer support: `renderAudioOutputLevels()`, `serviceAudioDmaBuffers()`,
  `writeAudioOutputLevels()`, `refreshSynthVoiceRenderCache()`,
  `resetSynthRenderCaches()`, `publishVoiceFreed()`,
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

The audio block renderer also reads the polyphony attenuation table from SRAM. Release-start
increments are read from 256-entry 16-bit RAM tables for the amp and FX
envelopes, generated when envelope settings change, avoiding unsigned division
in the block renderer. Piezo output scaling uses power-of-two fixed-point math
instead of division or reciprocal approximation.

This deliberately does not move the OLED menu and note-overlay drawing stack.
Those paths mostly call GEM/U8g2 routines and send data over I2C, so wholesale
RAM placement would consume much more SRAM than the selected hot-path pass.
After the DMA renderer, modulation-cache pass, and Q4 pitch-ratio lookup table,
`make` reports about `152 KB` of globals and about `110 KB` remaining for local
variables, heap, and stacks.

### Audio Profiling Diagnostic

The `Advanced` page exposes a transient `ISR Profile` toggle backed by the
audio profiling counters. Turning it on resets the counters and starts
measurement. Turning it off stops profiling and logs `min/avg/max/count`
block-render timing, `cpu min/avg/max` percentages computed as render time over
available block time, render-overrun count, release-start count, piezo-scaling
block count, DMA underrun count, and the active voice count/flag context for the
slowest captured block. Logs go through
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

Live USB MIDI channel messages use `writeUsbMidiPacket()`, which retries only
briefly and then backs off if the host stops polling the USB MIDI endpoint. This
keeps button scanning, command-wheel output, and onboard synth response from
waiting behind a sleeping or closed computer that still reports as connected.
SysEx stream output keeps the longer write timeout used by preset-sync and
identity responses.

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

Dynamic just intonation is applied in the MIDI note-on path. The reference key
tracking uses `pressedKeyIDs`; note-off removes the released button id from that
list so release order does not corrupt the reference stack. The `JI Table` menu
item is visible only while `Dynamic JI` is enabled and stores
`DynamicJIRatioTable`, a prime-limit selector from `3Limit` through `41Limit`.
The default `41Limit` preserves the previous full candidate-ratio behavior, while
lower limits filter the existing ratio list to simpler numerator/denominator
prime factors. The active ratio table stores precomputed cents for each
candidate so note-on matching does not repeatedly convert ratios while scanning.
`Beat BPM` and `BPM Mult.` use the same Tuning-menu visibility helper and are
visible only while `JI BPM Sync` is enabled. The visibility helper preserves the
Tuning page's current item index because GEM resets pages with a Back item near
the top when a hidden item is shown.

JI retuning now keeps the synth and MIDI output paths separate. The synth reads
`jiFrequencyMultiplier`, which is derived directly from the floating-point
retune cents and is not quantized by `MPEpitchBendSemis`. External MPE output
chooses the closest MIDI note after applying the JI cents, stores that note in
`activeMidiNote`, and sends only the residual pitch bend in `activePitchBend`.
The matching note-off uses `activeMidiNote` so shifted MIDI note-ons do not
leave held notes.

## Delegated Control

Delegated control is an external-only host integration mode. It has no menu item, no `SettingKey`, no profile storage, and always starts disabled on boot.

When active:

- raw button press/release events are sent to the host
- normal note playback is paused
- arpeggiator and command wheels are paused
- firmware animations are paused
- `lightUpLEDs()` renders only the host-provided delegated LED buffer
- incoming delegated SysEx is polled from core 1
- OLED menu navigation is disabled and replaced by the delegated status screen
  plus encoder events sent to the host

Delegated MIDI note mapping is session-only RAM state. Hosts can assign a
channel/note pair to each visible key through delegated SysEx; the default map
preserves the original button-index encoding. Active delegated presses remember
the channel/note sent on note-on so live remapping cannot strand note-offs.

The delegated enter command may include a printable ASCII application name for
the OLED. The delegated screen still uses the normal screensaver timer; after
timeout, only encoder activity wakes it. Encoder turns respect the saved
`RotaryInvert` setting before being reported as delegated up/down events, and a
5-second encoder-button hold forces local exit from delegated mode.

The protocol is documented in `docs/delegated-control.md`. Keep it isolated from settings and user menu code unless the product decision changes.

The preset-sync SysEx protocol is documented in `docs/preset-sync-sysex.md`.
Preset-sync implementation is split by ownership:
`PresetSyncProtocol.cpp` handles
frame encoding, transfer state, packing, and TLV helpers;
`PresetSyncGeometry.cpp` owns user tuning/layout/scale/color/button-map object
storage and runtime apply; `PresetSyncSynthObjects.cpp` owns synth preset,
wavetable, and live synth-parameter object handling; `PresetSync.cpp` owns
message dispatch and chunked read/write/delete flow.
It reserves its own command family. Firmware currently implements the synth
preset subset for named/foldered preset list/read/write/delete and live preview,
the user wavetable write path, and raw `/layouts.dat` storage for user tuning,
layout, scale, scale color map, and explicit button map objects. It also
implements live Apply for the minimum generated-geometry path: EDO/equal-step
tunings, vector layouts, included-degree scales, scale-degree color maps, and
format-1 explicit button maps. Profile transfer, bundle sync, menu catalog
integration, and Scala/cents-table runtime tuning remain draft.

The companion web app has protocol and catalog helpers for that draft under
`web/src/protocol/` and `web/src/catalogs/`, plus a mock MIDI transport under
`web/src/midi/` so host-side work can be tested before firmware support exists.
The browser tuning/layout editor adds a web-only `LayoutBundle` library that
combines one tuning, one custom scale-degree color set, one or more layouts,
one or more scales, and optional explicit button overrides per layout. It uses
`hexBoardGeometry.ts` for the current 140-key firmware index geometry, presents
vector layouts as across plus up-right steps, and converts that to the old
`DownLeftSteps` TLV only while the firmware schema still expects it. Bundle
rotation is a four-step device orientation value (`0/90/180/270`) that matches
firmware `DeviceRotation`, not a six-step hex-axis transform. The editor keeps
Tuning, Layouts, and Scales in sidebar subtabs, and the color-map object uses a
generic future color-mode name rather than an editable palette field. Scale
editing uses only included degrees; the input stores draft text and validates on
blur so invalid intermediate typing does not immediately overwrite the model.
EDO and equal-step tunings expose note labels and `A = x Hz`; labels default to
degree-number strings, validate on exit, and encode through `KeyLabels`. The
preview paintbrush writes per-button color overrides into the active layout,
using the same explicit override records as the selected-key inspector.
Equal-step tunings expose step cents and cycle length in the editor; their
protocol period metadata is derived from those values during encoding. Scala
`.scl` files are parsed in the web app into cents-table tuning objects, and
Scala period/cycle metadata, labels, and reference pitch are reserved for
imported file data rather than separate Scala editor fields. Firmware does not
parse Scala text, and full Scala compatibility requires a tuning-system
overhaul rather than only host-side import support. Current `/layouts.dat`
support stores raw validated `UserTuning`, `UserLayout`, `UserScale`,
`ScaleColorMap`, and `ExplicitButtonMap` bodies for preset-sync round-trip, and
the Apply path loads compatible active objects into `current`, `h[]`, MIDI pitch
assignment, and LED color caches. The live runtime state is intentionally not
yet a persisted settings/profile selection. Future firmware work should make
manual explicit button records keep their stored `stepsFromC` and color
regardless of root/key or transposition changes, and generated layout menu
controls should be hidden when a manual layout is active.
Real-device synth preset saves and Serum/Vital or HexBoard wavetable imports wait for ACK/NACK
responses through `WRITE_COMMIT`; library refresh requests list synth preset
and wavetable records one at a time before reading each object body. The compact header device
menu probes Web MIDI input/output pairs with `HELLO_REQ`, accepts only
compatible `HELLO_RESP` metadata, auto-connects when one HexBoard responds, and
shows a device selector only for multiple compatible HexBoards. If an object body read fails, the web
app still displays the object-list metadata and reports the first full-read
failure in the sync status. The synth editor reads handle `0x3FFF` as a
synthetic current-runtime synth preset before enabling live sends, and opening a
preset sends an apply-only preview immediately. Opened presets are temporary
drafts: a unique folder/name save gets a fresh object id, while overwrites reuse
the matched preset object id only after user confirmation. Literal `/`, `\`, and
`%` characters in web-app folder names are percent-escaped in device-facing
folder paths, so the on-device menu can display labels such as `Pads/Warm`
without splitting them into nested folders. Folder chips filter each synth
library pane independently and toggle off when clicked again. The same synth
editor has a browser-only AudioWorklet preview path for offline audition. It is
implemented as a TypeScript controller in `web/src/audio/` plus a public
worklet script so Vite can serve it from the app base path. The worklet mirrors
the preset schema at a practical level: poly/mono/arpeggiated voice handling,
AHDSR amp and FX envelopes, LFO, vibrato, phase-warp, wavetable-position, pitch,
drive, and user wavetable sample playback. The React editor keeps the audition
surface collapsed by default, expands it from a small `+` button, and owns the
computer-key piano mapping plus octave selection before forwarding note events
to the preview controller. Built-in wavetable names are generated
approximations, and the output path intentionally skips RP2040 PWM, piezo
midpoint, headphone cap, and fixed-point parity details.

Firmware MIDI receive drains all currently available USB/serial bytes into the
HexBoard parser instead of relying on the Arduino MIDI library. When a chunked
preset-sync object read/write starts, core 0 opens a modal transfer window,
displays `MIDI SysEx Transfer`, keeps pumping MIDI input, and resumes normal
main-loop work after an idle gap with no active object transfer, or after
timeout clears the active read/write transfer. The transfer overlay preserves
the previous OLED screensaver state and `screenTime`, so a transfer that wakes a
sleeping display returns it to the screensaver when the transfer closes.
Device-to-host reads are paced by host ACKs for `READ_BEGIN`, each `DATA_CHUNK`,
and `TRANSFER_END` so USB MIDI buffers do not have to absorb the whole object
transfer at once. One-frame control messages, including live synth parameter
sets, process inline and do not open the modal transfer window. Live synth
parameter sets mark settings dirty after applying valid records, so persistence
uses the same debounced profile auto-save path as on-device synth menu edits.

## Played Note OLED Overlay

`DisplayNotes` is a normal persisted Advanced-menu setting that is enabled by default. The overlay implementation lives in `src/firmware/menu/PlayedNotesOverlay.cpp`; menu item wiring remains in `MenuAndDisplay.cpp`. Foldered synth preset and wavetable load/save menus are rebuilt by `SynthPresetMenu.cpp` and `SynthWavetableMenu.cpp`. When enabled, MIDI note on/off updates mark a small OLED display region dirty. `drawPlayedNotesOverlay()` runs from the main loop after menu input handling. During normal menu display it draws only the newest currently held note as a top-right badge using the same large note font as the full overlay. During a temporary screensaver wake it renders the larger `Now Playing` overlay with up to `6` unique active notes.

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

The web layout bundle model now treats the bundle's single custom
scale-degree palette as the replacement path for `Tiered` on user-generated
geometry. When a compatible geometry bundle is applied, firmware renders the
loaded `ScaleColorMap` before falling back to the factory color modes, and then
applies explicit per-button color overrides.

Current animation modes include button, star, splash, orbit, octave, by-note, beams, reversed star/splash variants, MIDI-in highlighting, and none.

`applyNotePixelColor()` intentionally excludes normal "note is playing" LED behavior during `ANIMATE_MIDI_IN`, so external MIDI highlighting is not overwritten by the usual play color path.

`ANIMATE_MIDI_IN` responds to incoming NoteOn/NoteOff state maintained by `externalNoteDepth`. The LED renderer waits up to a short coalescing window after MIDI-in changes, with a maximum defer guard, so a large chord can settle into one frame while continuous streams still repaint regularly.

## Synth Engine

The onboard synth is independent from MIDI output. Playback modes are:

- `Off`
- `MonoRtg`
- `MonoLeg`
- `Arp'gio`
- `Poly`

Key implementation facts:

- `POLYPHONY_LIMIT` is `8`; the single `Poly` mode queues the full `8` compiled
  synth voices. Legacy stored playback value `5` from the temporary wavetable
  experiment is normalized to `Poly`.
- `PWM_BITS` defaults to `10`.
- `8`, `9`, and `10` bit PWM builds are supported. `9`-bit mode is available
  as a midpoint between `8`-bit quantization noise and `10`-bit carrier
  artifacts.
- At the project's `250 MHz` build target, the carrier is about `488 kHz` in
  `8`-bit mode, `244 kHz` in `9`-bit mode, and `122 kHz` in `10`-bit mode.
  Lower carrier frequencies can make high-register sine tones harsher on the
  jack output.
- Audio is rendered in `64`-sample ping-pong blocks on Core 1. A dedicated PWM
  timer slice with wrap `1023` and divider `/6` paces DMA writes at about
  `40.7 kHz` into the active output PWM slice's CC register.
- Hardware `V1.2` outputs one synth destination at a time: jack by default, or
  piezo when the `Buzzer` toggle is enabled. Hardware `V1.1` uses piezo.
  Inactive piezo output is switched to GPIO and held low; inactive jack output
  remains PWM-centered.
- `SynthOutputSmoothing` is a global `Off`/`1..8` setting. When enabled, the
  renderer applies a Q8 one-pole low-pass to both final jack and piezo PWM
  levels before DMA encoding; `Off` bypasses and snaps the filter state to the
  current levels.
- The oscillator counter is a `uint32_t` Q16.16 phase accumulator; the high `16`
  bits are the waveform phase and the low `16` bits carry fractional phase.
- Held notes use target oscillator increments that the audio block renderer slews toward,
  so pitch-bend wheel updates do not reset phase or jump instantly in the
  onboard synth.
- `MonoRtg` restarts the amp envelope when the active mono note changes;
  `MonoLeg` keeps the envelope running while another note is still held.
  `SynthPortamentoTimeIndex` reuses the envelope time table for mono pitch glide.
- `Arp'gio` keeps its own held-note order and builds note sequences from assigned
  note/frequency data for pitch-sorted directions, so `Up` and `Down` follow the
  sounded notes rather than physical button indices.
- `WAVEFORM_SINE` linearly interpolates between adjacent `512`-entry table
  samples using a `9`-bit sample index and `7` fractional phase bits.
  `STRINGS`, `CLARINET`, and the imported MP single-cycle waveforms use direct
  lookup from frame `0` of the active RAM wave table.
- Only the selected table-backed static waveform or selected wavetable is loaded
  into `activeSynthWaveTable`. The source cycles live outside the hot audio data
  path; the small vibrato sine table remains RAM-resident because the renderer
  reads it directly.
- Built-in compatibility wavetables and named user wavetables both load into a
  single `32`-frame active RAM buffer. Wavetable sampling runs in the normal
  synth modes, uses `SynthWavetablePosition` plus signed `WT Pos` modulation as
  frame position, and linearly interpolates adjacent frames. Firmware rebuilds a
  RAM lookup table when the active frame count changes so the audio renderer can map
  `WT Pos` values to frame positions without dividing per voice. Modulation work
  runs on an `8`-sample control quantum: wheel smoothing, LFO sampling, FX
  envelopes, pitch modulation targets, vibrato depth targets, phase-warp targets, and
  wavetable frame contexts are cached per voice, with note start/release/reset
  forcing an immediate cache refresh. Per-voice phase increment and phase-warp depths
  linearly slew between those cached targets at audio rate, while oscillator
  phase advance, amp-envelope level, phase warping, waveform reads, mixing,
  drive, and output scaling remain audio-rate. If only global sources modulate
  `WT Pos`, the cached frame-pair read context is shared across active voices; if
  an FX envelope targets `WT Pos`, each voice caches its own frame context.
  FX-envelope modulation depth uses a `128 x 128` RAM scale table, and FX
  envelopes advance by the full `8`
  audio ticks on each control refresh to preserve long envelope timing.
- `WAVEFORM_USER_WAVETABLE` is the one imported wavetable slot. The web app sends
  object type `0x0B` with exactly `32 * 512` sample bytes; firmware validates the
  TLVs, copies the data to `activeSynthWaveTable`, and can persist it in
  `/user_wavetable.dat` with a CRC-protected `UWT` header.
- All onboard waveforms now use the same phase convention: phase zero starts at
  an upward zero crossing. Byte tables are centered around value `128` and
  rotated to that crossing; generated saw, triangle, square, and hybrid shapes
  apply equivalent RAM-resident phase/sample helpers.
- `FoldWrp`, `DutyWrp`, and `PolyWrp` apply RAM-resident phase-warp helpers
  before sampling every waveform. `FoldWrp` is the original folded linear skew,
  `DutyWrp` shifts the two half-cycles in opposite directions, and `PolyWrp`
  uses a smooth parabolic curve inside each half-cycle.
  External MIDI CC output still uses the command wheel's current value.
- Envelope commands are shared through value arrays plus published/consumed sequence counters.
- Voice-free notifications use their own published/consumed sequence counters.
- Channel ownership uses atomic state to coordinate loop code with the ISR-adjacent audio path.
- The piezo output uses a moving midpoint derived from voice envelope level, but
  metronome beeps force full temporary piezo headroom while audible so a
  note-less beep is not double-attenuated by that moving-midpoint stage. Piezo
  sample scaling uses a power-of-two fixed-point multiply/shift to keep the
  block renderer bounded.
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

`CURRENT_SETTINGS_VERSION` is currently `17`, and `PROFILE_COUNT` is `9`.

The LED current-limit calibration changed without a settings-version bump because the persisted byte layout did not change. Existing saved profiles keep their selected `LedCurrentLimitMode`, but the runtime budget for each numbered mode now follows the hardware-specific calibrated table above.

Version `16` appends `DynamicJIRatioTable` to settings profiles. Version `15`
files migrate by copying the existing profile prefix and using the factory
default `41Limit` table selector.

The Synth Options `Drive` control is persisted as `SynthDrive`. It defaults to `Off` and applies a RAM-resident soft-saturation stage after voice mixing when enabled. The enabled modes use increasing pre-gain so `Dirty` reaches heavier clipping than the lower settings.

The Synth Options `Out Smooth` control is persisted as `SynthOutputSmoothing`.
It defaults to `Off`; values `1` through `8` increase a one-pole output
low-pass applied to both final jack and piezo PWM levels.

The `Waveform` setting remains one persisted byte for settings/preset
compatibility, but the visible synth source selector uses a wavetable
folder/name reference. Old waveform values are mapped to built-in compatibility
tables and a matching `SynthWavetablePosition` anchor; `Hybrid` maps to `Basic`
at position `0`. Missing named wavetable dependencies fall back to `Basic`.
Because folder/name references are strings, the current selection is persisted
outside `/settings.dat` in `/current_wavetable.dat`, with per-profile snapshots
in `/profile_wavetables.dat`. The profile-reference sidecar is read or rewritten
only during profile/file operations instead of being cached in global SRAM.
Settings saves, profile saves, autosave, preset loads, wavetable menu loads, and
preset-sync save-and-apply commits update the sidecar references. Loading a
profile restores its saved folder/name reference before runtime sync loads the selected table. Built-in wavetable dependencies use the reserved `/Built In`
folder unescaped; firmware normalizes the older `%2FBuilt In` and `Built In`
aliases for compatibility with earlier saves. User wavetable sample files use a shortened
`/wt_<16 hex>.wtb` filename based on the first 8 object-id bytes; firmware keeps
a legacy full-object-id path fallback for reads/deletes, but new writes avoid
the overlong filename that can fail on LittleFS. Catalog load/write paths skip
or prune records whose sample file is missing, which prevents failed earlier
imports from exhausting catalog slots.

The Synth Options wheel effect controls are persisted as `SynthModTarget`, `SynthModAmount`, and `SynthVibratoSpeed`. `SynthVibratoSpeed` stores a `1 Hz` through `12 Hz` table index and factory-defaults to `6 Hz`; version `10` and older files remap the old `4/6/8/10 Hz` indices. `FoldWrp` is the default wheel effect and keeps the existing target byte value `0`; `DutyWrp` and `PolyWrp` add target byte values `4` and `5`. All three warp targets apply low-CPU phase warps across the onboard waveforms and active wavetable before sampling. `WT Pos` is a separate target that offsets the persisted `SynthWavetablePosition` base before the active wavetable sampler interpolates frames. `SynthWavetablePosition` remains a `0..127` byte, while the on-device menu presents rounded frame anchors labeled `1..32`. `Vibrato` uses one shared RAM-resident phase accumulator and applies a small pitch offset to each active voice increment when the wheel or an FX envelope asks for vibrato. `Pitch` maps the signed `-127..127` runtime amount into a Q4 internal pitch accumulator, then reads startup-generated RAM Q16 ratio tables so full positive depth raises each active voice by about `+24` semitones and full negative depth lowers it by about `-24` semitones.

The synth LFO is persisted as `SynthLfoTarget`, `SynthLfoAmount`,
`SynthLfoWave`, and `SynthLfoSpeed`. It uses the same target accumulator as the
wheel and FX envelopes, a bipolar amount byte where `127` is off, sine/triangle/
saw/square shapes, and a `20`-entry speed table from `0.05 Hz` to `20 Hz`.

The amp and FX envelopes are AHDSRs. The amp envelope adds `EnvelopeHoldIndex`; FX Env 1 adds `EffectEnvelopeHoldIndex`; FX Env 2 adds `EffectEnvelope2HoldIndex`. Hold runs between attack and decay at full envelope level. Envelope time settings use a `20`-entry table from `0 ms` through `4 s`; the runtime keeps 7 fractional level bits internally but converts to 16-bit audible level for mixing. Release tables intentionally use coarser 256-bucket timing so the `4 s` option remains available without the larger 1024-entry 32-bit tables. Version `9` and older files remap their old `10`-entry table indices during settings migration.

The two FX synth envelopes are persisted independently. FX Env 1 uses `EffectEnvelopeTarget`, `EffectEnvelopeAmount`, `EffectEnvelopeAttackIndex`, `EffectEnvelopeHoldIndex`, `EffectEnvelopeDecayIndex`, `EffectEnvelopeSustainLevel`, and `EffectEnvelopeReleaseIndex`; FX Env 2 uses the matching `EffectEnvelope2*` settings. The wheel, LFO, and both FX envelopes can target the same parameter; the audio renderer's control-rate cache adds their signed target depths and clamps at `-127..127`, so sources stack instead of replacing each other. FX `Amount` is stored as a biased byte where `127` is off, values above `127` follow the envelope in the positive target direction, and values below `127` follow the same envelope level in the negative target direction. Negative vibrato is target-specific: it treats vibrato depth as the resting value and subtracts the envelope level, because negative LFO polarity is not musically useful. The factory defaults keep both FX envelopes inactive with all times at `0 ms` and sustain at `0%`.

Envelope commands cross from Core 0 to the audio renderer through sequence-numbered
command bytes. Release commands are retried by Core 0 until the renderer consumes
one, then the renderer clears the retry state so long-release voices do not repeatedly
restart their release stage.

`SynthAttackEffect` is now deprecated. The byte remains in the persisted settings layout so version `8` files can migrate by prefix copy, but the runtime and menu ignore it.

Synth presets are stored outside `/settings.dat` in `/synth_presets.dat` with magic `SYP`, version `9`, CRC32, and a counted catalog capped at `128` entries. Each entry has a valid flag, favorite flag, stable 16-byte object id, name, folder path, wavetable name/folder path, and the sound-focused synth setting bytes. A preset copies sound-focused synth settings and the wavetable reference into the active runtime/settings profile when loaded from the on-device menu, marks settings dirty for normal auto-save, and deliberately does not persist which preset was loaded. Web-app full-preset preview applies a transferred synth preset to runtime and marks settings dirty for debounced autosave, compact live synth parameter edits also mark settings dirty, and save requests update `/synth_presets.dat`. The on-device save/load menus are rebuilt from the catalog as folder submenus; preset items inside those folders display only the preset name. Folder path separators are still `/`, but the firmware decodes `%2F`, `%5C`, and `%25` in menu labels so web-app folder names can contain literal slash, backslash, or percent characters. Rebuilds are requested from save/delete paths and serviced from the main loop after GEM input handling, with owned menu items removed from their parent pages before deletion. The load menu has a `Blank` item. Version `1` through `3` preset files are accepted as the old `8`-slot layout; version `1` files have saved envelope time indices remapped to the expanded time table, version `1` and `2` files remap legacy vibrato speed indices, version `4` fixed-slot files migrate saved presets into the root folder `/` with `Slot N` names, version `5` fixed named/foldered arrays migrate into the counted version `6` catalog, version `6` records migrate by appending `SynthPortamentoTimeIndex` and `ArpeggiatorDirection` defaults, version `7` records migrate by appending wavetable position and LFO defaults, and version `8` records migrate by deriving wavetable name/folder fields from the old `Waveform` value before being rewritten.

User geometry objects are stored in `/layouts.dat` with magic `LYT`, version
`1`, CRC32, and a counted raw-body catalog capped at `127` entries. The catalog
can hold `UserTuning`, `UserLayout`, `UserScale`, `ScaleColorMap`, and
`ExplicitButtonMap` objects. Preset-sync validates the common `HBS1` object
envelope, schema major `1`, non-empty `Name`, and 16-byte `ObjectId`, then
stores the raw body so hosts can list, read, overwrite, and delete geometry
objects. Runtime Apply currently parses compatible geometry TLVs into RAM-only
user tuning/layout/scale/palette/button-map state, rebuilds layout/scale/pitch
assignment, and uses `ReferenceMilliHz` as an A4 pitch offset for synth and MIDI
retuning. The OLED tuning/layout/scale menu callbacks clear that RAM-only
geometry override and reset key to C before returning to factory-backed
selections. Scala/cents-list tunings still save as raw objects but are rejected
by runtime Apply until table-backed pitch lookup exists.

Named user wavetables are stored in `/synth_wavetables.dat` with magic `SYW`,
version `1`, CRC32, and a counted catalog capped at `64` entries. The selected
wavetable reference for each profile is stored separately in
`/profile_wavetables.dat` with magic `PWT`, version `1`, and one folder/name
record per profile; the firmware loads that file into a stack-local struct only
while saving or loading profile references. Each catalog entry has a valid flag,
stable `16`-byte object id, name, folder path, and a sample-file
path generated from the object id. The sample file contains `32 x 512`
unsigned-byte samples. The legacy `/user_wavetable.dat` `UWT` file is still
loadable only through the compatibility reference `/User/UserTbl`.
The web app treats wavetable refresh as metadata-only by using object-list
records; full wavetable reads are deferred to explicit `Download`/`Export`
actions. Metadata-only `SynthWavetable` writes can update a user wavetable's
name/folder when the handle and object id still match the catalog entry.

The Synth Options metronome controls are persisted as `MetronomeMode` and `MetronomeSignature`. The metronome shares `SynthBPM` with the arpeggiator; `ArpeggiatorDivision` sets rhythmic subdivision and `ArpeggiatorDirection` selects `Up`, `Down`, `Played`, `RevPlay`, `UpDown`, `DownUp`, or `Random`. The metronome runs its beat scheduler on core 0 and feeds the beep mode into the RAM-resident audio renderer through a short countdown. `Bright` mode creates strong contrast by dimming the LED frame between beats and returning toward the selected brightness on each beat instead of boosting above the selected brightness. `Side Btns` mode flashes the seven command LEDs green on accented first beats and red on the other beats.

The Advanced-menu boot animation toggle is persisted as `BootAnimationEnabled`. It defaults on and skips `runBootLedSelfCheck()` when off.

The Advanced-menu headphone volume cap is persisted as `HeadphoneVolumeCap`.
It defaults to `100%`, is inserted into the menu only for hardware `V1.2`, and
scales only the centered headphone-jack sample before the `AJACK` PWM write.
The piezo path still uses the velocity wheel and envelope-derived amplitude
without this cap.

`DeviceRotation` stores the four-step physical device orientation used by the
Layout menu's `Device Rot` item. The OLED driver rotation is derived from that
physical value with a 180-degree mounting offset, so `Device Rot` value `0`
drives the display as the old OLED-driver value `2`. Selecting a layout seeds
`DeviceRotation` from legacy `layoutDef.isPortrait` metadata: portrait layouts
use `0`, and landscape layouts use `90`.

Load behavior:

- missing settings file sets `settingsFileMissingOnBoot`, creates factory defaults, and saves them
- magic mismatch restores defaults
- version `2` through `16` files migrate to version `17` by copying the older per-profile prefix, appending newer settings with factory defaults, remapping legacy envelope time indices when needed, remapping legacy vibrato speed indices, and converting old `DeviceRotation` OLED-driver constants to physical device orientation values; version `7` profiles seed FX Env 1's new target from the old opposite-of-wheel behavior; version `16` profiles append `SynthOutputSmoothing = Off`
- unknown version mismatches restore defaults
- short read restores defaults
- CRC32 mismatch restores defaults
- successful load activates the boot/default profile slot
- on hardware `V1.2`, the stored `AudioDestination` byte is interpreted as a
  jack-default `Buzzer` toggle that switches output to piezo, with legacy
  selector values mapped by the old piezo bit

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

The Advanced page includes a read-only `Firmware 1.4 alpha` version label.
The `Buzzer` toggle is inserted only on hardware `V1.2`.

## Input Interface And Panic Behavior

`readHexes()` scans the matrix with direct GPIO register access. It normally routes changed button states through note and command-button handlers.

When delegated control is active, `readHexes()` sends raw button events instead and does not trigger normal note lifecycle behavior.

The rotary encoder is polled on core 1 and consumed on core 0. Holding the encoder button for about `2` seconds triggers panic behavior to clear active notes and output state.

## Current Risk Areas

- The single-file structure makes cross-subsystem side effects easy to miss.
- Dynamic containers still exist in live paths.
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
- synth off, mono retrigger, mono legato, arpeggio, portamento, and poly modes
- command-button wheels
- rotary panic stop
- color modes, including `Tiered` and `Diatonic`
- `ANIMATE_MIDI_IN` if external MIDI display behavior changed
- `DisplayNotes` compact menu badge, full screensaver-wake overlay in `12 EDO`, 12-EDO chord labels, a non-12 tuning, chord release, and screensaver wake
- delegated-control enter, LED update, button event, and exit SysEx

For docs-only changes, a compile is not necessary, but keep terminology aligned with `HexBoard.ino` and `src/firmware/`.
