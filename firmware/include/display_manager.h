#pragma once

#include <Arduino.h>
#include "config_manager.h"

class DisplayManager {
public:
  bool begin();
  void render(const FirmwareDeviceConfig& config, int activePressedSlot = -1);
  void setPressedSlot(const FirmwareDeviceConfig& config, int slotIndex);
  bool isReady() const { return _ready; }

private:
  bool _ready = false;
  int _lastPressedSlot = -1;
};
