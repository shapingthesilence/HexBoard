#!/usr/bin/env python3
"""Link the runtime helpers the audio renderer calls into RAM.

The renderer on Core 1 calls compiler runtime helpers for integer division,
64-bit multiplication, memory fills and single-precision float math. The Arduino core links them into
flash, where a call can stall on a flash read while Core 0 is using the
execute-in-place cache, and the audio block misses its deadline. The core's
linker script already excludes the divider from flash, but names the object
"divider.S.obj" while the library ships "divider_hardware.S.o".

Run as a pre-link hook on the generated linker script; see the Makefile.
"""
import sys
from pathlib import Path

ANCHOR = "*divider.S.obj"
OBJECTS = ("*divider_hardware.S.o *pico_int64_ops_aeabi.S.o *mem_ops_aeabi.S.o "
           "*float_aeabi_rp2040.S.o")


def main() -> int:
    path = Path(sys.argv[1])
    text = path.read_text()
    if OBJECTS in text:
        return 0
    if text.count(ANCHOR) != 1:
        print(f"{path}: expected one '{ANCHOR}' flash exclusion; the core's linker script changed",
              file=sys.stderr)
        return 1
    path.write_text(text.replace(ANCHOR, f"{ANCHOR} {OBJECTS}"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
