#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <vector>

struct FirmwareMacroStep {
  enum Type { TAP, COMBO, DELAY } type;
  uint8_t hidUsageId;
  uint8_t modifiers;
  uint16_t delayMs;
};

struct FirmwareButton {
  int slotIndex;
  String label;
  uint16_t color565;
  bool enabled;
  String macroId;
  String executionMode; // "DEVICE_HID" | "PC_AGENT" | "HYBRID"
  std::vector<FirmwareMacroStep> steps;
};

struct FirmwareDeviceConfig {
  String schemaVersion;
  String profileId;
  String profileName;
  String layout; // "RADIAL_4_CENTER" | "RADIAL_6_CENTER" | "RADIAL_8_CENTER"
  uint16_t backgroundColor565;
  std::vector<FirmwareButton> buttons;
  bool testMode = false;
  uint8_t mouseCursorSpeed = 2;
  bool loadedFromStorage;
};

class ConfigManager {
public:
  bool begin();
  bool loadFromStorage();
  bool applyAndSave(const JsonObjectConst& configObj, String& errorOut);
  bool resetStoredConfig(String& errorOut);

  const FirmwareDeviceConfig& getCurrent() const { return _current; }
  String getRawConfigJson() const { return _rawJson; }
  bool hasStoredConfig() const { return _current.loadedFromStorage; }
  static uint16_t hexToRgb565(const char* hex);

private:
  FirmwareDeviceConfig _current;
  String _rawJson;

  bool parseConfigJson(const String& jsonStr, FirmwareDeviceConfig& outCfg, String& errorOut);
  void loadFallbackDefaults();
};
