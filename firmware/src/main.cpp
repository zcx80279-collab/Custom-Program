/**
 * RoundMacroController V2 - ESP32-S3 Firmware Entry Point
 * Target: Guition JC3636W518C (ESP32-S3R8, 16MB Flash, 8MB PSRAM, 360x360 Round Touch)
 */

#include <Arduino.h>
#include "board_config.h"
#include "protocol.h"
#include "config_manager.h"
#include "display_manager.h"
#include "touch_manager.h"
#include "macro_engine.h"
#include "device_manager.h"
#include "diagnostics_manager.h"

#if RMC_ENABLE_USB_HID
#include "USB.h"
#endif

static ProtocolHandler    g_protocol;
static ConfigManager      g_config;
static DisplayManager     g_display;
static TouchManager       g_touch;
static MacroEngine        g_macro;
static DeviceManager      g_device;
static DiagnosticsManager g_diagnostics;

static unsigned long g_highlightResetAtMs = 0;

static void handleProtocolMessage(const JsonDocument& doc) {
  const char* reqId = doc["requestId"] | "unknown";
  const char* cmd   = doc["command"] | "";

  if (strcmp(cmd, "HELLO") == 0) {
    g_protocol.sendAck(reqId, "HELLO_OK");
    return;
  }

  if (strcmp(cmd, "GET_INFO") == 0) {
    JsonDocument resp;
    resp["version"] = RMC_PROTOCOL_VERSION;
    resp["requestId"] = reqId;
    resp["command"] = "ACK";
    resp["timestampMs"] = millis();
    JsonObject data = resp["data"].to<JsonObject>();
    g_device.populateInfo(data, g_macro.isHidReady());
    g_protocol.sendFrame(resp);
    return;
  }

  if (strcmp(cmd, "GET_STATUS") == 0) {
    JsonDocument resp;
    resp["version"] = RMC_PROTOCOL_VERSION;
    resp["requestId"] = reqId;
    resp["command"] = "ACK";
    resp["timestampMs"] = millis();
    JsonObject data = resp["data"].to<JsonObject>();
    g_device.populateStatus(data, g_config, g_display, g_touch, g_macro, g_diagnostics);
    g_protocol.sendFrame(resp);
    return;
  }

  if (strcmp(cmd, "SET_CONFIG") == 0) {
    JsonObjectConst cfgObj = doc["data"]["config"].as<JsonObjectConst>();
    if (cfgObj.isNull()) {
      g_diagnostics.recordError("ERR_BAD_CONFIG", "Missing data.config object");
      g_protocol.sendError(reqId, "ERR_BAD_CONFIG", "Missing data.config object", true);
      return;
    }

    String err;
    if (!g_config.applyAndSave(cfgObj, err)) {
      g_diagnostics.recordError("ERR_CONFIG_SAVE", err.c_str());
      g_protocol.sendError(reqId, "ERR_CONFIG_SAVE", err.c_str(), true);
      return;
    }

    g_diagnostics.clearError();
    g_macro.setTestMode(g_config.getCurrent().testMode);
    g_display.render(g_config.getCurrent());
    g_protocol.sendAck(reqId, "CONFIG_APPLIED");
    return;
  }

  if (strcmp(cmd, "GET_CONFIG") == 0) {
    JsonDocument resp;
    resp["version"] = RMC_PROTOCOL_VERSION;
    resp["requestId"] = reqId;
    resp["command"] = "ACK";
    resp["timestampMs"] = millis();

    String raw = g_config.getRawConfigJson();
    if (raw.length() > 0) {
      JsonDocument parsedCfg;
      if (deserializeJson(parsedCfg, raw) == DeserializationError::Ok) {
        resp["data"]["config"] = parsedCfg.as<JsonVariant>();
      }
    }
    g_protocol.sendFrame(resp);
    return;
  }

  if (strcmp(cmd, "RESET_CONFIG") == 0) {
    bool confirmed = doc["data"]["confirm"] | false;
    if (!confirmed) {
      g_protocol.sendError(reqId, "ERR_CONFIRM_REQUIRED", "RESET_CONFIG requires data.confirm=true", true);
      return;
    }

    String err;
    if (!g_config.resetStoredConfig(err)) {
      g_diagnostics.recordError("ERR_RESET_FAILED", err.c_str());
      g_protocol.sendError(reqId, "ERR_RESET_FAILED", err.c_str(), true);
      return;
    }

    g_diagnostics.clearError();
    g_macro.setTestMode(g_config.getCurrent().testMode);
    g_display.render(g_config.getCurrent());
    g_protocol.sendAck(reqId, "CONFIG_RESET");
    return;
  }

  g_protocol.sendError(reqId, "ERR_UNKNOWN_CMD", "Unsupported protocol command", true);
}

void setup() {
  // 1. Initialize Diagnostics & Device Identity
  g_diagnostics.begin();
  g_device.begin();

  // 2. Initialize Native USB (CDC + optional TinyUSB HID Composite)
#if RMC_ENABLE_USB_HID
  USB.productName(RMC_DEVICE_NAME);
  USB.manufacturerName("RoundMacroController");
  USB.begin();
#endif
  Serial.begin(115200);
  g_protocol.begin(&Serial, handleProtocolMessage);

  // 3. Initialize LittleFS Storage & Load Persisted Config
  if (!g_config.begin()) {
    g_diagnostics.recordError("WARN_NO_STORED_CONFIG", "Loaded fallback defaults");
  }

  // 4. Initialize Macro Engine (HID + PC_AGENT Bridge)
  g_macro.begin(&g_protocol);
  g_macro.setTestMode(g_config.getCurrent().testMode);

  // 5. Initialize 360x360 Display (ST77916 QSPI) & Capacitive Touch (CST816S I2C)
  if (!g_display.begin()) {
    g_diagnostics.recordError("ERR_DISPLAY_INIT", "ST77916 init failed — verify board_config.h pins");
  } else {
    g_display.render(g_config.getCurrent());
  }

  if (!g_touch.begin()) {
    g_diagnostics.recordError("ERR_TOUCH_INIT", "CST816S I2C 0x15 not detected — verify SDA/SCL/RST");
  }
}

void loop() {
  // 1. Process incoming USB CDC Protocol V2 frames
  g_protocol.poll();

  // 2. Step non-blocking macro execution state machine
  g_macro.update();

  // 3. Poll capacitive touchscreen and trigger mapped macro
  int pressedSlot = -1;
  if (g_touch.pollButtonPress(g_config.getCurrent().layout, pressedSlot)) {
    const auto& cfg = g_config.getCurrent();
    for (const auto& btn : cfg.buttons) {
      if (btn.slotIndex == pressedSlot) {
        g_display.setPressedSlot(cfg, pressedSlot);
        g_highlightResetAtMs = millis() + 180;
        g_macro.triggerButton(btn);
        break;
      }
    }
  }

  // 4. Clear visual press highlight without blocking
  if (g_highlightResetAtMs > 0 && millis() >= g_highlightResetAtMs) {
    g_highlightResetAtMs = 0;
    g_display.setPressedSlot(g_config.getCurrent(), -1);
  }
}
