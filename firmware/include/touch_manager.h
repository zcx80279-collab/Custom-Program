#pragma once

#include <Arduino.h>

struct TouchPoint {
  bool touched;
  int16_t x;
  int16_t y;
};

enum class ControllerInputMode : uint8_t {
  MACRO_MODE = 0,
  MOUSE_MODE = 1,
};

enum class TouchGestureType : uint8_t {
  NONE = 0,
  MACRO_BUTTON_PRESS,
  MODE_TOGGLED,
  MOUSE_MOVE,
  MOUSE_LEFT_CLICK,
  MOUSE_RIGHT_CLICK,
};

struct TouchInteractionEvent {
  TouchGestureType type = TouchGestureType::NONE;
  ControllerInputMode currentMode = ControllerInputMode::MACRO_MODE;
  int pressedSlot = -1;
  int16_t dx = 0;
  int16_t dy = 0;
  int16_t x = 180;
  int16_t y = 180;
  uint8_t centerTapProgress = 0;
};

class TouchManager {
public:
  bool begin();

  /** Legacy single-slot polling (maintained for compatibility) */
  bool pollButtonPress(const String& layout, int& pressedSlotOut);

  /**
   * Unified gesture & mode state machine supporting:
   * - Macro Mode outer button press
   * - Center rapid 3-tap mode toggle (Macro Mode <-> Mouse Mode)
   * - Mouse Mode drag (cursor move), single tap (left click), double tap (right click)
   */
  TouchInteractionEvent pollInteraction(const String& layout);

  ControllerInputMode getMode() const { return _mode; }
  void setMode(ControllerInputMode mode);

  bool isReady() const { return _ready; }

  /** Mirrors src/shared/geometry.ts hitTestCircularDisplay() 1:1 */
  static int hitTest(int16_t x, int16_t y, const String& layout);

  /** Returns true if coordinate (x, y) is inside the center mode-switch zone */
  static bool isCenterZone(int16_t x, int16_t y);

private:
  bool _ready = false;
  bool _wasTouched = false;
  unsigned long _lastTriggerMs = 0;

  // Unified gesture & mode state
  ControllerInputMode _mode = ControllerInputMode::MACRO_MODE;
  bool _isTouching = false;
  bool _isDragging = false;
  int16_t _downX = 180;
  int16_t _downY = 180;
  int16_t _lastX = 180;
  int16_t _lastY = 180;
  unsigned long _downAtMs = 0;

  uint8_t _pendingTapCount = 0;
  bool _pendingTapsInCenter = false;
  unsigned long _lastTapUpMs = 0;
  int16_t _lastTapX = 180;
  int16_t _lastTapY = 180;

  TouchPoint readCst816s();
};
