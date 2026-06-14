# HexBoard Firmware Developer Guide

## Purpose

This guide is for someone jumping into the current firmware. The root `HexBoard.ino` sketch only contains Arduino lifecycle wrappers; implementation lives in modules under `src/firmware/`. The goal here is to help you find the right place to edit, understand what side effects a change will have, and avoid the easy regressions.

For a longer historical deep dive, see `docs/code-analysis.md`, but treat this guide and the source as the current truth.

## Repo Entry Points

- `AGENTS.md`: repo-level AI agent instructions. Future AI agent work should treat documentation updates as part of every behavior, setting, protocol, menu, build, hardware, or architecture change.
- `HexBoard.ino`: root Arduino sketch entrypoint with only `setup()`, `loop()`, `setup1()`, and `loop1()` wrappers
- `src/firmware/`: primary firmware source modules
- `web/`: isolated Vite/React companion app for preset-sync workflows
- `.github/workflows/pages.yml`: GitHub Actions deployment for the static web app on GitHub Pages
- `Makefile`: local build shortcut that compiles the root sketch and firmware modules
- `docs/code-analysis.md`: older, broader analysis document
- `docs/delegated-control.md`: external delegated-control protocol and implementation notes
- `docs/preset-sync-sysex.md`: protocol design for implemented synth-preset sync, wavetable import, raw user geometry catalog storage, EDO/equal-step live geometry Apply, and future profile/Scala sync

Keep the root `HexBoard.ino` thin. Do not edit generated files under `build/` as a source of truth.

## Documentation Discipline

Any code change should include a documentation pass before it is considered complete. Update the docs that match the user-facing or developer-facing impact:

- `README.md` for project overview, build target, feature highlights, repository layout, or build/flash instructions
- `docs/user-manual.md` for user-visible behavior, menu items, defaults, workflows, troubleshooting, or hardware-facing usage
- `docs/developer-guide.md` for implementation patterns, settings wiring, architecture, source map, risk areas, or edit recipes
- `docs/code-analysis.md` for subsystem-level technical analysis, runtime flow, settings schema/version, verification checklist, or current implementation facts
- `docs/delegated-control.md` for external delegated-control protocol, SysEx behavior, host integration, or delegated runtime gates
- `docs/preset-sync-sysex.md` for preset-sync SysEx behavior, object schemas, host integration, or future tuning/layout/preset storage design

If a code change does not require docs, say why in the final implementation notes.

## Build And Tooling

The current documented stack is:

- RP2040 core from Earle Philhower
- Pico SDK USB stack with the core `MIDIUSB` wrapper
- Libraries: `Adafruit NeoPixel`, `U8g2`, `Adafruit GFX Library`, `GEM`

Typical local build flow:

```sh
make
```

The `Makefile` currently compiles with:

- Board: `rp2040:rp2040:generic`
- Flash: `16 MB`, split as `8 MB` sketch / `8 MB` LittleFS
- CPU: `250 MHz`
- Boot stage 2: `Generic SPI /4`
- USB stack: `picosdk`
- USB manufacturer/product build descriptors: `HexBoard`

If you build manually, match the options in `Makefile`.
The `Generic SPI /4` boot2 selection is required for the local `250 MHz` build to avoid overdriving external flash; `Generic SPI /2` may compile but can crash the board at runtime. The higher CPU clock gives the synth block renderer enough headroom for dense AHDSR and FX-envelope patches that can otherwise report overruns.

The `Makefile` accepts `PWM_BITS=8`, `PWM_BITS=9`, or `PWM_BITS=10` for onboard synth PWM comparisons:

```sh
make PWM_BITS=9
```

The default is `10`.

### Web App Tooling

The companion app is intentionally self-contained under `web/`. Keep Node
package files there rather than adding root-level web tooling unless the repo is
deliberately converted into a broader monorepo.

Typical local web flow:

```sh
cd web
npm install
npm run dev
npm test
```

The app uses Vite, React, TypeScript, and Vitest. It targets browser Web MIDI
SysEx and includes a mock MIDI transport for object types that firmware does not
support yet. The compact header device menu opens Web MIDI ports, probes
candidate input/output pairs with preset-sync `HELLO_REQ`, verifies protocol
major version and synth preset schema support from `HELLO_RESP`, and only shows
a device selector when multiple compatible HexBoards respond. Real-device synth
preset saves and Serum/Vital or HexBoard wavetable imports use an ACKed write path through
`WRITE_COMMIT`; live preview remains a fast runtime-apply write path and marks
settings dirty for debounced profile autosave. The synth editor reads the
current runtime synth patch from handle `0x3FFF` before enabling live sends, and
preset open sends a runtime-apply preview immediately for auditioning. The
editor mirrors firmware synth-mode, portamento, arpeggiator
speed/direction, tempo, named wavetable dependency, wavetable position,
phase-warp, and LFO controls for synth preset schema `7`, and splits the synth library into
`Presets` and `Wavetables` views. The editor keeps opened presets as temporary drafts;
save actions assign a fresh object id for a
unique folder/name and only reuse an existing object id after the user confirms
an overwrite for that same folder/name. HexBoard Library refresh uses object-list
metadata as a fallback so device presets still appear if a full object body read
fails. Folder names are display strings in the app; literal `/`, `\`, and `%`
characters are percent-escaped only in the device-facing folder path, and folder
chips filter each synth library pane until clicked again.

Current web source layout:

- `web/src/protocol/`: preset-sync SysEx framing, 7-bit packing, CRC32, ACK/NACK,
  transfer payloads, and TLV object bodies
- `web/src/catalogs/`: `/layouts.dat` user tuning/layout/scale/color/map models
  and named/foldered synth preset catalog models; the web-only layout bundle
  model keeps one tuning, one custom scale-degree color set, multiple layouts,
  multiple scales, and per-layout button overrides together. The color-map
  object uses a generic name because the firmware color-mode menu should name
  that mode generically. User-facing vector layouts remain `acrossSteps +
  upRightSteps`, translate to the legacy `DownLeftSteps` TLV only at the
  protocol boundary, and store a four-step `0/90/180/270` device orientation
  value matching the firmware `DeviceRotation` setting. The tuning/layout
  preview paintbrush writes the same per-layout button color override fields as
  the selected-key inspector. The tuning/layout editor sidebar keeps `Tuning`,
  `Layouts`, and `Scales` in subtabs. Scales are edited with `includedDegrees`
  only; the text input validates on blur so incomplete text can exist while a
  user is typing. EDO and equal-step tunings store editable `keyLabels` and
  `referenceHz`; key labels default to degree-number strings and use the same
  draft-then-blur validation style. Equal-step layout-bundle tunings store step
  cents plus cycle length in the editor model; protocol `PeriodMilliCents` is
  derived during encoding. Scala layout-bundle tunings derive period, cycle
  length, labels, and reference pitch from imported file data instead of
  exposing those as separate editor fields. The tuning/layout editor uses
  real-device `Save`, `Apply`, and `Verify` controls: `Save` writes all bundle
  objects with `SaveToFlash`, `Apply` writes the active EDO/equal-step runtime
  objects with `ApplyToRuntime | SaveToFlash`, and `Verify` reads saved objects
  back by object id and byte-compares them.
- `web/src/catalogs/hexBoardGeometry.ts`: browser-side model of the current
  140-key surface, including `133` main note keys and command indices
  `0,20,40,60,80,100,120`; layout previews and tests should use this helper
  instead of duplicating row/column math
- `web/src/midi/`: Web MIDI access, preset-sync client helpers, and mock transport
- `web/src/views/`: compact device connection, profile sync, tuning/layout
  editing, and synth preset organization

The web app is deployed as a static GitHub Pages project page through
`.github/workflows/pages.yml`. The workflow runs from `web/`, uses `npm ci`,
executes `npm test`, and builds both `main` and `development` into one Pages
artifact so branch deploys do not overwrite each other. `main` is published at
`/HexBoard/`, while `development` is published at `/HexBoard/development/`.
The Vite modes `github-pages-main` and `github-pages-development` set those
asset base paths; local development and ordinary local builds keep the root `/`
base path. The workflow checks for `web/package.json` in each worktree before
running Node commands, so a branch without the web app gets a placeholder page
instead of failing the whole deployment.

## High-Level Architecture

The firmware is split across the RP2040's two cores:

- Core 0: setup, file system, menu, button scan, MIDI, LEDs, autosave, synth control state
- Core 1: synth setup, encoder quadrature polling, and delegated-control SysEx polling while delegated mode is active

There is also a timer-driven synth/audio path that must stay responsive. Flash writes on RP2040 disable interrupts on both cores, so the code mutes audio before saving settings to avoid audible garbage.

Firmware MIDI input uses a small HexBoard-owned byte parser over the Pico SDK
`MIDIUSB` byte stream and `Serial1`, so SysEx frame assembly no longer depends on
the Arduino MIDI library parser. During chunked preset-sync object activity,
core 0 enters a short transfer window: it draws a `MIDI SysEx Transfer` screen,
repeatedly pumps MIDI input, and skips normal menu/button/LED work until the
transfer is idle and no object transfer is active, or until the transfer window
times out and clears the active read/write transfer. The transfer overlay saves
the prior OLED screensaver state and `screenTime`, then restores them when it
closes so SysEx object traffic does not count as menu/display wake input.
One-frame messages such as hello/list/delete and live `SYNTH_PARAM_SET` process
without entering that modal window. `SYNTH_PARAM_SET` marks settings dirty after
valid records are applied, so web-editor synth controls use the same debounced
auto-save path as on-device synth menu controls.
Device-to-host preset reads are ACK-paced: firmware sends `READ_BEGIN`, waits
for the host ACK, then sends one `DATA_CHUNK` per ACK before `TRANSFER_END`.
Live USB MIDI packet output has a much shorter retry window than SysEx stream
output. If the USB host is connected but not polling, such as a sleeping or
closed laptop that still supplies power, `writeUsbMidiPacket()` backs off after
a failed short retry so button scanning, wheel handling, and onboard synth
playback do not stall behind USB endpoint backpressure.

Performance-sensitive firmware code can use the `RAM_FUNC(name)` wrapper to
place selected functions in SRAM instead of external-flash XIP. Keep this
selective. The current RAM placement favors small hot paths and note-critical
dispatch: the audio block renderer and DMA refill helpers, button scan,
command-wheel update, MIDI note/wheel sends, synth voice allocation, rotary
quadrature polling, and compact LED frame helpers. The renderer also keeps its
direct helper calls and the small
polyphony attenuation table in SRAM. Envelope release starts use 256-entry
16-bit RAM lookup tables for the amp and FX envelopes so the ISR does not divide
when many notes are released at once, and piezo scaling uses power-of-two
fixed-point math rather than division or reciprocal approximation. Avoid moving
OLED/GEM/U8g2 drawing wholesale; display updates are dominated by library calls
and I2C transfer time, and moving that stack would spend a lot of SRAM for
limited gain.

### Performance Notes

Current optimization candidates to keep in mind:

- Dynamic JI note-on work in `src/firmware/tuning/DynamicJustIntonation.cpp` still scans ratio candidates with floating-point cents math. The selected ratio table is cached, but a later pass could precompute fixed-point or octave-reduced candidates and avoid most live floating-point work.
- `pressedKeyIDs` is a `std::vector` used by Dynamic JI note tracking. Replacing it with a fixed-size held-note array or bitset would avoid erase-time shifting and heap behavior in note release paths.
- `midiNoteToHexIndices` is an array of vectors. It is rebuilt when pitch assignment changes, not per audio sample, but a fixed-capacity reverse index would remove heap allocation from mapping refreshes and external MIDI LED lookup.
- `animateMirror()` in `src/firmware/hardware/LedAnimations.cpp` compares every held note against every visible hex. It is bounded by `LED_COUNT`, but octave/by-note animation could use precomputed step buckets if animation load becomes visible.
- Incoming SysEx assembly in `src/firmware/midi/MidiInput.cpp` uses growable vectors. Preset-sync is intentionally not a button-scan hot path, but a fixed receive buffer would make memory use more predictable during large transfers.
- Each unity-included module keeps its `#if HEXBOARD_FIRMWARE_UNITY` guard before library includes. Keep that order so Arduino's individual compilation pass sees truly empty non-unity modules.

## Source File Map

The main firmware files are:

- `src/firmware/FirmwareModule.h`: shared Arduino/RP2040/library includes and `RAM_FUNC`
- `src/firmware/HexBoardFirmware.h`: lifecycle API used by the root sketch
- `src/firmware/FirmwareUnity.cpp`: ordered firmware translation unit that includes the subsystem `.cpp` files
- Subsystem `.h` files under `src/firmware/`: explicit cross-module APIs. `tuning/Tuning.h`, `model/Layout.h`, `model/ScalePalettePreset.h`, `hardware/GridState.h`, and `storage/PersistentDataModels.h` own the shared model/schema declarations that used to be available only through unity include order.
- `src/firmware/app/`: platform/common helpers, runtime defaults, diagnostics/timing, and lifecycle orchestration
- `src/firmware/tuning/`: tuning math and Dynamic JI retuning
- `src/firmware/model/`: layout, scale/palette/preset models, and pitch assignment
- `src/firmware/hardware/`: grid state, command buttons, scan/rotary handling, LED rendering, and LED animations
- `src/firmware/midi/`: USB/serial transport, MPE/routing, MIDI note dispatch, external MIDI LED state, delegated control, and MIDI input parsing
- `src/firmware/synth/`: built-in single-cycle waveform sources and compatibility wavetable catalog in `BuiltinWavetables.cpp`, plus synth engine, active wavetable RAM, oscillator/render path, envelopes, arpeggiator, metronome, PWM, and DMA audio in `SynthAudio.cpp`; hot render/audio helpers remain grouped in `SynthAudio.cpp`
- `src/firmware/storage/`: persistent data models, settings/profile storage, synth preset/wavetable storage, legacy user wavetable loading, and preset-sync split into protocol helpers (`PresetSyncProtocol.cpp`), geometry objects (`PresetSyncGeometry.cpp`), synth objects (`PresetSyncSynthObjects.cpp`), and message dispatch (`PresetSync.cpp`)
- `src/firmware/menu/`: OLED/GEM pages and settings callbacks in `MenuAndDisplay.cpp`, played-note drawing in `PlayedNotesOverlay.cpp`, synth preset foldered menu rebuilding in `SynthPresetMenu.cpp`, and synth wavetable foldered menu rebuilding in `SynthWavetableMenu.cpp`

If you are changing a behavior, start by locating which of these layers owns it before editing anything. Shared constants, types, and lifecycle calls should be declared in the nearest owning header, while subsystem-owned globals and hot helpers should stay private in their `.cpp` file whenever no other module needs them. The firmware still builds through `FirmwareUnity.cpp`; removing that dependency requires continuing this explicit-header work until every `.cpp` can compile with only its direct includes.

## Runtime Data Flow

The main musical path looks like this:

1. `readHexes()` scans the matrix and updates `h[]`
2. New note presses go to `tryMIDInoteOn()` and `trySynthNoteOn()`
3. Releases go to `tryMIDInoteOff()` and `trySynthNoteOff()`
4. MIDI routing depends on `resetTuningMIDI()` and `assignPitches()`
5. LED output depends on note state, scale state, palette selection, and animation state

The mapping path looks like this:

1. `applyLayout()` computes `stepsFromC` per playable button
2. `applyScale()` marks each button `inScale`
3. `assignPitches()` computes MIDI note, channel, bend, and frequency

That ordering matters. If you change the layout or tuning and only call one of those functions, your runtime state will drift out of sync.

## Key Global Structures

### `buttonDef h[BTN_COUNT]`

This is the board state. Each element stores:

- physical coordinates
- command-vs-note status
- assigned pitch information
- LED color cache
- live press state
- synth and MIDI channel state

If a bug involves "a key is wrong", you will usually end up tracing through `h[]`.

### `presetDef current`

This holds the current tuning, layout, scale, key, and transpose selection. It is the central object for pitch interpretation.

### `settingsProfiles`

This is the persisted settings matrix:

- `9` total profile slots
- slot `0` is the boot / auto-save slot
- the active profile is swapped by changing which profile row `settings` points at

### Dynamic containers still in hot paths

The firmware still uses a few dynamic containers in live paths:

- `pressedKeyIDs` tracks active keys for dynamic just intonation
- `midiNoteToHexIndices` maps incoming MIDI notes back to LED targets
- `ratios` stores dynamic just intonation ratio candidates
- synth release scheduling uses queue-like state shared with the audio engine

Treat these as known risk areas before adding more heap allocation to button scan, MIDI, LED, or ISR-adjacent paths.

Normal-mode incoming MIDI uses `processIncomingUsbMidi()` and `processIncomingSerialMidi()` to drain currently available transport bytes per enabled interface. MIDI-in LED latency is handled by a short render coalescing window, not by limiting how many MIDI bytes are parsed per loop.

## Physical Control Model

The firmware reserves these command buttons:

- `CMDBTN_0`, `CMDBTN_1`, `CMDBTN_2`: velocity wheel
- `CMDBTN_3`: toggles mod wheel vs pitch bend wheel
- `CMDBTN_4`, `CMDBTN_5`, `CMDBTN_6`: mod or pitch bend wheel

That behavior is wired in `@gridSystem` via the `wheelDef` instances and `cmdOn()`.
`wheelDef` treats a stored speed value of `0` as the `TooSlow` mode: one value
step every two command-message cooldown windows. Positive values keep the old
one-step-per-cooldown behavior, so existing profile bytes remain meaningful
after the user-facing speed names shifted.

If you repurpose command buttons:

- update the `CMDBTN_*` mapping
- review `wheelDef` wiring
- review `cmdOn()` and `cmdOff()`
- review any user-facing documentation

## Menu System Patterns

The menu layer is dense, but it is consistent.

### Persistent menu items

Most editable settings follow this pattern:

1. Add a `SettingKey`
2. Add a factory default in `factoryDefaults`
3. Add runtime load logic in `syncSettingsToRuntime()`
4. Create a `PersistentCallbackInfo`
5. Create the `GEMItem`
6. Add the item to the right page in `setupMenu()`

The code literally documents this as "SETTINGS STEP 1-4". Follow that pattern instead of inventing a new path.

### Callback behavior

`universalSaveCallback()` is the standard writeback path. It:

- reads the new runtime value
- writes it into the active `settings[]`
- marks settings dirty for auto-save
- optionally runs a post-change hook

Use the `postChange` hook for side effects such as:

- `refreshMidiRouting()`
- `updateLayoutAndRotate()`
- `setLEDcolorCodes()`
- `resetSynthFreqs()`
- `updateEnvelopeParamsFromSettings()`

### Preview callbacks

Preview callbacks are used when the user is browsing a value and should hear or see the result immediately before committing it. That is why some settings update live through `preview...()` functions as well as persist on selection.

## Which Function To Call After A Change

This is one of the easiest places to make mistakes.

### Use `applyScale()` when:

- key changes
- scale changes
- you changed in-scale logic only

### Use `assignPitches()` when:

- transpose changes
- pitch math changes but button positions stay the same

### Use `updateLayoutAndRotate()` when:

- layout changes
- mirror flags change
- layout rotation changes
- device/display rotation changes

It calls `applyLayout()`, which then calls `applyScale()` and `assignPitches()`,
and applies the persisted four-step display rotation. Use
`applyDeviceDisplayRotation()` alone when only the OLED/device orientation
changed.

### Use `refreshMidiRouting()` when:

- MPE rules change
- MIDI channel behavior changes
- tuning affects how notes should map onto MIDI channels

It calls `resetTuningMIDI()` and `assignPitches()`.

If you choose the wrong refresh path, you will get mismatched LEDs, stale MIDI note assignments, or bad synth frequencies.

## Settings And Persistence Details

Settings are stored in `/settings.dat` on LittleFS with:

- a `SettingsHeader`
- versioning
- CRC32 validation
- all profile bytes written as a contiguous block

Important implementation details:

- `CURRENT_SETTINGS_VERSION` is currently `17`
- the LED current-limit default is `1.5 A`; its internal limiter budget is hardware-specific so `V1.1` and `V1.2` boards land near the same actual USB-side draw
- the LED current-limit calibration did not bump `CURRENT_SETTINGS_VERSION` because no persisted bytes were added, removed, or reordered
- the Synth Options `Drive` setting is stored as `SynthDrive`; factory default is `Off`
- the Synth Options `Out Smooth` setting is stored as `SynthOutputSmoothing`; factory default is `Off`; valid values are `Off` and `1` through `8`; the audio renderer applies it as a one-pole digital low-pass to both final jack and piezo PWM levels
- `PlaybackMode` defaults to `Poly`; valid values are `Off`, `MonoRtg`, `MonoLeg`, `Arp'gio`, and `Poly`; legacy stored mono value `1` now means `MonoRtg`; legacy transient `PolyTbl` value `5` is normalized to `Poly`
- onboard synth wheel effect is stored as `SynthModTarget` and `SynthModAmount`; factory defaults are `FoldWrp` and `100%`; valid runtime targets are `Vibrato`, `Pitch`, `WT Pos`, `FoldWrp`, `DutyWrp`, and `PolyWrp`; pitch target depth maps the signed `-127..127` runtime amount into a Q4 internal pitch accumulator spanning about `+/-24` semitones, then reads startup-generated RAM Q16 ratio tables; the three warp targets apply low-CPU phase warps before waveform or wavetable sampling, while `WT Pos` offsets wavetable frame position from the persisted `SynthWavetablePosition` base. `SynthWavetablePosition` remains a `0..127` byte internally, but the on-device menu labels it as frames `1..32` using rounded frame-anchor byte values.
- synth modulation target calculation runs on an `8`-sample control quantum for CPU headroom; per-voice phase increment and phase-warp depths then linearly slew between cached targets at audio rate to reduce pitch and warp stepping artifacts
- the synth LFO is stored as `SynthLfoTarget`, `SynthLfoAmount`, `SynthLfoWave`, and `SynthLfoSpeed`; the LFO targets the same modulation destinations as the wheel and FX envelopes, uses a bipolar amount byte where `127` is off, supports sine/triangle/saw/square shapes, and uses a `20`-entry `0.05 Hz` through `20 Hz` speed table
- onboard synth vibrato speed is stored as `SynthVibratoSpeed`; selectable values are `1 Hz` through `12 Hz`, with factory default `6 Hz`
- Dynamic JI stores its active candidate-ratio table as `DynamicJIRatioTable`; the menu shows `JI Table` only when `Dynamic JI` is enabled, and shows `Beat BPM`/`BPM Mult.` only when `JI BPM Sync` is enabled; the Tuning visibility helper preserves the current item index because GEM resets pages with a Back item near the top when a hidden item is shown; table options run from `3Limit` through `41Limit`, and factory default `41Limit` preserves the previous full ratio-list behavior; the filtered active table caches ratio cents so the note-on path does not recompute every candidate ratio
- mono portamento is stored as `SynthPortamentoTimeIndex`; it reuses the `0 ms` through `4 s` envelope time table and the menu hides `Porta` outside the two mono modes
- arpeggiator direction is stored as `ArpeggiatorDirection`; the menu hides `Arp Dir` outside `Arp'gio`; note-sorted directions compare assigned note/frequency rather than physical button number
- `SynthAttackEffect` is a deprecated hidden byte kept only so version `8` files can migrate by prefix copy
- `DeviceRotation` stores the four-step physical device orientation used by the Layout menu's `Device Rot` item; firmware maps that value to the OLED driver's opposite rotation because the mounted display is physically inverted. Selecting a layout seeds `DeviceRotation` from legacy `layoutDef.isPortrait` metadata: portrait layouts use `0`, and landscape layouts use `90`.
- metronome mode and time signature are stored as `MetronomeMode` and `MetronomeSignature`; factory defaults are `Off` and `4/4`
- the amp envelope has `EnvelopeAttackIndex`, `EnvelopeHoldIndex`, `EnvelopeDecayIndex`, `EnvelopeSustainLevel`, and `EnvelopeReleaseIndex`
- FX Env 1 is stored as `EffectEnvelopeTarget`, `EffectEnvelopeAmount`, `EffectEnvelopeAttackIndex`, `EffectEnvelopeHoldIndex`, `EffectEnvelopeDecayIndex`, `EffectEnvelopeSustainLevel`, and `EffectEnvelopeReleaseIndex`; factory defaults are `Vibrato`, `+100%`, and an inactive `0 ms`/`0%` envelope
- FX Env 2 is stored as `EffectEnvelope2Target`, `EffectEnvelope2Amount`, `EffectEnvelope2AttackIndex`, `EffectEnvelope2HoldIndex`, `EffectEnvelope2DecayIndex`, `EffectEnvelope2SustainLevel`, and `EffectEnvelope2ReleaseIndex`; factory defaults are `Pitch`, `+100%`, and an inactive `0 ms`/`0%` envelope
- Core 0 retries synth release commands until the audio renderer consumes one; the renderer clears the retry state when it accepts `StartRelease` so long releases do not repeatedly restart
- synth presets are stored separately in `/synth_presets.dat` with magic `SYP`; preset file version is `9`; entries are stored as a counted catalog with a firmware cap of `128` presets; presets save synth sound parameters plus a wavetable folder/name dependency, but do not persist a current preset id; the on-device save/load menus are rebuilt as folder submenus with plain preset-name items; menu rebuilds are deferred out of GEM callbacks so active menu items are not deleted while GEM is still dispatching; literal slashes in web-app folder names are stored as `%2F` so the menu displays them without splitting them into nested submenus; version `1` through `3` files are migrated from the old `8`-slot layout, version `4` fixed-slot files migrate saved presets into the root folder `/` with `Slot N` names, version `5` fixed named/foldered arrays migrate into the counted version `6` catalog, version `6` records migrate by appending portamento and arpeggiator direction defaults, version `7` records migrate by appending wavetable position and LFO defaults, and version `8` records migrate by deriving the new wavetable dependency from the legacy `Waveform` byte
- user synth wavetables are stored as a named catalog in `/synth_wavetables.dat` with magic `SYW`, version `1`, up to `64` entries, and per-table sample files named from each `16`-byte wavetable object id; each table sample file contains `32 * 512` unsigned waveform bytes. The old `/user_wavetable.dat` `UWT` slot remains loadable only as legacy `/User/UserTbl` compatibility.
- user geometry objects are stored in `/layouts.dat` with magic `LYT`, version `1`, up to `127` raw object bodies across `UserTuning`, `UserLayout`, `UserScale`, `ScaleColorMap`, and `ExplicitButtonMap`; preset-sync validates the common `HBS1` object envelope, schema major `1`, `Name`, and `ObjectId`, then preserves the raw body for list/read/write/delete round-trip. Runtime Apply currently supports generated EDO/equal-step user tunings, vector layouts, included-degree scales, scale color maps, and format-1 explicit button maps. It does not yet support Scala/cents-table pitch lookup, profile references, menu catalog integration, or settings persistence for the selected geometry bundle.
- the Advanced-menu boot animation toggle is stored as `BootAnimationEnabled`; factory default is enabled
- the Advanced-menu headphone output cap is stored as `HeadphoneVolumeCap`; factory default is `100%`; `setupHardware()` inserts its menu item only on hardware `V1.2`, and the audio block renderer applies it only to the jack sample before DMA writes the `AJACK` PWM level
- a missing `/settings.dat` sets `settingsFileMissingOnBoot` for the current boot before factory defaults are saved
- invalid or mismatched settings files restore factory defaults
- version `2` through `16` settings files are migrated in place to version `17` by copying each older profile prefix, appending newer bytes with factory defaults, remapping legacy envelope time indices to the expanded `0 ms` through `4 s` time table when needed, remapping legacy `4/6/8/10 Hz` vibrato speed indices to the `1..12 Hz` table, and converting version `13` and older `DeviceRotation` OLED-driver constants into physical device rotation values; version `7` profiles also seed FX Env 1's new target to the old opposite-of-wheel behavior; version `16` profiles append `SynthOutputSmoothing = Off`
- auto-save is debounced for `10 seconds`
- auto-save copies runtime state back into slot `0` before writing
- flash writes go through `flashSafeSave()` to mute the synth during the write
- on hardware `V1.2`, the `AudioDestination` setting now behaves as a
  jack-default `Buzzer` toggle that switches synth output to piezo; legacy
  stored values are interpreted by checking whether the older byte had the piezo
  bit set

If you add, remove, reorder, or reinterpret settings, think about migration. The current code has explicit migrations for versions `2` through `16` because settings were appended to the schema, some setting tables expanded, and `DeviceRotation` was reinterpreted from OLED-driver rotation to physical device rotation. Unknown version mismatches still fall back to defaults.

## MIDI And Tuning Notes

The MIDI subsystem supports three broad modes:

- standard single-channel MIDI
- multi-channel standard MIDI for extended note coverage
- MPE with per-note pitch bend

For the external-only raw button/LED surface mode, see `docs/delegated-control.md`.
Delegated control also has a session-only MIDI note map that hosts can update
with live SysEx commands. It deliberately does not use `SettingKey`, profiles,
or the preset-sync object store; keep it transient unless that product decision
changes.
The delegated enter command can carry a short printable app name for the OLED,
and `dealWithRotary()` switches from GEM menu input to delegated encoder-event
SysEx while delegated mode is active. A 5-second encoder hold is the local
escape path; do not route that through the normal 2-second panic behavior.
For the host sync protocol covering profiles, user tunings/layouts, mapping
objects, and named synth presets, see `docs/preset-sync-sysex.md`. Current
firmware can persist, round-trip, and live-apply the minimum geometry path:
generated EDO/equal-step `UserTuning` objects feed `current.tuning()` and the
MIDI pitch offset from `ReferenceMilliHz`; vector `UserLayout` objects feed
`applyLayout()`; `UserScale` included degrees feed `applyScale()`;
`ScaleColorMap` feeds `setLEDcolorCodes()`; and format-1 `ExplicitButtonMap`
objects override per-button role, pitch, and color before pitch assignment is
rebuilt. The normal OLED tuning/layout/scale callbacks clear the RAM-only
geometry override and reset key to C before applying factory menu selections.
Imported Scala/cents tunings still need a cents or ratio table that can
resolve every `stepsFromC` value for synth frequency, standard MIDI note
mapping, and MPE bend calculation. Full Scala compatibility needs a firmware
tuning-system overhaul, not just `.scl` parsing in the host app. Manual
`ExplicitButtonMap` note positions are absolute `stepsFromC` values. Root/key
and transposition settings should affect scale highlighting and final sounded
pitch, but should not regenerate those manual button records.

Core functions:

- `resetTuningMIDI()`: decides routing mode and reinitializes channel state
- `assignPitches()`: computes note number, bend, frequency, and reverse note map
- `tryMIDInoteOn()` / `tryMIDInoteOff()`: live note lifecycle

Just intonation lives inside the MIDI note-on path through `justIntonationRetune()`. If you are changing intonation or pitch bend math, inspect:

- `MPEpitchBendSemis`
- `justIntonationRetune()`
- `prepareActiveMidiPitch()`
- `centsToRelativePitchBend()`

Dynamic JI and JI BPM Sync store the retune amount both as legacy bend units
(`jiRetune`) and as float cents (`jiRetuneCents`). The onboard synth derives
`jiFrequencyMultiplier` directly from cents, independent of `MPE Bend`; external
MIDI uses `activeMidiNote` plus `activePitchBend`, choosing the closest MIDI note
after retuning so the residual bend is normally within `+/-50` cents. Note-off
must use `activeMidiNote`, not `note`, because the transmitted note number can
differ from the button's base note.

## Synth Notes

The synth engine is separate from MIDI output. A playable button can trigger:

- MIDI only
- synth only
- both

depending on the current settings and destination.

When changing synth-related behavior, review:

- synth mode selection
- waveform selection
- envelope parameter update path
- arpeggiator timing update path
- arpeggiator held-note ordering and direction handling
- mono retrigger/legato and portamento behavior
- flash-save muting behavior

The synth PWM defaults to `10` bits as a compromise between quantization noise
and PWM-carrier artifacts. At the project's `250 MHz` build target, the carrier
is roughly `488 kHz` in `8`-bit mode, `244 kHz` in `9`-bit mode, and `122 kHz`
in `10`-bit mode. High-register sine tones can get harsher on the jack path as
the carrier moves closer to the audio band, so `9`-bit and `8`-bit builds are
useful fallback comparisons.

Synth audio is rendered on Core 1 into two `64`-sample DMA buffers. A dedicated
PWM timer slice uses wrap `1023` and divider `/6` to pace DMA writes at about
`40.7 kHz` into the active output PWM slice's CC register. The block renderer
generates jack and piezo levels, but DMA outputs only one selected destination at
a time: hardware `V1.2` uses the jack unless `Buzzer` is enabled, and hardware
`V1.1` uses piezo. Inactive piezo output is switched to GPIO and held low;
inactive jack output remains PWM-centered so the headphone path stays centered.
`SynthOutputSmoothing` optionally applies a Q8 one-pole low-pass to both final
PWM levels before the DMA buffer is encoded; `Off` bypasses and snaps the filter
state to the current levels.
If the DMA channel consumes a buffer before Core 1 has filled the next one,
firmware records an underrun and outputs a silence block.

The sine waveform uses linear interpolation between adjacent `512`-entry table
samples. The table sampler splits the existing `16`-bit phase accumulator into
`9` sample-index bits and `7` fractional bits.
The onboard waveform convention is that phase zero starts at an upward zero
crossing: `sine`, `strings`, and `clarinet` are rotated byte tables, the MP
single-cycle tables are generated the same way from their source WAV files, and the generated
saw/triangle/square/hybrid paths apply the matching phase offset in
RAM-resident helpers. Table-backed waveform source cycles live in
`src/firmware/synth/SynthAudio.cpp`, but only the selected waveform or wavetable is copied into
the preallocated `activeSynthWaveTable` RAM buffer used by the audio renderer.
The vibrato sine lookup remains a separate RAM table because the renderer reads
it directly.
The legacy `Waveform` byte remains in settings and preset value lists for
compatibility, but the visible synth source selector is now a named wavetable
reference. Built-in compatibility tables group old single-cycle waves into
`Basic`, `Classic`, `Edge`, `Glass`, `Digital`, and `Motion`; old preset loading
derives the table and `SynthWavetablePosition` anchor from the legacy waveform
value. `Hybrid` intentionally maps to `Basic` at position `0`.
The active wavetable folder/name is string metadata and is not part of the
byte-oriented settings profile. Firmware persists that current reference in
`/current_wavetable.dat` whenever settings are saved and immediately after
on-device preset/wavetable loads or preset-sync save-and-apply commits. Startup
loads the wavetable catalog, restores this reference, then lets
`syncSettingsToRuntime()` load the selected table.
The reserved built-in wavetable folder is `/Built In` and is sent unescaped in
preset wavetable dependencies; firmware also normalizes the older `%2FBuilt In`
and `Built In` aliases so existing presets keep loading built-ins.
User wavetable sample files use a shortened `/wt_<16 hex>.wtb` path derived from
the first 8 object-id bytes so filenames stay under LittleFS limits. Read and
delete paths also try the older full-object-id filename to tolerate earlier
catalog files, but new writes always use the shorter path. Catalog load and
write paths skip/prune user wavetable records whose sample file is missing so
failed earlier imports do not keep consuming catalog slots.
Preset-sync wavetable `ObjectListResponse` records carry the metadata needed by
the web library; the web app should not full-read wavetable bodies during normal
refresh. Metadata-only `SynthWavetable` writes with `SaveToFlash |
OverwriteExisting` rename or move an existing device wavetable without sending
sample bytes, and firmware rejects object-id changes on those writes.

All active tables use the same RAM path: firmware builds or loads `32` frames of
`512` samples into `activeSynthWaveTable`. The sampler runs in the normal synth
modes, interpolates adjacent frames from `SynthWavetablePosition` plus signed
`WT Pos` modulation, and uses direct phase lookup to keep renderer cost bounded.
The selected wavetable also rebuilds a RAM `WT Pos` lookup table so the audio
renderer maps `0..127` position amounts to frame positions without a per-voice
divide. Modulation work runs on an `8`-sample control quantum: wheel smoothing,
LFO sampling, FX envelope state, pitch/vibrato targets, phase-warp targets, and
wavetable frame contexts are cached there, with note start/release/reset forcing
an immediate per-voice cache refresh. Per-voice phase increment and phase-warp
depths slew between cached targets at audio rate; the normal `8`-sample retarget
uses shift math instead of division. Oscillator phase advance, phase warping,
waveform reads, amp-envelope level, mixing, drive, and output scaling remain
audio-rate. When only global sources such as the wheel or LFO modulate
`WT Pos`, the cached frame-pair read context is shared by all voices; when an FX
envelope targets `WT Pos`, each voice caches its own frame context.
FX-envelope modulation depth uses a `128 x 128` RAM scale table,
and FX envelopes advance by the full `8` audio ticks on each control refresh so
long envelope timing stays aligned while worst-case blocks avoid rebuilding
modulation every sample.

New user wavetables are saved through the named wavetable catalog. Presets store
only the wavetable folder/name dependency, so a missing dependency falls back to
`Basic` until a matching table is installed. The old `/user_wavetable.dat` file
has a `UWT` header with version, frame count, sample count, and CRC32, then
`32 * 512` unsigned waveform bytes; it is still loadable as `/User/UserTbl` for
compatibility. Preset-sync object type `0x0B` validates the same dimensions
before copying the table into `activeSynthWaveTable` and optionally writing the
named catalog entry through the flash-safe mute wrapper.

Pitch bend and wheel phase-warp modulation have synth-local smoothing separate from
MIDI output. `setSynthFreq()` writes a target oscillator increment for held
voices and only resets phase for new synth notes. The audio block renderer slews
each voice's current increment toward that target, and wheel modulation reads a
smoothed value instead of `modWheel.curValue` directly.

The jack and piezo output stages intentionally differ. The jack path stays
centered at the PWM midpoint, while the piezo path normally moves its midpoint
with the active voice envelope to stay quiet when idle. Piezo sample scaling uses
a power-of-two fixed-point multiply/shift in the block renderer. Metronome beeps
are the exception: while a beep sample is active, the piezo path opens full temporary
headroom so the click is not attenuated once by the beep level and again by the
moving midpoint.

Anything that touches timing, interrupts, or shared state between cores deserves extra caution.

## LED And Visualization Notes

LED rendering is not just cosmetic. It reflects:

- note state
- scale membership
- tuning and key relationships
- external MIDI note activity
- current animation mode

The LED state is cached per button in fields like `LEDcodeRest`, `LEDcodeDim`, and `LEDcodePlay`. When changing palette or scale behavior, make sure the code still recomputes these caches by calling `setLEDcolorCodes()`.

After those cached colors and command-button colors are written into the NeoPixel buffer, `applyLedCurrentLimitToFrame()` can scale the whole frame down to stay under the configured approximate current budget. That limiter works on the final RGB bytes, so it applies equally to normal playback, animations, and delegated-control LED frames.

Metronome visual modes are layered after the normal command-button and note LED
rendering but before the current limiter. `Bright` mode scales the completed
frame down between beats for contrast; `Side Btns` overwrites the seven command
LEDs with green accented beats and red non-accented beats.

The Advanced-menu `LED Test` item is intentionally transient. `ledTestMode` is a RAM-only selector state, not a `SettingKey`; `previewLedTest()` updates it while the select is edited, `lightUpLEDs()` renders a solid all-LED test frame while it is nonzero, and both the save callback and preview-reset path restore it to `Off`. The test colors use direct raw RGB channel values through `strip.Color()` instead of `getLEDcode()`, so they bypass perceptual hue mapping while still passing through the final current limiter. Do not add it to `factoryDefaults` or bump `CURRENT_SETTINGS_VERSION`.

Runtime geometry Apply routes user-generated colors through the active
`ScaleColorMap` before falling back to factory color modes. Manual per-button
colors from an `ExplicitButtonMap` override the palette and should not be
recalculated when root/key or transposition changes.

Startup has a separate bounded LED self-check in `runBootLedSelfCheck()`. Normal boots skip RGB color-channel flashes and run only the smoother rainbow splash, followed by `fadeToNormalLedFrame()` so the resting frame fades in. The persisted `BootAnimationEnabled` setting gates this whole path. The splash center is `bootLedSplashCenterIndex()`, one physical hex to the right of the active layout center; on the default `12 EDO` Wicki-Hayden layout this is `D4` rather than `C4`. The seven command LEDs are overwritten each splash frame by `setBootCommandButtonFade()` so they fade separately instead of joining the splash.

When `settingsFileMissingOnBoot` is true, `showFirstBootWhiteDiagnostic()` runs before the splash. It fades all LEDs to a moderate white level derived through the saved/default `Brightness` and `Rest Bright` path, then holds for `2 seconds`. This flag is RAM-only and does not add a persisted setting or require a settings-version bump.

## Startup Sequence

Core 0 startup currently does this in order:

1. set USB manufacturer/product descriptors to `HexBoard`
2. start USB serial logging
3. disable the synth alarm IRQ
4. `setupMIDI()` to register Pico SDK USB MIDI as `HexBoard` and start `Serial1` MIDI
5. wait briefly for USB MIDI enumeration
6. `setupFileSystem()`
7. configure I2C
8. `setupPins()`
9. `setupGrid()`
10. `detectHardwareVersion()`
11. `load_settings()`
12. `setupLEDs()`
13. `setupGFX()`
14. `setupRotary()`
15. `setupMenu()`
16. `setupHardware()`
17. `syncSettingsToRuntime()`
18. `recomputePitchBendFactor()`
19. `runBootLedSelfCheck()`

If you add initialization code, place it where its dependencies are already valid. Do not, for example, rely on menu objects before `setupMenu()` or on loaded settings before `load_settings()`.

## Main Loop Responsibilities

Core 0 loop:

- timing
- envelope release cleanup
- screen saver
- button scan
- arpeggiator
- control wheels
- incoming MIDI
- animation
- LED refresh
- encoder click handling
- played-note OLED overlay drawing
- auto-save

Core 1 loop:

- `readKnob()`
- `processIncomingMIDIDelegated()` when delegated control is active

Keep Core 0 work bounded. Adding heavy allocations, blocking delays, or large logging bursts in hot paths will show up as sluggish input, bad LED timing, or synth problems.

During `ANIMATE_MIDI_IN`, LED refresh can be briefly deferred by `shouldDeferMidiInLedRefresh()` after incoming note state changes. If you retune the coalescing or maximum-defer constants, test both dense USB MIDI bursts and serial MIDI input for visible MIDI-in latency, strip-order sweep artifacts, backlog, and normal control responsiveness.

## Common Edit Recipes

### Add a new menu-backed setting

1. Add the enum entry to `SettingKey`
2. Add a default byte in `factoryDefaults`
3. Load it in `syncSettingsToRuntime()`
4. Create the `PersistentCallbackInfo`
5. Create the `GEMItem`
6. Insert it in `setupMenu()`
7. Decide whether it needs a preview callback
8. Decide which post-change function keeps runtime state consistent

### Add a new tuning

1. Extend the tuning definitions
2. Add or generate compatible layouts
3. Add compatible scales if needed
4. Verify `showOnlyValidLayoutChoices()`, `showOnlyValidScaleChoices()`, and key spinner logic still behave

### Add a new layout

1. Add it to `layoutOptions`
2. Ensure its tuning index is correct
3. Verify `hexMiddleC`, `acrossSteps`, and `dnLeftSteps`
4. Re-test `applyLayout()` with rotation and mirror options

### Add a new scale

1. Add the `scaleDef`
2. Bind it to the right tuning or `ALL_TUNINGS`
3. Verify the interval pattern sums to one cycle
4. Re-test `applyScale()`

## Known Risk Areas

- The code still uses dynamic containers like `std::vector` in live paths such as `pressedKeyIDs`, `ratios`, and `midiNoteToHexIndices`
- `tryMIDInoteOff()` removes the released id from `pressedKeyIDs`; replacing that vector with fixed storage would reduce heap and erase-shift risk in the note release path
- The file is large enough that side effects are easy to miss if you patch only one subsystem
- Hardware-version-specific behavior is mixed into runtime logic, especially around MIDI output and synth output menu insertion

Those are good places to review closely before and after edits.

## Practical Debugging Tips

- Turn on `Serial Debug` from the `Advanced` menu if you need runtime logs
- Use `Advanced` -> `ISR Profile` to capture audio block timing. Turn it on
  before the scenario, then turn it off to log `min/avg/max/count`,
  `cpu min/avg/max` as render time divided by available block time, render
  overrun count, DMA underrun count, and whether the slowest block coincided
  with release-start or piezo-scaling math.
- Search by section tag first, not by scrolling
- Use `rg` on function names because the same concepts appear in many comments and menu strings
- When a change "almost works", verify you called the correct recomputation function rather than assuming the math is wrong

## Suggested Reading Order

If you are new to the code, read in this order:

1. `@mainLoop`
2. `@assignment`
3. `@gridSystem`
4. `@MIDI`
5. settings and `@menu`
6. `@synth`
7. `@LED` and `@animate`

That path gets you from "what runs" to "how notes are mapped" to "how the UI persists it".
