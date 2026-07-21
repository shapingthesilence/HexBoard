#include "Layout.h"

// Immutable rescue layout. Factory layouts live in /geometry/*.hgb.
const layoutDef layoutOptions[] = {
  { "Wicki-Hayden", true, 64, 2, -7, TUNING_12EDO }
};

extern const byte layoutCount = sizeof(layoutOptions) / sizeof(layoutDef);
