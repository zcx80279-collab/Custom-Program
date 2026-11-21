#include "macro_engine.h"

#if RMC_ENABLE_USB_HID
#include "USB.h"
#include "USBHIDKeyboard.h"
static USBHIDKeyboard s_keyboard;
#endif

bool MacroEngine::begin(ProtocolHandler* protocol) {
  _protocol = protocol;
#if RMC_ENABLE_USB_HID
  // Requires ARDUINO_USB_MODE=0 (TinyUSB OTG composite CDC+HID)
  s_keyboard.begin();
  _hidReady = true;
#else
  _hidReady = false;
#endif
  return true;
}

void MacroEngine::setTestMode(bool enabled) {
  _testMode = enabled;
  if (enabled) {
    // Immediately ensure no stuck HID keys remain if switched during idle/run
    releaseAllHidKeys();
  }
}

bool MacroEngine::triggerButton(const FirmwareButton& button) {
  if (!button.enabled || button.macroId.length() == 0) {
    return false;
  }

  // Test Mode: NEVER emit USB HID keystrokes; notify PC via MACRO_EVENT(testMode=true)
  // and step through simulated timing for local visual feedback only.
  if (_testMode) {
    if (_protocol) {
      _protocol->sendMacroEvent(button.macroId.c_str(), button.slotIndex, true);
    }
    if (!button.steps.empty() && !_running) {
      _activeSteps = button.steps;
      _stepIndex = 0;
      _nextStepAtMs = millis();
      _running = true;
    }
    return true;
  }

  // Case 1: Explicit PC_AGENT mode -> send MACRO_EVENT over USB CDC
  if (button.executionMode == "PC_AGENT") {
    if (_protocol) {
      return _protocol->sendMacroEvent(button.macroId.c_str(), button.slotIndex, false);
    }
    return false;
  }

  // Case 2: HYBRID mode when USB HID is unavailable -> fall back to PC_AGENT
  if (button.executionMode == "HYBRID" && !_hidReady) {
    if (_protocol) {
      return _protocol->sendMacroEvent(button.macroId.c_str(), button.slotIndex, false);
    }
    return false;
  }

  // Case 3: DEVICE_HID (or HYBRID with HID ready) -> execute directly on ESP32-S3
  if (!_hidReady || button.steps.empty() || _running) {
    return false;
  }

  _activeSteps = button.steps;
  _stepIndex = 0;
  _nextStepAtMs = millis();
  _running = true;
  return true;
}

void MacroEngine::update() {
  if (!_running) return;

  unsigned long now = millis();
  if (now < _nextStepAtMs) return;

  if (_stepIndex >= _activeSteps.size()) {
    if (!_testMode) {
      releaseAllHidKeys();
    }
    _running = false;
    _activeSteps.clear();
    return;
  }

  const FirmwareMacroStep& step = _activeSteps[_stepIndex++];
  if (step.type == FirmwareMacroStep::DELAY) {
    _nextStepAtMs = now + step.delayMs;
    return;
  }

  // In Test Mode, suppress all HID key reports and only advance virtual step timing
  if (_testMode) {
    _nextStepAtMs = now + 100;
    return;
  }

  sendHidKeyReport(step.modifiers, step.hidUsageId);
  delay(15); // Brief HID report dwell time for Windows USB polling (125Hz / 8ms)
  releaseAllHidKeys();
  _nextStepAtMs = millis() + 20;
}

void MacroEngine::sendHidKeyReport(uint8_t modifiers, uint8_t hidUsageId) {
#if RMC_ENABLE_USB_HID
  if (_testMode || !_hidReady || hidUsageId == 0) return;
  KeyReport report{};
  report.modifiers = modifiers;
  report.reserved = 0;
  report.keys[0] = hidUsageId;
  s_keyboard.sendReport(&report);
#else
  (void)modifiers;
  (void)hidUsageId;
#endif
}

void MacroEngine::releaseAllHidKeys() {
#if RMC_ENABLE_USB_HID
  if (!_hidReady) return;
  KeyReport report{};
  s_keyboard.sendReport(&report);
#endif
}
