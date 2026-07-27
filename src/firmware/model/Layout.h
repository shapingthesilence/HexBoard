#pragma once

#include "../FirmwareModule.h"
#include "../tuning/Tuning.h"

constexpr byte DEVICE_ROTATION_0 = 0;

struct layoutDef {
  const char* name;       // limit is 17 characters for GEM menu
  byte deviceRotation;    // Physical board rotation in 90-degree steps.
  byte hexMiddleC;        // instead of "what note is button 1", "what button is the middle"
  int8_t acrossSteps;     // defined this way to be compatible with original v1.1 firmare
  int8_t dnLeftSteps;     // defined this way to be compatible with original v1.1 firmare
  byte tuning;            // index of the tuning that this layout is designed for
};

extern const layoutDef layoutOptions[];
extern const byte layoutCount;
