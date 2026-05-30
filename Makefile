# HexBoard RP2040 build target.
FQBN = rp2040:rp2040:generic:flash=16777216_8388608,freq=250,opt=Small,os=none,profile=Disabled,rtti=Disabled,stackprotect=Disabled,exceptions=Disabled,dbgport=Disabled,dbglvl=None,boot2=boot2_generic_03h_4_padded_checksum,usbstack=picosdk,ipbtstack=ipv4only,uploadmethod=default
PWM_BITS ?= 10
USB_MANUFACTURER ?= \"HexBoard\"
USB_PRODUCT ?= \"HexBoard\"
BUILD_PROPERTIES = --build-property compiler.cpp.extra_flags="-DPWM_BITS=$(PWM_BITS)" \
	--build-property build.usb_manufacturer="$(USB_MANUFACTURER)" \
	--build-property build.usb_product="$(USB_PRODUCT)"

build/build.ino.uf2: build/build.ino Makefile
	arduino-cli compile -b $(FQBN) $(BUILD_PROPERTIES) --output-dir build build

build/build.ino: src/HexBoard.ino | build
	cp src/HexBoard.ino build/build.ino

build:
	mkdir -p build

/run/media/*/RPI-RP2/INFO_UF2.TXT:
	echo "Mounting device"
	udisksctl mount -b /dev/disk/by-label/RPI-RP2

install: build/build.ino.uf2 /run/media/*/RPI-RP2/INFO_UF2.TXT
	echo "Trying to copy into mounted device"
	cp build/build.ino.uf2 /run/media/*/RPI-RP2/
	echo "Installed."
	sleep 7
	echo "Rebooted."
