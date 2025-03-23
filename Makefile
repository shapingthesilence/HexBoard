# Copied fqbn from build.options.json
build/build.ino.uf2: build/build.ino
	arduino-cli compile -b rp2040:rp2040:generic:flash=16777216_0,freq=133,opt=Small,rtti=Disabled,stackprotect=Disabled,exceptions=Disabled,dbgport=Disabled,dbglvl=None,usbstack=tinyusb,boot2=boot2_generic_03h_2_padded_checksum --output-dir build build
build/build.ino: HexBoard.ino
	cp src/HexBoard.ino build/build.ino

/run/media/*/RPI-RP2/INFO_UF2.TXT:
	echo "Mounting device"
	udisksctl mount -b /dev/disk/by-label/RPI-RP2

install: build/build.ino.uf2 /run/media/*/RPI-RP2/INFO_UF2.TXT
	echo "Trying to copy into mounted device"
	cp build/build.ino.uf2 /run/media/*/RPI-RP2/
	echo "Installed."
	sleep 7
	echo "Rebooted."
