#include "config_manager.h"
#include <LittleFS.h>

static const char* CONFIG_PRIMARY_PATH = "/rmc_config.json";
static const char* CONFIG_BACKUP_PATH  = "/rmc_config.bak";
static const char* CONFIG_TEMP_PATH    = "/rmc_config.tmp";

uint16_t ConfigManager::hexToRgb565(const char* hex) {
  if (!hex || hex[0] != '#' || strlen(hex) < 7) {
    return 0x18E3; // Default dark slate
  }
  uint32_t rgb = strtoul(hex + 1, nullptr, 16);
  uint8_t r = (rgb >> 16) & 0xFF;
  uint8_t g = (rgb >> 8) & 0xFF;
  uint8_t b = rgb & 0xFF;
  return static_cast<uint16_t>(((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3));
}

bool ConfigManager::begin() {
  if (!LittleFS.begin(true)) {
    loadFallbackDefaults();
    return false;
  }
  return loadFromStorage();
}

void ConfigManager::loadFallbackDefaults() {
  _current = FirmwareDeviceConfig();
  _current.schemaVersion = "2.0.0";
  _current.profileId = "factory-default";
  _current.profileName = "기본 대기 화면";
  _current.layout = "RADIAL_6_CENTER";
  _current.backgroundColor565 = hexToRgb565("#0F172A");
  _current.testMode = false;
  _current.mouseCursorSpeed = 2;
  _current.loadedFromStorage = false;
  _rawJson = "";

  for (int i = 0; i <= 6; ++i) {
    FirmwareButton btn;
    btn.slotIndex = i;
    btn.label = (i == 0) ? "CENTER" : (String("BTN ") + String(i));
    btn.color565 = (i == 0) ? hexToRgb565("#2563EB") : hexToRgb565("#1E293B");
    btn.enabled = true;
    btn.macroId = "";
    btn.executionMode = "DEVICE_HID";
    _current.buttons.push_back(btn);
  }
}

bool ConfigManager::loadFromStorage() {
  const char* candidates[2] = { CONFIG_PRIMARY_PATH, CONFIG_BACKUP_PATH };
  for (int i = 0; i < 2; ++i) {
    if (!LittleFS.exists(candidates[i])) continue;

    File file = LittleFS.open(candidates[i], "r");
    if (!file) continue;

    String content = file.readString();
    file.close();

    FirmwareDeviceConfig parsed;
    String err;
    if (parseConfigJson(content, parsed, err)) {
      parsed.loadedFromStorage = true;
      _current = parsed;
      _rawJson = content;
      return true;
    }
  }

  loadFallbackDefaults();
  return false;
}

bool ConfigManager::parseConfigJson(const String& jsonStr, FirmwareDeviceConfig& outCfg, String& errorOut) {
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, jsonStr);
  if (err) {
    errorOut = String("JSON parse error: ") + err.c_str();
    return false;
  }

  const char* schema = doc["schemaVersion"] | "";
  if (strncmp(schema, "2.", 2) != 0) {
    errorOut = "Unsupported schemaVersion (expected 2.x)";
    return false;
  }

  JsonArray buttonsArr = doc["buttons"].as<JsonArray>();
  if (buttonsArr.isNull() || buttonsArr.size() == 0 || buttonsArr.size() > 9) {
    errorOut = "Invalid buttons array (expected 1..9 slots)";
    return false;
  }

  outCfg = FirmwareDeviceConfig();
  outCfg.schemaVersion = schema;
  outCfg.profileId = doc["profileId"] | "unknown";
  outCfg.profileName = doc["profileName"] | "Profile";
  outCfg.layout = doc["layout"] | "RADIAL_6_CENTER";
  outCfg.backgroundColor565 = hexToRgb565(doc["backgroundColor"] | "#0F172A");
  outCfg.testMode = doc["testMode"] | false;
  outCfg.mouseCursorSpeed = constrain(doc["mouseCursorSpeed"] | 2, 1, 5);

  for (JsonObject bObj : buttonsArr) {
    FirmwareButton btn;
    btn.slotIndex = bObj["slot"] | 0;
    btn.label = bObj["label"] | "";
    btn.color565 = hexToRgb565(bObj["color"] | "#1E293B");
    btn.enabled = bObj["enabled"] | true;
    btn.macroId = bObj["macroId"].isNull() ? "" : (bObj["macroId"] | "");
    btn.executionMode = bObj["mode"] | "DEVICE_HID";

    JsonArray stepsArr = bObj["steps"].as<JsonArray>();
    if (!stepsArr.isNull()) {
      for (JsonObject sObj : stepsArr) {
        if (btn.steps.size() >= 32) break;
        const char* t = sObj["t"] | "";
        FirmwareMacroStep st{};
        if (strcmp(t, "DELAY") == 0) {
          st.type = FirmwareMacroStep::DELAY;
          uint16_t ms = sObj["ms"] | 50;
          st.delayMs = constrain(ms, 10, 10000);
        } else if (strcmp(t, "COMBO") == 0) {
          st.type = FirmwareMacroStep::COMBO;
          st.hidUsageId = sObj["hid"] | 0;
          st.modifiers = sObj["mod"] | 0;
        } else {
          st.type = FirmwareMacroStep::TAP;
          st.hidUsageId = sObj["hid"] | 0;
          st.modifiers = 0;
        }
        btn.steps.push_back(st);
      }
    }
    outCfg.buttons.push_back(btn);
  }

  return true;
}

bool ConfigManager::applyAndSave(const JsonObjectConst& configObj, String& errorOut) {
  String serialized;
  serializeJson(configObj, serialized);

  // 1. Validate BEFORE touching storage so previous valid config is preserved on error
  FirmwareDeviceConfig validated;
  if (!parseConfigJson(serialized, validated, errorOut)) {
    return false;
  }

  // 2. Write to temporary file first
  File tmpFile = LittleFS.open(CONFIG_TEMP_PATH, "w");
  if (!tmpFile) {
    errorOut = "Failed to open temporary LittleFS config file";
    return false;
  }
  size_t written = tmpFile.print(serialized);
  tmpFile.close();

  if (written != serialized.length()) {
    LittleFS.remove(CONFIG_TEMP_PATH);
    errorOut = "Incomplete write to LittleFS (previous valid config preserved)";
    return false;
  }

  // 3. Rotate existing primary to backup, then promote temp to primary
  if (LittleFS.exists(CONFIG_PRIMARY_PATH)) {
    LittleFS.remove(CONFIG_BACKUP_PATH);
    LittleFS.rename(CONFIG_PRIMARY_PATH, CONFIG_BACKUP_PATH);
  }

  if (!LittleFS.rename(CONFIG_TEMP_PATH, CONFIG_PRIMARY_PATH)) {
    // Roll back backup if rename failed
    if (LittleFS.exists(CONFIG_BACKUP_PATH)) {
      LittleFS.rename(CONFIG_BACKUP_PATH, CONFIG_PRIMARY_PATH);
    }
    errorOut = "Failed to commit config file atomically (rolled back)";
    return false;
  }

  validated.loadedFromStorage = true;
  _current = validated;
  _rawJson = serialized;
  return true;
}

bool ConfigManager::resetStoredConfig(String& errorOut) {
  // Deletes ONLY stored configuration files; firmware remains untouched.
  bool ok = true;
  if (LittleFS.exists(CONFIG_PRIMARY_PATH)) {
    ok = ok && LittleFS.remove(CONFIG_PRIMARY_PATH);
  }
  if (LittleFS.exists(CONFIG_BACKUP_PATH)) {
    ok = ok && LittleFS.remove(CONFIG_BACKUP_PATH);
  }
  if (LittleFS.exists(CONFIG_TEMP_PATH)) {
    LittleFS.remove(CONFIG_TEMP_PATH);
  }

  if (!ok) {
    errorOut = "Failed to delete one or more stored config files";
    return false;
  }

  loadFallbackDefaults();
  return true;
}
