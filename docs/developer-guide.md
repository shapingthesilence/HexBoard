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
- `docs/preset-sync-sysex.md`: protocol design for implemented synth-preset sync, wavetable import, raw user geometry catalog storage, EDO/equal-step/Scala cents-table live geometry Apply, and future profile sync

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
npm run generate:factory-wavetables
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
preset open sends a runtime-apply preview immediately for auditioning. A
browser-only AudioWorklet synth preview implementation exists for future offline
preset audition, but its UI is currently gated off by `auditionFeatureVisible`
in the synth editor. When re-enabled, it consumes the same preset byte model,
maps computer keys in a piano-style `a w s e d...` layout with octave selection,
uses selected local wavetable sample data when available, and intentionally
does not try to match RP2040 PWM, piezo/jack staging, or fixed-point render
parity. Built-in factory wavetables are generated by
`web/scripts/generate-factory-wavetables.mjs`, which renders `Basic Shapes` and
`Classic` from firmware anchor tables in
`src/firmware/synth/BuiltinWavetables.cpp`, renders the remaining factory tables
from the default WAV sources, and runs the web FFT-pruned fixed-mip builder.
The generated `web/src/catalogs/factoryWavetables.ts` file seeds the browser
wavetable library once and is also used as preview fallback for `/Built In`
tables. The generated `src/firmware/synth/BuiltinWavetableData.cpp` file stores
the same fixed-mip bytes in firmware flash. The editor mirrors
firmware synth-mode, portamento, arpeggiator speed/direction, tempo, named
wavetable dependency, wavetable position, phase-warp, and LFO controls for synth
preset schema `7`, and splits the synth library into `Presets` and `Wavetables`
views. The editor keeps opened presets as temporary drafts;
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
  the selected-key inspector. The tuning/layout editor uses the same
  left/right column sizing as the synth preset editor. Its sidebar has
  top-level `File Manager` and `Editor` tabs: `File Manager` includes a
  foldered `Computer Library` for browser-stored bundles and a `HexBoard
  Library` view backed by device `UserTuning` object-list records, including
  read-only factory records. Device-side bundle actions read the tuning plus
  linked layout/scale/color/map objects to reconstruct an editor bundle for
  Open, Download, and Export; Erase is disabled for read-only factory records
  and deletes user-linked object sets in descending handle order. `Editor`
  contains `Live send`,
  runtime `Send Now`, computer/device save actions, bundle metadata, and the
  open bundle's `Tuning`, `Layouts`, and `Scales` subtabs. Live send writes compatible active geometry objects with
  `ApplyToRuntime` only; `Save to HexBoard` writes all bundle objects with
  `SaveToFlash`. Bundle `folderPath` is encoded into each unpacked `UserTuning`,
  `UserLayout`, `UserScale`, `ScaleColorMap`, and `ExplicitButtonMap` object
  written to the device. The preview toolbar owns the bundle-level
  `DefaultColorMode` selector; the preview board resolves colors through that
  mode, with `Custom` using the bundle scale-degree palette and generated
  modes rendered at full brightness in the browser preview.
  The Scales subtab owns `includedDegrees` editing.
  Scales are edited with `includedDegrees` only; the protected `All Notes`
  scale is normalized into every bundle, tracks the current tuning cycle length,
  and is not editable or deletable. The text input validates on blur so
  incomplete text can exist while a user is typing. EDO, equal-step, and Scala
  tunings store editable `keyLabels`, `referenceMidiNote`, and `referenceHz`;
  key labels default to A-first pitch-label strings in the editor, rotate to
  firmware C-order when encoded as `KeyLabels`, and use the same
  draft-then-blur validation style. Scala import converts trailing `.scl`
  interval labels into that A-first editor order, using the period-row label as
  the implicit 1/1 root when present. The selected-key inspector derives the
  displayed note label, reference-relative step/cents offset, and frequency
  from `stepsFromC`, the tuning's reference MIDI note, and `referenceHz`. The
  preview paintbrush has an eyedropper subtool that samples a preview key color
  into the active brush color without writing a button override, plus a reset
  action that strips color fields from active-layout button overrides while
  preserving role and note overrides.
  Equal-step layout-bundle tunings store step
  cents plus cycle length in the editor model; protocol `PeriodMilliCents` is
  derived during encoding. Scala layout-bundle tunings store the imported
  cents table, imported or edited labels, period metadata, and an explicit 1/1
  reference instead of exposing separate step fields. The
  tuning/layout editor uses real-device `Save`, `Send Now`, `Live send`, and
  `Verify` controls: `Save` writes all bundle objects with `SaveToFlash`,
  runtime sends write the active EDO/equal-step/Scala-compatible objects with
  `ApplyToRuntime`, and `Verify` reads saved objects back by object id and
  byte-compares them. The web app enables Scala runtime sends only when the
  connected firmware advertises cents-table runtime tuning support.
- `web/src/catalogs/hexBoardGeometry.ts`: browser-side model of the current
  140-key surface, including `133` main note keys and command indices
  `0,20,40,60,80,100,120`; tests should use this helper instead of duplicating
  row/column math. The tuning/layout editor intentionally filters the preview
  and editable button overrides to the `133` note keys, leaving command buttons
  out of geometry authoring.
- `web/src/midi/`: Web MIDI access, preset-sync client helpers, and mock transport
- `web/src/audio/` plus `web/public/synth-preview-worklet.js`: browser-only
  synth preset audition controller and AudioWorklet approximation used by the
  synth editor when the device is disconnected or when quick local audition is
  useful
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

There is also a timer-driven synth/audio path that must stay responsive. Flash writes on RP2040 disable interrupts on both cores, so `beginFlashSafeWrite()` shows an OLED saving notice, ramps the audio output gain to idle over roughly `86` samples, queues idle DMA samples, performs the write, then fades back in before restoring the display.

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
The web client uses an inactivity timeout for object reads rather than one
total-transfer deadline, and sends `TRANSFER_ABORT` if a read stalls so firmware
can clear the active read transfer immediately. Device-to-host synth wavetable
reads keep only the object metadata prefix in the read-transfer state and stream
the wavetable sample file as each outgoing chunk is ACKed. New files contain a
`49,152`-byte six-level fixed mip table, while base-only `8,192`-byte
files remain readable; both paths avoid a full wavetable-object heap allocation
before the transfer screen can open. Device-to-host and host-to-device synth
wavetable transfers stream the sample-bearing object through temporary LittleFS
files so fixed mip uploads do not require a contiguous object-sized heap buffer;
incoming fixed-mip uploads keep the raw-object temp file open for the duration
of the write transfer and close it before commit validation.
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

- Dynamic JI note-on work in `src/firmware/tuning/DynamicJustIntonation.cpp` still scans ratio candidates with floating-point cents math. The selected ratio table caches indices only; avoid fixed-point or octave-reduced matching unless the replacement preserves interval and beat-frequency precision.
- `pressedKeyIDs` is a `std::vector` used by Dynamic JI note tracking. Replacing it with a fixed-size held-note array or bitset would avoid erase-time shifting and heap behavior in note release paths.
- `midiNoteToHexIndices` is an array of vectors. It is rebuilt when pitch assignment changes, not per audio sample, but a fixed-capacity reverse index would remove heap allocation from mapping refreshes and external MIDI LED lookup.
- `animateMirror()` in `src/firmware/hardware/LedAnimations.cpp` compares every held note against every visible hex. It is bounded by `LED_COUNT`, but octave/by-note animation could use precomputed step buckets if animation load becomes visible.
- Incoming SysEx assembly in `src/firmware/midi/MidiInput.cpp` uses growable vectors. Preset-sync is intentionally not a button-scan hot path, but a fixed receive buffer would make memory use more predictable during large transfers.
- Each firmware `.cpp` builds independently with direct headers. Keep new declarations in the nearest owning subsystem header, and include the headers a `.cpp` actually uses.

## Source File Map

The main firmware files are:

- `src/firmware/FirmwareModule.h`: shared Arduino/RP2040/library includes and `RAM_FUNC`
- `src/firmware/HexBoardFirmware.h`: lifecycle API used by the root sketch
- Subsystem `.h` files under `src/firmware/`: cross-module APIs owned by each subsystem. Important shared declarations live in `hardware/HardwareConfig.h`, `hardware/GridState.h`, `tuning/Tuning.h`, `model/Layout.h`, `model/ScalePalettePreset.h`, and `storage/PersistentDataModels.h`.
- `src/firmware/app/`: platform/common helpers, non-synth runtime defaults, diagnostics/timing, and lifecycle orchestration
- `src/firmware/tuning/`: tuning tables, shared tuning math, and Dynamic JI retuning
- `src/firmware/model/`: layout tables, scale/palette/preset models, and pitch assignment
- `src/firmware/hardware/`: board constants, grid state, command buttons, scan/rotary handling, LED rendering, and LED animations
- `src/firmware/midi/`: USB/serial transport, MPE/routing, external MIDI LED state, delegated control, MIDI input parsing, and MIDI note dispatch
- `src/firmware/synth/`: synth defaults, built-in single-cycle waveforms, compatibility wavetable catalog, render orchestration, audio transport, oscillator/wavetable runtime, envelopes, modulation caches, voice allocation, arpeggiator, and metronome; hot render glue remains in `SynthAudio.cpp`, and synth-private declarations live in `SynthAudioInternal.h`
- `src/firmware/storage/`: persistent data models, settings/profile storage, synth preset/wavetable storage, and preset-sync protocol/geometry/synth-object/message handling
- `src/firmware/menu/`: OLED/GEM pages and settings callbacks, played-note drawing, synth preset menu rebuilding, and synth wavetable menu rebuilding

If you are changing behavior, start by locating which layer owns it. Shared constants, types, and lifecycle calls belong in the nearest owning header; subsystem-owned globals and hot helpers should stay private in their `.cpp` when no other module needs them. Fix missing declarations by improving the owning headers rather than reintroducing source inclusion.

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

Virtual-list launchers are intentionally built as GEM link items so they render
with the same right-side arrow as submenu and folder rows. `dealWithRotary()`
calls `handleVirtualListLauncherKey()` before normal GEM key dispatch so those
placeholder links open `VirtualListMenu` browsers directly instead of entering
empty GEM pages. `serviceVirtualListLauncherLabelScroll()` keeps the launcher
prefix fixed, waits `1.5` seconds on the selected row, then scrolls long current
names through the remaining row space every `250` ms. The last window is held
for another `1` second before the label returns to the beginning, and scrolling
is suppressed while played-note badge or full-screen overlays are visible.
The compact played-note badge is drawn through GEM's menu draw callback and the
custom `VirtualListMenu` frame renderer, so menu redraws send the menu and
badge in one OLED frame instead of repainting the badge afterward.
`VirtualListMenuProvider` can optionally expose a current selectable row with
`isCurrent` and an initial provider-index cursor target with
`getInitialSelection`; the renderer applies the current marker only to button
rows, so Back, folder links, and labels keep their existing visuals. The
geometry, synth preset load, and synth wavetable load browsers use these hooks
to mark and focus their active row when it is visible.
The main `Key` selector is a mutable GEM select backed by `current.tuning()`;
call `refreshMenuChoicesForCurrentTuning()` after runtime tuning changes so
built-in and user-geometry `keyChoices` labels are reflected on-device.

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

- `CURRENT_SETTINGS_VERSION` is currently `20`
- this release intentionally skips old profile compatibility: any `/settings.dat`
  file with a version other than `20` is replaced with factory defaults instead
  of being migrated
- version `20` reinterprets `DisplayPlayedNotes` as `Off`/`Label`/`Number`
  instead of a boolean; the byte position is unchanged
- version `19` no longer stores the old `Debug` byte;
  runtime `Serial Debug` state is intentionally RAM-only
- the LED current-limit default is `1.5 A`; its internal limiter budget is hardware-specific so `V1.1` and `V1.2` boards land near the same actual USB-side draw
- the LED current-limit calibration did not bump `CURRENT_SETTINGS_VERSION` because no persisted bytes were added, removed, or reordered
- the Synth Editor `Drive` setting is stored as `SynthDrive`; factory default is `Off`
- `PlaybackMode` defaults to `Poly`; valid values are `Off`, `MonoRtg`, `MonoLeg`, `Arp'gio`, and `Poly`; legacy stored mono value `1` now means `MonoRtg`; legacy transient `PolyTbl` value `5` is normalized to `Poly`
- onboard synth wheel effect is stored as `SynthModTarget` and `SynthModAmount`; factory defaults are `FoldWrp` and `100%`; valid runtime targets are `Vibrato`, `Pitch`, `WT Pos`, `FoldWrp`, `DutyWrp`, and `PolyWrp`; pitch target depth maps the signed `-127..127` runtime amount into a Q4 internal pitch accumulator spanning about `+/-24` semitones, then reads startup-generated RAM Q16 ratio tables; the three warp targets apply low-CPU phase warps before waveform or wavetable sampling, while `WT Pos` offsets wavetable frame position from the persisted `SynthWavetablePosition` base. `SynthWavetablePosition` remains a `0..127` byte internally, but the device and web selectors label it as frames `1..16` using rounded frame-anchor byte values.
- synth modulation target calculation runs on a `16`-sample control quantum for CPU headroom; per-voice phase increment and phase-warp depths then linearly slew between cached targets at audio rate to reduce pitch and warp stepping artifacts
- the synth LFO is stored as `SynthLfoTarget`, `SynthLfoAmount`, `SynthLfoWave`, and `SynthLfoSpeed`; the LFO targets the same modulation destinations as the wheel and FX envelopes, uses a bipolar amount byte where `127` is off, supports sine/triangle/saw/square shapes, and uses a `20`-entry `0.05 Hz` through `20 Hz` speed table
- onboard synth vibrato speed is stored as `SynthVibratoSpeed`; selectable values are `1 Hz` through `12 Hz`, with factory default `6 Hz`
- Dynamic JI stores its selected prime-limit table as `DynamicJIRatioTable`; table options run from `3Limit` through `41Limit`, and factory default `41Limit` preserves the previous full ratio-list behavior; the active table caches ratio indices only, and note-on matching computes full floating-point cents from each selected numerator/denominator candidate to preserve JI interval precision. The Dynamic JI and JI BPM controls are not currently installed on the fixed-memory `Tuning` browser and need a new menu home before release.
- mono portamento is stored as `SynthPortamentoTimeIndex`; it reuses the `0 ms` through `4 s` envelope time table and the menu hides `Porta` outside the two mono modes
- arpeggiator direction is stored as `ArpeggiatorDirection`; the menu hides `Arp Dir` outside `Arp'gio`; note-sorted directions compare assigned note/frequency rather than physical button number
- `SynthAttackEffect` is a deprecated hidden byte kept only so version `8` files can migrate by prefix copy
- `DeviceRotation` stores the four-step physical device orientation used by the Layout menu's `Device Rot` item; firmware maps that value to the OLED driver's opposite rotation because the mounted display is physically inverted. Selecting a layout seeds `DeviceRotation` from legacy `layoutDef.isPortrait` metadata: portrait layouts use `0`, and landscape layouts use `90`.
- metronome mode and time signature are stored as `MetronomeMode` and `MetronomeSignature`; factory defaults are `Off` and `4/4`
- the amp envelope has `EnvelopeAttackIndex`, `EnvelopeHoldIndex`, `EnvelopeDecayIndex`, `EnvelopeSustainLevel`, and `EnvelopeReleaseIndex`
- FX Env 1 is stored as `EffectEnvelopeTarget`, `EffectEnvelopeAmount`, `EffectEnvelopeAttackIndex`, `EffectEnvelopeHoldIndex`, `EffectEnvelopeDecayIndex`, `EffectEnvelopeSustainLevel`, and `EffectEnvelopeReleaseIndex`; factory defaults are `Vibrato`, `+100%`, and an inactive `0 ms`/`0%` envelope
- FX Env 2 is stored as `EffectEnvelope2Target`, `EffectEnvelope2Amount`, `EffectEnvelope2AttackIndex`, `EffectEnvelope2HoldIndex`, `EffectEnvelope2DecayIndex`, `EffectEnvelope2SustainLevel`, and `EffectEnvelope2ReleaseIndex`; factory defaults are `Pitch`, `+100%`, and an inactive `0 ms`/`0%` envelope
- Core 0 retries synth release commands until the audio renderer consumes one; the renderer clears the retry state when it accepts `StartRelease` so long releases do not repeatedly restart
- built-in tuning, layout, and scale catalogs are exposed as generated read-only
  geometry objects from `BuiltinGeometry.cpp`; they use handles starting at
  `0x2000`, live in the `/Built In` folder, and are not stored in
  `/layouts.dat`; the on-device Tuning browser shows built-in entries at the
  root while saved user tunings can be foldered, and Layout/Scales stay flat
  because they are filtered by the selected tuning
- synth presets are stored separately in `/synth_presets.dat` with magic `SYP`; preset file version is `10`; entries are stored as fixed-size flash records with a firmware cap of `128` presets; RAM keeps a fixed metadata index and one current full preset record, so preset values are read from flash only when loading, saving, comparing modified state, serving preset-sync reads, or marking/focusing the current on-device load-menu row; factory defaults copy `Soft String Pad` and `Bright Mono Lead` into ordinary editable root-folder preset slots, so users can erase or modify them and recover them with Reset Defaults or the web editor library; presets save synth sound parameters plus a wavetable folder/name dependency, but do not persist a current preset id; the on-device save/load menus use `VirtualListMenu` as folder browsers with `New Preset` or `Blank` as the first action row in the active folder; synth preset load and web preview call `syncSynthSettingsToRuntime()` so they update only synth runtime state and do not rerun tuning/layout/scale/LED assignment rebuilds; older preset files are intentionally not migrated in this 2.0 development format
- user synth wavetables are stored as a named fixed-capacity catalog in `/synth_wavetables.dat` with magic `SYW`, version `1`, up to `32` entries, and per-table sample files named from each `16`-byte wavetable object id; new sample files contain six fixed mip levels with `16` frames and `512` samples per frame at harmonic limits `192`, `96`, `48`, `24`, `12`, and `6` (`49,152` bytes total), while `8,192`-byte base-only files are still accepted and expanded in RAM. The selected wavetable is also snapshotted per profile in `/profile_wavetables.dat` with magic `PWT`, version `1`, so loading a profile restores its folder/name wavetable reference before runtime sync. The on-device wavetable load menu uses `VirtualListMenu` with built-in tables at the root and folder navigation for user tables, and it marks/focuses the active wavetable row when that row is visible. The old `/user_wavetable.dat` `UWT` slot remains loadable only as legacy `/User/UserTbl` compatibility.
- user geometry objects are stored in `/layouts.dat` with magic `LYT`, version `2`, up to `64` raw object bodies across `UserTuning`, `UserLayout`, `UserScale`, `ScaleColorMap`, and `ExplicitButtonMap`; preset-sync validates the common `HBS1` object envelope, schema major `1`, `Name`, and `ObjectId`, then preserves the raw body for list/read/write/delete round-trip. Runtime Apply currently supports generated EDO/equal-step and Scala/cents-list user tunings, vector layouts, included-degree scales, scale color maps, and format-1 explicit button maps. RAM keeps fixed metadata/file-offset entries with `20`-byte geometry name/folder buffers and lazy-loads raw bodies from flash when applying or serving reads, and the active tuning/layout/scale object ids are retained in runtime state so the on-device browsers can mark and focus the current row when it is visible. The web editor caps geometry object names and single folder labels at `19` display characters and note labels at `7` characters. The visible OLED `Tuning`, `Layout`, and `Scales` pages use `VirtualListMenu`, a fixed-memory renderer that mirrors GEM Back/button-list drawing, 11-row paging, wrapping, pointer, and scrollbar behavior while caching only 16-bit geometry handles instead of allocating one `GEMItem` per object. Tuning entries are bundle anchors, layout/scale entries are filtered by the selected tuning object id, and user layout/scale rows are capped at `24` associated objects. Built-in tuning entries are shown flat at the root, saved user tunings can be foldered, and Layout/Scales remain flat on-device. Save/delete requests defer a menu rebuild like synth preset menus. Profile references and settings persistence for the selected user geometry bundle remain future work.
- the Advanced-menu boot animation toggle is stored as `BootAnimationEnabled`; factory default is enabled
- the Advanced-menu headphone output cap is stored as `HeadphoneVolumeCap`; factory default is `100%`; `setupHardware()` inserts its menu item only on hardware `V1.2`, and the audio block renderer applies it only to the jack sample before DMA writes the `AJACK` PWM level
- a missing `/settings.dat` sets `settingsFileMissingOnBoot` for the current boot before factory defaults are saved
- invalid or mismatched settings files restore factory defaults
- version `2` through `19` settings files currently restore factory defaults instead of migrating; the older migration helper remains in the code for reference, but `load_settings()` no longer dispatches to it in this release
- auto-save is debounced for `10 seconds`
- auto-save copies runtime state back into slot `0` before writing
- flash writes go through `flashSafeSave()` / `beginFlashSafeWrite()` to show
  the saving notice, fade output to idle, and queue idle audio before interrupts
  are blocked
- on hardware `V1.2`, the `AudioDestination` setting now behaves as a
  jack-default `Buzzer` toggle that switches synth output to piezo; legacy
  stored values are interpreted by checking whether the older byte had the piezo
  bit set

If you add, remove, reorder, or reinterpret settings, think about migration. This release deliberately uses defaults-only fallback for any older settings file. Re-enable or replace the older migration helper only if preserving existing profile data becomes a requirement again. Unknown version mismatches still fall back to defaults.

## MIDI And Tuning Notes

The MIDI subsystem supports three broad modes:

- standard single-channel MIDI
- multi-channel standard MIDI for extended note coverage
- MPE with per-note pitch bend

For the external-only raw button/LED surface mode, see `docs/delegated-control.md`.
Delegated control also has a RAM-resident MIDI note map that hosts can update
with live SysEx commands. It persists across delegated enter/exit cycles and LED
updates, but deliberately does not use `SettingKey`, profiles, or the
preset-sync object store; keep it transient unless that product decision
changes.
The delegated enter command can carry a short printable app name for the OLED,
and `dealWithRotary()` switches from GEM menu input to delegated encoder-event
SysEx while delegated mode is active. A 5-second encoder hold is the local
escape path; do not route that through the normal 2-second panic behavior.
For the host sync protocol covering profiles, user tunings/layouts, mapping
objects, and named synth presets, see `docs/preset-sync-sysex.md`. Current
firmware can persist, round-trip, and live-apply the core geometry path:
generated EDO/equal-step `UserTuning` objects feed `current.tuning()` and the
MIDI pitch offset from `ReferenceMidiNote`/`ReferenceMilliHz`; Scala/cents-list
`UserTuning` objects also load a RAM cents table that resolves every
`stepsFromC` value against that 1/1 reference into synth frequency, MIDI note
choice, and MPE bend; vector `UserLayout` objects feed
`applyLayout()`; `UserScale` included degrees feed `applyScale()`;
`ScaleColorMap` feeds `setLEDcolorCodes()`; and format-1 `ExplicitButtonMap`
objects override per-button role, pitch, and color before pitch assignment is
rebuilt. The visible OLED tuning/layout/scale pages are backed by saved user
geometry objects: selecting a tuning loads its linked first layout, first scale,
color map, and button map; selecting layout or scale later swaps only that part
within the current user tuning. The active user geometry selection remains
RAM-only and is not yet persisted in profiles or settings.
Cents-list playback treats degree `0` as an implicit `0`-cent reference and
wraps positive or negative step values by the table period; ratio-list tuning
objects are still not a runtime-supported kind. Manual `ExplicitButtonMap`
note positions are absolute `stepsFromC` values. Root/key and transposition
settings should affect scale highlighting and final sounded pitch, but should
not regenerate those manual button records.

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
computes only the selected physical output path for each sample: hardware `V1.2`
uses the jack unless `Buzzer` is enabled, and hardware `V1.1` uses piezo.
Inactive piezo output is switched to GPIO and held low;
inactive jack output remains PWM-centered so the headphone path stays centered.
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
`src/firmware/synth/SynthOscillatorBank.cpp`, but only the selected waveform or wavetable is copied into
the preallocated `activeSynthWaveTable` RAM buffer used by the audio renderer.
The vibrato sine lookup remains a separate RAM table because the renderer reads
it directly.
The legacy `Waveform` byte remains in settings and preset value lists for
compatibility, but the visible synth source selector is now a named wavetable
reference. Built-in compatibility tables group old single-cycle waves into
`Basic Shapes`, `Classic`, `HarshDigitalBois`, `RustyBlade`, `RoundThe808`, and
`GlassyBells`; `Vowels` is also shipped as a factory wavetable. Old preset
loading derives the table and `SynthWavetablePosition` anchor from the legacy
waveform value. `Hybrid` intentionally maps to `Basic Shapes` at position `0`.
The active wavetable folder/name is string metadata outside the byte-oriented
settings array. Firmware persists the current reference in
`/current_wavetable.dat` and keeps per-profile snapshots on flash in
`/profile_wavetables.dat`; those profile references are read or rewritten only
during profile/file operations, not cached in global SRAM. Settings saves,
manual profile saves, autosave, on-device preset/wavetable loads, and
preset-sync save-and-apply commits update the relevant references. Startup
loads the wavetable catalog, restores the active profile's reference, then lets
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

All active tables use the same RAM path: firmware builds or loads the base
`16 x 512` table into `activeSynthWaveTable` and stores the remaining
full-length mip levels in `activeSynthWavetableMipExtraSamples`. The sampler
runs in the normal synth modes and interpolates adjacent frames from
`SynthWavetablePosition` plus signed `WT Pos` modulation. The selected
wavetable also rebuilds a RAM `WT Pos` lookup table so the audio renderer maps
`0..127` position amounts to frame positions without a per-voice divide.
Modulation work runs on a `16`-sample control quantum: wheel smoothing, LFO
sampling, FX envelope state, pitch/vibrato targets, phase-warp targets, mip
selection, and wavetable frame contexts are cached there, with note
start/release/reset forcing an immediate per-voice cache refresh. Each voice
chooses a bright mip and adjacent dull mip from the highest expected pitch after
pitch modulation and vibrato depth; the selector computes the Nyquist-safe
harmonic limit in Q8 fixed point and selects one table pointer for the
per-sample renderer. Selection is biased toward the duller level until the
brighter level is safely inside the threshold, which avoids aliasing at
boundaries without per-sample mip blending.
Wavetable frame contexts and mip decisions update every other modulation
quantum by `SYNTH_WAVETABLE_CONTEXT_RATE_DIVIDER`, halving the earlier frame/mip
interpolation cost while pitch and warp slews still retarget on the normal
`16`-sample quantum.
Per-voice phase increment and phase-warp depths slew between cached targets at
audio rate; the normal `16`-sample retarget uses shift math instead of division.
Oscillator phase
advance, phase warping, waveform reads, amp-envelope level, mixing, drive, and
output scaling remain audio-rate. When only global sources such as the wheel or
LFO modulate `WT Pos`, the cached frame-pair position is shared by all voices;
when an FX envelope targets `WT Pos`, each voice caches its own frame context.
FX-envelope modulation depth reads a startup-filled `128 x 128` RAM scale table
instead of multiplying in the control refresh, and FX envelopes advance by the
full `16` audio ticks on each control refresh so long envelope timing stays
aligned while worst-case blocks avoid rebuilding modulation every sample.

New user wavetables are saved through the named wavetable catalog. Presets store
only the wavetable folder/name dependency, so a missing dependency falls back to
`Basic Shapes` until a matching table is installed. The old `/user_wavetable.dat` file
has a `UWT` header with version, frame count, sample count, and CRC32, then
`16 * 512` unsigned waveform bytes; it is still loadable as `/User/UserTbl` for
compatibility. Preset-sync object type `0x0B` accepts either the legacy
base-only sample TLV or the new `MipLevels = 6` fixed-mip sample TLVs before
copying the table into active RAM and optionally writing the named catalog entry
through the flash-safe mute wrapper.

Pitch bend and wheel phase-warp modulation have synth-local smoothing separate from
MIDI output. `setSynthFreq()` writes a target oscillator increment for held
voices and only resets phase for new synth notes. The audio block renderer slews
each voice's current increment toward that target, and wheel modulation reads a
smoothed value instead of `modWheel.curValue` directly.

Poly voice stealing is intentionally more specific than "oldest voice wins".
`stealOldestSynthVoice()` guards the lowest held voice, then prioritizes the
oldest duplicate note, the oldest released voice by release time, and finally
the oldest remaining held voice by start time. Steals publish a renderer-side
handoff command: the old voice keeps its oscillator for a `64`-sample fade, and
the replacement note's frequency/envelope attack are applied only after that
fade completes. Keep retune and release paths aware of
`synthStealHandoffPending()` so pending voices are not retuned early.

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

The Advanced-menu `Stability` item is also transient. It lives in
`src/firmware/app/StabilityBenchmark.cpp`, uses the audio profiling counters
from `DiagnosticsTiming.cpp`, and has no `SettingKey`. It saves/restores runtime
synth, wheel, metronome, animation, and audio-destination state, then
drives a worst-case eight-voice patch with periodic voice steals. Runtime task
labels are stamped from `hexboardLoop()` and `hexboardLoop1()` so the OLED can
show the last Core 0/Core 1 subsystem entered. During the benchmark, normal
`sendToLog()` and periodic serial-debug category output are suppressed to avoid
serial/heap churn; if `Serial Debug` was enabled at launch, the benchmark emits
its own fixed-buffer status lines.
Hold the encoder for about `5` seconds to request exit. Do not add this to
`factoryDefaults` or bump `CURRENT_SETTINGS_VERSION`.

The Advanced-menu `Serial Debug` submenu is transient. It has no `SettingKey`.
`serialDebugEnabled` gates the runtime-only message categories in
`DiagnosticsTiming.cpp`: `General Log` feeds `sendToLog()`, `Min Heap` prints
current/minimum `rp2040.getFreeHeap()` values during normal operation, and
`Audio Stats` captures the audio profiler window and prints average CPU, max
CPU, worst max CPU since Serial Debug was enabled, and DMA
underrun/render-overrun/max-block counters. The menu only reveals the category
toggles while `Enabled` is on.

Runtime geometry Apply loads the active `ScaleColorMap` and sets `ColorMode`
from its `DefaultColorMode` TLV. `Custom` renders the map's scale-degree
palette; other modes use the same generated firmware color modes available
from the device menu. Manual per-button
colors from an `ExplicitButtonMap` override the palette only while `Custom` is
selected and should not be
recalculated when root/key or transposition changes. `setLEDcolorCodes()` caps
only the resting value for user-generated colors at `VALUE_NORMAL` before the
usual `Rest Bright` scaling, while play and animation caches still use the full
selected color target.

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
4. Verify the virtual geometry browsers filter linked layouts/scales correctly and key spinner logic still behaves

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

- Turn on `Advanced` -> `Serial Debug` if you need runtime logs, heap sampling,
  or audio counters. The setting is not persisted.
- Use `Advanced` -> `Stability` to run the integrated worst-case benchmark. It
  reports DMA underruns, audio render overruns, min free heap, max audio block
  time, voice steals, max main-loop duration, and last Core 0/Core 1 task labels.
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
