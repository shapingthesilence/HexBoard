# HexBoard RP2040 build target.
FQBN = rp2040:rp2040:generic:flash=16777216_8388608,freq=250,opt=Small,os=none,profile=Disabled,rtti=Disabled,stackprotect=Disabled,exceptions=Disabled,dbgport=Disabled,dbglvl=None,boot2=boot2_generic_03h_4_padded_checksum,usbstack=picosdk,ipbtstack=ipv4only,uploadmethod=default
PWM_BITS ?= 10
HEXBOARD_ENABLE_SEQUENCER ?= 0
USB_MANUFACTURER ?= \"HexBoard\"
USB_PRODUCT ?= \"HexBoard\"
ifeq ($(HEXBOARD_ENABLE_SEQUENCER),1)
DEFAULT_BUILD_DIR = build/sequencer-enabled
else
DEFAULT_BUILD_DIR = build/sequencer-disabled
endif
BUILD_DIR ?= $(DEFAULT_BUILD_DIR)
FIRMWARE_UF2 = $(BUILD_DIR)/HexBoard.ino.uf2
BUILD_PROPERTIES = --build-property compiler.cpp.extra_flags="-DPWM_BITS=$(PWM_BITS) -DHEXBOARD_ENABLE_SEQUENCER=$(HEXBOARD_ENABLE_SEQUENCER)" \
	--build-property build.usb_manufacturer="$(USB_MANUFACTURER)" \
	--build-property build.usb_product="$(USB_PRODUCT)"

FIRMWARE_SOURCES := HexBoard.ino $(shell find src/firmware -type f)

.PHONY: all sequencer-disabled sequencer-enabled sequencer-builds install

all: $(FIRMWARE_UF2)

$(FIRMWARE_UF2): $(FIRMWARE_SOURCES) Makefile | $(BUILD_DIR)
	arduino-cli compile -b $(FQBN) $(BUILD_PROPERTIES) --output-dir $(BUILD_DIR) .

$(BUILD_DIR):
	mkdir -p $(BUILD_DIR)

sequencer-disabled:
	"$(MAKE)" HEXBOARD_ENABLE_SEQUENCER=0 BUILD_DIR=build/sequencer-disabled build/sequencer-disabled/HexBoard.ino.uf2

sequencer-enabled:
	"$(MAKE)" HEXBOARD_ENABLE_SEQUENCER=1 BUILD_DIR=build/sequencer-enabled build/sequencer-enabled/HexBoard.ino.uf2

sequencer-builds: sequencer-disabled sequencer-enabled

/run/media/*/RPI-RP2/INFO_UF2.TXT:
	echo "Mounting device"
	udisksctl mount -b /dev/disk/by-label/RPI-RP2

install: $(FIRMWARE_UF2) /run/media/*/RPI-RP2/INFO_UF2.TXT
	echo "Trying to copy into mounted device"
	cp $(FIRMWARE_UF2) /run/media/*/RPI-RP2/
	echo "Installed."
	sleep 7
	echo "Rebooted."
