#pragma once

#include <Arduino.h>

struct TouchPoint {
  bool touched;
  int16_t x;
  int16_t y;
};

class TouchManager {
public:
  bool begin();
  bool pollButtonPress(const String& layout, int& pressedSlotOut);
  bool isReady() const { return _ready; }

  /** Mirrors src/shared/geometry.ts hitTestCircularDisplay() 1:1 */
  static int hitTest(int16_t x, int16_t y, const String& layout);

private:
  bool _ready = false;
  bool _wasTouched = false;
  unsigned long _lastTriggerMs = 0;

  TouchPoint readCst816s();
};
