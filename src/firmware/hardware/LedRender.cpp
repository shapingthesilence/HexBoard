#include "../FirmwareModule.h"
#include "HardwareConfig.h"
#include "LedRender.h"
#include "../app/DiagnosticsTiming.h"
#include "../app/PlatformCommon.h"
#include "../app/RuntimeDefaults.h"
#include "GridState.h"
#include "../sequencer/SequencerLeds.h"
#include "../sequencer/SequencerMode.h"
#include "../synth/SynthAudio.h"

// @LED
/*
    This section of the code handles sending
    color data to the LED pixels underneath
    the hex buttons.
  */
#include <Adafruit_NeoPixel.h>  // library of code to interact with the LED array
Adafruit_NeoPixel strip(LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800);
int32_t rainbowDegreeTime = 65'536;  // microseconds to go through 1/360 of rainbow
constexpr uint16_t WS2812_IDLE_CURRENT_MA = 1;
constexpr uint16_t WS2812_CHANNEL_MAX_CURRENT_MA = 20;
constexpr byte BOOT_LED_CHECK_FIRST_BOOT_WHITE_VALUE = 120;
constexpr byte BOOT_LED_CHECK_WAVE_VALUE = VALUE_NORMAL;
constexpr byte BOOT_LED_CHECK_TRAIL_VALUE = VALUE_LOW;
constexpr byte BOOT_LED_CHECK_COMMAND_VALUE = VALUE_NORMAL;
constexpr byte BOOT_LED_CHECK_FIRST_BOOT_WHITE_FADE_FRAMES = 8;
constexpr byte BOOT_LED_CHECK_WAVE_FRAMES = 14;
constexpr byte BOOT_LED_CHECK_NORMAL_FADE_FRAMES = 8;
constexpr uint16_t BOOT_LED_CHECK_FIRST_BOOT_WHITE_FADE_MS = 35;
constexpr uint16_t BOOT_LED_CHECK_FIRST_BOOT_WHITE_HOLD_MS = 2000;
constexpr uint16_t BOOT_LED_CHECK_WAVE_MS = 30;
constexpr uint16_t BOOT_LED_CHECK_NORMAL_FADE_MS = 25;
constexpr byte USER_GEOMETRY_REST_COLOR_VALUE_MAX = VALUE_NORMAL;

namespace {

constexpr float HUE_CIRCLE_DEGREES = 360.0f;
constexpr float OCTAVE_CENTS = 1200.0f;
constexpr int PIANO_PITCH_CLASS_COUNT = 12;
constexpr bool PIANO_BLACK_PITCH_CLASSES[PIANO_PITCH_CLASS_COUNT] = {
  false, true, false, true, false, false,
  true, false, true, false, true, false
};
constexpr float ALT_PIANO_WHITE_HUE = 30.0f;
constexpr float ALT_PIANO_OPPOSITE_HUE_OFFSET = HUE_CIRCLE_DEGREES / 2.0f;
constexpr float ALT_PIANO_DEVIATION_HUE_RANGE = HUE_CIRCLE_DEGREES / 2.0f;

float positiveFloatMod(float value, float modulus) {
  float result = fmodf(value, modulus);
  return result < 0.0f ? result + modulus : result;
}

int colorOriginStepOffset() {
  return paletteBeginsAtKeyCenter ? current.keyStepsFromC() : 0;
}

float pianoPitchClassForColorSteps(int colorStepsFromOrigin, float tuningStepCents) {
  float stepsPerOctave = OCTAVE_CENTS / tuningStepCents;
  float stepsWithinOctave = positiveFloatMod(static_cast<float>(colorStepsFromOrigin), stepsPerOctave);
  return PIANO_PITCH_CLASS_COUNT * stepsWithinOctave / stepsPerOctave;
}

int nearestPianoPitchClass(float pianoPitchClass) {
  return positiveMod(static_cast<int>(roundf(pianoPitchClass)), PIANO_PITCH_CLASS_COUNT);
}

bool pianoPitchClassIsBlack(int pianoPitchClass) {
  return PIANO_BLACK_PITCH_CLASSES[positiveMod(pianoPitchClass, PIANO_PITCH_CLASS_COUNT)];
}

}  // namespace

bool settingsFileMissingOnBoot = false;
// Sequencer Note-colored steps reuse the keyboard palette before gamma/current
// limiting, so cache the base hue/saturation where the palette is calculated.
colorDef baseLedColorCache[LED_COUNT] = {};
bool baseLedColorCacheValid[LED_COUNT] = {};

byte scaleLedChannel(byte channel, uint16_t scale65535) {
  return static_cast<byte>((static_cast<uint32_t>(channel) * scale65535 + 32767u) / 65535u);
}

uint32_t estimateDynamicLedCurrentMilliamps(uint32_t packedColor) {
  uint8_t red = static_cast<uint8_t>(packedColor >> 16);
  uint8_t green = static_cast<uint8_t>(packedColor >> 8);
  uint8_t blue = static_cast<uint8_t>(packedColor);
  uint32_t channelSum = static_cast<uint32_t>(red) + green + blue;
  return (channelSum * WS2812_CHANNEL_MAX_CURRENT_MA + 127u) / 255u;
}

void RAM_FUNC(applyLedCurrentLimitToFrame)() {
  if (ledCurrentLimitMilliamps == 0) {
    return;
  }

  constexpr uint32_t stripIdleCurrentMilliamps = static_cast<uint32_t>(LED_COUNT) * WS2812_IDLE_CURRENT_MA;
  uint32_t dynamicCurrentMilliamps = 0;
  for (byte i = 0; i < LED_COUNT; ++i) {
    dynamicCurrentMilliamps += estimateDynamicLedCurrentMilliamps(strip.getPixelColor(i));
  }

  if (dynamicCurrentMilliamps == 0) {
    return;
  }

  if (ledCurrentLimitMilliamps <= stripIdleCurrentMilliamps) {
    strip.clear();
    return;
  }

  uint32_t allowedDynamicMilliamps = static_cast<uint32_t>(ledCurrentLimitMilliamps) - stripIdleCurrentMilliamps;
  if (dynamicCurrentMilliamps <= allowedDynamicMilliamps) {
    return;
  }

  uint16_t scale65535 = static_cast<uint16_t>((allowedDynamicMilliamps * 65535u) / dynamicCurrentMilliamps);
  for (byte i = 0; i < LED_COUNT; ++i) {
    uint32_t packedColor = strip.getPixelColor(i);
    uint8_t red = scaleLedChannel(static_cast<uint8_t>(packedColor >> 16), scale65535);
    uint8_t green = scaleLedChannel(static_cast<uint8_t>(packedColor >> 8), scale65535);
    uint8_t blue = scaleLedChannel(static_cast<uint8_t>(packedColor), scale65535);
    strip.setPixelColor(i, strip.Color(red, green, blue));
  }
}
/*
    This is actually a hacked together approximation
    of the color space OKLAB. A true conversion would
    take the hue, saturation, and value bits and
    turn them into linear RGB to feed directly into
    the LED class. This conversion is... not very OK...
    but does the job for now. A proper implementation
    of OKLAB is in the works.

    For transforming hues, the okLAB hue degree (0-360) is
    mapped to the RGB hue degree from 0 to 65535, using
    simple linear interpolation I created by hand comparing
    my HexBoard outputs to a Munsell color chip book.
  */
int16_t transformHue(float h) {
  float D = fmod(h, 360);
  if (!perceptual) {
    return 65536 * D / 360;
  } else {
    //                red            yellow             green        cyan         blue
    int hueIn[] = { 0, 9, 18, 102, 117, 135, 142, 155, 203, 240, 252, 261, 306, 333, 360 };
    //              #ff0000          #ffff00           #00ff00      #00ffff     #0000ff     #ff00ff
    int hueOut[] = { 0, 3640, 5861, 10922, 12743, 16384, 21845, 27306, 32768, 38229, 43690, 49152, 54613, 58254, 65535 };
    byte B = 0;
    while (D - hueIn[B] > 0) {
      B++;
    }
    float T = (D - hueIn[B - 1]) / (float)(hueIn[B] - hueIn[B - 1]);
    return (hueOut[B - 1] * (1 - T)) + (hueOut[B] * T);
  }
}

namespace incandescence {
/*
  const int fixed_shift = 16;
  const int fixed_scale = (1 << fixed_shift);

  constexpr int32_t lambda_r = 700*256;
  constexpr int32_t lambda_g = 550*256;
  constexpr int32_t lambda_b = 450*256;

  constexpr uint32_t C1 = 374183; // W*m^2
  constexpr uint32_t C2 = 14388;   // m*K

  int32_t fixed_exp(int32_t x)
  {
    return (fixed_scale + x + ((x*x) >> 1) + ((x*x*x)/6));
  }
  int32_t planckRadiation(int32_t lambda, int32_t temp)
  {
    int32_t denom = (C2 / (lambda*temp >> fixed_shift));
    return (C1 / (pow(lambda,5))) / (fixed_exp(denom));
  }
  */

constexpr float lambda_r = 625e-9;  // average wavelengths of LED diodes
constexpr float lambda_g = 525e-9;
constexpr float lambda_b = 460e-9;

constexpr float C1 = 3.74183e-16;  // W*m^2
constexpr float C2 = 1.4388e-2;    // m*K

constexpr float MIN_TEMPERATURE_KELVIN = 800.0f;
constexpr float MAX_TEMPERATURE_KELVIN = 2400.0f;

float planckRadiation(float lambda, float temp) {
  return (C1 / (pow(lambda, 5))) / (exp(C2 / (lambda * temp)) - 1);
}

float getCoefficient(float lambda, float referenceTemperature) {
  float radiation = planckRadiation(lambda, referenceTemperature);
  return radiation / 256.0f;
}

colorDef getColor(int32_t temp) {
  float r = planckRadiation(lambda_r, temp);
  float g = planckRadiation(lambda_g, temp);
  float b = planckRadiation(lambda_b, temp);

  float maxVal = max(max(r, g), b);

  float minVal = min(min(r, g), b);
  float delta = maxVal - minVal;
  float h = 0, s = 0, v = 0;

  if (delta > 0.00001) {
    s = delta / maxVal;
    if (maxVal == r) {
      h = 60.0 * fmodf(((g - b) / delta), 6.0);
      v = r / getCoefficient(lambda_r, MAX_TEMPERATURE_KELVIN);
    } else if (maxVal == g) {
      h = 60.0 * (((g - b) / delta) + 2.0);
      v = g / getCoefficient(lambda_g, MAX_TEMPERATURE_KELVIN);
    } else {
      h = 60.0 * (((g - b) / delta) + 4.0);
      v = b / getCoefficient(lambda_b, MAX_TEMPERATURE_KELVIN);
    }
    v = min(max(v, 0), 255);
  }

  if (h < 0.0) h += 360.0;
  return colorDef{ h, (byte)(s * 255), (byte)(v) };
}
}

/*
    Saturation and Brightness are taken as is (already in a 0-255 range).
    The global brightness / 255 attenuates the resulting color for the
    user's brightness selection. Then the resulting RGB (HSV) color is
    "un-gamma'd" to be converted to the LED strip color.
  */
uint32_t RAM_FUNC(getLEDcode)(colorDef c) {
  return strip.gamma32(strip.ColorHSV(transformHue(c.hue), c.sat, c.val * globalBrightness / 255));
}

uint32_t RAM_FUNC(getLEDcodeLinear)(colorDef c) {
  return strip.ColorHSV(transformHue(c.hue), c.sat, c.val * globalBrightness / 255);
}

uint32_t RAM_FUNC(gammaLEDcode)(uint32_t color) {
  return strip.gamma32(color);
}

bool RAM_FUNC(getBaseLedColorForPitchSteps)(int16_t pitchSteps, colorDef& colorOut) {
  for (byte i = 0; i < LED_COUNT; ++i) {
    if (h[i].isCmd || !baseLedColorCacheValid[i] || h[i].stepsFromC != pitchSteps) {
      continue;
    }
    colorOut = baseLedColorCache[i];
    return true;
  }
  return false;
}

byte applyBootLedCheckLevels(byte value) {
  value = applyLEDLevel(value, ledRestBrightness);
  return static_cast<byte>((static_cast<uint16_t>(value) * globalBrightness + 127) / 255);
}

byte interpolateByte(byte lowValue, byte highValue, uint16_t amount255) {
  return static_cast<byte>(lowValue + (((static_cast<uint16_t>(highValue - lowValue) * amount255) + 127) / 255));
}

byte blendByte(byte startValue, byte endValue, uint16_t amount255) {
  int32_t delta = static_cast<int32_t>(endValue) - startValue;
  return static_cast<byte>(startValue + ((delta * amount255 + (delta >= 0 ? 127 : -127)) / 255));
}

byte pulseBootLedValue(byte frame, byte frameCount, byte lowValue, byte highValue) {
  if (frameCount <= 1) {
    return highValue;
  }
  uint16_t phase = (static_cast<uint16_t>(frame) * 510u) / (frameCount - 1);
  uint16_t amount255 = (phase <= 255) ? phase : (510 - phase);
  return interpolateByte(lowValue, highValue, amount255);
}

float safeBootLedHue(float hue) {
  hue = fmodf(hue, 360.0f);
  if (hue < 0.0f) {
    hue += 360.0f;
  } else if (hue <= 0.0f) {
    hue = 0.1f;
  }
  return hue;
}

uint32_t getBootLedCheckColor(float hue, byte sat, byte val) {
  if (val == VALUE_BLACK) {
    return 0;
  }
  return strip.gamma32(strip.ColorHSV(transformHue(safeBootLedHue(hue)),
                                      sat,
                                      applyBootLedCheckLevels(val)));
}

uint32_t getBootLedCheckRgb(byte red, byte green, byte blue) {
  return strip.gamma32(strip.Color(applyBootLedCheckLevels(red),
                                   applyBootLedCheckLevels(green),
                                   applyBootLedCheckLevels(blue)));
}

uint32_t blendPackedColor(uint32_t startColor, uint32_t endColor, uint16_t amount255) {
  return strip.Color(blendByte(static_cast<byte>(startColor >> 16), static_cast<byte>(endColor >> 16), amount255),
                     blendByte(static_cast<byte>(startColor >> 8), static_cast<byte>(endColor >> 8), amount255),
                     blendByte(static_cast<byte>(startColor), static_cast<byte>(endColor), amount255));
}

void setBootCommandButtonFade(uint16_t frameIndex) {
  for (byte cmd = 0; cmd < CMDCOUNT; ++cmd) {
    uint16_t shiftedFrame = (frameIndex + (cmd * 2)) % BOOT_LED_CHECK_WAVE_FRAMES;
    byte value = pulseBootLedValue(static_cast<byte>(shiftedFrame),
                                   BOOT_LED_CHECK_WAVE_FRAMES,
                                   VALUE_BLACK,
                                   BOOT_LED_CHECK_COMMAND_VALUE);
    float hue = (frameIndex * 12.0f) + (cmd * 24.0f) + HUE_ORANGE;
    strip.setPixelColor(assignCmd[cmd], getBootLedCheckColor(hue, SAT_MODERATE, value));
  }
}

void showBootLedCheckFrame(uint16_t holdMilliseconds, uint16_t frameIndex) {
  setBootCommandButtonFade(frameIndex);
  applyLedCurrentLimitToFrame();
  strip.show();
  delay(holdMilliseconds);
}

void showBootLedCheckRawFrame(uint16_t holdMilliseconds) {
  applyLedCurrentLimitToFrame();
  strip.show();
  delay(holdMilliseconds);
}

void fillBootLedCheckFrame(uint32_t color) {
  for (byte i = 0; i < LED_COUNT; ++i) {
    strip.setPixelColor(i, color);
  }
}

void fillBootLedCheckNoteFrame(uint32_t color) {
  for (byte i = 0; i < LED_COUNT; ++i) {
    if (!h[i].isCmd) {
      strip.setPixelColor(i, color);
    }
  }
}

byte hexDistance(byte firstIndex, byte secondIndex) {
  uint8_t dx = abs(h[firstIndex].coordCol - h[secondIndex].coordCol);
  uint8_t dy = abs(h[firstIndex].coordRow - h[secondIndex].coordRow);
  uint8_t horizontalOverhang = (dx > dy) ? ((dx - dy) / 2) : 0;
  return dy + horizontalOverhang;
}

byte bootLedSplashCenterIndex() {
  return HEXBOARD_CENTER_BUTTON < LED_COUNT ? HEXBOARD_CENTER_BUTTON : LED_COUNT / 2;
}

void showFirstBootWhiteDiagnostic() {
  for (byte frame = 0; frame < BOOT_LED_CHECK_FIRST_BOOT_WHITE_FADE_FRAMES; ++frame) {
    uint16_t amount255 = (static_cast<uint16_t>(frame + 1) * 255u) / BOOT_LED_CHECK_FIRST_BOOT_WHITE_FADE_FRAMES;
    byte value = interpolateByte(VALUE_BLACK, BOOT_LED_CHECK_FIRST_BOOT_WHITE_VALUE, amount255);
    fillBootLedCheckFrame(getBootLedCheckColor(HUE_NONE, SAT_BW, value));
    showBootLedCheckRawFrame(BOOT_LED_CHECK_FIRST_BOOT_WHITE_FADE_MS);
  }
  delay(BOOT_LED_CHECK_FIRST_BOOT_WHITE_HOLD_MS);
}

void showBootLedCheckSplash(uint16_t& frameIndex) {
  byte centerIndex = bootLedSplashCenterIndex();

  byte maxDistance = 0;
  for (byte i = 0; i < LED_COUNT; ++i) {
    maxDistance = max(maxDistance, hexDistance(centerIndex, i));
  }

  for (byte frame = 0; frame < BOOT_LED_CHECK_WAVE_FRAMES; ++frame) {
    float waveRadius = (BOOT_LED_CHECK_WAVE_FRAMES > 1)
                         ? ((frame * static_cast<float>(maxDistance)) / (BOOT_LED_CHECK_WAVE_FRAMES - 1))
                         : maxDistance;
    for (byte i = 0; i < LED_COUNT; ++i) {
      if (h[i].isCmd) {
        continue;
      }
      byte distance = hexDistance(centerIndex, i);
      float separation = fabsf(distance - waveRadius);
      byte value = VALUE_BLACK;
      if (separation < 1.0f) {
        value = interpolateByte(BOOT_LED_CHECK_TRAIL_VALUE,
                                BOOT_LED_CHECK_WAVE_VALUE,
                                static_cast<uint16_t>((1.0f - separation) * 255.0f));
      } else if (separation < 2.0f) {
        value = interpolateByte(VALUE_BLACK,
                                BOOT_LED_CHECK_TRAIL_VALUE,
                                static_cast<uint16_t>((2.0f - separation) * 255.0f));
      }
      float hue = (frame * 22.0f) + (distance * 24.0f);
      strip.setPixelColor(i, getBootLedCheckColor(hue, SAT_VIVID, value));
    }
    showBootLedCheckFrame(BOOT_LED_CHECK_WAVE_MS, frameIndex++);
  }
}

void captureBootLedFrame(uint32_t* frame) {
  for (byte i = 0; i < LED_COUNT; ++i) {
    frame[i] = strip.getPixelColor(i);
  }
}

void writeNormalLedFrameToStrip() {
  for (byte i = 0; i < LED_COUNT; ++i) {
    if (!h[i].isCmd) {
      strip.setPixelColor(i, applyNotePixelColor(i));
    }
  }
  resetVelocityLEDs();
  resetWheelLEDs();
}

void fadeToNormalLedFrame() {
  uint32_t startFrame[LED_COUNT];
  uint32_t targetFrame[LED_COUNT];

  captureBootLedFrame(startFrame);
  writeNormalLedFrameToStrip();
  applyLedCurrentLimitToFrame();
  captureBootLedFrame(targetFrame);

  for (byte frame = 1; frame <= BOOT_LED_CHECK_NORMAL_FADE_FRAMES; ++frame) {
    uint16_t amount255 = (static_cast<uint16_t>(frame) * 255u) / BOOT_LED_CHECK_NORMAL_FADE_FRAMES;
    for (byte i = 0; i < LED_COUNT; ++i) {
      strip.setPixelColor(i, blendPackedColor(startFrame[i], targetFrame[i], amount255));
    }
    strip.show();
    delay(BOOT_LED_CHECK_NORMAL_FADE_MS);
  }
}

void runBootLedSelfCheck() {
  if (!bootAnimationEnabled) {
    return;
  }

  if (settingsFileMissingOnBoot) {
    showFirstBootWhiteDiagnostic();
  }

  uint16_t frameIndex = 0;
  showBootLedCheckSplash(frameIndex);
  fadeToNormalLedFrame();
}
/*
    This function cycles through each button, and based on what color
    palette is active, it calculates the LED color code in the palette,
    plus its variations for being animated, played, or out-of-scale, and
    stores it for recall during playback and animation. The color
    codes remain in the object until this routine is called again.
  */
void setLEDcolorCodes() {
  // ---- Diatonic MOS layer precomputation (runs once per color refresh) ----
  // For the Diatonic color mode, we precompute which "layer" each scale degree
  // belongs to. Layer 0 = diatonic naturals (white), positive layers = sharp side
  // (orange/warm), negative layers = flat side (blue/cool), equidistant = purple.
  // The diatonic MOS is the 7-note scale generated by stacking best-fit fifths.
  int8_t mosLayer[MAX_SCALE_DIVISIONS] = { 0 };
  bool mosEquidistant[MAX_SCALE_DIVISIONS] = { false };
  bool mosValid = false;
  int cycleLength = current.tuning().cycleLength;
  if (colorMode == DIATONIC_COLOR_MODE) {
    float stepSize = current.tuning().stepSize;
    // Best-fit fifth in steps
    int g = (int)round(ratioToCents(1.5) / stepSize);
    // Large and small steps of the diatonic MOS: 5L + 2s = N
    // L = (2*g) mod N  (the whole tone, generated by two fifths reduced by octave)
    int L = positiveMod(2 * g, cycleLength);
    // s = (N - 5*L) / 2  (the remaining semitone)
    int sRemainder = cycleLength - 5 * L;
    bool evenDivision = (sRemainder >= 0) && (sRemainder % 2 == 0);
    int s = evenDivision ? sRemainder / 2 : 0;
    mosValid = evenDivision && (L != s) && (L > 0) && (s > 0);  // L>s = diatonic, L<s = antidiatonic, L==s = degenerate
    if (mosValid) {
      // Build the 7 diatonic positions using Ionian (major scale) pattern:
      // C=0, D=L, E=2L, F=2L+s, G=3L+s, A=4L+s, B=5L+s
      // Interval pattern: L L s L L L s
      int intervals[7] = { L, L, s, L, L, L, s };
      int diatonic[7];
      diatonic[0] = 0;  // C
      for (int j = 1; j < 7; j++) {
        diatonic[j] = diatonic[j - 1] + intervals[j - 1];
      }
      // For each chromatic step, find which diatonic interval it falls in
      // and compute its layer (distance from nearest diatonic note).
      for (int step = 0; step < cycleLength; step++) {
        // Find the diatonic note at or just below this step
        int lowerIdx = 0;
        for (int j = 6; j >= 0; j--) {
          if (diatonic[j] <= step) {
            lowerIdx = j;
            break;
          }
        }
        int upperIdx = (lowerIdx + 1) % 7;
        int lowerPos = diatonic[lowerIdx];
        int upperPos = (upperIdx == 0) ? cycleLength : diatonic[upperIdx];
        int intervalSize = upperPos - lowerPos;  // L or s
        int k = step - lowerPos;                 // offset from lower diatonic note
        int kFromUpper = intervalSize - k;       // offset from upper diatonic note
        if (k == 0) {
          mosLayer[step] = 0;              // diatonic natural
          mosEquidistant[step] = false;
        } else if (k == kFromUpper) {
          mosLayer[step] = k;              // equidistant (e.g. tritone in 12EDO)
          mosEquidistant[step] = true;
        } else if (k < kFromUpper) {
          mosLayer[step] = k;              // sharp side (+1, +2, ...)
          mosEquidistant[step] = false;
        } else {
          mosLayer[step] = -kFromUpper;    // flat side (-1, -2, ...)
          mosEquidistant[step] = false;
        }
      }
    }
  }
  // ---- End diatonic MOS precomputation ----

  const int keyCenteredColorOffset = colorOriginStepOffset();
  for (byte i = 0; i < LED_COUNT; i++) {
    baseLedColorCacheValid[i] = false;
    if (!(h[i].isCmd)) {
      colorDef setColor = { HUE_NONE, SAT_BW, VALUE_BLACK };
      bool userGeometryColorApplied = false;
      const int colorStepsFromOrigin = h[i].stepsFromC + keyCenteredColorOffset;
      byte paletteIndex = positiveMod(colorStepsFromOrigin, cycleLength);
      if (userGeometryRuntimeActive && userGeometryRuntimePaletteActive && colorMode == CUSTOM_COLOR_MODE) {
        setColor = userGeometryRuntimePalette.getColor(paletteIndex);
        userGeometryColorApplied = true;
      } else if (userGeometryRuntimeActive && colorMode == CUSTOM_COLOR_MODE) {
        setColor = { 360 * ((float)paletteIndex / (float)current.tuning().cycleLength), SAT_VIVID, VALUE_NORMAL };
      } else {
        switch (colorMode) {
          case CUSTOM_COLOR_MODE:  // This mode sets the color based on the palettes defined above.
            setColor = palette[current.tuningIndex].getColor(paletteIndex);
            break;
          case RAINBOW_MODE:  // This mode assigns the root note as red, and the rest as saturated spectrum colors across the rainbow.
            setColor = { 360 * ((float)paletteIndex / (float)current.tuning().cycleLength), SAT_VIVID, VALUE_NORMAL };
            break;
          case RAINBOW_OF_FIFTHS_MODE:  // This mode assigns the root note as red, and the rest as saturated spectrum colors across the rainbow.
            {
            float stepSize = current.tuning().stepSize;
            float octaveCycleLength = OCTAVE_CENTS / stepSize;  // Prevent non-octave coloring artifacts.
            float octaveDegree = positiveFloatMod(static_cast<float>(colorStepsFromOrigin), octaveCycleLength);
            float fifthSize = ((ratioToCents(3.0 / 2.0)) / stepSize);
            float reverseFifth = fifthSize;
            switch (current.tuning().cycleLength) {
              case 17:
                {
                  reverseFifth = 12;
                }
                break;  // reverse hash of (10*x)%17=x where 10 steps is a 17EDO fifth
              case 19:
                {
                  reverseFifth = 7;
                }
                break;  // reverse hash of (11*x)%19=x where 11 steps is a 19EDO fifth
              case 22:
                {
                  reverseFifth = 17;
                }
                break;  // reverse hash of (13*x)%22=x where 13 steps is a 22EDO fifth
              case 24:
                {
                  reverseFifth = 11;
                }
                break;  // hand-picked best-fit value. This tuning is very unruly
              case 31:
                {
                  reverseFifth = 19;
                }
                break;  // reverse hash of (18*x)%31=x where 18 steps is a 31EDO fifth
              case 41:
                {
                  reverseFifth = 12;
                }
                break;  // reverse hash of (24*x)%41=x where 24 steps is a 41EDO fifth
              case 43:
                {
                  reverseFifth = 31;
                }
                break;  // reverse hash of (25*x)%43=x where 25 steps is a 43EDO fifth
              case 46:
                {
                  reverseFifth = 29;
                }
                break;  // reverse hash of (27*x)%46=x where 27 steps is a 46EDO fifth
              case 53:
                {
                  reverseFifth = 12;
                }
                break;  // reverse hash of (31*x)%53=x where 31 steps is a 53EDO fifth
              case 58:
                {
                  reverseFifth = 12;
                }
                break;  // reverse hash for 29EDO (2 chains of 29 EDO fifths in 58 EDO)
              case 72:
                {
                  reverseFifth = 7;
                }
                break;  // reverse hash for 12EDO (6 chains of 12 EDO fifths in 72 EDO)
              case 80:
                {
                  reverseFifth = 63;
                }
                break;  // reverse hash of (47*x)%80=x where 47 steps is an 80EDO fifth
              case 87:
                {
                  reverseFifth = 41;
                }
                break;  // A hand-picked value, seems to work. 46 also works
              case 13:
                {
                  reverseFifth = 5;
                }
                break;  // A hand-picked value; 23 and 64 also work
              case 9:
                {
                  reverseFifth = 5;
                }
                break;  // A hand-picked value
              case 11:
                {
                  reverseFifth = 7;
                }
                break;  // reverse hash of (11*x)%19=x where 11 steps is a 19EDO equivalent fifth
              case 20:
                {
                  reverseFifth = 12;
                }
                break;  // reverse hash for 17EDO(2 chains of 17 EDO fifths in 34 EDO equivalent)
              default:
                {
                  reverseFifth = fifthSize;
                }  // either the tuning has no fifths or scrambling colors using fifths works
            }

            float paletteIndexOfFifths = positiveFloatMod(octaveDegree * reverseFifth, octaveCycleLength);
            setColor = {
              HUE_CIRCLE_DEGREES * (paletteIndexOfFifths / octaveCycleLength),
              SAT_VIVID,
              VALUE_NORMAL
            };
          }
          break;
        case PIANO_ALT_COLOR_MODE:
          {
            float pianoPitchClass =
              pianoPitchClassForColorSteps(colorStepsFromOrigin, current.tuning().stepSize);
            float roundedPitchClass = roundf(pianoPitchClass);
            int pitchClass = nearestPianoPitchClass(pianoPitchClass);
            float deviationHue =
              (roundedPitchClass - pianoPitchClass) * ALT_PIANO_DEVIATION_HUE_RANGE;
            float baseHue = ALT_PIANO_WHITE_HUE
                            + (pianoPitchClassIsBlack(pitchClass)
                                 ? ALT_PIANO_OPPOSITE_HUE_OFFSET
                                 : 0.0f);
            setColor = {
              positiveFloatMod(baseHue + deviationHue, HUE_CIRCLE_DEGREES),
              SAT_VIVID,
              VALUE_NORMAL
            };
          }
          break;
        case PIANO_COLOR_MODE:
          {
            float pianoPitchClass =
              pianoPitchClassForColorSteps(colorStepsFromOrigin, current.tuning().stepSize);
            int pitchClass = nearestPianoPitchClass(pianoPitchClass);
            setColor = {
              HUE_CIRCLE_DEGREES * pitchClass / PIANO_PITCH_CLASS_COUNT,
              SAT_TINT,
              pianoPitchClassIsBlack(pitchClass) ? VALUE_BLACK : VALUE_NORMAL
            };
          }
          break;
        case PIANO_INCANDESCENT_COLOR_MODE:
          {
            float pianoPitchClass =
              pianoPitchClassForColorSteps(colorStepsFromOrigin, current.tuning().stepSize);
            float roundedPitchClass = roundf(pianoPitchClass);
            int pitchClass = nearestPianoPitchClass(pianoPitchClass);
            float distanceFromPianoKey = fabsf(roundedPitchClass - pianoPitchClass);
            float heat = pianoPitchClassIsBlack(pitchClass)
                           ? distanceFromPianoKey
                           : 1.0f - distanceFromPianoKey;
            float temperature = sqrtf(heat)
                                * (incandescence::MAX_TEMPERATURE_KELVIN
                                   - incandescence::MIN_TEMPERATURE_KELVIN)
                                + incandescence::MIN_TEMPERATURE_KELVIN;
            setColor = incandescence::getColor(static_cast<int32_t>(roundf(temperature)));
          }
          break;
          case ALTERNATE_COLOR_MODE:
            {
            // This mode assigns each note a color based on the interval it forms with the root note.
            // This is an adaptation of an algorithm developed by Nicholas Fox and Kite Giedraitis.
            float cents = current.tuning().stepSize * paletteIndex;
            bool perf = 0;
            float center = 0.0;
            if (cents < 50) { perf = 1; center = 0.0; }
            else if ((cents >= 50) && (cents < 250)) { center = 147.1; }
            else if ((cents >= 250) && (cents < 450)) { center = 351.0; }
            else if ((cents >= 450) && (cents < 600)) { perf = 1; center = 498.0; }
            else if ((cents >= 600) && (cents <= 750)) { perf = 1; center = 702.0; }
            else if ((cents > 750) && (cents <= 950)) { center = 849.0; }
            else if ((cents > 950) && (cents <= 1150)) { center = 1053.0; }
            else if ((cents > 1150) && (cents < 1250)) { perf = 1; center = 1200.0; }
            else if ((cents >= 1250) && (cents < 1450)) { center = 1347.1; }
            else if ((cents >= 1450) && (cents < 1650)) { center = 1551.0; }
            else if ((cents >= 1650) && (cents < 1850)) { perf = 1; center = 1698.0; }
            else if ((cents >= 1800) && (cents <= 1950)) { perf = 1; center = 1902.0; }
            float offCenter = cents - center;
            int16_t altHue = positiveMod((int)(150 + (perf * ((offCenter > 0) ? -72 : 72)) - round(1.44 * offCenter)), 360);
            float deSaturate = perf * (abs(offCenter) < 20) * (1 - (0.02 * abs(offCenter)));
            setColor = {
              (float)altHue,
              (byte)(255 - round(255 * deSaturate)),
              (byte)(cents ? VALUE_SHADE : VALUE_NORMAL)
            };
            }
            break;
          case DIATONIC_COLOR_MODE:
            {
            byte rawIndex = paletteIndex;
            if (!mosValid) {
              setColor.hue = 360.0f * ((float)paletteIndex / (float)cycleLength);
              setColor.sat = SAT_VIVID;
              setColor.val = VALUE_NORMAL;
            } else {
              int8_t layer = mosLayer[rawIndex];
              bool equi = mosEquidistant[rawIndex];
              if (layer == 0) {
                setColor.hue = HUE_NONE;
                setColor.sat = SAT_BW;
                setColor.val = VALUE_NORMAL;
              } else if (equi) {
                setColor.hue = HUE_PURPLE;
                setColor.sat = SAT_DULL;
                setColor.val = VALUE_NORMAL;
              } else if (layer > 0) {
                float hue = fmodf(360.0f + HUE_ORANGE - (float)(layer - 1) * 36.0f, 360.0f);
                byte val = (byte)max((int)VALUE_SHADE, (int)VALUE_NORMAL - (layer - 1) * 16);
                setColor.hue = hue;
                setColor.sat = SAT_VIVID;
                setColor.val = val;
              } else {
                int absLayer = -layer;
                float hue = fmodf(HUE_BLUE + (float)(absLayer - 1) * 36.0f, 360.0f);
                byte val = (byte)max((int)VALUE_SHADE, (int)VALUE_NORMAL - (absLayer - 1) * 16);
                setColor.hue = hue;
                setColor.sat = SAT_VIVID;
                setColor.val = val;
              }
              }
            }
            break;
          default:
            break;
        }
      }
      if (userGeometryRuntimeActive && userGeometryRuntimeButtonColorActive[i] && colorMode == CUSTOM_COLOR_MODE) {
        setColor = userGeometryRuntimeButtonColor[i];
        userGeometryColorApplied = true;
      }
      baseLedColorCache[i] = setColor;
      baseLedColorCacheValid[i] = true;
      colorDef restColor = setColor;
      if (userGeometryColorApplied && restColor.val > USER_GEOMETRY_REST_COLOR_VALUE_MAX) {
        restColor.val = USER_GEOMETRY_REST_COLOR_VALUE_MAX;
      }
      restColor.val = applyLEDLevel(restColor.val, ledRestBrightness);
      h[i].LEDcodeRest = getLEDcode(restColor);
      colorDef playColor = setColor.tint();
      h[i].LEDcodePlay = getLEDcode(playColor);
      colorDef dimColor = setColor.shade();
      dimColor.val = applyLEDLevel(dimColor.val, ledDimBrightness);
      h[i].LEDcodeDim = getLEDcode(dimColor);
      setColor = { HUE_NONE, SAT_BW, VALUE_BLACK };
      h[i].LEDcodeOff = getLEDcode(setColor);  // turn off entirely
      h[i].LEDcodeAnim = h[i].LEDcodePlay;
    }
  }
  sendToLog("LED codes re-calculated.");
}

void RAM_FUNC(resetVelocityLEDs)() {
  byte topValue = byteLerp(0, 255, 85, 127, velWheel.curValue);
  colorDef tempColor = {
    (runTime % (rainbowDegreeTime * 360)) / (float)rainbowDegreeTime,
    SAT_MODERATE,
    applyLEDLevel(topValue, ledRestBrightness)
  };
  strip.setPixelColor(assignCmd[0], getLEDcode(tempColor));

  tempColor.val = applyLEDLevel(byteLerp(0, 255, 42, 85, velWheel.curValue), ledRestBrightness);
  strip.setPixelColor(assignCmd[1], getLEDcode(tempColor));

  tempColor.val = applyLEDLevel(byteLerp(0, 255, 0, 42, velWheel.curValue), ledRestBrightness);
  strip.setPixelColor(assignCmd[2], getLEDcode(tempColor));
}
void RAM_FUNC(resetWheelLEDs)() {
  // middle button
  byte tempSat = SAT_BW;
  byte baseValue = static_cast<byte>(toggleWheel ? VALUE_SHADE : VALUE_LOW);
  colorDef tempColor = { HUE_NONE, tempSat, applyLEDLevel(baseValue, ledRestBrightness) };
  strip.setPixelColor(assignCmd[3], getLEDcode(tempColor));
  if (toggleWheel) {
    // pb red / green
    tempSat = byteLerp(SAT_BW, SAT_VIVID, 0, 8192, abs(pbWheel.curValue));
    tempColor = {
      (float)((pbWheel.curValue > 0) ? HUE_RED : HUE_CYAN),
      tempSat,
      applyLEDLevel(VALUE_FULL, ledRestBrightness)
    };
    strip.setPixelColor(assignCmd[5], getLEDcode(tempColor));

    tempColor.val = applyLEDLevel(static_cast<byte>(tempSat * (pbWheel.curValue > 0)), ledRestBrightness);
    strip.setPixelColor(assignCmd[4], getLEDcode(tempColor));

    tempColor.val = applyLEDLevel(static_cast<byte>(tempSat * (pbWheel.curValue < 0)), ledRestBrightness);
    strip.setPixelColor(assignCmd[6], getLEDcode(tempColor));
  } else {
    // mod blue / yellow
    tempSat = byteLerp(SAT_BW, SAT_VIVID, 0, 64, abs(modWheel.curValue - 63));
    byte brightValue = static_cast<byte>(127 + (tempSat / 2));
    tempColor = {
      (float)((modWheel.curValue > 63) ? HUE_YELLOW : HUE_INDIGO),
      tempSat,
      applyLEDLevel(brightValue, ledRestBrightness)
    };
    strip.setPixelColor(assignCmd[6], getLEDcode(tempColor));

    if (modWheel.curValue <= 63) {
      brightValue = static_cast<byte>(127 - (tempSat / 2));
      tempColor.val = applyLEDLevel(brightValue, ledRestBrightness);
    }
    // when modWheel.curValue > 63, tempColor already holds the proper value
    strip.setPixelColor(assignCmd[5], getLEDcode(tempColor));

    tempColor.val = applyLEDLevel(static_cast<byte>(tempSat * (modWheel.curValue > 63)), ledRestBrightness);
    strip.setPixelColor(assignCmd[4], getLEDcode(tempColor));
  }
}

inline uint8_t RAM_FUNC(scalePackedChannelQ8)(uint8_t component, uint16_t scaleQ8) {
  uint32_t scaled = static_cast<uint32_t>(component) * scaleQ8;
  scaled >>= 8;
  return static_cast<uint8_t>(scaled > 255 ? 255 : scaled);
}

inline uint32_t RAM_FUNC(scalePackedColorQ8)(uint32_t color, uint16_t scaleQ8) {
  return strip.Color(scalePackedChannelQ8(static_cast<uint8_t>(color >> 16), scaleQ8),
                     scalePackedChannelQ8(static_cast<uint8_t>(color >> 8), scaleQ8),
                     scalePackedChannelQ8(static_cast<uint8_t>(color), scaleQ8));
}

void RAM_FUNC(applyMetronomeBrightnessFlash)() {
  if (!metronomeBrightnessSelected()) {
    return;
  }
  constexpr uint16_t METRONOME_BRIGHTNESS_ACCENT_SCALE_Q8 = 256;
  constexpr uint16_t METRONOME_BRIGHTNESS_BEAT_SCALE_Q8 = 200;
  constexpr uint16_t METRONOME_BRIGHTNESS_REST_SCALE_Q8 = 96;
  uint16_t scaleQ8 = metronomeVisualFlashActive()
                       ? (metronomeAccent ? METRONOME_BRIGHTNESS_ACCENT_SCALE_Q8 : METRONOME_BRIGHTNESS_BEAT_SCALE_Q8)
                       : METRONOME_BRIGHTNESS_REST_SCALE_Q8;
  for (byte i = 0; i < LED_COUNT; ++i) {
    strip.setPixelColor(i, scalePackedColorQ8(strip.getPixelColor(i), scaleQ8));
  }
}

void RAM_FUNC(renderMetronomeSideButtonFlash)() {
  if (!(metronomeSideButtonsSelected() && metronomeVisualFlashActive())) {
    return;
  }
  byte value = metronomeAccent ? VALUE_FULL : VALUE_SHADE;
  float hue = metronomeAccent ? HUE_GREEN : HUE_RED;
  colorDef flashColor = {
    hue,
    SAT_VIVID,
    applyLEDLevel(value, ledRestBrightness)
  };
  uint32_t flashCode = getLEDcode(flashColor);
  for (byte cmd = 0; cmd < CMDCOUNT; ++cmd) {
    strip.setPixelColor(assignCmd[cmd], flashCode);
  }
}

uint32_t RAM_FUNC(applyNotePixelColor)(byte x) {
  if (h[x].animate) {
    return h[x].LEDcodeAnim;
  }
  bool hasDirectColorOverride = userGeometryRuntimeActive
                                && colorMode == CUSTOM_COLOR_MODE
                                && userGeometryRuntimeButtonColorActive[x];
  if (h[x].note == UNUSED_NOTE && !hasDirectColorOverride) {
    return h[x].LEDcodeOff;
  }
  if ((animationType != ANIMATE_NONE)
          && (animationType != ANIMATE_MIDI_IN)
          && h[x].MIDIch) {
    return h[x].LEDcodePlay;
  } else if (h[x].inScale) {
    return h[x].LEDcodeRest;
  } else if (scaleLock) {
    return h[x].LEDcodeOff;
  } else {
    return h[x].LEDcodeDim;
  }
}
uint32_t ledTestColorCode() {
  byte value = globalBrightness;
  switch (ledTestMode) {
    case LED_TEST_RED:
      return strip.Color(value, 0, 0);
    case LED_TEST_GREEN:
      return strip.Color(0, value, 0);
    case LED_TEST_BLUE:
      return strip.Color(0, 0, value);
    case LED_TEST_WHITE:
      return strip.Color(value, value, value);
    default:
      return 0;
  }
}
void renderLedTestFrame() {
  uint32_t color = ledTestColorCode();
  for (byte i = 0; i < LED_COUNT; ++i) {
    strip.setPixelColor(i, color);
  }
  applyLedCurrentLimitToFrame();
  strip.show();
}
void setupLEDs() {
  strip.begin();  // INITIALIZE NeoPixel strip object
  strip.show();   // Turn OFF all pixels ASAP
  sendToLog("LEDs started...");
}
void clearLEDs() {
  strip.clear();
  strip.show();
}
void RAM_FUNC(lightUpLEDs)() {
  if (ledTestMode != LED_TEST_OFF) {
    renderLedTestFrame();
    return;
  }
  if (delegatedControl) {
    for (byte i = 0; i < LED_COUNT; i++) {
      strip.setPixelColor(i, delegatedColors[i]);
    }
  } else {
    for (byte i = 0; i < LED_COUNT; i++) {
      if (!(h[i].isCmd)) {
        strip.setPixelColor(i, applyNotePixelColor(i));
      }
    }
    resetVelocityLEDs();
    resetWheelLEDs();
    renderMetronomeSideButtonFlash();
    applyMetronomeBrightnessFlash();
    if (sequencerModeActive()) {
      // Sequencer owns its mode-specific LED policy; this renderer only applies
      // those overrides after the normal keyboard/metronome frame is built.
      sequencer::renderLedOverrides(
        [](byte buttonIndex, uint32_t color) {
          strip.setPixelColor(buttonIndex, color);
        });
    }
  }
  applyLedCurrentLimitToFrame();
  strip.show();
}
