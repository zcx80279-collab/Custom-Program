#include "touch_manager.h"
#include "board_config.h"
#include <Wire.h>
#include <math.h>

static const unsigned long TOUCH_DEBOUNCE_MS = 180;

bool TouchManager::begin() {
#if RMC_ENABLE_CST816S_DRIVER
  pinMode(PIN_TOUCH_RST, OUTPUT);
  pinMode(PIN_TOUCH_INT, INPUT_PULLUP);

  // Hardware reset pulse for CST816S
  digitalWrite(PIN_TOUCH_RST, LOW);
  delay(10);
  digitalWrite(PIN_TOUCH_RST, HIGH);
  delay(50);

  Wire.begin(PIN_TOUCH_SDA, PIN_TOUCH_SCL, 400000);
  Wire.beginTransmission(TOUCH_I2C_ADDR);
  uint8_t err = Wire.endTransmission();
  _ready = (err == 0);
  return _ready;
#else
  _ready = false;
  return false;
#endif
}

TouchPoint TouchManager::readCst816s() {
  TouchPoint pt{ false, 0, 0 };
#if RMC_ENABLE_CST816S_DRIVER
  if (!_ready) return pt;

  Wire.beginTransmission(TOUCH_I2C_ADDR);
  Wire.write(0x02); // Finger count + X/Y registers (0x02..0x06)
  if (Wire.endTransmission(false) != 0) {
    return pt;
  }

  uint8_t received = Wire.requestFrom(static_cast<uint8_t>(TOUCH_I2C_ADDR), static_cast<uint8_t>(5));
  if (received < 5) {
    return pt;
  }

  uint8_t fingers = Wire.read();
  uint8_t xh = Wire.read();
  uint8_t xl = Wire.read();
  uint8_t yh = Wire.read();
  uint8_t yl = Wire.read();

  if (fingers > 0) {
    pt.touched = true;
    pt.x = static_cast<int16_t>(((xh & 0x0F) << 8) | xl);
    pt.y = static_cast<int16_t>(((yh & 0x0F) << 8) | yl);
  }
#endif
  return pt;
}

int TouchManager::hitTest(int16_t x, int16_t y, const String& layout) {
  const float dx = static_cast<float>(x - 180);
  const float dy = static_cast<float>(y - 180);
  const float dist = sqrtf(dx * dx + dy * dy);

  if (dist > 180.0f) return -1;
  if (dist <= 56.0f) return 0;
  if (dist < 64.0f || dist > 170.0f) return -1;

  int outerCount = 6;
  if (layout == "RADIAL_4_CENTER") outerCount = 4;
  else if (layout == "RADIAL_8_CENTER") outerCount = 8;

  const float sectorSweep = 360.0f / static_cast<float>(outerCount);
  float clockwiseDeg = (atan2f(dy, dx) * 180.0f / static_cast<float>(M_PI)) + 90.0f;
  if (clockwiseDeg < 0.0f) clockwiseDeg += 360.0f;

  float shifted = fmodf(clockwiseDeg + (sectorSweep / 2.0f), 360.0f);
  int sectorIdx = static_cast<int>(floorf(shifted / sectorSweep));
  int slot = sectorIdx + 1;
  if (slot < 1) slot = 1;
  if (slot > outerCount) slot = outerCount;
  return slot;
}

bool TouchManager::pollButtonPress(const String& layout, int& pressedSlotOut) {
  TouchPoint pt = readCst816s();
  if (!pt.touched) {
    _wasTouched = false;
    return false;
  }

  unsigned long now = millis();
  if (!_wasTouched && (now - _lastTriggerMs) >= TOUCH_DEBOUNCE_MS) {
    _wasTouched = true;
    int slot = hitTest(pt.x, pt.y, layout);
    if (slot >= 0) {
      _lastTriggerMs = now;
      pressedSlotOut = slot;
      return true;
    }
  }
  return false;
}
