# HexBoard MIDI Controller

HexBoard is a hexagonal MIDI controller and instrument built around the RP2040. The current firmware in this repository drives:

- a `140`-button illuminated hex grid
- USB and serial MIDI output
- microtonal and isomorphic layouts
- an onboard synth with mono, polyphonic, and arpeggiated playback
- an OLED menu system for tuning, layout, color, MIDI, synth, and profile management


You can [order a HexBoard](https://shapingthesilence.com/) if you are interested in the hardware.

## Documentation

- [User Manual](docs/user-manual.md)
- [MPE Microtonal Setup Guide](docs/mpe-microtonal-setup.md)
- [Developer Guide](docs/developer-guide.md)
- [Code Analysis](docs/code-analysis.md)
- [Delegated Control Protocol](docs/delegated-control.md)
- [Preset Sync SysEx Draft](docs/preset-sync-sysex.md)

The user manual is for players and owners of the device. The MPE setup guide is for configuring DAWs, plugins, and synths for HexBoard's microtonal MIDI output. The developer guide is for people editing the firmware in this repository.

## Repository Layout

- `AGENTS.md`: AI agent project instructions, including the documentation update requirement
- `src/HexBoard.ino`: primary firmware source
- `web/`: isolated Vite/React companion app scaffold for preset sync
- `docs/`: documentation for users and contributors
- `Makefile`: local build shortcut for `arduino-cli`

The current firmware is intentionally maintained as a single large sketch file, but it is organized internally into subsystem sections such as tuning, layout, LEDs, MIDI, synth, persistence, menu, and main loop.

## Current Firmware Highlights

The current code supports:

- multiple tunings, including non-12-EDO systems
- multiple isomorphic layouts with rotation and mirroring
- scale filtering with optional scale lock
- multiple LED color modes and animations
- boot and Advanced-menu LED test modes for spotting failed pixels or color channels
- a USB-meter-calibrated LED current limiter to reduce brownouts in bright modes
- an optional OLED note overlay that shows currently played notes
- standard MIDI, extended multi-channel MIDI mapping, and MPE behavior
- dynamic just intonation and BPM-linked retuning options
- onboard synth waveform banks, AHDSR envelope, modulation, preset, and arpeggiator settings
- an external-only delegated-control mode for host-driven buttons and LEDs
- persistent settings with `9` profile slots stored in LittleFS

## Team

- Jared DeCook has been writing music, developing hardware, and performing as [Shaping The Silence](https://shapingthesilence.com/) for over a decade.
- Zach DeCook has been listening to music, breaking hardware, and occasionally writing software since the former discovered his exploitable talents.
- Nicholas Fox has been hexperimenting with the firmware since before receiving a HexBoard in the mail.

## Related Firmware History

This repository contains the main Arduino-based HexBoard firmware.

Older and related references:

- [SourceHut project page](https://git.sr.ht/~earboxer/HexBoard)
- [Tagged releases on SourceHut](https://git.sr.ht/~earboxer/HexBoard/refs)
- Posterity builds sometimes mirrored at [zachdecook.com/HexBoard/firmware](https://zachdecook.com/HexBoard/firmware/)
- Historical `hexperiment` branch and related work may appear at [GitHub](https://github.com/theHDM/hexperiment) or [SourceHut](https://git.sr.ht/~earboxer/HexBoard/tree/hexperiment)

## Hardware And Build Target

The current source targets:

- Generic RP2040
- `250 MHz`
- `16 MB` flash with `8 MB` LittleFS
- Pico SDK USB stack
- USB manufacturer/product descriptor `HexBoard`
- Generic SPI `/4` boot2

The source comments in `src/HexBoard.ino` and the `Makefile` are the most reliable build references for this repository.

## Building The Firmware

### Dependencies

You need:

- [arduino-cli](https://arduino.github.io/arduino-cli/latest/)
- the Earle Philhower RP2040 core
- the required Arduino libraries

Install the board core and libraries with:

```sh
# Download the board index
arduino-cli --additional-urls=https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json core update-index

# Install the RP2040 core
arduino-cli --additional-urls=https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json core download rp2040:rp2040
arduino-cli --additional-urls=https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json core install rp2040:rp2040

# Install libraries
arduino-cli lib install "Adafruit NeoPixel"
arduino-cli lib install "U8g2"
arduino-cli lib install "Adafruit GFX Library"
arduino-cli lib install "GEM"

# Older GEM installs may need this compatibility tweak
sed -i 's@#include "config/enable-glcd.h"@//\0@g' ~/Arduino/libraries/GEM/src/config.h
```

### Build With `make`

The simplest local build is:

```sh
make
```

The `Makefile` builds from `src/HexBoard.ino` using the board options for this project. During the build it stages a generated sketch at `build/build.ino`; do not edit or maintain that generated file.
The local `250 MHz` build intentionally uses `Generic SPI /4` boot2 to keep the external flash clock stable while giving the synth ISR enough headroom for dense AHDSR and FX-envelope patches.

To compare onboard synth PWM resolutions, pass `PWM_BITS` at build time:

```sh
make PWM_BITS=9
```

Supported values are `8`, `9`, and `10`; the default is `10`.

The expected output artifact is:

```text
build/build.ino.uf2
```

## Companion Web App

The preset-sync web app lives under `web/` as an isolated Vite, React, and
TypeScript project. It is browser-first, uses Web MIDI SysEx for device access,
and includes a mock MIDI transport so protocol and catalog work can continue
ahead of each firmware sync feature.

The web app currently includes:

- preset-sync SysEx frame helpers
- CRC32 and 8-to-7 packing utilities
- TLV encoders for user tunings, layouts, scale color maps, explicit button
  maps, and named/foldered synth presets
- a browser-stored tuning/layout bundle editor with an interactive HexBoard
  preview, EDO/equal-step/Scala `.scl` tuning inputs, across/up-right vector
  layouts, four-step device orientation preview matching firmware `Device Rot`,
  scale-degree colors, and per-button role/color overrides
- firmware-backed synth preset upload, download, list, erase, current-patch
  loading, and live preview, with ACK-confirmed flash saves for real devices
- a compact header device menu that uses preset-sync `HELLO_RESP` to discover a
  compatible HexBoard and only shows a device selector when multiple HexBoards
  respond
- React views for profile sync, tuning/layout editing, and synth preset
  organization

Install and run it from `web/`:

```sh
cd web
npm install
npm run dev
```

Run the web tests from the same directory:

```sh
npm test
```

Build the static app locally with the same base path used by the main GitHub
Pages page:

```sh
npm run build -- --mode github-pages-main
```

Build the development page variant locally with:

```sh
npm run build -- --mode github-pages-development
```

Web MIDI SysEx requires a browser with Web MIDI support, usually Chrome or Edge,
and a secure context such as `localhost` or HTTPS. Use `Connect HexBoard` in the
top bar; the app probes available MIDI input/output pairs and connects
automatically when exactly one compatible HexBoard responds.

### GitHub Pages Deployment

This repository includes a GitHub Actions workflow at
`.github/workflows/pages.yml`. On pushes to `main` or `development`, or when run
manually, it builds both branches into one Pages artifact so branch deploys do
not overwrite each other. The `main` branch is published at the project-page
root, and the `development` branch is published under `/development/`.

To enable hosting in GitHub:

1. Push this workflow to GitHub.
2. Open the repository on GitHub.
3. Go to `Settings` -> `Pages`.
4. Set `Build and deployment` -> `Source` to `GitHub Actions`.
5. Push to `main` or `development`, or run `Deploy Web App to GitHub Pages`
   from the repository's `Actions` tab. The workflow fetches both branches and
   rebuilds both pages on every deploy.

The default main page URL should be:

```text
https://<your-github-username>.github.io/HexBoard/
```

The development page URL should be:

```text
https://<your-github-username>.github.io/HexBoard/development/
```

If the GitHub repository is renamed, update the `base` value for
the GitHub Pages modes in `web/vite.config.ts` and the workflow `--base` values
to match the new project-page path.

### Build Notes

- Edit `src/HexBoard.ino`, not a root sketch copy or `build/build.ino`
- If you change board parameters, keep the `Makefile` and source header comments in sync
- The firmware currently depends on the Pico SDK USB stack and the RP2040 dual-core runtime behavior

## Flashing The Firmware

You can flash the board in either of these ways.

### From The Device Menu

How to update:

1. Plug your HexBoard into your computer.
2. Navigate to `Advanced` -> `Update Firmware` in the menu.
3. The HexBoard will show up as a USB drive.
4. Drag the `.uf2` file onto the drive.
5. The HexBoard will automatically reboot with the new firmware.

Need a backup method?

Hold the bootloader button while plugging it in:

- Hardware `1.1`: The button is next to the USB port.
- Hardware `1.2`: The button is hidden on the bottom. Press it with a paperclip near the ports while plugging the board in.

The board should appear as a removable USB drive. Drag the `.uf2` firmware file onto that drive, and the drive should eject when the board reboots into the new firmware.

## Development Notes

If you are jumping into the codebase, start with:

- [Developer Guide](docs/developer-guide.md) for architecture, refresh paths, settings wiring, and risk areas
- [Code Analysis](docs/code-analysis.md) for a deeper subsystem walkthrough
- [Delegated Control Protocol](docs/delegated-control.md) for external host integration
- [Preset Sync SysEx Draft](docs/preset-sync-sysex.md) for the planned versioned preset, tuning/layout, and synth-preset transfer protocol

The most important source file is:

- [`src/HexBoard.ino`](src/HexBoard.ino)

That file includes section tags such as `@MIDI`, `@synth`, `@menu`, and `@mainLoop`, which make it much easier to navigate than raw line count suggests.
