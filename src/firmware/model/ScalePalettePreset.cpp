#include "ScalePalettePreset.h"

// Immutable rescue scale and color palette. Editable factory scales and
// per-degree colors are generated into /geometry/*.hgb.
const scaleDef scaleOptions[] = {
  { "All Notes", ALL_TUNINGS, { 0 } }
};

extern const byte scaleCount = sizeof(scaleOptions) / sizeof(scaleDef);

paletteDef palette[] = {
  {
    {
      { HUE_NONE, SAT_BW, VALUE_NORMAL },
      { HUE_RED, SAT_VIVID, VALUE_NORMAL },
      { HUE_ORANGE, SAT_VIVID, VALUE_NORMAL },
      { HUE_YELLOW, SAT_VIVID, VALUE_NORMAL },
      { HUE_GREEN, SAT_VIVID, VALUE_NORMAL },
      { HUE_CYAN, SAT_VIVID, VALUE_NORMAL },
      { HUE_BLUE, SAT_VIVID, VALUE_NORMAL },
      { HUE_INDIGO, SAT_VIVID, VALUE_NORMAL },
      { HUE_PURPLE, SAT_VIVID, VALUE_NORMAL },
      { HUE_MAGENTA, SAT_VIVID, VALUE_NORMAL },
      { HUE_RED, SAT_DULL, VALUE_SHADE },
      { HUE_BLUE, SAT_DULL, VALUE_SHADE }
    },
    { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12 }
  }
};

presetDef current = {
  "Default",
  TUNING_12EDO,
  0,
  0,
  -9,
  0
};

byte displayRotationFromDeviceRotation(byte rotation) {
  return (DEVICE_DISPLAY_UPRIGHT_OFFSET + 4 - (rotation % 4)) % 4;
}
