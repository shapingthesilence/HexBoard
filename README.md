# HexBoard MIDI Controller

The HexBoard is a 140-key board designed for techno-musicians, babies, and computer people.

![A HexBoard with the default layout active](https://shapingthesilence.com/wp-content/uploads/2023/05/IMG_7850-scaled-e1683770617108.jpeg)

You can [order your HexBoard today](https://shapingthesilence.com/tech/hexboard-midi-controller/),
or [contact Jared](mailto:jared@shapingthesilence.com) if you're interested in assembling it yourself.

## The Team
* Jared DeCook has been writing music, developing hardware, and performing as [Shaping The Silence](https://shapingthesilence.com/) for over a decade.
* Zach DeCook has been listening to music, breaking hardware, and occasionally writing software since the former discovered his exploitable talents.

## HexBoard Arduino firmware

The Arduino firmware is the default firmware for the HexBoard (and is what this repository contains).

### Building the firmware

If you want to build the firmware,
we'll assume you're already proficient at installing software on your computer at this point.

#### Using [Arduino-IDE](https://www.arduino.cc/en/software)

(Instructions to come)

#### Using [arduino-cli](https://arduino.github.io/arduino-cli/latest/)

(You also need to have `python3` installed on your system)

```sh
# Download the board index
arduino-cli --additional-urls=https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json core update-index
# Install the core for rp2040
arduino-cli --additional-urls=https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json core download rp2040:rp2040
arduino-cli --additional-urls=https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json core install rp2040:rp2040
# Install libraries
arduino-cli lib install "MIDI library"
arduino-cli lib install "Adafruit NeoPixel"
arduino-cli lib install "U8g2" # dependency for GEM
arduino-cli lib install "Adafruit GFX Library" # dependency for GEM
arduino-cli lib install "GEM"
sed -i 's@#include "config/enable-glcd.h"@//\0@g' ~/Arduino/libraries/GEM/src/config.h # remove dependency from GEM
# Correct Rotary Library
git clone https://github.com/buxtronix/arduino buxduino
cd buxduino
git apply ../Rotary.patch
cd ..
mv buxduino/libraries/Rotary ~/Arduino/libraries/
rm -rf buxduino
# Run Make to build the firmware
make
```
Your firmware file will be the uf2 file inside the build directory.

### Flashing the firmware

1. Unplug the HexBoard from your computer, then plug it in while holding the button by the USB port.
2. It should appear as a disk in your computer.
3. Copy the .uf2 firmware file onto that disk
4. The disk should eject, and the HexBoard should automatically reboot into that firmware.
