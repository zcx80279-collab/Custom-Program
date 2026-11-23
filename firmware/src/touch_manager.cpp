#include "touch_manager.h"
#include "board_config.h"
#include <Wire.h>
#include <math.h>

static const unsigned long TOUCH_DEBOUNCE_MS      = 180;
static const unsigned long TAP_MAX_DURATION_MS    = 240;
static const unsigned long MULTI_TAP_WINDOW_MS    = 260;
static const float         DRAG_THRESHOLD_PX      = 8.0f;
static const float         MULTI_TAP_MAX_DIST_PX  = 32.0f;
static const float         CENTER_SWITCH_RADIUS   = 60.0f;
static const int16_t       MOUSE_SENSITIVITY_MULT = 2;

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

void TouchManager::setMode(ControllerInputMode mode) {
  _mode = mode;
  _isDragging = false;
  _pendingTapCount = 0;
  _pendingTapsInCenter = false;
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

bool TouchManager::isCenterZone(int16_t x, int16_t y) {
  const float dx = static_cast<float>(x - 180);
  const float dy = static_cast<float>(y - 180);
  const float dist = sqrtf(dx * dx + dy * dy);
  return dist <= CENTER_SWITCH_RADIUS;
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
  TouchInteractionEvent evt = pollInteraction(layout);
  if (evt.type == TouchGestureType::MACRO_BUTTON_PRESS && evt.pressedSlot >= 0) {
    pressedSlotOut = evt.pressedSlot;
    return true;
  }
  return false;
}

TouchInteractionEvent TouchManager::pollInteraction(const String& layout) {
  TouchInteractionEvent evt;
  evt.currentMode = _mode;
  evt.centerTapProgress = _pendingTapsInCenter ? _pendingTapCount : 0;

  TouchPoint pt = readCst816s();
  unsigned long now = millis();

  if (pt.touched) {
    if (!_isTouching) {
      // Touch down start
      _isTouching = true;
      _isDragging = false;
      _downX = _lastX = pt.x;
      _downY = _lastY = pt.y;
      _downAtMs = now;
    } else {
      // Active touch hold / move
      const float distFromDown = hypotf(static_cast<float>(pt.x - _downX), static_cast<float>(pt.y - _downY));
      if (!_isDragging && distFromDown > DRAG_THRESHOLD_PX) {
        _isDragging = true;
        // Cancel any pending tap sequence so dragging NEVER triggers a click or mode toggle
        _pendingTapCount = 0;
        _pendingTapsInCenter = false;
        _lastX = pt.x;
        _lastY = pt.y;
      } else if (_isDragging && _mode == ControllerInputMode::MOUSE_MODE) {
        int16_t rawDx = pt.x - _lastX;
        int16_t rawDy = pt.y - _lastY;
        _lastX = pt.x;
        _lastY = pt.y;

        if (rawDx != 0 || rawDy != 0) {
          evt.type = TouchGestureType::MOUSE_MOVE;
          evt.dx = constrain(rawDx * MOUSE_SENSITIVITY_MULT, -127, 127);
          evt.dy = constrain(rawDy * MOUSE_SENSITIVITY_MULT, -127, 127);
          evt.x = pt.x;
          evt.y = pt.y;
          return evt;
        }
      } else {
        _lastX = pt.x;
        _lastY = pt.y;
      }
    }
    return evt;
  }

  // Finger just lifted (Touch Up)
  if (_isTouching) {
    _isTouching = false;
    const unsigned long duration = now - _downAtMs;
    const float totalMove = hypotf(static_cast<float>(_lastX - _downX), static_cast<float>(_lastY - _downY));

    if (!_isDragging && duration <= TAP_MAX_DURATION_MS && totalMove <= DRAG_THRESHOLD_PX) {
      const bool inCenter = isCenterZone(_downX, _downY);

      if (_mode == ControllerInputMode::MACRO_MODE) {
        if (inCenter) {
          // Track rapid center 3-tap for switching Macro Mode -> Mouse Mode
          if (_pendingTapCount > 0 && _pendingTapsInCenter && (now - _lastTapUpMs) <= MULTI_TAP_WINDOW_MS) {
            _pendingTapCount++;
          } else {
            _pendingTapCount = 1;
            _pendingTapsInCenter = true;
          }
          _lastTapUpMs = now;
          _lastTapX = _downX;
          _lastTapY = _downY;

          if (_pendingTapCount >= 3) {
            _pendingTapCount = 0;
            _pendingTapsInCenter = false;
            _mode = ControllerInputMode::MOUSE_MODE;
            evt.type = TouchGestureType::MODE_TOGGLED;
            evt.currentMode = _mode;
            evt.x = _downX;
            evt.y = _downY;
            return evt;
          }
        } else {
          // Outer ring button press in Macro Mode
          _pendingTapCount = 0;
          _pendingTapsInCenter = false;
          int slot = hitTest(_downX, _downY, layout);
          if (slot >= 1 && (now - _lastTriggerMs) >= TOUCH_DEBOUNCE_MS) {
            _lastTriggerMs = now;
            evt.type = TouchGestureType::MACRO_BUTTON_PRESS;
            evt.pressedSlot = slot;
            evt.x = _downX;
            evt.y = _downY;
            return evt;
          }
        }
      } else {
        // MOUSE_MODE short tap: buffer within MULTI_TAP_WINDOW_MS to distinguish 1x, 2x, 3x(center)
        const float distFromPrevTap = hypotf(static_cast<float>(_downX - _lastTapX), static_cast<float>(_downY - _lastTapY));
        if (_pendingTapCount > 0 &&
            (now - _lastTapUpMs) <= MULTI_TAP_WINDOW_MS &&
            distFromPrevTap <= MULTI_TAP_MAX_DIST_PX) {
          _pendingTapCount++;
          _pendingTapsInCenter = _pendingTapsInCenter && inCenter;
        } else {
          _pendingTapCount = 1;
          _pendingTapsInCenter = inCenter;
        }
        _lastTapUpMs = now;
        _lastTapX = _downX;
        _lastTapY = _downY;

        // Center rapid 3-tap in Mouse Mode -> immediately switch back to Macro Mode without firing clicks
        if (_pendingTapCount >= 3 && _pendingTapsInCenter) {
          _pendingTapCount = 0;
          _pendingTapsInCenter = false;
          _mode = ControllerInputMode::MACRO_MODE;
          evt.type = TouchGestureType::MODE_TOGGLED;
          evt.currentMode = _mode;
          evt.x = _downX;
          evt.y = _downY;
          return evt;
        }
      }
    } else {
      // Ended a drag or long press
      _isDragging = false;
    }
    return evt;
  }

  // Check if pending multi-tap window expired while idle
  if (_pendingTapCount > 0 && (now - _lastTapUpMs) > MULTI_TAP_WINDOW_MS) {
    uint8_t resolvedTaps = _pendingTapCount;
    _pendingTapCount = 0;
    _pendingTapsInCenter = false;

    if (_mode == ControllerInputMode::MOUSE_MODE) {
      evt.x = _lastTapX;
      evt.y = _lastTapY;
      if (resolvedTaps == 1) {
        evt.type = TouchGestureType::MOUSE_LEFT_CLICK;
        return evt;
      } else if (resolvedTaps == 2) {
        evt.type = TouchGestureType::MOUSE_RIGHT_CLICK;
        return evt;
      }
    }
  }

  return evt;
}
