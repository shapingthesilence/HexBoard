#pragma once

#include "../FirmwareModule.h"
#include "../tuning/Tuning.h"

class layoutDef {
public:
  std::string name;    // limit is 17 characters for GEM menu
  bool isPortrait;     // legacy metadata used to seed DeviceRotation when the layout is selected.
  byte hexMiddleC;     // instead of "what note is button 1", "what button is the middle"
  int8_t acrossSteps;  // defined this way to be compatible with original v1.1 firmare
  int8_t dnLeftSteps;  // defined this way to be compatible with original v1.1 firmare
  byte tuning;         // index of the tuning that this layout is designed for
};

extern layoutDef layoutOptions[];
extern const byte layoutCount;
