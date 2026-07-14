# HexBoard MIDI Controller

HexBoard is a hexagonal MIDI controller and instrument built around the RP2040.
The firmware in this repository drives:

- a `140`-button illuminated hex grid
- USB and serial MIDI output
- microtonal and isomorphic layouts
- an onboard synth with mono retrigger, mono legato, polyphonic, and arpeggiated playback
- an OLED menu system for tuning, layout, color, MIDI, synth, and profile management

You can [order a HexBoard](https://shapingthesilence.com/) if you are interested in the hardware.

## Documentation

- [User Manual](docs/user-manual.md): playing, menu behavior, settings, firmware updates, and troubleshooting
- [Sequencer Manual](docs/sequencer/manuals/sequencer_manual.txt): optional sequencer builds, playback, file management, and USB backup
- [MPE Microtonal Setup Guide](docs/mpe-microtonal-setup.md): DAW, plugin, and synth setup for HexBoard's microtonal MIDI output
- [Developer Guide](docs/developer-guide.md): current firmware architecture, edit patterns, settings wiring, risk areas, and verification
- [Delegated Control Protocol](docs/delegated-control.md): external raw button/LED control SysEx behavior
- [Preset Sync SysEx Draft](docs/preset-sync-sysex.md): preset-sync frames, object schemas, and implemented/draft object workflows
- [Web App README](web/README.md): companion web app development, deployment, and current scope

`docs/code-analysis.md` is kept only as a compatibility pointer to the developer
guide. Current implementation facts should live in the docs above, not in a
separate analysis document.

## Repository Layout

- `AGENTS.md`: AI agent and contributor instructions, including documentation update requirements
- `HexBoard.ino`: root Arduino sketch with only lifecycle wrappers
- `src/firmware/`: primary firmware implementation modules
- `web/`: isolated Vite/React companion app for preset-sync workflows
- `docs/`: user, developer, protocol, and workflow documentation
- `scripts/`: host-side helper tools, including the HexBoard Backup GUI
- `Makefile`: local build shortcut for `arduino-cli`

Firmware implementation is grouped by owner under `src/firmware/`. The root
sketch delegates to lifecycle functions there, and subsystem headers expose the
cross-module APIs needed by other modules.

## Current Firmware Highlights

The current code supports:

- multiple tunings, including non-12-EDO systems
- multiple isomorphic layouts with rotation and mirroring
- scale filtering with optional scale lock
- multiple LED color modes and animations
- boot and Advanced-menu LED test modes for spotting failed pixels or color channels
- an Advanced-menu stability benchmark for worst-case synth, LED, display, and sync stress testing
- a USB-meter-calibrated LED current limiter to reduce brownouts in bright modes
- an optional OLED note overlay that shows currently played notes as labels or scale-step numbers
- standard MIDI, extended multi-channel MIDI mapping, and MPE behavior
- dynamic just intonation and BPM-linked retuning options
- onboard synth waveform/wavetable banks, Serum/Vital and HexBoard wavetable import, mono portamento, AHDSR envelope, phase-warp/wavetable/LFO modulation, presets, and arpeggiator settings
- an external-only delegated-control mode for host-driven buttons and LEDs
- persistent settings with `9` profile slots stored in LittleFS
- an optional sequencer build, documented in the [Sequencer Manual](docs/sequencer/manuals/sequencer_manual.txt)

## Team

- Jared DeCook has been writing music, developing hardware, and performing as [Shaping The Silence](https://shapingthesilence.com/) for over a decade.
- Zach DeCook has been listening to music, breaking hardware, and occasionally writing software since the former discovered his exploitable talents.
- Nicholas Fox has been hexperimenting with the firmware since before receiving a HexBoard in the mail.
- Robert Wierzbicki created the sequencer and a few random other changes.

## Hardware And Build Target

The current source targets:

- Generic RP2040
- `250 MHz`
- `16 MB` flash with `8 MB` LittleFS
- Pico SDK USB stack
- USB manufacturer/product descriptor `HexBoard`
- Generic SPI `/4` boot2

The default `make` target builds the current `250 MHz` firmware as
`build/HexBoard.uf2`. `make overclocked` produces the same configuration with a
`_250MHz` filename suffix.

The `Makefile` and firmware headers under `src/firmware/` are the most reliable
build references for this repository.

## Building The Firmware

You need:

- [arduino-cli](https://arduino.github.io/arduino-cli/latest/)
- the Earle Philhower RP2040 core
- `Adafruit NeoPixel`
- `U8g2`
- `Adafruit GFX Library`
- `GEM`

The simplest local build is:

```sh
make
```

The `Makefile` compiles the repository sketch directly with the project board
options and writes flashable files under `build/`.

To compare onboard synth PWM resolutions, pass `PWM_BITS` at build time:

```sh
make PWM_BITS=9
```

Supported values are `8`, `9`, and `10`; the default is `10`.

The in-port sequencer is compiled out by default. To expose the `Sequencer`
menu entry, build with:

```sh
make HEXBOARD_ENABLE_SEQUENCER=1
```

Default and sequencer builds are renamed to:

```text
build/HexBoard.uf2
build/HexBoard_Sequencer.uf2
```

Use `make sequencer-builds` to compile both variants. See the
[Developer Guide](docs/developer-guide.md) for implementation details and the
[Sequencer Manual](docs/sequencer/manuals/sequencer_manual.txt) for current sequencer behavior.

## Companion Web App

The preset-sync companion app lives under `web/` as an isolated Vite, React, and
TypeScript project. It uses Web MIDI SysEx for device access, supports mock
transport work when no compatible device is attached, and covers tuning/layout,
synth preset, and wavetable workflows.

Use [web/README.md](web/README.md) for install, local development, tests,
GitHub Pages deployment, and current app scope.

## Flashing The Firmware

Firmware update and bootloader instructions live in the
[User Manual](docs/user-manual.md#updating-firmware).

## Development Notes

Start with the [Developer Guide](docs/developer-guide.md) when editing firmware.
It owns the current architecture map, settings recipes, refresh paths, risk
areas, and verification checklist. Protocol-specific behavior stays in
[Delegated Control Protocol](docs/delegated-control.md) and
[Preset Sync SysEx Draft](docs/preset-sync-sysex.md).
