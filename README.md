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
- [Developer Guide](docs/developer-guide.md)
- [Code Analysis](docs/code-analysis.md)
- [Delegated Control Protocol](docs/delegated-control.md)

The user manual is for players and owners of the device. The developer guide is for people editing the firmware in this repository.

## Repository Layout

- `src/HexBoard.ino`: primary firmware source
- `HexBoard.ino`: root sketch copy used by some Arduino tooling
- `docs/`: documentation for users and contributors
- `Makefile`: local build shortcut for `arduino-cli`

The current firmware is intentionally maintained as a single large sketch file, but it is organized internally into subsystem sections such as tuning, layout, LEDs, MIDI, synth, persistence, menu, and main loop.

## Current Firmware Highlights

The current code supports:

- multiple tunings, including non-12-EDO systems
- multiple isomorphic layouts with rotation and mirroring
- scale filtering with optional scale lock
- multiple LED color modes and animations
- standard MIDI, extended multi-channel MIDI mapping, and MPE behavior
- dynamic just intonation and BPM-linked retuning options
- onboard synth waveform, envelope, and arpeggiator settings
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
- [Nightly build status](https://builds.sr.ht/~earboxer/HexBoard/commits/.svg)
- [Tagged releases on SourceHut](https://git.sr.ht/~earboxer/HexBoard/refs)
- Posterity builds sometimes mirrored at [zachdecook.com/HexBoard/firmware](https://zachdecook.com/HexBoard/firmware/)
- Historical `hexperiment` branch and related work may appear at [GitHub](https://github.com/theHDM/hexperiment) or [SourceHut](https://git.sr.ht/~earboxer/HexBoard/tree/hexperiment)

## Hardware And Build Target

The current source targets:

- Generic RP2040
- `200 MHz`
- `16 MB` flash
- TinyUSB USB stack

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
arduino-cli lib install "MIDI library"
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

The `Makefile` copies `src/HexBoard.ino` into `build/build.ino` and compiles it with the board options used by this project.

The expected output artifact is:

```text
build/build.ino.uf2
```

### Build Notes

- Edit `src/HexBoard.ino`, not `build/build.ino`
- If you change board parameters, keep the `Makefile` and source header comments in sync
- The firmware currently depends on TinyUSB and the RP2040 dual-core runtime behavior

## Flashing The Firmware

You can flash the board in either of these ways.

### From The Device Menu

On current firmware, open:

1. `Advanced`
2. `Update Firmware`

That reboots the RP2040 into bootloader mode so you can copy a `.uf2` file onto the mounted device.

### Manual Bootloader Method

1. Unplug the HexBoard from your computer.
2. Plug it back in while holding the button by the USB port.
3. The board should appear as a removable RP2040 drive.
4. Copy the `.uf2` firmware file onto that drive.
5. The drive should eject and the board should reboot into the new firmware.

## Development Notes

If you are jumping into the codebase, start with:

- [Developer Guide](docs/developer-guide.md) for architecture, refresh paths, settings wiring, and risk areas
- [Code Analysis](docs/code-analysis.md) for a deeper subsystem walkthrough
- [Delegated Control Protocol](docs/delegated-control.md) for external host integration

The most important source file is:

- [`src/HexBoard.ino`](src/HexBoard.ino)

That file includes section tags such as `@MIDI`, `@synth`, `@menu`, and `@mainLoop`, which make it much easier to navigate than raw line count suggests.
