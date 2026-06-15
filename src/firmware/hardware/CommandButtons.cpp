#if HEXBOARD_FIRMWARE_UNITY

#include "../FirmwareModule.h"
#include "GridScanRotary.h"

void RAM_FUNC(cmdOn)(byte x) {  // volume and mod wheel read all current buttons
  switch (h[x].note) {
    case CMDB + 3:
      toggleWheel = !toggleWheel;
      break;
    case HARDWARE_V1_2:
      Hardware_Version = h[x].note;
      setupHardware();
      break;
    default:
      // the rest should all be taken care of within the wheelDef structure
      break;
  }
}
void RAM_FUNC(cmdOff)(byte x) {  // pitch bend wheel only if buttons held.
  switch (h[x].note) {
    default:
      break;  // nothing; should all be taken care of within the wheelDef structure
  }
}
#endif  // HEXBOARD_FIRMWARE_UNITY
