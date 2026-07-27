#pragma once

#include "../FirmwareModule.h"
#include "../app/PlatformCommon.h"
#include "../tuning/Tuning.h"
#include "Layout.h"

struct scaleDef {
  const char* name;
  byte tuning;
  byte pattern[MAX_SCALE_DIVISIONS];
};

constexpr byte VALUE_BLACK = 0;
constexpr byte VALUE_LOW = 80;
constexpr byte VALUE_SHADE = 164;
constexpr byte VALUE_NORMAL = 180;
constexpr byte VALUE_FULL = 255;

constexpr byte SAT_BW = 0;
constexpr byte SAT_TINT = 32;
constexpr byte SAT_DULL = 85;
constexpr byte SAT_MODERATE = 120;
constexpr byte SAT_VIVID = 255;

constexpr float HUE_NONE = 0.0;
constexpr float HUE_RED = 0.0;
constexpr float HUE_ORANGE = 36.0;
constexpr float HUE_YELLOW = 72.0;
constexpr float HUE_LIME = 108.0;
constexpr float HUE_GREEN = 144.0;
constexpr float HUE_CYAN = 180.0;
constexpr float HUE_BLUE = 216.0;
constexpr float HUE_INDIGO = 252.0;
constexpr float HUE_PURPLE = 288.0;
constexpr float HUE_MAGENTA = 324.0;

class colorDef {
public:
  float hue;
  byte sat;
  byte val;
  colorDef tint() {
    colorDef temp;
    temp.hue = this->hue;
    temp.sat = ((this->sat > SAT_MODERATE) ? SAT_MODERATE : this->sat);
    temp.val = VALUE_FULL;
    return temp;
  }
  colorDef shade() {
    colorDef temp;
    temp.hue = this->hue;
    temp.sat = ((this->sat > SAT_MODERATE) ? SAT_MODERATE : this->sat);
    temp.val = VALUE_LOW;
    return temp;
  }
};

class paletteDef {
public:
  colorDef swatch[MAX_SCALE_DIVISIONS];  // the different colors used in this palette
  byte colorNum[MAX_SCALE_DIVISIONS];    // map key (c,d...) to swatches
  colorDef getColor(byte givenStepFromC) {
    return swatch[colorNum[givenStepFromC] - 1];
  }
  float getHue(byte givenStepFromC) {
    return getColor(givenStepFromC).hue;
  }
  byte getSat(byte givenStepFromC) {
    return getColor(givenStepFromC).sat;
  }
  byte getVal(byte givenStepFromC) {
    return getColor(givenStepFromC).val;
  }
};

extern const scaleDef scaleOptions[];
extern const byte scaleCount;
extern paletteDef palette[];

extern bool userGeometryRuntimeActive;
extern bool userGeometryRuntimeScaleActive;
extern tuningDef userGeometryRuntimeTuning;
extern layoutDef userGeometryRuntimeLayout;
extern scaleDef userGeometryRuntimeScale;

class presetDef {
public:
  const char* presetName;
  int tuningIndex;  // instead of using pointers, i chose to store index value of each option, to be saved to a .pref or .ini or something
  int layoutIndex;
  int scaleIndex;
  int keyStepsFromA;  // what key the scale is in, where zero equals A.
  int transpose;
  const tuningDef& tuning() const {
    if (userGeometryRuntimeActive) {
      return userGeometryRuntimeTuning;
    }
    return tuningOptions[tuningIndex];
  }
  const layoutDef& layout() const {
    if (userGeometryRuntimeActive) {
      return userGeometryRuntimeLayout;
    }
    return layoutOptions[layoutIndex];
  }
  const scaleDef& scale() const {
    if (userGeometryRuntimeActive && userGeometryRuntimeScaleActive) {
      return userGeometryRuntimeScale;
    }
    return scaleOptions[scaleIndex];
  }
  int layoutsBegin() {
    if (tuningIndex == TUNING_12EDO) {
      return 0;
    } else {
      int temp = 0;
      while (layoutOptions[temp].tuning < tuningIndex) {
        temp++;
      }
      return temp;
    }
  }
  int keyStepsFromC() {
    return tuning().spanCtoA() - keyStepsFromA;
  }
  int pitchRelToA4(int givenStepsFromC) {
    return givenStepsFromC + tuning().spanCtoA() + transpose;
  }
  int keyDegree(int givenStepsFromC) {
    return positiveMod(givenStepsFromC + keyStepsFromC(), tuning().cycleLength);
  }
};

extern presetDef current;

constexpr byte DEVICE_DISPLAY_UPRIGHT_OFFSET = 2;

byte displayRotationFromDeviceRotation(byte rotation);
