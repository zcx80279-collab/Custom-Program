#include "display_manager.h"
#include "board_config.h"
#include <math.h>

#if RMC_ENABLE_ST77916_DRIVER
#include <Arduino_GFX_Library.h>

// QSPI bus & ST77916 panel driver (Pins from board_config.h — verify on physical JC3636W518C)
static Arduino_DataBus* s_bus = nullptr;
static Arduino_GFX* s_gfx = nullptr;
#endif

static int getOuterCount(const String& layout) {
  if (layout == "RADIAL_4_CENTER") return 4;
  if (layout == "RADIAL_8_CENTER") return 8;
  return 6;
}

bool DisplayManager::begin() {
  pinMode(PIN_TFT_BL, OUTPUT);
  digitalWrite(PIN_TFT_BL, HIGH);

#if RMC_ENABLE_ST77916_DRIVER
  s_bus = new Arduino_ESP32QSPI(
      PIN_TFT_CS,
      PIN_TFT_SCK,
      PIN_TFT_D0,
      PIN_TFT_D1,
      PIN_TFT_D2,
      PIN_TFT_D3);

  s_gfx = new Arduino_ST77916(
      s_bus,
      PIN_TFT_RST,
      0 /* rotation */,
      true /* IPS */,
      RMC_DISPLAY_WIDTH,
      RMC_DISPLAY_HEIGHT);

  if (!s_gfx->begin()) {
    _ready = false;
    return false;
  }

  s_gfx->fillScreen(0x0000);
  _ready = true;
  return true;
#else
  _ready = false;
  return false;
#endif
}

void DisplayManager::render(const FirmwareDeviceConfig& config, int activePressedSlot) {
  _lastPressedSlot = activePressedSlot;
#if RMC_ENABLE_ST77916_DRIVER
  if (!_ready || !s_gfx) return;

  const int cx = RMC_DISPLAY_WIDTH / 2;  // 180
  const int cy = RMC_DISPLAY_HEIGHT / 2; // 180
  const int centerR = 56;
  const int innerR = 64;
  const int outerR = 170;
  const int outerCount = getOuterCount(config.layout);
  const float sweepDeg = 360.0f / static_cast<float>(outerCount);
  const float baseStartDeg = -90.0f - (sweepDeg / 2.0f);

  s_gfx->fillScreen(config.backgroundColor565);
  s_gfx->drawCircle(cx, cy, 174, config.testMode ? 0xFD20 : 0x31A6);

  // Draw outer radial sectors as clean circular pads centered along the ring
  const float padCenterR = (innerR + outerR) / 2.0f;
  const int padRadius = (outerCount == 8) ? 34 : (outerCount == 6 ? 42 : 48);

  for (const auto& btn : config.buttons) {
    uint16_t fill = btn.color565;
    if (btn.slotIndex == activePressedSlot) {
      fill = config.testMode ? 0xB2A0 : 0x1D5F; // Amber highlight in Test Mode, Blue in normal mode
    } else if (!btn.enabled) {
      fill = 0x18C3; // Muted disabled
    }

    if (btn.slotIndex == 0) {
      s_gfx->fillCircle(cx, cy, centerR, fill);
      s_gfx->drawCircle(cx, cy, centerR, 0x6B4D);
      s_gfx->setTextColor(0xFFFF);
      s_gfx->setTextSize(2);
      int16_t tx = cx - static_cast<int16_t>(btn.label.length() * 6);
      s_gfx->setCursor(tx, cy - 7);
      s_gfx->print(btn.label.substring(0, 8));
    } else if (btn.slotIndex >= 1 && btn.slotIndex <= outerCount) {
      float midDeg = baseStartDeg + (btn.slotIndex - 1 + 0.5f) * sweepDeg;
      float rad = midDeg * static_cast<float>(M_PI) / 180.0f;
      int bx = cx + static_cast<int>(padCenterR * cosf(rad));
      int by = cy + static_cast<int>(padCenterR * sinf(rad));

      s_gfx->fillCircle(bx, by, padRadius, fill);
      s_gfx->drawCircle(bx, by, padRadius, 0x6B4D);
      s_gfx->setTextColor(0xFFFF);
      s_gfx->setTextSize(1);
      int16_t tx = bx - static_cast<int16_t>(btn.label.length() * 3);
      s_gfx->setCursor(tx, by - 4);
      s_gfx->print(btn.label.substring(0, 8));
    }
  }
#else
  (void)config;
#endif
}

void DisplayManager::setPressedSlot(const FirmwareDeviceConfig& config, int slotIndex) {
  if (_lastPressedSlot == slotIndex) return;
  render(config, slotIndex);
}
