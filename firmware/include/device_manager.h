#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include "config_manager.h"
#include "display_manager.h"
#include "touch_manager.h"
#include "macro_engine.h"
#include "diagnostics_manager.h"

class DeviceManager {
public:
  void begin();
  String getSerialNumber() const { return _serialNumber; }
  void populateInfo(JsonObject dataOut, bool hidReady) const;
  void populateStatus(
      JsonObject dataOut,
      const ConfigManager& configMgr,
      const DisplayManager& displayMgr,
      const TouchManager& touchMgr,
      const MacroEngine& macroEng,
      const DiagnosticsManager& diagMgr) const;

private:
  String _serialNumber;
};
