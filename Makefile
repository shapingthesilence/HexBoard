# HexBoard RP2040 build target.
CPU_FREQ_MHZ ?= 250
FIRMWARE_CLOCK_SUFFIX ?=
FQBN = rp2040:rp2040:generic:flash=16777216_8388608,freq=$(CPU_FREQ_MHZ),opt=Small,os=none,profile=Disabled,rtti=Disabled,stackprotect=Disabled,exceptions=Disabled,dbgport=Disabled,dbglvl=None,boot2=boot2_generic_03h_4_padded_checksum,usbstack=picosdk,ipbtstack=ipv4only,uploadmethod=default
PWM_BITS ?= 10
HEXBOARD_ENABLE_SEQUENCER ?= 0
HEXBOARD_BOOT_DIAGNOSTICS ?= 0
HEXBOARD_BOOT_DIAGNOSTIC_SKIP_STORAGE ?= 0
USB_MANUFACTURER ?= \"HexBoard\"
USB_PRODUCT ?= \"HexBoard\"
BUILD_DIR ?= build
ARDUINO_UF2 = $(BUILD_DIR)/HexBoard.ino.uf2
ifeq ($(HEXBOARD_ENABLE_SEQUENCER),1)
FIRMWARE_UF2 = $(BUILD_DIR)/HexBoard_Sequencer$(FIRMWARE_CLOCK_SUFFIX).uf2
else
FIRMWARE_UF2 = $(BUILD_DIR)/HexBoard$(FIRMWARE_CLOCK_SUFFIX).uf2
endif
BUILD_PROPERTIES = --build-property compiler.cpp.extra_flags="-DPWM_BITS=$(PWM_BITS) -DHEXBOARD_ENABLE_SEQUENCER=$(HEXBOARD_ENABLE_SEQUENCER) -DHEXBOARD_BOOT_DIAGNOSTICS=$(HEXBOARD_BOOT_DIAGNOSTICS) -DHEXBOARD_BOOT_DIAGNOSTIC_SKIP_STORAGE=$(HEXBOARD_BOOT_DIAGNOSTIC_SKIP_STORAGE)" \
	--build-property build.usb_manufacturer="$(USB_MANUFACTURER)" \
	--build-property build.usb_product="$(USB_PRODUCT)"

FIRMWARE_SOURCES := HexBoard.ino $(shell find src/firmware -type f)

.PHONY: all firmware overclocked compatibility-133mhz boot-diagnostic boot-diagnostic-no-storage boot-diagnostic-133mhz diagnostic-builds sequencer-disabled sequencer-enabled sequencer-builds install

all: firmware

firmware: $(FIRMWARE_SOURCES) Makefile | $(BUILD_DIR)
	arduino-cli compile -b $(FQBN) $(BUILD_PROPERTIES) --output-dir $(BUILD_DIR) .
ifneq ($(FIRMWARE_UF2),$(ARDUINO_UF2))
	mv "$(ARDUINO_UF2)" "$(FIRMWARE_UF2)"
endif

overclocked:
	"$(MAKE)" CPU_FREQ_MHZ=250 FIRMWARE_CLOCK_SUFFIX=_250MHz firmware

compatibility-133mhz:
	"$(MAKE)" CPU_FREQ_MHZ=133 \
		BUILD_DIR=build/compatibility-133mhz \
		FIRMWARE_UF2=build/compatibility-133mhz/HexBoard_Compatibility_133MHz.uf2 firmware

boot-diagnostic:
	"$(MAKE)" CPU_FREQ_MHZ=200 HEXBOARD_BOOT_DIAGNOSTICS=1 \
		BUILD_DIR=build/boot-diagnostic \
		FIRMWARE_UF2=build/boot-diagnostic/HexBoard_BootDiagnostic.uf2 firmware

boot-diagnostic-no-storage:
	"$(MAKE)" CPU_FREQ_MHZ=200 HEXBOARD_BOOT_DIAGNOSTICS=1 HEXBOARD_BOOT_DIAGNOSTIC_SKIP_STORAGE=1 \
		BUILD_DIR=build/boot-diagnostic-no-storage \
		FIRMWARE_UF2=build/boot-diagnostic-no-storage/HexBoard_BootDiagnostic_NoStorage.uf2 firmware

boot-diagnostic-133mhz:
	"$(MAKE)" CPU_FREQ_MHZ=133 HEXBOARD_BOOT_DIAGNOSTICS=1 \
		BUILD_DIR=build/boot-diagnostic-133mhz \
		FIRMWARE_UF2=build/boot-diagnostic-133mhz/HexBoard_BootDiagnostic_133MHz.uf2 firmware

diagnostic-builds:
	"$(MAKE)" boot-diagnostic
	"$(MAKE)" boot-diagnostic-no-storage
	"$(MAKE)" boot-diagnostic-133mhz

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
	cp $(FIRMWARE_UF2) /run/media/*/RPI-RP2/
	echo "Installed."
	sleep 7
	echo "Rebooted."
