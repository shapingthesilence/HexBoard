# HexBoard RP2040 build target.
FQBN = rp2040:rp2040:generic:flash=16777216_8388608,freq=250,opt=Small,os=none,profile=Disabled,rtti=Disabled,stackprotect=Disabled,exceptions=Disabled,dbgport=Disabled,dbglvl=None,boot2=boot2_generic_03h_4_padded_checksum,usbstack=picosdk,ipbtstack=ipv4only,uploadmethod=default
PWM_BITS ?= 10
HEXBOARD_ENABLE_SEQUENCER ?= 0
USB_MANUFACTURER ?= \"HexBoard\"
USB_PRODUCT ?= \"HexBoard\"
BUILD_DIR ?= build
ARDUINO_BIN = $(BUILD_DIR)/HexBoard.ino.bin
ARDUINO_UF2 = $(BUILD_DIR)/HexBoard.ino.uf2
FACTORY_LIBRARY_DIR = factory-library
FACTORY_FILESYSTEM_DIR = $(BUILD_DIR)/factory-filesystem
FACTORY_FILESYSTEM_IMAGE = $(BUILD_DIR)/factory.littlefs.bin
FACTORY_LIBRARY_BUILDER = scripts/build_factory_library.py
FACTORY_UF2_BUILDER = scripts/build_factory_uf2.py
PYTHON ?= python3
ifeq ($(HEXBOARD_ENABLE_SEQUENCER),1)
FACTORY_UF2 = $(BUILD_DIR)/HexBoard_Sequencer_Factory.uf2
UPDATE_UF2 = $(BUILD_DIR)/HexBoard_Sequencer_Update.uf2
else
FACTORY_UF2 = $(BUILD_DIR)/HexBoard_Factory.uf2
UPDATE_UF2 = $(BUILD_DIR)/HexBoard_Update.uf2
endif
BUILD_PROPERTIES = --build-property compiler.cpp.extra_flags="-DPWM_BITS=$(PWM_BITS) -DHEXBOARD_ENABLE_SEQUENCER=$(HEXBOARD_ENABLE_SEQUENCER)" \
	--build-property build.usb_manufacturer="$(USB_MANUFACTURER)" \
	--build-property build.usb_product="$(USB_PRODUCT)"

FACTORY_LIBRARY_SOURCES_RAW := $(shell find $(FACTORY_LIBRARY_DIR) -type f | sed 's/ /__HEXBOARD_SPACE__/g')
FACTORY_LIBRARY_SOURCES := $(subst __HEXBOARD_SPACE__,\ ,$(FACTORY_LIBRARY_SOURCES_RAW))
FIRMWARE_SOURCES := HexBoard.ino $(shell find src/firmware -type f) $(FACTORY_LIBRARY_BUILDER) $(FACTORY_UF2_BUILDER) $(FACTORY_LIBRARY_SOURCES)

.PHONY: all firmware sequencer-disabled sequencer-enabled sequencer-builds install

all: firmware

firmware: $(FIRMWARE_SOURCES) Makefile | $(BUILD_DIR)
	$(PYTHON) $(FACTORY_LIBRARY_BUILDER) --library "$(FACTORY_LIBRARY_DIR)" --output "$(FACTORY_FILESYSTEM_DIR)"
	arduino-cli compile -b $(FQBN) $(BUILD_PROPERTIES) --output-dir $(BUILD_DIR) .
	$(PYTHON) $(FACTORY_UF2_BUILDER) \
		--firmware-binary "$(ARDUINO_BIN)" \
		--firmware "$(ARDUINO_UF2)" \
		--filesystem-dir "$(FACTORY_FILESYSTEM_DIR)" \
		--filesystem-image "$(FACTORY_FILESYSTEM_IMAGE)" \
		--factory-output "$(FACTORY_UF2)" \
		--update-output "$(UPDATE_UF2)"

$(BUILD_DIR):
	mkdir -p $(BUILD_DIR)

sequencer-disabled:
	"$(MAKE)" HEXBOARD_ENABLE_SEQUENCER=0 BUILD_DIR=build firmware

sequencer-enabled:
	"$(MAKE)" HEXBOARD_ENABLE_SEQUENCER=1 BUILD_DIR=build firmware

sequencer-builds:
	"$(MAKE)" sequencer-enabled
	"$(MAKE)" sequencer-disabled

/run/media/*/RPI-RP2/INFO_UF2.TXT:
	echo "Mounting device"
	udisksctl mount -b /dev/disk/by-label/RPI-RP2

install: firmware /run/media/*/RPI-RP2/INFO_UF2.TXT
	echo "Trying to copy into mounted device"
	cp $(FACTORY_UF2) /run/media/*/RPI-RP2/
	echo "Installed."
	sleep 7
	echo "Rebooted."
