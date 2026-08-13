# HexBoard Firmware Developer Guide

## Purpose

This is the implementation map for HexBoard firmware. `HexBoard.ino` contains
only Arduino lifecycle wrappers; implementation lives under `src/firmware/`.
Code is authoritative when this guide is stale.

Repository-wide engineering and documentation rules are in `AGENTS.md`.

## Build And Tooling

Run:

```sh
make
```

The `Makefile` targets Earle Philhower's RP2040 core with:

- `rp2040:rp2040:generic`
- 16 MiB flash split into 8 MiB sketch and 8 MiB LittleFS
- 250 MHz CPU and `Generic SPI /4` boot2
- Pico SDK USB with the core `MIDIUSB` wrapper
- `Adafruit NeoPixel`, `U8g2`, `Adafruit GFX Library`, and `GEM`

Audio timing derives from `F_CPU`. Select the 8-, 9-, or 10-bit synth PWM build
with `PWM_BITS`; 10 is the default:

```sh
make PWM_BITS=9
```

The optional sequencer defaults off:

```sh
make HEXBOARD_ENABLE_SEQUENCER=1
make sequencer-builds
```

Normal and sequencer builds each produce a complete Factory UF2 and a
firmware-only Update UF2. `scripts/build_factory_library.py` compiles
`factory-library/`; `scripts/build_factory_uf2.py` creates and validates the
LittleFS image, firmware payload, complete touched sectors, flash ranges, and
both UF2 variants. The filesystem occupies `0x107ff000` through `0x10fff000`;
the final 4 KiB EEPROM reservation is excluded.

Keep Node tooling inside `web/`; use `web/README.md` for app commands.

## Runtime Architecture

| Runtime | Responsibility |
| --- | --- |
| Core 0 setup | USB/MIDI, LittleFS loading, hardware detection, LEDs, OLED, menu, settings sync |
| Core 0 loop | controls, notes, MIDI input, LEDs, display, menu, and auto-save |
| Core 1 setup | PWM and DMA audio transport |
| Core 1 loop | audio refill, rotary polling, and delegated MIDI polling |
| PWM-paced DMA | rendered audio blocks to the active PWM compare register |

Primary flow:

```text
matrix -> readHexes()
       -> MIDI note dispatch -> USB/serial MIDI
       -> synth commands -> renderer -> DMA -> PWM
       -> LED state -> lightUpLEDs()

rotary -> readKnob() on Core 1 -> dealWithRotary() on Core 0 -> GEM
host SysEx -> delegated control or preset sync
```

Firmware owns its MIDI byte parser over `MIDIUSB` and `Serial1`. Preset-sync
object bodies use chunked frames. The live parser uses fixed 1 KiB buffers per
transport; object storage and large wavetable/geometry transfers stream or use
bounded transfer state outside scan and ISR paths.

Preset transfers are cooperative. Core 0 services one bounded MIDI batch per
loop, keeps note-release, button-scan, and encoder-panic handling active, and
reserves the OLED/menu surface until transfer completion, idle close, or
timeout.

RP2040 flash writes stop interrupts on both cores. Route every runtime write
through `flashSafeSave()` or `beginFlashSafeWrite()` /
`endFlashSafeWrite()`. The sequence is:

1. show the save/mute screen;
2. fade audio to idle;
3. quiesce DMA and block restart;
4. write;
5. restore audio and display ownership.

Stores compare existing records or checksums before writing. Apply-only object
transfers and live synth edits do not enter the flash-safe path.

Use `RAM_FUNC(name)` selectively for measured hot paths. Current RAM placement
includes audio render/refill, scan and rotary decoding, MIDI sends, voice
allocation, compact LED work, and renderer lookup tables. OLED/GEM drawing
remains in flash because I2C and library calls dominate it.

## Source Map

- `app/`: lifecycle, platform helpers, defaults, diagnostics, and benchmarks
- `config/`: compile-time feature flags
- `hardware/`: board constants, matrix state, buttons, rotary, LEDs, animations
- `midi/`: transport, parser, routing, dispatch, MPE, delegated control
- `model/`: layouts, scales, palettes, presets, pitch assignment, user-geometry
  runtime state
- `tuning/`: tuning math, tables, Dynamic JI
- `synth/`: public synth API, audio transport, renderer, oscillators, envelopes,
  modulation, voices, arpeggiator, and metronome
- `storage/`: settings, persistent models, catalogs, factory rescue geometry,
  preset sync, and storage health
- `menu/`: GEM/OLED pages, overlays, and virtual catalog browsers
- `sequencer/`: optional sequencer policy, playback, UI, files, and USB Backup

Each `.cpp` includes direct headers and compiles independently. Shared
declarations belong in the nearest owning subsystem header. Synth modules expose
cross-subsystem behavior through `SynthAudio.h`; `SynthAudioInternal.h` is
synth-private.

## Runtime State And Ownership

`buttonDef h[BTN_COUNT]` owns the matrix state:

- `LED_COUNT = 140`
- `BTN_COUNT = 160`
- visible buttons are `0..139`
- slot `140` is hardware detection
- slots `141..159` are hidden synth-preview/action slots
- physical center is button `65`

`presetDef current` owns active tuning, layout, scale, key, and transpose.
Pitch code should use it rather than duplicate tuning or layout math.

`UserGeometryRuntimeState userGeometryRuntime` groups the selected user tuning,
layout, scale, palette, object IDs, per-button overrides, and chord actions.
It is owned by the model subsystem. `NoteDispatch.cpp` owns direct/chord MIDI
reference counts and hidden synth handles.

`DelegatedControlState delegatedControlState` groups delegated colors, note
maps, display requests, and active notes. Fields shared by Core 1 MIDI handling
and Core 0 controls/rendering are atomic; the app name is published before the
atomic active-state transition.

`midiNoteToHexIndices` uses fixed bitsets, avoiding per-note heap allocation
while preserving fast incoming-MIDI LED lookup.

There are nine settings profiles. Slot 0 is the boot/auto-save slot:

```cpp
uint8_t settingsProfiles[PROFILE_COUNT][NUM_SETTINGS];
uint8_t* settings;
```

Do not add allocation, blocking work, or large logging bursts to scan, rotary,
MIDI dispatch, LED render, or ISR-adjacent synth paths. Storage and transfer code
may use dynamic containers only with explicit size ceilings and outside those
paths.

## Startup And Loops

Core 0 initializes in dependency order:

1. USB descriptors, logging, USB MIDI, and serial MIDI
2. LittleFS without auto-format
3. pins, grid, and hardware revision
4. settings and storage catalogs
5. LEDs, OLED, rotary, menu, and synth tables
6. runtime settings and pitch-bend state
7. Core 1 audio release and bounded readiness wait
8. sequencer restore, storage status, and boot LED check
9. normal two-core runtime

If audio readiness times out, Core 0 continues with onboard synth playback
disabled instead of hanging boot. Do not use loaded settings before
`load_settings()` or menu objects before `setupMenu()`.

Core 0 work must remain bounded. Its loop covers transfer service, synth-release
cleanup, screensaver, matrix scan, sequencer, arpeggiator, metronome, command
wheels, MIDI input, LED work, rotary/menu input, overlays, and auto-save.
The U8g2 hardware-I2C backend still performs synchronous `Wire` transfers, so
played-note events only mark pending display state. Their OLED wake and redraw
are coalesced until `30 ms` of input quiet and limited to one refresh per `50 ms`;
menu and modal redraws are not subject to that performance-input policy.

Core 1 stays limited to audio DMA service, delegated MIDI when active, and the
RAM-resident allocation-free rotary decoder.

Rotary inversion is:

```text
effective direction = detected hardware default XOR saved user reversal
```

## Pitch And Refresh Paths

Mapping order:

1. `applyLayout()` computes button steps from vectors, mirrors, and rotation.
2. `applyScale()` marks scale membership.
3. `assignPitches()` computes MIDI, bend, channel, synth frequency, and reverse
   MIDI-note lookup.

`Flip L/R` preserves physical button 65 as the mirror center.

| Function | Use |
| --- | --- |
| `applyScale()` | key, scale, lock, or membership changes |
| `assignPitches()` | transpose or pitch math without position changes |
| `updateLayoutAndRotate()` | vectors, musical rotation, or mirrors |
| `applyDeviceDisplayRotation()` | OLED/device orientation only |
| `refreshMidiRouting()` | MPE, channel, or tuning-dependent routing |
| `setLEDcolorCodes()` | palette, scale, brightness, or user color map |

## Settings And Persistence

`/settings.dat` contains `STG`, version, default profile, nine setting-byte
profiles, stable tuning/layout/scale references, per-profile wavetable
references, and payload CRC32.

`CURRENT_SETTINGS_VERSION` is 27. Firmware accepts only that version and exact
payload size. Invalid or missing settings use hardware-aware RAM defaults and
are written only by normal save behavior.

The selected key offset is a signed 16-bit value stored in the
`CurrentKeyStepsFromA` low byte and `CurrentKeyStepsFromAHigh` high byte.

`SettingKeys.inc.h` is the ordered source for `SettingKey` and
`factoryDefaults`. The factory generator reads the same key order plus
`PROFILE_COUNT` and `CURRENT_SETTINGS_VERSION` from firmware source, then
requires `factory-library/config.json` to supply exactly those keys.

To change a setting:

1. add, remove, reorder, or change its default in `SettingKeys.inc.h`;
2. update `syncSettingsToRuntime()`;
3. add or update menu metadata, preview, and recomputation hooks when visible;
4. update factory config and validation;
5. bump `CURRENT_SETTINGS_VERSION` for layout or meaning changes;
6. update relevant user, developer, protocol, and web documentation.

`universalSaveCallback()` writes the runtime value to `settings[]`, marks it
dirty, and invokes an optional recomputation hook. Transient menu actions such
as LED Test and Serial Debug are not settings.

Persistent stores:

| Store | Owner | Limits and behavior |
| --- | --- | --- |
| `/settings.dat` | `Settings.cpp` | 9 profiles; 10-second dirty save; identical data skipped |
| `/current_synth_preset.dat` | `SynthPresetStorage.cpp` | current preset ID or Blank |
| `/presets/*.hsp` | `SynthPresetStorage.cpp` | HSP v11; up to 128 atomic files |
| `/synth_wavetables.dat`, `/wt_*.wtb` | `SynthWavetableStorage.cpp` | up to 32 entries; base or six mip levels |
| `/geometry/*.hgb` | `PresetSyncGeometry.cpp` | HGB v3/schema 2; up to 64 atomic bundles |
| `/geometry_order.dat` | `PresetSyncGeometry.cpp` | small HGO v1 ordering override |
| `/default_geometry.dat` | factory image | selected factory tuning reference |
| `/Sequences` | `SequencerStorage.cpp` | optional `.hbseq` files and `.current` |

Geometry bundles contain a tuning root and linked layouts, scales, color maps,
and explicit maps. Limits are 255 records and 262,144 bytes per bundle, 16,384
bytes per object, and 32 linked layout/scale menu entries. Menus retain metadata
only; bodies stream when validated, transferred, or applied.

Runtime tuning capacity is 1,024 divisions. Scale membership is a 1,024-bit
bitset; EDO and equal-step tunings keep no per-division pitch table. Cents-list
values, custom labels, and custom degree colors allocate packed storage only
for the active tuning. Default labels are generated on demand, and default
colors are generated while refreshing the 140 physical-key caches rather than
retained as maximum-sized arrays.

Factory UF2 content includes the formatted filesystem. Only 12 EDO and Basic
Shapes remain compiled as rescue data. Boot mounts once, validates stores
independently, records the first eight failures for Storage Status, and performs
no repair writes. Mount failure disables saving.

## Menu And Display

Persistent menu items combine:

- a `SettingKey`;
- `PersistentCallbackInfo`;
- a `GEMItem`;
- page insertion;
- optional preview and post-change hooks.

Catalogs use `VirtualListMenu`, not a GEM tree per stored object. The shared
128×128 layout has an 18-pixel header, divider at y=15, and rows beginning at
y=18. Stored non-root folder paths omit a leading slash.

Profile and storage-status `GEMItem` objects use fixed startup pools rather than
unowned heap allocation.

Display owners—menu, virtual list, sequencer, delegated control, preset
transfer, flash save, command wheel, and played notes—must restore or dismiss
the previous owner explicitly. Screensaver transitions go through
`enterDisplayScreensaver()` and `wakeDisplayFromScreensaver()`.

`HexBoardDisplay` snapshots each completed 128x128 framebuffer and sends it with
Core 0 I2C DMA. A newer redraw is coalesced while the active snapshot is in
flight, and the next snapshot is taken only between main-loop drawing passes.
Only byte spans that differ from the image already sent to the OLED are
transferred. Each affected SH1107 page combines its address commands and the
smallest enclosing changed-column span into one I2C transaction. Core 0 polls
DMA completion and performs all frame-state and subsequent Wire operations at
safe main-loop boundaries; the transport installs no application callback in
`DMA_IRQ_0`.
The async path explicitly reapplies the configured 1 MHz I2C clock. Terminal
transitions such as rebooting into the USB bootloader drain the queued frame
before leaving firmware control.
Runtime contrast and power-save commands use the same asynchronous queue. Wire
owns `DMA_IRQ_0` on Core 0; audio owns `DMA_IRQ_1` on Core 1, so neither core
services the other subsystem's DMA completion line.

Rotary turns that navigate the GEM menu, virtual lists, or Sequencer UI are
accepted only when the preceding display frame has completed. The Core 1 rotary
decoder retains one pending direction while a frame is in flight, matching the
former blocking display behavior without blocking note, MIDI, or audio work.

Dynamic display content—including played notes, command-wheel overlays, and
preset-sync progress—shares a 20 Hz maximum presentation cadence. Each producer
retains its latest state between frames; initial screens and transfer completion
remain immediate. Command-wheel values are elapsed-time based and cap catch-up
work without extending the menu wake timer. Velocity, modulation, and pitch
bend share one steady 10 ms motion scheduler. A fractional step accumulator
preserves approximately the same travel time for each saved speed choice,
including sub-step rates, without compressing missed updates into catch-up
jumps.

## MIDI And Tuning

Output supports single-channel MIDI, extended channel folding, MPE pitch bend,
optional MPE extras, serial MIDI, incoming-note LEDs, and program changes.

Live USB packets use a short bounded retry and backoff when the host stops
polling. SysEx streaming uses the longer transfer timeout.

The global pitch-bend wheel sends at up to 100 messages per second. A serial
pitch-bend message occupies 30 bits including UART framing, so this rate uses
about 9.6% of the 31.25 kbaud DIN MIDI link before other traffic.

`mpeChannelBitmap` tracks available MPE channels. Dynamic JI keeps synth and
external MIDI retuning separate: synth uses the frequency multiplier; external
MPE chooses the nearest note and sends residual bend. Note-off uses
`activeMidiNote`.

Protocol details live in `docs/delegated-control.md` and
`docs/preset-sync-sysex.md`.

## Synth

The synth is independent of external MIDI. Playback modes are Off, Mono
Retrigger, Mono Legato, Arpeggio, and Poly.

Core 1 renders two 64-sample DMA buffers. A PWM timer slice paces output at about
40.7 kHz for the 250 MHz target. Hardware V1.2 selects jack or piezo; V1.1 uses
piezo.

Active wavetables use a `16 × 512` base table and fixed mip levels. Modulation
and envelopes update on a 32-sample control quantum. Per-sample rendering uses
cached ramps and RAM-resident drive lookup tables.

Voice stealing protects the lowest held voice, then prefers duplicate, released,
and remaining held voices by age. Replacement waits for renderer-side handoff
fade. Review timer setup, ISR cost, command publication, ownership, release
retries, flash muting, and hardware-specific output for every synth change.

## LEDs

`setLEDcolorCodes()` updates cached rest, dim, off, play, and animation colors.
All palette-derived modes share one key-aware color origin.

`lightUpLEDs()` builds the final RGB frame, applies the current limiter, then
calls `strip.show()`. The limiter therefore covers normal, animation, delegated,
and sequencer frames.

Incoming MIDI depth can coalesce dense LED changes. Sequencer note colors use
the base palette hue/saturation cache and apply step brightness before final
gamma and current limiting.

## Sequencer And Web Integration

Sequencer policy stays under `src/firmware/sequencer/`. Shared firmware exposes
narrow bridges for realtime MIDI, played-note rendering, LED overrides, hidden
synth preview notes, storage, file menus, and USB Backup.

Profile preferences belong in the settings schema; sequence data belongs in
`.hbseq` files. Every sequencer filesystem write uses the flash-safe write API.
User behavior and requirements live under `docs/sequencer/`.

Update `web/` whenever firmware schemas, protocol, capabilities, or behavior
change what the app sends, receives, lists, previews, or validates. Protocol,
catalog, and MIDI helpers live under `web/src/protocol/`,
`web/src/catalogs/`, and `web/src/midi/`.

## Risk Areas

- ISR-adjacent synth and audio work
- scan, rotary, command-wheel, note-dispatch, and LED paths
- cross-core state and readiness handshakes
- settings schema and factory defaults
- flash writes and mute/DMA coordination
- delegated and preset-sync parsers and transfer state
- geometry apply synchronization
- hardware-version-specific MIDI and audio behavior
- dynamic storage/transfer containers and their size ceilings

## Edit Recipes

Factory tuning, layout, and scale changes start in a web-compatible
`hexboard.tuningBundle.v1` tuning bundle under
`factory-library/geometry/`. Run the generator, validate linked IDs and virtual
browser filtering, then test pitch, MPE, synth, labels, mirrors/rotation, and LED
behavior as applicable.

Preset-sync object changes require synchronized firmware validation and
capabilities, `docs/preset-sync-sysex.md`, web protocol/catalog/mock transport,
and real-device list/read/write/apply/delete/abort testing.

## Verification

Always run:

```sh
git diff --check
```

Run `make` for firmware changes and the factory generator plus relevant web
tests/build for factory or companion-app changes.

Manually cover affected categories:

- clean, missing, and invalid settings/storage boot
- profile save/load and auto-save
- MIDI note lifecycle, MPE range, and retuning
- synth playback modes and hardware outputs
- buttons, wheels, rotary, panic, overlays, and screensaver
- palettes, custom maps, animations, and incoming-MIDI LEDs
- delegated-control entry/events/exit
- preset-sync list/read/write/apply/delete/abort and timeout
- sequencer playback, files, and USB Backup when enabled

Docs-only changes require `git diff --check`, not a firmware compile.
