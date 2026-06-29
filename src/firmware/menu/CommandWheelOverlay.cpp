#include "CommandWheelOverlay.h"

#include "../app/DiagnosticsTiming.h"
#include "../sequencer/SequencerMode.h"
#include "MenuAndDisplay.h"

extern bool screenSaverOn;

namespace {

constexpr uint64_t kOverlayHoldMicros = 3000000ULL;
constexpr uint64_t kOverlayRedrawIntervalMicros = 100000ULL;
constexpr int kMeterX = 10;
constexpr int kMeterY = 94;
constexpr int kMeterWidth = 108;
constexpr int kMeterHeight = 14;
constexpr int kMeterInnerX = kMeterX + 2;
constexpr int kMeterInnerY = kMeterY + 2;
constexpr int kMeterInnerWidth = kMeterWidth - 4;
constexpr int kMeterInnerHeight = kMeterHeight - 4;

bool overlayActive = false;
bool overlayVisible = false;
bool overlayDirty = false;
bool overlayRedrawPending = false;
CommandWheelOverlayType overlayType = CommandWheelOverlayType::Velocity;
int16_t overlayCurrentValue = 0;
int16_t overlayMinValue = 0;
int16_t overlayMaxValue = 127;
uint64_t overlayExpiresAt = 0;
uint64_t overlayNextRedrawAt = 0;

const char* overlayTitle(CommandWheelOverlayType type) {
  switch (type) {
    case CommandWheelOverlayType::Velocity:
      return "VELOCITY";
    case CommandWheelOverlayType::Modulation:
      return "MOD WHEEL";
    case CommandWheelOverlayType::PitchBend:
      return "PITCH BEND";
  }
  return "";
}

int valueSpan() {
  int span = static_cast<int>(overlayMaxValue) - static_cast<int>(overlayMinValue);
  return span > 0 ? span : 1;
}

int valueToMeterWidth(int16_t value) {
  long clamped = std::max(static_cast<long>(overlayMinValue),
                          std::min(static_cast<long>(overlayMaxValue), static_cast<long>(value)));
  long offset = clamped - overlayMinValue;
  return static_cast<int>((offset * kMeterInnerWidth + (valueSpan() / 2)) / valueSpan());
}

int pitchBendPercent(int16_t value) {
  if (value == 0) {
    return 0;
  }
  long rawValue = static_cast<long>(value);
  long magnitude = rawValue < 0 ? -rawValue : rawValue;
  magnitude = std::min(magnitude, 8192L);
  long denominator = value < 0 ? 8192L : 8191L;
  long percent = (magnitude * 100L + (denominator / 2L)) / denominator;
  if (percent > 100L) {
    percent = 100L;
  }
  return value < 0 ? -static_cast<int>(percent) : static_cast<int>(percent);
}

void formatValue(CommandWheelOverlayType type, int16_t value, char* out, size_t outSize) {
  if (out == nullptr || outSize == 0) {
    return;
  }
  if (type == CommandWheelOverlayType::PitchBend) {
    int percent = pitchBendPercent(value);
    if (percent > 0) {
      snprintf(out, outSize, "+%d%%", percent);
    } else {
      snprintf(out, outSize, "%d%%", percent);
    }
    return;
  }
  snprintf(out, outSize, "%d", static_cast<int>(value));
}

void drawCenteredText(const char* text, int y) {
  int width = u8g2.getStrWidth(text);
  int x = (u8g2.getDisplayWidth() - width) / 2;
  if (x < 0) {
    x = 0;
  }
  u8g2.drawStr(x, y, text);
}

void drawStandardMeter() {
  u8g2.drawFrame(kMeterX, kMeterY, kMeterWidth, kMeterHeight);
  int width = valueToMeterWidth(overlayCurrentValue);
  if (width > 0) {
    u8g2.drawBox(kMeterInnerX, kMeterInnerY, width, kMeterInnerHeight);
  }
}

void drawCenteredMeter() {
  u8g2.setDrawColor(1);
  u8g2.drawFrame(kMeterX, kMeterY, kMeterWidth, kMeterHeight);
  const int leftBound = kMeterInnerX;
  const int rightBound = kMeterInnerX + kMeterInnerWidth - 1;
  const int centerX = kMeterInnerX + (kMeterInnerWidth / 2);
  int percent = pitchBendPercent(overlayCurrentValue);

  if (percent > 0) {
    const int rightSpan = rightBound - centerX;
    int rightEdge = centerX + ((percent * rightSpan + 50) / 100);
    rightEdge = std::max(centerX + 1, std::min(rightBound, rightEdge));
    u8g2.drawBox(centerX + 1, kMeterInnerY, rightEdge - centerX, kMeterInnerHeight);
  } else if (percent < 0) {
    const int leftSpan = centerX - leftBound;
    int leftEdge = centerX - (((-percent) * leftSpan + 50) / 100);
    leftEdge = std::max(leftBound, std::min(centerX - 1, leftEdge));
    u8g2.drawBox(leftEdge, kMeterInnerY, centerX - leftEdge, kMeterInnerHeight);
  }

  u8g2.drawVLine(centerX, kMeterInnerY - 2, kMeterInnerHeight + 4);
}

void restoreUnderlyingDisplay() {
  if (sequencerModeActive()) {
    restoreSequencerDisplayAfterPlayedNotesOverlay();
  } else {
    restoreInteractiveMenuDisplay();
  }
}

void RAM_FUNC(clearOverlayState)() {
  overlayActive = false;
  overlayVisible = false;
  overlayDirty = false;
  overlayRedrawPending = false;
  overlayExpiresAt = 0;
  overlayNextRedrawAt = 0;
}

}  // namespace

bool commandWheelOverlayActive() {
  return overlayActive || overlayVisible;
}

void RAM_FUNC(notifyCommandWheelOverlay)(CommandWheelOverlayType type,
                                         int16_t currentValue,
                                         int16_t minValue,
                                         int16_t maxValue,
                                         bool immediateRedraw) {
  bool newlyShown = !overlayActive || overlayType != type;
  overlayCurrentValue = currentValue;
  overlayType = type;
  overlayMinValue = minValue;
  overlayMaxValue = maxValue;
  overlayActive = true;
  if (immediateRedraw || newlyShown || runTime >= overlayNextRedrawAt) {
    overlayDirty = true;
    overlayRedrawPending = false;
    overlayNextRedrawAt = runTime + kOverlayRedrawIntervalMicros;
  } else {
    overlayRedrawPending = true;
  }
  overlayExpiresAt = runTime + kOverlayHoldMicros;
  screenTime = 0;
}

void RAM_FUNC(dismissCommandWheelOverlay)() {
  clearOverlayState();
}

void drawCommandWheelOverlay() {
  if (!overlayActive) {
    return;
  }

  if (runTime > overlayExpiresAt) {
    bool wasVisible = overlayVisible;
    clearOverlayState();
    if (wasVisible) {
      restoreUnderlyingDisplay();
    }
    return;
  }

  if (!overlayDirty && overlayRedrawPending && runTime >= overlayNextRedrawAt) {
    overlayDirty = true;
    overlayRedrawPending = false;
    overlayNextRedrawAt = runTime + kOverlayRedrawIntervalMicros;
  }

  if (!overlayDirty && overlayVisible) {
    return;
  }

  if (screenSaverOn) {
    screenSaverOn = false;
    u8g2.setContrast(CONTRAST_AWAKE);
  }

  char valueLabel[10];
  formatValue(overlayType, overlayCurrentValue, valueLabel, sizeof(valueLabel));

  u8g2.clearBuffer();
  u8g2.setDrawColor(1);
  u8g2.setFont(u8g2_font_7x14_tf);
  drawCenteredText(overlayTitle(overlayType), 14);
  u8g2.drawHLine(12, 34, 104);

  u8g2.setFont(u8g2_font_logisoso16_tf);
  if (u8g2.getStrWidth(valueLabel) > 124) {
    u8g2.setFont(u8g2_font_7x14_tf);
  }
  drawCenteredText(valueLabel, 46);

  u8g2.setFont(u8g2_font_6x13_tf);
  if (overlayType == CommandWheelOverlayType::PitchBend) {
    drawCenteredText("-100%   0   +100%", 78);
    drawCenteredMeter();
  } else {
    char rangeLabel[18];
    snprintf(rangeLabel,
             sizeof(rangeLabel),
             "%d..%d",
             static_cast<int>(overlayMinValue),
             static_cast<int>(overlayMaxValue));
    drawCenteredText(rangeLabel, 78);
    drawStandardMeter();
  }

  overlayVisible = true;
  overlayDirty = false;
  u8g2.setDrawColor(1);
  u8g2.sendBuffer();
}
