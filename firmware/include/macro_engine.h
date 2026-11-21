#pragma once

#include <Arduino.h>
#include "config_manager.h"
#include "protocol.h"

class MacroEngine {
public:
  bool begin(ProtocolHandler* protocol);
  bool triggerButton(const FirmwareButton& button);
  void update();

  void setTestMode(bool enabled);
  bool isTestMode() const { return _testMode; }

  bool isHidReady() const { return _hidReady; }
  bool isBusy() const { return _running; }

private:
  ProtocolHandler* _protocol = nullptr;
  bool _hidReady = false;
  bool _testMode = false;
  bool _running = false;
  std::vector<FirmwareMacroStep> _activeSteps;
  size_t _stepIndex = 0;
  unsigned long _nextStepAtMs = 0;

  void sendHidKeyReport(uint8_t modifiers, uint8_t hidUsageId);
  void releaseAllHidKeys();
};
