# HexBoard Firmware v2.0 beta 2 - "The Big Sync"

This is the first public beta for HexBoard firmware 2.0, and it is a big one.

Since v1.3.0, HexBoard has grown from a standalone synth/controller with preset saving into a much more complete instrument ecosystem: there is now a browser-based editor, deeper tuning and layout support, user wavetables, safer sync, smoother audio, better OLED feedback, and an optional Sequencer build for anyone who wants to try the new step-sequencing workflow early.

The headline version: more sound design, more ways to customize the board, much better backup/sync tooling, and a lot of under-the-hood work to make the firmware easier to maintain.

## New Features

### HexBoard Sync Web App

A new browser-based HexBoard Sync app is now included in the repository.

It can connect to HexBoard over Web MIDI SysEx and manage:

* Synth presets
* User wavetables
* Tunings
* Layouts
* Scales
* Color palettes
* Profiles

The app can save libraries on your computer, upload them to HexBoard, download them from HexBoard, rename items, organize folders, and preview compatible changes live before writing them to flash.

Chrome or Edge is recommended because the app needs Web MIDI SysEx support.

### Tuning, Layout, and Scale Editor

HexBoard now has much deeper tuning and layout editing through the web app.

New editor capabilities include:

* EDO tuning creation
* Equal-step tuning creation
* Scala `.scl` imports
* Custom note labels
* MIDI-note tuning references
* Custom vector layouts
* Per-button note and color overrides
* Scale and scale-degree palette editing
* Live preview on the connected HexBoard

This also means non-12 tunings can now show proper note labels on the device instead of being limited to generic scale-step numbers.

### User Wavetables

The synth can now use user wavetables.

The web app can import wavetable `.wav` files, including Serum/Vital-style files, and convert them for HexBoard. Import tools include normalization, frame reduction, smoothing, and dithering options.

Wavetables can now be:

* Uploaded to HexBoard
* Downloaded from HexBoard
* Renamed
* Moved into folders
* Selected by synth presets
* Previewed in the web app

Several Matthew Parker wavetable sets and a Vowels wavetable are included as defaults.

### Optional Sequencer Build

There is now an optional Sequencer firmware build.

It adds a step-sequencing mode with:

* Step playback and transport controls
* Step editing and audition notes
* Copy, erase, transpose, and tool workflows
* Monophonic and polyphonic step behavior
* MIDI clock receive
* MIDI clock and transport send
* File save/load/rename/delete flows
* Performance monitor screen
* USB Backup workflow

The Sequencer is being shipped as a separate optional build for this beta. If you want the safest build for performance, use the normal `HexBoard.uf2`. If you want to try the new Sequencer workflow, use `HexBoard_Sequencer.uf2`.

## Synth Improvements

### Wavetable Synth Expansion

The onboard synth now has a much more capable wavetable system.

Highlights include:

* 512-sample wavetable frames
* 16-frame built-in wavetable sets
* Six-level mipmapped wavetable playback
* Safer wavetable interpolation near aliasing thresholds
* Streamed wavetable reads from LittleFS where appropriate
* Fully rendered default wavetables compiled into firmware

The old "wavetable mode" has been rolled into the normal poly synth workflow, so wavetable position is now part of the regular synth sound design path.

### More Modulation

The synth modulation system has been expanded and cleaned up.

New and updated modulation options include:

* LFO support
* Noise LFO waves
* Wavetable position modulation
* Fold warp
* Duty warp
* Polynomial warp
* Wider pitch modulation depth
* Smoother vibrato and wheel movement

Several synth targets were renamed to make the menu clearer. For example, `Morph` became `FoldWrp`, and additional warp modes were added for pulse-width and polynomial-style shaping.

### Mono, Portamento, and Arp Updates

The synth now has more performance modes:

* Poly mode remains the default
* Mono retrigger mode
* Mono legato mode
* Portamento for mono modes
* Additional arpeggiator directions

Note stealing was also reworked to improve playability and sound quality under heavier polyphony.

### Dynamic JI Improvements

Dynamic Just Intonation now sounds cleaner and behaves more reliably.

Under the hood:

* Dynamic JI ratio candidates cache cents values
* The internal synth uses direct frequency multipliers instead of being quantized by MPE pitch-bend resolution
* External MPE output chooses the closest MIDI note after Dynamic JI/BPM retuning and sends only the remaining bend
* Note-off uses the exact MIDI note that was sent on note-on, which helps prevent stuck notes after retuning

There is also a selectable Dynamic JI ratio table, with clearer "Limit" naming.

## Visual and Interface Improvements

### Played Note Display

The OLED played-note display has been expanded.

`DisplayNotes` now supports:

* `Off`
* `Label`
* `Number`
* `MIDI`

`Label` shows the active tuning's note labels. `Number` shows scale-step/octave style values. `MIDI` shows the current MIDI note number.

When the menu is visible, played notes use a compact top-right badge instead of taking over the whole screen. If the OLED is asleep, playing a note can still wake a larger `Now Playing` display.

### Command Wheel Overlay

The velocity, modulation, and pitch-bend wheels now get a dedicated OLED overlay.

The overlay shows:

* Which wheel is being edited
* The current value
* A centered meter
* Pitch-bend range feedback

Wheel drawing is throttled and catches up based on elapsed time, so wheel movement stays responsive even when the display or LEDs are busy.

Factory defaults now use `Medium` for all three wheel speeds.

### Menu Polish

The menu has had a broad cleanup pass.

Changes include:

* Profiles moved to the top level
* Settings pages reordered for easier access
* Current items in virtual lists use a diamond marker instead of a text asterisk
* Long virtual-list launcher labels scroll after a delay
* Current synth preset and wavetable rows are easier to find
* The Amp Envelope has its own synth menu page
* The hidden `Stability` benchmark item was removed from the Advanced menu
* The `Update Firmware` screen now gives clearer UF2 copy instructions

The firmware update screen now tells you when HexBoard is ready for the `.uf2` file and points you to the `RPI-RP2` drive.

### Boot and Display Behavior

Boot animation and display sleep behavior were cleaned up.

Notable changes:

* Boot animation is centered around the physical center key
* Left/right mirror behavior was corrected
* Display sleep handling is more consistent
* Played-note overlays, command-wheel overlays, transfer screens, and menu redraws coordinate better with each other

## Web App and Sync Improvements

### Preset and Library Management

The web app now has a much more capable library workflow.

You can:

* Create folders
* Rename presets and wavetables
* Move objects between folders
* Export and import JSON
* Upload/download objects to and from HexBoard
* Confirm overwrites before replacing existing device data
* Keep metadata reads lightweight when browsing device libraries

The synth preset editor also includes an audition panel for trying sounds from the browser.

### Safer SysEx Transfers

Preset sync has been rebuilt around chunked, ACKed SysEx transfers.

This makes larger object transfers more reliable and allows the firmware to treat different transfer types differently:

* Single live synth edits update quickly and do not show the transfer screen
* Larger object transfers show the `MIDI SysEx Transfer` screen
* Transfers that write flash mute audio during the flash-write window
* Flash-save status now shows `Saving to flash. Audio muted.`

The firmware also avoids unnecessary writes when incoming references have not changed.

### Firmware 1.3 Preset Migration

When upgrading from firmware v1.3.0, changed synth presets can be migrated into a folder named `1.3 Patches`.

Only presets that differ from the old v1.3 defaults are migrated. Older settings formats reset to factory defaults, but the v1.3 synth-preset migration gives existing 1.3 users a path to keep their saved sounds.

## Audio and Performance Improvements

### Core Audio Engine Work

The audio engine has had major internal work since v1.3.

Highlights include:

* 64-sample audio block rendering on Core 1
* DMA-fed PWM output using ping-pong buffers
* About 40.7 kHz PWM pacing from a dedicated timer slice
* Jack and buzzer output are no longer driven simultaneously
* V1.2 hardware uses jack output normally, with a Buzzer option for piezo output
* Audio profiling now reports block timing and DMA underruns

Several hot synth paths were moved toward RAM lookup tables and cached per-voice state to reduce expensive work during playback.

### Smoother Control Updates

Wheel smoothing, LFO sampling, FX envelopes, pitch/vibrato modulation, warp depth, and wavetable frame context now refresh on a control quantum instead of rebuilding everything every sample.

Note start, release, and reset events force an immediate refresh so new notes still respond quickly.

### USB MIDI Responsiveness

Live USB MIDI packet writes now fail fast when a connected host is not polling the endpoint.

In normal language: if your computer is asleep, closed, or not reading MIDI, HexBoard should spend much less time waiting on USB and more time staying responsive.

SysEx transfers still use the longer transfer-safe path.

The USB MIDI path has also been reworked around the Pico SDK MIDI stack, which helped stabilize the larger sync workflows.

### Output Safety and Volume Caps

Output routing and level controls were cleaned up.

New behavior includes:

* V1.2 defaults to headphone/jack output
* Buzzer mode switches synth output to the piezo
* Headphone and piezo output caps help keep levels under control
* Jack and buzzer output are no longer driven at the same time

## Storage, Flash, and Reliability

### Flash-Safe Audio Muting

Flash writes are now handled more carefully around audio.

Transfers that save to flash mute audio before the flash operation and fade back in afterward. This avoids the sharp audio stutter that could happen when flash writes blocked code execution.

This is limited to transfer operations that actually save to flash, so normal live edits do not mute the synth.

### Persistence and Corruption Resistance

Settings, presets, geometry objects, and wavetable references have all had storage work.

Technical details:

* CRC-protected settings/profile persistence
* Settings version checks reset incompatible older settings to factory defaults
* Separate current wavetable references for presets/profiles
* Safer object read abort handling
* Fixed-memory and virtual-list browsing paths to reduce heap pressure
* File/folder catalogs for synth presets, wavetables, and geometry objects

## Advanced and Host-Control Features

### Delegated Control

Delegated-control mode has been expanded for host-controlled setups.

New behavior includes:

* Host-provided app name on the OLED
* Hold-encoder-to-exit prompt
* Normal menu disabled while delegated mode is active
* Raw button events sent to the host
* SysEx LED control
* Per-key delegated MIDI note mapping
* Held-key tracking to prevent stuck notes when mappings change

### Backup Tooling

The repository now includes USB Backup helper scripts and launchers.

These are mostly aimed at Sequencer file backup/restore workflows, but they also lay groundwork for safer device-file management from a computer.

## Firmware Architecture

This release includes a major firmware modularization pass.

The old large firmware source has been split into clearer subsystem modules:

* `app`
* `hardware`
* `menu`
* `midi`
* `model`
* `sequencer`
* `storage`
* `synth`
* `tuning`

This does not sound flashy, but it matters. The firmware is now much easier to reason about, compile in smaller pieces, and extend without turning every change into surgery on one huge file.

The build system was also simplified and now produces separate normal and Sequencer UF2 files.

## Documentation

Documentation has been expanded again.

New and updated docs include:

* User manual
* Developer guide
* Preset-sync SysEx protocol
* Delegated-control protocol
* MPE microtonal setup guide
* Sequencer manual
* Sequencer quick manual
* Sequencer screen/layout specs
* Sequencer requirements docs
* Web app README

The goal is for HexBoard to be easier to use, easier to back up, and easier to hack on without needing to reverse-engineer the whole codebase first.

## Compatibility Notes

* Firmware label: `2.0 beta 2`
* Normal build: `HexBoard.uf2`
* Optional Sequencer build: `HexBoard_Sequencer.uf2`
* Upgrading from firmware v1.3.0 can migrate changed synth presets into `1.3 Patches`
* Older settings versions reset to factory defaults
* New factory defaults use `Medium` command-wheel speeds
* The Sequencer build is optional and should be treated as less stable during this beta

## Summary

Firmware v2.0 beta 2 is the biggest HexBoard update so far.

It adds:

* A full browser-based sync/editor app
* User wavetables
* Much deeper tuning and layout customization
* Expanded synth modulation and wavetable playback
* Better OLED feedback
* Safer flash-write behavior
* More reliable SysEx transfers
* Better backup and library workflows
* Optional Sequencer support
* A cleaner firmware architecture for future work

This beta is mostly about opening up the system: more ways to make sounds, more ways to shape the grid, and more ways to move your work between HexBoard and your computer.

## How to Update

1. Plug your HexBoard into your computer.
2. On HexBoard, open `Advanced` -> `Update Firmware`.
3. The HexBoard screen will say it is ready to update.
4. Your computer should show an `RPI-RP2` drive.
5. Copy the `.uf2` firmware file onto the `RPI-RP2` drive.
6. HexBoard will reboot into the new firmware automatically.

Use `HexBoard.uf2` for the normal beta firmware.

Use `HexBoard_Sequencer.uf2` only if you want to test the optional Sequencer build.

## Backup Bootloader Method

If the menu update path is not available, hold the physical bootloader button while plugging HexBoard into your computer.

* Hardware 1.1: button near the USB port
* Hardware 1.2: hidden underneath the board near the ports, reachable with a paperclip

Then copy the `.uf2` file to the `RPI-RP2` drive.
