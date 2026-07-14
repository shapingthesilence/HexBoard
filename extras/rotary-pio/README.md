# Experimental Rotary PIO

This directory contains experimental RP2040 PIO programs for rotary encoder
input. It is not part of the firmware build.

`RotaryQuadrature.pio` provides a 24-instruction quadrature decoder and an
8-instruction raw phase-change tracer. Any future integration must account for
PIO instruction memory shared with the LED output program. Generate the C/C++
header with `pioasm` when integrating the source into a build.
