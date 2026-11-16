#!/usr/bin/env python3
"""Run production USB MIDI transport against host endpoint/mutex boundaries."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent


def main():
    with tempfile.TemporaryDirectory(prefix="hexboard-usb-midi-") as directory:
        mirror = Path(directory)
        (mirror / "midi").mkdir()
        (mirror / "app").mkdir()
        for name in ("MidiTransport.cpp", "MidiTransport.h"):
            shutil.copyfile(ROOT / "src/firmware/midi" / name, mirror / "midi" / name)
        boundary = ROOT / "tests/support/usb_midi_runtime.h"
        for name in ("FirmwareModule.h", "app/PlatformCommon.h", "app/DiagnosticsTiming.h",
                     "USB.h", "MIDIUSB.h", "tusb.h"):
            (mirror / name).write_text(f'#pragma once\n#include "{boundary}"\n')
        flags = ["-std=c++17", "-O2", "-Wall", "-Wextra", "-Werror", "-g",
                 "-fno-omit-frame-pointer", "-fsanitize=address,undefined",
                 "-fno-sanitize-recover=all"]
        if sys.platform == "darwin":
            sdk = subprocess.check_output(["xcrun", "--show-sdk-path"], text=True).strip()
            flags += ["-isystem", str(Path(sdk) / "usr/include/c++/v1")]
        executable = str(mirror / "usb_midi_test")
        subprocess.run([os.environ.get("CXX", "c++"), *flags, "-I", str(mirror),
                        str(ROOT / "tests/support/usb_midi_runtime.cpp"),
                        str(mirror / "midi/MidiTransport.cpp"), "-o", executable], check=True)
        subprocess.run([executable], check=True)


if __name__ == "__main__":
    main()
