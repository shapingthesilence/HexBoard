# HexBoard Firmware Developer Guide

## Purpose

This guide is the current implementation reference for people editing HexBoard
firmware. The root `HexBoard.ino` sketch only contains Arduino lifecycle
wrappers; implementation lives in modules under `src/firmware/`. Use this guide
to find the right subsystem, understand the side effects of a change, and choose
the verification path.

The source remains the final truth. When this guide and code disagree, trust the
code and update this guide as part of the change.

## Documentation Ownership

Every behavior, setting, protocol, menu, build, hardware, or architecture change
should include a documentation pass.

- `README.md`: project overview, build target, feature highlights, repository layout, or top-level build/flash pointers
- `docs/user-manual.md`: user-visible behavior, menu items, defaults, workflows, troubleshooting, hardware-facing usage, and firmware updates
- `docs/sequencer-manual.md`: optional sequencer behavior, sequencer settings, sequence files, and USB Backup
- `docs/developer-guide.md`: current firmware architecture, subsystem ownership, settings wiring, runtime flow, risk areas, edit recipes, and verification
- `docs/delegated-control.md`: external delegated-control protocol, SysEx behavior, host integration, and delegated runtime gates
- `docs/preset-sync-sysex.md`: preset-sync SysEx behavior, object schemas, host integration, and future tuning/layout/preset storage design
- `web/README.md`: companion web app install, local development, deployment, and current app scope

If a code change does not require docs, say why in the final implementation
notes.

## Build And Tooling

The documented firmware stack is:

- RP2040 core from Earle Philhower
- Pico SDK USB stack with the core `MIDIUSB` wrapper
- Libraries: `Adafruit NeoPixel`, `U8g2`, `Adafruit GFX Library`, `GEM`

Typical local firmware build:

```sh
make
```

The `Makefile` compiles the repository sketch directly with:

- Board: `rp2040:rp2040:generic`
- Flash: `16 MB`, split as `8 MB` sketch / `8 MB` LittleFS
- CPU: `250 MHz`
- Boot stage 2: `Generic SPI /4`
- USB stack: `picosdk`
- USB manufacturer/product build descriptors: `HexBoard`

The `Generic SPI /4` boot2 selection is required for the local `250 MHz` build
to avoid overdriving external flash; `Generic SPI /2` may compile but can crash
the board at runtime. The higher CPU clock gives the synth block renderer enough
headroom for dense AHDSR and FX-envelope patches that can otherwise report
overruns.

The onboard synth PWM resolution is selected at build time:

```sh
make PWM_BITS=9
```

Supported values are `8`, `9`, and `10`; the default is `10`.

The optional sequencer is gated by `HEXBOARD_ENABLE_SEQUENCER`, which defaults
to `0` in both `Makefile` and `src/firmware/config/FeatureFlags.h`:

```sh
make HEXBOARD_ENABLE_SEQUENCER=1
make sequencer-builds
```

Default and sequencer builds are renamed to:

```text
build/HexBoard.uf2
build/HexBoard_Sequencer.uf2
```

The companion app is intentionally self-contained under `web/`. Keep Node
package files there rather than adding root-level web tooling unless the repo is
deliberately converted into a broader monorepo. See `web/README.md` for web app
commands and deployment.

## Architecture

The firmware is split across the RP2040's two cores:

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
              -> command-wheel value updates -> drawCommandWheelOverlay()
              -> played-note snapshot -> drawPlayedNotesOverlay()

rotary encoder -> readKnob() on core 1 -> dealWithRotary() on core 0 -> GEM menu

external host SysEx -> delegated control or preset sync
```

Firmware MIDI input uses a HexBoard-owned byte parser over the Pico SDK
`MIDIUSB` byte stream and `Serial1`, so SysEx assembly does not depend on the
Arduino MIDI library parser. Chunked preset-sync object transfers open a short
modal transfer window on core 0 that pumps MIDI input and pauses normal
menu/button/LED work until the transfer is idle or times out. One-frame control
messages such as hello/list/delete and live synth parameter sets process inline.

Flash writes on RP2040 disable interrupts on both cores. Firmware routes writes
through `flashSafeSave()` / `beginFlashSafeWrite()` so the OLED explains the
temporary mute, audio output fades toward idle before interrupts are blocked,
and the prior display state is restored afterward.

Performance-sensitive code can use `RAM_FUNC(name)` to run from SRAM instead of
external-flash XIP. Keep this selective. Current RAM placement favors the audio
block renderer and DMA refill helpers, button scan, command-wheel update, MIDI
note/wheel sends, synth voice allocation, rotary quadrature polling, compact LED
frame helpers, and small synth lookup tables read by the renderer. Avoid moving
OLED/GEM/U8g2 drawing wholesale; those paths are dominated by library calls and
I2C transfer time.

The command-wheel OLED readout follows that split: the RAM-resident wheel path
only records lightweight overlay state when a velocity, modulation, or
pitch-bend value changes or a command-wheel gesture requests feedback, while the
normal display phase renders the full screen with throttled redraws. Other OLED
renderers dismiss the command-wheel readout before drawing so menu, list,
Sequencer, played-note, delegated-control, save, and transfer screens always own
the display they update.

## Source Map

Primary entry points:

- `HexBoard.ino`: Arduino lifecycle wrappers only
- `src/firmware/FirmwareModule.h`: shared Arduino/RP2040/library includes and `RAM_FUNC`
- `src/firmware/HexBoardFirmware.h`: lifecycle API used by the root sketch
- `src/firmware/config/`: compile-time feature flags and source-level build toggles

Firmware subsystems:

- `src/firmware/app/`: platform/common helpers, non-synth runtime defaults, diagnostics/timing, and lifecycle orchestration
- `src/firmware/tuning/`: tuning tables, shared tuning math, and Dynamic JI retuning
- `src/firmware/model/`: layout tables, scale/palette/preset models, and pitch assignment
- `src/firmware/hardware/`: board constants, grid state, command buttons, scan/rotary handling, LED rendering, and LED animations
- `src/firmware/midi/`: USB/serial transport, MPE/routing, external MIDI LED state, delegated control, MIDI input parsing, and MIDI note dispatch
- `src/firmware/synth/`: synth defaults, built-in waveform and wavetable catalogs, render orchestration, audio transport, oscillator/wavetable runtime, envelopes, modulation caches, voice allocation, arpeggiator, and metronome
- `src/firmware/storage/`: persistent data models, settings/profile storage, synth preset/wavetable storage, and preset-sync protocol/geometry/synth-object/message handling
- `src/firmware/menu/`: OLED/GEM pages and settings callbacks, played-note drawing, synth preset menu rebuilding, and synth wavetable menu rebuilding
- `src/firmware/sequencer/`: optional sequencer state, input, LED rendering, menu pages, file storage/browser flows, USB Backup, MIDI playback bridge, transport timing, and integration hooks

Important shared declarations live in `hardware/HardwareConfig.h`,
`hardware/GridState.h`, `tuning/Tuning.h`, `model/Layout.h`,
`model/ScalePalettePreset.h`, and `storage/PersistentDataModels.h`. Add shared
types, constants, and function declarations to the nearest owning subsystem
header. Keep implementation-private globals in the owning `.cpp` when no other
module needs them.

Each firmware `.cpp` must build independently with direct headers. Fix missing
declarations by improving the owning headers instead of including `.cpp` files.

## Core Runtime Data

`buttonDef h[BTN_COUNT]` is the central scan-matrix state. Stable board
dimensions and pin assignments are declared in `HardwareConfig.h`; `buttonDef`,
`wheelDef`, command-button map, runtime user-geometry state, and delegated-control
globals are declared in `GridState.h`. Current board constants are:

- `LED_COUNT = 140`
- `COLCOUNT = 10`
- `ROWCOUNT = 16`
- `BTN_COUNT = 160`
- `FIRST_FLAG_BUTTON_INDEX = LED_COUNT`
- `HEXBOARD_CENTER_BUTTON = 65`

Visible buttons are indices `0` through `139`. Matrix slots `140` through `159`
are internal flags and hardware-detection positions, not playable hexes. Slots
`141..159` are also used by sequencer-managed synth preview notes; slot `140`
remains reserved for hardware detection.

`presetDef current` owns the active tuning, layout, scale, key offset, and
transpose offset. Pitch-related code should go through this object instead of
duplicating tuning/layout math.

Settings are stored in:

```cpp
uint8_t settingsProfiles[PROFILE_COUNT][NUM_SETTINGS];
uint8_t* settings;
```

There are `9` profiles. Slot `0` is the boot and auto-save slot. `NUM_SETTINGS`
is derived from `SettingKey::NumSettings`, so adding settings requires updating
the enum, defaults, runtime sync, menu wiring, migration behavior, and docs
together.

The code still uses dynamic containers in live or near-live paths:

- Dynamic JI held-note/ratio state
- `midiNoteToHexIndices`
- incoming SysEx assembly
- synth release/retry state

Do not add heap allocation to button scan, command-wheel, MIDI note dispatch,
LED render, or ISR-adjacent synth paths without a clear reason and focused
verification.

## Startup And Loops

Core 0 startup currently:

1. sets USB manufacturer/product descriptors to `HexBoard`
2. starts USB serial logging
3. disables the synth alarm IRQ before setup is complete
4. starts Pico SDK USB MIDI and serial MIDI interfaces
5. waits briefly for USB MIDI enumeration before flash access
6. mounts LittleFS
7. configures I2C
8. configures scan pins and grid state
9. detects hardware revision
10. loads settings
11. starts LEDs, display, rotary input, and menu objects
12. applies hardware-specific menu behavior
13. syncs saved settings to runtime globals
14. recomputes pitch bend factors
15. runs the bounded boot LED self-check

Place new initialization where its dependencies are already valid. Do not rely
on loaded settings before `load_settings()` or menu objects before `setupMenu()`.

Core 0 loop is deliberately broad but should remain bounded:

- timing
- synth release cleanup and pending release retries
- OLED screensaver
- button scan
- arpeggiator
- command-button wheels
- incoming MIDI
- LED animation and render
- encoder click/menu handling
- played-note OLED overlay drawing
- debounced auto-save

Core 1 loop stays narrow:

- audio DMA buffer service
- `readKnob()`
- `processIncomingMIDIDelegated()` when delegated control is active

Heavy work, blocking waits, large debug bursts, and new heap allocations in
either loop can cause sluggish controls, LED jitter, or audio artifacts.

## Pitch, Layout, And Refresh Paths

The mapping chain is:

1. `applyLayout()` computes `stepsFromC` from layout vectors, mirroring, and rotation.
2. `applyScale()` marks whether each playable hex is in the active scale.
3. `assignPitches()` computes MIDI note, extended MIDI index, channel, bend, synth frequency, and reverse note lookup.

`Flip L/R` mirrors layout vectors and then offsets the result so physical button
`65` remains the mirror center.

Common refresh functions:

| Function | Use when |
| --- | --- |
| `applyScale()` | key, scale, scale-lock, or in-scale logic changes |
| `assignPitches()` | transpose or pitch math changes without moving button positions |
| `updateLayoutAndRotate()` | layout, mirror flags, layout rotation, or device/display rotation changes |
| `applyDeviceDisplayRotation()` | only the OLED/device orientation changed |
| `refreshMidiRouting()` | MPE, MIDI channel, or tuning-dependent routing rules change |
| `setLEDcolorCodes()` | palette, scale, color mode, brightness, or user color-map behavior changes |

Choosing the wrong refresh path creates stale LEDs, stale MIDI note assignments,
or bad synth frequencies.

## Settings And Persistence

Settings are stored in LittleFS at `/settings.dat` with:

- magic bytes `STG`
- settings file version
- default profile index field
- CRC32 of all profile bytes

`CURRENT_SETTINGS_VERSION` is currently `23`, and `PROFILE_COUNT` is `9`.
Version `20`, `21`, and `22` settings files migrate by copying previous profile
bytes and filling newly appended settings from factory defaults. Other
settings-schema mismatches restore factory defaults and rewrite `/settings.dat`.

Important current settings facts:

- `DisplayPlayedNotes` is `Off`/`Label`/`Number`; it defaults to `Label`.
- `Serial Debug`, `LED Test`, and `Stability` are transient Advanced-menu states, not `SettingKey` entries.
- `BootAnimationEnabled` is persisted and defaults to enabled.
- `LedCurrentLimitMode` stores the user-visible current-limit mode; runtime budgets are hardware-calibrated for `V1.1` and `V1.2`.
- `PlaybackMode` defaults to `Poly`; legacy transient `PolyTbl` values normalize to `Poly`.
- `AudioDestination` behaves on hardware `V1.2` as a jack-default `Buzzer` toggle that switches synth output to piezo.
- `HeadphoneVolumeCap` and `PiezoVolumeCap` are separate profile bytes; synth presets intentionally do not store output volume.
- Dynamic JI stores its prime-limit table in `DynamicJIRatioTable`.
- Sequencer `Clock Source`, `Send Clock`, `Send Transport`, `Tap Preview`, `Monophonic`, and `Seq Lights` preferences are profile bytes, not sequence-file data.

When adding, removing, reordering, or reinterpreting a `SettingKey`:

1. Add or update the enum entry.
2. Update `factoryDefaults`.
3. Load it in `syncSettingsToRuntime()`.
4. Add menu callback metadata and page wiring if user-visible.
5. Decide whether a preview callback is needed.
6. Decide which post-change function keeps runtime state consistent.
7. Bump `CURRENT_SETTINGS_VERSION` if persisted byte layout or interpretation changes.
8. Add migration or document why defaults-only fallback is acceptable.
9. Update user/developer/protocol docs as appropriate.

Other persistent stores:

- `/synth_presets.dat`: named/foldered synth presets, magic `SYP`, version `10`, up to `128` presets. Presets store sound-focused synth settings plus a wavetable folder/name dependency, but not active output volume.
- `/current_synth_preset.dat`: current loaded synth preset reference, magic `CSP`, version `1`. It stores either the loaded preset object ID or the special `Blank` state; the edited synth values still come from normal settings/profile storage.
- `/synth_wavetables.dat`: named user wavetable catalog, magic `SYW`, version `1`, up to `32` entries. Sample files use shortened `/wt_<16 hex>.wtb` paths and can contain six fixed mip levels (`49,152` bytes) or legacy base-only data (`8,192` bytes).
- `/profile_wavetables.dat`: per-profile wavetable folder/name snapshots, magic `PWT`, version `1`.
- `/layouts.dat`: user geometry catalog, magic `LYT`, version `2`, up to `64` raw object bodies across `UserTuning`, `UserLayout`, `UserScale`, `ScaleColorMap`, and `ExplicitButtonMap`.
- `/Sequences`: optional sequencer `.hbseq` files plus `.current` remembered path when sequencer support is enabled.

Factory tuning/layout/scale catalogs are exposed as generated read-only geometry
objects from `BuiltinGeometry.cpp`; they are not stored in `/layouts.dat`.
Runtime Apply supports generated EDO/equal-step and Scala/cents-list user
tunings, vector layouts, included-degree scales, scale color maps, and format-1
explicit button maps. The active user geometry selection is RAM-only and is not
yet persisted in profiles.

## Menu Patterns

Most persistent menu items follow this pattern:

1. `SettingKey` entry
2. factory default
3. runtime sync in `syncSettingsToRuntime()`
4. `PersistentCallbackInfo`
5. `GEMItem`
6. page insertion in `setupMenu()`
7. optional preview callback
8. optional post-change recomputation hook

`universalSaveCallback()` is the standard writeback path. It reads the runtime
value, writes it into `settings[]`, marks settings dirty for auto-save, and runs
an optional post-change hook.

Use post-change hooks for side effects such as:

- `refreshMidiRouting()`
- `updateLayoutAndRotate()`
- `setLEDcolorCodes()`
- `resetSynthFreqs()`
- `updateEnvelopeParamsFromSettings()`

Virtual browsers use `VirtualListMenu` instead of allocating one GEM page/item
tree per file, preset, wavetable, tuning, layout, or scale entry. Launcher rows
are GEM link items visually, and `dealWithRotary()` routes their select key
through `handleVirtualListLauncherKey()` before normal GEM dispatch. Current
rows use a diamond in the left action-icon slot.

Transient Advanced-menu items, such as `LED Test`, `Stability`, and `Serial
Debug`, should stay out of `factoryDefaults` and should not trigger a settings
version bump.

## MIDI And Tuning Notes

The firmware sends and receives MIDI through:

- USB MIDI through the Arduino-Pico `MIDIUSB` wrapper on the Pico SDK USB stack
- serial MIDI through `Serial1`

The routing model includes:

- normal single-channel MIDI
- extended standard MIDI where out-of-range musical indices are folded across MIDI channels
- MPE with per-note pitch bend
- optional extra MPE messages such as channel pressure and CC74
- incoming MIDI note handling for LED animation
- General MIDI and Roland MT-32 program-change menu tables stored in flash
- optional played-note OLED overlay updates from note on/off state

Live USB MIDI channel messages use `writeUsbMidiPacket()`, which retries only
briefly and backs off if the host stops polling the USB MIDI endpoint. SysEx
stream output keeps the longer write timeout used by preset-sync and identity
responses.

MPE channels are tracked with `mpeChannelBitmap`. `resetMPEChannelPool()`
populates the bitmap from the configured low/high range, `takeMPEChannel()` uses
`__builtin_ctz()` to claim the lowest available bit, and `releaseMPEChannel()`
returns a channel to the pool.

Dynamic JI and JI BPM Sync keep synth and external MIDI retuning separate. The
onboard synth derives `jiFrequencyMultiplier` directly from floating-point
cents. External MPE output chooses the closest MIDI note after retuning, stores
it in `activeMidiNote`, and sends only the residual pitch bend. Note-off must
use `activeMidiNote`, not the button's base `note`.

For the external-only raw button/LED mode, use `docs/delegated-control.md`. For
the object-sync protocol, use `docs/preset-sync-sysex.md`.

## Synth Notes

The synth engine is separate from external MIDI output. A playable button can
trigger MIDI only, synth only, or both depending on current settings.

Playback modes are:

- `Off`
- `MonoRtg`
- `MonoLeg`
- `Arp'gio`
- `Poly`

The synth PWM defaults to `10` bits. At the project's `250 MHz` build target,
the carrier is roughly `488 kHz` in `8`-bit mode, `244 kHz` in `9`-bit mode,
and `122 kHz` in `10`-bit mode. `9`-bit and `8`-bit builds are useful fallback
comparisons if high-register tones sound harsh on the jack path.

Synth audio is rendered on Core 1 into two `64`-sample DMA buffers. A dedicated
PWM timer slice with wrap `1023` and divider `/6` paces DMA writes at about
`40.7 kHz`. Hardware `V1.2` outputs one synth destination at a time: jack by
default, or piezo when `Buzzer` is enabled. Hardware `V1.1` uses piezo.

Named built-in and user wavetables load into a `16 x 512` active RAM base table
plus fixed mip levels. The sampler uses `SynthWavetablePosition` plus signed
`WT Pos` modulation, with modulation work cached on a `16`-sample control
quantum. Built-in factory wavetables are generated by
`web/scripts/generate-factory-wavetables.mjs`, which also writes the firmware
factory wavetable data source.

Poly voice stealing protects the lowest held voice first, then searches for the
oldest duplicate note, oldest released voice, and oldest remaining held voice.
Steals use a renderer-side handoff fade before the replacement note starts.
Keep retune and release paths aware of pending steal handoffs.

Synth changes need extra review when they touch:

- timer alarm setup
- ISR runtime cost
- envelope command publishing or consumption
- channel ownership
- release retry behavior
- flash-save muting
- hardware `V1.1` vs `V1.2` output behavior

## LED And Visualization Notes

LED rendering reflects note state, scale membership, tuning/key relationships,
external MIDI note activity, current animation mode, delegated-control frames,
and sequencer overrides.

The LED state is cached per button in fields such as:

- `LEDcodeRest`
- `LEDcodeDim`
- `LEDcodeOff`
- `LEDcodePlay`
- `LEDcodeAnim`

Call `setLEDcolorCodes()` after changes that affect palette, scale, tuning
relationships, key-centered color placement, brightness, color mode, or loaded
user color maps.

`lightUpLEDs()` writes the final frame into the NeoPixel buffer and then calls
`applyLedCurrentLimitToFrame()` before `strip.show()`. The current limiter works
on final RGB bytes, so it applies to normal playback, animations,
delegated-control LED frames, and sequencer LED overrides.

`ANIMATE_MIDI_IN` responds to incoming NoteOn/NoteOff state maintained by
`externalNoteDepth`. LED refresh can be briefly coalesced after incoming MIDI-in
changes so dense bursts render as one settled frame instead of a visible strip
sweep per note.

Sequencer `Step Color = Note` should use the board palette's base hue/saturation
cache and apply sequencer brightness before the final gamma/current-limit pass.
Do not rescale packed resting LED values for sequencer step brightness.

## Sequencer Integration

The sequencer is optional and default-off at compile time. Current behavior is
documented in `docs/sequencer-manual.md`; keep user workflow details there.

Keep sequencer policy in `src/firmware/sequencer/`. Expected bridge points are
narrow:

- `MidiInput.cpp` forwards MIDI realtime bytes to `SequencerMode`.
- `PlayedNotesOverlay.cpp` shares its renderer with lower-grid sequencer audition notes.
- `LedRender.cpp` exposes base palette color and applies final sequencer LED overrides.
- The synth preview-note API lets sequencer OB Synth output use hidden matrix slots without duplicating voice allocation.
- `SequencerStorage.*` owns `.hbseq` serialization under `/Sequences` and the `.current` remembered path.
- `SequencerFileMenu.*` owns the on-device sequence file browser and naming workflows.
- `SequencerUsbBackup.*` owns the enabled-only HBK1 USB-serial backup session for `/Sequences`.

Sequencer profile-backed settings belong in the main settings schema. Sequence
file data belongs in `.hbseq` files, not profiles.

## Web App Integration

The web app is a companion editing surface for preset-sync workflows. It is not
the firmware source of truth, but firmware changes can require matching updates
under `web/`.

Update the web app when firmware behavior, settings, synth preset schema,
wavetable schema, user geometry schema, preset-sync protocol, or advertised
device capabilities change in a way the app sends, reads, lists, previews, or
validates.

Protocol helpers live under `web/src/protocol/`; catalog models live under
`web/src/catalogs/`; MIDI access and mock transport live under `web/src/midi/`.
Use `web/README.md` for web commands and deployment details.

## Common Edit Recipes

### Add A New Menu-Backed Setting

1. Add the enum entry to `SettingKey`.
2. Add a default byte in `factoryDefaults`.
3. Load it in `syncSettingsToRuntime()`.
4. Create the `PersistentCallbackInfo`.
5. Create the `GEMItem`.
6. Insert it in `setupMenu()`.
7. Decide whether it needs a preview callback.
8. Decide which post-change function keeps runtime state consistent.
9. Decide whether the settings version needs a bump and migration.
10. Update user/developer docs.

### Add A New Tuning

1. Extend the tuning definitions or geometry object generation.
2. Add or generate compatible layouts.
3. Add compatible scales if needed.
4. Verify key labels and key selector behavior.
5. Verify the virtual geometry browsers filter linked layouts/scales correctly.
6. Test MIDI, MPE, synth frequency, and LED color behavior.

### Add A New Layout

1. Add or generate the layout definition.
2. Ensure its tuning association is correct.
3. Verify center, across, and diagonal step vectors.
4. Re-test `applyLayout()` with rotation and mirror options.
5. Verify explicit button maps are preserved or regenerated intentionally.

### Add A New Scale

1. Add or generate the scale definition.
2. Bind it to the right tuning or `ALL_TUNINGS`.
3. Verify the interval pattern covers one cycle.
4. Re-test `applyScale()` and `setLEDcolorCodes()`.

### Change Preset-Sync Objects

1. Update `docs/preset-sync-sysex.md`.
2. Update firmware object validation, list/read/write/delete behavior, and advertised capability bits.
3. Update web protocol/catalog code and mock transport behavior.
4. Verify real-device ACK/NACK, object-list, read, write, overwrite, delete, and transfer-abort paths.

## Risk Areas

- ISR-adjacent synth/audio code and helpers called from it
- button scan, command-wheel, and note dispatch paths
- settings schema/version changes and defaults-only fallback behavior
- flash writes, because they pause interrupt-driven audio even with fade/mute handling
- delegated-control SysEx parsing and LED/button latency
- preset-sync chunked transfers and temporary LittleFS files
- geometry apply paths that must keep pitch, labels, LEDs, and MIDI routing synchronized
- hardware-version-specific behavior around MIDI defaults and synth output
- dynamic containers in live or near-live paths

## Debugging Tips

- Turn on `Advanced` -> `Serial Debug` for runtime logs, heap sampling, or audio counters. The setting is not persisted.
- Use `Advanced` -> `Stability` to run the integrated worst-case benchmark. It reports DMA underruns, audio render overruns, min free heap, max audio block time, voice steals, max main-loop duration, and last Core 0/Core 1 task labels.
- Search by subsystem path and function name with `rg`.
- When a change almost works, verify the refresh function before assuming the math is wrong.
- For timing issues, compare behavior with USB MIDI connected to an active host, connected to a sleeping/non-polling host, and disconnected.

## Verification Checklist

Run or manually verify the areas your change touches:

- `git diff --check`
- compile with the same board options as `Makefile`
- keep `Generic SPI /4` boot2 for `250 MHz` builds
- boot with no settings file
- boot with an existing settings file
- profile save/load and auto-save
- normal MIDI note on/off
- MPE mode and configured MPE channel range
- Dynamic JI and JI BPM Sync if tuning or note dispatch changed
- synth off, mono retrigger, mono legato, arpeggio, portamento, and poly modes
- synth jack and piezo output behavior on relevant hardware
- command-button wheels
- rotary menu input and panic stop
- color modes, including `Custom` and `Diatonic`
- `ANIMATE_MIDI_IN` if external MIDI display behavior changed
- `DisplayNotes` `Off`/`Label`/`Number`, compact badge, screensaver overlay, 12-EDO chord labels, non-12 tunings, release grace, and screensaver wake
- delegated-control enter, LED update, note map, button event, encoder event, and exit SysEx
- preset-sync list/read/write/delete/apply paths for affected objects
- sequencer entry/playback/file/USB Backup paths when sequencer code or shared bridge points changed

For docs-only changes, a compile is not necessary, but run `git diff --check`
and keep terminology aligned with `HexBoard.ino` and `src/firmware/`.
