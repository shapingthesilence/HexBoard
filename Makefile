# Copied from the Arduino IDE 200 MHz Generic RP2040 build options.
FQBN = rp2040:rp2040:generic:flash=16777216_8388608,freq=200,opt=Small,os=none,profile=Disabled,rtti=Disabled,stackprotect=Disabled,exceptions=Disabled,dbgport=Disabled,dbglvl=None,boot2=boot2_generic_03h_4_padded_checksum,usbstack=tinyusb,ipbtstack=ipv4only,uploadmethod=default

build/build.ino.uf2: build/build.ino Makefile
	arduino-cli compile -b $(FQBN) --output-dir build build

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
