#include "Layout.h"

// Immutable rescue layout. Factory layouts live in /geometry/*.hgb.
const layoutDef layoutOptions[] = {
  { "Wicki-Hayden", DEVICE_ROTATION_0, 64, 2, -7, TUNING_12EDO }
};

extern const byte layoutCount = sizeof(layoutOptions) / sizeof(layoutDef);
